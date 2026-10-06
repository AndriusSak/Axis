import { describe, expect, it } from 'vitest';
import {
  PERFORMANCE_PAGE_STORAGE_KEY,
  addPerformanceBinding,
  bindingsFromParams,
  createPerformancePage,
  loadPerformancePage,
  movePerformanceBinding,
  nudgeNorm,
  parsePerformancePage,
  performanceBindingKey,
  removePerformanceBinding,
  resolvePerformanceEffectId,
  savePerformancePage,
  type PerformanceBinding,
  type PerformanceStorageLike
} from './performancePage';

// A Map-backed storage stand-in (node-env vitest has no localStorage).
function fakeStorage(): PerformanceStorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => void map.set(k, v)
  };
}

const bind = (family: string, paramId: number, extra: Partial<PerformanceBinding> = {}): PerformanceBinding => ({
  family,
  paramId,
  ...extra
});

describe('performancePage — model', () => {
  it('creates an empty ordered page', () => {
    const page = createPerformancePage();
    expect(page.version).toBe(1);
    expect(page.label).toBe('Performance');
    expect(page.bindings).toEqual([]);
  });

  it('keys a binding by family + paramId (stable across presets)', () => {
    expect(performanceBindingKey(bind('Amp', 5))).toBe('amp:5');
    expect(performanceBindingKey(bind('amp', 5))).toBe('amp:5');
  });

  it('appends bindings in order', () => {
    const page = addPerformanceBinding(addPerformanceBinding(createPerformancePage(), bind('amp', 3)), bind('delay', 9));
    expect(page.bindings.map((b) => performanceBindingKey(b))).toEqual(['amp:3', 'delay:9']);
  });

  it('dedupes by family+paramId (no duplicate binding), refreshing the stored label', () => {
    const first = addPerformanceBinding(createPerformancePage(), bind('amp', 3, { label: 'Gain' }));
    const second = addPerformanceBinding(first, bind('amp', 3, { label: 'Gain (amp 1)', effectId: 12 }));
    expect(second.bindings).toHaveLength(1);
    expect(second.bindings[0].label).toBe('Gain (amp 1)');
    expect(second.bindings[0].effectId).toBe(12);
  });

  it('inserts at an explicit index (clamped) and never mutates the input', () => {
    const base = addPerformanceBinding(addPerformanceBinding(createPerformancePage(), bind('amp', 1)), bind('delay', 2));
    const inserted = addPerformanceBinding(base, bind('reverb', 3), 1);
    expect(inserted.bindings.map((b) => b.family)).toEqual(['amp', 'reverb', 'delay']);
    // input untouched
    expect(base.bindings.map((b) => b.family)).toEqual(['amp', 'delay']);
    const clamped = addPerformanceBinding(base, bind('reverb', 3), 99);
    expect(clamped.bindings[2].family).toBe('reverb');
  });

  it('removes a binding by index (out-of-range is a no-op)', () => {
    const base = addPerformanceBinding(addPerformanceBinding(createPerformancePage(), bind('amp', 1)), bind('delay', 2));
    expect(removePerformanceBinding(base, 0).bindings.map((b) => b.family)).toEqual(['delay']);
    expect(removePerformanceBinding(base, 9).bindings.map((b) => b.family)).toEqual(['amp', 'delay']);
  });

  it('reorders a binding (clamped) and is a no-op for from === to', () => {
    let page = createPerformancePage();
    for (const f of ['a', 'b', 'c']) page = addPerformanceBinding(page, bind(f, 1));
    expect(movePerformanceBinding(page, 0, 2).bindings.map((b) => b.family)).toEqual(['b', 'c', 'a']);
    expect(movePerformanceBinding(page, 2, 0).bindings.map((b) => b.family)).toEqual(['c', 'a', 'b']);
    expect(movePerformanceBinding(page, 1, 1).bindings.map((b) => b.family)).toEqual(['a', 'b', 'c']);
    expect(movePerformanceBinding(page, 0, 99).bindings.map((b) => b.family)).toEqual(['b', 'c', 'a']);
  });
});

