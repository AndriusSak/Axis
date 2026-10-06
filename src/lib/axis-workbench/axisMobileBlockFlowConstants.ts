/**
 * Fraction of the workbench height the block editor takes when a block is active.
 *
 * Phone (operator T31: "controls always sit at the bottom taking ~70–80% of the height"):
 * 0.75 sits in the middle of that band.
 */

/** Phone profile — the editor takes the large majority of the height (T31 band). */
export const AXIS_MOBILE_BLOCK_EXPAND_RATIO = 0.75;

/**
 * Tablet/desktop profile — the editor shares the height with the signal grid above it. 0.68 keeps
 * the block board usable (a 3-row device board fits once the pane is this tall, see ControlSurface's
 * fit-to-view cell) while leaving the grid a workable strip. Smaller than the phone ratio on purpose:
 * on a wide screen the grid is still worth seeing while a block is open.
 */
export const AXIS_DESKTOP_BLOCK_EXPAND_RATIO = 0.68;
