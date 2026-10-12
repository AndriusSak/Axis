import { describe, expect, it } from 'vitest';
import { evidenceNote, switchPatchFromFields, switchRows, switchWriteVerdict } from './perPresetSwitchView';
import type { PerPresetSwitch, PerPresetSwitches } from './types';

/** A row as the server now returns it: every field present, with the new ones defaulted to "nothing to say". */
const sw = (
  index: number, actionCode: number | null, action: string | null, targetIndex: number | null,
  targetLabel: string | null, confidence: 'measured' | 'partial' | 'unknown',
  extra: Partial<PerPresetSwitch> = {}
): PerPresetSwitch => ({
  index, actionCode, action, targetIndex, targetLabel, confidence,
  targetIsFxSlot: false, functionIndex: 0, functionName: null,
  holdActionCode: 0, holdAction: null, holdMeasured: false,
  ...extra
});

const EFFECT_ACTION = 'Effect (category — the mode is in the record)';

// A page shaped like the ones the server returns now: rows carry the function index, the FX-slot verdict and
// the HOLD side. PP#1 is an Effect: Bypass row (function 0 — the anchor name APPLIES, measured), PP#2 is a
// Scene: Select row (its byte is a scene number), PP#3 has an unmeasured code.
const EMPTY: PerPresetSwitches = {
  at: 11420,
  populated: false,
  geometry: 'per-index-observed-offsets',
  evidence: { actionCodeIndices: [1, 2], targetByteIndices: [1], holdMeasuredIndices: [] },
  switches: [
    sw(1, 0, 'unassigned', 0, 'Amp 1', 'measured'),
    sw(2, 0, 'unassigned', null, null, 'partial'),
    sw(3, null, null, null, null, 'unknown')
  ]
};

// The rule that FLIPPED on 2026-10-11 (Chan Select: four known blocks, record+0 read 2/51/7/28) and FINISHED on
// 2026-10-12, when the remaining two Effect functions were measured: Chan Toggle by writing targetIndex 51 to
// such a row and reading marker+340 back as 51 (nothing else moved), Chan Inc/Dec by setting its "Effect" field
// to Cab 1 and reading record+0 = 1. So the whole Effect category may be named. What still keeps a name back is
// an Effect row whose FUNCTION INDEX was never observed (the mode is what the name depends on), and any row of
// another category, whose byte means something else entirely.
const MIXED: PerPresetSwitches = {
  ...EMPTY,
  populated: true,
  switches: [
    sw(1, 0x04, EFFECT_ACTION, 51, 'Reverb 1', 'measured',
      { targetIsFxSlot: true, functionIndex: 0, functionName: 'Bypass' }),
    sw(2, 0x04, EFFECT_ACTION, 2, 'Chorus 1', 'measured',
      { targetIsFxSlot: true, functionIndex: 1, functionName: 'Chan Select' }),
    // An Effect row whose function was never observed: the only Effect case left that withholds a name.
    sw(3, 0x04, EFFECT_ACTION, 9, null, 'partial',
      { targetIsFxSlot: false, functionIndex: null, functionName: null }),
    sw(4, 0x03, 'Scene (category — the mode is in the record)', 1, 'Cab 1', 'measured',
      { targetIsFxSlot: false, functionIndex: 1, functionName: 'Toggle' }),
    sw(5, 0x99, null, 9, null, 'measured', { functionIndex: 4 }),
    // APPENDED, so the five rows above keep their positions: the case the 2026-10-12 measurements created — a
    // Chan Toggle row MAY be named now, and it is a row of the same category that made this rule necessary.
    sw(6, 0x04, EFFECT_ACTION, 51, 'Reverb 1', 'measured',
      { targetIsFxSlot: true, functionIndex: 2, functionName: 'Chan Toggle' })
  ]
};

