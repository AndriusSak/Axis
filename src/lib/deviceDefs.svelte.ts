// Device-definitions store (A4, AXIS-17/44 · META-22). Orchestrates the server-side definition-profile
// cache: status refresh on connect, self-describe builds (with live SSE progress), editor-cache imports
// (drag-drop bytes, discovered candidates, or a browser-picked folder), and cloud pull/publish. All
// ordering / gating / filename logic is delegated to the pure `deviceDefs.ts`; this file is the runes
// shell + the (small) impure device/browser plumbing. It deliberately does NOT import the editor store
// (the editor imports IT, to route `cacheBuild` SSE events) — device context is passed in on refresh.

import { forgefx, isRemote, ForgeError } from './forgefx';
import type { DeviceCacheStatus, DeviceCacheSources, CloudCacheStatus, DeviceCaps, DeviceEvent } from './types';
import {
  deviceDefsActions,
  shouldOfferDeviceDefs,
  activeDefsSource,
  dismissKey,
  normalizeModelHex,
  parseFirmware,
  isBuildProgressPhase,
  type DeviceDefAction,
  type ActiveDefsSource
} from './deviceDefs';
import {
  hasDirectoryPicker,
  pickEditorFolder,
  persistedEditorFolder,
  scanEditorFolder
} from './deviceDefsFolder';

const DISMISS_KEY = 'axs.deviceDefs.dismissed';

/** Device context captured at refresh — enough for gating, filename matching, and the dismissal key. */
interface DeviceDefsCtx {
  model: string | null;
  modelHex: string;
  firmware: string | null;
  fw: { major: number; minor: number } | null;
  caps: DeviceCaps | null;
}

