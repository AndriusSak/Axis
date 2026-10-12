/**
 * HIL READ-ONLY INPUT GUARD — the ONLY module in the harness that dispatches pointer input, and the
 * ONLY module that installs the runtime network guard.
 *
 * ── THE READ-ONLY GUARANTEE (READ-ONLY BY CONSTRUCTION, not by operator discipline) ──
 * The HIL layer drives a LIVE INSTRUMENT. On 2026-10-12 a reproduction used a real
 * `Input.dispatchMouseEvent` press-and-drag on a knob and WROTE to the owner's FM3 — the unit's Cab
 * Room parameters changed as a result. A press-drag on a knob, slider or pad is a device WRITE.
 *
 * Rules, enforced HERE so a spec cannot accidentally violate them:
 *   • The ONLY input this harness may send is `Input.dispatchMouseEvent` with
 *     `type:'mouseMoved', button:'none', buttons:0`. `dispatchHover()` is the sole dispatch site.
 *   • `mousePressed` / `mouseReleased`, a `mouseMoved` with buttons!=0, and any drag are FORBIDDEN.
 *     `refuseInput('press'|'drag')` exists so an attempted write is a THROWN ERROR, never a silent
 *     device write.
 *   • A control is ACTIVATED only through `activate()`, which (a) checks the element belongs to an
 *     explicit, caller-named PANEL (a Locator), (b) computes the element's ACCESSIBLE NAME and
 *     refuses an empty name OR one that does not match the caller's EXPECTED name, (c) refuses a
 *     state-changing label, and (d) activates with a SYNTHETIC DOM event — never a CDP press.
 *   • The runtime NETWORK guard (`installReadOnlyNetworkGuard`) aborts every non-GET `/api/**`
 *     request, so an APP-originated write (which no source scan can see) is cut off at the browser.
 *
 * The end-to-end proof that the run changed no NET device state is the pre/post edit-buffer BODY
 * dump (plus the extended state snapshot) in `verify-ui-hardware.sh`.
 *
 * `specs/00-readonly-guard.spec.ts` re-checks THIS contract against the harness source on every run
 * (including this file and `playwright.hil.config.ts`), so a future edit that reintroduces a
 * press/drag/click fails the suite instead of the unit.
 */
import { type Page, type Locator } from '@playwright/test';

/** The guarantee, quoted verbatim in the report header. */
export const READ_ONLY_GUARANTEE =
  'READ-ONLY: only Input.dispatchMouseEvent(type=mouseMoved, button=none, buttons=0) is ever sent; ' +
  'no press, no drag, no state-changing control is activated; every non-GET /api/** request is ' +
  'ABORTED at the browser (page.route); proven by a net device state unchanged pre/post body + ' +
  'state snapshot (GET /api/preset/body, /device, /device/cache).';

/** The forbidden input kinds, with the reason each would be a device WRITE. */
const FORBIDDEN: Record<string, string> = {
  press:
    'a mouse PRESS (a press event carrying buttons!=0) on a knob, slider or pad is a DEVICE WRITE — it recreates ' +
    'the exact action that changed the owner\u2019s FM3 on 2026-10-12',
  drag: 'a DRAG (a move carrying buttons!=0, or a press-move-release) is a DEVICE WRITE'
};

/** Throw (never silently send) when asked to press or drag. Exists so the refused path is LOUD. */
export function refuseInput(kind: 'press' | 'drag'): never {
  throw new Error(`HIL READ-ONLY GUARD: refusing ${kind} — ${FORBIDDEN[kind]}. HIL input is hover-only.`);
}

// ── the runtime network guard (the capability no source scan can see) ────────────────────────────
/**
 * Abort every non-GET request under `/api/**` at the browser. This cuts off APP-ORIGINATED writes
 * (a UI affordance that POSTs on activation) as well as any harness slip — the one class of write a
 * static source scan can never observe. Installed once per page in the boot path.
 */
export async function installReadOnlyNetworkGuard(page: Page): Promise<void> {
  await page.route('**/api/**', (route) => {
    const method = route.request().method().toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue();
    return route.abort('blockedbyclient');
  });
}

// ── the single CDP dispatch site ────────────────────────────────────────────────────────────────
const CDP = new WeakMap<Page, Promise<any>>();
function cdp(page: Page): Promise<any> {
  let session = CDP.get(page);
  if (!session) {
    session = page.context().newCDPSession(page);
    CDP.set(page, session);
  }
  return session;
}

/**
 * Move the (CDP-backed) pointer. This is the ONLY function in the harness that dispatches input, and
 * the only event type it can send is `mouseMoved` with no buttons — a hover, never a press.
 */
export async function dispatchHover(page: Page, x: number, y: number): Promise<void> {
  const session = await cdp(page);
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
}

// ── activation (synthetic DOM only, allowlisted by KIND + PANEL + ACCESSIBLE NAME) ───────────────

/** The read-only activation kinds. A target that matches none is refused (never clicked). */
export type ActivateKind = 'nav' | 'tab' | 'gridCell' | 'inspector';

/**
 * Refused-on-sight labels: a state-changing control must never be activated, whatever the selector.
 * Extended 2026-10-12 (the old list missed most of what it protected): load/restore/sync/publish/
 * pull/logout/tap/cancel/upload/apply/import/build/rename/send/copy/ok/yes/confirm and `add`/`+`.
 */
const FORBIDDEN_LABEL =
  /\b(reset\s*(ch|block|chan|channel)?|paste(\s+to\s+block|\s+ch)?|save(\s+to\s+(lib|slot))?|store|engage|mute|bypass(\s+mode)?|scene\s+ignore|write|delete|remove|clear|route|load|restore|sync|publish|pull|logout|log\s+out|tap|cancel|upload|apply|import|build|rename|send|copy|ok|yes|confirm|add|new)\b|\+/i;

