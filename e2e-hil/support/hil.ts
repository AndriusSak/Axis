/**
 * HIL UI verification helpers — drive the LIVE app against the LIVE stack.
 *
 * Nothing here mocks a device payload: every read comes from the app's OWN `/api` proxy (vite dev →
 * ForgeFX :5056 → the real unit). The oracle for every VALUE/NAME assertion is the payload the UI
 * itself consumes, so the comparison is render-vs-wire, not render-vs-fixture.
 *
 * Recipes proven against this live unit:
 *   - A bare `el.click()` selects NOTHING. The grid select handler runs on POINTER events, so dispatch
 *     the full pointerdown/mousedown/pointerup/mouseup/click sequence at the cell's centre.
 *   - Page tabs are buttons matched on NORMALISED text (`'Room/Air'`).
 *   - A knob/card readout appears only on REAL input: hover with the CDP-backed mouse and read
 *     `div.tip`. Synthetic DOM PointerEvents do not set it.
 *   - The persisted workbench doc varies between sessions (the shared dev backend keeps one), so the
 *     runner navigates to a page via the NAV RAIL rather than assuming the boot layout.
 */
import { type Page, type Locator, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AssertionRecord } from '../manifest';
import { activate, activateGridCell, dispatchHover } from './input-guard';
export { READ_ONLY_GUARANTEE, refuseInput, activate, activateGridCell, dispatchHover } from './input-guard';

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

// ───────────────────────── boot / navigation ─────────────────────────

/**
 * Boot the live app with a deterministic first-run state. NO /api route is intercepted — every
 * device payload comes from the real server. We only clear browser-local persistence (the workbench
 * doc + first-run popups) so a stale local doc can't leak between runs; the shared BACKEND doc may
 * still differ, which is why callers navigate by the nav rail instead of trusting the boot layout.
 */
export async function bootLive(page: Page, base = DEFAULT_BASE): Promise<void> {
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
  // The device handshake + grid decode settle asynchronously; the nav rail is the readiness signal.
  await page.waitForSelector('[data-nav-entry="grid"]', { timeout: 20_000 });
  await page.waitForTimeout(1500);
}

/** Open a workbench page via the nav rail (robust to whatever doc the backend persisted). */
export async function openPage(page: Page, navId: string): Promise<void> {
  await activate(page, page.locator(`[data-nav-entry="${navId}"] button`), 'nav', `open the '${navId}' nav page`);
  await page.waitForTimeout(900);
}

/** Normalised, whitespace-collapsed text of a locator (labels carry embedded newlines). */
export const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

// ───────────────────────── grid cell selection ─────────────────────────

/**
 * Select a grid cell (read-only SELECTION of which block's editor opens). Delegates to the guard so
 * the synthetic pointer sequence has exactly one home in the harness.
 */
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

/** Fetch JSON through the app's OWN proxy (in-page fetch → /api → vite → ForgeFX). */
export async function fetchJson(page: Page, path: string): Promise<any> {
  return page.evaluate(async (p) => {
    const r = await fetch(p.startsWith('/api') ? p : `/api${p}`);
    return r.ok ? await r.json() : { __httpStatus: r.status };
  }, path);
}

