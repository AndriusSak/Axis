/**
 * Snapshot to folder — FM3-Edit parity (audit §2.7).
 *
 * FM3-Edit's "Snapshot" button writes the current preset as `<name>.syx` into a Snapshots folder.
 * Axis already stores every capture in its per-slot VERSION HISTORY and can export any version's
 * `.syx` (`forgefx.snapshotPreset(n)` + `forgefx.versionSyx(id)` — the same pair the Preset Browser's
 * `deviceEntryBytes()` and the picker use). This module does NOT add a second export path: the
 * editor binding feeds it bytes from those existing calls, and it writes them into the configured
 * local Presets/ root under `Snapshots/` via the existing `forgefx.saveLocalPreset(name, bytes, {dir})`
 * route (`POST /local/presets` → `Presets/Snapshots/<name>.syx`, 409 without `overwrite`).
 *
 * Pure + dependency-free so it unit-tests under the repo's node-env vitest. The editor supplies the
 * surface (a thin binding over forgefx); this module owns the flow, the filename, and the outcomes.
 */

export const SNAPSHOT_DIR = 'Snapshots';

/** The captured preset: its name + verbatim `.syx` bytes. */
export interface SnapshotCapture {
  name: string;
  bytes: Uint8Array;
}

/** What the editor wires for {@link runSnapshotToFolder}. */
export interface SnapshotSurface {
  /** Capture the CURRENT preset as `.syx` (device slot via version history, or the active buffer). Null when nothing is loaded. */
  capture(): Promise<SnapshotCapture | null>;
  /** True when a local Presets/ folder is configured AND present → write into it. */
  folderReady(): boolean;
  /** Write `Snapshots/<name>.syx` (the server appends `.syx`). Resolve `'exists'` on a 409 without `overwrite`. */
  saveToFolder(name: string, bytes: Uint8Array, overwrite: boolean): Promise<{ path: string } | 'exists'>;
  /** Browser-download fallback when no folder is configured. */
  download(name: string, bytes: Uint8Array): void;
  /** Ask the user before overwriting an existing `<name>.syx`; return true to overwrite. */
  confirmOverwrite?(name: string): boolean;
  toast(text: string, accent?: string): void;
}

export type SnapshotOutcome =
  | { kind: 'saved'; path: string }
  | { kind: 'downloaded'; name: string }
  | { kind: 'noop'; reason: 'no-preset' | 'exists' }
  | { kind: 'failed'; error: unknown };

/** Sanitize a preset name into a safe `.syx` basename (mirrors `convertExport.syxFilename`, but keeps spaces). */
export function snapshotFilename(name: string | undefined | null): string {
  const base = (name ?? '').trim().replace(/[^\w\s-]+/g, '_').trim();
  return `${base || 'preset'}.syx`;
}

/**
 * Run the one-click Snapshot.
 *
 * Order: capture FIRST (a device error leaves the folder untouched). Then prefer the local folder;
 * fall back to a browser download when none is configured. Only overwrite an existing file after the
 * user confirms — never silently clobber a previous snapshot.
 */
export async function runSnapshotToFolder(surface: SnapshotSurface): Promise<SnapshotOutcome> {
  let cap: SnapshotCapture | null;
  try {
    cap = await surface.capture();
  } catch (error) {
    surface.toast('Snapshot failed — device offline?', '#d6543f');
    return { kind: 'failed', error };
  }
  if (!cap) {
    surface.toast('No preset loaded to snapshot', '#f5a623');
    return { kind: 'noop', reason: 'no-preset' };
  }
  const filename = snapshotFilename(cap.name);
  const base = filename.replace(/\.syx$/, '');

  if (!surface.folderReady()) {
    try {
      surface.download(filename, cap.bytes);
      surface.toast(`Snapshot downloaded — ${filename} (no Presets folder configured)`, '#35c9d6');
      return { kind: 'downloaded', name: filename };
    } catch (error) {
      surface.toast('Snapshot download failed', '#d6543f');
      return { kind: 'failed', error };
    }
  }

  try {
    let r = await surface.saveToFolder(base, cap.bytes, false);
    if (r === 'exists') {
      if (!surface.confirmOverwrite?.(base)) {
        surface.toast(`Snapshot “${filename}” already exists — not overwritten`, '#f5a623');
        return { kind: 'noop', reason: 'exists' };
      }
      r = await surface.saveToFolder(base, cap.bytes, true);
      if (r === 'exists') {
        surface.toast(`Snapshot “${filename}” already exists — not overwritten`, '#f5a623');
        return { kind: 'noop', reason: 'exists' };
      }
    }
    surface.toast(`Snapshot saved — ${r.path}`, '#33c46b');
    return { kind: 'saved', path: r.path };
  } catch (error) {
    surface.toast('Snapshot failed: ' + (error as Error).message, '#d6543f');
    return { kind: 'failed', error };
  }
}
