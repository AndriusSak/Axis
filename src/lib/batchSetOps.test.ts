import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  batchSetParam,
  canBatchSet,
  planBatchSet,
  runBatchSet,
  type BatchSetIo,
  type BatchSetRequest,
  type BatchSetPreview
} from './batchSetOps';
import type { PresetLocations } from './types';

// ── "Set a parameter in multiple presets" (parity audit §2.11) ───────────────────────────────────
// The FM3 has no cross-preset param write, so the op is a per-slot sequence over existing endpoints:
// GET /preset/locations → POST /preset/select → PUT /preset/blocks/:eid/params/:paramId → POST
// /preset/store. These tests pin the plan (which slots change / are skipped) and the runner ORDER +
// the explicit `continuous` flag + the abort accounting against a recording mock — the device
// primitives are hardware-unverified here, but the composition and the safety rules are exact.

type Call =
  | { op: 'locations' }
  | { op: 'select'; n: number }
  | { op: 'setParam'; eid: number; paramId: number; value: number; continuous: boolean }
  | { op: 'store'; n: number };

const scan = (entries: { location: number; code?: string | null; name?: string; isEmpty?: boolean }[]): PresetLocations => ({
  count: entries.length,
  locations: entries.map((e) => ({ location: e.location, code: e.code ?? null, name: e.name ?? `Preset ${e.location}`, isEmpty: e.isEmpty ?? false }))
});

/** A recording mock. `failAt` throws on the op for that slot (store or select or setParam). */
function recorder(opts?: { failOp?: 'select' | 'setParam' | 'store'; failSlot?: number; scan?: PresetLocations }) {
  const calls: Call[] = [];
  const io: BatchSetIo = {
    locations: async () => { calls.push({ op: 'locations' }); return opts?.scan ?? scan([{ location: 1 }, { location: 2 }, { location: 3 }]); },
    select: async (n) => { calls.push({ op: 'select', n }); if (opts?.failOp === 'select' && opts.failSlot === n) throw new Error(`select ${n} failed`); return { ok: true }; },
    setParam: async (eid, paramId, value, continuous) => {
      calls.push({ op: 'setParam', eid, paramId, value, continuous });
      if (opts?.failOp === 'setParam') throw new Error('setParam failed');
      return { ok: true };
    },
    store: async (n) => { calls.push({ op: 'store', n }); if (opts?.failOp === 'store' && opts.failSlot === n) throw new Error(`store ${n} rejected`); return { ok: true }; }
  };
  return { calls, io };
}

const REQ: BatchSetRequest = { eid: 42, paramId: 7, value: 0.5, continuous: true, paramName: 'Mix' };

describe('batchSetOps — canBatchSet gate', () => {
  it('accepts non-negative integer (eid, paramId) pairs only', () => {
    expect(canBatchSet(42, 7)).toBe(true);
    expect(canBatchSet(0, 0)).toBe(true);
    expect(canBatchSet(-1, 7)).toBe(false);
    expect(canBatchSet(42, -1)).toBe(false);
    expect(canBatchSet(42.5, 7)).toBe(false);
    expect(canBatchSet(42, Number.NaN)).toBe(false);
  });
});

describe('batchSetOps — planBatchSet (dry run)', () => {
  it('keeps only present, non-empty slots; dedupes; sorts by location', () => {
    const locations = scan([
      { location: 3, code: 'A03', name: 'Lead' },
      { location: 5, name: 'Pad' },
      { location: 9, name: 'Empty', isEmpty: true }
    ]);
    const preview = planBatchSet(locations, [5, 3, 3, 9, 77], REQ, 0);
    expect(preview.blocked).toBeNull();
    expect(preview.targets.map((t) => t.location)).toEqual([3, 5]);
    expect(preview.targets[0]).toEqual({ location: 3, code: 'A03', name: 'Lead' });
    expect(preview.skipped).toEqual([
      { location: 3, reason: 'listed twice' },
      { location: 9, reason: 'empty slot' },
      { location: 77, reason: 'not present in the device slot scan' }
    ]);
    expect(preview.restoreTo).toBe(0);
  });

  it('rejects an invalid / negative slot without dropping the good ones', () => {
    const locations = scan([{ location: 2 }]);
    const preview = planBatchSet(locations, [-1, 2, 1.5], REQ, null);
    expect(preview.targets.map((t) => t.location)).toEqual([2]);
    expect(preview.skipped).toEqual([
      { location: -1, reason: 'not a valid slot number' },
      { location: 1.5, reason: 'not a valid slot number' }
    ]);
  });

  it('BLOCKS the whole operation when the param cannot be addressed (never invent an id)', () => {
    const locations = scan([{ location: 2 }]);
    const preview = planBatchSet(locations, [2], { ...REQ, paramId: Number.NaN }, null);
    expect(preview.blocked).toMatch(/cannot address param/);
    expect(preview.targets).toHaveLength(0);
  });
});

