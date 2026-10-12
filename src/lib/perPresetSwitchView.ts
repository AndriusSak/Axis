// Presentation model for the PER-PRESET SWITCH definitions (§3.8), read from ForgeFX
// `GET /preset/switches` (see `forgefx.perPresetSwitches()`).
//
// Kept a plain TS module (no Svelte) so vitest can cover the HONESTY RULES without mounting a component:
//   • a row shows only what the decode OBSERVED. All 24 action codes and their offsets were located by
//     prediction across nine captures; a field whose offset is unobserved renders as unobserved — never as a
//     value read out of a guessed position.
//   • a target with no measured anchor shows its raw INDEX. "Index 9" is a fact; "FB Snd" would be a guess,
//     and a guess in a name column is indistinguishable from a measurement to whoever reads it.
//   • an anchor NAME is only printed where the device was measured to store an FX-slot index there — the
//     server decides that (`targetIsFxSlot`) and this module follows it rather than re-deriving it.
//   • which fields may be WRITTEN is per FIELD, straight from the decoder's table — the UI must not offer a
//     write the server will refuse, nor hide one it would accept.
import type { PerPresetSwitch, PerPresetSwitches, PerPresetSwitchPatch } from './types';

/** How much of a row is observed — mirrors the decoder's own three-way split. */
export type SwitchConfidence = 'measured' | 'partial' | 'unknown';

/** One switch row as the UI renders it. */
export interface SwitchRow {
  index: number;
  confidence: SwitchConfidence;
  /** True when any field is observed: a row with no observed offset can be listed but not read. */
  known: boolean;
  /** Whether the switch performs an action — from its ACTION CODE. Null when that offset is unobserved. */
  assigned: boolean | null;
  actionCode: number | null;
  /** The action's name, `code 0xNN (unmeasured)`, `unassigned`, or the unread marker. */
  actionLabel: string;
  /** The TAP's function within its category — a measured name, `entry N (unnamed)`, or '' when unassigned. */
  functionLabel: string;
  targetIndex: number | null;
  /** The FX-slot name for a MEASURED anchor, the raw index, `(target not located)`, or the unread marker. */
  targetLabel: string;
  /** The HOLD side, beside the TAP: `unassigned`, a category name, `code 0xNN (unmeasured)`, or the unread marker. */
  holdLabel: string;
  holdActionCode: number | null;
  /**
   * True when the HOLD reads as Unassigned but was NEVER EXERCISED on the unit — the codec's `holdMeasured`
   * inverted for display. A zero is then a convention, not an observation, and the row says so.
   */
  holdUnexercised: boolean;
  /** The action code can be written (its offset is observed). */
  canWriteAction: boolean;
  /** The target byte can be written (its offset has been LOCATED). */
  canWriteTarget: boolean;
  /** The HOLD action code can be written (the HOLD array is located — see the codec). */
  canWriteHold: boolean;
}

const hex16 = (v: number): string => `0x${v.toString(16).padStart(2, '0')}`;

/** For a field the decode cannot read AT ALL — deliberately distinct from "reads as zero". */
const UNREAD = '—';

/**
 * Why the FX-slot anchor name is withheld for this row. Two different reasons, and they are not interchangeable:
 * an Effect row whose FUNCTION was never OBSERVED (the mode is what the name depends on — all four Effect
 * functions have now been measured on the wire, so this means an unread function index), versus a row of any
 * other category, whose byte means something else entirely (a scene number, a preset number, a layout …).
 */
function withheldReason(s: PerPresetSwitch): string {
  if (s.actionCode === 0x04) {
    // The Effect category is FULLY measured as of 2026-10-12 — Bypass and Chan Select on 2026-10-11, Chan Toggle
    // and Chan Inc/Dec on 2026-10-12 — and the decode always reports a numeric function index, so what reaches
    // this branch is a function index OUTSIDE that measured set (a value a firmware update could introduce, or
    // stale bytes). It fails closed: a number, and the reason, rather than the nearest plausible block name.
    return `name withheld: effect function ${s.functionIndex}${s.functionName ? ` (${s.functionName})` : ''} is not one of the four whose byte has been measured`;
  }
  if (!s.action) {
    // An unmeasured CODE has no category to reason from, so the reason is the missing list itself.
    return `name withheld: code ${hex16(s.actionCode as number)} is unmeasured, so it has no function list to reason from`;
  }
  const category = s.action.split(' ')[0]?.replace(/:$/, '') || 'this';
  return `not an FX slot — a ${category} row stores its own kind of value here`;
}

