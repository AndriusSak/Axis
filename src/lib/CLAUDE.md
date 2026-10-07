# Axis app-layer guide

> **Rules only — never restate an implementation here; point at the module that owns it.**
> A restated pattern in this file ("the canonical action shape") drifted from the code and ended up
> teaching a defect that took three fix rounds to remove. If you are about to paste code into this
> file, paste a path instead.

This file applies when working under `src/lib/` (the Axis app layer). For
`src/lib/workbench/` and `src/lib/axis-workbench/` see
`src/lib/axis-workbench/CLAUDE.md`.

## Where this layer sits

Axis (SvelteKit 5 runes SPA + Electron) is the UI layer of a three-part chain:
**Axis → HTTP `/api` → ForgeFX (Fastify + device, `:5056`) → forgefx-midi (pure
protocol)**. Axis talks ONLY to the ForgeFX HTTP API. Protocol facts (frames,
opcodes, address models) are never authored here — if a feature needs new device
data, the work starts two repos down and surfaces as a new endpoint.

## HTTP client (`src/lib/forgefx.ts`)

One default-export object `forgefx` of one-liner methods, all delegating to a
private generic `req<T>(path, init?)`:

- `BASE = import.meta.env.VITE_FORGEFX_BASE ?? '/api'`; JSON bodies;
  `AbortSignal.timeout(12000)` default — long operations override per call
  (e.g. `backupDevice` uses `600000`).
- Non-2xx throws `ForgeError(status, msg)`; network/timeout failures are rethrown
  as status `0`. `setRequestFailureReporter` only reports status `>= 500` or `0`
  — 4xx is deliberately not reported.
- Naming: reads are nouns (`grid()`, `device()`, `blockParams(eid)`), writes are
  verb-prefixed (`set*` / `select*` / `place*`).
- **Three `TransportMode`s: `'local' | 'remote' | 'direct'`.** SSE `events()` runs
  ONLY in local mode (remote/direct receive events via the relay / runtime bus),
  and binary helpers branch on `isDirect()`. Any new SSE or binary feature must
  handle all three modes, or it silently no-ops in remote/direct builds.
- The canonical read is `blockParams(eid)`; the canonical write is `setParam`
  (PUT `{value, continuous}`). Both are thin wrappers — the **write-outcome rule**
  under *Store pattern* is the contract that matters, not the call shape.

## Types contract (`src/lib/types.ts`)

All API shapes are **hand-mirrored interfaces** — no codegen, no OpenAPI. The
chain is: ForgeFX route JSON → `types.ts` interface → `req<T>` → store `$state` →
component `$derived`. `DeviceCaps` is load-bearing: capability gates hang off it.
Drift failure mode: typecheck and the node-env unit suite still cannot catch
server↔`types.ts` shape drift (no codegen, no contract test), so a server shape
change not reflected in `types.ts` typechecks green and fails at runtime — missing
caps fields silently hide features; the manual mirror discipline stands. v2 caps
fields are optional (`?`) by design so legacy payloads degrade to the `isAm4`
fallback branches.

## Store pattern (`src/lib/editor.svelte.ts`)

`class EditorStore` exported as a singleton `export const editor`; components
import it directly — no context or props threading.

- State: `$state` class fields grouped by `// ── section ──` banners. Derived
  state: `get` accessors. The dominant idiom is the capability gate
  (`get hasTuner() { ... this.isV2 ? !!this.caps?.tuner : <legacy isAm4 branch> }`).
- Lifecycle: `routes/+page.svelte` `onMount` drives `editor.init()`,
  `editor.poll()`, and the `setInterval` poll/`watchPreset` loops.
- `poll()` / `watchPreset()` are re-entrancy-guarded (`#polling` / `#watching`)
  and throttled on slow links — **never add an unguarded device read to the poll
  loop**.
- SSE: `#openEvents` feeds `applyDeviceEvent`, a single `switch` over the
  `DeviceEvent` union. To react to a device-side change (e.g. scene change),
  extend the existing `case` and reuse the `#eventReload` debounce — do not add
  parallel timers.
