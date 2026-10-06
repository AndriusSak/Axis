// Axis LOCAL block library — the pure half (format + logic); `blockLibrary.svelte.ts` is the thin
// runes store over it, and `BlockLibraryPanel.svelte` the UI. Kept here as a plain .ts module because
// this repo's vitest runs in a node environment and cannot compile Svelte runes.
//
// ── Format honesty note (audit §2.6) ──────────────────────────────────────────────────────────────
// FM3-Edit's Library stores named blocks (all 4 channels) and single channels as Fractal `.blk`
// files. Axis has no `.blk` concept and this feature is deliberately **Axis-local and NOT
// byte-compatible with FM3-Edit's `.blk`** — that container is an undocumented Fractal format and
// matching it would need reverse-engineering. An Axis entry is plain JSON (`.axblk`), keyed by the
// device-true paramId, so it recalls through Axis's EXISTING per-block write path (setType/setParam,
// the same calls block copy/paste uses). Nothing about the device is invented.
//
// ── What is captured (and what is not) ────────────────────────────────────────────────────────────
// Only the **active channel** of the source block: `forgefx.blockParams(eid)` serves the currently
// selected channel's values — the device holds one channel at a time. Reading all four channels would
// mean switching channel + re-reading per channel (a device round-trip per channel that would also
// disturb the user's edit session); entries therefore record the channel they were read from
// (`channel`) and recall onto the active channel. Fields captured per param: a continuous knob stores
// its normalized 0..1 value (what `setParam(…, true)` expects); an enum stores its ordinal (what
// `setParam(…, false)` expects). The model/type selector is captured separately. A param with no
// device paramId (unwritable) and the reserved `Type`/`Bypass` rows are dropped — never fabricated.
// Modifiers and per-channel values are NOT stored.

import type { NamedParam, EnumParam } from './types';
import type { ParamWrite } from './blockOps';

/** Format marker written into every exported entry — distinguishes an Axis `.axblk` from anything else. */
export const BLOCK_LIB_FORMAT = 'axis-block-library';
/** Schema version; `parseEntry` rejects any other version (forward-incompatible → refused, not guessed). */
export const BLOCK_LIB_VERSION = 1;
/** Local file extension. Explicitly NOT `.blk` (see the honesty note). */
export const BLOCK_LIB_EXT = '.axblk';

/** One captured parameter value. `kind` disambiguates how to write it back. */
export interface StoredParam {
  /** Device-true paramId — the write key. */
  id: number;
  /** Display label (UI + cross-family diagnostics). */
  name: string;
  /** `knob` → `value` is normalized 0..1 (continuous); `enum` → `value` is the option ordinal. */
  kind: 'knob' | 'enum';
  value: number;
}

/** A named block-library entry: a serialised block model + one channel's parameter set. */
export interface BlockLibraryEntry {
  format: typeof BLOCK_LIB_FORMAT;
  version: number;
  /** Stable id, e.g. `blk:<epoch>-<rand>`. */
  id: string;
  name: string;
  /** Source block display name, e.g. "Amp 1". */
  block: string;
  /** Catalog family slug (amp/reverb/…) or null when unknown. */
  slug: string | null;
  /** Model/type selector, or null for blocks with no model (plain GEQ/Volume). */
  type: { value: number; name: string } | null;
  /** Channel the values were read from ('A'–'D'), or null when unknown. */
  channel: string | null;
  params: StoredParam[];
  createdAt: number;
  updatedAt: number;
}

/** Input for `captureEntry` — the served block params plus the display context. */
export interface CaptureInput {
  id: string;
  name: string;
  block: string;
  slug: string | null;
  type: { value: number; name: string } | null;
  channel: string | null;
  named: NamedParam[];
  enums: EnumParam[];
  now?: number;
}

/** Reserved rows the block clipboard also drops — not user settings. */
const RESERVED = new Set(['type', 'bypass']);

/** Snapshot a block's model + its active channel's values into a new entry. Only writable params are
 *  kept (a param without a device paramId cannot be recalled). */
export function captureEntry(input: CaptureInput): BlockLibraryEntry {
  const now = input.now ?? Date.now();
  const params: StoredParam[] = [];
  for (const p of input.named) {
    if (p.id == null || RESERVED.has(p.name.toLowerCase())) continue;
    params.push({ id: p.id, name: p.name, kind: 'knob', value: p.norm ?? 0 });
  }
  for (const e of input.enums) {
    params.push({ id: e.id, name: e.name, kind: 'enum', value: e.value });
  }
  return {
    format: BLOCK_LIB_FORMAT,
    version: BLOCK_LIB_VERSION,
    id: input.id,
    name: input.name,
    block: input.block,
    slug: input.slug,
    type: input.type,
    channel: input.channel,
    params,
    createdAt: now,
    updatedAt: now
  };
}

