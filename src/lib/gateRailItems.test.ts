import { describe, expect, it } from 'vitest';
import {
  GATE_RAIL_VIRTUAL_SLUGS,
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

  it('keeps the out-of-scope ids (fc + coming-soon routing family) on the legacy capability filter', () => {
    // gen-3 grid: fc + scenes/perform/sets all ride their capabilities → visible
    expect(gateRailItem(grid, 'fc').visible).toBe(true);
    expect(gateRailItem(grid, 'scenes').visible).toBe(true);
    // AM4: no fc model, no cables → those entries are still filtered (unchanged, out of §3.5 scope)
    expect(gateRailItem(am4, 'fc').visible).toBe(false);
    expect(gateRailItem(am4, 'scenes').visible).toBe(false);
    expect(gateRailItem(am4, 'perform').visible).toBe(false);
    expect(gateRailItem(am4, 'sets').visible).toBe(false);
  });

  it('resolves a whole rail list in order, keeping Setup/Controllers present on the AM4', () => {
    const items = gateRailItems(am4, RAIL_IDS);
    expect(items.map((i) => i.id)).toEqual([...RAIL_IDS]);
    const visible = items.filter((i) => i.visible).map((i) => i.id);
    expect(visible).toEqual(['build', 'library', 'controllers', 'settings']);
    // every visible-but-disabled entry carries a reason; every enabled one carries none
    for (const i of items.filter((x) => x.visible)) expect(i.enabled ? i.reason === '' : i.reason.length > 20).toBe(true);
  });
});
