// Performance / Live page model (parity audit §2.2).
//
// FM3-Edit exposes **Global Performance pages** and **Per-Preset Performance pages**: assign any
// parameter to a big performance knob/switch, then reach it full-screen for live use. Axis's Live
// workbench page was a placeholder (`axisWorkbenchPages.ts`) — this module is the page model behind
// the real `axis.live` panel (`panels/AxisLivePanel.svelte`).
//
// HONESTY CONSTRAINT (audit §6.5, UNVERIFIED): whether the FM3 stores performance pages in the
// preset binary or in system memory is unknown and unverified. So this page definition is persisted
// **locally on this device only** (localStorage) — it is NEVER written to the device and the UI says
// so. There is deliberately no invented endpoint here. If device-side storage is ever reverse
// engineered, this local model is what would be serialised into it.
//
// A page definition is an ORDERED list of `(family, paramId)` bindings. `family` is the block family
// slug (the pack lowercased — 'amp', 'delay', …), the stable cross-preset key; `paramId` is the
// device-true parameter id. A binding may also carry the `effectId` of the block instance it was
// captured from (a convenience for the common case), but resolution to a live block is always by
// family against the CURRENT preset's placed grid, so a binding survives a preset change as long as a
// block of that family is present.
//
// Kept a plain TS module (no Svelte, no editor import) because this repo's node-env vitest cannot
// mount .svelte components — the panel only wires these pure helpers to the editor store.

export const PERFORMANCE_PAGE_VERSION = 1 as const;
/** localStorage key for the locally-persisted page definition. */
export const PERFORMANCE_PAGE_STORAGE_KEY = 'axis.performancePage.v1';

export interface PerformanceBinding {
  /** Block family slug (pack lowercased) — the stable cross-preset key. */
  family: string;
  /** Device-true parameter id. */
  paramId: number;
  /** The block instance this binding was captured from (resolved live by family, best-effort). */
  effectId?: number;
  /** Human label captured at add time (the parameter name). */
  label?: string;
  /** Block display name captured at add time (e.g. "Amp 1"). */
  block?: string;
}

export interface PerformancePage {
  version: number;
  label: string;
  bindings: PerformanceBinding[];
}

/** Minimal storage surface (so the module is unit-testable without a DOM). */
export interface PerformanceStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The block placed in the current preset that a binding can resolve to. */
export interface PerformanceCellLike {
  effectId: number;
  pack?: string | null;
}

export function createPerformancePage(label = 'Performance'): PerformancePage {
  return { version: PERFORMANCE_PAGE_VERSION, label, bindings: [] };
}

/** Trim + lowercase a family so 'Amp' and 'amp' key the same binding. */
export function normalizeFamily(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** Stable identity of a binding: family + paramId. */
export function performanceBindingKey(binding: PerformanceBinding): string {
  return `${normalizeFamily(binding.family)}:${binding.paramId}`;
}

function normalizeBinding(value: unknown): PerformanceBinding | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const family = normalizeFamily(raw.family);
  if (!family) return null;
  if (typeof raw.paramId !== 'number' || !Number.isFinite(raw.paramId)) return null;
  const binding: PerformanceBinding = { family, paramId: raw.paramId };
  if (typeof raw.effectId === 'number' && Number.isFinite(raw.effectId)) binding.effectId = raw.effectId;
  if (typeof raw.label === 'string' && raw.label.trim()) binding.label = raw.label.trim();
  if (typeof raw.block === 'string' && raw.block.trim()) binding.block = raw.block.trim();
  return binding;
}

/**
 * Add a binding, returning a NEW page. Deduped by family+paramId: adding an existing binding
 * refreshes its captured label/effectId in place (order preserved) instead of duplicating it. An
 * explicit `index` inserts a new binding there (clamped); it is ignored when the binding already
 * exists.
 */
export function addPerformanceBinding(page: PerformancePage, binding: PerformanceBinding, index?: number): PerformancePage {
  const normalized = normalizeBinding(binding);
  if (!normalized) return page;
  const key = performanceBindingKey(normalized);
  const existing = page.bindings.findIndex((b) => performanceBindingKey(b) === key);
  if (existing >= 0) {
    const bindings = page.bindings.slice();
    bindings[existing] = { ...bindings[existing], ...normalized };
    return { ...page, bindings };
  }
  const bindings = page.bindings.slice();
  const at = index == null || !Number.isFinite(index) ? bindings.length : Math.max(0, Math.min(bindings.length, Math.floor(index)));
  bindings.splice(at, 0, normalized);
  return { ...page, bindings };
}

