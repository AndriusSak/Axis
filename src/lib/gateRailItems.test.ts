import { describe, expect, it } from 'vitest';
import {
  GATE_RAIL_VIRTUAL_SLUGS,
  RAIL_UNAVAILABLE_REASONS,
  gateRailItem,
  gateRailItems,
  type GateRailInput
} from './gateRailItems';
import type { DeviceCaps } from './types';

// §3.5 rail capability gate. The legacy rail used to FILTER Setup/Controllers out whenever the served
// capabilities did not carry the backing virtual effect (AM4 → caps.virtualEffects = []); the screens
// vanished with no explanation. These fixtures are the real device capability shapes: gen-3 grid
// (FM3/FM9/III) serves [global, controllers, modifier, fc]; AM4/VP4 (non-grid) serves [].
const baseCaps: DeviceCaps = {
  slotModel: 'grid',
  hasScenes: true,
  sceneCount: 8,
  hasChannels: true,
  channelNames: ['A', 'B', 'C', 'D'],
  channelBlocks: [],
  supportsSave: true,
  gridRouting: true,
  fc: { model: true, liveState: true },
  virtualEffects: [
    { eid: 1, slug: 'global', name: 'Setup' },
    { eid: 2, slug: 'controllers', name: 'Controllers' },
    { eid: 3, slug: 'modifier', name: 'Modifier' },
    { eid: 199, slug: 'fc', name: 'Footswitches' }
  ]
};

// AM4 / VP4 shape: a linear (non-grid) device — no cables, no virtual-effect family.
const am4Caps: DeviceCaps = { ...baseCaps, slotModel: 'linear', gridRouting: false, fc: { model: false, liveState: false }, virtualEffects: [] };

const grid: GateRailInput = { isV2: true, isAm4: false, caps: baseCaps };
const am4: GateRailInput = { isV2: true, isAm4: false, caps: am4Caps };

const RAIL_IDS = ['build', 'library', 'controllers', 'fc', 'scenes', 'perform', 'sets', 'settings'] as const;