/** Open a block-editor page tab by normalised text (a read-only page switch, via the guard). */
export async function clickPageTab(page: Page, tabText: string): Promise<void> {
  const tabs = page.locator('.tabs .tab');
  const n = await tabs.count();
  for (let i = 0; i < n; i++) {
    const t = norm(await tabs.nth(i).textContent());
    if (t === tabText) {
      await activate(page, tabs.nth(i), 'tab', `open the '${tabText}' block-editor page`);
      await page.waitForTimeout(500);
      return;
    }
  }
  throw new Error(`page tab not found: ${tabText}`);
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
 * Scroll an element's OWN scrollable pane so the element lies fully inside the pane's visible area.
 * BUG FIX (2026-10-12): a control below the pane fold must be scrolled into view INSIDE ITS OWN
 * SCROLLABLE PANE before hovering — scrolling the WINDOW does nothing (the pane is what overflows),
 * and hovering a control whose box sits below the fold reads a stale/absent bubble. Returns the
 * element's viewport box after the scroll (or null).
 */
export async function scrollIntoPane(page: Page, target: Locator): Promise<{ x: number; y: number; w: number; h: number } | null> {
  await target.first().waitFor({ state: 'attached', timeout: 8000 });
  const box = await target.first().evaluate((el) => {
    let pane: HTMLElement | null = el.parentElement;
    while (pane && !(getComputedStyle(pane).overflowY !== 'visible' && pane.scrollHeight > pane.clientHeight + 2)) {
      pane = pane.parentElement;
    }
    const r0 = el.getBoundingClientRect();
    if (pane) {
      const pr = pane.getBoundingClientRect();
      const rel = r0.top - pr.top + pane.scrollTop; // element top in the pane's scroll space
      pane.scrollTop = Math.max(0, rel - (pane.clientHeight - r0.height) / 2); // centre it in the pane
    }
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.round(r.width), h: Math.round(r.height) };
  });
  if (!box || box.w <= 0 || box.h <= 0) return null;
  await page.waitForTimeout(120); // let the scroll settle before measuring/hovering
  return box;
}

/**
 * Hover a card's interactive target with REAL (CDP-backed) pointer input and read the value bubble.
 * The pointer move goes through the read-only guard (mouseMoved only — NEVER a press). The target is
 * first scrolled into view inside its OWN pane (see scrollIntoPane). Returns the `div.tip` text, or
 * null when no bubble appeared.
 */
export async function hoverReadTip(page: Page, target: Locator): Promise<string | null> {
  const box = await scrollIntoPane(page, target);
  if (!box) return null;
  // Move the pointer off-target first so a stale bubble from a previous hover is cleared, then onto it.
  await dispatchHover(page, 4, 4);
  await page.waitForTimeout(40);
  await dispatchHover(page, box.x, box.y);
  await page.waitForTimeout(140);
  const tip = await page.evaluate(() => document.querySelector('.tip')?.textContent ?? null);
  await dispatchHover(page, 4, 4);
  await page.waitForTimeout(40);
  return tip;
}

/**
 * Open the Device Tools modal via a ROBUST match (bug fix: the old `button.item[title^="Device Tools"]`
 * matched the LEGACY tool rail, which the workbench shell no longer renders). Tries, in order:
 *   1. a placed `axis.deviceTools` dock-action panel's "Open" button (`.dock-action button`, text 'Open');
 *   2. the legacy tool-rail button whose NORMALISED title begins with "Device Tools".
 * Returns the matched hook ('dock-action' | 'legacy-rail') or null when neither is present.
 */
export async function openDeviceTools(page: Page): Promise<'dock-action' | 'legacy-rail' | null> {
  const dock = page.locator('.dock-action button', { hasText: /^\s*Open\s*$/ });
  if (await dock.count()) {
    await activate(page, dock, 'inspector', 'open the Device Tools modal from its dock-action panel');
    await page.waitForTimeout(900);
    return 'dock-action';
  }
  const btns = page.locator('button.item');
  const n = await btns.count();
  for (let i = 0; i < n; i++) {
    const title = norm(await btns.nth(i).getAttribute('title'));
    if (title.startsWith('Device Tools')) {
      await activate(page, btns.nth(i), 'nav', 'open the Device Tools modal from the legacy tool rail');
      await page.waitForTimeout(900);
      return 'legacy-rail';
    }
  }
  return null;
}

/** The number inside a readout string, or an explicit marker for '—'. */
export function parseReadout(text: string | null): { value: number | null; unknown: boolean } {
  const t = (text ?? '').trim();
  if (!t || t === '—' || t === '–' || t === '-') return { value: null, unknown: true };
  const m = t.match(/-?\d+(\.\d+)?/);
  return m ? { value: parseFloat(m[0]), unknown: false } : { value: null, unknown: false };
}

