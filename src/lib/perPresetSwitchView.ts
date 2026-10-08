// Presentation model for the PER-PRESET SWITCH definitions (§3.8), read from ForgeFX
// `GET /preset/switches` (see `forgefx.perPresetSwitches()`).
//
// Kept a plain TS module (no Svelte) so vitest can cover the two HONESTY RULES without mounting a
// component:
//   • a row is only as good as its confidence. PP#1's byte offsets were measured on the wire; every other
//     row is INFERRED, and the UI must say so rather than present twelve readings it does not have.
//   • a target with no measured anchor shows its raw INDEX. "Index 9" is a fact; "FB Snd" would be a
//     guess, and a guess in a name column is indistinguishable from a measurement to whoever reads it.
import type { PerPresetSwitch, PerPresetSwitches, PerPresetSwitchPatch } from './types';

/** One switch row as the UI renders it. */
export interface SwitchRow {
  index: number;
  /** True when the row reports an actual assignment (action code and target both zero = unconfigured). */
  assigned: boolean;
  actionCode: number;
  /** The action's name, or `code 0xNN` when the code itself is unmeasured — never a made-up function. */
  actionLabel: string;
  targetIndex: number;
  /** The FX-slot name for a MEASURED anchor, `index N (unlabelled)` otherwise, '' when unconfigured. */
  targetLabel: string;
  confidence: 'measured' | 'inferred';
  /** Only PP#1 may be written: its offsets are the only ones ever observed. */
  editable: boolean;
}

const hex16 = (v: number): string => `0x${v.toString(16).padStart(2, '0')}`;

/** Build the renderable rows. A null/absent block yields none — never a fabricated twelve. */
export function switchRows(page: PerPresetSwitches | null | undefined): SwitchRow[] {
  if (!page) return [];
  return page.switches.map((s: PerPresetSwitch): SwitchRow => {
    const assigned = !(s.actionCode === 0 && s.targetIndex === 0);
    return {
      index: s.index,
      assigned,
      actionCode: s.actionCode,
      actionLabel: s.action
        ? s.action
        : (s.actionCode === 0 ? 'unassigned' : `code ${hex16(s.actionCode)} (unmeasured)`),
      targetIndex: s.targetIndex,
      targetLabel: assigned
        ? (s.targetLabel ?? `index ${s.targetIndex} (unlabelled)`)
        : '',
      confidence: s.confidence,
      editable: s.confidence === 'measured'
    };
  });
}

/** The raw editor fields for the PP#1 write, as the panel's inputs hold them (all strings). */
export interface SwitchFields {
  actionCode: string;
  targetIndex: string;
}

/**
 * Turn the raw inputs into the write payload, or null when there is nothing usable.
 *
 * An EMPTY input means "leave this field alone" — and a non-numeric or out-of-range value is DROPPED
 * rather than sent (the server would answer 400, but a UI that sends nonsense is a UI that lies about
 * what it did). Action codes are 16-bit; a target index is one byte.
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
 * How far the decode's evidence actually reaches, per field, counted from PP#1 — phrased for a human who
 * has to decide whether to trust a row. The counts come from the decoder, so this text cannot drift away
 * from the evidence the way a hardcoded sentence in a component would.
 */
export function evidenceNote(page: PerPresetSwitches | null | undefined): string {
  if (!page) return '';
  const a = page.evidence.actionCodesMeasured;
  const t = page.evidence.targetBytesMeasured;
  const codePart = a === 1 ? 'the action code of PP#1 only' : `the action codes of PP#1–PP#${a}`;
  const targetPart = t === 1 ? 'the target byte of PP#1 only' : `the target bytes of PP#1–PP#${t}`;
  return `Confirmed against real dumps: ${codePart}, ${targetPart}. Every other row is extrapolated from the same geometry and may be wrong.`;
}