describe('gateRailItems — §3.5 Setup/Controllers capability gate', () => {
  it('maps Setup to GLOBAL and Controllers to CONTROLLERS', () => {
    expect(GATE_RAIL_VIRTUAL_SLUGS).toEqual({ settings: 'global', controllers: 'controllers' });
  });

  it('keeps build/library always available', () => {
    for (const input of [grid, am4, { isV2: false, isAm4: false, caps: null } as GateRailInput]) {
      expect(gateRailItem(input, 'build')).toMatchObject({ visible: true, enabled: true, reason: '' });
      expect(gateRailItem(input, 'library')).toMatchObject({ visible: true, enabled: true, reason: '' });
    }
  });

  it('enables Setup + Controllers on a gen-3 grid device (virtualEffects served)', () => {
    for (const id of ['settings', 'controllers']) {
      const s = gateRailItem(grid, id);
      expect(s.visible).toBe(true);
      expect(s.enabled).toBe(true);
      expect(s.reason).toBe('');
    }
  });

  it('KEEPS Setup + Controllers VISIBLE but DISABLED on an AM4 — with the capability reason (never removed)', () => {
    const setup = gateRailItem(am4, 'settings');
    const ctrl = gateRailItem(am4, 'controllers');
    expect(setup).toMatchObject({ id: 'settings', visible: true, enabled: false });
    expect(ctrl).toMatchObject({ id: 'controllers', visible: true, enabled: false });
    // the reason names the screen and the missing capability — it is not a bare "unavailable"
    expect(setup.reason).toMatch(/Setup/);
    expect(setup.reason).toMatch(/virtual effect/);
    expect(setup.reason).toMatch(/caps\.virtualEffects/);
    expect(ctrl.reason).toMatch(/Controllers/);
    expect(ctrl.reason).toMatch(/CONTROLLERS/);
  });

  it('gates only the slug the caps omit (partial virtualEffects)', () => {
    const partial: GateRailInput = {
      isV2: true,
      isAm4: false,
      caps: { ...baseCaps, virtualEffects: [{ eid: 1, slug: 'global', name: 'Setup' }] }
    };
    expect(gateRailItem(partial, 'settings').enabled).toBe(true);
    const ctrl = gateRailItem(partial, 'controllers');
    expect(ctrl.visible).toBe(true);
    expect(ctrl.enabled).toBe(false);
    expect(ctrl.reason).toMatch(/caps\.virtualEffects/);
  });

  it('does NOT gate on un-negotiated caps (v2 before the handshake lands) — matches the legacy optimism', () => {
    const unknown: GateRailInput = { isV2: true, isAm4: false, caps: null };
    expect(gateRailItem(unknown, 'settings').enabled).toBe(true);
    expect(gateRailItem(unknown, 'controllers').enabled).toBe(true);
  });

  it('gates Setup/Controllers on a legacy v1 AM4 server, naming the AM4', () => {
    const legacyAm4: GateRailInput = { isV2: false, isAm4: true, caps: null };
    const setup = gateRailItem(legacyAm4, 'settings');
    expect(setup).toMatchObject({ visible: true, enabled: false });
    expect(setup.reason).toMatch(/AM4/);
    expect(setup.reason).toMatch(/GLOBAL virtual effect/);
    expect(gateRailItem(legacyAm4, 'controllers').reason).toMatch(/AM4/);
  });

  it('leaves a legacy v1 non-AM4 server enabled (the documented static fallback serves eids 1/2)', () => {
    const legacy: GateRailInput = { isV2: false, isAm4: false, caps: null };
    expect(gateRailItem(legacy, 'settings')).toMatchObject({ visible: true, enabled: true, reason: '' });
    expect(gateRailItem(legacy, 'controllers')).toMatchObject({ visible: true, enabled: true, reason: '' });
  });

  it('keeps fc on the legacy capability filter (a real device capability, unchanged)', () => {
    // gen-3 grid: an fc model/virtual effect is served → visible
    expect(gateRailItem(grid, 'fc').visible).toBe(true);
    // AM4: no fc model, no cables → still filtered (unchanged, out of §3.5 scope)
    expect(gateRailItem(am4, 'fc').visible).toBe(false);
  });

  it('renders perform + sets VISIBLE and DISABLED with an honest reason on EVERY device (never removed, never a toast)', () => {
    const inputs: GateRailInput[] = [
      grid,
      am4,
      { isV2: false, isAm4: false, caps: null },
      { isV2: false, isAm4: true, caps: null }
    ];
    for (const input of inputs) {
      for (const id of ['perform', 'sets']) {
        const s = gateRailItem(input, id);
        expect(s.visible).toBe(true); // never a silent disappearance (no-dead-nav rule)
        expect(s.enabled).toBe(false); // the legacy rail has no host for these surfaces
        expect(s.reason.length).toBeGreaterThan(20);
        expect(s.reason).toBe(RAIL_UNAVAILABLE_REASONS[id]);
      }
    }
    // each reason names the REAL blocker — the workbench surface (perform) / the FC controller (sets)
    expect(gateRailItem(grid, 'perform').reason).toMatch(/Live|workbench/i);
    expect(gateRailItem(grid, 'sets').reason).toMatch(/FC-6/);
    expect(gateRailItem(grid, 'sets').reason).toMatch(/FC-12/);
  });

  it('does NOT derive perform/sets availability from caps.gridRouting', () => {
    // toggling the grid capability must not change these two ids — their availability is a
    // surface/FC fact, not a grid-cable one (the old generic branch was arbitrary here)
    const noGrid: GateRailInput = { isV2: true, isAm4: false, caps: { ...baseCaps, gridRouting: false } };
    expect(gateRailItem(noGrid, 'perform')).toMatchObject({ visible: true, enabled: false });
    expect(gateRailItem(noGrid, 'sets')).toMatchObject({ visible: true, enabled: false });
  });

  it('renders the legacy Scene Mgr DISABLED on a grid device, and filters it only where there is no scene grid', () => {
    const s = gateRailItem(grid, 'scenes');
    expect(s).toMatchObject({ visible: true, enabled: false }); // workbench-only surface → disabled, not a toast
    expect(s.reason).toBe(RAIL_UNAVAILABLE_REASONS.scenes);
    // AM4 has no scene grid → the Scene Manager genuinely does not exist there (a real capability filter)
    expect(gateRailItem(am4, 'scenes').visible).toBe(false);
  });

  it('resolves a whole rail list in order, keeping Setup/Controllers + perform/sets present on the AM4', () => {
    const items = gateRailItems(am4, RAIL_IDS);
    expect(items.map((i) => i.id)).toEqual([...RAIL_IDS]);
    const visible = items.filter((i) => i.visible).map((i) => i.id);
    // perform/sets stay visible-disabled even on the AM4 (never silently removed); scenes is filtered
    // there because the AM4 has no scene grid.
    expect(visible).toEqual(['build', 'library', 'controllers', 'perform', 'sets', 'settings']);
    // every visible-but-disabled entry carries a reason; every enabled one carries none
    for (const i of items.filter((x) => x.visible)) expect(i.enabled ? i.reason === '' : i.reason.length > 20).toBe(true);
  });

  it('keeps perform/sets/scenes DISABLED on a full gen-3 grid rail (no enabled dead-end)', () => {
    const items = gateRailItems(grid, RAIL_IDS);
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    for (const id of ['perform', 'sets', 'scenes']) expect(byId[id].enabled).toBe(false);
    // and every enabled entry is a real surface the legacy rail can open
    const enabled = items.filter((i) => i.enabled).map((i) => i.id);
    expect(enabled).toEqual(['build', 'library', 'controllers', 'fc', 'settings']);
  });
});
