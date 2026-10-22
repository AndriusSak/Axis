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

## Install (desktop app)

Prebuilt apps are served from a personal dashboard —
[`a private build host`](a private build host) (home network only) — not from GitHub
releases. Each artifact ships with a `.sha256` beside it; verify before installing.

| Platform | Artifact |
|---|---|
| macOS (Apple silicon / Intel) | `Axis-<version>-arm64-mac.zip`, `Axis-<version>-mac.zip` |
| Linux (x86_64 / Steam Deck) | `Axis-<version>.AppImage` |

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

Open **[`a private build host`](a private build host)** (or
[axisapp.live](https://axisapp.live)) in **Chrome or Edge on a desktop**, plug the unit into *that*
computer, and pick the connection:

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

This repository is a fork of [sKuhLight/Axis](https://github.com/sKuhLight/Axis); upstream remains
the origin of the project.
