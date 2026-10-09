import { describe, expect, it } from 'vitest';
import { evidenceNote, switchPatchFromFields, switchRows, switchWriteVerdict } from './perPresetSwitchView';
import type { PerPresetSwitch, PerPresetSwitches } from './types';

const sw = (
  index: number, actionCode: number | null, action: string | null, targetIndex: number | null,
  targetLabel: string | null, confidence: 'measured' | 'partial' | 'unknown'
): PerPresetSwitch => ({ index, actionCode, action, targetIndex, targetLabel, confidence });

// The shape the real preset 410 returns NOW: PP#1 fully observed, PP#2's action code observed but its target
// byte never located, and PP#3+ with no observed offset at all — so those read as unread, not as zeroes.
const EMPTY: PerPresetSwitches = {
  at: 11420,
  populated: false,
  geometry: 'per-index-observed-offsets',
  evidence: { actionCodesMeasured: 2, targetBytesMeasured: 1 },
  switches: [
    sw(1, 0, 'unassigned', 0, 'Amp 1', 'measured'),
    sw(2, 0, 'unassigned', null, null, 'partial'),
    sw(3, null, null, null, null, 'unknown')
  ]
};

// A configured PP#1 (as a real one reads after the owner sets Effect: Bypass → Reverb 1).
const CONFIGURED: PerPresetSwitches = {
  ...EMPTY,
  populated: true,
  switches: [
    sw(1, 0x04, 'Effect: Bypass (inferred)', 51, 'Reverb 1', 'measured'),
    sw(2, 0, 'unassigned', null, null, 'partial'),
    sw(3, 0x99, null, 9, null, 'measured') // an unmeasured code AND an unlabelled target index
  ]
};

describe('switchRows (per-field honesty)', () => {
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

  it('says "(target not located)" for a PARTIAL row — never a number read from a guessed offset', () => {
    const pp2 = switchRows(EMPTY)[1]!;
    expect(pp2.confidence).toBe('partial');
    expect(pp2.known).toBe(true);
    expect(pp2.actionCode).toBe(0);
    expect(pp2.actionLabel).toBe('unassigned');
    expect(pp2.targetIndex).toBeNull();
    expect(pp2.targetLabel).toBe('(target not located)');
  });

  it('reports an UNKNOWN row as unread — no claim at all, and no write', () => {
    const r = switchRows(EMPTY)[2]!;
    expect(r.confidence).toBe('unknown');
    expect(r.known).toBe(false);
    expect(r.assigned).toBeNull();
    expect(r.actionLabel).toBe('—');
    expect(r.targetLabel).toBe('—');
    expect(r.canWriteAction).toBe(false);
    expect(r.canWriteTarget).toBe(false);
  });

  it('offers writes per FIELD: PP#2 accepts an action code but not a target', () => {
    const rows = switchRows(EMPTY);
    expect(rows[0]!.canWriteAction).toBe(true);
    expect(rows[0]!.canWriteTarget).toBe(true);
    expect(rows[1]!.canWriteAction).toBe(true);   // its action-code offset IS observed
    expect(rows[1]!.canWriteTarget).toBe(false);  // its target byte offset is NOT
    expect(rows[2]!.canWriteAction).toBe(false);
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
    // Nothing is extrapolated any more — rows without an observed offset read NOTHING, and the note says so
    // rather than promising a value it cannot back.
    expect(note).toContain('shows only what was observed');
    expect(note).not.toContain('extrapolated');
  });

  it('follows the page when a field is measured for one row only', () => {
    const page = { ...EMPTY, evidence: { actionCodesMeasured: 1, targetBytesMeasured: 1 } };
    expect(evidenceNote(page)).toContain('the action code of PP#1 only');
  });
});
