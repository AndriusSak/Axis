import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  captureParamValue,
  planParamPaste,
  applyParamPaste,
  type ParamValueClip,
  type ParamPasteIo
} from './paramClipOps';
import type { NamedParam, EnumParam } from './types';

// Parameter-VALUE clipboard (parity audit §2.11 remainder). Pure planner + injectable IO so the one
// device write is provable with a mock and no hardware. The clipboard key is the DEVICE paramId; a
// paramId the target block does not expose is dropped, never guessed.

const knob = (id: number, name: string, norm = 0.5): NamedParam => ({ id, name, value: 0, norm });
const enumParam = (id: number, name: string, value = 2): EnumParam => ({
  id,
  name,
  value,
  options: [
    { value: 0, label: 'A' },
    { value: 1, label: 'B' },
    { value: 2, label: 'C' }
  ]
});

/** Fake IO that records the writes it was asked to perform. */
function fakeIo(opts: { failParams?: number[] } = {}) {
  const calls: string[] = [];
  const io: ParamPasteIo = {
    async setParam(effectId, paramId, value, continuous) {
      calls.push(`param:${effectId}:${paramId}:${value}:${continuous}`);
      if (opts.failParams?.includes(paramId)) throw new Error('param rejected');
    }
  };
  return { io, calls };
}

describe('captureParamValue', () => {
  it('snapshots a knob by its normalized value', () => {
    const clip = captureParamValue(knob(10, 'Drive', 0.42), 'Amp 1', true);
    expect(clip).toEqual({ paramId: 10, name: 'Drive', value: 0.42, continuous: true, block: 'Amp 1' });
  });

  it('snapshots an enum by its ordinal', () => {
    const clip = captureParamValue(enumParam(20, 'Model', 3), 'Amp 1', false);
    expect(clip).toEqual({ paramId: 20, name: 'Model', value: 3, continuous: false, block: 'Amp 1' });
  });

  it('never captures an unresolved value as 0 (missing/null norm → null clip)', () => {
    // The old behaviour folded a missing norm to a fabricated 0. An unresolved value must yield no clip.
    expect(captureParamValue({ id: 5, name: 'Q', value: 3 }, 'X', true)).toBeNull(); // no norm
    expect(captureParamValue({ id: 5, name: 'Q', value: null, norm: null }, 'X', true)).toBeNull();
    expect(captureParamValue({ id: 5, name: 'Q', value: null }, 'X', false)).toBeNull(); // enum ordinal unknown
  });

  it('returns null for a param with no device paramId (cannot be written back — never guessed)', () => {
    expect(captureParamValue({ name: 'Unkeyed', value: 1 }, 'X', true)).toBeNull();
  });
});

describe('planParamPaste', () => {
  const clip = (over: Partial<ParamValueClip> = {}): ParamValueClip => ({
    paramId: 10,
    name: 'Drive',
    value: 0.42,
    continuous: true,
    block: 'Amp 1',
    ...over
  });

  it('matches a continuous clip to a target knob by paramId', () => {
    const plan = planParamPaste(clip(), [knob(10, 'Drive')], []);
    expect(plan.dropped).toBe(false);
    expect(plan.write).toEqual({ paramId: 10, value: 0.42, continuous: true, name: 'Drive' });
  });

  it('matches a discrete clip to a target enum by paramId', () => {
    const plan = planParamPaste(clip({ paramId: 20, name: 'Model', value: 3, continuous: false }), [], [enumParam(20, 'Model')]);
    expect(plan.dropped).toBe(false);
    expect(plan.write).toEqual({ paramId: 20, value: 3, continuous: false, name: 'Model' });
  });

  it('drops an id the target block does not expose, with a precise reason (never guessed)', () => {
    const plan = planParamPaste(clip({ paramId: 999, name: 'Phantom' }), [knob(10, 'Drive')], [enumParam(20, 'Model')]);
    expect(plan.write).toBeNull();
    expect(plan.dropped).toBe(true);
    expect(plan.reason).toContain('Phantom');
    expect(plan.reason).toContain('999');
  });

  it('drops a KIND mismatch: a knob norm is never written to a discrete param of the same id', () => {
    // same paramId, but the target only serves it as an enum → writing the 0..1 norm as an ordinal
    // would be wrong, so it is dropped rather than coerced.
    const plan = planParamPaste(clip({ paramId: 20, value: 0.42, continuous: true }), [], [enumParam(20, 'Mode')]);
    expect(plan.write).toBeNull();
    expect(plan.dropped).toBe(true);
  });

  it('drops a discrete clip when the target serves that id only as a knob', () => {
    const plan = planParamPaste(clip({ paramId: 10, value: 3, continuous: false }), [knob(10, 'Level')], []);
    expect(plan.write).toBeNull();
    expect(plan.dropped).toBe(true);
  });
});

