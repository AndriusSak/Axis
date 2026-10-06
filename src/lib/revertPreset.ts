/**
 * Revert Preset — FM3-Edit parity (audit §2.7).
 *
 * Discards unsaved edits by re-reading the STORED contents of the currently-loaded preset slot back
 * into the device's edit buffer. On gen-3 this is a SAME-slot `POST /preset/select`: the driver's
 * `selectPreset(n)` clears its grid cache and re-emits `buildSwitchPresetSysEx(n)`, so the stored
 * preset is reloaded even when `n` is unchanged (ForgeFX/server/src/drivers/gen3.ts `selectPreset`).
 *
 * NOT to be confused with the per-slot version history's `revertTo` (history.svelte.ts), which
 * restores a historical SNAPSHOT from the on-disk version store — a different source and a different
 * action. This re-reads whatever the device currently stores at the ACTIVE slot.
 *
 * The editor store executes runic `$state(...)` and cannot be imported under this repo's node-env
 * vitest (see editorSurface.test.ts), so the whole flow lives here behind a narrow surface and
 * `editor.revertPreset()` is a thin binding (pinned by revertPresetWiring.test.ts).
 */

export interface RevertPresetSurface {
  /** The loaded preset ref (number + name), or null when no preset is loaded. */
  loaded(): { number: number; name: string } | null;
  /** Last-known slot — fallback for the brief window where the live ref is momentarily null. */
  lastSlot(): number | null;
  /** Re-select a slot on the device → reloads that slot's STORED preset into the edit buffer. */
  reload(slot: number): Promise<void>;
  /** Re-read the UI after the reload (grid + open block params). */
  refresh(): Promise<void>;
  /** The buffer was wholesale replaced: drop the local-file link + insert a history barrier. */
  noteBufferReplaced(label: string): void;
  toast(text: string, accent?: string): void;
}

export type RevertOutcome =
  | { kind: 'reverted'; slot: number }
  | { kind: 'noop'; reason: 'no-preset' }
  | { kind: 'failed'; slot: number; error: unknown };

/** Render a slot the way every preset surface here does: zero-padded, or a bank-letter code (AM4). */
export function formatRevertSlot(slot: number, bankLetter = false): string {
  if (!bankLetter) return String(slot).padStart(3, '0');
  return `${String.fromCharCode(65 + Math.floor(slot / 4))}${String((slot % 4) + 1).padStart(2, '0')}`;
}

/** The history barrier label a revert inserts (the buffer was replaced with the stored preset). */
export function revertBarrierLabel(slot: number, bankLetter = false): string {
  return `Reverted to stored preset ${formatRevertSlot(slot, bankLetter)}`;
}

/**
 * Run the Revert Preset action.
 *
 * Order matters. Reload FIRST so a device failure leaves the buffer AND history untouched; only after
 * the device confirms do we refresh the UI and record the barrier. Marking the buffer replaced before
 * the device confirms would let a failed revert silently break undo past edits that are still live.
 */
export async function runRevertPreset(
  surface: RevertPresetSurface,
  opts: { bankLetter?: boolean } = {}
): Promise<RevertOutcome> {
  const loaded = surface.loaded();
  const slot = loaded?.number ?? surface.lastSlot() ?? -1;
  if (!Number.isInteger(slot) || slot < 0) return { kind: 'noop', reason: 'no-preset' };
  try {
    await surface.reload(slot); // same-slot re-select = reload the stored preset into the buffer
  } catch (error) {
    surface.toast('Revert failed — device offline?', '#d6543f');
    return { kind: 'failed', slot, error };
  }
  await surface.refresh();
  surface.noteBufferReplaced(revertBarrierLabel(slot, opts.bankLetter));
  surface.toast(`Reverted to stored preset ${formatRevertSlot(slot, opts.bankLetter)}`, '#35c9d6');
  return { kind: 'reverted', slot };
}