/** Display tolerance for a VALUE assertion (units + rounding of the formatter). */
export function toleranceFor(v: number): number {
  const a = Math.abs(v);
  if (a >= 1000) return 5;
  if (a >= 100) return 1;
  return 0.15;
}

// ───────────────────────── visibility ─────────────────────────

/**
 * Classify every rendered card against its own scrollable pane.
 *   in-pane              — the whole box lies inside the pane's visible area
 *   off-pane-reachable   — below/above the fold, but scrolling THAT pane reveals it
 *   off-pane-unreachable — DOM-present but no scroll of its pane brings it into view
 *   collapsed            — zero-area box
 */
export interface VisResult {
  index: number;
  label: string;
  outcome: 'in-pane' | 'off-pane-reachable' | 'off-pane-unreachable' | 'collapsed';
  box: { top: number; bottom: number; left: number; right: number };
  pane: { top: number; bottom: number; clientHeight: number; scrollHeight: number; scrollable: boolean } | null;
}

export async function classifyVisibility(page: Page, rootSelector = '.boardwrap'): Promise<VisResult[]> {
  return page.evaluate((rootSel) => {
    const root = document.querySelector(rootSel) as HTMLElement | null;
    if (!root) return [];
    // Nearest scrollable ancestor of the board = the block-editor pane.
    let pane: HTMLElement | null = root.parentElement;
    while (pane && !(getComputedStyle(pane).overflowY !== 'visible' && pane.scrollHeight > pane.clientHeight + 2)) {
      pane = pane.parentElement;
    }
    const cards = [...root.querySelectorAll('.card')] as HTMLElement[];
    const savedScroll = pane ? pane.scrollTop : 0;
    const out: any[] = [];
    const paneInfo = pane
      ? (() => {
          const pr = pane!.getBoundingClientRect();
          return {
            top: Math.round(pr.top), bottom: Math.round(pr.bottom),
            clientHeight: pane!.clientHeight, scrollHeight: pane!.scrollHeight,
            scrollable: pane!.scrollHeight > pane!.clientHeight + 2
          };
        })()
      : null;

    const fullyInside = (el: HTMLElement, p: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const pr = p.getBoundingClientRect();
      return r.top >= pr.top - 1 && r.bottom <= pr.bottom + 1 && r.left >= pr.left - 1 && r.right <= pr.right + 1;
    };

    for (let i = 0; i < cards.length; i++) {
      const el = cards[i]!;
      const r = el.getBoundingClientRect();
      const label = (el.querySelector('.lbl')?.textContent ?? el.querySelector('.onoff-l')?.textContent ?? el.querySelector('.seltop')?.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (r.width <= 0 || r.height <= 0) {
        out.push({ index: i, label, outcome: 'collapsed', box: { top: 0, bottom: 0, left: 0, right: 0 }, pane: paneInfo });
        continue;
      }
      let outcome: VisResult['outcome'];
      if (pane && fullyInside(el, pane)) {
        outcome = 'in-pane';
      } else if (pane) {
        // Try to scroll THIS pane so the card is visible.
        const p = pane as HTMLElement;
        const elTopRel = r.top - p.getBoundingClientRect().top + p.scrollTop;
        p.scrollTop = Math.max(0, elTopRel - 8);
        outcome = fullyInside(el, p) ? 'off-pane-reachable' : 'off-pane-unreachable';
        p.scrollTop = savedScroll;
      } else {
        outcome = 'off-pane-unreachable';
      }
      out.push({
        index: i, label, outcome,
        box: { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) },
        pane: paneInfo
      });
    }
    if (pane) pane.scrollTop = savedScroll;
    return out;
  }, rootSelector);
}

// ───────────────────────── shared expectations ─────────────────────────

/** Assert the app booted against a live device (guard so a missing device never false-passes). */
export async function expectLiveDevice(page: Page): Promise<void> {
  const device = await fetchJson(page, '/device');
  await expect(device && (device.connected === true || typeof device.model === 'string'), 'a live device must be attached').toBeTruthy();
}
