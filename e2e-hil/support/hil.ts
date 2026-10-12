/**
 * HIL UI verification helpers — drive the LIVE app against the LIVE stack.
 *
 * Nothing here mocks a device payload: every read comes from the app's OWN `/api` proxy (vite dev →
 * ForgeFX :5056 → the real unit). The oracle for every VALUE/NAME assertion is the payload the UI
 * itself consumes, so the comparison is render-vs-wire, not render-vs-fixture.
 *
 * READ-ONLY: the boot path installs the runtime network guard (every non-GET /api/** is ABORTED) and
 * every activation goes through input-guard's allowlisted `activate()`. No press, no drag, no
 * state-changing click — ever.
 */
import { type Page, type Locator, expect } from '@playwright/test';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AssertionRecord } from '../manifest';
import { activate, activateGridCell, dispatchHover, installReadOnlyNetworkGuard } from './input-guard';
export { READ_ONLY_GUARANTEE, refuseInput, activate, activateGridCell, dispatchHover, installReadOnlyNetworkGuard } from './input-guard';

export const DEFAULT_BASE = process.env.HIL_BASE ?? 'http://127.0.0.1:5173';

// ───────────────────────── assertion recording ─────────────────────────

let ASSERT_FILE: string | null = null;

/** Path the runner appends assertion records to (JSONL). Set by the Playwright config env. */
export function assertionFile(): string {
  if (ASSERT_FILE) return ASSERT_FILE;
  ASSERT_FILE = process.env.HIL_ASSERTIONS ?? '/tmp/hil-assertions.jsonl';
  mkdirSync(dirname(ASSERT_FILE), { recursive: true });
  return ASSERT_FILE;
}

export function record(rec: AssertionRecord): void {
  appendFileSync(assertionFile(), JSON.stringify(rec) + '\n');
  // Mirror to stdout so a bare `playwright test` run is legible without the report step.
  // eslint-disable-next-line no-console
  console.log(`[HIL ${rec.status.toUpperCase()}] ${rec.feature} · ${rec.control} · ${rec.kind} ${rec.detail ?? ''}`);
}

/** Record a pass. */
export const pass = (feature: string, control: string, kind: AssertionRecord['kind'], r: Partial<AssertionRecord> = {}) =>
  record({ feature, control, kind, status: 'pass', ...r });
/** Record a failure (status fail — the run goes red). */
export const fail = (feature: string, control: string, kind: AssertionRecord['kind'], r: Partial<AssertionRecord> = {}) =>
  record({ feature, control, kind, status: 'fail', ...r });
/** Record a gap that could not run (no value served, no readout, feature absent) — never a pass. */
export const pending = (feature: string, control: string, kind: AssertionRecord['kind'], reason: string, r: Partial<AssertionRecord> = {}) =>
  record({ feature, control, kind, status: 'pending', detail: reason, ...r });
/** Record a non-assertion observation (counts, notes). */
export const info = (feature: string, control: string, kind: AssertionRecord['kind'], r: Partial<AssertionRecord> = {}) =>
  record({ feature, control, kind, status: 'info', ...r });
/** Record a SOFT finding — a real defect that is not a hard failure (e.g. a control visible only after
 *  scrolling its pane: the owner-reported "nowhere to be seen" class). Never reported as a pass. */
export const warn = (feature: string, control: string, kind: AssertionRecord['kind'], r: Partial<AssertionRecord> = {}) =>
  record({ feature, control, kind, status: 'warn', ...r });
/** Record a VACUOUS pass — the assertion held, but its expected value was uninformative (0 vs 0, the
 *  param default, or another control's value), so it does not count as a real verification. */
export const weak = (feature: string, control: string, kind: AssertionRecord['kind'], r: Partial<AssertionRecord> = {}) =>
  record({ feature, control, kind, status: 'weak', ...r });

/** True when a VALUE assertion is vacuous: the served value is the param default, or equals a value
 *  already recorded for another control. Callers pass the served param's `defaultRaw`-derived default
 *  (or undefined) and the set of values already seen this run. */
