import { describe, it, expect } from 'vitest';
import { mayReplacePending, type ReloadKind } from './eventReload';

// Regression: a pending FULL reload (grid structure + open block) must survive a later, lighter
// scene/blockState refresh. Both share one debounce timer in editor.svelte.ts, so before this rule a
// preset switch on the device (`changed`) followed within ~250 ms by the FM3's scene/channel watch
// poll (`scene` / `blockState`) cancelled the full reload and left the previous preset's grid on screen.
describe('mayReplacePending', () => {
  it('refuses to let a scene refresh cancel a pending FULL reload (the regression)', () => {
    expect(mayReplacePending('full', 'scene')).toBe(false);
  });

  it('refuses to let a blockState refresh cancel a pending FULL reload', () => {
    expect(mayReplacePending('full', 'blockState')).toBe(false);
  });

  it('allows any refresh when nothing is pending', () => {
    for (const k of ['full', 'scene', 'blockState'] as ReloadKind[]) {
      expect(mayReplacePending(null, k)).toBe(true);
    }
  });

  it('allows a broader refresh to replace a lighter pending one', () => {
    expect(mayReplacePending('scene', 'full')).toBe(true);
    expect(mayReplacePending('blockState', 'full')).toBe(true);
  });

  it('allows equal-rank refreshes to coalesce into one', () => {
    expect(mayReplacePending('scene', 'blockState')).toBe(true);
    expect(mayReplacePending('blockState', 'scene')).toBe(true);
    expect(mayReplacePending('scene', 'scene')).toBe(true);
    expect(mayReplacePending('full', 'full')).toBe(true);
  });
});
