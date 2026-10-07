// P3 "AM4 alias sunset" inventory — the Axis client's calls to ForgeFX's DEPRECATED `/am4/*`
// alias routes, and the unified API-v2 route that replaces each one.
//
// WHY THIS EXISTS
// ForgeFX registers every `/am4/*` route as a thin DEPRECATED ALIAS of a unified API-v2 route — the
// same handler behind a param/body shim, plus `Deprecation: true` + `Sunset` headers
// (ForgeFX/server/src/app.ts, `ALIAS_SUNSET = 'Tue, 01 Dec 2026 00:00:00 GMT'`). Axis still calls
// those aliases from live `legacyAm4` / `!isV2` fallback branches (editor.svelte.ts,
// history.svelte.ts, DeviceTools.svelte, library.svelte.ts). When the aliases are removed at the
// sunset those branches 404 — and nothing would notice. This module records the inventory so
// `am4Deprecation.test.ts` can assert, against ForgeFX's own source, that
//   (a) every `/am4/*` path the client actually calls still has a recorded unified equivalent, and
//   (b) the record has not drifted from the server's alias list —
// so a NEW alias (added server-side, unrecorded here) or a REMOVED one (sunset) fails the test
// instead of rotting silently.
//
// DATA PROVENANCE
// - HAND-MAINTAINED (this file): `method`, `aliasPath`, `unifiedPath`, `clientHelper`, `callSites`,
//   `status`. The alias→unified join is by handler identity — e.g. `/am4/grid` and `/preset/grid`
//   both fold into `gridH` — but `gridH` alone answers TWO unified paths (`/preset/grid` and
//   `/presets/:n/grid`), so an automatic join is ambiguous. The test therefore VERIFIES the
//   hand-mapping against source: it reads the alias list from app.ts, the handler each alias folds
//   into, and the handler each unified route calls, failing on any handler mismatch.
// - SOURCE-DERIVED (by the test, never stored here): the live alias list, the client-called paths,
//   unified-route existence in BOTH route tables (app.ts node host + runtime/router.ts
//   browser-direct), the browser-table flag, and the sunset date.
//
// The `callSites` line numbers are as-of the 2026-10-07 inventory; the test only pins the FILE,
// not the line, so an unrelated edit that shifts a line does not break the guard.

/** The server's alias `Sunset` header value. Mirrored here so the test can pin it against app.ts. */
export const AM4_ALIAS_SUNSET = 'Tue, 01 Dec 2026 00:00:00 GMT';

/**
 * Migration readiness of one alias→unified pair.
 * - `ready` — the client's v2 and legacy branches differ only by route selection (isV2/isAm4 or a
 *   model-byte sniff); the unified route is a drop-in for the alias with no behaviour change.
 * - `needs-capability-check` — the client's v2 branch guards this call with a `caps.*` gate that the
 *   legacy branch short-circuits (`legacyAm4 || !!caps.…`, or a `v2 ? … : …` name-scan probe). A
 *   straight swap of the legacy call must first apply that gate, or the UI would offer an action the
 *   linked server/device may answer `501 {error:'unsupported'}`.
 * - `no-unified-equivalent` — the server exposes no unified target (none today; kept for the type).
 */
export type Am4MigrationStatus = 'ready' | 'needs-capability-check' | 'no-unified-equivalent';

export interface Am4AliasEntry {
  method: 'GET' | 'POST' | 'PUT';
  /** The deprecated alias path the client calls, using ForgeFX's own param names. */
  aliasPath: string;
  /** The unified API-v2 route that replaces it. Empty only when status is `no-unified-equivalent`. */
  unifiedPath: string;
  /** forgefx.ts helper that hits the alias, or null when the client never calls this alias. */
  clientHelper: string | null;
  /** Where the client calls that helper (file:line as of 2026-10-07). Empty when unused. */
  callSites: string[];
  status: Am4MigrationStatus;
}

/**
 * The full inventory: all 16 `/am4/*` aliases ForgeFX registers (app.ts:679-709), 12 of which the
 * Axis client still calls live. The 4 with `clientHelper: null` exist server-side but have no Axis
 * caller — they are recorded so the drift check sees the whole alias surface.
 */
