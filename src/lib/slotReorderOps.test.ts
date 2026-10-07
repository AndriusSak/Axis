import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  planSlotReorder,
  runSlotReorder,
  reorderSlots,
  type SlotMove,
  type SlotReorderIo
} from './slotReorderOps';

// ── multi-slot reorder over the copy-by-store sequence (parity audit §2.4 remainder) ─────────────
// No slot-erase / slot-copy op exists on the FM3 wire, so a reorder is a CONTENT PERMUTATION over the
// same dump → load-into-edit-buffer → store sequence presetSlotOps.ts uses for duplicate/swap. These
// tests pin the plan (which moves are refused), the CAPTURE-ALL-FIRST order, the byte routing, and the
// abort/restore accounting against a recording mock — the device primitives are hardware-unverified
// here, but the composition and the safety rules are exact.

type Call = { op: 'dump' | 'load' | 'store' | 'select'; arg: number | Uint8Array };

function recorder(opts?: { storeFail?: number; dumpFail?: number }) {
  const calls: Call[] = [];
  const io: SlotReorderIo = {
    dump: async (n) => {
      calls.push({ op: 'dump', arg: n });
      if (opts?.dumpFail === n) throw new Error(`dump ${n} failed`);
      return { bytes: [0xf0, n, 0xf7] };
    },
    load: async (b) => { calls.push({ op: 'load', arg: b }); return { ok: true }; },
    store: async (n) => { calls.push({ op: 'store', arg: n }); return { ok: n !== opts?.storeFail }; },
    select: async (n) => { calls.push({ op: 'select', arg: n }); return { ok: true }; }
  };
  return { calls, io };
}

describe('slotReorderOps — planSlotReorder (dry run)', () => {
  it('accepts a permutation and orders the writes by destination', () => {
    const moves: SlotMove[] = [
      { from: 5, to: 6 },
      { from: 6, to: 7 },
      { from: 7, to: 5 }
    ];
    const preview = planSlotReorder(moves, 1);
    expect(preview.blocked).toBeNull();
    expect(preview.targets.map((t) => [t.from, t.to])).toEqual([
      [7, 5],
      [5, 6],
      [6, 7]
    ]);
    expect(preview.restoreTo).toBe(1);
  });

  it('accepts the 2-slot swap case (the swapSlots shape)', () => {
    const preview = planSlotReorder([{ from: 4, to: 9 }, { from: 9, to: 4 }], null);
    expect(preview.blocked).toBeNull();
    expect(preview.targets).toEqual([{ from: 9, to: 4 }, { from: 4, to: 9 }]);
  });

  it('REFUSES a move whose destination is outside the source set (would need a slot-erase op)', () => {
    const preview = planSlotReorder([{ from: 5, to: 10 }], 0);
    expect(preview.blocked).toMatch(/permutation of the same slots/);
    expect(preview.blocked).toMatch(/slot-erase/);
    expect(preview.targets).toHaveLength(0);
  });

  it('REFUSES a duplicate-into-a-fresh-slot (from-set ≠ to-set)', () => {
    const preview = planSlotReorder([{ from: 5, to: 6 }, { from: 6, to: 7 }], 0);
    expect(preview.blocked).toMatch(/permutation of the same slots/);
  });

  it('REFUSES two moves reading the same slot', () => {
    const preview = planSlotReorder([{ from: 5, to: 6 }, { from: 5, to: 7 }], 0);
    expect(preview.blocked).toMatch(/read from the same slot/);
  });

  it('REFUSES two moves writing the same slot', () => {
    const preview = planSlotReorder([{ from: 5, to: 6 }, { from: 7, to: 6 }], 0);
    expect(preview.blocked).toMatch(/write to the same slot/);
  });

  it('REFUSES an identity permutation (nothing to reorder)', () => {
    const preview = planSlotReorder([{ from: 3, to: 3 }, { from: 4, to: 4 }], 0);
    expect(preview.blocked).toMatch(/unchanged/);
  });

  it('REFUSES an empty list and non-integer / negative slots', () => {
    expect(planSlotReorder([], 0).blocked).toMatch(/no slots to reorder/);
    expect(planSlotReorder([{ from: -1, to: 3 }], 0).blocked).toMatch(/non-negative integers/);
    expect(planSlotReorder([{ from: 1.5, to: 3 }], 0).blocked).toMatch(/non-negative integers/);
  });
});

