// Preset Templates store (audit §2.7 remainder) — a named, LOCAL-ONLY registry of preset templates.
// Thin runes shell over the pure `presetTemplate.ts` (the format + the save flow live there and are
// unit-tested; this repo's vitest cannot compile runes).
//
// LOCAL-ONLY, on purpose: unlike the Block Library, entries are NOT mirrored to the ForgeFX `/store`
// backend — templates never leave this browser (no cloud sync, no server route). Persistence is a single
// localStorage key. Loading uses the existing `forgefx.loadBytes` edit-buffer path (see editor binding).
import {
  parseTemplate,
  searchTemplates,
  renameTemplate,
  upsertTemplate,
  deleteTemplate,
  serializeTemplate,
  templateFilename,
  type PresetTemplate
} from './presetTemplate';

const LS_KEY = 'axs.presetTemplates.v1';

/** Cheap structural guard for the localStorage cache (parseTemplate is the strict path for files). */
function isEntry(v: unknown): v is PresetTemplate {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.id === 'string' && typeof r.name === 'string' && typeof r.syx === 'string' && typeof r.bytesLen === 'number';
}

function loadLocal(): PresetTemplate[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

class PresetTemplatesStore {
  entries = $state<PresetTemplate[]>(loadLocal());
  query = $state('');
  /** Modal open flag (the UI binds to it). */
  open = $state(false);
  error = $state<string | null>(null);

  /** Search-filtered view, newest-first (order comes from upsert). */
  filtered = $derived(searchTemplates(this.entries, this.query));
  count = $derived(this.entries.length);

  #persist(): void {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.entries));
    } catch {
      /* quota / unavailable — templates are best-effort local */
    }
  }

  /** Insert or replace a template by id and persist. */
  add(entry: PresetTemplate): PresetTemplate {
    this.entries = upsertTemplate(this.entries, entry);
    this.#persist();
    return entry;
  }

  /** Rename a template (empty names ignored). */
  rename(id: string, name: string): void {
    const t = this.entries.find((x) => x.id === id);
    if (!t) return;
    const next = renameTemplate(t, name);
    if (next === t) return;
    this.entries = upsertTemplate(this.entries, next);
    this.#persist();
  }

  /** Delete a template by id. */
  remove(id: string): void {
    this.entries = deleteTemplate(this.entries, id);
    this.#persist();
  }

  /** Serialise one template for export (the `.axtpl.json` text + a safe filename). */
  exportText(id: string): { filename: string; text: string } | null {
    const t = this.entries.find((x) => x.id === id);
    if (!t) return null;
    return { filename: templateFilename(t), text: serializeTemplate(t) };
  }

  /** Import an `.axtpl.json` text. Validates format/version/payload first (refused, never guessed). */
  importText(text: string): { ok: boolean; entry?: PresetTemplate; error?: string } {
    const entry = parseTemplate(text);
    if (!entry) {
      this.error = 'Not an Axis preset template (.axtpl.json) — the format is Axis-local, not an FM3-Edit template.';
      return { ok: false, error: this.error };
    }
    this.error = null;
    this.entries = upsertTemplate(this.entries, entry);
    this.#persist();
    return { ok: true, entry };
  }
}

export const presetTemplates = new PresetTemplatesStore();
