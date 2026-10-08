// Display formatting for device params, shared by knobs, the grid meter HUD, and readouts.
// Computes the device-true value from the knob position (norm) + range, so it tracks live drags.
//
// ── Unknown (null) values ──────────────────────────────────────────────────────────────────────────
// ForgeFX can report a param it could not resolve as `value: null` + `norm: null` + an `unresolved`
// reason (a GLOBAL pid the assembled fn-0x1F body does not carry — the body is pid-indexed, not
// "non-positional"; see server/src/drivers/gen3.ts blockParams / its `unresolvedReason`).
// That is UNKNOWN, not 0: a real device zero is indistinguishable from a fabricated one, so a null
// must NEVER be read as 0. Every formatter here renders unknown as the em-dash `—` and `paramValue`
// returns `null` (not a number), so no arithmetic on an unknown value can silently become 0 or NaN.
//
// The unknown test keys on the SERVER's `unresolved` marker, with a missing position (`norm`) also
// meaning unknown — NEVER on "value and norm both happen to be null". A stray device-edit event can
// set `norm` on an unresolved param (P11: the event path used to upgrade it), and a keyed-on-both-null
// predicate would then read that fabricated position as a live, writable value.
export interface DispRange {
  norm?: number | null;
  value?: number | null;
  unit?: string;
  min?: number;
  max?: number;
  log?: boolean;
  /** Why the value is unknown — set by the server (with a null value) for an unresolvable param. Its
   *  presence means UNKNOWN regardless of a stray `norm`, and it dominates every read below. */
  unresolved?: string;
}

/** Whether a param carries a device-RESOLVED value. Unknown when the server marked it `unresolved`,
 *  or when there is no position (`norm`) to place a control — never inferred from "both null". */
export function paramKnown(p: DispRange): boolean {
  return p.unresolved == null && p.norm != null;
}

/**
 * The display value at a KNOWN knob position (`norm` is a real number), using the device-true range +
 * taper. Use this where the position is always a live number (a device push, a local write, a meter
 * seed): passing a null norm into `paramValue` there would be a fabricated reading, so those call
 * sites pass the known norm here explicitly and never coerce.
 *   Taper: `log:true` interpolates geometrically, otherwise linearly. NOTE: captured 'custom' taper
 *   shapes are served by ForgeFX as `log:false` for now, so Axis maps them linearly here (a deliberate
 *   initial approximation, not a true custom curve).
 */
export function paramValueAtNorm(norm: number, p: Omit<DispRange, 'norm'>): number {
  if (p.min == null || p.max == null) return p.value ?? norm * 10;
  return p.log && p.min > 0 ? p.min * Math.pow(p.max / p.min, norm) : p.min + norm * (p.max - p.min);
}

/**
 * The display value (number) at the current norm, or `null` when the value is UNKNOWN — NEVER a
 * fabricated 0 (which is indistinguishable from a real zero). A param with no served range falls back
 * to the shared 0..10 knob scale; a resolved device value with no position returns that value.
 */
export function paramValue(p: DispRange): number | null {
  if (p.unresolved != null) return null; // server marked it unresolved → never a number, even with a stray norm
  if (p.norm == null) return p.value ?? null; // position unknown → the device value if we have it, else unknown
  return paramValueAtNorm(p.norm, p);
}

/** Inverse of paramValue: a display value → knob position (norm 0..1), respecting the taper. */
export function normFromValue(value: number, p: { min?: number; max?: number; log?: boolean }): number {
  if (p.min == null || p.max == null || p.max === p.min) return 0;
  const n = p.log && p.min > 0 ? Math.log(value / p.min) / Math.log(p.max / p.min) : (value - p.min) / (p.max - p.min);
  return Math.max(0, Math.min(1, n));
}

/** Unit symbol for a readout ('' when none). */
export function paramUnit(p: DispRange): string {
  return p.min == null || p.max == null ? '' : p.unit ?? '';
}

/** Compact readout for a knob face (unit folded in: 1.2k, 63%, 5.1). Unknown → `—`, never 0. */
export function fmtCompact(p: DispRange): string {
  if (!paramKnown(p)) return '—';
  if (p.min == null || p.max == null) {
    if (p.norm != null) return (p.norm * 10).toFixed(1);
    return p.value != null ? String(p.value) : '—';
  }
  const v = paramValue(p);
  if (v == null) return '—';
  if (p.unit === 'Hz') return Math.abs(v) >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(v));
  if (p.unit === '%') return Math.round(v) + '%';
  return Math.abs(v) >= 100 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toFixed(1);
}

/** Big number for the HUD (no inline unit; unit shown separately via paramUnit). Unknown → `—`. */
export function fmtNumber(p: DispRange): string {
  // No device-true range → the shared 0..10 knob scale, exactly like paramValue()/fmtCompact() here and
  // the server's #display fallback (Math.round(norm*1000)/100 = norm*10). This branch used norm*100, so
  // an uncalibrated param read 10× its real value in the grid swipe HUD and the undo/redo labels.
  if (!paramKnown(p)) return '—';
  if (p.min == null || p.max == null) {
    if (p.norm != null) return Math.round(p.norm * 10) + '';
    return p.value != null ? String(Math.round(p.value)) : '—';
  }
  const v = paramValue(p);
  if (v == null) return '—';
  if (p.unit === 'Hz' && Math.abs(v) >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return Math.abs(v) >= 100 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toFixed(1);
}

/** Join an already-formatted number with its unit token for a readout.
 *  Device-true: tokens render verbatim (casing kept, e.g. `dB/OCT`, `SECONDS`) separated by a
 *  single space — except `%`, which attaches with no space by convention (63%, not 63 %).
 *  An empty/absent unit yields just the number: never a trailing space, double space, or `undefined`. */
export function withUnit(num: string, unit?: string): string {
  if (!unit) return num;
  return unit === '%' ? num + unit : num + ' ' + unit;
}

/** Full, readable value for the value bubble — device-true value at the current norm, unit folded in.
 *  Hz ≥ 1000 compacts to kHz (the ONLY conversion; new tokens like dB/OCT or SECONDS pass through
 *  verbatim). Uses withUnit() for spacing so every token renders consistently. Unknown → `—`. */
export function fmtValue(p: DispRange): string {
  const v = paramValue(p);
  if (v == null) return '—';
  if (p.unit === 'Hz' && Math.abs(v) >= 1000) {
    return (v / 1000).toFixed(v >= 10000 ? 1 : 2).replace(/\.?0+$/, '') + ' kHz';
  }
  const num = Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  return withUnit(num, paramUnit(p));
}
