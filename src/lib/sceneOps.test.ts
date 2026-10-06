import { describe, it, expect } from 'vitest';
import {
  applySceneTo,
  applySceneWrites,
  bulkBypass,
  captureScene,
  copyScene,
  planBulkBypass,
  planSceneApply,
  scanSceneMatrix,
  sceneCards,
  swapScenes,
  type SceneIo,
  type SceneStateBlock
} from './sceneOps';

// Parity audit §2.1 — the Scene Manager. There is no wire op for scene copy/swap, so every operation
// is a client-side sequence over the EXISTING endpoints: POST /scene (switch), GET /preset/scene-state
// (read active scene), POST /preset/blocks/:eid/bypass + /channel (write). On Fractal hardware a scene
// IS a per-block bypass+channel map, so that sequence is a faithful copy/swap. These tests pin the
// planning (which writes, to which blocks) and the sequencing (which endpoints, in what order).

/** A fake SceneIo that records the call order and serves canned per-scene states. */
function fakeIo(states: Record<number, SceneStateBlock[]>, opts: { failChannel?: number[]; failSceneState?: number[] } = {}) {
  const calls: string[] = [];
  let active = 0;
  const io: SceneIo = {
    async setScene(index) {
      active = index;
      calls.push(`setScene:${index}`);
    },
    async sceneState() {
      calls.push(`sceneState:${active}`);
      if (opts.failSceneState?.includes(active)) throw new Error('scene-state read failed');
      return states[active] ?? [];
    },
    async setBypass(effectId, bypassed) {
      calls.push(`bypass:${effectId}:${bypassed}`);
    },
    async setChannel(effectId, channel) {
      calls.push(`channel:${effectId}:${channel}`);
      if (opts.failChannel?.includes(effectId)) throw new Error('501 channel unsupported');
    }
  };
  return { io, calls, active: () => active };
}

const b = (effectId: number, bypassed: boolean | null, channel: string | null = null): SceneStateBlock => ({
  effectId,
  bypassed,
  channel
});

describe('sceneCards', () => {
  it('renders one card per scene, numbered from 1, falling back to "Scene N" when unnamed', () => {
    expect(sceneCards(8, ['Clean', '', 'Lead'])).toEqual([
      { index: 0, number: 1, label: 'Clean', named: true },
      { index: 1, number: 2, label: 'Scene 2', named: false },
      { index: 2, number: 3, label: 'Lead', named: true },
      { index: 3, number: 4, label: 'Scene 4', named: false },
      { index: 4, number: 5, label: 'Scene 5', named: false },
      { index: 5, number: 6, label: 'Scene 6', named: false },
      { index: 6, number: 7, label: 'Scene 7', named: false },
      { index: 7, number: 8, label: 'Scene 8', named: false }
    ]);
  });

  it('is complete — never truncates the scene count (list-cap rule, audit §5.1)', () => {
    expect(sceneCards(8, []).length).toBe(8);
    expect(sceneCards(8, ['a']).length).toBe(8);
  });
});

describe('planSceneApply', () => {
  it('writes only the fields that differ, and only for blocks present in the target', () => {
    const source = [b(1, false, 'A'), b(2, true, 'B'), b(9, false)];
    const target = [b(1, true, 'A'), b(2, false, 'A')]; // block 9 does not exist in target
    expect(planSceneApply(source, target)).toEqual([
      { effectId: 1, bypassed: false },
      { effectId: 2, bypassed: true, channel: 'B' }
    ]);
  });

  it('never writes a null/unknown source field (a failed read must not blank the target)', () => {
    expect(planSceneApply([b(1, null, null)], [b(1, true, 'A')])).toEqual([]);
    expect(planSceneApply([b(1, null, 'C')], [b(1, true, 'A')])).toEqual([{ effectId: 1, channel: 'C' }]);
  });

  it('produces no writes when source and target already match', () => {
    expect(planSceneApply([b(1, false, 'A')], [b(1, false, 'A')])).toEqual([]);
  });
});

describe('planBulkBypass', () => {
  it('engage-all only writes blocks that are currently bypassed (skips already-engaged)', () => {
    const states = [b(1, true), b(2, false), b(3, null)];
    expect(planBulkBypass(states, false)).toEqual([
      { effectId: 1, bypassed: false },
      { effectId: 3, bypassed: false } // unknown counts as needing a write
    ]);
  });

  it('bypass-all writes every block not already bypassed', () => {
    expect(planBulkBypass([b(1, true), b(2, false)], true)).toEqual([{ effectId: 2, bypassed: true }]);
  });
});