/** Does an actual DOM element satisfy the allowlisted KIND? Runs in the page. */
const KIND_IN_PAGE: Record<ActivateKind, string> = {
  nav: "!!el.closest('[data-nav-entry]')",
  tab: "!!el.closest('.tabs')",
  gridCell: "el.hasAttribute('data-idx')",
  // 'inspector' NO LONGER means "anything inside any dialog": the caller must name the owning PANEL.
  inspector: 'true'
};

/** Compute an element's ACCESSIBLE NAME (aria-label → aria-labelledby → title → text), normalised. */
const ACCESSIBLE_NAME_FN = `(el) => {
  let v = el.getAttribute('aria-label');
  if (!v) { const lb = el.getAttribute('aria-labelledby'); if (lb) v = lb.split(/\\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' '); }
  if (!v) v = el.getAttribute('title');
  if (!v) v = el.textContent;
  return (v || '').replace(/\\s+/g, ' ').trim();
}`;

export interface ActivateOpts {
  kind: ActivateKind;
  /** The EXACT accessible name the activated element must have. A string is matched exactly
   *  (normalised) or, when a RegExp, tested against the normalised name. An EMPTY name is refused. */
  name: string | RegExp;
  /** The owning PANEL the element must live inside (an explicit Locator). Required for every kind:
   *  this is what stops `activate` grabbing the first matching control in an unrelated panel. */
  panel: Locator;
  /** A short description of why this activation is read-only, for the error message. */
  reason: string;
}

/**
 * Activate a READ-ONLY / NAVIGATION control. Uses a SYNTHETIC DOM click (never a CDP press), and
 * refuses anything that is not the allowlisted KIND, not inside the named PANEL, whose accessible
 * name is EMPTY or does not match `name`, or that matches a state-changing label.
 */
export async function activate(page: Page, target: Locator, opts: ActivateOpts): Promise<void> {
  const el = target.first();
  await el.waitFor({ state: 'attached', timeout: 15_000 });

  // The owning PANEL must actually contain the element (checked live, by element identity).
  const pel = await opts.panel.first().elementHandle();
  const node = await el.elementHandle();
  const inside = pel && node ? await pel.evaluate((p, n) => p === n || (p as Element).contains(n as Element), node) : false;
  if (!inside) {
    throw new Error(`HIL GUARD: refusing to activate a control outside its named panel (${opts.reason})`);
  }

  const verdict = await el.evaluate(
    (n, { k, pred, forbiddenSrc, nameFn, expected, expectedIsRe }) => {
      const matches = !!(new Function('el', `return (${pred});`) as (e: Element) => boolean)(n);
      // eslint-disable-next-line no-new-func
      const accName = (new Function('return ' + nameFn)() as (e: Element) => string)(n);
      const bad = new RegExp(forbiddenSrc, 'i').test(accName);
      const nameOk = expectedIsRe ? new RegExp(expected, 'i').test(accName) : accName.toLowerCase() === String(expected).toLowerCase();
      return { matches, bad, accName, nameOk };
    },
    {
      k: opts.kind,
      pred: KIND_IN_PAGE[opts.kind],
      forbiddenSrc: FORBIDDEN_LABEL.source,
      nameFn: ACCESSIBLE_NAME_FN,
      expected: opts.name instanceof RegExp ? opts.name.source : opts.name,
      expectedIsRe: opts.name instanceof RegExp
    }
  );

  if (!verdict.matches) throw new Error(`HIL GUARD: refusing to activate a non-${opts.kind} control ('${verdict.accName}') — ${opts.reason}`);
  if (!verdict.accName) throw new Error(`HIL GUARD: refusing a control with an EMPTY accessible name (kind ${opts.kind}) — ${opts.reason}`);
  if (!verdict.nameOk) {
    throw new Error(`HIL GUARD: refusing a control whose accessible name '${verdict.accName}' != expected '${opts.name}' — ${opts.reason}`);
  }
  if (verdict.bad) throw new Error(`HIL GUARD: refusing to activate a STATE-CHANGING control ('${verdict.accName}') — ${opts.reason}`);

  await el.evaluate((n) => (n as HTMLElement).click());
  await page.waitForTimeout(400);
}

/**
 * Select a signal-grid cell by dispatching the FULL pointer sequence at its centre — a bare
 * `el.click()` selects nothing because the app's handler runs on pointer events. This is a SELECTION
 * (which block's editor opens), not a press-drag: press and release are at the SAME coordinate, so no
 * drag is ever delivered. Routed here (never `page.mouse`) so the guard owns every path.
 */
export async function activateGridCell(page: Page, row: number, col: number): Promise<void> {
  const cell = page.locator(`[data-idx="${row},${col}"]`);
  await cell.first().waitFor({ state: 'attached', timeout: 20_000 });
  const ok = await cell.first().evaluate((el) => el.hasAttribute('data-idx'));
  if (!ok) throw new Error(`HIL GUARD: ${row},${col} is not a grid cell`);
  await cell.first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const o: PointerEventInit = {
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      pointerId: 1, isPrimary: true, button: 0, buttons: 1, pointerType: 'mouse'
    };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new MouseEvent('mousedown', o as MouseEventInit));
    el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...o, buttons: 0 } as MouseEventInit));
    el.dispatchEvent(new MouseEvent('click', { ...o, buttons: 0 } as MouseEventInit));
  });
  await page.waitForTimeout(700);
}
