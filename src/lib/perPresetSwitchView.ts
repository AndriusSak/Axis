// Presentation model for the PER-PRESET SWITCH definitions (§3.8), read from ForgeFX
// `GET /preset/switches` (see `forgefx.perPresetSwitches()`).
//
// Kept a plain TS module (no Svelte) so vitest can cover the HONESTY RULES without mounting a component:
//   • a row shows only what the decode OBSERVED. PP#1's offsets were measured; PP#2's action code was too,
//     but its target byte was never located (a flat one-per-switch array was measured and REFUTED), and
//     indices 3+ have no observed offset at all. An unobserved field renders as unobserved — never as a
//     value read out of a guessed position.
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
    // The target cell says three different things and they are NOT interchangeable: '' when the switch does
    // nothing, `index N (unlabelled)` when read but unnamed, `(target not located)` when its position is
    // unknown. Collapsing them would put a name next to a number that was never read.
    const targetLabel = s.targetIndex === null
      ? '(target not located)'
      : (assigned ? (s.targetLabel ?? `index ${s.targetIndex} (unlabelled)`) : '');
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

/**
 * How far the decode's evidence actually reaches, per field, counted from PP#1 — phrased for a human who has
 * to decide whether to trust a row. The counts come from the decoder, so this text cannot drift away from the
 * evidence the way a hardcoded sentence in a component would.
 */
export function evidenceNote(page: PerPresetSwitches | null | undefined): string {
  if (!page) return '';
  const a = page.evidence.actionCodesMeasured;
  const t = page.evidence.targetBytesMeasured;
  const codePart = a === 1 ? 'the action code of PP#1 only' : `the action codes of PP#1–PP#${a}`;
  const targetPart = t === 1 ? 'the target byte of PP#1 only' : `the target bytes of PP#1–PP#${t}`;
  return `Confirmed against real dumps: ${codePart}, ${targetPart}. Every other row shows only what was observed — rows with no observed offset read as “${UNREAD}”.`;
}
