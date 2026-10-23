# Axis

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-support-72a4f2?logo=ko-fi&logoColor=white)](https://ko-fi.com/R5R6223HMO)

A fast, touch-friendly editor for **Fractal Audio** devices (FM3 first) — the visual front end for
**[ForgeFX](https://github.com/AndriusSak/ForgeFX)**. Axis is a SvelteKit app that decodes and edits
the **live preset off the device**: the real routing grid, every block, a widget-grid control
surface you can rearrange, real EQ editors, a cab IR / DynaCab picker, tuner, tempo, and scenes.

It runs three ways from the same code: as a **desktop app** (bundles ForgeFX, one install), as a
**web page** that talks to the device straight from the browser (no install at all), or as a
**remote screen** for a desktop app running on another machine.

> **Status:** community **beta**, hardware-verified on **FM3 firmware 13.0**. The FM3's block and
> sub-type lists are generated from the firmware's own editor definitions, not from the wiki, so
> every dropdown matches what the unit actually offers on 13.0.

> ⚠️ **Independent, third-party project — not affiliated with or endorsed by Fractal Audio
> Systems. Use at your own risk.** Always back up your presets. See [DISCLAIMER.md](./DISCLAIMER.md).

## Upstream, and what changed here

This is a fork of [sKuhLight/Axis](https://github.com/sKuhLight/Axis), whose last release was
**v0.9.25-beta (20 July 2026)** — public Windows/macOS/Linux installers, FM3 **firmware 12.0**.
Everything below is that project plus this fork's line of work.

**Inherited from upstream:** the workbench shell and signal grid, block editor, rearrangable control
surface, EQ graphs, cab IR / DynaCab board, tuner, tempo, scenes, cross-device preset conversion with
`.syx` export, device-definition capture, and both browser modes (Direct over Web Serial/MIDI, Remote
over a relay).

**Added here, in short:**

| Version | What changed |
|---|---|
| 1.0.0 · 13 Oct 2026 | First release of this fork: the **foot-controller editor** (layout, per-switch function, TAP/HOLD, per-preset layout scope), a **Manage Cabs** panel with IR import and conversion, and the local board / DynaCab layout line. |
| 1.0.1 – 1.0.2 · 13 Oct | The FC panel names the layout its switches belong to. The cab board stops re-converting a WAV on every keystroke, and never overwrites a slot the library copy no longer matches. |
| 1.0.3 · 14 Oct | Desktop bundle rebuilt on the post-1.0.2 engine. |
| 1.0.4 – 1.0.10 | USB/serial hardening: open the `cu.*` callout node on macOS, list the real ports, retry an open, report **why** it failed, keep the definitions capture alive, and keep rescan reachable. |
| 1.0.12 – 1.0.14 | Device detection: the type selector is picked by label count instead of by name, and every editor cache on disk is offered for import. |
| 1.0.15 – 1.0.18 | **Firmware 13.0** block and sub-type tables: amp 336, drive 87, chorus 27, three reverbs renamed, `DISTORT_TUBETYPE` 26, fuzz diodes 22 — plus the per-parameter enums of blocks that have no type selector (formant, multiplexer, output, feedback return). |
| 1.0.18 | GitHub auto-updater removed: upstream's feed stopped at 0.9.25-beta, so every launch logged a refused downgrade. |

Builds here are macOS zips, a Windows x64 installer and a Linux AppImage. No `.dmg` — producing one
needs macOS tooling, and upstream's CI was the only place that ever made them.

## Device support

"Verified" means it was driven against real hardware here. "Expected" means the code path is shared
with the FM3 but nobody has plugged that unit into this build. "Early" means partial code, no
verification. "Not supported" means the handshake identifies it and nothing else happens.

| Device | Status | What actually works |
|---|---|---|
| **FM3** (0x11) | **Verified**, firmware 13.0 | Full editing: grid, blocks, params, channels, scenes, tuner, tempo, cab/IR board, preset save + conversion. Front-panel edits reflect (polled — the FM3 never pushes them). FC live switch state. Definitions walk. |
| **FM9** (0x12) | Expected, untested | Same gen-3 codec, 6×14 grid, preset dump and conversion, definitions walk offered, front-panel edits pushed by the unit. **Not wired:** per-block preset-body decode and FC live switch read are FM3-only, so param pages come from the served catalog rather than the preset body. |
| **Axe-Fx III** (0x10) | Expected, untested | Same as FM9. |
| **VP4** (0x14) | Early | Gen-3 codec on a 4-slot surface: reads work, writes are gated beta. Not verified. |
| **AM4** (0x15) | Partial | Its own codec, 4 linear slots. Definitions are **import-only** — the unit is never walked. Front-panel reflection has an open bug list (`docs/AM4-AXIS-REFLECTION-BUGS.md` upstream). |
| **Axe-Fx II XL+** (0x07) | Early | A gen-2 codec exists (dump + writes per its own opcodes); never verified against a unit, and its blocks come from the catalog, not a firmware cache. |
| Axe-Fx Standard/Ultra, II, II XL, FX8, AX8 | **Not supported** | Identified by the handshake, then reported as unsupported. |

The firmware 13.0 type and sub-type tables are FM3 work. Other devices get whatever their shipped
catalog snapshot holds, or whatever an imported editor cache provides.

## Platform support

| Platform | Build from this fork | FM3 (USB serial) | FM9 / III / AM4 / VP4 (USB MIDI) |
|---|---|---|---|
| macOS, Apple silicon | zip — verified on an M4 Pro | ✓ (needs the two Gatekeeper commands) | Expected |
| macOS, Intel | zip — built, untested | Expected | Expected |
| Linux x86_64 | AppImage — engine verified, GUI untested | Expected | Expected |
| Windows 10/11 x64 | exe installer — install verified, app untested | Expected (COM port) | Expected |
| Chrome / Edge, desktop | web build | ✓ Web Serial | ✓ Web MIDI |
| ChromeOS | web build | ✓ Web Serial | ✓ Web MIDI |
| Firefox, desktop | web build | ✗ no Web Serial | ✓ Web MIDI |
| Android, Chrome | web build | ✗ | ✓ Web MIDI, if the unit shows up as a MIDI device |
| iOS / iPadOS | web build | ✗ | ✗ no USB device APIs |

## Known limitations

- **Unsigned builds.** No code signing or notarization anywhere: macOS needs `xattr` + `codesign`
  after every fresh copy, and the AppImage installs nothing (no menu entry unless you add one).
- **No updater.** Updates mean downloading a new release. There's no update feed and no delta patching.
- **Remote mode is unusable in this build.** It relays through a Supabase project, and no credentials
  are compiled in, so the browser build falls back to Direct. Driving the unit from another machine
  means running the desktop app where the unit is plugged in and reaching it over a VPN or remote
  desktop — not the Remote toggle.
- **FM3 in a browser needs desktop Chromium.** Web Serial doesn't exist on iOS, Android or Firefox.
  A MIDI interface into the FM3 works anywhere Web MIDI does.
- **FM9 / Axe-Fx III are second-class citizens.** Per-block preset-body decode and live FC state are
  FM3-only. Anything that reads a block's own body — rather than the catalog — is FM3-shaped today.
- **One program per port.** Quit FM3-Edit / Axe-Edit before connecting; the serial port is exclusive.
- **Preset export is FM3-proven.** FM9 and III export files round-trip through the decoder but have
  never been loaded onto a unit; AM4, VP4, II and gen-1 targets are not exportable at all.
- **No mobile apps.** There is no iOS or Android build, and none is planned here.
- **Back up your presets.** Community beta, no warranty — see [DISCLAIMER.md](./DISCLAIMER.md).

## Compared with FM3-Edit

FM3-Edit is the reference editor; this is not a drop-in replacement for all of it. Still missing:

| FM3-Edit feature | Here |
|---|---|
| **Setlists / Songs** | Not implemented. The hardware feature needs an FC-6 or FC-12, and the nav entry only reaches the Scenes page. |
| **Preset + cab bundles, `.bnk` bank import** | Not implemented. A bundle needs the user-cab *bytes* off the unit, and no endpoint returns them. |
| **Clear Preset** | Not possible on this protocol — the gen-3 write codec has no erase/init op, so the entry is an honest negative rather than a fake. |
| **Move / delete device slots** | Same cause: no slot-erase primitive on the wire. Duplicate, swap and reorder *are* there; reorder is a checked permutation over copy-by-store. |
| **FC "Devices" tab / controller mirroring** | Absent — no served parameter exposes it on the FM3. |
| **Firmware updates** | Out of scope: Axis never writes firmware. That stays with Fractal's tooling. |
| **Cloud library / preset sharing** | No. Presets live in the local library (IndexedDB in the browser build); the account sync path needs credentials this build doesn't carry. |

Everything else audited against FM3-Edit — grid and block operations, channel operations, scenes, modifier read-back, FC layouts, colour tags, keyboard shortcuts — is implemented. The full working list, with evidence per row, is `docs/axis-fm3edit-feature-parity-audit.md`.

## Install (desktop app)

Prebuilt apps are attached to **[Releases](https://github.com/AndriusSak/Axis/releases)**. Every
artifact has a matching `.sha256` — verify it before installing.

| Platform | Artifact |
|---|---|
| macOS (Apple silicon / Intel) | `Axis-<version>-arm64-mac.zip`, `Axis-<version>-mac.zip` |
| Windows 10/11 (x64) | `Axis-<version>-win-x64.exe` — per-user installer, no admin prompt |
| Linux (x86_64) | `Axis-<version>.AppImage` |

On Windows the installer is also unsigned: SmartScreen shows "Windows protected your PC" — **More
info → Run anyway**. It installs per user into `%LOCALAPPDATA%\Programs\axis`, no admin prompt.

The app bundles the ForgeFX engine, so there's no separate setup. Connect your FM3 over USB and
launch. On Windows the FM3 is a COM port via Fractal's USB driver; on Linux/macOS it's native CDC,
no driver needed. **Quit Fractal's FM3-Edit (or any other editor) first** — only one program can
hold the port.

### macOS: first launch

Axis isn't code-signed or notarized (it's a free beta), so Gatekeeper reports the download as
**"Axis.app is damaged and can't be opened."** The copy isn't damaged; it carries the quarantine
flag that macOS puts on unsigned downloads, and the ad-hoc signature doesn't satisfy Gatekeeper
either. Clear both, once per copy — a freshly unzipped app needs it again:

```bash
sudo xattr -rd com.apple.quarantine /Applications/Axis.app
sudo codesign --force --deep --sign - /Applications/Axis.app
open /Applications/Axis.app
```

Both commands only touch the app bundle in `/Applications`; each asks for your password.

## Run in a browser (no install)

**axisapp.live is not this build.** It's the upstream project's own deployment, serving upstream's
code, so it won't have this fork's fixes or its firmware 13.0 tables. This fork's browser build is
deployed privately; to run *this* version with no install, build the web variant and serve it:

```bash
VITE_AXIS_REMOTE=1 npm run build                        # served from the domain root
AXIS_BASE=/axis/live VITE_AXIS_REMOTE=1 npm run build   # served from a subpath
```

Then open it in **Chrome or Edge on a desktop**, plug the unit into *that* computer, and pick the
connection:

- **FM3** — over Web Serial. Desktop Chromium only: iOS, Android and Firefox cannot open the port.
- **FM9 / Axe-Fx III / AM4** — over Web MIDI, which also works in Firefox and on Android.

There is no server in this mode: the whole ForgeFX runtime runs in the page (`src/lib/direct/`),
presets live in the browser's IndexedDB, and optional folder sync uses the File System Access API.
`?mode=remote` instead relays to the desktop app on another machine through an Axis account — the
device stays plugged into that desktop.

## Run (dev)

Requires **Node 20+**. Axis talks to a running ForgeFX server.

```bash
npm run setup:stack     # builds the sibling ../forgefx-midi and ../ForgeFX/server

cd ../ForgeFX/server && npm run dev   # http://localhost:5056 — owns the serial port
npm run dev                           # http://localhost:5173 — proxies /api to :5056
```

`VITE_FORGEFX_BASE` overrides the API base (see `.env.example`). `npm run dev:remote` starts the same
dev server as the web build.

Checks: `npm run check` (svelte-check) and `npm test` (vitest). `npm run test:e2e` runs Playwright
against a live unit.

### Desktop dev / build

```bash
npm run electron:dev      # Electron against the Vite dev server + sibling ../ForgeFX
npm run desktop:build     # UI + package (needs ../ForgeFX built)
npm run desktop:zip:mac   # mac zips only, both arches, no signing
```

Desktop builds must set `VITE_FORGEFX_BASE=` (empty) — the packaged engine serves bare paths. A
build made with a non-empty base silently receives HTML where it expects JSON.

There is **no auto-updater**: `electron-builder.yml` has no `publish` block, and `electron/updater.cjs`
skips the check when `resources/app-update.yml` is absent. Updates are new downloads from the
dashboard.

## Build (web)

```bash
npm run build                                    # static SPA -> build/
AXIS_BASE=/axis/live VITE_AXIS_REMOTE=1 npm run build   # web build under a path prefix
```

`VITE_AXIS_REMOTE=1` switches to absolute asset paths and enables the service worker; `AXIS_BASE`
sets `kit.paths.base`. Rebuild the desktop variant afterwards — `build/` is what gets packaged.
With no Supabase credentials baked in, the web build lands in Direct mode.

## Layout

- `src/lib/forgefx.ts` — typed ForgeFX API client (device, blocks, preset/grid, params, cab, telemetry)
- `src/lib/editor.svelte.ts` — central runes store (grid, params, telemetry, device detect + recovery)
- `src/lib/direct/` — the in-browser runtime: Web Serial / Web MIDI transports, IndexedDB store
- `src/lib/deviceDefs.svelte.ts` — device definitions: scan the unit, import an editor cache
- `src/lib/ControlSurface.svelte` — the widget-grid control surface (pages, per-control views, arrange)
- `src/lib/SignalGrid.svelte` · `BlockEditor.svelte` · `CabPicker.svelte` · `EQGraph.svelte` — UI
- `src/lib/workbench/svelte/` — the workbench shell (host-agnostic; enforced by a boundary test)
- `src/routes/+page.svelte` — app shell: tool rail · top bar · Signal Grid · editor
- `electron/` — desktop shell (starts the bundled ForgeFX in-process, opens the window)
- `design/` — design prototypes (visual reference, not built)

## Design language

Dark, pro-audio. **Hanken Grotesk** (UI) + **JetBrains Mono** (technical). Accent cyan `#35c9d6`,
amber `#f5a623`, coral `#d6543f` (bypass/destructive) on layered near-black.

## Support

Axis is free and open source. If it's useful to you, you can support development on Ko-fi:

[![Support me on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/R5R6223HMO)

## License

MIT — see [`LICENSE`](./LICENSE). Axis is an independent project and is **not affiliated with or
endorsed by Fractal Audio Systems**. "Axe-Fx", "FM3", and "FM9" are trademarks of Fractal Audio
Systems, used for identification only. See [DISCLAIMER.md](./DISCLAIMER.md).

Terms of use and privacy for these builds: [`legal/`](./legal/) — short versions: the code is MIT,
and these builds send nothing anywhere (no account, no telemetry). Upstream's hosted deployment at
axisapp.live is a separate service with its own documents.

This repository is a fork of [sKuhLight/Axis](https://github.com/sKuhLight/Axis); upstream remains
the origin of the project.
