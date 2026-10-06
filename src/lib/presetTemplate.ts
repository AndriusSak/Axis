// Preset Templates — FM3-Edit parity (audit §2.7 remainder: "New from Template / Save as Template").
//
// FM3-Edit's *Save as Template* stores the current preset as a reusable starting point and *New from
// Template* starts a fresh preset from one. Axis implements the same idea as an **Axis-local, local-only**
// named store: the template is an `.axtpl.json` document that EMBEDS the captured `.syx` bytes (base64),
// so it is self-contained and can be brought back into the edit buffer with no device slot involved.
//
// ── Format honesty ────────────────────────────────────────────────────────────────────────────────
// This container is **Axis-local and NOT byte-compatible with FM3-Edit's template format** (an
// undocumented Fractal container). The embedded payload IS the device's own `.syx` dump, verbatim — the
// same bytes the preset browser's imported-file path carries — so nothing about the device is invented.
// Templates are NEVER written to the device.
//
// ── Where a template lives (and the honest disk caveat) ───────────────────────────────────────────
// The registry is `localStorage` in this browser (see `presetTemplates.svelte.ts`) — always available,
// never leaves the machine, no server route involved. When a local Presets/ folder IS configured, the
// captured preset is ALSO mirrored to `Presets/Templates/<name>.syx` through the EXISTING local write
// route (`forgefx.saveLocalPreset { dir: 'Templates' }` → `POST /local/presets`). That route appends
// `.syx` unconditionally (server `localService.writePreset`), so the disk artifact is a plain preset
// mirror — the `.axtpl.json` itself is only written via browser download. When no folder is configured
// the template is saved to `localStorage` and exported as a `.axtpl.json` download instead. The UI says
// which happened.
//
// ── Loading ───────────────────────────────────────────────────────────────────────────────────────
// "New from Template" reuses the EXISTING imported-file load-to-buffer path (`forgefx.loadBytes` →
// `POST /preset/load`) — the exact call `PresetBrowser.loadPreset` makes for a `.syx` file entry. No
// endpoint is invented.
//
// Pure + dependency-free so it unit-tests under the repo's node-env vitest; the editor supplies the
// surface (a thin binding over forgefx) and this module owns the format, the flow and the outcomes.

export const AXTPL_FORMAT = 'axis-preset-template';
/** Schema version; `parseTemplate` rejects any other version (forward-incompatible → refused, not guessed). */
export const AXTPL_VERSION = 1;
/** Local file extension (a JSON document). Explicitly NOT an FM3-Edit format (see the honesty note). */
export const AXTPL_EXT = '.axtpl.json';
/** Sub-folder under the configured Presets/ root the `.syx` mirror is written into. */
export const TEMPLATE_DIR = 'Templates';