// The HOLD side, as the tenth capture returns it: three exercised HOLDs and a zero that nobody tested.
const HOLDS: PerPresetSwitches = {
  ...EMPTY,
  populated: true,
  evidence: { actionCodeIndices: [1], targetByteIndices: [1], holdMeasuredIndices: [16, 17, 18] },
  switches: [
    sw(1, 0x02, 'Preset (category — the mode is in the record)', 1, 'Cab 1', 'measured',
      { functionIndex: 4, functionName: 'Increment', holdActionCode: 0x08, holdAction: 'Looper (category — the mode is in the record)', holdMeasured: true }),
    sw(2, 0x02, 'Preset (category — the mode is in the record)', 1, 'Cab 1', 'measured',
      { functionIndex: 0, functionName: 'Select' })
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
    expect(r.functionLabel).toBe('');
  });

  it('shows the anchor NAME where the unit was measured to store an FX-slot index there', () => {
    const rows = switchRows(MIXED);
    expect(rows[0]!.targetLabel).toBe('Reverb 1');       // Effect: Bypass (function 0) — measured
    expect(rows[1]!.targetLabel).toBe('Chorus 1');       // Effect: Chan Select (function 1) — measured on four blocks
    expect(rows[1]!.functionLabel).toBe('Chan Select');  // and the function is named, not just numbered
    expect(rows[0]!.functionLabel).toBe('Bypass');
  });

  it('withholds the name from an Effect row whose FUNCTION was never OBSERVED, and says which', () => {
    // The whole Effect category is measured now, so the one Effect case left is a row whose function index
    // nobody read: the mode decides what the byte means, and an unobserved mode cannot name anything. The
    // observed BYTE is still shown — withholding a name must not hide the reading.
    const r = switchRows(MIXED)[2]!;
    expect(r.targetIndex).toBe(9);
    expect(r.targetLabel).toBe('index 9 (name withheld: this Effect row’s function was not observed, so what its byte means is unread)');
  });

  it('names an FX slot on a Chan Toggle row — the function measured on 2026-10-12 that made the old rule wrong', () => {
    const r = switchRows(MIXED)[5]!;
    expect(r.functionLabel).toBe('Chan Toggle');
    expect(r.targetIndex).toBe(51);
    expect(r.targetLabel).toBe('Reverb 1');
  });

  it('withholds an FX-slot name from a NON-effect action, naming the reason', () => {
    const r = switchRows(MIXED)[3]!;
    expect(r.assigned).toBe(true);
    expect(r.targetIndex).toBe(1);   // the observed byte is still shown…
    expect(r.targetLabel).toBe('index 1 (not an FX slot — a Scene row stores its own kind of value here)');
    expect(r.functionLabel).toBe('Toggle');
  });

  it('shows the raw INDEX for an unlabelled target and the raw CODE for an unmeasured action', () => {
    const r = switchRows(MIXED)[4]!;
    expect(r.actionLabel).toBe('code 0x99 (unmeasured)');
    expect(r.targetLabel).toBe('index 9 (name withheld: code 0x99 is unmeasured, so it has no function list to reason from)');
    // An unmeasured CODE gets no function claim either — a function index beside a category nobody can name
    // would be a number about nothing.
    expect(r.functionLabel).toBe('');
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
    expect(r.holdLabel).toBe('—');
    expect(r.canWriteAction).toBe(false);
    expect(r.canWriteTarget).toBe(false);
    expect(r.canWriteHold).toBe(false);
  });

  it('offers writes per FIELD: PP#2 accepts an action code but not a target', () => {
    const rows = switchRows(EMPTY);
    expect(rows[0]!.canWriteAction).toBe(true);
    expect(rows[0]!.canWriteTarget).toBe(true);
    expect(rows[1]!.canWriteAction).toBe(true);   // its action-code offset IS observed
    expect(rows[1]!.canWriteTarget).toBe(false);  // its target byte offset is NOT
    expect(rows[2]!.canWriteAction).toBe(false);
  });

  it('renders the HOLD side beside the TAP, and marks a zero nobody ever exercised', () => {
    const rows = switchRows(HOLDS);
    expect(rows[0]!.holdActionCode).toBe(0x08);
    expect(rows[0]!.holdLabel).toBe('Looper (category — the mode is in the record)');
    expect(rows[0]!.holdUnexercised).toBe(false);  // this one WAS exercised on the unit
    expect(rows[1]!.holdLabel).toBe('unassigned');
    // The distinction that matters: "Unassigned" here is the codec's zero convention for a row whose HOLD was
    // never set on the unit — the UI must not present it as a reading.
    expect(rows[1]!.holdUnexercised).toBe(true);
    expect(rows[0]!.canWriteHold).toBe(true);
  });
});