export const AM4_ALIAS_INVENTORY: readonly Am4AliasEntry[] = [
  // ── called by the client (forgefx.ts am4* helpers) ───────────────────────────────────────────
  {
    method: 'GET', aliasPath: '/am4/grid', unifiedPath: '/preset/grid',
    clientHelper: 'am4Grid', callSites: ['editor.svelte.ts:1484'], status: 'ready'
  },
  {
    method: 'GET', aliasPath: '/am4/blocks/:pidLow/params', unifiedPath: '/preset/blocks/:eid/params',
    clientHelper: 'am4BlockParams',
    callSites: ['editor.svelte.ts:600', 'editor.svelte.ts:1621', 'editor.svelte.ts:2446', 'editor.svelte.ts:2475'],
    status: 'ready'
  },
  {
    method: 'GET', aliasPath: '/am4/presets', unifiedPath: '/preset/locations',
    clientHelper: 'am4Presets', callSites: ['library.svelte.ts:315'],
    // library.svelte.ts:310 gates the v2 name-scan on caps.presets.canScanNames; the legacy branch
    // probes the model byte instead → unifying needs that capability check on the fallback.
    status: 'needs-capability-check'
  },
  {
    method: 'POST', aliasPath: '/am4/preset', unifiedPath: '/preset/select',
    clientHelper: 'am4SwitchPreset',
    callSites: ['editor.svelte.ts:2828', 'editor.svelte.ts:2851'], status: 'ready'
  },
  {
    method: 'POST', aliasPath: '/am4/scene', unifiedPath: '/scene',
    clientHelper: 'am4SetScene', callSites: ['editor.svelte.ts:2570', 'history.svelte.ts:299'],
    status: 'ready'
  },
  {
    method: 'PUT', aliasPath: '/am4/blocks/:pidLow/params/:pidHigh',
    unifiedPath: '/preset/blocks/:eid/params/:paramId',
    clientHelper: 'am4SetParamNorm',
    callSites: ['editor.svelte.ts:1678', 'history.svelte.ts:267'], status: 'ready'
  },
  {
    method: 'PUT', aliasPath: '/am4/blocks/:pidLow/params/:pidHigh',
    unifiedPath: '/preset/blocks/:eid/params/:paramId',
    clientHelper: 'am4SetParamValue',
    callSites: ['editor.svelte.ts:1699', 'history.svelte.ts:270'], status: 'ready'
  },
  {
    method: 'GET', aliasPath: '/am4/mod/model', unifiedPath: '/mod/model',
    clientHelper: 'am4ModModel', callSites: ['DeviceTools.svelte:139'],
    // DeviceTools.svelte:40 canModView = legacyAm4 || !!caps.modifiers.model.
    status: 'needs-capability-check'
  },
  {
    method: 'POST', aliasPath: '/am4/preset/store', unifiedPath: '/preset/store',
    clientHelper: 'am4StorePreset',
    callSites: ['editor.svelte.ts:2871', 'DeviceTools.svelte:153'],
    // DeviceTools.svelte:43 canStoreSlot = legacyAm4 || (bankLetterAddressing && caps.supportsSave).
    status: 'needs-capability-check'
  },
  {
    method: 'POST', aliasPath: '/am4/preset/backup', unifiedPath: '/preset/backup',
    clientHelper: 'am4BackupPreset', callSites: ['DeviceTools.svelte:65'],
    // DeviceTools.svelte:37 canBackup = legacyAm4 || !!caps.backupDump.
    status: 'needs-capability-check'
  },
  {
    method: 'POST', aliasPath: '/am4/preset/restore', unifiedPath: '/preset/restore',
    clientHelper: 'am4RestorePreset', callSites: ['DeviceTools.svelte:96'],
    // DeviceTools.svelte:38 canRestore = legacyAm4 || !!caps.restoreDump.
    status: 'needs-capability-check'
  },
  {
    method: 'POST', aliasPath: '/am4/preset/decode', unifiedPath: '/preset/decode',
    clientHelper: 'am4DecodeSyx', callSites: ['DeviceTools.svelte:108'],
    // decodeSyxBytes works for both device families (DeviceTools.svelte:3) — no capability gate.
    status: 'ready'
  },
  {
    method: 'POST', aliasPath: '/am4/firmware/validate', unifiedPath: '/firmware/validate',
    clientHelper: 'am4ValidateFirmware', callSites: ['DeviceTools.svelte:128'],
    // DeviceTools.svelte:39 canFirmware = legacyAm4 || !!caps.firmwareValidate.
    status: 'needs-capability-check'
  },

  // ── server-side aliases the Axis client does NOT call (recorded for the drift check) ─────────
  {
    method: 'GET', aliasPath: '/am4/slots', unifiedPath: '/preset/blocks',
    clientHelper: null, callSites: [], status: 'needs-capability-check'
  },
  {
    method: 'GET', aliasPath: '/am4/presets/:n/name', unifiedPath: '/presets/:n',
    clientHelper: null, callSites: [], status: 'ready'
  },
  {
    method: 'PUT', aliasPath: '/am4/param', unifiedPath: '/device/param',
    clientHelper: null, callSites: [], status: 'needs-capability-check'
  },
  {
    method: 'POST', aliasPath: '/am4/bypass', unifiedPath: '/preset/blocks/:eid/bypass',
    clientHelper: null, callSites: [], status: 'needs-capability-check'
  }
] as const;