/** Remove the binding at `index` (out-of-range is a no-op). */
export function removePerformanceBinding(page: PerformancePage, index: number): PerformancePage {
  if (!Number.isFinite(index) || index < 0 || index >= page.bindings.length) return page;
  const bindings = page.bindings.slice();
  bindings.splice(Math.floor(index), 1);
  return { ...page, bindings };
}

/** Move the binding at `from` to `to` (both clamped; `from === to` is a no-op). */
export function movePerformanceBinding(page: PerformancePage, from: number, to: number): PerformancePage {
  const n = page.bindings.length;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return page;
  const f = Math.max(0, Math.min(n - 1, Math.floor(from)));
  const t = Math.max(0, Math.min(n - 1, Math.floor(to)));
  if (f === t || n === 0) return page;
  const bindings = page.bindings.slice();
  const [moved] = bindings.splice(f, 1);
  bindings.splice(t, 0, moved);
  return { ...page, bindings };
}

export interface PerformanceParamLike {
  id?: number;
  name: string;
}

/**
 * Build `(family, paramId)` bindings from an open block's parameters. Params without a device id are
 * dropped (there is nothing to address). Returns [] when the family is blank (no block context).
 */
export function bindingsFromParams(
  family: string,
  effectId: number | undefined,
  block: string | undefined,
  params: PerformanceParamLike[]
): PerformanceBinding[] {
  const fam = normalizeFamily(family);
  if (!fam) return [];
  const out: PerformanceBinding[] = [];
  for (const param of params) {
    if (param.id == null || !Number.isFinite(param.id)) continue;
    const binding: PerformanceBinding = { family: fam, paramId: param.id };
    if (effectId != null && Number.isFinite(effectId)) binding.effectId = effectId;
    if (param.name?.trim()) binding.label = param.name.trim();
    if (block?.trim()) binding.block = block.trim();
    out.push(binding);
  }
  return out;
}

/**
 * Resolve a binding to a placed block in the CURRENT preset. Prefers the captured `effectId` when it
 * is still a placed block of that family; otherwise the first placed block of the family; otherwise
 * null (the family is not in this preset — the tile renders as unavailable).
 */
export function resolvePerformanceEffectId(binding: PerformanceBinding, cells: PerformanceCellLike[]): number | null {
  const fam = normalizeFamily(binding.family);
  if (!fam) return null;
  const matches = cells.filter((cell) => normalizeFamily(cell.pack) === fam);
  if (!matches.length) return null;
  if (binding.effectId != null && matches.some((cell) => cell.effectId === binding.effectId)) return binding.effectId;
  return matches[0].effectId;
}

/** Tolerantly parse a persisted page: malformed bindings are dropped, valid ones kept (no cap). */
export function parsePerformancePage(raw: unknown): PerformancePage {
  if (!raw || typeof raw !== 'object') return createPerformancePage();
  const obj = raw as Record<string, unknown>;
  const label = typeof obj.label === 'string' && obj.label.trim() ? obj.label.trim() : 'Performance';
  const bindings = Array.isArray(obj.bindings)
    ? obj.bindings.map(normalizeBinding).filter((b): b is PerformanceBinding => !!b)
    : [];
  return { version: PERFORMANCE_PAGE_VERSION, label, bindings };
}

export function serializePerformancePage(page: PerformancePage): string {
  return JSON.stringify(parsePerformancePage(page));
}

/** The browser localStorage when present, else null (node tests / SSR). */
function defaultStorage(): PerformanceStorageLike | null {
  const storage = (globalThis as { localStorage?: PerformanceStorageLike }).localStorage;
  return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function' ? storage : null;
}

/** Load the locally-persisted page (fresh page when absent/unreadable/unavailable). */
export function loadPerformancePage(storage: PerformanceStorageLike | null = defaultStorage()): PerformancePage {
  if (!storage) return createPerformancePage();
  try {
    const raw = storage.getItem(PERFORMANCE_PAGE_STORAGE_KEY);
    return raw ? parsePerformancePage(JSON.parse(raw)) : createPerformancePage();
  } catch {
    return createPerformancePage();
  }
}

/** Persist the page locally. Best-effort: a quota/private-mode failure is swallowed. */
export function savePerformancePage(page: PerformancePage, storage: PerformanceStorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(PERFORMANCE_PAGE_STORAGE_KEY, serializePerformancePage(page));
  } catch {
    /* quota / private mode */
  }
}

/** Clamp a nudged knob position to 0..1 (undefined reads as 0). */
export function nudgeNorm(norm: number | undefined, delta: number): number {
  const base = typeof norm === 'number' && Number.isFinite(norm) ? norm : 0;
  return Math.max(0, Math.min(1, base + delta));
}