describe('batchSetOps — runBatchSet sequence', () => {
  it('per slot: select → setParam(continuous explicit) → store; then restores the origin', async () => {
    const { calls, io } = recorder();
    const preview = planBatchSet(scan([{ location: 3 }, { location: 5 }]), [5, 3], REQ, 0);
    const res = await runBatchSet(preview, io);
    expect(calls.map((c) => c.op)).toEqual(['select', 'setParam', 'store', 'select', 'setParam', 'store', 'select']);
    expect(calls.filter((c) => c.op === 'select').map((c) => (c as { n: number }).n)).toEqual([3, 5, 0]); // targets sorted, then restore
    expect(res.written).toEqual([3, 5]);
    expect(res.ok).toBe(2);
    expect(res.failed).toBe(0);
    expect(res.abortedAt).toBeNull();
    expect(res.restored).toBe(true);
  });

  it('sends continuous=true EXPLICITLY (an omitted flag would clamp a bare ordinal)', async () => {
    const { calls, io } = recorder();
    await runBatchSet(planBatchSet(scan([{ location: 1 }]), [1], REQ, null), io);
    const w = calls.find((c) => c.op === 'setParam') as Extract<Call, { op: 'setParam' }>;
    expect(w).toMatchObject({ eid: 42, paramId: 7, value: 0.5, continuous: true });
  });

  it('propagates continuous=false for a discrete write', async () => {
    const { calls, io } = recorder();
    await runBatchSet(planBatchSet(scan([{ location: 1 }]), [1], { ...REQ, continuous: false }, null), io);
    const w = calls.find((c) => c.op === 'setParam') as Extract<Call, { op: 'setParam' }>;
    expect(w.continuous).toBe(false);
  });

  it('aborts on the FIRST error and reports exactly which slots were already written', async () => {
    const { calls, io } = recorder({ failOp: 'store', failSlot: 5 });
    const preview = planBatchSet(scan([{ location: 3 }, { location: 5 }, { location: 8 }]), [3, 5, 8], REQ, 0);
    const res = await runBatchSet(preview, io);
    expect(res.written).toEqual([3]); // 3 fully stored before the abort
    expect(res.abortedAt).toBe(5);
    expect(res.error).toMatch(/store 5 rejected/);
    expect(res.ok).toBe(1);
    expect(res.failed).toBe(1);
    // slot 8 was never attempted; the origin is still re-selected.
    expect(calls.some((c) => c.op === 'store' && (c as { n: number }).n === 8)).toBe(false);
    expect(calls[calls.length - 1]).toEqual({ op: 'select', n: 0 });
    expect(res.restored).toBe(true);
  });

  it('does not count a slot as written when its parameter write fails', async () => {
    const { io } = recorder({ failOp: 'setParam' });
    const res = await runBatchSet(planBatchSet(scan([{ location: 3 }, { location: 5 }]), [3, 5], REQ, null), io);
    expect(res.written).toEqual([]);
    expect(res.abortedAt).toBe(3);
  });

  it('a blocked plan performs NO device writes', async () => {
    const { calls, io } = recorder();
    const blocked: BatchSetPreview = { request: { ...REQ, eid: -1 }, restoreTo: 0, targets: [], skipped: [], blocked: 'cannot address param 7 on block -1' };
    const res = await runBatchSet(blocked, io);
    expect(calls).toHaveLength(0);
    expect(res.ok).toBe(0);
    expect(res.error).toMatch(/cannot address/);
  });

  it('a failed restore does not invalidate the writes; restored stays false', async () => {
    const { io } = recorder({ failOp: 'select', failSlot: 0 });
    const res = await runBatchSet(planBatchSet(scan([{ location: 3 }]), [3], REQ, 0), io);
    expect(res.written).toEqual([3]);
    expect(res.restored).toBe(false);
  });
});