export function isVacuous(servedValue: number | undefined, seen: Set<number>, paramDefault?: number): boolean {
  if (servedValue == null) return false;
  if (paramDefault != null && Math.abs(servedValue - paramDefault) < 1e-9) return true;
  return seen.has(servedValue);
}

// ───────────────────────── boot / navigation ─────────────────────────

export const NAV_LABELS: Readonly<Record<string, string>> = {
  grid: 'Grid', library: 'Preset Browser', fc: 'Footswitches', controllers: 'Controllers',
  scenes: 'Scenes', live: 'Live', setup: 'Setup', batchSet: 'Batch Set', theme: 'Theme', account: 'Axis Cloud'
};

/**
 * Boot the live app with a deterministic first-run state. Installs the READ-ONLY NETWORK GUARD first
 * (every non-GET /api/** request is ABORTED at the browser — the app-originated-write class no source
 * scan can see). We only clear browser-local persistence so a stale local doc can't leak between runs.
 */
export async function bootLive(page: Page, base = DEFAULT_BASE): Promise<void> {
  await installReadOnlyNetworkGuard(page);
  await page.goto(base);
  await page.evaluate(() => {
    window.localStorage.clear();
    const suppress: Record<string, string> = {
      'axs.telemetry.decided': '1',
      'axs.telemetry.consent': '0',
      'axs.kofi.seen': '1',
      'axs.tour.done': '1',
      'axs.lib.built': 'true'
    };
    for (const [k, v] of Object.entries(suppress)) window.localStorage.setItem(k, v);
  });
  await page.reload();
  await page.waitForSelector('.aw-root', { timeout: 20_000 });
  await page.waitForSelector('[data-nav-entry="grid"]', { timeout: 20_000 });
  await page.waitForTimeout(1500);
}

/** Open a workbench page via the nav rail. The nav entry's PANEL and its EXPECTED accessible name are
 *  both pinned, so activate() cannot land on a different control. */
export async function openPage(page: Page, navId: string): Promise<void> {
  const label = NAV_LABELS[navId];
  if (!label) throw new Error(`openPage: nav id '${navId}' has no pinned label in NAV_LABELS — name it before activating it`);
  const panel = page.locator(`[data-nav-entry="${navId}"]`);
  await activate(page, panel.locator('button'), { kind: 'nav', name: label, panel, reason: `open the '${navId}' nav page` });
  await page.waitForTimeout(900);
}

/** Normalised, whitespace-collapsed text of a locator (labels carry embedded newlines). */
export const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

// ───────────────────────── grid cell selection ─────────────────────────

export async function selectGridCell(page: Page, row: number, col: number): Promise<void> {
  await activateGridCell(page, row, col);
}

/** The grid cell of the first placed block whose effectId matches (from the LIVE /preset/grid). */
export async function findCellForEffect(page: Page, effectId: number): Promise<{ row: number; col: number; name: string } | null> {
  const grid = await fetchJson(page, '/preset/grid');
  const c = (grid?.cells ?? []).find((x: any) => x.effectId === effectId);
  return c ? { row: c.row, col: c.col, name: c.name } : null;
}

// ───────────────────────── live payload reads ─────────────────────────

/**
 * Fetch JSON through the app's OWN proxy. READ-ONLY BY CONSTRUCTION: it ASSERTS `method === 'GET'`
 * (the source guard requires this assertion) and never accepts a body, so it cannot become a write
 * path. Every non-GET is refused here AND aborted at the browser by the network guard.
 */
export async function fetchJson(page: Page, path: string): Promise<any> {
  return page.evaluate(async (p) => {
    const url = p.startsWith('/api') ? p : `/api${p}`;
    const method = 'GET';
    if (method !== 'GET') throw new Error('HIL fetchJson: only GET is allowed');
    const r = await fetch(url, { method: 'GET' });
    return r.ok ? await r.json() : { __httpStatus: r.status };
  }, path);
}

