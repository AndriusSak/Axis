/**
 * HIL INDEPENDENT DEVICE-BYTE ORACLE — a SECOND decode path for a served value.
 *
 * WHY (2026-10-12, the incident this whole harness exists to catch): the render-vs-wire oracle fetched
 * the SAME endpoint the UI reads, so a wrong SERVER value passed — the app, the server and the harness
 * all agreed on `Room Diffusion 52.287` while the unit held `0`. On that preset the wrong number came
 * from a REBUILT device cache, i.e. from the runtime profile geometry (stride/offset/scale), not from
 * the device bytes.
 *
 * This oracle reads the block's RAW bytes (`GET /preset/blocks/:eid/raw`, which are POSITIONAL and
 * UNSLICED — `values[i]` is the i-th u16 the device returned) and decodes
 * `values[channel * FM3_RANGE_SECTIONS[family].stride + pid]` with the STATIC hardware-derived range
 * table shipped in the codec (`FM3_RANGES` / `FM3_RANGE_SECTIONS`, `forgefx-midi/gen3/fm3`). It shares
 * the device BYTES with the server but NONE of the runtime profile's geometry, so it cannot inherit a
 * cache-rebuild bug — exactly the failure mode that let `52.287 vs 0` through with no human in the loop.
 *
 * The decode arithmetic is re-implemented here (linear + log10) from the device value model
 * (u16 0..65534 → displayMin..displayMax) rather than borrowing the server's resolver, so it is a
 * genuinely independent path. Both candidate tapers are evaluated and either is accepted, so a
 * legitimate log knob is never a false red; a value matching NEITHER is a finding.
 */
import { FM3_RANGES, FM3_RANGE_SECTIONS } from 'forgefx-midi/gen3/fm3';

export type RawValues = Record<number, number> | readonly number[] | null | undefined;

export interface OracleDecode {
  family: string;
  pid: number;
  channel: number;
  /** Position in the raw values array (`channel*stride + pid`). */
  index: number;
  /** The raw u16 (absent in the sparse record ⇒ the device holds 0). */
  raw: number;
  kind: 'enum' | 'float';
  /** Linear decode, display units (null for an enum — an enum's value IS its ordinal). */
  valueLinear: number | null;
  /** log10 decode, display units (null when not applicable). */
  valueLog: number | null;
}

const strideOf = (family: string): number | null => (FM3_RANGE_SECTIONS as Record<string, { stride: number } | undefined>)[family]?.stride ?? null;

const at = (raw: RawValues, index: number): number => {
  if (raw == null) return 0;
  const v = Array.isArray(raw) ? raw[index] : (raw as Record<number, number>)[index];
  return Number.isFinite(v as number) ? (v as number) : 0;
};

/** Decode the raw bytes for one (family, pid, channel) with the STATIC table. */
export function decodeRaw(rawValues: RawValues, family: string, pid: number, channel = 0): OracleDecode | null {
  const stride = strideOf(family);
  const row = (FM3_RANGES as Record<string, Record<number, any> | undefined>)[family]?.[pid];
  if (stride == null || !row) return null;
  const index = channel * stride + pid;
  const raw = at(rawValues, index);
  const kind: 'enum' | 'float' = row.kind === 'enum' ? 'enum' : 'float';
  if (kind === 'enum') return { family, pid, channel, index, raw, kind, valueLinear: null, valueLog: null };
  const min = row.displayMin;
  const max = row.displayMax;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return { family, pid, channel, index, raw, kind, valueLinear: 0, valueLog: 0 }; // placeholder row (0..0)
  }
  const linear = min + (raw / 65534) * (max - min);
  const logv = min > 0 ? min * Math.pow(max / min, raw / 65534) : null;
  return { family, pid, channel, index, raw, kind, valueLinear: linear, valueLog: logv };
}

export interface OracleVerdict {
  ok: boolean;
  /** Channel whose decode matched the served value (−1 when none did). */
  channel: number;
  /** 'enum' | 'linear' | 'log10' | 'none' — which decode path matched. */
  mode: 'enum' | 'linear' | 'log10' | 'none';
  decoded: number | null;
  tol: number;
  detail: string;
}

/** A tolerant comparison: one wire quantum of the row's own display span, floored. */
function tolerance(min: number, max: number): number {
  return Math.max(1e-3, Math.abs(max - min) * 1e-4);
}

/**
 * Compare the served value to an INDEPENDENT decode of the raw bytes. Tries channels 0..3 (the served
 * payload does not say which channel it reflects), and both linear/log10 tapers; a match on ANY is a
 * pass. A served value matching NONE of the decodes is a FINDING (the bug class this catches).
 */
export function verifyServedAgainstRaw(
  rawValues: RawValues,
  family: string,
  pid: number,
  servedValue: number,
  channels: readonly number[] = [0, 1, 2, 3]
): OracleVerdict {
  const row = (FM3_RANGES as Record<string, Record<number, any> | undefined>)[family]?.[pid];
  if (!row) return { ok: false, channel: -1, mode: 'none', decoded: null, tol: 0, detail: `no static range row for ${family} pid ${pid}` };
  const tol = row.kind === 'enum' ? 0 : tolerance(row.displayMin, row.displayMax);
  let bestDetail = `served ${servedValue} matched no channel/taper of the static decode`;
  for (const ch of channels) {
    const d = decodeRaw(rawValues, family, pid, ch);
    if (!d) continue;
    if (d.kind === 'enum') {
      if (d.raw === Math.round(servedValue)) return { ok: true, channel: ch, mode: 'enum', decoded: d.raw, tol: 0, detail: `ordinal ${d.raw}` };
      bestDetail = `enum: raw ordinal ${d.raw} != served ${servedValue}`;
      continue;
    }
    if (d.valueLinear != null && Math.abs(d.valueLinear - servedValue) <= tol) {
      return { ok: true, channel: ch, mode: 'linear', decoded: d.valueLinear, tol, detail: `linear ${d.valueLinear.toFixed(4)} (Δ ${Math.abs(d.valueLinear - servedValue).toFixed(4)})` };
    }
    if (d.valueLog != null && Math.abs(d.valueLog - servedValue) <= tol) {
      return { ok: true, channel: ch, mode: 'log10', decoded: d.valueLog, tol, detail: `log10 ${d.valueLog.toFixed(4)}` };
    }
    bestDetail = `raw[${d.index}]=${d.raw} decodes to ${d.valueLinear?.toFixed(4)} (linear) / ${d.valueLog?.toFixed(4) ?? 'n/a'} (log10), served ${servedValue}`;
  }
  return { ok: false, channel: -1, mode: 'none', decoded: null, tol, detail: bestDetail };
}

/** The static stride the oracle uses for a family (exposed so the report can state it). */
export const oracleStride = strideOf;

/** The static DEFAULT display value of a param (from `defaultRaw`), or undefined when unknown/enum.
 *  Used to mark a served value that merely equals the default as a VACUOUS (weak) pass. */
export function defaultDisplay(family: string, pid: number): number | undefined {
  const row = (FM3_RANGES as Record<string, Record<number, any> | undefined>)[family]?.[pid];
  if (!row || row.kind !== 'float') return undefined;
  const dr = row.defaultRaw;
  if (dr == null || !Number.isFinite(row.displayMin) || !Number.isFinite(row.displayMax) || row.displayMax <= row.displayMin) return undefined;
  return row.displayMin + (dr / 65534) * (row.displayMax - row.displayMin);
}
