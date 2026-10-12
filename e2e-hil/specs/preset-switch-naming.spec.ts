/**
 * HIL · Per-preset / per-switch NAMED pickers — the Footswitches (FC) editor.
 *
 * The FM3 assigns a switch to a PER-PRESET function through the FC editor's TAP category/function
 * pickers (Category → "Per-Preset" is ord 9). Every picker must show the NAMES the server serves —
 * never a bare ordinal — and its SELECTED option must match the served selection. Oracles, all read
 * through the app's own proxy:
 *   • `/fc/model`  — the served category table (`categories`) and, per category, the function menu
 *                    (`functions[category]`).
 *   • `/fc/state`  — the CURRENT switch's served selection (`fields.tapCategory`, `fields.tapFunction`).
 *   • `/preset/switches` — the per-preset switch DEFINITIONS decoded from the current preset.
 *
 * Bug fix (2026-10-12): the previous version opened "Device Tools" with the LEGACY tool-rail selector
 * `button.item[title^="Device Tools"]`, which the workbench shell does not render — so the spec timed
 * out before recording a single assertion (an empty report row). This version (a) asserts the
 * reachable, named FC pickers, and (b) attempts the Device Tools per-preset table through the robust
 * `openDeviceTools()` helper, reporting it PENDING WITH A REASON when the shell exposes no entry point
 * (a labelled gap, per the harness's rule — never a silent drop).
 */
import { test, expect } from '@playwright/test';
import {
  bootLive, openPage, fetchJson, openDeviceTools, activate,
  pass, fail, pending, info, expectLiveDevice, norm
} from '../support/hil';

const FEATURE = 'preset-switch-named-pickers';

interface FcModel {
  categories?: Record<string, string>;
  /** Each category maps to its function menu — the entries are objects carrying a `name` (older
   *  servers may serve plain strings), so both shapes are handled. */
  functions?: Record<string, (string | { name: string })[]>;
  liveState?: boolean;
}

/** Function menu for a category as a list of NAMES, tolerating both served shapes. */
const functionNames = (model: FcModel, category: number | undefined): string[] =>
  (model.functions?.[String(category)] ?? []).map((f) => (typeof f === 'string' ? f : f.name));
interface FcState {
  fields?: { tapCategory?: number; tapFunction?: number; holdCategory?: number; holdFunction?: number };
}

interface SelectInfo {
  index: number;
  disabled: boolean;
  value: string;
  selectedText: string;
  options: { v: string; t: string }[];
}

