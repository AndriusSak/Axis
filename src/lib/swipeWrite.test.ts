import { describe, it, expect } from 'vitest';
import { planSwipe } from './swipeWrite';
import type { MeterVal } from './types';

// planSwipe is the pure decision behind editor.adjustSwipe (the on-grid swipe control). The runes store
// cannot be imported in this node-env harness, so its decision is extracted here and proven directly.

describe('planSwipe', () => {
  it('returns null when there is NO reading to adjust from (refuse the write)', () => {
    // The old inline code fell back to `(prev?.norm ?? 0.5)` and wrote ~50% of the param — a value
    // nobody read — straight to the device. No reading ⇒ no plan ⇒ no setParam call.
    expect(planSwipe(undefined, 0.1)).toBeNull();
    expect(planSwipe(undefined, -0.4)).toBeNull();
  });

  it('adjusts from a real reading and clamps the position to 0..1', () => {
    const prev: MeterVal = { norm: 0.4, value: 40, min: 0, max: 100, unit: '%' };
    const up = planSwipe(prev, 0.2)!;
    expect(up.norm).toBeCloseTo(0.6, 6);
    expect(up.value).toBeCloseTo(60, 6);
    const over = planSwipe(prev, 5)!;
    expect(over.norm).toBe(1);
    const under = planSwipe(prev, -5)!;
    expect(under.norm).toBe(0);
  });

  it('computes the display value with the reading’s own range/taper', () => {
    const prev: MeterVal = { norm: 0.5, value: 5, min: 0, max: 10 };
    const next = planSwipe(prev, 0.25)!;
    expect(next.norm).toBeCloseTo(0.75, 6);
    expect(next.value).toBeCloseTo(7.5, 6);
  });

  it('keeps a zero reading as a real position (a genuine 0 is not "no reading")', () => {
    const prev: MeterVal = { norm: 0, value: 0, min: 0, max: 10 };
    const next = planSwipe(prev, 0.3)!;
    expect(next.norm).toBeCloseTo(0.3, 6);
  });
});
