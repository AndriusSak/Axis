/**
 * HIL READ-ONLY INPUT GUARD — the ONLY module in the harness that dispatches pointer input.
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
 *   • A control is ACTIVATED only through `activate()`, which (a) allowlists the element by KIND
 *     (nav rail · page tab · grid cell selection · a read-only inspector gate) and (b) performs the
 *     activation with a SYNTHETIC DOM event (`el.click()`), never a CDP press. A synthetic DOM event
 *     is the app's own handler deciding what to do; the allowlist is what keeps that decision
 *     read-only.
 *   • NEVER activate a state-changing control: Reset CH, Reset Block, Paste CH, Paste to Block,
 *     CH → Scenes, Save to Lib, Engage/Mute/Bypass, Scene Ignore, any +/Add/route button, and any
 *     writing dropdown/`<select>`. Those are refused by `activate()`'s allowlist + label denylist.
 *
 * The end-to-end proof that the run touched nothing is the pre/post edit-buffer BODY dump in
 * `verify-ui-hardware.sh` (through the server's own read-only `GET /api/preset/body`): the two bodies
 * must be byte-identical or the run FAILS and names the differing byte offsets.
 *
 * `specs/00-readonly-guard.spec.ts` re-checks THIS contract against the harness source on every run,
 * so a future edit that reintroduces a press/drag fails the suite instead of the unit.
 */
import { type Page, type Locator } from '@playwright/test';

/** The guarantee, quoted verbatim in the report header. */
export const READ_ONLY_GUARANTEE =
  'READ-ONLY: only Input.dispatchMouseEvent(type=mouseMoved, button=none, buttons=0) is ever sent; ' +
  'no press, no drag, no state-changing control is activated; proven by a byte-identical pre/post ' +
  'edit-buffer body dump (GET /api/preset/body).';

/** The forbidden input kinds, with the reason each would be a device WRITE. */
const FORBIDDEN: Record<string, string> = {
  press:
    'a mouse PRESS (mousePressed / buttons!=0) on a knob, slider or pad is a DEVICE WRITE — it recreates ' +
    'the exact action that changed the owner\u2019s FM3 on 2026-10-12',
  drag: 'a DRAG (a move carrying buttons!=0, or a press-move-release) is a DEVICE WRITE'
};

/** Throw (never silently send) when asked to press or drag. Exists so the refused path is LOUD. */
export function refuseInput(kind: 'press' | 'drag'): never {
  throw new Error(`HIL READ-ONLY GUARD: refusing ${kind} — ${FORBIDDEN[kind]}. HIL input is hover-only.`);
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

// ── the single activation site (synthetic DOM only, allowlisted by KIND) ─────────────────────────

/** The read-only activation kinds. A target that matches none is refused (never clicked). */
export type ActivateKind = 'nav' | 'tab' | 'gridCell' | 'inspector';

/** Refused-on-sight labels: a state-changing control must never be activated, whatever the selector. */
const FORBIDDEN_LABEL =
  /\b(reset\s*(ch|block|chan|channel)|paste(\s+to\s+block|\s+ch)?|save(\s+to\s+lib)?|engage|mute|bypass(\s+mode)?|scene\s+ignore|write|store|delete|remove|clear|route)\b/i;

/** Does an actual DOM element satisfy the allowlisted KIND? Runs in the page. */
const KIND_IN_PAGE: Record<ActivateKind, string> = {
  nav: "!!el.closest('[data-nav-entry]') || !!el.closest('.rail') || !!el.closest('.d-nav')",
  tab: "!!el.closest('.tabs') || el.matches('.tab')",
  gridCell: "el.hasAttribute('data-idx')",
  inspector: "!!el.closest('.dock-action') || !!el.closest('[role=dialog]')"
};

/**
 * Activate a READ-ONLY / NAVIGATION control. Uses a SYNTHETIC DOM click (never a CDP press), and
 * refuses anything that is not one of the allowlisted KINDS or that matches a state-changing label.
 */
export async function activate(page: Page, target: Locator, kind: ActivateKind, reason: string): Promise<void> {
  const el = target.first();
  await el.waitFor({ state: 'attached', timeout: 15_000 });
  const verdict = await el.evaluate(
    (node, { k, pred, forbiddenSrc }) => {
      const matches = !!(new Function('el', `return (${pred});`) as (e: Element) => boolean)(node);
      const text = ((node.getAttribute('title') || '') + ' ' + (node.textContent || '')).replace(/\s+/g, ' ').trim();
      const bad = new RegExp(forbiddenSrc, 'i').test(text);
      return { matches, bad, text: text.slice(0, 80) };
    },
    { k: kind, pred: KIND_IN_PAGE[kind], forbiddenSrc: FORBIDDEN_LABEL.source }
  );
  if (!verdict.matches) {
    throw new Error(`HIL GUARD: refusing to activate a non-${kind} control ('${verdict.text}') — ${reason}`);
  }
  if (verdict.bad) {
    throw new Error(`HIL GUARD: refusing to activate a STATE-CHANGING control ('${verdict.text}') — ${reason}`);
  }
  await el.evaluate((node) => (node as HTMLElement).click());
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
