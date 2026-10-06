// Block Library store (audit §2.6) — a named, local library of serialised blocks. Thin runes shell
// over the pure `blockLibrary.ts` (all decision logic + the format live there and are unit-tested;
// this repo's vitest cannot compile runes).
//
// Persistence mirrors the existing library.svelte.ts idiom: localStorage is authoritative for reads
// (instant + offline), and every mutation is ALSO mirrored to the ForgeFX store under the `blockLib`
// collection so entries live in the unified backend (ready for cloud sync) and survive a fresh web
// client. `load()` merges the backend docs into the local set (newer-wins, by id).
//
// Format honesty: entries are Axis-local `.axblk` JSON, deliberately NOT byte-compatible with
// FM3-Edit's `.blk` (see blockLibrary.ts). Recall reuses the existing per-block write path.
import { forgefx } from './forgefx';
import { isRemoteBuild } from './cloudBrowser';
import { notifyMutation } from './syncBus';
import {
  BLOCK_LIB_FORMAT,
  BLOCK_LIB_VERSION,
  captureEntry,
  newEntryId,
  searchEntries,
  renameEntry,
  upsertEntry,
  deleteEntry,
  mergeEntries,
  parseEntry,
  serializeEntry,
  entryFilename,
  type BlockLibraryEntry,
  type CaptureInput
} from './blockLibrary';

const LS_KEY = 'axs.blockLib.v1';
const STORE_COLLECTION = 'blockLib';

/** Validate a persisted/imported blob as a library entry (cheap structural guard; parseEntry is the
 *  strict path for files, this one tolerates the in-memory cache). */
function isEntry(v: unknown): v is BlockLibraryEntry {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return r.format === BLOCK_LIB_FORMAT && r.version === BLOCK_LIB_VERSION && typeof r.id === 'string' && Array.isArray(r.params);
}

function loadLocal(): BlockLibraryEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

class BlockLibraryStore {
  entries = $state<BlockLibraryEntry[]>(loadLocal());
  query = $state('');
  /** Modal open flag (the UI binds to it). */
  open = $state(false);
  busy = $state(false);
  error = $state<string | null>(null);

  /** Search-filtered view, newest-first (order comes from upsert/merge). */
  filtered = $derived(searchEntries(this.entries, this.query));
  count = $derived(this.entries.length);

  #persistLocal(): void {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.entries));
    } catch {
      /* quota / unavailable — the backend store is the durable copy */
    }
  }
  #mirrorPut(entry: BlockLibraryEntry): void {
    forgefx.putDoc(STORE_COLLECTION, entry.id, entry).then(() => notifyMutation()).catch(() => {});
  }

  /** Pull the backend `blockLib` docs and merge them into the local set (newer-wins). Best-effort:
   *  a missing/older store simply leaves the local set untouched. Runs on launch + in the host UI. */
  async load(): Promise<void> {
    this.busy = true;
    try {
      const { docs } = await forgefx.listDocs<unknown>(STORE_COLLECTION);
      const remote = docs.map((d) => d.data).filter(isEntry);
      const merged = mergeEntries(this.entries, remote);
      if (merged.length !== this.entries.length || remote.some((r) => !this.entries.some((e) => e.id === r.id && e.updatedAt >= r.updatedAt))) {
        this.entries = merged;
        this.#persistLocal();
      }
    } catch {
      /* no store / older engine — local cache is authoritative */
    } finally {
      this.busy = false;
    }
  }

  /** Save a captured block as a new named entry. Returns the created entry. */
  add(input: CaptureInput): BlockLibraryEntry {
    const entry = captureEntry({ ...input, id: input.id || newEntryId() });
    this.entries = upsertEntry(this.entries, entry);
    this.#persistLocal();
    this.#mirrorPut(entry);
    return entry;
  }

  /** Rename an entry (empty names ignored). Mirrors to the store. */
  rename(id: string, name: string): void {
    const e = this.entries.find((x) => x.id === id);
    if (!e) return;
    const next = renameEntry(e, name);
    if (next === e) return; // empty rename → no-op
    this.entries = upsertEntry(this.entries, next);
    this.#persistLocal();
    this.#mirrorPut(next);
  }

  /** Delete an entry (local + backend). */
  async remove(id: string): Promise<void> {
    this.entries = deleteEntry(this.entries, id);
    this.#persistLocal();
    await forgefx.deleteDoc(STORE_COLLECTION, id).then(() => notifyMutation()).catch(() => {});
  }

  /** Serialise one entry for export (the `.axblk` text + a safe filename). */
  exportText(id: string): { filename: string; text: string } | null {
    const e = this.entries.find((x) => x.id === id);
    if (!e) return null;
    return { filename: entryFilename(e), text: serializeEntry(e) };
  }

  /** Import an `.axblk` text. Validates the format/version first (refused, never guessed) and, on a
   *  name clash with a different id, keeps both (id is the key — no silent overwrite). */
  importText(text: string): { ok: boolean; entry?: BlockLibraryEntry; error?: string } {
    const entry = parseEntry(text);
    if (!entry) {
      this.error = 'Not an Axis block file (.axblk) — the format is Axis-local, not FM3-Edit .blk.';
      return { ok: false, error: this.error };
    }
    this.error = null;
    this.entries = upsertEntry(this.entries, entry);
    this.#persistLocal();
    this.#mirrorPut(entry);
    return { ok: true, entry };
  }

  /** Remote builds can read the library but shouldn't seed the host's store on launch. */
  seedHostConfig(): void {
    if (isRemoteBuild() || typeof localStorage === 'undefined') return;
    for (const e of this.entries) this.#mirrorPut(e);
  }
}

export const blockLibrary = new BlockLibraryStore();
