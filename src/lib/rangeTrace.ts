// Pure helpers over the ForgeFX `GET /diag/ranges` trace (server/src/app.ts:140). The endpoint is
// READ-ONLY and answers the recurring parity-audit question "why is this control missing?" (§3.6
// item 3, §5.1). Per paramId it returns two rows:
//
//   • serving   — the merged row that actually SERVES the param (device self-describe wins where it
//                 has one). null here is why the control is absent from the served param list.
//   • catalogue — the static definition Axis ships. Its presence while `serving` is null means an
//                 allowlist gate (KNOB_UNITS, gen3.ts:141) dropped the row, not that it was unknown.
//
// Keeping the classification here (not in the .svelte panel) makes it unit-testable in this repo's
// node-env vitest, which cannot mount components.

export interface RangeSpan {
  kind: string;
  min: number;
  max: number;
}

export interface RangeTraceRow {
  pid: number;
  name: string | null;
  unit: string | null;
  /** The row that actually serves the param; null = nothing serves it (the drop). */
  serving: RangeSpan | null;
  /** The static catalogue row; null = the param is unknown to this profile. */
  catalogue: RangeSpan | null;
}

export interface RangeTrace {
  profile: string;
  model: string;
  family: string;
  count: number;
  rows: RangeTraceRow[];
}

/** Why a param's control is present or missing — the three mutually exclusive classes. */
export type RowClass = 'served' | 'dropped' | 'absent';

/** Build the `/diag/ranges` query. Family defaults to CABINET (the server's default) and is
 *  uppercased, since the server does `family.toUpperCase()`. pid is omitted when undefined. */
export function rangeQuery(family?: string, pid?: number): string {
  const fam = (family && family.trim() ? family : 'CABINET').toUpperCase();
  const params = new URLSearchParams({ family: fam });
  if (pid != null) params.set('pid', String(pid));
  return `/diag/ranges?${params.toString()}`;
}

/** Human display for one row: `enum [0, 3]`, `float [0, 10]`, or an em dash when null. */
export function describeSpan(span: RangeSpan | null): string {
  return span ? `${span.kind} [${span.min}, ${span.max}]` : '—';
}

/** The diagnosis for one param: served (a row serves it), dropped (catalogue knows it but nothing
 *  serves it — an allowlist gate), absent (the profile has no definition at all). */
export function classifyRow(row: RangeTraceRow): RowClass {
  if (row.serving) return 'served';
  if (row.catalogue) return 'dropped';
  return 'absent';
}

/** True only when BOTH sides exist and disagree in kind or bounds — the profile-vs-catalogue
 *  divergence class (e.g. the cab-2 mute row: cache float vs catalogue enum). */
export function isMismatch(row: RangeTraceRow): boolean {
  if (!row.serving || !row.catalogue) return false;
  return (
    row.serving.kind !== row.catalogue.kind ||
    row.serving.min !== row.catalogue.min ||
    row.serving.max !== row.catalogue.max
  );
}

export interface TraceSummary {
  total: number;
  served: number;
  dropped: number;
  absent: number;
  mismatched: number;
}

/** Roll-up for the panel header: how many params are served, dropped by a gate, unknown, or diverge. */
export function summarize(rows: RangeTraceRow[]): TraceSummary {
  const s: TraceSummary = { total: rows.length, served: 0, dropped: 0, absent: 0, mismatched: 0 };
  for (const r of rows) {
    const c = classifyRow(r);
    if (c === 'served') s.served++;
    else if (c === 'dropped') s.dropped++;
    else s.absent++;
    if (isMismatch(r)) s.mismatched++;
  }
  return s;
}
