// Which pending device-event refresh may replace which.
//
// Axis coalesces reflected device events through ONE debounce timer (`#eventReload`), but the three
// refreshes it can install are NOT equivalent:
//
//   full       → load() + #loadParams(): re-reads the grid STRUCTURE, the block list and the open
//                block's params. Emitted for structural changes (preset switched, block placed/removed,
//                type changed).
//   scene      → #refreshScene(): re-applies per-scene bypass/channel onto the EXISTING layout and
//                re-reads the open block. Cheap by design; never re-reads the grid structure.
//   blockState → #refreshScene(): same as scene.
//
// Because they share one timer, a lighter refresh used to CANCEL a pending full reload — so a preset
// switch on the unit (server emits `changed`) followed within the debounce window by the FM3's
// scene/channel watch poll (`scene` / `blockState`, which fires every 8 meter ticks) left the UI showing
// the PREVIOUS preset's grid, with nothing left to correct it. Rank the work and refuse the downgrade.

export type ReloadKind = 'full' | 'scene' | 'blockState';

/** Work each refresh performs; a refresh may only replace a pending one of equal or lesser rank. */
const RANK: Record<ReloadKind, number> = { full: 2, scene: 1, blockState: 1 };

/**
 * True when an incoming refresh may replace the one already pending.
 *
 * `pending === null` (nothing scheduled) always allows it. Otherwise the incoming work must be at least
 * as broad as the pending work — so a cheap scene/blockState refresh never drops a pending full reload.
 */
export function mayReplacePending(pending: ReloadKind | null, incoming: ReloadKind): boolean {
  return pending === null || RANK[incoming] >= RANK[pending];
}