describe('performancePage — building bindings from an open block', () => {
  it('maps a block\'s params to (family, paramId) bindings, dropping id-less params', () => {
    const bindings = bindingsFromParams('Amp', 12, 'Amp 1', [
      { id: 3, name: 'Gain' },
      { id: undefined, name: 'Mystery' },
      { id: 7, name: 'Bass' }
    ]);
    expect(bindings).toEqual([
      { family: 'amp', paramId: 3, effectId: 12, label: 'Gain', block: 'Amp 1' },
      { family: 'amp', paramId: 7, effectId: 12, label: 'Bass', block: 'Amp 1' }
    ]);
  });

  it('returns nothing when the family is blank (no block context)', () => {
    expect(bindingsFromParams('', 12, 'Amp 1', [{ id: 1, name: 'Gain' }])).toEqual([]);
  });
});

describe('performancePage — resolving a binding to a placed block', () => {
  const cells = [
    { effectId: 10, pack: 'Amp' },
    { effectId: 11, pack: 'Delay' },
    { effectId: 12, pack: 'Amp' }
  ];

  it('prefers the captured effectId when it is still a placed block of that family', () => {
    expect(resolvePerformanceEffectId(bind('amp', 3, { effectId: 12 }), cells)).toBe(12);
  });

  it('falls back to the first placed block of the family, case-insensitively', () => {
    expect(resolvePerformanceEffectId(bind('amp', 3), cells)).toBe(10);
    expect(resolvePerformanceEffectId(bind('AMP', 3, { effectId: 99 }), cells)).toBe(10);
  });

  it('returns null when the family is not in the current preset', () => {
    expect(resolvePerformanceEffectId(bind('reverb', 3), cells)).toBeNull();
  });
});

describe('performancePage — local persistence', () => {
  it('round-trips through a storage backend', () => {
    const store = fakeStorage();
    const page = addPerformanceBinding(createPerformancePage('My Live'), bind('amp', 4, { label: 'Gain', effectId: 2 }));
    savePerformancePage(page, store);
    expect(store.map.has(PERFORMANCE_PAGE_STORAGE_KEY)).toBe(true);
    expect(loadPerformancePage(store)).toEqual(page);
  });

  it('returns a fresh page when storage is empty or unreadable', () => {
    const store = fakeStorage();
    expect(loadPerformancePage(store).bindings).toEqual([]);
    store.setItem(PERFORMANCE_PAGE_STORAGE_KEY, '{not json');
    expect(loadPerformancePage(store).bindings).toEqual([]);
  });

  it('never throws when the storage backend is unavailable', () => {
    expect(() => savePerformancePage(createPerformancePage(), null)).not.toThrow();
    expect(loadPerformancePage(null).bindings).toEqual([]);
  });

  it('tolerantly drops malformed persisted bindings and keeps valid ones', () => {
    const parsed = parsePerformancePage({
      version: 1,
      label: 'Live',
      bindings: [
        { family: 'amp', paramId: 3 },
        { family: '', paramId: 4 },
        { family: 'delay', paramId: 'nope' },
        null,
        { family: 'reverb', paramId: 9, label: 'Mix' }
      ]
    });
    expect(parsed.bindings).toEqual([
      { family: 'amp', paramId: 3 },
      { family: 'reverb', paramId: 9, label: 'Mix' }
    ]);
  });
});

describe('performancePage — value stepping', () => {
  it('clamps a nudged norm to 0..1', () => {
    expect(nudgeNorm(0.5, 0.01)).toBeCloseTo(0.51);
    expect(nudgeNorm(0.995, 0.02)).toBe(1);
    expect(nudgeNorm(0.005, -0.02)).toBe(0);
    expect(nudgeNorm(undefined, 0.5)).toBe(0.5);
  });
});
