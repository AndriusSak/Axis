import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  isCrossPreset,
  planCrossPresetBlockPaste,
  crossPresetWrites,
  applyCrossPresetBlockPaste,
  type BlockClipSource,
  type ClipRouteCell,
  type CrossPresetBlockIo,
  type CrossPresetBlockPlan
} from './r19BlockClipOps';
import type { NamedParam, EnumParam } from './types';

// Cross-PRESET block paste (parity audit §2.10 remainder). The in-memory block clipboard survives a
// preset switch (it is never cleared), but the old paste addressed the SOURCE preset's effectId and
// wrote the SOURCE paramIds blindly. These tests pin the honest path: decide the target eid against
// the TARGET layout, re-read the target's served params, write only what it exposes, gate otherwise.

const knob = (id: number, name: string, norm = 0.5): NamedParam => ({ id, name, value: 0, norm });
const enumParam = (id: number, name: string, value = 1): EnumParam => ({ id, name, value, options: [] });

const cell = (row: number, col: number, effectId: number, display = 'Amp 1'): ClipRouteCell => ({
  row,
  col,
  kind: 'block',
  effectId,
  display
});
const shunt = (row: number, col: number, effectId = 1024): ClipRouteCell => ({
  row,
  col,
  kind: 'shunt',
  effectId,
  display: 'Shunt'
});

const clip = (over: Partial<BlockClipSource> = {}): BlockClipSource => ({
  blockId: 58,
  display: 'Amp 1',
  pack: 'amp',
  type: { value: 3, name: 'Plexi 100W' },
  channel: 'A',
  named: [knob(10, 'Drive', 0.4), knob(11, 'Level', 0.7)],
  enums: [enumParam(20, 'Model', 3)],
  ...over
});

/** Fake IO recording the sequence; serves canned target params. */
function fakeIo(target: { named?: NamedParam[]; enums?: EnumParam[] } = {}, opts: { failParams?: number[]; failPlace?: boolean; failParamsRead?: boolean } = {}) {
  const calls: string[] = [];
  const io: CrossPresetBlockIo = {
    async place(row, col, blockId) {
      calls.push(`place:${row}:${col}:${blockId}`);
      if (opts.failPlace) throw new Error('place rejected');
    },
    async setType(eid, value) {
      calls.push(`setType:${eid}:${value}`);
    },
    async blockParams(eid) {
      calls.push(`blockParams:${eid}`);
      if (opts.failParamsRead) throw new Error('params unavailable');
      return { named: target.named ?? [], enums: target.enums ?? [] };
    },
    async setParam(eid, paramId, value, continuous) {
      calls.push(`param:${eid}:${paramId}:${value}:${continuous}`);
      if (opts.failParams?.includes(paramId)) throw new Error('param rejected');
    }
  };
  return { io, calls };
}

describe('isCrossPreset', () => {
  it('is true only when both slot numbers are known and differ', () => {
    expect(isCrossPreset(3, 4)).toBe(true);
    expect(isCrossPreset(4, 4)).toBe(false);
    expect(isCrossPreset(null, 4)).toBe(false); // unknown source → keep the same-preset path
    expect(isCrossPreset(3, null)).toBe(false); // unknown target → same-preset path
  });
});

