// UNREAD-SAFE VALUE READS AND WRITE PLANS FOR THE FC WORKBENCH PART PANEL.
//
// WHY THIS EXISTS
// The panel used to read every field/slot with a `?? 0` fallback:
//   • `fieldNumber(f)`   → `Number(edits[`${f}:${cfg}`] ?? 0)`
//   • `slotNumber(s, i)` → `Number(edits[`${s}Params#${i}:${cfg}`] ?? fallback)`
// An UNREAD field therefore became `0`, indistinguishable from a real `0`. That is a fabrication,
// and worse, two controls wrote FROM it:
//   • the bool pill flipped `slotNumber(...) === 1 ? 0 : 1`, so pressing it on an UNREAD field
//     wrote a hard `1` to the device;
//   • the stepper computed `slotNumber(...) + delta` (i.e. `min ± 1`) and then DISPLAYED that guess
//     as if it were the unit's value.
//
// The rule this module enforces: a control that cannot know the current value must not write a
// delta from a guess. Every value read here returns `number | null`, where `null` means "the unit
// has not told us this yet". The step/toggle planners return `null` in that case and the `apply*`
// wrappers then do NOT call the writer at all — the refusal is in code, not in the operator's
// discipline, so a unit test can assert the write never happens.
//
// A fallback is still allowed for the RANGE (a slot's own min/max), never for the value written.

import { axisFcSlotBounds, type AxisFcSide, type AxisFcSlotLike } from './fcWorkbenchData';

/** Shown in place of a value the unit has not supplied — never a `0` that reads like a real one. */
export const FC_UNREAD_MARKER = '—';

/** The reason stated on a disabled control, so the operator knows why it cannot act. */
export const FC_UNREAD_REASON =
  'No value has been read from the unit yet — acting now would write a guess. Read the switch first.';

/** Runtime `edits` key for a value slot (`fcWorkbenchRuntime`'s own key shape). */
export function slotEditKey(side: AxisFcSide, slotIndex: number, config: number): string {
  return `${side}Params#${slotIndex}:${config}`;
}

/** Runtime `edits` key for a scalar field (`fcWorkbenchRuntime`'s own key shape). */
export function fieldEditKey(field: string, config: number): string {
  return `${field}:${config}`;
}

/**
 * The READ value of a value slot, or `null` when it has not been read. `null` ≠ 0: a real read of
 * `0` returns `0`, only an absent entry returns `null`.
 */
export function readSlotValue(
  edits: Record<string, number> | undefined,
  side: AxisFcSide,
  slotIndex: number,
  config: number
): number | null {
  const raw = edits?.[slotEditKey(side, slotIndex, config)];
  return raw == null ? null : Number(raw);
}

/** The READ value of a scalar field, or `null` when it has not been read. */
export function readFieldValue(
  edits: Record<string, number> | undefined,
  field: string,
  config: number
): number | null {
  const raw = edits?.[fieldEditKey(field, config)];
  return raw == null ? null : Number(raw);
}

/** A bool slot's live state: `true`/`false` when read, `null` when unread (never a fabricated off). */
export function readBoolSlot(
  edits: Record<string, number> | undefined,
  side: AxisFcSide,
  slotIndex: number,
  config: number
): boolean | null {
  const value = readSlotValue(edits, side, slotIndex, config);
  return value == null ? null : value === 1;
}

/** A writer the panel delegates to — the runtime's `writeSlot`, injected so a test can spy on it. */
export interface FcSlotWriter {
  writeSlot(side: AxisFcSide, slotIndex: number, value: number, config: number): Promise<boolean>;
}

/**
 * The value a step by `delta` should write, or `null` to REFUSE. Refuses when the current value is
 * unread: `min ± 1` from a fabricated 0 is not a step, it is a guess written to the device.
 * The slot's own min/max still clamp the result (range fallback only).
 */
export function planSlotStep(
  edits: Record<string, number> | undefined,
  side: AxisFcSide,
  slot: AxisFcSlotLike,
  config: number,
  delta: number
): number | null {
  const current = readSlotValue(edits, side, slot.i, config);
  if (current == null) return null;
  return axisFcSlotBounds(slot, current + delta).value;
}

/**
 * The value a bool toggle should write (1 when off, 0 when on), or `null` to REFUSE when the slot
 * is unread — pressing an unread pill used to write a hard `1`.
 */
export function planBoolToggle(
  edits: Record<string, number> | undefined,
  side: AxisFcSide,
  slotIndex: number,
  config: number
): number | null {
  const current = readSlotValue(edits, side, slotIndex, config);
  if (current == null) return null;
  return current === 1 ? 0 : 1;
}

/** Apply a step through `writer`, or return `false` and write NOTHING when the value is unread. */
export async function applySlotStep(
  writer: FcSlotWriter,
  edits: Record<string, number> | undefined,
  side: AxisFcSide,
  slot: AxisFcSlotLike,
  config: number,
  delta: number
): Promise<boolean> {
  const next = planSlotStep(edits, side, slot, config, delta);
  if (next == null) return false;
  return writer.writeSlot(side, slot.i, next, config);
}

/** Apply a bool toggle through `writer`, or return `false` and write NOTHING when the slot is unread. */
export async function applyBoolToggle(
  writer: FcSlotWriter,
  edits: Record<string, number> | undefined,
  side: AxisFcSide,
  slotIndex: number,
  config: number
): Promise<boolean> {
  const next = planBoolToggle(edits, side, slotIndex, config);
  if (next == null) return false;
  return writer.writeSlot(side, slotIndex, next, config);
}
