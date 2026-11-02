import { test, expect } from '@playwright/test';
import { bootCleanWorkbench, WORKBENCH_DOC_KEY } from './support/workbench';

/**
 * The Search widget in the workbench shell did nothing.
 *
 * `editor.openLibrary()` sets `inLibrary`, and the CLASSIC shell renders PresetBrowser for it
 * (+page.svelte). The workbench shell rendered only WorkbenchHost, so from the workbench the widget
 * (and the ⌘K path that shares it) changed state and the screen stayed identical. The shell now
 * swaps to the browser too, and the browser's own back action (editor.openBuild) restores the
 * workbench because the host stays mounted in the else branch.
 *
 * The search widget ships in the `hidden` zone, so this seeds it into the top bar — the same thing a
 * user does once from the customize picker.
 */
test.describe('Search widget (workbench shell)', () => {
  test('clicking it opens the preset browser, and coming back restores the workbench', async ({ page }) => {
    await bootCleanWorkbench(page);

    const persisted = await page.evaluate(
      ({ key }) => {
        const raw = window.localStorage.getItem(key);
        if (!raw) throw new Error('no persisted workbench doc');
        const doc = JSON.parse(raw);
        const layout = Object.values(doc.layouts as Record<string, { widgets: Record<string, { zone: string; order: number }> }>)[0];
        const w = layout.widgets['axis.widget.search'];
        if (!w) throw new Error('search widget missing from the seeded doc');
        w.zone = 'top.right';
        w.order = 20;
        window.localStorage.setItem(key, JSON.stringify(doc));
        return true;
      },
      { key: WORKBENCH_DOC_KEY }
    );
    expect(persisted).toBe(true);

    await page.reload();
    await page.waitForSelector('.aw-root');

    const btn = page.locator('[data-widget="axis.widget.search"] button');
    await expect(btn).toBeVisible();
    await btn.click();

    // The library surface is up…
    const pb = page.locator('.pb');
    await expect(pb).toBeVisible();
    // …and it REPLACED the workbench, which is what "opens" has to mean here (before the fix the
    // click left the workbench on screen and nothing else changed).
    await expect(page.locator('.aw-root')).toHaveCount(0);

    // Back out: the browser's own Back control calls editor.openBuild(), which clears inLibrary and
    // re-renders the workbench host. (The workbench shell has no tool rail, so without this control
    // the browser would be a one-way trip.)
    await page.getByRole('button', { name: '← Back' }).click();
    await expect(page.locator('.aw-root')).toBeVisible();
    await expect(page.locator('.pb')).toHaveCount(0);
  });
});
