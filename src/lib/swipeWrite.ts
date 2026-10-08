// Pure decision for a swipe-control adjustment (the on-grid block tile's vertical drag / wheel).
//
// A swipe writes a CONTINUOUS knob value to the device, derived from the control's current meter
// READING plus the drag delta. A write must NEVER be derived from an assumed reading: if there is no
// honest reading for the active control (never polled, or an unresolved param whose value was
// deliberately not seeded) there is no position to adjust FROM. The former inline code fell back to an
// invented `(prev?.norm ?? 0.5)` and wrote ~50% of the param — a value nobody read — straight to the
// device. This returns null instead, and the caller writes nothing.
//
// Framework-free (no runes / DOM) so it is unit-tested directly; `editor.svelte.ts` is the only caller.

import { paramValueAtNorm } from './format';
import type { MeterVal } from './types';

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** The adjusted position + display value for a swipe, or null when there is no reading to adjust from
 *  (a refuse-the-write signal). `norm` is the clamped 0..1 payload the CONTINUOUS write sends; `value`
 *  is the device-true display value computed from the reading's own range/taper. */
export function planSwipe(prev: MeterVal | undefined, deltaNorm: number): { norm: number; value: number } | null {
  if (!prev) return null;
  const norm = clamp01(prev.norm + deltaNorm);
  return { norm, value: paramValueAtNorm(norm, { min: prev.min, max: prev.max, unit: prev.unit, log: prev.log }) };
}
