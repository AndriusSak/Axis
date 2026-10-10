// Presentation model for the PER-PRESET SWITCH definitions (§3.8), read from ForgeFX
// `GET /preset/switches` (see `forgefx.perPresetSwitches()`).
//
// Kept a plain TS module (no Svelte) so vitest can cover the HONESTY RULES without mounting a component:
//   • a row shows only what the decode OBSERVED. PP#1–PP#3 have BOTH offsets observed (action code at
//     marker+4/6/8, target byte at marker+148/160/172 — the last two confirmed by prediction); indices 4+
//     have no observed offset at all. An unobserved field renders as unobserved — never as a value read out
//     of a guessed position.
//   • a target with no measured anchor shows its raw INDEX. "Index 9" is a fact; "FB Snd" would be a guess,
//     and a guess in a name column is indistinguishable from a measurement to whoever reads it.
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
  targetIndex: number | null;
  /** The FX-slot name for a MEASURED anchor, the raw index, `(target not located)`, or the unread marker. */
  targetLabel: string;
  /** The action code can be written (its offset is observed). */
  canWriteAction: boolean;
  /** The target byte can be written (its offset has been LOCATED). */
  canWriteTarget: boolean;
}

const hex16 = (v: number): string => `0x${v.toString(16).padStart(2, '0')}`;

/** For a field the decode cannot read AT ALL — deliberately distinct from "reads as zero". */
const UNREAD = '—';

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
      canWriteTarget: s.targetIndex !== null
    };
    if (!known) {
      return { ...base, assigned: null, actionCode: null, actionLabel: UNREAD, targetIndex: null, targetLabel: UNREAD };
    }
    const assigned = s.actionCode !== 0;
    const actionLabel = s.action
      ? s.action
      : (s.actionCode === 0 ? 'unassigned' : `code ${hex16(s.actionCode as number)} (unmeasured)`);
    // The target cell says several different things and they are NOT interchangeable: '' when the switch does
    // nothing, an anchor NAME when the index is named, `index N (unlabelled)` when read but unnamed,
    // `(target not located)` when its position is unknown. Collapsing them would put a name next to a number
    // that was never read.
    //
    // The decoded anchor names are an FX-SLOT table — every anchor was measured with the action set to
    // Effect: Bypass — so a name may only be applied to a row whose action IS an effect action. A scene
    // action's target byte is a scene number (capture B: PP#2 = Scene: Select, target byte 1; calling that
    // "Cab 1" would be a claim nobody measured), and an unmeasured action code is unknown by definition. In
    // both cases the observed INDEX is still shown — the number is a fact, the name would not be.
    const EFFECT_BYPASS_CODE = 0x04;
    const anchorApplies = assigned && s.actionCode === EFFECT_BYPASS_CODE;
    const targetLabel = s.targetIndex === null
      ? '(target not located)'
      : (assigned ? (anchorApplies ? (s.targetLabel ?? `index ${s.targetIndex} (unlabelled)`) : `index ${s.targetIndex} (unlabelled)`) : '');
    return { ...base, assigned, actionCode: s.actionCode, actionLabel, targetIndex: s.targetIndex, targetLabel };
  });
}

/** The raw editor fields for a switch write, as the panel's inputs hold them (all strings). */
export interface SwitchFields {
  actionCode: string;
  targetIndex: string;
}

/**
 * Turn the raw inputs into the write payload, or null when there is nothing usable.
 *
 * An EMPTY input means "leave this field alone" — and a non-numeric or out-of-range value is DROPPED rather
 * than sent (the server would answer 400, but a UI that sends nonsense is a UI that lies about what it did).
 * Action codes are 16-bit; a target index is one byte.
 */
export function switchPatchFromFields(f: SwitchFields): PerPresetSwitchPatch | null {
  const patch: PerPresetSwitchPatch = {};
  const action = f.actionCode.trim();
  const target = f.targetIndex.trim();
  if (/^\d+$/.test(action) && Number(action) <= 0xffff) patch.actionCode = Number(action);
  if (/^\d+$/.test(target) && Number(target) <= 0xff) patch.targetIndex = Number(target);
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
 */
export function evidenceNote(page: PerPresetSwitches | null | undefined): string {
  if (!page) return '';
  const a = [...page.evidence.actionCodeIndices].sort((x, y) => x - y);
  const t = [...page.evidence.targetByteIndices].sort((x, y) => x - y);
  const codePart = a.length === 0
    ? 'no action code has been measured'
    : `the action code${a.length === 1 ? '' : 's'} of ${ppIndexList(a)}${a.length === 1 ? ' only' : ''}`;
  const targetPart = t.length === 0
    ? 'no target byte has been measured'
    : `the target byte${t.length === 1 ? '' : 's'} of ${ppIndexList(t)}${t.length === 1 ? ' only' : ''}`;
  return `Confirmed against real dumps: ${codePart}, ${targetPart}. Every other row shows only what was observed — rows with no observed offset read as “${UNREAD}”.`;
}