describe('applyParamPaste', () => {
  it('writes the matched value through the per-block param PUT (continuous flag sent explicitly)', async () => {
    const { io, calls } = fakeIo();
    const plan = planParamPaste({ paramId: 10, name: 'Drive', value: 0.42, continuous: true, block: 'Amp 1' }, [knob(10, 'Drive')], []);
    const report = await applyParamPaste(plan, 58, io);
    expect(report.ok).toBe(true);
    expect(calls).toEqual(['param:58:10:0.42:true']);
  });

  it('issues NO device write for a dropped plan and returns the reason', async () => {
    const { io, calls } = fakeIo();
    const plan = planParamPaste({ paramId: 999, name: 'Phantom', value: 0.5, continuous: true, block: 'Amp 1' }, [knob(10, 'Drive')], []);
    const report = await applyParamPaste(plan, 58, io);
    expect(report.ok).toBe(false);
    expect(report.dropped).toBe(true);
    expect(report.reason).toContain('Phantom');
    expect(calls).toEqual([]);
  });

  it('reports the device error when the write is rejected', async () => {
    const { io } = fakeIo({ failParams: [10] });
    const plan = planParamPaste({ paramId: 10, name: 'Drive', value: 0.42, continuous: true, block: 'Amp 1' }, [knob(10, 'Drive')], []);
    const report = await applyParamPaste(plan, 58, io);
    expect(report.ok).toBe(false);
    expect(report.error).toContain('rejected');
  });
});

// ── source guard: ControlSurface.svelte cannot be mounted here, so pin its wiring by source. ──
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('parameter-value clipboard wiring (source guard)', () => {
  const editor = read('./editor.svelte.ts');
  const surface = read('./editorSurface.ts');
  const convert = read('./convertEditor.svelte.ts');
  const control = read('./ControlSurface.svelte');

  it('the editor store owns the clipboard + the copy/paste actions', () => {
    expect(editor).toMatch(/paramClip\s*=\s*\$state<ParamValueClip/);
    expect(editor).toMatch(/copyParamValue\s*=/);
    expect(editor).toMatch(/pasteParamValue\s*=/);
    expect(editor).toMatch(/planParamPaste\(/); // reuse the pure planner
    expect(editor).toMatch(/captureParamValue\(/);
  });

  it('the editor surface declares the members a .svelte component reads', () => {
    expect(surface).toMatch(/paramClip: ParamValueClip \| null/);
    expect(surface).toMatch(/copyParamValue:/);
    expect(surface).toMatch(/pasteParamValue:/);
  });

  it('the offline convert surface satisfies them (inert)', () => {
    expect(convert).toMatch(/paramClip = null/);
    expect(convert).toMatch(/copyParamValue = /);
    expect(convert).toMatch(/pasteParamValue = /);
  });

  it('is surfaced from the EXISTING control context menu (no new footer button)', () => {
    expect(control).toMatch(/buildParamValueMenuItems\(/);
    expect(control).toMatch(/editor\.copyParamValue\(/);
    expect(control).toMatch(/editor\.pasteParamValue\(/);
    // the BlockEditor footer must NOT grow a 13th button for this
    expect(read('./BlockEditor.svelte')).not.toMatch(/copyParamValue|pasteParamValue/);
  });
});