/** Open a block-editor page tab by normalised text (a read-only page switch, via the guard). */
export async function clickPageTab(page: Page, tabText: string): Promise<void> {
  const tabs = page.locator('.tabs .tab');
  const panel = page.locator('.tabs');
  const n = await tabs.count();
  for (let i = 0; i < n; i++) {
    const t = norm(await tabs.nth(i).textContent());
    if (t === tabText) {
      await activate(page, tabs.nth(i), { kind: 'tab', name: tabText, panel, reason: `open the '${tabText}' block-editor page` });
      await page.waitForTimeout(500);
      return;
    }
  }
  throw new Error(`page tab not found: ${tabText}`);
}

/**
 * Open the Device Tools modal. FIX (2026-10-12): the old version clicked the FIRST `.dock-action`
 * button whose text was 'Open', regardless of which panel it sat in — so it could activate an
 * unrelated panel's button. It now requires the panel whose title is "Device Tools".
 * Returns the modal's panel Locator (so a caller can scope a follow-up activation to THIS dialog) or
 * null when neither entry point is present.
 */
export async function openDeviceTools(page: Page): Promise<{ hook: 'dock-action' | 'legacy-rail'; panel: Locator } | null> {
  const dockPanels = page.locator('.dock-action');
  const n = await dockPanels.count();
  for (let i = 0; i < n; i++) {
    const panel = dockPanels.nth(i);
    if (/device\s*tools/i.test(norm(await panel.textContent()))) {
      await activate(page, panel.locator('button'), { kind: 'inspector', name: /^Open$/i, panel, reason: 'open the Device Tools modal from its dock-action panel' });
      await page.waitForTimeout(900);
      const modal = page.locator('[role="dialog"]').filter({ hasText: 'Device Tools' }).first();
      return { hook: 'dock-action', panel: modal };
    }
  }
  const btns = page.locator('button.item');
  const m = await btns.count();
  for (let i = 0; i < m; i++) {
    const btn = btns.nth(i);
    const title = norm(await btn.getAttribute('title'));
    if (title.startsWith('Device Tools')) {
      await activate(page, btn, { kind: 'nav', name: /Device Tools/i, panel: btn.locator('xpath=..'), reason: 'open the Device Tools modal from the legacy tool rail' });
      await page.waitForTimeout(900);
      const modal = page.locator('[role="dialog"]').filter({ hasText: 'Device Tools' }).first();
      return { hook: 'legacy-rail', panel: modal };
    }
  }
  return null;
}

// ───────────────────────── reading the DOM ─────────────────────────

export interface RenderedCard {
  index: number;
  label: string;
  hasDial: boolean;
  hasDyna: boolean;
  hasOnOff: boolean;
  hasSelect: boolean;
  hasUnknown: boolean;
  hasFader: boolean;
  hasSlider: boolean;
}

/** Enumerate the rendered board cards on the current page, with their label text normalised. */
export async function collectCards(page: Page): Promise<RenderedCard[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.boardwrap .card')].map((el, index) => {
      const pick = (sel: string) => (el.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const label =
        pick('.lbl') || pick('.onoff-l') || pick('.slbl') || pick('.seltop') || pick('.eqtitle') || pick('.dynacap');
      return {
        index,
        label,
        hasDial: !!el.querySelector('.dialwrap'),
        hasDyna: !!el.querySelector('.dynabox'),
        hasOnOff: !!el.querySelector('.onoff'),
        hasSelect: !!el.querySelector('.selfield'),
        hasUnknown: !!el.querySelector('.unknownctl'),
        hasFader: !!el.querySelector('.kval.rel'),
        hasSlider: !!el.querySelector('.srow')
      };
    })
  );
}

/**
 * Scroll an element's OWN scrollable pane so the element lies inside the pane's visible area.
 * Scrolling the WINDOW does nothing (the pane is what overflows). Returns the element's viewport box
 * after the scroll (or null).
 */
