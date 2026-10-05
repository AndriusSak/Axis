import { describe, it, expect } from 'vitest';
import { isSceneStateUsable } from './sceneStateRefresh';

// W2.2 / W4.3 client half — an empty `sceneState` (`[]`) is never legitimate (a real preset always has
// at least the Output blocks), so it must fall back to a full load() rather than silently applying
// nothing (which leaves stale bypass/channel on screen forever).
describe('isSceneStateUsable', () => {
  it('rejects an empty array (a failed server-side status read, not an empty grid)', () => {
    expect(isSceneStateUsable([])).toBe(false);
  });

  it('accepts a non-empty per-block bypass/channel list', () => {
    expect(isSceneStateUsable([{ effectId: 1, bypassed: false, channel: null }])).toBe(true);
  });

  it('rejects null / undefined / non-arrays (e.g. the AM4 501 → full reload)', () => {
    for (const v of [null, undefined, {}, 'x', 0, false]) expect(isSceneStateUsable(v)).toBe(false);
  });
});