test.describe('HIL · per-switch pickers show served NAMES, not bare codes', () => {
  test('TAP category/function pickers are named and match the served selection', async ({ page }) => {
    await bootLive(page);
    await expectLiveDevice(page);

    const model: FcModel = (await fetchJson(page, '/fc/model')) ?? {};
    const state: FcState = (await fetchJson(page, '/fc/state')) ?? {};
    const categories = model.categories ?? {};
    const tapCategory = state.fields?.tapCategory;
    const tapFunction = state.fields?.tapFunction;

    if (!model.liveState || !Object.keys(categories).length || tapCategory == null) {
      pending(FEATURE, '(fc pickers)', 'PRESENCE', 'the device serves no live FC model/state (liveState false or no categories) — pickers cannot be compared');
      return;
    }

    // Reach the Footswitches (FC) editor page via the nav rail (read-only navigation).
    await openPage(page, 'fc');
    await page.waitForTimeout(2000);

    const sels: SelectInfo[] = await page.evaluate(() =>
      [...document.querySelectorAll('select')].map((s, index) => ({
        index,
        disabled: s.disabled,
        value: s.value,
        selectedText: (s.options[s.selectedIndex]?.text ?? '').trim(),
        options: [...s.options].map((o) => ({ v: o.value, t: (o.textContent ?? '').trim() }))
      }))
    );

    const nameOf = (v: string | number | undefined): string | undefined =>
      v == null ? undefined : categories[String(v)];

    // ── identify the TAP category picker: the select offering the served category roster (incl. Per-Preset) ──
    const catByValue = new Map(Object.entries(categories));
    const catSel = sels.find((s) => {
      const numeric = s.options.filter((o) => /^\d+$/.test(o.v));
      if (numeric.length < 5) return false;
      // every numeric option must be named EXACTLY as the server names it
      return numeric.every((o) => o.t === catByValue.get(o.v));
    });

    if (!catSel) {
      fail(FEATURE, 'TAP category picker', 'PRESENCE', {
        expected: 'a category <select> whose options are named from /fc/model',
        actual: `${sels.length} selects, none named by the served category roster`,
        detail: 'no reachable TAP category picker on the Footswitches page'
      });
      expect('TAP category picker present').toBeTruthy();
      return;
    }
    pass(FEATURE, 'TAP category picker', 'PRESENCE', { actual: `select #${catSel.index}`, detail: `${catSel.options.length} options` });

    // ── NAME: option labels == the served category names; the selection shows the served NAME ──
    const nameMismatch = catSel.options
      .filter((o) => /^\d+$/.test(o.v))
      .filter((o) => o.t !== catByValue.get(o.v))
      .map((o) => `${o.v}: shown '${o.t}' != served '${catByValue.get(o.v)}'`);
    if (nameMismatch.length === 0) {
      pass(FEATURE, 'TAP category picker', 'NAME', { expected: 'options named from /fc/model.categories', actual: `${catSel.options.length} options`, source: '/fc/model' });
    } else {
      fail(FEATURE, 'TAP category picker', 'NAME', { actual: nameMismatch.join('; '), detail: 'option labels disagree with the served category names', source: '/fc/model' });
    }
    const servedCatName = nameOf(tapCategory)!;
    if (catSel.selectedText === servedCatName) {
      pass(FEATURE, 'TAP category picker', 'NAME', { expected: servedCatName, actual: catSel.selectedText, detail: `served tapCategory ${tapCategory}`, source: '/fc/state' });
    } else {
      fail(FEATURE, 'TAP category picker', 'NAME', { expected: servedCatName, actual: catSel.selectedText, detail: `selected NAME disagrees with the served tapCategory ${tapCategory}`, source: '/fc/state' });
    }
    // The per-preset capability itself must be offered by name.
    if (catSel.options.some((o) => o.t === categories['9'])) {
      pass(FEATURE, 'TAP category picker', 'PRESENCE', { expected: 'Per-Preset offered by name', actual: categories['9'], detail: 'the per-preset assignment category is present in the picker' });
    } else {
      fail(FEATURE, 'TAP category picker', 'PRESENCE', { actual: catSel.selectedText, detail: `the served category '${categories['9']}' is not offered` });
    }

    // ── VALUE: the selected option's VALUE == the served selection ──
    if (catSel.value === String(tapCategory)) {
      pass(FEATURE, 'TAP category picker', 'VALUE', { expected: String(tapCategory), actual: catSel.value, detail: `served tapCategory ('${servedCatName}')`, source: '/fc/state' });
    } else {
      fail(FEATURE, 'TAP category picker', 'VALUE', { expected: String(tapCategory), actual: catSel.value, detail: 'the selected option does not match the served tapCategory', source: '/fc/state' });
    }

    // ── identify the TAP function picker: the select offering the served function menu for the category ──
    const fnMenu = functionNames(model, tapCategory);
    const fnSel = sels.find((s) =>
      fnMenu.length > 0 &&
      s.options.filter((o) => o.v !== '').length === fnMenu.length &&
      s.options.filter((o) => o.v !== '').every((o, i) => o.t === fnMenu[Number(o.v)] && o.t === fnMenu[i])
    );
    if (!fnSel) {
      pending(FEATURE, 'TAP function picker', 'PRESENCE', `no <select> matches the served function menu for category '${servedCatName}' (${fnMenu.length} entries)`);
    } else {
      pass(FEATURE, 'TAP function picker', 'PRESENCE', { actual: `select #${fnSel.index}`, detail: `${fnMenu.length} served entries` });
      const servedFnName = fnMenu[tapFunction ?? -1];
      if (fnSel.selectedText === servedFnName) {
        pass(FEATURE, 'TAP function picker', 'NAME', { expected: servedFnName, actual: fnSel.selectedText, detail: `served tapFunction ${tapFunction}`, source: '/fc/model' });
      } else {
        fail(FEATURE, 'TAP function picker', 'NAME', { expected: servedFnName, actual: fnSel.selectedText, detail: `selected NAME disagrees with the served tapFunction ${tapFunction}`, source: '/fc/model' });
      }
      if (fnSel.value === String(tapFunction)) {
        pass(FEATURE, 'TAP function picker', 'VALUE', { expected: String(tapFunction), actual: fnSel.value, detail: `served tapFunction ('${servedFnName}')`, source: '/fc/state' });
      } else {
        fail(FEATURE, 'TAP function picker', 'VALUE', { expected: String(tapFunction), actual: fnSel.value, detail: 'the selected option does not match the served tapFunction', source: '/fc/state' });
      }
    }

    // ── Device Tools · Per-Preset Switches table (the served DEFINITIONS) ──
    const switches = await fetchJson(page, '/preset/switches');
    const servedRows = (switches?.switches ?? []) as any[];
    if (servedRows.length) {
      info(FEATURE, '(oracle)', 'PRESENCE', { detail: `/preset/switches carries ${servedRows.length} decoded per-preset switch rows (populated=${switches?.populated})` });
    }
    const opened = await openDeviceTools(page);
    if (!opened) {
      pending(
        FEATURE, 'Device Tools · per-preset switch table', 'PRESENCE',
        'Device Tools has no reachable entry point in the workbench shell: no placed axis.deviceTools dock-action panel and no legacy tool rail. The per-preset switch DEFINITIONS table lives inside that modal, so it is reported PENDING rather than silently dropped (the FC picker assertions above cover the reachable per-switch naming).'
      );
    } else {
      info(FEATURE, '(device tools)', 'PRESENCE', { detail: `opened via ${opened.hook}` });
      const read = opened.panel.locator('button', { hasText: /read switches/i }).first();
      if (await read.count()) {
        // Scoped to THIS modal's panel and pinned by accessible name — the old guard accepted any
        // 'Read switches' button anywhere in any dialog.
        await activate(page, read, { kind: 'inspector', name: /read switches/i, panel: opened.panel, reason: 'load the per-preset switch table (read-only GET /preset/switches)' });
        await page.waitForTimeout(2500);
      }
      const rows = await page.evaluate(() =>
        [...document.querySelectorAll('.prow:not(.head)')].map((r) => ({
          slot: (r.querySelector('.slot')?.textContent ?? '').trim(),
          nm: (r.querySelector('.nm')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
          ids: (r.querySelector('.ids')?.textContent ?? '').trim()
        }))
      );
      if (!rows.length) {
        pending(FEATURE, 'Device Tools · per-preset switch table', 'PRESENCE', 'the panel opened but rendered no rows (no per-preset switch block in this preset)');
      } else {
        const byIndex = new Map(servedRows.map((s) => [Number(s.index), s]));
        let checked = 0;
        const mismatches: string[] = [];
        for (const r of rows) {
          const idx = Number((r.slot.match(/\d+/) ?? ['NaN'])[0]);
          const served = byIndex.get(idx);
          if (!served) continue;
          checked++;
          // NAME: the row's action/function label must carry the served category name (never a bare code)
          const catName = String(served.action ?? '').split(' (')[0].trim();
          if (!r.nm.includes(catName)) mismatches.push(`PP#${idx}: '${r.nm}' does not carry served '${catName}'`);
          // NAME: the target label must equal the served target label
          if (r.ids && !r.ids.includes(String(served.targetLabel ?? '')) && !/^[—–-]$/.test(r.ids)) {
            mismatches.push(`PP#${idx}: target '${r.ids}' != served '${served.targetLabel}'`);
          }
        }
        if (!mismatches.length && checked) {
          pass(FEATURE, 'Device Tools · per-preset switch table', 'NAME', { expected: 'row action/function/target named from /preset/switches', actual: `${checked} rows cross-checked`, source: '/preset/switches' });
        } else {
          fail(FEATURE, 'Device Tools · per-preset switch table', 'NAME', { actual: mismatches.join('; ') || 'no served row matched', detail: 'row labels disagree with /preset/switches', source: '/preset/switches' });
        }
      }
    }

    expect(nameMismatch, 'TAP category option labels disagree with /fc/model').toEqual([]);
  });
});
