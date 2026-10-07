// Grid Navigation Mode (audit §2.9, R25) — pure fetch-suppression policy.
//
// FM3-Edit's Grid Navigation Mode is a "fast grid ops" mode: moving around, placing and routing on
// the grid must stay snappy instead of reading every touched block's parameters from the device. In
// Axis the ONLY automatic per-block parameter read the grid itself triggers today is
// `editor.openCell` → `editor.#loadParams`, fired by a single tap on a placed block (a tap selects
// the block AND opens the block editor). Placement / move / route call the grid-only `editor.load`
// (layout reload), never a param read — so the policy below records that honestly.
//
// This module is PURE (no store, no Svelte, no device): the grid consults `shouldFetchOnGridAction`
// for every action it dispatches and gets one of three decisions —
//   • fetch  — read the block's params from the device (the per-block fetch)
//   • skip   — no fetch; the grid keeps rendering the chain/state it already holds
//   • refuse — the action GENUINELY needs fresh params, which the mode deliberately left unread;
//              refuse with a NAMED reason rather than acting on stale/absent values.
// It is unit-tested in gridNavMode.test.ts; the reactive toggle (a tiny standalone store, NOT an
// editor-store member) lives in gridNavMode.svelte.ts; the .svelte wiring is pinned by
// gridNavModeWiring.sourceguard.test.ts.

export type GridNavMode = 'normal' | 'gridNav';

/**
 * The grid actions the policy reasons over:
 *  - select     — tapping a block to select it (today: also opens the editor → fetches)
 *  - navigate   — moving the grid cursor / paging without changing the selection
 *  - place      — placing a block into a cell (palette / quick-build; grid-only reload, no params)
 *  - route      — connecting / disconnecting cables (no params)
 *  - openEditor — the EXPLICIT open-block-editor action (double tap / open affordance)
 *  - paramEdit  — an in-place param gesture (tile wheel / swipe HUD) that edits a served parameter
 */
export type GridNavAction = 'select' | 'navigate' | 'place' | 'route' | 'openEditor' | 'paramEdit';

export type GridNavDecision =
  | { kind: 'fetch' }
  | { kind: 'skip' }
  | { kind: 'refuse'; reason: string };

/**
 * Named refusal for in-place param gestures attempted while grid-nav mode is on: the block's served
 * param context (min/max/log/unit + values) was deliberately NOT fetched, so editing against it
 * would be a silent stale write. Refusing with this reason beats that.
 */
export const GRID_NAV_PARAM_REFUSAL =
  'Grid Navigation Mode is on — open the block to load its parameters before editing';

/**
 * The single fetch-decisions table the Signal Grid consults. Rules:
 *  1. The EXPLICIT open action always fetches — in BOTH modes. Grid-nav suppresses the AUTOMATIC
 *     read on selection; it never suppresses the user's deliberate open.
 *  2. Grid-nav mode: select / navigate / place / route are fast grid ops → skip the fetch.
 *  3. Grid-nav mode: in-place param editing genuinely requires the block's served params → refuse.
 *  4. Normal mode: selecting a block auto-fetches (today's tap → openCell → #loadParams behavior);
 *     every other grid action operates on the held layout/meters and never fetched anyway.
 */
export function shouldFetchOnGridAction(mode: GridNavMode, action: GridNavAction): GridNavDecision {
  // 1. the explicit open is the one path that always reads fresh params
  if (action === 'openEditor') return { kind: 'fetch' };
  if (mode === 'gridNav') {
    // 2. fast grid ops: never a per-block read
    if (action === 'select' || action === 'navigate' || action === 'place' || action === 'route')
      return { kind: 'skip' };
    // 3. needs the params the mode deliberately left unread
    if (action === 'paramEdit') return { kind: 'refuse', reason: GRID_NAV_PARAM_REFUSAL };
  }
  // 4. normal mode: select auto-fetches (the tap opens the block editor, which reads params)…
  if (action === 'select') return { kind: 'fetch' };
  // …and nothing else on the grid ever fetched.
  return { kind: 'skip' };
}