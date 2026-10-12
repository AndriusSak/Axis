// NAMED PICKER OPTIONS FOR THE FC (Foot Controller, eid 199) "Effect" BLOCK-TYPED VALUE SLOT.
//
// The FM3 FC editor's per-function value slots include slots typed `'block'` — the "which effect"
// selector for the Effect category (Bypass / Chan Select / Chan Toggle / Chan Inc-Dec; see forgefx-midi
// `gen3/fm3/fcFunctions.ts`). FcEditor used to render that slot as a BARE NUMBER input with the hint
// "block id" — the owner reported it on the Steam Deck: the footswitch's assigned effect shows as a
// number, while the unit's own editor shows the block's NAME.
//
// WHERE THE NAMES COME FROM (and what is NOT measured):
//   • The served FC model (`GET /fc/model`) carries NO name table for a `'block'` slot — the slot is
//     `{ role: 'Effect', type: 'block' }` and nothing else (types.ts `FcSlot`). The live read
//     (`GET /fc/state`) returns only the scalar category/function/display/colour ordinals, NOT the
//     value block, so the panel never had a real id to show — it rendered the `?? 0` fallback.
//   • The names are therefore derived CLIENT-SIDE from the preset's PLACED BLOCKS
//     (`GET /preset/grid` → `GridCell { effectId, name }`). This module is PURE: the roster is an
//     argument, never a fetch, so it is unit-tested without mounting the component.
//   • HYPOTHESIS (not a measurement): the `'block'` slot's VALUE SPACE — whether it holds a placed
//     block's `effectId` (the grid's own id) or an FX-slot ANCHOR index (the space the per-preset
//     switch target byte is measured to use, `PP_TARGET_ANCHORS`) — has NOT been decoded on the wire.
//     The FC interiors are explicitly unknown (gen3.ts `fcReadSwitch`). This module names a value by
//     matching it against the grid's `effectId`; a value that matches no placed block is MARKED (see
//     below) so a wrong-space id renders as an explicit marker, never a false name.
//
// HONESTY RULES (the same three the per-preset switch module enforces):
//   • WHERE A NAME IS NOT MEASURED, SAY SO. A value with no matching placed block, an unread value, and
//     a placed block whose name the grid did not serve are each marked explicitly — never a bare number
//     that reads like a real entry, and never a guess at the nearest plausible block.
//   • A CAPPED ROSTER DISCLOSES ITS CAP. The roster is only the CURRENT preset's placed blocks
//     (routing shunts excluded — a shunt is not an assignable effect). `fcBlockRosterNote()` states
//     that boundary so the select is never presented as the device's whole effect list.
//   • NEVER INVENT A NAME. An option the roster cannot name says `id N (…)`; it is not filled with a
//     nearby block's name.

/** The minimum a placed block must carry to be named: the grid's own cell fields. */
export interface FcBlockCell {
  /** Device effect id of a placed block (`GridCell.effectId`). */
  effectId: number;
  /** The block's display name as the unit's editor shows it ("Amp 1", "Delay 2", …). */
  name: string;
  /** A routing shunt — not an assignable effect, so it is not offered. */
  isShunt?: boolean;
}

/** One choice in the block picker. `value` is the exact number written; `label` what the user reads. */
export interface FcBlockOption {
  value: number;
  label: string;
  /** True when the roster named this value from a placed block. False = the option shows the raw id,
   *  marked unmeasured; picking it still writes the number, it just is not named. */
  named: boolean;
}

/** Hex form for an id, so a marker is identifiable rather than a bare decimal. */
const hex16 = (v: number): string => `0x${(v & 0xffff).toString(16).padStart(2, '0')}`;

/** True when the cell is a real, id-bearing placed block (not a shunt, not a malformed row). */
function isPlacedBlock(c: FcBlockCell): boolean {
  return !c.isShunt && Number.isInteger(c.effectId);
}