/** Build the renderable rows. A null/absent block yields none — never a fabricated twelve. */
export function switchRows(page: PerPresetSwitches | null | undefined): SwitchRow[] {
  if (!page) return [];
  return page.switches.map((s: PerPresetSwitch): SwitchRow => {
    const known = s.confidence !== 'unknown' && s.actionCode !== null;
    const base = {
      index: s.index,
      confidence: s.confidence,
      known,
      canWriteAction: known,
      canWriteTarget: s.targetIndex !== null,
      canWriteHold: known
    };
    if (!known) {
      return {
        ...base, assigned: null, actionCode: null, actionLabel: UNREAD, functionLabel: UNREAD,
        targetIndex: null, targetLabel: UNREAD, holdLabel: UNREAD, holdActionCode: null, holdUnexercised: false
      };
    }
    const assigned = s.actionCode !== 0;
    const actionLabel = s.action
      ? s.action
      : (s.actionCode === 0 ? 'unassigned' : `code ${hex16(s.actionCode as number)} (unmeasured)`);
    // No function claim for an unassigned row, and none for a code nobody has measured — the index beside an
    // unmeasured code would be a number about a category nobody can name.
    const functionLabel = !assigned || !s.action
      ? ''
      : (s.functionName ?? `entry ${s.functionIndex} (unnamed)`);
    // The target cell says several different things and they are NOT interchangeable: '' when the switch does
    // nothing, an anchor NAME when the device was measured to store an FX-slot index there, `index N (…)` when
    // the byte is observed but not a slot, `(target not located)` when its position is unknown. Collapsing them
    // would put a name next to a number that was never read, or hide the reason a name is missing.
    const targetLabel = s.targetIndex === null
      ? '(target not located)'
      : (!assigned
        ? ''
        : (s.targetIsFxSlot
          ? (s.targetLabel ?? `index ${s.targetIndex} (unlabelled)`)
          : `index ${s.targetIndex} (${withheldReason(s)})`));
    const holdActionCode = s.holdActionCode;
    const holdLabel = holdActionCode === 0 ? 'unassigned' : (s.holdAction ?? `code ${hex16(holdActionCode)} (unmeasured)`);
    return {
      ...base, assigned, actionCode: s.actionCode, actionLabel, functionLabel,
      targetIndex: s.targetIndex, targetLabel, holdLabel, holdActionCode,
      holdUnexercised: holdActionCode === 0 && !s.holdMeasured
    };
  });
}

/** The raw editor fields for a switch write, as the panel's inputs hold them (all strings). */
export interface SwitchFields {
  actionCode: string;
  targetIndex: string;
  holdActionCode: string;
}

/**
 * Turn the raw inputs into the write payload, or null when there is nothing usable.
 *
 * An EMPTY input means "leave this field alone" — and a non-numeric or out-of-range value is DROPPED rather
 * than sent (the server would answer 400, but a UI that sends nonsense is a UI that lies about what it did).
 * Action codes and HOLD codes are 16-bit; a target index is one byte.
 */
export function switchPatchFromFields(f: SwitchFields): PerPresetSwitchPatch | null {
  const patch: PerPresetSwitchPatch = {};
  const action = f.actionCode.trim();
  const target = f.targetIndex.trim();
  const hold = f.holdActionCode.trim();
  if (/^\d+$/.test(action) && Number(action) <= 0xffff) patch.actionCode = Number(action);
  if (/^\d+$/.test(target) && Number(target) <= 0xff) patch.targetIndex = Number(target);
  if (/^\d+$/.test(hold) && Number(hold) <= 0xffff) patch.holdActionCode = Number(hold);
  return Object.keys(patch).length ? patch : null;
}

/** A one-line, honest summary of a switch write verdict. */
export function switchWriteVerdict(result: { ok: boolean; reason?: string }): string {
  if (result.ok) return 'Written to the unit’s edit buffer (not saved — reloading the preset discards it).';
  return `NOT confirmed by the unit${result.reason ? ` (${result.reason})` : ''} — the switch still reads as shown.`;
}

/** Name a set of switch indices for a human: "PP#1", "PP#1, PP#4", "PP#1, PP#2, PP#4". NEVER a range — the
 *  offset table has no stride, so the observed indices need not be adjacent and a range would over-claim. */
function ppIndexList(indices: readonly number[]): string {
  return [...indices].sort((a, b) => a - b).map((i) => `PP#${i}`).join(', ');
}

/**
 * Which switch indices the decode's evidence actually reaches, per field — phrased for a human who has to
 * decide whether to trust a row. The indices come from the decoder's own measured-offset table, so this text
 * cannot drift from the evidence the way a hardcoded sentence in a component would. Naming the indices (not a
 * count rendered as "PP#1–PP#n") is what keeps the sentence true when the measured indices are NOT contiguous.
 *
 * The HOLD half is a third line and it means something DIFFERENT in kind: those are the rows whose HOLD was
 * actually exercised on the unit, not rows whose offset was located. Both are reported, and the sentence says
 * which is which — that is the difference between "the array is located" and "this row was proven".
 */
export function evidenceNote(page: PerPresetSwitches | null | undefined): string {
  if (!page) return '';
  const a = [...page.evidence.actionCodeIndices].sort((x, y) => x - y);
  const t = [...page.evidence.targetByteIndices].sort((x, y) => x - y);
  const h = [...(page.evidence.holdMeasuredIndices ?? [])].sort((x, y) => x - y);
  const codePart = a.length === 0
    ? 'no action code has been measured'
    : `the action code${a.length === 1 ? '' : 's'} of ${ppIndexList(a)}${a.length === 1 ? ' only' : ''}`;
  const targetPart = t.length === 0
    ? 'no target byte has been measured'
    : `the target byte${t.length === 1 ? '' : 's'} of ${ppIndexList(t)}${t.length === 1 ? ' only' : ''}`;
  const holdPart = h.length === 0
    ? 'No HOLD has been exercised on this unit'
    : `the HOLD was exercised on ${ppIndexList(h)}`;
  return `Confirmed against real dumps: ${codePart}, ${targetPart}. ${holdPart} — every other row's HOLD reads Unassigned by the same convention the TAP side uses for an unassigned row, which is a convention and not an observation. Every other row shows only what was observed: rows with no observed offset read as “${UNREAD}”.`;
}
