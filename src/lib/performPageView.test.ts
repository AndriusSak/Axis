import { describe, expect, it } from 'vitest';
import { assignedCount, patchFromFields, performPageRows, writeVerdict } from './performPageView';
import type { PerformPage, PerformSlot } from './types';

const slot = (n: number, effectId: number, paramId: number, effectLabel: string, paramLabel: string): PerformSlot => ({
  slot: n,
  effectId,
  paramId,
  effectLabel,
  paramLabel,
  paramLabel2: ''
});

// preset-410 shape: six assigned (slots 1-6), four unassigned (7-10) carrying STALE labels.
const PAGE: PerformPage = {
  at: 10698,
  assigned: 6,
  slots: [
    slot(1, 58, 11, 'AMP', 'Master Volume'),
    slot(2, 70, 10, 'DLY1', 'Feedback'),
    slot(3, 66, 9, 'REV', 'Pre-Delay'),
    slot(4, 66, 22, 'REV', 'Bypass Mode'),
    slot(5, 62, 41, 'CAB', 'Proximity Frequ'),
    slot(6, 118, 2, 'DRV1', 'Tone'),
    slot(7, 0, 0, '', 'ate'),
    slot(8, 0, 0, '', 'ate'),
    slot(9, 0, 0, '', 'ate'),
    slot(10, 0, 0, '', 'ate')
  ]
};

describe('performPageView', () => {
  it('returns no rows for a null/absent page (never a fabricated ten)', () => {
    expect(performPageRows(null)).toEqual([]);
    expect(performPageRows(undefined)).toEqual([]);
    expect(assignedCount(null)).toBe(0);
  });

  it('maps every slot, preserving the 1-based slot number and raw ids', () => {
    const rows = performPageRows(PAGE);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({ slot: 1, effectId: 58, paramId: 11, assigned: true, effectLabel: 'AMP', paramLabel: 'Master Volume' });
    expect(rows[5]).toMatchObject({ slot: 6, effectId: 118, paramId: 2, effectLabel: 'DRV1', paramLabel: 'Tone' });
  });

  it('BLANKS the labels of an unassigned slot (effectId 0) — stale text is never surfaced', () => {
    const rows = performPageRows(PAGE);
    for (const r of rows.filter((x) => x.slot >= 7)) {
      expect(r.assigned).toBe(false);
      expect(r.effectId).toBe(0);
      expect(r.effectLabel).toBe('');
      expect(r.paramLabel).toBe(''); // NOT the stale "ate"
    }
  });

  it('reports the assigned count from the page (else counts the rows)', () => {
    expect(assignedCount(PAGE)).toBe(6);
    expect(assignedCount({ ...PAGE, assigned: undefined as unknown as number })).toBe(6);
  });
});

describe('patchFromFields (the write payload)', () => {
  const empty = { effectId: '', paramId: '', effectLabel: '', paramLabel: '' };

  it('sends nothing when every field is empty (never an empty patch)', () => {
    expect(patchFromFields(empty)).toBeNull();
    expect(patchFromFields({ ...empty, effectLabel: '   ' })).toBeNull();
  });

  it('carries ids and labels that were actually filled in', () => {
    expect(patchFromFields({ ...empty, effectId: '62', paramId: '41', effectLabel: 'CAB', paramLabel: 'Proximity Frequ' }))
      .toEqual({ effectId: 62, paramId: 41, effectLabel: 'CAB', paramLabel: 'Proximity Frequ' });
  });

  it('treats an empty text input as "leave it alone", not as "write an empty label"', () => {
    // ids only — the server then leaves the (possibly stale) labels untouched, which the panel reports
    expect(patchFromFields({ ...empty, effectId: '62', paramId: '41' })).toEqual({ effectId: 62, paramId: 41 });
    // labels only
    expect(patchFromFields({ ...empty, paramLabel: 'Tone' })).toEqual({ paramLabel: 'Tone' });
  });

  it('DROPS a non-numeric or out-of-range id rather than sending it (the server would 400)', () => {
    expect(patchFromFields({ ...empty, effectId: 'abc' })).toBeNull();
    expect(patchFromFields({ ...empty, effectId: '62.5' })).toBeNull();
    expect(patchFromFields({ ...empty, effectId: '-1' })).toBeNull();
    expect(patchFromFields({ ...empty, paramId: '16384' })).toBeNull(); // 14-bit ceiling
    expect(patchFromFields({ ...empty, paramId: '16383' })).toEqual({ paramId: 16383 });
  });
});

describe('writeVerdict (honest summary of a read-back verdict)', () => {
  it('says the write is NOT saved when it was confirmed', () => {
    expect(writeVerdict({ ok: true })).toContain('not saved');
  });

  it('names the reason when the unit did not confirm it', () => {
    expect(writeVerdict({ ok: false, reason: 'readback-mismatch' })).toContain('readback-mismatch');
    expect(writeVerdict({ ok: false })).toContain('NOT confirmed');
  });
});