describe('planCrossPresetBlockPaste', () => {
  it('addresses the block already in the target cell (no placement)', () => {
    const plan = planCrossPresetBlockPaste(clip(), [cell(0, 2, 70, 'Drive 1')], [], 0, 2);
    expect(plan.ok).toBe(true);
    expect(plan.target).toEqual({ mode: 'onto-block', eid: 70, row: 0, col: 2 });
  });

  it('places into an empty cell when the source instance id is free in the target preset', () => {
    const plan = planCrossPresetBlockPaste(clip(), [cell(0, 0, 62, 'Cab 1')], [], 1, 3);
    expect(plan.ok).toBe(true);
    expect(plan.target).toEqual({ mode: 'place', eid: 58, row: 1, col: 3 });
  });

  it('treats a shunt cell as a placement (the store replaces the shunt, preserving its cables)', () => {
    const plan = planCrossPresetBlockPaste(clip(), [], [shunt(2, 4)], 2, 4);
    expect(plan.ok).toBe(true);
    expect(plan.target?.mode).toBe('place');
  });

  it('GATES when the source instance id is already placed elsewhere — with a reason naming the id + cell', () => {
    const plan = planCrossPresetBlockPaste(clip(), [cell(0, 0, 58, 'Amp 1')], [], 3, 5);
    expect(plan.ok).toBe(false);
    expect(plan.target).toBeNull();
    expect(plan.error).toContain('58');
    expect(plan.error).toContain('r1c1');
    expect(plan.error).toMatch(/roster/i); // names the missing family base
  });

  it('picks a FREE instance of the same family when the family base is known', () => {
    // base eid 58 (Amp); 58 (Amp 1) is taken, 59 (Amp 2) is free → paste places Amp 2.
    const plan = planCrossPresetBlockPaste(clip(), [cell(0, 0, 58, 'Amp 1')], [], 3, 5, 58);
    expect(plan.ok).toBe(true);
    expect(plan.target).toEqual({ mode: 'place', eid: 59, row: 3, col: 5 });
  });

  it('gates when EVERY instance of the family is already placed', () => {
    const placed = [cell(0, 0, 58, 'Amp 1'), cell(1, 0, 59, 'Amp 2'), cell(2, 0, 60, 'Amp 3'), cell(3, 0, 61, 'Amp 4')];
    const plan = planCrossPresetBlockPaste(clip(), placed, [], 1, 5, 58);
    expect(plan.ok).toBe(false);
    expect(plan.target).toBeNull();
    expect(plan.error).toMatch(/no free instance/i);
  });

  it('prefers the source instance id when it is free even if a family base is supplied', () => {
    const plan = planCrossPresetBlockPaste(clip(), [cell(0, 0, 62, 'Cab 1')], [], 2, 2, 58);
    expect(plan.target).toEqual({ mode: 'place', eid: 58, row: 2, col: 2 });
  });

  it('does not gate an onto-block paste even when that eid is elsewhere (it addresses the cell block)', () => {
    const plan = planCrossPresetBlockPaste(clip(), [cell(0, 0, 58, 'Amp 1'), cell(1, 1, 70, 'Drive 1')], [], 1, 1);
    expect(plan.ok).toBe(true);
    expect(plan.target).toEqual({ mode: 'onto-block', eid: 70, row: 1, col: 1 });
  });
});

describe('crossPresetWrites', () => {
  it('writes only ids the target block exposes and counts the rest as dropped', () => {
    const { writes, dropped } = crossPresetWrites(clip(), [knob(10, 'Drive')], []);
    expect(writes).toEqual([{ paramId: 10, value: 0.4, continuous: true, name: 'Drive' }]);
    expect(dropped).toBe(2); // Level + Model not exposed
  });

  it('reuses the channel-paste semantics (knobs continuous norm, enums discrete ordinal)', () => {
    const { writes, dropped } = crossPresetWrites(clip(), [knob(10, 'Drive'), knob(11, 'Level')], [enumParam(20, 'Model')]);
    expect(writes.map((w) => [w.paramId, w.continuous])).toEqual([
      [10, true],
      [11, true],
      [20, false]
    ]);
    expect(dropped).toBe(0);
  });
});