- **Unresolved-value rule (hard).** A parameter value can be **`null`** — ForgeFX reports it when it
  cannot resolve the value (e.g. a non-positional GLOBAL param it refuses to fabricate). Never coerce it
  to `0`: that recreates the fabricated-value defect on the client side. `NamedParam.value` /
  `EnumParam.value` / `norm` are `number | null`, formatters render `—`, an unresolved control renders the
  inert `unknownCtl` tile with the server's reason, and no knob/slider/fader arithmetic may turn null into
  `NaN` (guard before the maths, don't default at the maths).
- **Write-outcome rule (hard).** ForgeFX answers **HTTP 200 with `{ok:false}`** when
  the device refuses a write, so a `.catch()`-only revert is NOT enough — an
  optimistic value would stay on screen forever. Every user-visible optimistic
  value (enum, scalar, batch) must settle through the pure helpers in
  `src/lib/paramWriteOutcome.ts` — `settleEnumWrite`, `settleScalarWrite`,
  `settleWriteSet` — which are the **single decision point** (keep / revert /
  drop the optimistic history entry / toast). Continuous streaming knobs are
  fire-and-forget **by design**; anything discrete or one-shot is not.
  *Reject-watch rule:* a refusal is only possible on a reject-watched path (gen3):
  `setParam` (discrete), `setType`, `setBypass`, `setChannel`, `setSceneName`,
  `setPresetName`, and the grid/store ops. `setScene`, `setTempo`, `setTuner` and
  **all continuous streams** return `{ok:true}` unconditionally (the device sends
  no reply at all) — their settlement branches can only fire on a thrown transport
  error, so never comment that a refusal is honoured there.
  *Known limitation (pinned, not fixed):* the stale guard is value-based
  (`stale = value !== sent`), so an odd-length same-value burst (A→B→C→B with the
  earlier write refused late) and a double refusal are reachable and can wipe a
  newer value or leave an unconfirmed one on screen — see
  `paramWriteOutcome.aba.test.ts`. The documented upgrade is a per-control write
  token minted at write time; the pure settle signature cannot carry that ordering.
  If the guard is replaced by a token, that test fails — which is the signal the fix landed.

Other stores: `cloud.svelte.ts` (true `$derived`, pure derivation + refresh),
`library.svelte.ts` (device scan, `.syx` import, Zod-validated persisted
summaries, Orama index), `history.svelte.ts` (undo/redo, IndexedDB; binds a
narrow host interface to avoid an editor↔history import cycle).

**Own module vs extend editor:** give state its own `*.svelte.ts` when it has an
independent persistence lifecycle or must avoid an import cycle. Live device
state flowing through poll/SSE with the shared connection/caps stays in `editor`.

## Component pattern

Flat, one `.svelte` per feature directly under `src/lib/`. Direct singleton
import (`const cents = $derived(editor.tuner.cents ?? 0)`); actions inline.
Modal pattern: a boolean `$state` flag on `editor` (`xOpen`), the component gates
on `{#if editor.xOpen}`, and it is mounted UNCONDITIONALLY in `+page.svelte`
below the shell branch; Escape is handled centrally in `+page.svelte` in priority
order. Theming: use tokens from `src/app.css` (`--accent`, `--bg2`, `--surface`,
`--text`, `--ok`, `--amber`, `--danger`, `--font-mono`) — the monolith is not
hex-linted (only `workbench/svelte/` is), but prefer tokens anyway. Minimal
end-to-end reference feature: `TunerOverlay.svelte` + `editor.toggleTuner`.

## Dual-shell decision tree

Axis has two shells: the legacy monolith and the workbench. Where a feature lands
decides how much mirroring work it costs:

| Feature lives in… | Reaches both shells? | What you must do |
|---|---|---|
| Editor-flag modal (`{#if editor.xOpen}`) | Yes, automatically | Nothing — shared modal layer sits below the shell `{#if}` branch |
| Embedded editor component (`SignalGrid` / `BlockEditor` / `FcEditor` / `VirtualScreen` / `ModifierEditorCore`) | Yes, automatically | Nothing — the workbench embeds these directly |
| Monolith chrome (`TopBar` / `ToolRail`) | No — monolith only | Build a mirrored widget/panel via `/new-widget` / `/new-panel` |
| Preset-browser logic (`PresetBrowser.svelte` / `library.svelte.ts`) | No | MUST manually mirror into `src/lib/axis-workbench/presetBrowser/` — query grammar + row/menu logic verbatim; deep param matching intentionally stays monolith-only |

## Feature gating

Prefer a `DeviceCaps` capability gate: add the field to `DeviceCaps` in
`types.ts` → ForgeFX populates it from forgefx-midi → add a `get hasX()` getter →
gate the UI on it. Features then auto-appear per device and degrade gracefully on
legacy servers. Use `VITE_*` build flags only for whole-shell/build modes
(workbench/remote/mobile), wired through a small pure, testable gate function
(pattern: `featureGate.ts`) with a defined gate-off behavior. Server-gated
features (cloud): discover via the API (`cloudStatus().enabled`) — do not
client-gate. **A control that cannot work renders disabled with the exact reason
— never a placeholder toast** (the no-dead-nav rule).

## Testing reality

- vitest = node environment, no DOM — pure `.ts` modules only. A **runes module
  (`editor.svelte.ts`) cannot be loaded in that harness**, so logic that needs
  testing must live in a pure module with the `.svelte`/`.svelte.ts` wiring pinned
  by a sourceguard test (`readFileSync` + regex — see `refusedWrite.sourceguard.test.ts`).
- Consequence, learned the hard way: a green vitest run says nothing about whether
  `editor.svelte.ts` even compiles (an undeclared variable shipped through one).
  **`svelte-check` on the merged tree is the only thing that catches that class.**
- New features should extract pure logic and add a co-located vitest.
- The e2e suite is Playwright/Chromium and boots the **workbench** shell
  (`VITE_AXIS_WORKBENCH=1`, `bootCleanWorkbench`, viewport ≥ 1366 px) — there is no
  monolith-shell harness; monolith behavior is verified manually.
- CI runs the vitest unit suite; Playwright stays local. Green CI ≠ passing e2e.
- Parallel-agent rounds: one worktree per workstream, agents run only their OWN
  test files, and the orchestrator runs the full suite + `svelte-check` +
  Playwright once on the merged tree.

## Pitfalls (all have bitten before)

- **Stale persisted state** — Zod-validate any new persisted slice (see
  `library.svelte.ts` `summarySchema`); never trust old localStorage shapes.
- **Preset-browser mirror rule** — see the dual-shell table; forgetting it ships
  divergent search behavior.
- **Polling races** — guard + throttle every loop; an unguarded read stacked
  serial device ops into multi-second lag on slow links.
- **Ungated telemetry reads** — capability-gate every telemetry read; devices
  that silently ignore frames cause 5 s serial-queue timeouts.
- **Own-echo loops in synced config** — ignore events where
  `e.origin === CLIENT_ID`, and never re-save on apply.
- **TransportMode divergence** — SSE/binary paths must handle
  local/remote/direct or the feature silently no-ops in some builds.
- **A doc that restates code** — it drifts and then actively misleads. Point at
  the owner module instead (see the header rule).

## Cross-repo change chain

Full walkthrough: `/cross-repo-feature`. Short form: protocol fact → forgefx-midi
(rebuild) → ForgeFX endpoint + `DeviceCaps` advertisement (**restart the ForgeFX
dev server on `:5056`** — the Axis dev server does NOT pick up ForgeFX changes,
it only proxies) → Axis `types.ts` + `forgefx.ts` + editor wiring → browser
refresh. The `file:../ForgeFX/server` link matters only for the packaged desktop
build (reinstall/rebuild, no hot-reload). On a fresh sibling checkout, build the
stack in order — `npm run setup:stack` does exactly that.

## Tooling and process

- Scaffolding/workflow commands: `/implement-feature`, `/new-endpoint`,
  `/cross-repo-feature`, `/plan-feature`; run the `reviewer` and `test-runner`
  agents before committing non-trivial changes.
- Task tracking in Plane is mandatory — see the root `CLAUDE.md`, Task tracking
  section (that file is gitignored and local-only by design).
- Where work is planned and recorded: `docs/NEXT-STEPS.md` is the orientation
  file, `docs/axis-fm3edit-feature-parity-audit.md` is the live backlog, and the
  dated fix lists under `docs/` hold round inputs. Do not resurrect
  `docs/ROADMAP.md` or the other banner-stale plans.