describe('batchSetOps — batchSetParam convenience (scan → plan → run)', () => {
  it('scans locations once, then writes every addressed slot', async () => {
    const { calls, io } = recorder({ scan: scan([{ location: 4 }, { location: 6, isEmpty: true }]) });
    const res = await batchSetParam([4, 6], REQ, null, io);
    expect(calls.filter((c) => c.op === 'locations')).toHaveLength(1);
    expect(res.written).toEqual([4]);
    expect(calls.map((c) => c.op)).toEqual(['locations', 'select', 'setParam', 'store']);
  });
});

// ── component wiring (source guards — .svelte cannot mount in this node-env vitest) ──────────────
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('batchSetOps — AxisBatchSetPanel.svelte wiring', () => {
  const src = read('./axis-workbench/panels/AxisBatchSetPanel.svelte');

  it('delegates all device work to the tested batchSetOps module (no inline endpoint logic)', () => {
    expect(src).toContain("from '../../batchSetOps'");
    for (const fn of ['planBatchSet', 'runBatchSet', 'canBatchSet']) {
      expect(src).toContain(fn);
    }
    // No direct forgefx endpoint calls in the panel body beyond the injected IO adapter.
    expect(src).toContain('type BatchSetIo');
  });

  it('sends the continuous flag explicitly through the IO seam', () => {
    expect(src).toMatch(/setParam:\s*\(eid,\s*paramId,\s*value,\s*continuous\)\s*=>\s*forgefx\.setParam\(eid,\s*paramId,\s*value,\s*continuous\)/);
  });

  it('states the operation is DESTRUCTIVE and overwrites slots, plainly', () => {
    expect(src).toMatch(/[Dd]estructive|OVERWRITE|overwrites/i);
    expect(src).toMatch(/overwrite/i);
  });

  it('requires an explicit confirm before applying (no auto-run on preview)', () => {
    // The apply gate is derived from the confirm checkbox and the apply button binds to it.
    expect(src).toMatch(/confirm/i);
    expect(src).toMatch(/bind:checked=\{confirmed\}/);
    expect(src).toMatch(/const canApply = \$derived\([^;]*confirmed/);
    expect(src).toMatch(/disabled=\{!canApply\}/);
  });

  it('shows a dry-run preview of exactly which slots would change', () => {
    expect(src).toMatch(/[Pp]review/);
    expect(src).toMatch(/preview\.targets|\.targets/);
    expect(src).toMatch(/preview\.skipped|\.skipped/);
  });

  it('restores the originally selected preset via the editor store', () => {
    expect(src).toMatch(/restoreTo/);
    expect(src).toContain('editor.preset');
  });
});

describe('batchSetOps — workbench registration wiring', () => {
  it('declares the axis.batchSet panel type in the manifest', () => {
    expect(read('./axis-workbench/axisWorkbenchRegistryManifest.ts')).toContain("'axis.batchSet'");
  });

  it('maps axis.batchSet to AxisBatchSetPanel in the registry', () => {
    const registry = read('./axis-workbench/axisWorkbenchRegistry.ts');
    expect(registry).toContain('AxisBatchSetPanel');
    expect(registry).toMatch(/type === 'axis\.batchSet'\s*\?\s*AxisBatchSetPanel/);
  });

  it('registers an open action for the panel (no dead panel)', () => {
    const registry = read('./axis-workbench/axisWorkbenchRegistry.ts');
    const action = registry.slice(registry.indexOf("actionId: 'axis.openBatchSet'"));
    const block = action.slice(0, action.indexOf('})'));
    expect(block).toContain("panelType: 'axis.batchSet'");
    expect(read('./axis-workbench/axisWorkbenchRegistryManifest.ts')).toContain("'axis.openBatchSet'");
  });
});
