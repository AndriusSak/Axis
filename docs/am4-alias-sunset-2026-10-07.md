# AM4 alias sunset — client `/am4/*` inventory & guard (2026-10-07)

ForgeFX still registers 16 `/am4/*` routes as deprecated aliases of the unified API-v2 routes
(`ForgeFX/server/src/app.ts:679-709`), `Sunset: Tue, 01 Dec 2026 00:00:00 GMT` (`app.ts:123`).
Axis calls 12 of them from live `legacyAm4` / `!isV2` fallback branches. When the aliases are
removed at the sunset those branches would 404 silently.

**Guard (new):** `src/lib/am4Deprecation.ts` holds the alias→unified inventory as data;
`src/lib/am4Deprecation.test.ts` asserts, against ForgeFX's own source, that (a) every `/am4/*` path
the client calls has a recorded unified equivalent and (b) the inventory still matches the server's
alias list — a *new* alias or a *removed* one fails the test. The alias list, the client-called
paths, the unified-route presence in **both** route tables (`app.ts` node host + `runtime/router.ts`
browser-direct) and the sunset date are read from source; only the alias→unified mapping is
hand-maintained and it is cross-checked by handler identity (alias and unified route must fold into
the same server handler).

## Migration status (route → unified → state)

| `/am4/*` alias (client helper) | unified route | status |
|---|---|---|
| GET `/am4/grid` (am4Grid) | `/preset/grid` | ready |
| GET `/am4/blocks/:pidLow/params` (am4BlockParams) | `/preset/blocks/:eid/params` | ready |
| PUT `/am4/blocks/:pidLow/params/:pidHigh` (am4SetParamNorm / am4SetParamValue) | `/preset/blocks/:eid/params/:paramId` | ready |
| POST `/am4/preset` (am4SwitchPreset) | `/preset/select` | ready |
| POST `/am4/scene` (am4SetScene) | `/scene` | ready |
| POST `/am4/preset/decode` (am4DecodeSyx) | `/preset/decode` | ready |
| GET `/am4/presets` (am4Presets) | `/preset/locations` | needs capability check (`caps.presets.canScanNames`) |
| POST `/am4/preset/store` (am4StorePreset) | `/preset/store` | needs capability check (`caps.supportsSave`) |
| POST `/am4/preset/backup` (am4BackupPreset) | `/preset/backup` | needs capability check (`caps.backupDump`) |
| POST `/am4/preset/restore` (am4RestorePreset) | `/preset/restore` | needs capability check (`caps.restoreDump`) |
| POST `/am4/firmware/validate` (am4ValidateFirmware) | `/firmware/validate` | needs capability check (`caps.firmwareValidate`) |
| GET `/am4/mod/model` (am4ModModel) | `/mod/model` | needs capability check (`caps.modifiers.model`) |

Unified equivalents exist in the browser-direct table for **all** of the above. Four aliases
(`/am4/slots`, `/am4/presets/:n/name`, `/am4/param`, `/am4/bypass`) have no Axis caller — recorded in
the inventory so a server-side change to them is still visible.

**"needs capability check"** = the client's v2 branch already gates the call on a `caps.*` field that
the legacy branch short-circuits (`legacyAm4 || !!caps.…`), so dropping the fallback in favour of the
unified route must first apply that gate to the fallback path too. The other six differ only by
route selection and are a straight swap. No behaviour change at the HTTP contract level otherwise:
each alias is the *same handler* behind a param/body shim.