/**
 * The placed, named, non-shunt blocks as picker options, in the GRID'S OWN ORDER (the signal chain),
 * de-duplicated by effectId. A placed block whose name the grid did not serve is still offered — as
 * `id N (unnamed)`, marked — so a value that points at it is not silently unreachable.
 */
export function fcBlockOptions(cells: readonly FcBlockCell[]): FcBlockOption[] {
  const out: FcBlockOption[] = [];
  const seen = new Set<number>();
  for (const c of cells) {
    if (!isPlacedBlock(c) || seen.has(c.effectId)) continue;
    seen.add(c.effectId);
    const name = typeof c.name === 'string' ? c.name.trim() : '';
    out.push({ value: c.effectId, label: name || `id ${c.effectId} (unnamed)`, named: !!name });
  }
  return out;
}

/** How many placed blocks the roster names (shunts and unnamed rows excluded). */
export function namedFcBlockCount(cells: readonly FcBlockCell[]): number {
  return fcBlockOptions(cells).filter((o) => o.named).length;
}

/**
 * The option for the slot's CURRENT value, even when the roster does not contain it.
 *
 *   • a placed block         → its name (`named: true`).
 *   • a routing shunt id      → `id N (a routing shunt)` — placed, but not an assignable effect.
 *   • any other number        → `id N (not a placed block)` — the id, MARKED unmeasured.
 *   • `null` (no value read)  → `—`, never a `0` that reads like a real first block.
 */
export function fcBlockOptionFor(cells: readonly FcBlockCell[], value: number | null): FcBlockOption {
  if (value === null) return { value: 0, label: '—', named: false };
  const hit = fcBlockOptions(cells).find((o) => o.value === value);
  if (hit) return hit;
  const shunt = cells.some((c) => c.isShunt && c.effectId === value);
  return { value, label: `id ${value} ${shunt ? '(a routing shunt)' : '(not a placed block)'}`, named: false };
}

/**
 * The roster WITH the slot's current value guaranteed present (a marked option when the value matches
 * no placed block). Without this the row could not display — or re-write — its own value without the
 * select silently snapping to a different block.
 */
export function fcBlockOptionsIncluding(cells: readonly FcBlockCell[], value: number | null): FcBlockOption[] {
  const list = fcBlockOptions(cells);
  if (value !== null && !list.some((o) => o.value === value)) {
    list.push(fcBlockOptionFor(cells, value));
  }
  return list;
}

/**
 * The cap disclosure for the block select. The roster is the CURRENT preset's placed blocks — an
 * unknown-to-the-client subset boundary (a preset may not be loaded, and the device's own effect list
 * may be wider) — so the select must say what it covers rather than read as the device's whole list.
 */
export function fcBlockRosterNote(cells: readonly FcBlockCell[]): string {
  const placed = cells.filter(isPlacedBlock).length;
  const shunts = cells.filter((c) => c.isShunt).length;
  if (!placed) {
    return 'No placed block was served for this preset, so the block roster is empty and the assignment is shown as its id.';
  }
  const named = namedFcBlockCount(cells);
  const shuntNote = shunts
    ? ` (${shunts} routing shunt${shunts === 1 ? '' : 's'} not shown — a shunt is not an assignable effect)`
    : '';
  return (
    `The roster is the current preset's ${placed} placed block${placed === 1 ? '' : 's'}${shuntNote}; ` +
    `${named} named by the grid. A value that matches no placed block is shown and written as its id, ` +
    `marked — never guessed at a nearest block.`
  );
}

/** The raw id, kept AVAILABLE but secondary: `id 46 (0x2e)`. */
export function fcBlockRawHint(value: number | null): string {
  return value === null ? 'id —' : `id ${value} (${hex16(value)})`;
}

/** The one-line caveat the panel shows under the block field: the value space is not measured. */
export const FC_BLOCK_VALUE_SPACE_CAVEAT =
  'The FC \u201cEffect\u201d slot\u2019s value space has not been decoded on the wire, so this picker names the value ' +
  'by matching the preset\u2019s placed blocks; an id that matches none is shown marked, not guessed.';
