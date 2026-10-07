import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  planResetAmp,
  runResetAmp,
  resetAmpBlocksPerPreset,
  type ResetAmpBlock,
  type ResetAmpIo
} from './resetAmpOps';
import type { PresetLocations } from './types';

// ── "Reset AMP blocks per preset" over the batch machinery (parity audit §2.4 remainder) ──────────
// The served block-params carry no per-param DEFAULT (blockOps.ts), so the honest device-true reset is
// re-selecting the AMP block's own model ordinal (POST /preset/blocks/:eid/type) — the same soft reset
// the editor's resetChannel/resetBlock already use. The op is a per-slot sequence over existing
// endpoints (scan → select → find AMP → re-select model → store). These tests pin the plan (which slots
// change / are skipped), the runner ORDER, the multi-amp handling, the no-amp skip, and the abort/restore
// accounting against a recording mock.

type Call =
  | { op: 'locations' }
  | { op: 'select'; n: number }
  | { op: 'ampBlocks' }
  | { op: 'resetAmpBlock'; eid: number; typeValue: number }
  | { op: 'store'; n: number };

const scan = (entries: { location: number; code?: string | null; name?: string; isEmpty?: boolean }[]): PresetLocations => ({
  count: entries.length,
  locations: entries.map((e) => ({ location: e.location, code: e.code ?? null, name: e.name ?? `Preset ${e.location}`, isEmpty: e.isEmpty ?? false }))
});

const AMPS: Record<number, ResetAmpBlock[]> = {
  3: [{ eid: 100, typeValue: 12, typeName: '5153' }],
  5: [{ eid: 200, typeValue: 7, typeName: 'Plexi' }, { eid: 201, typeValue: 3, typeName: 'AC-20' }],
  8: [] // no amp block
};

function recorder(opts?: { failOp?: 'select' | 'ampBlocks' | 'resetAmpBlock' | 'store'; failSlot?: number; scan?: PresetLocations }) {
  const calls: Call[] = [];
  let current = -1; // the slot the mock currently has selected
  const io: ResetAmpIo = {
    locations: async () => { calls.push({ op: 'locations' }); return opts?.scan ?? scan([{ location: 3 }, { location: 5 }, { location: 8 }]); },
    select: async (n) => { calls.push({ op: 'select', n }); if (opts?.failOp === 'select' && opts.failSlot === n) throw new Error(`select ${n} failed`); current = n; return { ok: true }; },
    ampBlocks: async () => { calls.push({ op: 'ampBlocks' }); if (opts?.failOp === 'ampBlocks') throw new Error('ampBlocks failed'); return AMPS[current] ?? []; },
    resetAmpBlock: async (eid, typeValue) => { calls.push({ op: 'resetAmpBlock', eid, typeValue }); if (opts?.failOp === 'resetAmpBlock') throw new Error('resetAmpBlock failed'); return { ok: true }; },
    store: async (n) => { calls.push({ op: 'store', n }); if (opts?.failOp === 'store' && opts.failSlot === n) throw new Error(`store ${n} rejected`); return { ok: true }; }
  };
  return { calls, io };
}