export async function scrollIntoPane(page: Page, target: Locator): Promise<{ x: number; y: number; w: number; h: number } | null> {
  await target.first().waitFor({ state: 'attached', timeout: 8000 });
  const box = await target.first().evaluate((el) => {
    const isScrollY = (n: Element) => ['auto', 'scroll', 'overlay'].includes(getComputedStyle(n).overflowY);
    let pane: HTMLElement | null = el.parentElement;
    while (pane && !(isScrollY(pane) && pane.scrollHeight > pane.clientHeight + 2)) pane = pane.parentElement;
    const r0 = el.getBoundingClientRect();
    if (pane) {
      const pr = pane.getBoundingClientRect();
      const rel = r0.top - pr.top + pane.scrollTop;
      pane.scrollTop = Math.max(0, rel - (pane.clientHeight - r0.height) / 2);
    }
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.round(r.width), h: Math.round(r.height) };
  });
  if (!box || box.w <= 0 || box.h <= 0) return null;
  await page.waitForTimeout(120);
  return box;
}

/** The `.tip` bubble text AND its box (null when absent/empty). */
async function readTip(page: Page): Promise<{ text: string; box: { x: number; y: number; w: number; h: number } } | null> {
  return page.evaluate(() => {
    const el = document.querySelector('.tip') as HTMLElement | null;
    if (!el) return null;
    const t = (el.textContent ?? '').trim();
    if (!t) return null;
    const r = el.getBoundingClientRect();
    return { text: t, box: { x: r.left, y: r.top, w: r.width, h: r.height } };
  });
}

/**
 * Hover a card's interactive target with REAL (CDP-backed) pointer input and read the value bubble.
 * The pointer move goes through the read-only guard (mouseMoved only — NEVER a press).
 *
 * HARDENING (2026-10-12): (a) the tip must CLEAR after moving off before the next hover, else the
 * reading is a stale bubble from the previous control (throws, so a mis-read is loud not silent);
 * (b) the tip must sit INSIDE or NEXT TO the hovered box, else it belongs to a different control
 * (throws). Returns the tip text, or null when no bubble appeared.
 *
 * The target is first scrolled into view inside its OWN pane.
 */
export async function hoverReadTip(page: Page, target: Locator): Promise<string | null> {
  const box = await scrollIntoPane(page, target);
  if (!box) return null;
  // Clear any bubble from a previous hover, and REQUIRE it to clear.
  await dispatchHover(page, 4, 4);
  for (let i = 0; i < 6 && (await readTip(page)); i++) await page.waitForTimeout(40);
  if (await readTip(page)) throw new Error(`HIL: a stale .tip did not clear after moving off '${(await target.first().textContent())?.slice(0, 40)}'`);
  await dispatchHover(page, box.x, box.y);
  await page.waitForTimeout(140);
  const tip = await readTip(page);
  await dispatchHover(page, 4, 4);
  await page.waitForTimeout(40);
  if (!tip) return null;
  // The tip must belong to the hovered control: its box must overlap or sit within 60px of the target.
  const near = (a: number, b: number, size: number, pad: number) => a <= b + size + pad && b <= a + pad;
  const nearOk = near(tip.box.x, box.x - box.w / 2, box.w, 60) && near(tip.box.y, box.y - box.h / 2, box.h, 60);
  if (!nearOk) throw new Error(`HIL: the .tip '${tip.text.slice(0, 40)}' is not next to the hovered box (tip ${tip.box.x},${tip.box.y} vs target ${Math.round(box.x)},${Math.round(box.y)})`);
  return tip.text;
}

// ───────────────────────── readout parsing (value + UNIT) ─────────────────────────

export interface Readout {
  value: number | null;
  /** The unit token the tip ACTUALLY displayed, normalised (lower-case, no spaces). */
  unit: string | null;
  unknown: boolean;
}

/**
 * Parse a readout string into its VALUE, its UNIT and an unknown marker.
 *
 * BUG FIX (2026-10-12): the old parser kept the FIRST number, so a tip like `Mic 2 36.5` read as the
 * value `2`. It now takes the LAST number (the value trails the label) and extracts the unit token
 * that follows it, so a unit mismatch is observable instead of being overwritten with the SERVED unit.
 */