describe('switchPatchFromFields (the write payload)', () => {
  it('sends nothing when every field is empty', () => {
    expect(switchPatchFromFields({ actionCode: '', targetIndex: '', holdActionCode: '' })).toBeNull();
  });

  it('carries what was actually entered', () => {
    expect(switchPatchFromFields({ actionCode: '4', targetIndex: '51', holdActionCode: '' })).toEqual({ actionCode: 4, targetIndex: 51 });
    expect(switchPatchFromFields({ actionCode: '', targetIndex: '51', holdActionCode: '' })).toEqual({ targetIndex: 51 });
    // A HOLD-only patch is a patch: the field is a second observed array, not an afterthought.
    expect(switchPatchFromFields({ actionCode: '', targetIndex: '', holdActionCode: '8' })).toEqual({ holdActionCode: 8 });
  });

  it('DROPS a non-numeric or out-of-range value rather than sending it', () => {
    const f = (a: string, t: string, h: string) => ({ actionCode: a, targetIndex: t, holdActionCode: h });
    expect(switchPatchFromFields(f('0x04', '', ''))).toBeNull(); // hex text is not a number
    expect(switchPatchFromFields(f('65536', '', ''))).toBeNull(); // 16-bit ceiling
    expect(switchPatchFromFields(f('', '256', ''))).toBeNull(); // one byte
    expect(switchPatchFromFields(f('', '-1', ''))).toBeNull();
    expect(switchPatchFromFields(f('', '', '65536'))).toBeNull(); // the HOLD code is 16-bit too
    expect(switchPatchFromFields(f('65535', '255', '65535'))).toEqual({ actionCode: 65535, targetIndex: 255, holdActionCode: 65535 });
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
    expect(note).toContain('shows only what was observed');
    expect(note).not.toContain('extrapolated');
  });

  it('separates the HOLD evidence from the located OFFSETS — exercised is not the same as located', () => {
    const note = evidenceNote(HOLDS);
    expect(note).toContain('the HOLD was exercised on PP#16, PP#17, PP#18');
    expect(note).toContain('convention and not an observation');
  });

  it('says so when no HOLD was ever exercised, rather than implying the zeroes were read', () => {
    expect(evidenceNote(EMPTY)).toContain('No HOLD has been exercised on this unit');
  });

  it('names all three measured indices when the decode reaches PP#3', () => {
    const page = { ...EMPTY, evidence: { actionCodeIndices: [1, 2, 3], targetByteIndices: [1, 2, 3], holdMeasuredIndices: [] } };
    const note = evidenceNote(page);
    expect(note).toContain('action codes of PP#1, PP#2, PP#3');
    expect(note).toContain('target bytes of PP#1, PP#2, PP#3');
    expect(note).not.toContain('–');
  });

  it('follows the page when a field is measured for one row only', () => {
    const page = { ...EMPTY, evidence: { actionCodeIndices: [1], targetByteIndices: [1], holdMeasuredIndices: [] } };
    expect(evidenceNote(page)).toContain('the action code of PP#1 only');
  });

  it('stays TRUE for a NON-CONTIGUOUS set — action codes on 1 and 2 but a target on 1 only', () => {
    const page = { ...EMPTY, evidence: { actionCodeIndices: [1, 2], targetByteIndices: [1], holdMeasuredIndices: [] } };
    const note = evidenceNote(page);
    expect(note).toContain('action codes of PP#1, PP#2');
    expect(note).toContain('target byte of PP#1 only');
    expect(note).not.toContain('PP#3'); // the old "PP#1–PP#2 range" could not name a gap; this one must not invent one
  });

  it('never claims an index that was not measured (a synthetic gap: PP#1 and PP#4)', () => {
    const page = { ...EMPTY, evidence: { actionCodeIndices: [1, 4], targetByteIndices: [4], holdMeasuredIndices: [] } };
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
    const page = { ...EMPTY, evidence: { actionCodeIndices: [], targetByteIndices: [], holdMeasuredIndices: [] } };
    const note = evidenceNote(page);
    expect(note).toContain('no action code has been measured');
    expect(note).toContain('no target byte has been measured');
  });
});
