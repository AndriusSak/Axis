import { type Page } from '@playwright/test';

/**
 * Clipping-aware geometry primitives for the sweep specs.
 *
 * `getBoundingClientRect()` IGNORES ancestor clipping, so every judgement here
 * intersects a rect with each ancestor whose computed overflow is not `visible`
 * (unless that ancestor is scrollable in the overflowing axis, in which case the
 * content is reachable by scrolling and we stop clipping there) and with the
 * viewport. Deliberate ellipsis (`text-overflow: ellipsis`) is opt-in-excludable.
 *
 * The four invariants the sweep pins:
 *   - sideways document scroll (docScrollX)
 *   - any element wider than the viewport (overWide)
 *   - in-flow collision between interactive elements (collisions)
 *   - content whose visible area is zero with no scrollable ancestor (unreachable)
 */

export interface Found {
  label: string;
  x: number; y: number; w: number; h: number;
  visible: number;
}
export interface ProbeResult {
  viewport: { w: number; h: number };
  docScrollX: number;
  overWide: Found[];
  unreachable: Found[];
  clippedText: string[];
  collisions: string[];
}

export interface ProbeOpts {
  root: string;
  labelAttr?: string;
  ignoreTextOverflowEllipsis?: boolean;
  ignore?: string;
  frac?: number;
}

export async function probeInvariants(page: Page, opts: ProbeOpts): Promise<ProbeResult> {
  return page.evaluate(
    ({ rootSel, labelAttr, ignoreEllipsis, ignoreSel, frac }) => {
      const labelOf = (el: Element): string => {
        if (labelAttr) {
          const v = el.getAttribute(labelAttr);
          if (v) return v;
        }
        const cls =
          (el.className && el.className.toString
            ? el.className.toString().split(/\s+/).filter((c: string) => c.startsWith('aw-') || c.startsWith('axis-'))[0]
            : '') || el.tagName.toLowerCase();
        const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 22);
        return txt ? `${cls}:'${txt}'` : cls;
      };
      const rect = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      };
      const visStyle = (el: Element) => {
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.01;
      };

      const root = document.querySelector(rootSel);
      const de = document.documentElement;
      const docScrollX = Math.max(de.scrollWidth - de.clientWidth, document.body.scrollWidth - window.innerWidth);
      if (!root)
        return { viewport: { w: window.innerWidth, h: window.innerHeight }, docScrollX, overWide: [], unreachable: [], clippedText: [], collisions: [] };

      // A positioned ancestor strictly between el and root makes el part of an overlay.
      const inOverlay = (el: Element) => {
        for (let p: Element | null = el; p && p !== root; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (cs.position === 'absolute' || cs.position === 'fixed') return true;
        }
        return false;
      };
      const visRect = (el: Element) => {
        const r0 = el.getBoundingClientRect();
        let l = r0.left, t = r0.top, rr = r0.right, b = r0.bottom;
        let scrollable = false;
        for (let p = el.parentElement; p && p !== root.parentElement; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (cs.overflow === 'visible' && cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
          if (p.scrollWidth > p.clientWidth + 2 && (cs.overflowX === 'auto' || cs.overflowX === 'scroll')) { scrollable = true; continue; }
          if (p.scrollHeight > p.clientHeight + 2 && (cs.overflowY === 'auto' || cs.overflowY === 'scroll')) { scrollable = true; continue; }
          const pr = p.getBoundingClientRect();
          l = Math.max(l, pr.left); t = Math.max(t, pr.top);
          rr = Math.min(rr, pr.right); b = Math.min(b, pr.bottom);
        }
        l = Math.max(l, 0); t = Math.max(t, 0); rr = Math.min(rr, window.innerWidth); b = Math.min(b, window.innerHeight);
        return { x: l, y: t, w: Math.max(0, rr - l), h: Math.max(0, b - t), scrollable };
      };

      const all = Array.from(root.querySelectorAll('*')) as HTMLElement[];
      // `ignore` excludes a subtree, not just the matched element itself.
      const ignored = ignoreSel ? Array.from(root.querySelectorAll(ignoreSel)) : [];
      const isIgnored = (el: Element) => ignored.some((g) => g === el || g.contains(el));
      const overWide: Found[] = [];
      const unreachable: Found[] = [];
      const clippedText: string[] = [];

      for (const el of all) {
        if (ignoreSel && isIgnored(el)) continue;
        if (!visStyle(el)) continue;
        const r = rect(el);
        if (r.w <= 0 || r.h <= 0) continue; // not laid out at all
        if (r.w > window.innerWidth + 1 && !inOverlay(el)) {
          const v = visRect(el);
          if (v.w > 1) overWide.push({ label: labelOf(el), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), visible: Math.round(v.w * v.h) });
        }
        const cs = getComputedStyle(el);
        const hidesX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
        if (hidesX && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && (el.textContent || '').trim().length > 0) {
          const ellipsis = cs.textOverflow === 'ellipsis';
          if (!ignoreEllipsis || !ellipsis) clippedText.push(`${labelOf(el)} sw=${el.scrollWidth} cw=${el.clientWidth}${ellipsis ? ' ellipsis' : ''}`);
        }
      }

      const inter = all.filter(
        (el) =>
          el.matches('button, a[href], input, select, textarea, [role="menuitem"], [role="button"]') &&
          el.tabIndex >= 0 &&
          !el.hasAttribute('disabled') &&
          !inOverlay(el) &&
          !(ignoreSel && isIgnored(el))
      );
      const vis = inter.map((el) => ({ el, v: visRect(el), r: rect(el) })).filter((e) => e.r.w > 0 && e.r.h > 0);
      for (const { el, v, r } of vis) {
        if ((v.w <= 1 || v.h <= 1) && !v.scrollable)
          unreachable.push({ label: labelOf(el), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), visible: Math.round(v.w * v.h) });
      }
      const collisions: string[] = [];
      for (let i = 0; i < vis.length; i++) {
        for (let j = i + 1; j < vis.length; j++) {
          const a = vis[i]!, b = vis[j]!;
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const va = a.v, vb = b.v;
          if (va.w <= 1 || va.h <= 1 || vb.w <= 1 || vb.h <= 1) continue;
          const ox = Math.min(va.x + va.w, vb.x + vb.w) - Math.max(va.x, vb.x);
          const oy = Math.min(va.y + va.h, vb.y + vb.h) - Math.max(va.y, vb.y);
          if (ox > 1 && oy > 1 && (ox * oy) / Math.min(va.w * va.h, vb.w * vb.h) > frac)
            collisions.push(`${labelOf(a.el)} ~ ${labelOf(b.el)} (${Math.round(ox)}x${Math.round(oy)})`);
        }
      }
      return {
        viewport: { w: window.innerWidth, h: window.innerHeight },
        docScrollX,
        overWide,
        unreachable,
        clippedText,
        collisions,
      };
    },
    {
      rootSel: opts.root,
      labelAttr: opts.labelAttr ?? null,
      ignoreEllipsis: opts.ignoreTextOverflowEllipsis ?? false,
      ignoreSel: opts.ignore ?? null,
      frac: opts.frac ?? 0.15,
    }
  );
}

export const summarize = (r: ProbeResult) => ({
  vp: `${r.viewport.w}x${r.viewport.h}`,
  docScrollX: r.docScrollX,
  overWide: r.overWide.map((o) => `${o.label} ${o.w}px vis=${o.visible}`),
  unreachable: r.unreachable.map((o) => `${o.label} @${o.x},${o.y} ${o.w}x${o.h}`),
  clippedText: r.clippedText,
  collisions: r.collisions,
});