export function parseReadout(text: string | null | undefined): Readout {
  const t = (text ?? '').trim();
  if (!t || t === '—' || t === '–' || t === '-') return { value: null, unit: null, unknown: true };
  const re = /(-?\d+(?:[.,]\d+)?)\s*([%°a-zA-Z\/]+)?/g;
  let m: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((m = re.exec(t)) !== null) {
    if (m[1]) last = m;
    if (re.lastIndex === m.index) re.lastIndex++; // guard against a zero-width match
  }
  if (!last) return { value: null, unit: null, unknown: false };
  const value = parseFloat(last[1]!.replace(',', '.'));
  const unit = last[2] ? last[2].toLowerCase() : null;
  return { value: Number.isFinite(value) ? value : null, unit, unknown: false };
}

/** Normalise a unit token for comparison (served `unit` vs the tip's token). */
export const normUnit = (u: string | null | undefined): string => (u ?? '').toLowerCase().replace(/\s+/g, '').replace(/^db$/, 'db');

/**
 * Relative display tolerance: HALF a unit in the last digit the tip shows, CAPPED at ~0.5% of the
 * param's display span. Fixes the old absolute 0.15 (which was 15% of a 0..1 range and far too tight
 * for a wide range). `shown` is the tip's numeric text (its decimal places set the last digit).
 */
export function toleranceFor(shownText: string, min: number | undefined, max: number | undefined): number {
  const decimals = (() => {
    const m = String(shownText).match(/\.(\d+)/);
    return m ? m[1]!.length : 0;
  })();
  const halfLastDigit = 0.5 * Math.pow(10, -decimals);
  const span = min != null && max != null && max > min ? max - min : null;
  const cap = span != null ? 0.005 * span : halfLastDigit;
  return Math.max(1e-9, Math.min(halfLastDigit, cap));
}

// ───────────────────────── visibility ─────────────────────────

/**
 * Visibility classification against the element's OWN clipping ancestors AND the viewport.
 *
 * BUG FIX (2026-10-12):
 *   • The old rule (`fullyInside`) demanded the card be FULLY inside the pane, so a 284px tile in a
 *     ~280px pane was forever `off-pane-unreachable`. A card is now REACHABLE when, after scrolling its
 *     pane, its VERTICAL intersection with the visible pane is at least `min(cardHeight, paneHeight) − 1`
 *     (and it overlaps horizontally).
 *   • A pane counts as scrollable only when `overflowY ∈ {auto, scroll, overlay}` (never hidden/clip).
 *   • Cards and panes are joined PER ELEMENT (both sides enumerate every `.boardwrap .card`; each card
 *     finds its OWN pane), and the visible region is intersected with EVERY clipping ancestor and the
 *     viewport.
 *   • `el.checkVisibility({opacityProperty, visibilityProperty})` and an `elementFromPoint` hit-test at
 *     ~5 points (requiring the card or a descendant on top) catch collapsed/occluded controls.
 *   • The owner-reported class (below the fold but reachable by scrolling) is `off-pane-on-open` — a
 *     WARN, never the old misclassified hard failure.
 */
export type VisOutcome = 'in-pane' | 'off-pane-on-open' | 'off-pane-unreachable' | 'collapsed' | 'occluded';

export interface VisResult {
  index: number;
  /** Stable key (a data-attribute when the card carries one, else its label + DOM index). */
  key: string;
  label: string;
  outcome: VisOutcome;
  box: { top: number; bottom: number; left: number; right: number };
  pane: { top: number; bottom: number; left: number; right: number; clientHeight: number; clientWidth: number; scrollHeight: number; overflowY: string; scrollable: boolean } | null;
  checkVisible: boolean;
  hitOk: boolean;
}

