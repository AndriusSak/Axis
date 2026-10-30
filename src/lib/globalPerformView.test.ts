import { describe, expect, it } from 'vitest';
import {
  globalAssignedCount,
  globalPageHasUnlabelledSlots,
  globalPerformRows
} from './globalPerformView';
import type { GlobalPerformPage } from './types';

/** The unit's own page as read on 2026-10-30: eight Amp controls, two unassigned. */
const MEASURED: GlobalPerformPage = {
  at: 8305,
  slots: [
    { effectId: 58, paramId: 8, effectLabel: 'AMP', paramLabel: 'Bass' },
    { effectId: 58, paramId: 9, effectLabel: 'AMP', paramLabel: 'Mid' },
    { effectId: 58, paramId: 10, effectLabel: 'AMP', paramLabel: 'Treble' },
    { effectId: 58, paramId: 22, effectLabel: 'AMP', paramLabel: 'Depth' },
    { effectId: 58, paramId: 26, effectLabel: 'AMP', paramLabel: 'Presence' },
    { effectId: 0, paramId: 0, effectLabel: '', paramLabel: '' },
    { effectId: 58, paramId: 7, effectLabel: 'AMP', paramLabel: 'Input Drive' },
    { effectId: 58, paramId: 11, effectLabel: 'AMP', paramLabel: 'Master Vol' },
    { effectId: 58, paramId: 1, effectLabel: 'AMP', paramLabel: 'Level' },
    { effectId: 0, paramId: 0, effectLabel: '', paramLabel: '' }
  ]
};

describe('globalPerformRows', () => {
  it('numbers slots from 1 and keeps the measured ids and names', () => {
    const rows = globalPerformRows(MEASURED);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({ slot: 1, assigned: true, effectId: 58, paramId: 8, paramLabel: 'Bass' });
    expect(rows[9]).toMatchObject({ slot: 10, assigned: false });
  });

  it('never surfaces label text on an unassigned slot', () => {
    const stale: GlobalPerformPage = {
      at: 100,
      slots: [{ effectId: 0, paramId: 0, effectLabel: 'AMP', paramLabel: 'Master Vol' }]
    };
    const row = globalPerformRows(stale)[0]!;
    expect(row.assigned).toBe(false);
    expect(row.effectLabel).toBe('');
    expect(row.paramLabel).toBe('');
  });

  it('yields no rows when there is no page (never a fabricated ten)', () => {
    expect(globalPerformRows(null)).toEqual([]);
    expect(globalPerformRows(undefined)).toEqual([]);
    expect(globalAssignedCount(null)).toBe(0);
  });

  it('counts only assigned slots', () => {
    expect(globalAssignedCount(MEASURED)).toBe(8);
  });
});

describe('globalPageHasUnlabelledSlots', () => {
  it('is false for the measured page', () => {
    expect(globalPageHasUnlabelledSlots(MEASURED)).toBe(false);
  });

  it('flags a slot whose ids landed but whose labels did not', () => {
    const half: GlobalPerformPage = {
      at: 0,
      slots: [{ effectId: 58, paramId: 11, effectLabel: '', paramLabel: '' }]
    };
    expect(globalPageHasUnlabelledSlots(half)).toBe(true);
  });

  it('is false when there is no page', () => {
    expect(globalPageHasUnlabelledSlots(null)).toBe(false);
  });
});
