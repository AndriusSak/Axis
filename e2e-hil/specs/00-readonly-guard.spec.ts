/**
 * HIL · READ-ONLY GUARD — the contract, re-checked against the harness's OWN source on every run,
 * PLUS a runtime proof that the network guard cuts off a non-GET request.
 *
 * Three independent halves:
 *   1. STATIC (allowlist): every harness source file — INCLUDING `playwright.hil.config.ts` (which sits
 *      outside `e2e-hil/`) and THIS spec — is scanned for write CAPABILITIES by `support/readonly-scan.ts`.
 *      Only member calls on the read-only allowlist may appear on a `page.` receiver; `page.mouse`,
 *      `page.keyboard`, `page.touchscreen`, `page.request`, `newCDPSession` (outside the guard) and a raw
 *      `fetch` are all violations. `.ts/.tsx/.js/.cjs/.mjs/.mts` are all scanned.
 *   2. POSITIVE CONTROL: a violation planted in a temp file MUST make the scanner go red, so the scan
 *      cannot pass by describing a hazard that no longer exists.
 *   3. RUNTIME: the boot path installs a `page.route` over the api glob which ABORTS every non-GET — the
 *      one class of write (APP-originated) that no source scan can see. A test POSTs through the page
 *      and asserts it was aborted.
 *
 * The old guard is why this exists: it checked SPELLINGS, not CAPABILITIES, scanned only `.ts`/`.mjs`
 * under `e2e-hil/`, and exempted the guard file from every pattern — so `locator.click()` (a real CDP
 * press-and-release, the exact action that wrote to the owner's unit) was never caught.
 */
import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, statSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { READ_ONLY_GUARANTEE } from '../support/input-guard';
import { scanSources, scanFile, type ScanFile } from '../support/readonly-scan';

const HARNESS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AXIS_ROOT = join(HARNESS_ROOT, '..');
const SCAN_EXT = /\.(ts|tsx|js|cjs|mjs|mts)$/;

function collect(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collect(p, out);
    else if (SCAN_EXT.test(name)) out.push(p);
  }
  return out;
}

const FILES: ScanFile[] = collect(HARNESS_ROOT).map((p) => ({ rel: p.replace(HARNESS_ROOT + '/', ''), src: readFileSync(p, 'utf8') }));
// The config lives OUTSIDE e2e-hil/ — it must be scanned too.
FILES.push({ rel: 'playwright.hil.config.ts', src: readFileSync(join(AXIS_ROOT, 'playwright.hil.config.ts'), 'utf8') });

/** Build a string from parts so a banned token never appears literally in THIS spec's source. */
const j = (...parts: string[]) => parts.join('');

test.describe('HIL · read-only input contract', () => {
  test('the guarantee is stated', () => {
    expect(READ_ONLY_GUARANTEE).toMatch(/mouseMoved/);
    expect(READ_ONLY_GUARANTEE).toMatch(/no press/);
    expect(READ_ONLY_GUARANTEE).toMatch(/ABORTED/);
  });

  test('every harness source (incl. config + this spec) is on the read-only allowlist', () => {
    // The scan set must actually cover the config, the guard, and this spec.
    expect(FILES.some((f) => f.rel === 'playwright.hil.config.ts'), 'the config must be scanned').toBe(true);
    expect(FILES.some((f) => f.rel === 'support/input-guard.ts'), 'the guard must be scanned').toBe(true);
    expect(FILES.some((f) => f.rel === 'specs/00-readonly-guard.spec.ts'), 'this spec must be scanned').toBe(true);
    const violations = scanSources(FILES);
    expect(violations, `read-only violations:\n${violations.map((v) => `${v.rel}:${v.line} ${v.why} → ${v.text}`).join('\n')}`).toEqual([]);
  });

  test('the runtime network guard is installed in the boot path', () => {
    const guard = readFileSync(join(HARNESS_ROOT, 'support/input-guard.ts'), 'utf8');
    expect(guard, 'the guard must install a network route').toMatch(/page\.route\(/);
    expect(guard, 'the guard must ABORT a non-GET').toMatch(/route\.abort\(/);
    expect(guard, 'the guard must check the request method').toMatch(/method\(\)/);
  });

  test('POSITIVE CONTROL: a planted violation makes the scanner go red', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hil-guard-'));
    const cases: { name: string; src: string }[] = [
      { name: 'click.spec.ts', src: `await page.locator('#x')${j('.', 'cl', 'ick')}();` },
      { name: 'dispatch.spec.ts', src: `await el.${j('dispatch', 'Event')}(new Event('x'));` },
      { name: 'post.spec.ts', src: `await page.evaluate(() => ${j('fet', 'ch')}('/api/x', { ${j('met', 'hod')}: 'PO' + 'ST' }));` },
      { name: 'cdp.spec.ts', src: `const s = await page.context().${j('newCDP', 'Session')}(page);` }
    ];
    try {
      for (const c of cases) {
        const p = join(dir, c.name);
        writeFileSync(p, c.src);
        const hits = scanFile({ rel: `specs/${c.name}`, src: readFileSync(p, 'utf8') });
        expect(hits.length, `the scanner must FLAG the planted violation in ${c.name}: ${c.src}`).toBeGreaterThan(0);
      }
    } finally {
      for (const c of cases) unlinkSync(join(dir, c.name));
    }
  });

  test('RUNTIME: a POST through the page is ABORTED by the network guard', async ({ page }) => {
    const { bootLive } = await import('../support/hil');
    await bootLive(page);
    const url = `${process.env.HIL_BASE ?? 'http://127.0.0.1:5173'}/api/healthz`;
    // Deliberately a spelling the STATIC scanner cannot see (dynamic dispatch) — only the RUNTIME route
    // guard can stop it, which is exactly why the runtime guard must exist.
    const res = await page.evaluate(async (u: string) => {
      // Built with concatenation so the banned tokens never appear literally in this spec's source.
      const F = (globalThis as any)['fet' + 'ch'] as (url: string, o?: unknown) => Promise<{ status: number }>;
      try {
        const r = await F(u, { ['met' + 'hod']: 'PO' + 'ST' });
        return { reached: true, status: r.status };
      } catch (e) {
        return { reached: false, status: -1, err: String((e as Error).message) };
      }
    }, url);
    expect(res.reached, `the network guard must ABORT a non-GET /api request (got ${JSON.stringify(res)})`).toBe(false);
  });
});
