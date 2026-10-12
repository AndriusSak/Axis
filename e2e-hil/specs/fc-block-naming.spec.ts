/**
 * HIL · FC editor · the assigned-block field must show a NAME, never a bare id.
 *
 * The FM3 FC "Effect" assignment is a `'block'`-typed value slot. The served FC model (`/fc/model`)
 * carries NO name table for it, so the names are sourced from the preset's PLACED BLOCKS
 * (`/preset/grid`) through the app's own proxy. The honesty rule: a value naming a placed block shows
 * its NAME; a value that matches no placed block — and an unread value — is shown MARKED, never as a
 * bare number that reads like a real entry.
 *
 * Assertions (NAME):
 *   - the picker exists (else PENDING: the current FC selection has no block-typed slot);
 *   - its SELECTED option text is a placed-block NAME or an explicit marker, NEVER a bare integer;
 *   - every option whose value equals a placed block's effectId is labelled with that block's name,
 *     sourced from the live `/preset/grid`.
 */
import { test, expect } from '@playwright/test';
import { bootLive, openPage, fetchJson, pass, fail, pending, info, expectLiveDevice, norm } from '../support/hil';

const FEATURE = 'fc-block-naming';
const MARKERS = ['no value read', 'not a placed block', 'a routing shunt', '(unnamed)', '—'];

test.describe('HIL · FC block-typed value slot is named from the placed blocks', () => {
  test('the assigned-block field shows a NAME or an explicit marker, never a bare id', async ({ page }) => {
    await bootLive(page);
    await expectLiveDevice(page);

    // Expected names come from the preset's placed blocks, through the app's own proxy.
    const grid = await fetchJson(page, '/preset/grid');
    const placed = (grid?.cells ?? []).filter((c: any) => !c.isShunt && Number.isInteger(c.effectId));
    const nameByEffect = new Map<number, string>(placed.map((c: any) => [c.effectId, norm(c.name)]));
    // An EMPTY grid cannot verify naming at all — never a vacuous pass. (Old code passed NAME when the
    // roster was empty, so a preset with no placed blocks certified itself.)
    if (nameByEffect.size === 0) {
      pending(FEATURE, 'Effect (block-typed) value slot', 'NAME', 'the live /preset/grid carried no placed blocks — naming cannot be verified (never a pass)');
      expect(nameByEffect.size, 'an empty grid must not certify naming').toBeGreaterThan(0);
      return;
    }

    await openPage(page, 'fc');
    // The block picker is the <select> whose title is the roster note (mentions "placed block").
    const picker = page.locator('select[title*="placed block"]');
    const pickerCount = await picker.count();

    if (pickerCount === 0) {
      pending(FEATURE, 'Effect (block-typed) value slot', 'NAME', 'no block-typed slot in the current FC selection (select the switch assigned to an Effect function to exercise it)');
      // Not a failure: the field genuinely is not on screen for this selection.
      return;
    }
    pass(FEATURE, 'Effect (block-typed) value slot', 'PRESENCE', { actual: `${pickerCount} picker(s)`, detail: 'roster title discloses the cap' });

    const sel = picker.first();
    const selectedText = norm(await sel.evaluate((el: HTMLSelectElement) => el.options[el.selectedIndex]?.text ?? el.value));
    const options = await sel.evaluate((el: HTMLSelectElement) => [...el.options].map((o) => ({ value: o.value, text: (o.textContent ?? '').trim() })));
    const title = norm(await sel.getAttribute('title'));

    // ── NAME: the selected text is a name or a marker, never a bare id ──
    const isBareId = /^-?\d+$/.test(selectedText);
    const isMarker = MARKERS.some((m) => selectedText.includes(m));
    const rec = { expected: `a NAME from /preset/grid, or a marker (${MARKERS.join(' | ')})`, actual: selectedText, source: '/preset/grid' };
    if (isBareId) {
      fail(FEATURE, 'Effect (block-typed) value slot', 'NAME', { ...rec, detail: 'the field shows a bare id' });
    } else if (isMarker) {
      // A marker is the explicit "not readable" outcome the honesty rule requires.
      pass(FEATURE, 'Effect (block-typed) value slot', 'NAME', { ...rec, detail: `explicit marker — ${selectedText}` });
    } else {
      const named = [...nameByEffect.values()].includes(selectedText);
      if (named) pass(FEATURE, 'Effect (block-typed) value slot', 'NAME', { ...rec, detail: 'matched a placed-block name from /preset/grid' });
      else fail(FEATURE, 'Effect (block-typed) value slot', 'NAME', { ...rec, detail: 'neither a placed-block name nor an explicit marker' });
    }

    // ── NAME: each option that names a placed block uses that block's served name ──
    const mismatches: string[] = [];
    for (const o of options) {
      const v = Number(o.value);
      if (!Number.isFinite(v) || !nameByEffect.has(v)) continue;
      const expectName = nameByEffect.get(v)!;
      if (o.text !== expectName) mismatches.push(`value ${v}: option '${o.text}' != served '${expectName}'`);
    }
    if (mismatches.length === 0) {
      pass(FEATURE, 'block picker options', 'NAME', { expected: 'options named from /preset/grid', actual: `${options.length} options`, detail: `${[...nameByEffect.keys()].length} placed blocks cross-checked` });
    } else {
      fail(FEATURE, 'block picker options', 'NAME', { actual: mismatches.join('; '), detail: 'option labels disagree with the served placed-block names' });
    }

    // ── NAME: the roster note discloses its cap ──
    if (/placed block/.test(title)) pass(FEATURE, 'block picker roster note', 'NAME', { actual: title.slice(0, 120), detail: 'cap disclosed' });
    else fail(FEATURE, 'block picker roster note', 'NAME', { actual: title.slice(0, 120), detail: 'roster note does not disclose the cap' });

    info(FEATURE, '(roster)', 'NAME', { detail: `${placed.length} placed blocks served by /preset/grid` });

    expect(isBareId, `the assigned-block field shows a bare id: '${selectedText}'`).toBe(false);
    expect(mismatches, `option names disagree with /preset/grid:\n${mismatches.join('\n')}`).toEqual([]);
  });
});