describe('slotReorderOps — runSlotReorder (capture-all-first, then write)', () => {
  it('dumps EVERY source before any store, then writes each destination from its captured bytes', async () => {
    const { calls, io } = recorder();
    const preview = planSlotReorder(
      [
        { from: 5, to: 6 },
        { from: 6, to: 7 },
        { from: 7, to: 5 }
      ],
      1
    );
    const res = await runSlotReorder(preview, io);
    expect(res.written).toEqual([
      { from: 7, to: 5 },
      { from: 5, to: 6 },
      { from: 6, to: 7 }
    ]);
    expect(res.ok).toBe(3);
    expect(res.failed).toBe(0);
    expect(res.abortedAt).toBeNull();
    expect(res.restored).toBe(true);
    // all three dumps happen BEFORE the first store
    const ops = calls.map((c) => c.op);
    expect(ops.indexOf('store')).toBeGreaterThan(ops.lastIndexOf('dump'));
    expect(ops.filter((o) => o === 'dump')).toHaveLength(3);
    // destination 5 receives slot 7's bytes, 6 receives 5's, 7 receives 6's
    const loadArgs = calls.filter((c) => c.op === 'load').map((c) => Array.from(c.arg as Uint8Array));
    expect(loadArgs).toEqual([
      [0xf0, 7, 0xf7],
      [0xf0, 5, 0xf7],
      [0xf0, 6, 0xf7]
    ]);
    expect(calls.filter((c) => c.op === 'store').map((c) => c.arg)).toEqual([5, 6, 7]);
    // origin preset re-selected last
    expect(calls[calls.length - 1]).toEqual({ op: 'select', arg: 1 });
  });

  it('swaps two slots exactly like the swapSlots sequence (dump both → load/store each)', async () => {
    const { calls, io } = recorder();
    const res = await reorderSlots([{ from: 4, to: 9 }, { from: 9, to: 4 }], null, io);
    expect(res.written).toEqual([{ from: 9, to: 4 }, { from: 4, to: 9 }]);
    expect(calls.map((c) => c.op)).toEqual(['dump', 'dump', 'load', 'store', 'load', 'store']);
    expect(calls[0].arg).toBe(9);
    expect(calls[1].arg).toBe(4);
    expect(Array.from(calls[2].arg as Uint8Array)).toEqual([0xf0, 9, 0xf7]); // 9's bytes → slot 4
    expect(calls[3].arg).toBe(4);
    expect(Array.from(calls[4].arg as Uint8Array)).toEqual([0xf0, 4, 0xf7]); // 4's bytes → slot 9
    expect(calls[5].arg).toBe(9);
  });

  it('ABORTS on the first failed store and reports exactly which moves already landed', async () => {
    const { calls, io } = recorder({ storeFail: 7 });
    const preview = planSlotReorder(
      [
        { from: 5, to: 6 },
        { from: 6, to: 7 },
        { from: 7, to: 5 }
      ],
      1
    );
    const res = await runSlotReorder(preview, io);
    // writes go 7→5, 5→6, 6→7; the store to 7 is the third and fails
    expect(res.written).toEqual([
      { from: 7, to: 5 },
      { from: 5, to: 6 }
    ]);
    expect(res.abortedAt).toEqual({ from: 6, to: 7 });
    expect(res.error).toMatch(/store to slot 7 was rejected/);
    expect(res.ok).toBe(2);
    expect(res.failed).toBe(1);
    expect(res.restored).toBe(true);
    expect(calls[calls.length - 1]).toEqual({ op: 'select', arg: 1 });
  });

  it('a failed dump aborts BEFORE any write (device untouched)', async () => {
    const { calls, io } = recorder({ dumpFail: 6 });
    const preview = planSlotReorder(
      [
        { from: 5, to: 6 },
        { from: 6, to: 7 },
        { from: 7, to: 5 }
      ],
      1
    );
    const res = await runSlotReorder(preview, io);
    expect(res.written).toEqual([]);
    expect(res.error).toMatch(/dump 6 failed/);
    expect(calls.some((c) => c.op === 'store' || c.op === 'load')).toBe(false);
    expect(res.restored).toBe(true);
  });

  it('a refused (blocked) plan performs NO device writes', async () => {
    const { calls, io } = recorder();
    const blocked = planSlotReorder([{ from: 5, to: 10 }], 0);
    const res = await runSlotReorder(blocked, io);
    expect(calls).toHaveLength(0);
    expect(res.ok).toBe(0);
    expect(res.error).toMatch(/permutation of the same slots/);
  });

  it('a failed restore does not invalidate the writes; restored stays false', async () => {
    const calls: Call[] = [];
    const io: SlotReorderIo = {
      dump: async (n) => { calls.push({ op: 'dump', arg: n }); return { bytes: [0xf0, n, 0xf7] }; },
      load: async (b) => { calls.push({ op: 'load', arg: b }); return { ok: true }; },
      store: async (n) => { calls.push({ op: 'store', arg: n }); return { ok: true }; },
      select: async (n) => { calls.push({ op: 'select', arg: n }); throw new Error(`select ${n} failed`); }
    };
    const res = await reorderSlots([{ from: 4, to: 9 }, { from: 9, to: 4 }], 0, io);
    expect(res.written).toHaveLength(2);
    expect(res.restored).toBe(false);
  });
});

// ── module + component wiring (source guards — .svelte cannot mount in this node-env vitest) ──────
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('slotReorderOps — reuses the presetSlotOps copy-by-store transport', () => {
  it('imports the SlotOpsClient the duplicate/swap sequence uses (no new wire op invented)', () => {
    const src = read('./slotReorderOps.ts');
    expect(src).toMatch(/from '\.\/presetSlotOps'/);
    expect(src).toMatch(/extends SlotOpsClient/);
    // never invents an endpoint — the only ops are dump/load/store/select
    expect(src).not.toMatch(/fetch\(/);
  });
});
