/**
 * HIL · Cab block (eid 62) · Room/Air page — the layer that catches what nothing else does.
 *
 * Two oracles per control:
 *   • RENDER-VS-WIRE — the payload the UI itself consumes (`/preset/blocks/62/params`).
 *   • WIRE-VS-DEVICE — an INDEPENDENT decode of the block's RAW bytes (`/preset/blocks/62/raw`) with the
 *     STATIC range table (`support/oracle.ts`). This is the second decode path that shares the device
 *     bytes but none of the runtime-profile geometry — it would have caught `Room Diffusion 52.287` vs
 *     `0` (a cache-rebuild bug) with no human in the loop.
 *
 * Per control on the Room/Air page:
 *   VALUE      — the readout (the hover `div.tip`; the pointer position is NOT the value) equals the
 *                served value within a RELATIVE tolerance, AND the displayed UNIT matches the served
 *                unit (a unit mismatch is now observable, not overwritten with the served unit).
 *   PRESENCE   — every control the layout declares either renders or is reported with a reason.
 *   VISIBILITY — the card is inside its pane on open, or reachable by scrolling THAT pane
 *                (`off-pane-on-open` = a WARN, the owner-reported class), or unreachable (a FAIL).
 *
 * A VALUE assertion whose expected value equals another control's value or the param's DEFAULT is
 * recorded `weak` (vacuous), never `pass` — on this preset several controls legitimately serve 0.
 */
import { test, expect } from '@playwright/test';
import {
  bootLive, openPage, selectGridCell, findCellForEffect, fetchJson, clickPageTab,
  collectCards, hoverReadTip, parseReadout, normUnit, toleranceFor, classifyVisibility,
  pass, fail, pending, info, warn, weak, isVacuous, expectLiveDevice, norm
} from '../support/hil';
import { verifyServedAgainstRaw, defaultDisplay, oracleStride } from '../support/oracle';

const FEATURE = 'cab-room-air-readouts';
const CAB_EID = 62;
const FAMILY = 'CABINET';

interface ServedParam {
  id: number; name?: string; value?: number; unit?: string;
  min?: number; max?: number; options?: { value: number; label: string }[]; kind: 'cont' | 'enum';
}

