import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { axisFcParity } from '../fc/fcParity';
import type { AxisFcModelLike } from '../fc/fcWorkbenchData';

/**
 * §3.8 "Master Layout Menu warning / edit precondition" — STOPPED as UNVERIFIABLE.
 *
 * The audit lists the item as still open. Before adding a warning the FC editor must find its evidence
 * in the SERVED `/fc/model` — and it does not: the served FC model contract (the `FcModel` interface in
 * `src/lib/types.ts`, mirrored from ForgeFX `server/src/devices.ts`) carries address/geometry/display
 * metadata only. There is no MLM flag, no edit-precondition field, and no per-layout editability — the
 * `GLOBAL_FC_MLM_DISABLED` ("Master Layout 'Switch Combo'") param lives in the GLOBAL family, not in the
 * FC (eid 199) model. Adding a warning would therefore require INVENTING a field, which the audit forbids.
 *
 * These guards record WHY the item stays open (so a future change cannot fabricate it silently) and will
 * fail loudly the moment the served contract gains such a field — at which point the warning can be
 * wired honestly instead.
 */
const typesSrc = readFileSync(fileURLToPath(new URL('../../types.ts', import.meta.url)), 'utf8');
const fcModelBlock = typesSrc.slice(
  typesSrc.indexOf('export interface FcModel'),
  typesSrc.indexOf('export interface FcSideState')
);

// A minimal FM3-shaped served model (the device the §3.8 sub-features were audited against).
const fm3Model: AxisFcModelLike = {
  effectId: 199,
  paramsWidth: 6,
  configs: 108,
  liveState: true,
  layouts: 9,
  views: 4,
  switches: 3,
  configsPerLayout: 12,
  labelLen: 11,
  fields: { tapParams: { width: 6, stride: 6 }, holdParams: { width: 6, stride: 6 } },
  categories: { '0': 'Unassigned', '6': 'Layout', '9': 'Per-Preset' },
  functions: { '6': [{ ord: 1, name: 'Master Layout', slots: [{ i: 0, role: 'View', type: 'int', min: 1, max: 4 }], labels: [] }] }
};

describe('FC §3.8 Master Layout Menu precondition — evidence boundary', () => {
  it('the served FcModel contract carries no MLM / edit-precondition field', () => {
    expect(fcModelBlock.length).toBeGreaterThan(0);
    expect(fcModelBlock).not.toMatch(/mlm|master\s*layout|precondition|editable/i);
  });

  it('the served contract still enumerates the fields it DOES carry', () => {
    for (const field of ['effectId', 'paramsWidth', 'configs', 'fields', 'liveState', 'layouts', 'switches', 'configsPerLayout']) {
      expect(fcModelBlock).toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  it('the §3.8 parity list does not fabricate an MLM-precondition feature', () => {
    const ids = axisFcParity(fm3Model).map((f) => f.id);
    expect(ids).toHaveLength(7);
    for (const id of ids) expect(id).not.toMatch(/mlm|master|precondition/i);
    // "Master Layout" appears only as the served Layout-category FUNCTION (Layout Links), never as a
    // separate precondition feature with an invented param.
    const layoutLinks = axisFcParity(fm3Model).find((f) => f.id === 'layoutLinks')!;
    expect(layoutLinks.status).toBe('supported');
    expect(layoutLinks.detail).toMatch(/Layout/i);
  });
});