export async function classifyVisibility(page: Page): Promise<VisResult[]> {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('.boardwrap .card')] as HTMLElement[];
    const scrollYs = new Set(['auto', 'scroll', 'overlay']);
    const clipXs = new Set(['hidden', 'clip', 'auto', 'scroll', 'overlay']);

    const rectOf = (el: HTMLElement) => el.getBoundingClientRect();
    const clipAncestors = (el: HTMLElement) => {
      const out: HTMLElement[] = [];
      let n = el.parentElement;
      while (n) {
        const cs = getComputedStyle(n);
        if (clipXs.has(cs.overflowY) || clipXs.has(cs.overflowX)) out.push(n);
        n = n.parentElement;
      }
      return out;
    };
    const ownPane = (el: HTMLElement) => {
      let n = el.parentElement;
      while (n && !(scrollYs.has(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 2)) n = n.parentElement;
      return n;
    };
    // Vertical intersection of `el` with every clipping ancestor and the viewport (in viewport coords).
    const visibleHeight = (el: HTMLElement) => {
      const r = rectOf(el);
      let top = Math.max(0, r.top);
      let bottom = Math.min(window.innerHeight, r.bottom);
      for (const a of clipAncestors(el)) {
        const ar = rectOf(a);
        top = Math.max(top, ar.top);
        bottom = Math.min(bottom, ar.bottom);
      }
      return { top, bottom, h: Math.max(0, bottom - top) };
    };
    const hOverlap = (el: HTMLElement) => {
      const r = rectOf(el);
      let left = Math.max(0, r.left);
      let right = Math.min(window.innerWidth, r.right);
      for (const a of clipAncestors(el)) {
        const ar = rectOf(a);
        left = Math.max(left, ar.left);
        right = Math.min(right, ar.right);
      }
      return Math.max(0, right - left);
    };
    const hitTest = (el: HTMLElement) => {
      const r = rectOf(el);
      const pts = [
        [r.left + r.width * 0.5, r.top + r.height * 0.5],
        [r.left + r.width * 0.25, r.top + r.height * 0.25],
        [r.left + r.width * 0.75, r.top + r.height * 0.25],
        [r.left + r.width * 0.25, r.top + r.height * 0.75],
        [r.left + r.width * 0.75, r.top + r.height * 0.75]
      ];
      let ok = 0;
      for (const [x, y] of pts) {
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
        const top = document.elementFromPoint(x, y);
        if (top && (top === el || el.contains(top))) ok++;
      }
      return ok;
    };

    const out: any[] = [];
    for (let i = 0; i < cards.length; i++) {
      const el = cards[i]!;
      const r = rectOf(el);
      const label = (el.querySelector('.lbl')?.textContent ?? el.querySelector('.onoff-l')?.textContent ?? el.querySelector('.seltop')?.textContent ?? el.querySelector('.dynacap')?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const key = el.getAttribute('data-param') || el.getAttribute('data-idx') || (label ? `${label}#${i}` : `card#${i}`);
      const pane = ownPane(el);
      const paneSaved = pane ? pane.scrollTop : 0;
      const paneInfo = pane
        ? (() => {
            const pr = rectOf(pane);
            const cs = getComputedStyle(pane);
            return {
              top: Math.round(pr.top), bottom: Math.round(pr.bottom), left: Math.round(pr.left), right: Math.round(pr.right),
              clientHeight: pane.clientHeight, clientWidth: pane.clientWidth, scrollHeight: pane.scrollHeight,
              overflowY: cs.overflowY, scrollable: scrollYs.has(cs.overflowY) && pane.scrollHeight > pane.clientHeight + 2
            };
          })()
        : null;

      const base = {
        index: i, key, label,
        box: { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) },
        pane: paneInfo,
        checkVisible: el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true,
        hitOk: false
      };

      if (r.width <= 0 || r.height <= 0) {
        out.push({ ...base, outcome: 'collapsed', box: { top: 0, bottom: 0, left: 0, right: 0 } });
        continue;
      }
      const cardH = r.height;
      const reachH = (el2: HTMLElement) => Math.min(cardH, (pane ? pane.clientHeight : window.innerHeight));
      const onOpen = visibleHeight(el);
      const openReachable = onOpen.h >= reachH(el) - 1 && hOverlap(el) > 1;
      let outcome: VisOutcome;
      if (openReachable) {
        outcome = 'in-pane';
      } else {
        // Try scrolling THIS element's own pane so it centres, then re-measure.
        if (pane) {
          const pr = rectOf(pane);
          const rel = r.top - pr.top + pane.scrollTop;
          pane.scrollTop = Math.max(0, rel - (pane.clientHeight - r.height) / 2);
        }
        const scrolled = visibleHeight(el);
        const reachable = scrolled.h >= reachH(el) - 1 && hOverlap(el) > 1;
        outcome = reachable ? 'off-pane-on-open' : 'off-pane-unreachable';
        if (pane) pane.scrollTop = paneSaved;
        // Restore the pane before the hit-test/box snapshot (measured at open position).
        if (pane) pane.scrollTop = paneSaved;
      }
      const hits = outcome === 'in-pane' || outcome === 'off-pane-on-open' ? hitTest(el) : 0;
      if ((outcome === 'in-pane' || outcome === 'off-pane-on-open') && !base.checkVisible) outcome = 'occluded';
      else if (outcome === 'in-pane' && hits === 0) outcome = 'occluded';
      out.push({ ...base, outcome, hitOk: hits > 0 });
    }
    return out;
  });
}

