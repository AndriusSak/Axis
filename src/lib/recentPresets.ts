// Recent Presets — a locally-persisted most-recently-used (MRU) list of loaded/browsed presets
// (FM3-Edit parity, audit §2.7). ONE shared store, keyed by the same entry id the library uses
// (`dev:<n>` for a device slot, `local:<path>` / `file:<name>` / `conv:<docId>` otherwise), so the
// Preset Picker and BOTH preset browsers (monolith + workbench panel) surface the SAME recents.
//
// Pure + storage-injectable (no `$state`, no DOM) so it unit-tests under the repo's node-env vitest.
// The stores are thin: they read/write `localStorage` via `defaultRecentStorage()`.

export interface RecentPreset {
  /** Stable library entry id (`dev:12`, `local:Lead/foo.syx`, `file:foo.syx`, `conv:<docId>`). */
  id: string;
  /** Device slot number when the entry is a device preset; null otherwise. */
  number: number | null;
  name: string;
  source: string;
  /** Epoch ms the entry was last used — newest first. */
  at: number;
}

/** The localStorage key. Versioned so a future shape change can be migrated rather than mis-read. */
export const RECENT_KEY = 'axs.recent.v1';
/** Cap on the list — matches the picker's historical 12, now shared. */
export const RECENT_CAP = 12;

/** The minimal storage surface the store needs (a DOM `Storage` or the in-memory fallback). */
export interface RecentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const memory = new Map<string, string>();
/** Fallback when `localStorage` is unavailable (SSR / node tests) — keeps the module side-effect free. */
export const recentMemoryStorage: RecentStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k)! : null),
  setItem: (k, v) => void memory.set(k, v)
};

export function defaultRecentStorage(): RecentStorage {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* private mode / disabled — fall through */
  }
  return recentMemoryStorage;
}

/** The library entry id for a preset, or null when it has no addressable identity (e.g. slot -1). */
export function recentEntryId(source: string, number: number | null | undefined, fallback = ''): string | null {
  if (source === 'device' && number != null && number >= 0) return `dev:${number}`;
  return fallback || null;
}

function isRecent(v: unknown): v is RecentPreset {
  const r = v as Partial<RecentPreset> | null;
  return !!r && typeof r.id === 'string' && r.id.length > 0 && typeof r.name === 'string';
}

/** Parse a persisted blob into a validated list (drops junk rows instead of throwing). */
export function parseRecents(raw: string | null): RecentPreset[] {
  if (!raw) return [];
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(j)) return [];
  return j.filter(isRecent).map((r) => ({
    id: r.id,
    number: typeof r.number === 'number' ? r.number : null,
    name: r.name,
    source: typeof r.source === 'string' ? r.source : '',
    at: typeof r.at === 'number' ? r.at : 0
  }));
}

/** Pure MRU insert: drop any existing row with the same id, unshift the new one, cap the length. */
export function pushRecent(list: RecentPreset[], rec: RecentPreset, cap = RECENT_CAP): RecentPreset[] {
  return [rec, ...list.filter((r) => r.id !== rec.id)].slice(0, cap);
}

export function loadRecents(storage: RecentStorage = defaultRecentStorage(), cap = RECENT_CAP): RecentPreset[] {
  return parseRecents(storage.getItem(RECENT_KEY)).slice(0, cap);
}

export function saveRecents(list: RecentPreset[], storage: RecentStorage = defaultRecentStorage()): void {
  try {
    storage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* quota / unavailable — recents are best-effort */
  }
}

/** Record one use (MRU bump), persist, and return the new list. `at` defaults to now. */
export function recordRecent(
  rec: Omit<RecentPreset, 'at'> & { at?: number },
  storage: RecentStorage = defaultRecentStorage(),
  cap = RECENT_CAP
): RecentPreset[] {
  const next = pushRecent(loadRecents(storage, cap), { ...rec, at: rec.at || Date.now() }, cap);
  saveRecents(next, storage);
  return next;
}

/** Remove a single entry (by id) and persist. Returns the new list. */
export function removeRecent(id: string, storage: RecentStorage = defaultRecentStorage()): RecentPreset[] {
  const next = loadRecents(storage).filter((r) => r.id !== id);
  saveRecents(next, storage);
  return next;
}

export function clearRecents(storage: RecentStorage = defaultRecentStorage()): void {
  saveRecents([], storage);
}
