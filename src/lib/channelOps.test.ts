import { describe, it, expect } from 'vitest';
import {
  applySetChannelAcrossScenes,
  applyCopyChannelAcrossBlocks,
  planSetChannelAcrossScenes,
  planCopyChannelAcrossBlocks,
  type ChannelSceneIo,
  type ChannelBlockCopyIo
} from './channelOps';
import type { ChannelClip } from './blockOps';
import type { NamedParam, EnumParam } from './types';

// Parity audit §2.10 (remainder) — channel operations that span scenes and blocks.
//
// There is NO dedicated wire op for either. Both are client-side sequences over the SAME endpoints
// the Scene Manager uses (POST /scene, POST /preset/blocks/:eid/channel) plus the per-block param PUT
// (PUT /preset/blocks/:eid/params/:paramId) — no new server route. The pure planners + injectable IO
// here make them fully unit-testable with a mock and no hardware.

/** Fake SceneIo for the across-scenes run: records call order, serves canned per-scene state. */
function fakeSceneIo(opts: { failScene?: number[]; failChannel?: number[]; failRestore?: boolean } = {}) {
  const calls: string[] = [];
  let active = 0;
  const io: ChannelSceneIo = {
    async setScene(index) {
      calls.push(`setScene:${index}`);
      if (opts.failScene?.includes(index)) throw new Error('scene switch failed');
      if (opts.failRestore && index === 0) throw new Error('restore failed');
      active = index;
    },
    async setChannel(effectId, channel) {
      calls.push(`channel:${active}:${effectId}:${channel}`);
      if (opts.failChannel?.includes(active)) throw new Error('501 channel unsupported');
    }
  };
  return { io, calls, active: () => active };
}

function fakeBlockIo(opts: { failParams?: number[] } = {}) {
  const calls: string[] = [];
  const io: ChannelBlockCopyIo = {
    async setParam(effectId, paramId, value, continuous) {
      calls.push(`param:${effectId}:${paramId}:${value}:${continuous}`);
      if (opts.failParams?.includes(paramId)) throw new Error('param rejected');
    }
  };
  return { io, calls };
}

const clip = (over: Partial<ChannelClip> = {}): ChannelClip => ({
  block: 'Amp 1',
  channel: 'A',
  knobs: [{ id: 10, name: 'Drive', norm: 0.5 }],
  enums: [{ id: 20, name: 'Model', value: 3 }],
  ...over
});

const knob = (id: number, name: string): NamedParam => ({ id, name, value: 0, norm: 0.5 });
const enumParam = (id: number, name: string): EnumParam => ({ id, name, value: 0, options: [] });

// ── (a) set the open block's channel across all scenes ──────────────────────────────────────────

describe('planSetChannelAcrossScenes', () => {
  it('enumerates every scene 0..count-1 with the same effectId + channel (1-based scenes → 0-based)', () => {
    expect(planSetChannelAcrossScenes(42, 'C', 4)).toEqual([
      { scene: 0, effectId: 42, channel: 'C' },
      { scene: 1, effectId: 42, channel: 'C' },
      { scene: 2, effectId: 42, channel: 'C' },
      { scene: 3, effectId: 42, channel: 'C' }
    ]);
  });

  it('is empty for a blank channel, a non-finite eid, or a zero/negative scene count', () => {
    expect(planSetChannelAcrossScenes(42, '', 4)).toEqual([]);
    expect(planSetChannelAcrossScenes(42, 'C', 0)).toEqual([]);
    expect(planSetChannelAcrossScenes(42, 'C', -3)).toEqual([]);
    expect(planSetChannelAcrossScenes(Number.NaN, 'C', 3)).toEqual([]);
  });

  it('floors a fractional scene count (never plans a phantom scene)', () => {
    expect(planSetChannelAcrossScenes(1, 'B', 2.9).map((s) => s.scene)).toEqual([0, 1]);
  });
});

describe('applySetChannelAcrossScenes', () => {
  it('switches to and writes every scene, then restores the origin scene last', async () => {
    const { io, calls, active } = fakeSceneIo();
    const plan = planSetChannelAcrossScenes(7, 'B', 3);
    const report = await applySetChannelAcrossScenes(plan, io, 2);
    expect(report).toEqual({ written: [0, 1, 2], failed: [], failures: [], origin: 2, restoreOk: true });
    expect(calls).toEqual(['setScene:0', 'channel:0:7:B', 'setScene:1', 'channel:1:7:B', 'setScene:2', 'channel:2:7:B', 'setScene:2']);
    expect(active()).toBe(2); // never leaves the device on an unexpected scene
  });

  it('a per-scene channel failure (e.g. 501) is counted, not fatal — the rest still apply', async () => {
    const { io, calls } = fakeSceneIo({ failChannel: [1] });
    const report = await applySetChannelAcrossScenes(planSetChannelAcrossScenes(7, 'B', 3), io, 0);
    expect(report.written).toEqual([0, 2]);
    expect(report.failed).toEqual([1]);
    expect(report.failures).toEqual([{ scene: 1, stage: 'channel', message: '501 channel unsupported' }]);
    expect(report.restoreOk).toBe(true);
    expect(calls).toEqual(['setScene:0', 'channel:0:7:B', 'setScene:1', 'channel:1:7:B', 'setScene:2', 'channel:2:7:B', 'setScene:0']);
  });

  it('never writes the channel when the scene SWITCH failed (would hit the wrong scene)', async () => {
    const { io, calls } = fakeSceneIo({ failScene: [1] });
    const report = await applySetChannelAcrossScenes(planSetChannelAcrossScenes(7, 'B', 3), io, 0);
    expect(report.written).toEqual([0, 2]);
    expect(report.failed).toEqual([1]);
    expect(report.failures).toEqual([{ scene: 1, stage: 'scene', message: 'scene switch failed' }]);
    expect(calls).not.toContain('channel:1:7:B');
    expect(calls).toEqual(['setScene:0', 'channel:0:7:B', 'setScene:1', 'setScene:2', 'channel:2:7:B', 'setScene:0']);
  });

  it('reports restoreOk:false when the device cannot be returned to the origin scene', async () => {
    const { io } = fakeSceneIo({ failRestore: true });
    const report = await applySetChannelAcrossScenes(planSetChannelAcrossScenes(7, 'B', 2), io, 0);
    expect(report.restoreOk).toBe(false);
    expect(report.failures.some((f) => f.scene === 0 && f.stage === 'scene')).toBe(true);
  });

  it('makes no device call at all for an empty plan (nothing to switch, nothing to restore)', async () => {
    const { io, calls } = fakeSceneIo();
    const report = await applySetChannelAcrossScenes([], io, 3);
    expect(report).toEqual({ written: [], failed: [], failures: [], origin: 3, restoreOk: true });
    expect(calls).toEqual([]);
  });
});