/** Join a VisResult to a rendered card by DOM index (cards are collected identically in both helpers). */
export function visFor(vis: VisResult[], cardIndex: number): VisResult | undefined {
  return vis.find((v) => v.index === cardIndex);
}

// ───────────────────────── shared expectations ─────────────────────────

/**
 * Assert the app booted against a LIVE device. FIX (2026-10-12): `/api/device` returns a CACHED
 * profile with a model name even when no unit is attached, so gating on `typeof model === 'string'`
 * false-passes. The LIVE probe `/device/detect` must report connected===true (or firmware non-null).
 */
export async function expectLiveDevice(page: Page): Promise<void> {
  const detect = await fetchJson(page, '/device/detect');
  const device = await fetchJson(page, '/device');
  const connected = detect?.connected === true; // firmware is CACHED on /api/device, so it is not a test
  await expect(connected, `/device/detect connected=${detect?.connected}; cached model=${device?.model ?? 'none'} fw=${device?.firmware?.version ?? '?'}`).toBe(true);
}

// ───────────────────────── provenance / proof ─────────────────────────

export interface Provenance {
  runAt: string;
  base: string;
  firmware: unknown;
  device: unknown;
  detect: unknown;
  cache: unknown;
  preset: unknown;
  bodyHash: string | null;
}

/** SHA-256 (hex) of a string, via WebCrypto (Node 18 global). */
export async function sha256Hex(s: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(s).digest('hex');
}

/**
 * Gather the provenance the report must carry so the incident (a cache rebuild silently changing what
 * the app displays) is ATTRIBUTABLE: firmware, the runtime device-cache key + builtAt, the preset
 * number/name/CRC, and the edit-buffer body hash.
 */
export async function gatherProvenance(page: Page): Promise<Provenance> {
  const [device, detect, cache, body, summary] = await Promise.all([
    fetchJson(page, '/device'),
    fetchJson(page, '/device/detect'),
    fetchJson(page, '/device/cache'),
    fetchJson(page, '/preset/body'),
    fetchJson(page, '/preset/summary')
  ]);
  const bodyHex = typeof body?.hex === 'string' ? body.hex : null;
  return {
    runAt: new Date().toISOString(),
    base: DEFAULT_BASE,
    firmware: device?.firmware ?? null,
    device: device ? { model: device.model, modelId: device.modelId, port: device.port } : null,
    detect: detect ?? null,
    cache: cache?.meta ? { key: cache.key, builtAt: cache.meta.builtAt, recordCount: cache.meta.recordCount, source: cache.meta.source, firmware: cache.meta.firmware } : cache ?? null,
    preset: summary ?? null,
    bodyHash: bodyHex ? await sha256Hex(bodyHex) : null
  };
}

/** Write a JSON artifact into the run dir (best-effort; a missing run dir is ignored). */
export function writeRunArtifact(name: string, data: unknown): void {
  const dir = process.env.HIL_RUN_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}
