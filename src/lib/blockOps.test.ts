import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  captureChannel,
  pasteChannelWrites,
  sceneIgnoreParam,
  sceneIgnoreValue,
  blockResettable
} from './blockOps';
import type { NamedParam, EnumParam } from './types';

// Channel/block operations (copy/paste/reset) live in a pure module because this repo's vitest runs
// in a node environment and cannot mount .svelte components. The BlockEditor footer wires these; a
// source-guard below pins that wiring.

const params = (): NamedParam[] => [
  { id: 1, name: 'Level', value: -6, norm: 0.7, unit: 'db', min: -80, max: 20 },
  { id: 2, name: 'Drive', value: 5, norm: 0.4 },
  { name: 'Unkeyed', value: 1 } // no id → not writable
];

const enums = (): EnumParam[] => [
  { id: 3, name: 'Mode', value: 2, options: [{ value: 0, label: 'A' }, { value: 1, label: 'B' }, { value: 2, label: 'C' }] },
  { id: 84, name: 'Scene Ignore', value: 0, options: [{ value: 0, label: 'Off' }, { value: 1, label: 'On' }] }
];

describe('captureChannel', () => {
  it('snapshots knobs by norm and enums by ordinal, keyed by device paramId', () => {
    const clip = captureChannel('Amp 1', 'A', params(), enums());
    expect(clip.block).toBe('Amp 1');
    expect(clip.channel).toBe('A');
    expect(clip.knobs).toEqual([
      { id: 1, name: 'Level', norm: 0.7 },
      { id: 2, name: 'Drive', norm: 0.4 }
    ]);
    expect(clip.enums).toEqual([
      { id: 3, name: 'Mode', value: 2 },
      { id: 84, name: 'Scene Ignore', value: 0 }
    ]);
  });

  it('skips params without a device paramId (they cannot be written back)', () => {
    const clip = captureChannel('Amp 1', null, params(), []);
    expect(clip.knobs.map((k) => k.id)).toEqual([1, 2]);
    expect(clip.knobs.some((k) => k.id === 9)).toBe(false);
  });

  it('never captures an unresolved value as 0 (a param with no served norm is dropped)', () => {
    // The old behaviour folded a missing norm to a fabricated 0. A param the device could not resolve
    // (null/absent norm — a GLOBAL pid the body does not carry) must be SKIPPED, not stored as 0.
    const clip = captureChannel('X', 'B', [{ id: 5, name: 'Q', value: null, norm: null }], []);
    expect(clip.knobs).toEqual([]);
    const clip2 = captureChannel('X', 'B', [{ id: 5, name: 'Q', value: 3 }], []);
    expect(clip2.knobs).toEqual([]); // no norm at all → unresolved → dropped
  });
});

describe('pasteChannelWrites', () => {
  it('maps a clip onto the target block by paramId — knobs continuous, enums discrete', () => {
    const clip = captureChannel('Amp 1', 'A', params(), enums());
    const writes = pasteChannelWrites(clip, params(), enums());
    expect(writes).toEqual([
      { paramId: 1, value: 0.7, continuous: true, name: 'Level' },
      { paramId: 2, value: 0.4, continuous: true, name: 'Drive' },
      { paramId: 3, value: 2, continuous: false, name: 'Mode' },
      { paramId: 84, value: 0, continuous: false, name: 'Scene Ignore' }
    ]);
  });

  it('drops ids the target block does not expose (cross-family paste)', () => {
    const clip = captureChannel('Amp 1', 'A', params(), enums());
    const target: NamedParam[] = [{ id: 1, name: 'Level', value: 0, norm: 0.5 }];
    const writes = pasteChannelWrites(clip, target, []);
    expect(writes.map((w) => w.paramId)).toEqual([1]);
  });

  it('returns no writes when nothing matches', () => {
    const clip = captureChannel('Amp 1', 'A', params(), enums());
    expect(pasteChannelWrites(clip, [{ id: 500, name: 'Z', value: 0 }], [])).toEqual([]);
  });
});

describe('sceneIgnoreParam', () => {
  it('finds the served "Scene Ignore" enum', () => {
    expect(sceneIgnoreParam(enums())?.id).toBe(84);
  });
  it('is case/space tolerant and returns null when absent', () => {
    expect(sceneIgnoreParam([{ id: 7, name: 'scene  ignore', value: 1, options: [] }])?.id).toBe(7);
    expect(sceneIgnoreParam([{ id: 1, name: 'Mode', value: 0, options: [] }])).toBeNull();
  });
});

describe('sceneIgnoreValue', () => {
  it('resolves On/Off to the served ordinal', () => {
    const e = enums()[1];
    expect(sceneIgnoreValue(e, true)).toBe(1);
    expect(sceneIgnoreValue(e, false)).toBe(0);
  });
  it('falls back to a 0/1 ordinal when the options do not resolve', () => {
    expect(sceneIgnoreValue({ id: 1, name: 'Scene Ignore', value: 0, options: [] }, true)).toBe(1);
    expect(sceneIgnoreValue({ id: 1, name: 'Scene Ignore', value: 1, options: [] }, false)).toBe(0);
  });
});

describe('blockResettable', () => {
  it('is true when the block exposes a model/type selector', () => {
    expect(blockResettable({ value: 2, name: 'Plexi 100W' })).toBe(true);
  });
  it('is false when the block has no model (no reselect-to-default path)', () => {
    expect(blockResettable(null)).toBe(false);
  });
});

// ── source guard: BlockEditor.svelte cannot be mounted here, so pin its wiring by source. ──
const readBlockEditor = () =>
  readFileSync(fileURLToPath(new URL('./BlockEditor.svelte', import.meta.url)), 'utf8');

describe('BlockEditor footer wiring (source guard)', () => {
  const src = readBlockEditor();

  it('no longer ships the dead "coming soon" Mute / Scene Ignore stubs', () => {
    expect(src).not.toMatch(/Mute — coming soon/);
    expect(src).not.toMatch(/Scene Ignore — coming soon/);
  });

  it('wires the real channel + block operations', () => {
    expect(src).toMatch(/editor\.copyChannel\(\)/);
    expect(src).toMatch(/editor\.pasteChannel\(\)/);
    expect(src).toMatch(/editor\.resetChannel\(\)/);
    expect(src).toMatch(/editor\.resetBlock\(\)/);
  });

  it('wires a real Scene Ignore toggle off the served enum', () => {
    expect(src).toMatch(/sceneIgnoreParam\(/);
    expect(src).toMatch(/editor\.setSceneIgnore\(/);
  });

  it('keeps Mute an honest, clearly-scoped disabled control (no served backing param)', () => {
    // The button must be disabled AND explain WHY in a tooltip — not a fake "coming soon" toast.
    expect(src).toMatch(/disabled/);
    expect(src).toMatch(/No FM3 per-block Mute parameter/i);
  });
});