/** A named, reusable preset template: the captured `.syx` bytes embedded as base64. */
export interface PresetTemplate {
  format: typeof AXTPL_FORMAT;
  version: number;
  /** Stable id, e.g. `tpl:<epoch>-<rand>`. */
  id: string;
  name: string;
  /** base64 of the captured `.syx` bytes — self-contained, so a template loads with no device slot. */
  syx: string;
  /** Byte length of the embedded `.syx` (integrity check on parse + a size readout in the UI). */
  bytesLen: number;
  /** Relative path of the `Presets/Templates/<name>.syx` mirror, or null when none was written. */
  path: string | null;
  /** Source device model (informational), or null when unknown. */
  device: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Input for `captureTemplate`. */
export interface CaptureTemplateInput {
  id: string;
  name: string;
  bytes: Uint8Array;
  path?: string | null;
  device?: string | null;
  now?: number;
}

// ── base64 (browser + node safe; btoa/atob are globals on every runtime we ship on) ──
const CHUNK = 0x8000;

export function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Snapshot a preset's `.syx` bytes into a new template entry. */
export function captureTemplate(input: CaptureTemplateInput): PresetTemplate {
  const now = input.now ?? Date.now();
  return {
    format: AXTPL_FORMAT,
    version: AXTPL_VERSION,
    id: input.id,
    name: templateName(input.name),
    syx: bytesToB64(input.bytes),
    bytesLen: input.bytes.length,
    path: input.path ?? null,
    device: input.device ?? null,
    createdAt: now,
    updatedAt: now
  };
}

/** The captured `.syx` bytes of a template (fresh copy — callers may mutate it freely). */
export function templateBytes(t: PresetTemplate): Uint8Array {
  return b64ToBytes(t.syx);
}

/** Serialise a template to the `.axtpl.json` text (pretty JSON so a hand-inspected file is readable). */
export function serializeTemplate(t: PresetTemplate): string {
  return JSON.stringify(t, null, 2);
}

function isTemplate(raw: unknown): raw is PresetTemplate {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  if (r.format !== AXTPL_FORMAT || r.version !== AXTPL_VERSION) return false;
  if (typeof r.id !== 'string' || !r.id.length) return false;
  if (typeof r.name !== 'string') return false;
  if (typeof r.syx !== 'string') return false;
  if (typeof r.bytesLen !== 'number' || typeof r.createdAt !== 'number' || typeof r.updatedAt !== 'number') return false;
  if (r.path !== null && typeof r.path !== 'string') return false;
  if (r.device !== null && typeof r.device !== 'string') return false;
  return true;
}

/** Parse + validate an imported `.axtpl.json` text. Anything foreign, of another version, structurally
 *  broken, or whose embedded bytes do not match the recorded length returns null (refused, never guessed). */
export function parseTemplate(text: string): PresetTemplate | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isTemplate(raw)) return null;
  let bytes: Uint8Array;
  try {
    bytes = b64ToBytes(raw.syx);
  } catch {
    return null;
  }
  if (bytes.length !== raw.bytesLen) return null; // corrupt/truncated payload — do not guess
  return {
    format: AXTPL_FORMAT,
    version: AXTPL_VERSION,
    id: raw.id,
    name: raw.name,
    syx: raw.syx,
    bytesLen: raw.bytesLen,
    path: raw.path,
    device: raw.device,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  };
}

/** A non-empty template name, or the fallback. */
export function templateName(raw: string | null | undefined, fallback = 'template'): string {
  return (raw ?? '').trim() || fallback;
}

/** Rename a template. Empty/whitespace names are ignored (the old name is kept); `createdAt` is preserved. */
export function renameTemplate(t: PresetTemplate, name: string, now = Date.now()): PresetTemplate {
  const trimmed = name.trim();
  if (!trimmed || trimmed === t.name) return t;
  return { ...t, name: trimmed, updatedAt: now };
}

/** Insert or replace by id, ordered newest-first (updatedAt desc; createdAt as the tie-break). */
export function upsertTemplate(list: PresetTemplate[], t: PresetTemplate): PresetTemplate[] {
  const next = [...list.filter((e) => e.id !== t.id), t];
  return next.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
}

/** Remove a template by id. */
export function deleteTemplate(list: PresetTemplate[], id: string): PresetTemplate[] {
  return list.filter((e) => e.id !== id);
}

/** Case-insensitive substring search over the template name. Empty query returns the list unchanged. */
export function searchTemplates(list: PresetTemplate[], query: string): PresetTemplate[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((t) => t.name.toLowerCase().includes(q));
}