// ── (b) copy one block's channel onto a DIFFERENT block's channel ──────────────────────────────

describe('planCopyChannelAcrossBlocks', () => {
  it('reuses pasteChannelWrites and reports how many captured values the target cannot take', () => {
    const plan = planCopyChannelAcrossBlocks(clip(), 1, 2, 'D', [knob(10, 'Drive'), knob(11, 'Bass')], [enumParam(20, 'Model')]);
    expect(plan.sameBlock).toBe(false);
    expect(plan.targetEffectId).toBe(2);
    expect(plan.targetChannel).toBe('D');
    expect(plan.dropped).toBe(0);
    expect(plan.writes).toEqual([
      { paramId: 10, value: 0.5, continuous: true, name: 'Drive' },
      { paramId: 20, value: 3, continuous: false, name: 'Model' }
    ]);
  });

  it('drops ids the target block does not expose (cross-family paste) and counts them', () => {
    const plan = planCopyChannelAcrossBlocks(clip(), 1, 2, null, [knob(10, 'Drive')], []);
    expect(plan.writes).toEqual([{ paramId: 10, value: 0.5, continuous: true, name: 'Drive' }]);
    expect(plan.dropped).toBe(1); // the enum id 20 is not exposed by the target
  });

  it('refuses a same-block target with an empty plan (copy across blocks needs a different block)', () => {
    const plan = planCopyChannelAcrossBlocks(clip(), 5, 5, 'A', [knob(10, 'Drive')], [enumParam(20, 'Model')]);
    expect(plan.sameBlock).toBe(true);
    expect(plan.writes).toEqual([]);
    expect(plan.dropped).toBe(0);
  });
});

describe('applyCopyChannelAcrossBlocks', () => {
  it('writes every planned value through the per-block PUT, knobs (norm) before enums (ordinal)', async () => {
    const { io, calls } = fakeBlockIo();
    const plan = planCopyChannelAcrossBlocks(clip(), 1, 2, 'D', [knob(10, 'Drive'), knob(11, 'Bass')], [enumParam(20, 'Model')]);
    const report = await applyCopyChannelAcrossBlocks(plan, io);
    expect(report).toEqual({ ok: 2, failed: 0, dropped: 0, failures: [] });
    expect(calls).toEqual(['param:2:10:0.5:true', 'param:2:20:3:false']);
  });

  it('counts a per-param failure with its message and keeps writing the rest', async () => {
    const { io, calls } = fakeBlockIo({ failParams: [10] });
    const plan = planCopyChannelAcrossBlocks(clip(), 1, 2, 'D', [knob(10, 'Drive'), knob(11, 'Bass')], [enumParam(20, 'Model')]);
    const report = await applyCopyChannelAcrossBlocks(plan, io);
    expect(report).toEqual({ ok: 1, failed: 1, dropped: 0, failures: [{ paramId: 10, name: 'Drive', message: 'param rejected' }] });
    expect(calls).toEqual(['param:2:10:0.5:true', 'param:2:20:3:false']);
  });

  it('is a no-op for a same-block plan (no device calls)', async () => {
    const { io, calls } = fakeBlockIo();
    const plan = planCopyChannelAcrossBlocks(clip(), 5, 5, 'A', [knob(10, 'Drive')], [enumParam(20, 'Model')]);
    const report = await applyCopyChannelAcrossBlocks(plan, io);
    expect(report).toEqual({ ok: 0, failed: 0, dropped: 0, failures: [] });
    expect(calls).toEqual([]);
  });

  it('carries the dropped count through to the report (what could not be written)', async () => {
    const { io } = fakeBlockIo();
    const plan = planCopyChannelAcrossBlocks(clip(), 1, 2, null, [knob(10, 'Drive')], []);
    const report = await applyCopyChannelAcrossBlocks(plan, io);
    expect(report.dropped).toBe(1);
    expect(report.ok).toBe(1);
  });
});
