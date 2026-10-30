// Rules for what a tile may paint from the live-meter map.
//
// The map is filled by the poll loop that runs while METER is ON. The loop has many ways to stop —
// the user switches METER off, the block editor closes, the grid is in the library view, the device
// goes away — and every one of them used to leave the last reading in place. A tile then rendered a
// frozen level that looked exactly like a live one (the fill even kept its live styling), and the only
// way to clear it was to toggle metering twice.
//
// Keeping the rule here (plain TS, unit-tested) rather than inside the store is deliberate: the store
// is a runes module and cannot be instantiated under the unit-test runner.

/** Minimal shape the rules need — the store's monitor rows carry more. */
export interface MeterRowLike {
  effectId: number;
  norm?: number | null;
  db?: number | null;
}

/** The live rows a tile may paint. Metering OFF yields none: a switched-off meter reads as off, never
 *  as the last level it happened to see. */
export function liveRowsFor<T extends MeterRowLike>(
  current: Record<number, T[]>,
  effectId: number,
  meteringOn: boolean
): T[] | undefined {
  if (!meteringOn) return undefined;
  const rows = current[effectId];
  return rows && rows.length ? rows : undefined;
}

/** The map to keep after a poll tick. A tick that could not read — metering off, no open block, the
 *  library or a virtual preset, the device not ready — leaves NOTHING behind. Keeping the previous
 *  values is what froze the bars mid-song. */
export function liveMetersAfterTick<T extends MeterRowLike>(
  current: Record<number, T[]>,
  couldPoll: boolean
): Record<number, T[]> {
  if (couldPoll) return current;
  return Object.keys(current).length ? {} : current;
}

/** True when the map still holds a reading that metering would not paint — i.e. stale state that the
 *  UI has to be told about. Used by the store to clear on the same toggle rather than waiting a tick. */
export function hasStaleLiveMeters<T>(current: Record<number, T[]>, meteringOn: boolean): boolean {
  return !meteringOn && Object.keys(current).length > 0;
}