/** A filesystem-safe `<name>.axtpl.json` filename (export download + the file picker's default). */
export function templateFilename(t: PresetTemplate): string {
  const stem = t.name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${stem || 'template'}${AXTPL_EXT}`;
}

/** Stable-ish id for a newly saved template. */
export function newTemplateId(now = Date.now()): string {
  return `tpl:${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Save flow ─────────────────────────────────────────────────────────────────────────────────────

/** The captured preset: its name + verbatim `.syx` bytes. */
export interface TemplateCapture {
  name: string;
  bytes: Uint8Array;
}

/** What the editor wires for {@link runSaveAsTemplate}. */
export interface TemplateSaveSurface {
  /** Capture the CURRENT preset as `.syx` (device slot via version history, or the active buffer). Null when nothing is loaded. */
  capture(): Promise<TemplateCapture | null>;
  /** True when a local Presets/ folder is configured AND present → mirror a `.syx` copy there. */
  folderReady(): boolean;
  /** Mirror the preset as `Templates/<name>.syx` (the server appends `.syx`). Resolve `'exists'` on a 409 without `overwrite`. */
  mirrorToFolder(name: string, bytes: Uint8Array, overwrite: boolean): Promise<{ path: string } | 'exists'>;
  /** Browser-download the `.axtpl.json` (used when no folder is configured). */
  download(filename: string, text: string): void;
  /** Persist the entry in the local registry (the source of truth). */
  store(entry: PresetTemplate): void;
  /** Ask before overwriting an existing mirror; return true to overwrite. */
  confirmOverwrite?(name: string): boolean;
  toast(text: string, accent?: string): void;
}

export type TemplateSaveOutcome =
  | { kind: 'saved'; entry: PresetTemplate; path: string | null; exported: boolean }
  | { kind: 'noop'; reason: 'no-preset' }
  | { kind: 'failed'; error: unknown };

/**
 * Run the one-click Save-as-Template.
 *
 * Order: capture FIRST (a device error leaves the registry untouched). Then persist to the local
 * registry (the durable, self-contained copy). When a Presets folder is configured also mirror a
 * `.syx` copy into `Templates/` (overwriting only after confirmation); otherwise export the
 * `.axtpl.json` via browser download and say so. The registry is written either way, so a failed
 * mirror or download never loses the template.
 */
export async function runSaveAsTemplate(surface: TemplateSaveSurface): Promise<TemplateSaveOutcome> {
  let cap: TemplateCapture | null;
  try {
    cap = await surface.capture();
  } catch (error) {
    surface.toast('Save as Template failed — device offline?', '#d6543f');
    return { kind: 'failed', error };
  }
  if (!cap) {
    surface.toast('No preset loaded to save as a template', '#f5a623');
    return { kind: 'noop', reason: 'no-preset' };
  }

  const entry = captureTemplate({ id: newTemplateId(), name: cap.name, bytes: cap.bytes });
  surface.store(entry); // registry first — the template is never lost to a later failure

  let path: string | null = null;
  let exported = false;

  if (surface.folderReady()) {
    try {
      let r = await surface.mirrorToFolder(entry.name, cap.bytes, false);
      if (r === 'exists') {
        if (surface.confirmOverwrite?.(entry.name)) r = await surface.mirrorToFolder(entry.name, cap.bytes, true);
      }
      if (r !== 'exists') {
        path = r.path;
        const stored = { ...entry, path };
        surface.store(stored);
        surface.toast(`Template “${entry.name}” saved — ${TEMPLATE_DIR}/${path}`, '#33c46b');
        return { kind: 'saved', entry: stored, path, exported };
      }
      // declined / still exists: keep the registry copy, skip the disk mirror
      surface.toast(`Template “${entry.name}” saved locally — disk mirror skipped (already exists)`, '#f5a623');
      return { kind: 'saved', entry, path: null, exported };
    } catch (error) {
      surface.toast('Template saved locally — disk mirror failed: ' + (error as Error).message, '#f5a623');
      return { kind: 'saved', entry, path: null, exported };
    }
  }

  // No Presets folder configured → export the self-contained .axtpl.json via download.
  try {
    surface.download(templateFilename(entry), serializeTemplate(entry));
    exported = true;
    surface.toast(`Template “${entry.name}” saved locally — exported .axtpl.json (no Presets folder configured)`, '#35c9d6');
  } catch (error) {
    surface.toast('Template saved locally — export download failed', '#f5a623');
  }
  return { kind: 'saved', entry, path: null, exported };
}
