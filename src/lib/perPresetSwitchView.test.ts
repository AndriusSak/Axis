import { describe, expect, it } from 'vitest';
import { evidenceNote, switchPatchFromFields, switchRows, switchWriteVerdict } from './perPresetSwitchView';
import type { PerPresetSwitch, PerPresetSwitches } from './types';

const sw = (
  index: number, actionCode: number, action: string | null, targetIndex: number,
  targetLabel: string | null, confidence: 'measured' | 'inferred'
): PerPresetSwitch => ({ index, actionCode, action, targetIndex, targetLabel, confidence });

// The shape the real preset 410 returns: the block is present but UNCONFIGURED, so every row is zero.
// The rows past PP#1 are `inferred` because only PP#1's offsets have ever been observed.
const EMPTY: PerPresetSwitches = {
  at: 11420,
  populated: false,
  geometry: 'measured-pp1-only',
  evidence: { actionCodesMeasured: 2, targetBytesMeasured: 1 },
  switches: [
    sw(1, 0, 'unassigned', 0, 'Amp 1', 'measured'),
    sw(2, 0, 'unassigned', 0, 'Amp 1', 'inferred'),
    sw(3, 0, 'unassigned', 0, 'Amp 1', 'inferred')
  ]
};

// A configured PP#1 (as a real one reads after the owner sets Effect: Bypass → Reverb 1).
const CONFIGURED: PerPresetSwitches = {
  ...EMPTY,
  populated: true,
  switches: [
    sw(1, 0x04, 'Effect: Bypass (inferred)', 51, 'Reverb 1', 'measured'),
    sw(2, 0, 'unassigned', 0, 'Amp 1', 'inferred'),
    sw(3, 0x99, null, 9, null, 'inferred') // an unmeasured code AND an unlabelled target index
  ]
};

describe('switchRows (per-row honesty)', () => {
  it('returns no rows for a null/absent block (never a fabricated twelve)', () => {
    expect(switchRows(null)).toEqual([]);
    expect(switchRows(undefined)).toEqual([]);
  });

  it('marks an all-zero row as UNASSIGNED and blanks its target label', () => {
    const r = switchRows(EMPTY)[0]!;
    expect(r.assigned).toBe(false);
    // 0 IS a measured anchor ("Amp 1") — but an unconfigured switch does not point at it, so the name
    // must not be shown. This is the same rule as the perform page's stale-label blanking.
    expect(r.targetLabel).toBe('');
    expect(r.actionLabel).toBe('unassigned');
  });

  it('names a configured target only through a MEASURED anchor', () => {
    const pp1 = switchRows(CONFIGURED)[0]!;
    expect(pp1.assigned).toBe(true);
    expect(pp1.targetLabel).toBe('Reverb 1');
    expect(pp1.actionLabel).toBe('Effect: Bypass (inferred)');
  });

  it('shows the raw INDEX for an unlabelled target and the raw CODE for an unmeasured action', () => {
    const r = switchRows(CONFIGURED)[2]!;
    expect(r.targetLabel).toBe('index 9 (unlabelled)'); // NOT a guessed slot name
    expect(r.actionLabel).toBe('code 0x99 (unmeasured)');
  });

  it('carries confidence through and only lets PP#1 be edited', () => {
    const rows = switchRows(CONFIGURED);
    expect(rows[0]!.confidence).toBe('measured');
    expect(rows[0]!.editable).toBe(true);
    for (const r of rows.slice(1)) {
      expect(r.confidence).toBe('inferred');
      expect(r.editable).toBe(false);
    }
  });
});

describe('switchPatchFromFields (the write payload)', () => {
  it('sends nothing when both fields are empty', () => {
    expect(switchPatchFromFields({ actionCode: '', targetIndex: '' })).toBeNull();
  });

  it('carries what was actually entered', () => {
    expect(switchPatchFromFields({ actionCode: '4', targetIndex: '51' })).toEqual({ actionCode: 4, targetIndex: 51 });
    expect(switchPatchFromFields({ actionCode: '', targetIndex: '51' })).toEqual({ targetIndex: 51 });
  });

  it('DROPS a non-numeric or out-of-range value rather than sending it', () => {
    expect(switchPatchFromFields({ actionCode: '0x04', targetIndex: '' })).toBeNull(); // hex text is not a number
    expect(switchPatchFromFields({ actionCode: '65536', targetIndex: '' })).toBeNull(); // 16-bit ceiling
    expect(switchPatchFromFields({ actionCode: '', targetIndex: '256' })).toBeNull(); // one byte
    expect(switchPatchFromFields({ actionCode: '', targetIndex: '-1' })).toBeNull();
    expect(switchPatchFromFields({ actionCode: '65535', targetIndex: '255' })).toEqual({ actionCode: 65535, targetIndex: 255 });
  });
});

describe('switchWriteVerdict', () => {
  it('says the write is NOT saved when it was confirmed', () => {
    expect(switchWriteVerdict({ ok: true })).toContain('not saved');
  });
  it('names the reason when the unit did not confirm it', () => {
    expect(switchWriteVerdict({ ok: false, reason: 'readback-mismatch' })).toContain('readback-mismatch');
  });
});

describe('evidenceNote (the counts come from the decoder, never from prose)', () => {
  it('is empty without a block', () => {
    expect(evidenceNote(null)).toBe('');
  });

  it('states the evidence per feature, from the page\'s own numbers', () => {
    const note = evidenceNote(EMPTY);
    expect(note).toContain('action codes of PP#1–PP#2');
    expect(note).toContain('target byte of PP#1 only');
    expect(note).toContain('extrapolated');
  });

  it('follows the page when a field is measured for one row only', () => {
    const page = { ...EMPTY, evidence: { actionCodesMeasured: 1, targetBytesMeasured: 1 } };
    expect(evidenceNote(page)).toContain('the action code of PP#1 only');
  });
});