function loadDismissed(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

class DeviceDefsStore {
  status = $state<DeviceCacheStatus | null>(null);
  sources = $state<DeviceCacheSources | null>(null);
  cloud = $state<CloudCacheStatus | null>(null);
  /** Live build progress (from the `cacheBuild` SSE / the POST /build response), or null when idle. */
  building = $state<{ done: number; total: number; phase: string; queries?: number; noReply?: number; avgReplyMs?: number } | null>(null);
  importing = $state(false);
  publishing = $state(false);
  /** Set after any successful acquisition (build/import/pull) so the prompt shows its success state. */
  succeeded = $state(false);
  /** True once a publish returned 401 (not signed in) — hides the "Share to cloud" affordance. */
  publishDenied = $state(false);
  error = $state<string | null>(null);
  /** The device model+firmware mismatch case (import 409) awaiting a force retry, or null. */
  mismatch = $state<{ bytes: Uint8Array; name: string } | { path: string } | null>(null);

  #ctx = $state<DeviceDefsCtx | null>(null);
  #dismissed = $state<Set<string>>(new Set());
  #loaded = false;

  constructor() {
    if (typeof localStorage !== 'undefined') this.#dismissed = loadDismissed();
  }

  get key(): string {
    return dismissKey(this.#ctx?.model, this.#ctx?.firmware);
  }
  get dismissed(): boolean {
    return this.#dismissed.has(this.key);
  }
  /** Whether the connect-time prompt should appear (self-describe + no profile + not dismissed). */
  get shouldShow(): boolean {
    return shouldOfferDeviceDefs(this.#ctx?.caps ?? null, this.status, this.dismissed);
  }
  /** Ordered actions to offer, most-preferred first. */
  get actions(): DeviceDefAction[] {
    return deviceDefsActions({
      caps: this.#ctx?.caps ?? null,
      status: this.status,
      sources: this.sources,
      cloud: this.cloud,
      env: {
        isElectron: typeof globalThis !== 'undefined' && !!(globalThis as { axisDesktop?: unknown }).axisDesktop,
        hasDirectoryPicker: hasDirectoryPicker(),
        isRemote: isRemote()
      }
    });
  }
  /** Whether the "Share to cloud" publish affordance can be offered (cloud endpoint present, not denied). */
  get canPublish(): boolean {
    return this.cloud !== null && !this.publishDenied;
  }
  /** Whether to offer "Definitionen neu einlesen" (rebuild): a profile is persisted AND this local
   *  session can re-acquire one (self-describe walk or import). Hidden over a relay — the follow-up
   *  device read isn't usable there. */
  get canRebuild(): boolean {
    return this.activeSource.origin !== 'bundled'
      && !isRemote()
      && (!!this.#ctx?.caps?.selfDescribe || !!this.#ctx?.caps?.cacheImport);
  }
  /** Whether the unit can be scanned at all. Deliberately NOT gated on a stored profile existing — with
   *  only bundled definitions the old UI hid every button, so there was no way to start the first scan
   *  from the settings panel (only the connect-time prompt, once, which is easy to dismiss). */
  get canScan(): boolean {
    // Caps unknown counts as "offer it": the server's refusal is now shown verbatim in the panel, which
    // beats a hidden button the user can't even try.
    if (isRemote()) return false;
    const caps = this.#ctx?.caps;
    return !caps || !!caps.selfDescribe || !!caps.cacheImport;
  }
  /** Human-facing readout of where the ACTIVE definitions come from (bundled/device/editor/cloud). */
  get activeSource(): ActiveDefsSource {
    return activeDefsSource(this.status, this.sources);
  }

  /** Refresh all three status endpoints for the connected device. Called on connect/reconnect. */
  refresh = async (ctx: { model: string | null; modelByte: string | null; firmware: string | null; caps: DeviceCaps | null }) => {
    this.#ctx = {
      model: ctx.model,
      modelHex: normalizeModelHex(ctx.modelByte),
      firmware: ctx.firmware,
      fw: parseFirmware(ctx.firmware),
      caps: ctx.caps
    };
    // Only reach for the endpoints when the device claims the capability — old servers 404 harmlessly,
    // but skipping the round-trips keeps a legacy connect clean.
    if (!ctx.caps?.selfDescribe && !ctx.caps?.cacheImport) {
      this.status = null; this.sources = null; this.cloud = null;
      return;
    }
    const [status, sources, cloud] = await Promise.all([
      forgefx.deviceCache().catch(() => null),
      forgefx.cacheSources().catch(() => null),
      forgefx.cloudCacheCheck().catch(() => null)
    ]);
    this.status = status;
    this.sources = sources;
    this.cloud = cloud;
    this.building = status?.building ? (status.progress ?? { done: 0, total: 0, phase: 'starting' }) : null;
    this.succeeded = false;
    this.error = null;
    // A persisted browser folder handle? Silently re-scan + import before the user has to do anything.
    if (!this.#loaded) { this.#loaded = true; void this.#tryPersistedFolder(); }
  };

  /** Start a self-describe build. Progress then streams over `onBuildEvent`. `mode` defaults to the
   *  read-only walk (the unchanged one-click "read from device"); 'full' requests the taper/curve sweep
   *  and MUST only be called after the user's explicit consent (see DeviceDefsPrompt). */
  build = async (mode?: 'read-only' | 'full', force = false) => {
    this.error = null;
    try {
      await forgefx.buildDeviceCache({ ...(mode ? { mode } : {}), ...(force ? { force } : {}) });
      this.building = { done: 0, total: 0, phase: 'starting' };
    } catch (e) {
      if (e instanceof ForgeError && e.status === 409) { this.building = { done: 0, total: 0, phase: 'building' }; return; } // already building
      // Show the server's own words — a bare "Could not start the build." hid 404/501/500 differences
      // that decide whether this is a version mismatch, a missing capability or a dead link.
      const detail = e instanceof Error ? e.message.slice(0, 160) : String(e);
      // 503 = nothing answered on the link (no driver materialised, or detection found no model) — that
      // is a cable/port problem, not a missing capability, and telling the user "not supported here"
      // sends them looking for the wrong thing. 501 = the unit answered and genuinely cannot self-describe.
      this.error = e instanceof ForgeError && e.status === 503
        ? 'No device answered — the port is open but the unit isn’t replying. Unplug the USB cable, plug it back in, then reconnect.'
        : e instanceof ForgeError && e.status === 501
          ? 'This device doesn’t support reading its definitions — use a definitions file or the editor’s cache instead.'
          : `Could not start the build${e instanceof ForgeError ? ` (HTTP ${e.status})` : ''}: ${detail}`;
    }
  };

  cancel = async () => {
    await forgefx.cancelDeviceCache().catch(() => null);
    this.building = null;
  };

  /** Firmware-update path: drop the persisted profile so the connect prompt re-offers the normal build
   *  flow. Deleting flips `status.exists` false → `shouldShow` true → the DeviceDefsPrompt re-appears via
   *  existing reactivity. Also un-dismisses this device+firmware so the offer can actually surface again. */
  rebuild = async () => {
    this.error = null;
    this.succeeded = false;
    await forgefx.deleteDeviceCache().catch(() => null);
    if (this.#dismissed.has(this.key)) {
      this.#dismissed = new Set([...this.#dismissed].filter((k) => k !== this.key));
      try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...this.#dismissed])); } catch { /* */ }
    }
    // Re-read the authoritative status + sources so the prompt (and the source readout) reflect the drop.
    this.status = await forgefx.deviceCache().catch(() => this.status);
    void forgefx.cacheSources().then((s) => { if (s) this.sources = s; }).catch(() => {});
  };

  /** Refresh the "definitions files found on this computer" list (GET /device/cache/sources). Cheap and
   *  read-only; the settings panel calls it so the import affordance is not hostage to a connect-time
   *  refresh that may have run before the engine was up. */
  loadSources = async () => {
    const s = await forgefx.cacheSources().catch(() => null);
    if (s) this.sources = s;
  };

  /** Import raw cache bytes (browser drag-drop / folder pick). `force` overrides a firmware mismatch. */
  importBytes = async (bytes: Uint8Array, name: string, force = false) => {
    await this.#runImport({ bytes, name }, force);
  };
  /** Import a server-discovered candidate from disk (Electron). */
  importCandidate = async (path: string, force = false) => {
    await this.#runImport({ path }, force);
  };
  #runImport = async (source: { bytes: Uint8Array; name: string } | { path: string }, force: boolean) => {
    this.importing = true;
    this.error = null;
    try {
      await forgefx.importEditorCache(source, { force });
      this.mismatch = null;
      // The import body is a result receipt, not a status — re-read the authoritative status.
      this.status = await forgefx.deviceCache().catch(() => this.status);
      this.#onAcquired();
    } catch (e) {
      if (e instanceof ForgeError && e.status === 409) {
        this.mismatch = source; // offer a force retry
        this.error = 'That file is for a different firmware. Import it anyway?';
      } else if (e instanceof ForgeError && e.status === 501) {
        this.error = 'Importing editor definitions isn’t supported here.';
      } else {
        this.error = 'Import failed. Is this an effectDefinitions_*.cache file?';
      }
    } finally {
      this.importing = false;
    }
  };
  /** Retry the last mismatched import with force=1. */
  forceImport = async () => {
    if (!this.mismatch) return;
    await this.#runImport(this.mismatch, true);
  };

  cloudPull = async () => {
    this.importing = true;
    this.error = null;
    try {
      await forgefx.cloudCachePull();
      this.status = await forgefx.deviceCache().catch(() => this.status);
      this.#onAcquired();
    } catch {
      this.error = 'Could not fetch the shared definitions.';
    } finally {
      this.importing = false;
    }
  };

  cloudPublish = async () => {
    this.publishing = true;
    try {
      await forgefx.cloudCachePublish();
    } catch (e) {
      if (e instanceof ForgeError && e.status === 401) { this.publishDenied = true; return; } // hide the affordance
      this.error = 'Could not share the definitions.';
    } finally {
      this.publishing = false;
    }
  };

  /** Browser Chromium: pick an editor folder, scan it (+ one level of subdirs), import a match. */
  locateFolder = async () => {
    const handle = await pickEditorFolder();
    if (!handle) return;
    await this.#scanAndImport(handle, true);
  };

  dismiss = () => {
    this.succeeded = false; // also closes the post-success card ("Done")
    this.error = null;
    this.#dismissed = new Set([...this.#dismissed, this.key]);
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...this.#dismissed])); } catch { /* */ }
  };

  /** Route a `cacheBuild` SSE event onto the live progress / final status. The server emits progress
   *  phases (walking/building) and terminal ones (done/error/cancelled/already-built) — there is no
   *  boolean; terminal detection is by phase. */
  onBuildEvent = (e: Extract<DeviceEvent, { type: 'cacheBuild' }>) => {
    // Any non-terminal phase (walking / building / full-mode 'param-sweep' / any future additive
    // sub-phase) is progress — keep the bar alive and never mistake it for completion.
    if (isBuildProgressPhase(e.phase)) {
      // The server's liveness counters ride along on every progress event — keep them so the prompt
      // can show query rate instead of an opaque frozen counter.
      this.building = { done: e.done, total: e.total, phase: e.phase, queries: e.queries, noReply: e.noReply, avgReplyMs: e.avgReplyMs };
      return;
    }
    this.building = null;
    // Prefer the server's own explanation (it names the actual fault) over a generic sentence.
    if (e.phase === 'error') { this.error = e.error ?? 'The build stopped before finishing.'; return; }
    if (e.phase === 'cancelled') return;
    // done / already-built — re-read the fresh status + mark success.
    void forgefx.deviceCache().then((st) => { if (st) { this.status = st; this.#onAcquired(); } });
  };

  #onAcquired = () => {
    this.succeeded = true;
    this.building = null;
    this.error = null;
    // Refresh sources.persisted so the source readout flips off "bundled".
    void forgefx.cacheSources().then((s) => { if (s) this.sources = s; }).catch(() => {});
  };

  // Silent re-scan of a previously-picked folder on connect (permission re-checked, non-interactive).
  #tryPersistedFolder = async () => {
    if (this.status?.exists || !this.#ctx?.caps?.cacheImport) return;
    const handle = await persistedEditorFolder();
    if (!handle) return;
    await this.#scanAndImport(handle, false);
  };
  #scanAndImport = async (handle: Parameters<typeof scanEditorFolder>[0], interactive: boolean) => {
    if (!this.#ctx) return;
    const found = await scanEditorFolder(handle, { modelHex: this.#ctx.modelHex, fw: this.#ctx.fw }, { interactive });
    if (!found) { if (interactive) this.error = 'No matching effectDefinitions_*.cache in that folder.'; return; }
    await this.importBytes(new Uint8Array(found.bytes), found.file);
  };
}

export const deviceDefs = new DeviceDefsStore();