/** Plan the writes that recall an entry onto a target block: knobs continuous (norm), enums discrete
 *  (ordinal). Ids the target block does not expose are dropped, so a cross-family recall writes only
 *  what the target can accept (same rule as channel paste — see blockOps.pasteChannelWrites). */
export function recallWrites(entry: BlockLibraryEntry, targetParams: NamedParam[], targetEnums: EnumParam[]): ParamWrite[] {
  const knobIds = new Set(targetParams.filter((p) => p.id != null).map((p) => p.id as number));
  const enumIds = new Set(targetEnums.filter((e) => e.id != null).map((e) => e.id));
  const out: ParamWrite[] = [];
  for (const p of entry.params) {
    if (p.kind === 'knob' && knobIds.has(p.id)) out.push({ paramId: p.id, value: p.value, continuous: true, name: p.name });
    else if (p.kind === 'enum' && enumIds.has(p.id)) out.push({ paramId: p.id, value: p.value, continuous: false, name: p.name });
  }
  return out;
}

/** Serialise an entry to the `.axblk` text (pretty JSON so a hand-inspected file is readable). */
export function serializeEntry(entry: BlockLibraryEntry): string {
  return JSON.stringify(entry, null, 2);
}

const isParam = (p: unknown): p is StoredParam => {
  if (!p || typeof p !== 'object') return false;
  const r = p as Record<string, unknown>;
  return typeof r.id === 'number' && typeof r.name === 'string' && (r.kind === 'knob' || r.kind === 'enum') && typeof r.value === 'number';
};

/** Parse + validate an imported `.axblk` text. Anything foreign, of another version, or structurally
 *  broken returns null (refused, never guessed). */
export function parseEntry(text: string): BlockLibraryEntry | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.format !== BLOCK_LIB_FORMAT || r.version !== BLOCK_LIB_VERSION) return null;
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.block !== 'string') return null;
  if (typeof r.createdAt !== 'number' || typeof r.updatedAt !== 'number') return null;
  if (r.slug !== null && typeof r.slug !== 'string') return null;
  if (r.channel !== null && typeof r.channel !== 'string') return null;
  if (r.type !== null) {
    const t = r.type as Record<string, unknown>;
    if (!t || typeof t !== 'object' || typeof t.value !== 'number' || typeof t.name !== 'string') return null;
  }
  if (!Array.isArray(r.params) || !r.params.every(isParam)) return null;
  return {
    format: BLOCK_LIB_FORMAT,
    version: BLOCK_LIB_VERSION,
    id: r.id,
    name: r.name,
    block: r.block,
    slug: r.slug as string | null,
    type: (r.type as BlockLibraryEntry['type']) ?? null,
    channel: r.channel as string | null,
    params: r.params as StoredParam[],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };
}

/** Case-insensitive substring search over the entry name, source block, family slug, model name and
 *  captured param labels. Empty query returns the list unchanged. */
export function searchEntries(entries: BlockLibraryEntry[], query: string): BlockLibraryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) => {
    const hay = [e.name, e.block, e.slug ?? '', e.type?.name ?? '', ...e.params.map((p) => p.name)].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

/** Rename an entry. Empty/whitespace names are ignored (the old name is kept); `createdAt` is preserved. */
export function renameEntry(entry: BlockLibraryEntry, name: string, now = Date.now()): BlockLibraryEntry {
  const trimmed = name.trim();
  if (!trimmed) return entry;
  return { ...entry, name: trimmed, updatedAt: now };
}

/** Insert or replace by id, ordered newest-first (updatedAt desc; createdAt as the tie-break). */
export function upsertEntry(entries: BlockLibraryEntry[], entry: BlockLibraryEntry): BlockLibraryEntry[] {
  const next = [...entries.filter((e) => e.id !== entry.id), entry];
  return next.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
}

/** Remove an entry by id. */
export function deleteEntry(entries: BlockLibraryEntry[], id: string): BlockLibraryEntry[] {
  return entries.filter((e) => e.id !== id);
}

/** Merge two entry lists keyed by id (e.g. a local cache and the backend store), keeping the newer of
 *  any duplicate pair, newest-first. Later lists win a tie. */
export function mergeEntries(...lists: BlockLibraryEntry[][]): BlockLibraryEntry[] {
  const byId = new Map<string, BlockLibraryEntry>();
  for (const list of lists) {
    for (const e of list) {
      const prev = byId.get(e.id);
      if (!prev || e.updatedAt >= prev.updatedAt) byId.set(e.id, e);
    }
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
}

/** A filesystem-safe `<name>.axblk` filename (exports + the file picker's default). */
export function entryFilename(entry: BlockLibraryEntry): string {
  const stem = entry.name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${stem || 'block'}${BLOCK_LIB_EXT}`;
}

/** Stable-ish id for a newly saved entry. */
export function newEntryId(now = Date.now()): string {
  return `blk:${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