describe('applySceneWrites', () => {
  it('tolerates a per-block failure (e.g. channel 501) without aborting the rest', async () => {
    const { io, calls } = fakeIo({}, { failChannel: [2] });
    const res = await applySceneWrites([{ effectId: 1, bypassed: true }, { effectId: 2, channel: 'B' }, { effectId: 3, bypassed: false }], io);
    expect(res).toEqual({ ok: 2, failed: 1 });
    expect(calls).toEqual(['bypass:1:true', 'channel:2:B', 'bypass:3:false']);
  });
});

describe('copyScene', () => {
  it('captures the source scene then applies it onto the target (read source → switch target → write)', async () => {
    const { io, calls } = fakeIo({
      0: [b(1, false, 'A'), b(2, true, 'B')],
      3: [b(1, true, 'A'), b(2, false, 'A')]
    });
    const res = await copyScene(0, 3, io);
    expect(res).toEqual({ ok: 2, failed: 0 });
    expect(calls).toEqual([
      'setScene:0',
      'sceneState:0',
      'setScene:3',
      'sceneState:3',
      'bypass:1:false',
      'bypass:2:true',
      'channel:2:B'
    ]);
  });

  it('is a no-op when source and target are the same scene', async () => {
    const { io, calls } = fakeIo({ 0: [b(1, true)] });
    expect(await copyScene(0, 0, io)).toEqual({ ok: 0, failed: 0 });
    expect(calls).toEqual([]);
  });
});

describe('swapScenes', () => {
  it('captures both scenes, then writes each captured state onto the other', async () => {
    const { io, calls } = fakeIo({
      0: [b(1, false, 'A')],
      1: [b(1, true, 'B')]
    });
    const res = await swapScenes(0, 1, io);
    expect(res).toEqual({ ok: 2, failed: 0 });
    expect(calls).toEqual([
      'setScene:0',
      'sceneState:0',
      'setScene:1',
      'sceneState:1',
      'setScene:1',
      'sceneState:1',
      'bypass:1:false',
      'channel:1:A',
      'setScene:0',
      'sceneState:0',
      'bypass:1:true',
      'channel:1:B'
    ]);
  });
});

describe('bulkBypass', () => {
  it('switches to the scene, reads it, then engages/bypasses every block', async () => {
    const { io, calls } = fakeIo({ 2: [b(1, true), b(2, false)] });
    const res = await bulkBypass(2, false, io);
    expect(res).toEqual({ ok: 1, failed: 0 });
    expect(calls).toEqual(['setScene:2', 'sceneState:2', 'bypass:1:false']);
  });
});

describe('scanSceneMatrix', () => {
  it('walks every scene in order and collects its per-block state', async () => {
    const { io, calls } = fakeIo({ 0: [b(1, false)], 1: [b(1, true)], 2: [b(1, false)] });
    const matrix = await scanSceneMatrix(3, io);
    expect(matrix).toEqual({ 0: [b(1, false)], 1: [b(1, true)], 2: [b(1, false)] });
    expect(calls).toEqual(['setScene:0', 'sceneState:0', 'setScene:1', 'sceneState:1', 'setScene:2', 'sceneState:2']);
  });

  it('records an empty list for a scene whose read failed rather than dropping it', async () => {
    const { io } = fakeIo({ 0: [b(1, false)], 1: [b(1, true)] }, { failSceneState: [1] });
    expect(await scanSceneMatrix(2, io)).toEqual({ 0: [b(1, false)], 1: [] });
  });
});

describe('captureScene / applySceneTo', () => {
  it('applySceneTo writes all source blocks when the target read fails (best effort, no diffing)', async () => {
    const { io, calls } = fakeIo({ 5: [] }, { failSceneState: [5] });
    const res = await applySceneTo(5, [b(1, false, 'A'), b(2, false, null)], io);
    expect(res).toEqual({ ok: 2, failed: 0 });
    expect(calls).toEqual(['setScene:5', 'sceneState:5', 'bypass:1:false', 'channel:1:A', 'bypass:2:false']);
  });

  it('captureScene switches then reads', async () => {
    const { io, calls } = fakeIo({ 4: [b(7, true)] });
    expect(await captureScene(4, io)).toEqual([b(7, true)]);
    expect(calls).toEqual(['setScene:4', 'sceneState:4']);
  });
});