test.describe('HIL · Cab Room/Air vs the live served payload + the raw device bytes', () => {
  test('VALUE / PRESENCE / VISIBILITY for every served Room/Air control', async ({ page }) => {
    await bootLive(page);
    await expectLiveDevice(page);

    // 1. Select the Cab block from the LIVE grid (pointer sequence — a bare click selects nothing).
    await openPage(page, 'grid');
    const cell = await findCellForEffect(page, CAB_EID);
    expect(cell, 'the live preset must place a Cab block (eid 62)').toBeTruthy();
    await selectGridCell(page, cell!.row, cell!.col);
    await expect(page.locator('.boardwrap')).toBeVisible();

    // 2. Open the device's own Room/Air page tab (matched on normalised text).
    await clickPageTab(page, 'Room/Air');
    await expect(page.locator('.tabs .tab.on')).toHaveText('Room/Air');

    // 3. Read the LIVE payload the UI consumes + the RAW device bytes (the independent oracle input).
    const payload = await fetchJson(page, `/preset/blocks/${CAB_EID}/params`);
    expect(payload?.named, 'the server must serve named params for the Cab block').toBeTruthy();
    const rawPayload = await fetchJson(page, `/preset/blocks/${CAB_EID}/raw`);
    const rawValues = rawPayload?.values ?? null;
    const servedById = new Map<number, ServedParam>();
    for (const n of payload.named as any[]) servedById.set(n.id, { ...n, kind: 'cont' });
    for (const e of payload.enums as any[]) servedById.set(e.id, { ...e, kind: 'enum' });

    // 4. The device's OWN editor layout for this page is ground truth for which controls it shows.
    const page2 = (payload.layout?.pages ?? []).find((p: any) => norm(p.name) === 'Room/Air');
    expect(page2, 'the served layout must carry a Room/Air page').toBeTruthy();
    const controls: { label: string; paramId: number | null; widget: string }[] = [];
    for (const row of page2.rows ?? []) for (const c of row.controls ?? []) controls.push({ label: norm(c.label), paramId: c.paramId ?? null, widget: c.widget ?? '' });

    // 5. Snapshot the rendered board + pane geometry.
    const cards = await collectCards(page);
    const vis = await classifyVisibility(page);
    const byLabel = new Map<string, number>();
    cards.forEach((c) => { if (c.label) byLabel.set(c.label, c.index); });
    info(FEATURE, '(page)', 'PRESENCE', { detail: `served controls=${controls.length}, rendered cards=${cards.length}, raw values=${rawValues ? Object.keys(rawValues).length : 0}, pane clientH=${vis[0]?.pane?.clientHeight}`, actual: `${cards.length} cards` });

    const failures: string[] = [];
    const noteFail = (m: string) => failures.push(m);
    const seenValues = new Set<number>();

    for (const c of controls) {
      if (c.paramId == null) continue; // structural (spacer/graph) — binds no param
      const served = servedById.get(c.paramId);
      const controlName = served?.name ?? c.label ?? `paramId ${c.paramId}`;

      if (!served) {
        pending(FEATURE, controlName, 'PRESENCE', `layout control '${c.label}' binds paramId ${c.paramId}, which the server does not serve (unserved/gap)`, { expected: 'served param', actual: 'unserved' });
        continue;
      }

      const cardIndex = byLabel.get(served.name ?? '') ?? byLabel.get(c.label);
      // ── PRESENCE ──
      if (cardIndex === undefined) {
        fail(FEATURE, controlName, 'PRESENCE', { expected: 'a rendered control', actual: 'not rendered', detail: `served param ${c.paramId} ('${served.name}') rendered no card` });
        noteFail(`PRESENCE ${controlName}: served but not rendered`);
        continue;
      }
      pass(FEATURE, controlName, 'PRESENCE', { expected: 'a rendered control', actual: `card #${cardIndex}`, detail: `served param ${c.paramId}` });

      const card = page.locator('.boardwrap .card').nth(cardIndex);

      // ── VALUE (cont) ──
      if (served.kind === 'cont') {
        let tip: string | null = null;
        try {
          tip = await hoverReadTip(page, card.locator('.dialwrap'));
        } catch (e) {
          pending(FEATURE, controlName, 'VALUE', `no hover target: ${(e as Error).message}`);
        }
        {
          const { value: shown, unit: shownUnit, unknown } = parseReadout(tip);
          const servedVal = served.value;
          if (unknown || shown == null) {
            pending(FEATURE, controlName, 'VALUE', `readout '${tip ?? 'none'}' carries no numeric value`, { expected: String(servedVal), actual: String(tip) });
          } else if (servedVal == null) {
            pending(FEATURE, controlName, 'VALUE', 'served param has no value', { actual: String(shown) });
          } else {
            const tol = toleranceFor(tip ?? String(shown), served.min, served.max);
            const diff = Math.abs(shown - servedVal);
            // UNIT HONESTY: compare the unit the TIP displayed to the served unit; record what was shown.
            const su = normUnit(served.unit);
            const du = normUnit(shownUnit);
            const unitOk = !su || !du || su === du || du.startsWith(su) || su.startsWith(du);
            const rec = { expected: `${servedVal}${served.unit ?? ''}`, actual: `${shown}${shownUnit ?? ''}`, detail: `Δ=${diff.toFixed(4)} tol=${tol.toPrecision(3)} unit served='${served.unit ?? ''}' shown='${shownUnit ?? ''}'`, source: `/preset/blocks/${CAB_EID}/params` };
            if (!unitOk) {
              fail(FEATURE, controlName, 'VALUE', { ...rec, detail: `${rec.detail} — DISPLAYED UNIT MISMATCH` });
              noteFail(`VALUE ${controlName}: displayed unit '${shownUnit}' vs served '${served.unit}'`);
            } else if (diff > tol) {
              fail(FEATURE, controlName, 'VALUE', rec);
              noteFail(`VALUE ${controlName}: readout ${shown} vs served ${servedVal} (Δ${diff.toFixed(4)} > tol ${tol.toPrecision(3)})`);
            } else if (isVacuous(servedVal, seenValues, defaultDisplay(FAMILY, c.paramId))) {
              weak(FEATURE, controlName, 'VALUE', { ...rec, detail: `${rec.detail} — VACUOUS (equals the param default or another control's value; not a measurement)` });
            } else {
              pass(FEATURE, controlName, 'VALUE', rec);
            }
            seenValues.add(servedVal);

            // ── WIRE-VS-DEVICE (the independent raw-bytes oracle) ──
            const oracle = verifyServedAgainstRaw(rawValues, FAMILY, c.paramId, servedVal);
            const orec = { expected: `served ${servedVal} == decode(raw)`, actual: `${oracle.mode} ${oracle.decoded ?? 'n/a'}`, detail: `${oracle.detail}; static stride ${oracleStride(FAMILY)} (channel ${oracle.channel})`, source: `/preset/blocks/${CAB_EID}/raw` };
            if (oracle.ok) pass(FEATURE, `${controlName} · raw-oracle`, 'VALUE', orec);
            else {
              fail(FEATURE, `${controlName} · raw-oracle`, 'VALUE', orec);
              noteFail(`VALUE-oracle ${controlName}: served ${servedVal} matches NO independent decode of the raw bytes (${oracle.detail})`);
            }
          }
        }
      } else if (served.kind === 'enum') {
        if (cards[cardIndex]?.hasSelect) {
          const shown = norm(await card.locator('.seltxt').first().textContent());
          const opt = served.options?.find((o) => o.value === served.value);
          const expectedLabel = opt?.label ?? `value ${served.value}`;
          const rec = { expected: expectedLabel, actual: shown, source: `/preset/blocks/${CAB_EID}/params` };
          if (shown === expectedLabel) pass(FEATURE, controlName, 'VALUE', rec);
          else { fail(FEATURE, controlName, 'VALUE', rec); noteFail(`VALUE ${controlName}: '${shown}' vs served option '${expectedLabel}'`); }
        } else {
          pending(FEATURE, controlName, 'VALUE', 'toggle renders state only (no text readout) — NAME/state not asserted here', { expected: served.options?.find((o) => o.value === served.value)?.label });
        }
      }

      // ── VISIBILITY ──
      const v = vis.find((x) => x.index === cardIndex);
      if (!v) {
        pending(FEATURE, controlName, 'VISIBILITY', 'no geometry captured for this card');
      } else if (v.outcome === 'in-pane') {
        pass(FEATURE, controlName, 'VISIBILITY', { actual: v.outcome, detail: `box ${v.box.top}..${v.box.bottom} pane ${v.pane?.top}..${v.pane?.bottom}` });
      } else if (v.outcome === 'off-pane-on-open') {
        warn(FEATURE, controlName, 'VISIBILITY', { actual: v.outcome, detail: `reachable only after scrolling its ${v.pane?.clientHeight}px pane (board ${v.pane?.scrollHeight}px) — invisible on open (the owner-reported class)` });
      } else {
        fail(FEATURE, controlName, 'VISIBILITY', { actual: v.outcome, detail: 'DOM-present but not reachable within its scrollable pane' });
        noteFail(`VISIBILITY ${controlName}: ${v.outcome}`);
      }
    }

    // Report the pane's own geometry as an observation (the Room/Air board overflows a short pane).
    if (vis[0]?.pane) {
      const off = vis.filter((v) => v.outcome === 'off-pane-on-open' || v.outcome === 'off-pane-unreachable').length;
      info(FEATURE, '(pane)', 'VISIBILITY', { detail: `${off}/${vis.length} cards below the fold of a ${vis[0].pane.clientHeight}px pane (board ${vis[0].pane.scrollHeight}px)` });
    }

    expect(failures, `Room/Air HIL failures:\n${failures.join('\n')}`).toEqual([]);
  });
});
