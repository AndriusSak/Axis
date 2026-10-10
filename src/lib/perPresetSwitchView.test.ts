import { describe, expect, it } from 'vitest';
import { evidenceNote, switchPatchFromFields, switchRows, switchWriteVerdict } from './perPresetSwitchView';
import type { PerPresetSwitch, PerPresetSwitches } from './types';

const sw = (
  index: number, actionCode: number | null, action: string | null, targetIndex: number | null,
  targetLabel: string | null, confidence: 'measured' | 'partial' | 'unknown'
): PerPresetSwitch => ({ index, actionCode, action, targetIndex, targetLabel, confidence });

// The shape the real preset 410 returns NOW: PP#1–PP#3 fully observed (both target bytes were located on
// 2026-10-09, at marker+160 and marker+172), and PP#4+ with no observed offset at all — so those read as
// unread, not as zeroes. PP#2 is kept as a PARTIAL row deliberately: the table no longer produces that state,
// but the view must still handle it honestly, since that is the shape the server returns the moment an index
// is measured only half-way (finding 7's guard).
const EMPTY: PerPresetSwitches = {
  at: 11420,
  populated: false,
  geometry: 'per-index-observed-offsets',
  evidence: { actionCodeIndices: [1, 2], targetByteIndices: [1] },
  switches: [
    sw(1, 0, 'unassigned', 0, 'Amp 1', 'measured'),
    sw(2, 0, 'unassigned', null, null, 'partial'),
    sw(3, null, null, null, null, 'unknown')
  ]
};

// A row whose action is NOT an effect action. Its target byte IS observed (1) — but every FX-slot anchor in
// the decode was measured with Effect: Bypass selected, so the name must be withheld: for a scene action that
// byte is a scene number, and calling it "Cab 1" would be a claim nobody measured.
const SCENE: PerPresetSwitches = {
  ...EMPTY,
  populated: true,
  switches: [
    sw(1, 0x04, 'Effect (category — the mode is in the record)', 20, 'Filter 4', 'measured'),
    sw(2, 0x03, 'Scene: Select (inferred)', 1, 'Cab 1', 'measured')
  ]
};

// A configured PP#1 (as a real one reads after the owner sets Effect: Bypass → Reverb 1).
const CONFIGURED: PerPresetSwitches = {
  ...EMPTY,
  populated: true,
  switches: [
    sw(1, 0x04, 'Effect (category — the mode is in the record)', 51, 'Reverb 1', 'measured'),
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

  it('withholds the anchor name from an EFFECT row too, while the mode cannot be read', () => {
    // 0x04 is the whole Effect category: Bypass, Change Channel and Parameter (all measured). The anchor table
    // was measured with Bypass alone and the three modes do not share the meaning of record+0, so a name here
    // would be a guess for two of them. The observed index is shown, and the name returns when the mode is
    // decodable (plan: Change Channel on a known block).
    const pp1 = switchRows(CONFIGURED)[0]!;
    expect(pp1.assigned).toBe(true);
    expect(pp1.targetIndex).toBe(51);
    expect(pp1.targetLabel).toBe('index 51 (name withheld: effect mode not decoded)');
    expect(pp1.actionLabel).toBe('Effect (category — the mode is in the record)');
  });

  it('withholds an FX-slot name from a NON-effect action (the anchors are an effect-action table)', () => {
    const rows = switchRows(SCENE);
    expect(rows[0]!.targetLabel).toBe('index 20 (name withheld: effect mode not decoded)'); // same rule for 0x04
    const scene = rows[1]!;
    expect(scene.assigned).toBe(true);
    expect(scene.actionLabel).toBe('Scene: Select (inferred)');
    expect(scene.targetIndex).toBe(1);                        // the observed byte is still shown…
    expect(scene.targetLabel).toBe('index 1 (unlabelled)');   // …but the name would be an unmeasured claim
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

describe('evidenceNote (the indices come from the decoder, never a count-as-range)', () => {
  it('is empty without a block', () => {
    expect(evidenceNote(null)).toBe('');
  });

  it('names the measured indices per field, never a range', () => {
    const note = evidenceNote(EMPTY);
    expect(note).toContain('action codes of PP#1, PP#2');
    expect(note).toContain('target byte of PP#1 only');
    // A range would only be valid if the observed indices were provably contiguous — they are not in general,
    // so the sentence names each index instead of asserting a span it cannot back.
    expect(note).not.toContain('–');
    // Nothing is extrapolated any more — rows without an observed offset read NOTHING, and the note says so
    // rather than promising a value it cannot back.
    expect(note).toContain('shows only what was observed');
    expect(note).not.toContain('extrapolated');
  });

  it('names all three measured indices when the decode reaches PP#3', () => {
    const page = { ...EMPTY, evidence: { actionCodeIndices: [1, 2, 3], targetByteIndices: [1, 2, 3] } };
    const note = evidenceNote(page);
    expect(note).toContain('action codes of PP#1, PP#2, PP#3');
    expect(note).toContain('target bytes of PP#1, PP#2, PP#3');
    expect(note).not.toContain('–');
  });

  it('follows the page when a field is measured for one row only', () => {
    const page = { ...EMPTY, evidence: { actionCodeIndices: [1], targetByteIndices: [1] } };
    expect(evidenceNote(page)).toContain('the action code of PP#1 only');
  });

  it('stays TRUE for a NON-CONTIGUOUS set — action codes on 1 and 2 but a target on 1 only', () => {
    const page = { ...EMPTY, evidence: { actionCodeIndices: [1, 2], targetByteIndices: [1] } };
    const note = evidenceNote(page);
    expect(note).toContain('action codes of PP#1, PP#2');
    expect(note).toContain('target byte of PP#1 only');
    expect(note).not.toContain('PP#3'); // the old "PP#1–PP#2 range" could not name a gap; this one must not invent one
  });

  it('never claims an index that was not measured (a synthetic gap: PP#1 and PP#4)', () => {
    const page = { ...EMPTY, evidence: { actionCodeIndices: [1, 4], targetByteIndices: [4] } };
    const note = evidenceNote(page);
    expect(note).toContain('action codes of PP#1, PP#4');
    expect(note).toContain('target byte of PP#4 only');
    // The whole point of finding 9: a range from a count would render "PP#1–PP#4" and claim PP#2 and PP#3,
    // neither of which was measured. Assert the note makes no such claim.
    expect(note).not.toContain('–');
    expect(note).not.toContain('PP#2');
    expect(note).not.toContain('PP#3');
    expect(note).not.toMatch(/PP#1[-–—]PP#4/);
  });

  it('reports "no … has been measured" for an empty field rather than a dangling name', () => {
    const page = { ...EMPTY, evidence: { actionCodeIndices: [], targetByteIndices: [] } };
    const note = evidenceNote(page);
    expect(note).toContain('no action code has been measured');
    expect(note).toContain('no target byte has been measured');
  });
});