describe('resetAmpOps — planResetAmp (dry run)', () => {
  it('reuses the batch slot filter: present + non-empty, deduped, sorted by location', () => {
    const locations = scan([
      { location: 3, code: 'A03', name: 'Lead' },
      { location: 5, name: 'Pad' },
      { location: 9, name: 'Empty', isEmpty: true }
    ]);
    const preview = planResetAmp(locations, [5, 3, 3, 9, 77], 0);
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
});

describe('resetAmpOps — runResetAmp sequence', () => {
  it('per slot: select → find AMP → re-select each model → store; then restores the origin', async () => {
    const { calls, io } = recorder();
    const preview = planResetAmp(scan([{ location: 3 }, { location: 5 }]), [5, 3], 0);
    const res = await runResetAmp(preview, io);
    expect(calls.map((c) => c.op)).toEqual(['select', 'ampBlocks', 'resetAmpBlock', 'store', 'select', 'ampBlocks', 'resetAmpBlock', 'resetAmpBlock', 'store', 'select']);
    expect(calls.filter((c) => c.op === 'select').map((c) => (c as { n: number }).n)).toEqual([3, 5, 0]); // targets sorted, then restore
    expect(res.written).toEqual([3, 5]);
    expect(res.resetBlocks).toBe(3); // 1 amp in slot 3 + 2 in slot 5
    expect(res.ok).toBe(2);
    expect(res.failed).toBe(0);
    expect(res.abortedAt).toBeNull();
    expect(res.restored).toBe(true);
  });

  it('re-selects the model ordinal the device serves (never invents a default)', async () => {
    const { calls, io } = recorder();
    await runResetAmp(planResetAmp(scan([{ location: 5 }]), [5], null), io);
    const writes = calls.filter((c) => c.op === 'resetAmpBlock') as Extract<Call, { op: 'resetAmpBlock' }>[];
    expect(writes).toEqual([
      { op: 'resetAmpBlock', eid: 200, typeValue: 7 },
      { op: 'resetAmpBlock', eid: 201, typeValue: 3 }
    ]);
  });

  it('skips a preset with no AMP block (no store, reported in noAmp)', async () => {
    const { calls, io } = recorder();
    const res = await runResetAmp(planResetAmp(scan([{ location: 8 }, { location: 3 }]), [8, 3], null), io);
    expect(res.noAmp).toEqual([8]);
    expect(res.written).toEqual([3]);
    expect(calls.some((c) => c.op === 'store' && (c as { n: number }).n === 8)).toBe(false);
  });

  it('ABORTS on the first error and reports exactly which slots were already written', async () => {
    const { calls, io } = recorder({ failOp: 'store', failSlot: 5 });
    const preview = planResetAmp(scan([{ location: 3 }, { location: 5 }, { location: 8 }]), [3, 5, 8], 0);
    const res = await runResetAmp(preview, io);
    expect(res.written).toEqual([3]); // 3 fully reset + stored before the abort
    expect(res.abortedAt).toBe(5);
    expect(res.error).toMatch(/store 5 rejected/);
    expect(res.ok).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.restored).toBe(true);
    expect(calls[calls.length - 1]).toEqual({ op: 'select', n: 0 });
  });

  it('does not count a slot as written when its model re-select fails', async () => {
    const { io } = recorder({ failOp: 'resetAmpBlock' });
    const res = await runResetAmp(planResetAmp(scan([{ location: 3 }, { location: 5 }]), [3, 5], null), io);
    expect(res.written).toEqual([]);
    expect(res.abortedAt).toBe(3);
  });

  it('a blocked plan performs NO device writes', async () => {
    const { calls, io } = recorder();
    const res = await runResetAmp({ restoreTo: 0, targets: [], skipped: [], blocked: 'nothing selected' }, io);
    expect(calls).toHaveLength(0);
    expect(res.error).toMatch(/nothing selected/);
  });

  it('a failed restore does not invalidate the writes; restored stays false', async () => {
    const { io } = recorder({ failOp: 'select', failSlot: 0 });
    const res = await runResetAmp(planResetAmp(scan([{ location: 3 }]), [3], 0), io);
    expect(res.written).toEqual([3]);
    expect(res.restored).toBe(false);
  });
});

describe('resetAmpOps — resetAmpBlocksPerPreset convenience (scan → plan → run)', () => {
  it('scans locations once, then resets every addressed slot', async () => {
    const { calls, io } = recorder({ scan: scan([{ location: 3 }, { location: 8, isEmpty: true }]) });
    const res = await resetAmpBlocksPerPreset([3, 8], null, io);
    expect(calls.filter((c) => c.op === 'locations')).toHaveLength(1);
    expect(res.written).toEqual([3]);
    expect(calls.map((c) => c.op)).toEqual(['locations', 'select', 'ampBlocks', 'resetAmpBlock', 'store']);
  });
});

// ── module + wiring (source guards — .svelte cannot mount in this node-env vitest) ───────────────
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('resetAmpOps — reuses the batchSetOps machinery', () => {
  it('imports planBatchSet + the batch target/skipped shapes (no duplicated slot filtering)', () => {
    const src = read('./resetAmpOps.ts');
    expect(src).toMatch(/from '\.\/batchSetOps'/);
    expect(src).toContain('planBatchSet');
    expect(src).toContain('BatchSetTarget');
    expect(src).toContain('BatchSetSkipped');
    expect(src).not.toMatch(/fetch\(/);
  });

  it('documents that the served params carry no default and names the model re-select as the reset', () => {
    const src = read('./resetAmpOps.ts');
    expect(src).toMatch(/no per-parameter DEFAULT|no per-param DEFAULT|carries no default/i);
    expect(src).toMatch(/re-select/i);
  });
});
