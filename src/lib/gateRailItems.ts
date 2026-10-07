import type { DeviceCaps } from './types';

/**
 * §3.5 rail capability gate — parity audit `docs/axis-fm3edit-feature-parity-audit.md`.
 *
 * The legacy ToolRail used to *filter* Setup (virtual-effect slug `global`) and Controllers
 * (`controllers`) out of the rail whenever the device's capabilities did not serve the backing
 * virtual effect. On an AM4 — whose capabilities carry `virtualEffects: []` — and on any device
 * whose `caps.virtualEffects` omits the slug, the two screens silently vanished: no entry, no
 * explanation. This module derives, purely from the SERVED capabilities (never a device id and never
 * a hard-coded per-model table), whether a rail entry is available, and — when it is not — the honest
 * reason to render on a DISABLED entry.
 *
 * no-dead-nav rule (01-shell.md §9): a control that cannot work is rendered disabled with the exact
 * reason in its tooltip — never a silent disappearance and never a fake. This module supplies the
 * reason; the rail renders the disabled state.
 */

export interface GateRailItemState {
  /** Stable rail id (build/library/controllers/fc/scenes/perform/sets/settings). */
  id: string;
  /** Render the entry at all (false = the legacy silent filter, retained for the out-of-scope ids). */
  visible: boolean;
  /** The entry can open its screen on this device (false = render disabled with `reason`). */
  enabled: boolean;
  /** Honest, capability-derived reason shown on a disabled entry ('' when enabled). */
  reason: string;
}

export interface GateRailInput {
  isV2: boolean;
  isAm4: boolean;
  caps: DeviceCaps | null;
}

/**
 * The rail ids whose screen is backed by a device virtual effect: Setup opens GLOBAL, Controllers
 * opens CONTROLLERS. These two are the §3.5 scope — they are NEVER silently removed; when the
 * capability is absent they stay visible and render disabled with the reason.
 */
export const GATE_RAIL_VIRTUAL_SLUGS: Readonly<Record<string, string>> = {
  settings: 'global',
  controllers: 'controllers'
};

/** Screen name per virtual-effect slug (the rail label is "Settings" but the screen it opens is "Setup"). */
const SCREEN_NAME: Readonly<Record<string, string>> = {
  global: 'Setup',
  controllers: 'Controllers'
};

/** The effect family name the capability is served under (matches caps.virtualEffects[].name). */
const EFFECT_NAME: Readonly<Record<string, string>> = {
  global: 'GLOBAL',
  controllers: 'CONTROLLERS'
};

/**
 * Rail entries whose screen the LEGACY shell has no host for. They are kept visible (never a silent
 * removal) and render DISABLED with the exact reason — the no-dead-nav rule, 01-shell.md §9. Their
 * availability is a property of the SURFACE, not of `caps.gridRouting`:
 *   - perform → the real Live / Performance page is a workbench panel (`axis.live`, audit §2.2). This
 *     rail mounts only when the workbench is disabled (`routes/+page.svelte`), so it cannot open it.
 *   - sets    → Setlists / Songs require an FC-6 or FC-12 foot controller and are PARKED (audit §2.3).
 *   - scenes  → the Scene Manager is a workbench page (audit §2.1); the legacy shell has no scenes
 *     screen (per-scene switching stays available from the TopBar selector / mobile drawer).
 * Never a device id, never a fake — each reason names the real blocker.
 */
export const RAIL_UNAVAILABLE_REASONS: Readonly<Record<string, string>> = {
  perform:
    'Live / Performance is a workbench page — this legacy rail can’t open it. Use the workbench shell to reach Perform.',
  sets: 'Sets & Songs (Setlists) require an FC-6 or FC-12 foot controller — parked; this rig has no FC controller.',
  scenes:
    'Scene Manager is a workbench page — this legacy rail can’t open it. Switch scenes from the TopBar selector or the mobile drawer.'
};

function servedVirtualSlugs(caps: DeviceCaps | null): Set<string> {
  return new Set((caps?.virtualEffects ?? []).map((v) => v.slug));
}

/**
 * Availability of one virtual-effect-backed screen. The legacy rail had three availability sources;
 * this preserves them exactly, but converts the "absent" outcomes into a disabled-with-reason state
 * instead of a silent removal:
 *   - API v2 with caps: the device's own `caps.virtualEffects` must list the slug;
 *   - API v2 before caps land: not yet known → optimistic (the rail never gated on un-negotiated caps);
 *   - legacy v1: the documented static fallback serves GLOBAL/CONTROLLERS on a non-AM4 unit, but an
 *     AM4 (legacy or v2) has no virtual-effect family at all.
 */
function virtualAvailability(input: GateRailInput, slug: string): { enabled: boolean; reason: string } {
  const { isV2, isAm4, caps } = input;
  const screen = SCREEN_NAME[slug] ?? slug;
  const effect = EFFECT_NAME[slug] ?? slug.toUpperCase();
  if (isV2 && caps) {
    const served = servedVirtualSlugs(caps).has(slug);
    return {
      enabled: served,
      reason: served
        ? ''
        : `${screen} is unavailable — this device's capabilities do not serve the ${effect} virtual effect (caps.virtualEffects).`
    };
  }
  if (isV2 && !caps) return { enabled: true, reason: '' }; // caps not negotiated yet — don't gate on the unknown
  if (isAm4) {
    return {
      enabled: false,
      reason: `${screen} is unavailable on the AM4 — the device serves no ${effect} virtual effect.`
    };
  }
  return { enabled: true, reason: '' }; // legacy v1 non-AM4: the static fallback (eids 1/2) serves it
}

/**
 * Resolve one rail entry. `build`/`library` are always available. Setup/Controllers are ALWAYS
 * visible — disabled + reason when the capability is absent (§3.5). perform/sets/scenes are legacy-
 * shell surfaces with no host in this rail: they are NOT driven by `caps.gridRouting` (their
 * availability is a surface/FC fact, not a grid-cable one) — perform/sets stay visible and DISABLED
 * with the honest reason, scenes is visible only where the device actually has a scene grid. `fc`
 * keeps the legacy capability filter.
 */
export function gateRailItem(input: GateRailInput, id: string): GateRailItemState {
  const { isV2, isAm4, caps } = input;
  if (id === 'build' || id === 'library') return { id, visible: true, enabled: true, reason: '' };

  const slug = GATE_RAIL_VIRTUAL_SLUGS[id];
  if (slug) {
    const { enabled, reason } = virtualAvailability(input, slug);
    return { id, visible: true, enabled, reason };
  }

  const unavailable = RAIL_UNAVAILABLE_REASONS[id];
  if (unavailable) {
    // perform/sets have no grid relationship at all → always visible. scenes is filtered only where the
    // device genuinely has no scene grid (AM4), which is a real capability, not an arbitrary proxy.
    const visible = id === 'scenes' ? (isV2 && caps ? !!caps.gridRouting : !isAm4) : true;
    return { id, visible, enabled: false, reason: unavailable };
  }

  if (isV2 && caps) {
    const ve = servedVirtualSlugs(caps);
    const visible = id === 'fc' ? !!caps.fc?.model || ve.has('fc') : !!caps.gridRouting;
    return { id, visible, enabled: true, reason: '' };
  }
  if (isAm4) return { id, visible: false, enabled: true, reason: '' };
  return { id, visible: true, enabled: true, reason: '' };
}

/** Resolve a whole rail list, preserving order. */
export function gateRailItems(input: GateRailInput, ids: readonly string[]): GateRailItemState[] {
  return ids.map((id) => gateRailItem(input, id));
}