describe('applyCrossPresetBlockPaste', () => {
  it('place mode: place → setType → RE-READ the target params → write only what it exposes', async () => {
    const { io, calls } = fakeIo({ named: [knob(10, 'Drive')], enums: [] });
    const plan = planCrossPresetBlockPaste(clip(), [], [], 1, 2);
    const report = await applyCrossPresetBlockPaste(plan, clip(), io);
    expect(report.ok).toBe(true);
    expect(report.placed).toBe(true);
    expect(report.eid).toBe(58);
    expect(report.written).toBe(1);
    expect(report.dropped).toBe(2);
    expect(calls).toEqual(['place:1:2:58', 'setType:58:3', 'blockParams:58', 'param:58:10:0.4:true']);
  });

  it('onto-block mode: does NOT place — it retypes then writes onto the existing block', async () => {
    const { io, calls } = fakeIo({ named: [knob(10, 'Drive'), knob(11, 'Level')], enums: [enumParam(20, 'Model')] });
    const plan = planCrossPresetBlockPaste(clip(), [cell(0, 1, 70, 'Drive 1')], [], 0, 1);
    const report = await applyCrossPresetBlockPaste(plan, clip(), io);
    expect(report.placed).toBe(false);
    expect(report.eid).toBe(70);
    expect(report.written).toBe(3);
    expect(report.dropped).toBe(0);
    expect(calls).toEqual([
      'setType:70:3',
      'blockParams:70',
      'param:70:10:0.4:true',
      'param:70:11:0.7:true',
      'param:70:20:3:false'
    ]);
  });

  it('a refused plan issues NO device write and reports the gate reason', async () => {
    const { io, calls } = fakeIo();
    const plan = planCrossPresetBlockPaste(clip(), [cell(0, 0, 58, 'Amp 1')], [], 3, 5);
    const report = await applyCrossPresetBlockPaste(plan, clip(), io);
    expect(report.ok).toBe(false);
    expect(report.error).toContain('58');
    expect(report.eid).toBeNull();
    expect(calls).toEqual([]);
  });

  it('aborts (no param writes) when the target params cannot be read', async () => {
    const { io, calls } = fakeIo({}, { failParamsRead: true });
    const plan = planCrossPresetBlockPaste(clip(), [], [], 1, 2);
    const report = await applyCrossPresetBlockPaste(plan, clip(), io);
    expect(report.ok).toBe(false);
    expect(report.error).toContain('params unavailable');
    expect(report.written).toBe(0);
    expect(calls).toEqual(['place:1:2:58', 'setType:58:3', 'blockParams:58']);
  });

  it('counts a per-param rejection, never fatal — the other values still write', async () => {
    const { io } = fakeIo({ named: [knob(10, 'Drive'), knob(11, 'Level')], enums: [enumParam(20, 'Model')] }, { failParams: [11] });
    const plan = planCrossPresetBlockPaste(clip(), [], [], 1, 2);
    const report = await applyCrossPresetBlockPaste(plan, clip(), io);
    expect(report.ok).toBe(true);
    expect(report.written).toBe(2);
    expect(report.failed).toBe(1);
    expect(report.failures[0]).toMatchObject({ paramId: 11, name: 'Level' });
  });

  it('never writes a dropped id', async () => {
    const { io, calls } = fakeIo({ named: [knob(10, 'Drive')], enums: [] });
    const plan = planCrossPresetBlockPaste(clip(), [], [], 1, 2);
    await applyCrossPresetBlockPaste(plan, clip(), io);
    expect(calls.some((c) => c.startsWith('param:58:11'))).toBe(false);
    expect(calls.some((c) => c.startsWith('param:58:20'))).toBe(false);
  });
});

// ── source guard: editor.svelte.ts cannot be imported here (runes), so pin its wiring by source. ──
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('cross-preset block paste wiring (source guard)', () => {
  const editor = read('./editor.svelte.ts');
  const surface = read('./editorSurface.ts');

  it('the block clipboard records the slot it was copied from', () => {
    expect(editor).toMatch(/preset\??:\s*number \| null/);
    expect(editor).toMatch(/blockClipboard\s*=\s*\{/);
    expect(editor).toMatch(/preset:\s*this\.preset\?\.number/);
  });

  it('pasteBlock routes a cross-preset clip through the honest planner + IO', () => {
    expect(editor).toMatch(/isCrossPreset\(/);
    expect(editor).toMatch(/planCrossPresetBlockPaste\(/);
    expect(editor).toMatch(/applyCrossPresetBlockPaste\(/);
    expect(editor).toMatch(/forgefx\.blockParams\(/); // re-reads the TARGET preset's served params
  });

  it('picks a free family instance from the served block roster (never guesses an eid)', () => {
    expect(editor).toMatch(/familyBaseFor\(/);
    expect(editor).toMatch(/forgefx\.blocks\(\)/); // the served roster (GET /blocks)
  });

  it('the pasteBlock signature is unchanged (surface contract preserved)', () => {
    expect(surface).toMatch(/pasteBlock: \(row: number, col: number\) => Promise<void>/);
  });
});
