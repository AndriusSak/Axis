/**
 * HIL READ-ONLY SOURCE SCANNER — the capability model behind `specs/00-readonly-guard.spec.ts`.
 *
 * WHY THIS EXISTS (2026-10-12, a read-only Opus review of the harness):
 * The previous guard checked SPELLINGS, not CAPABILITIES. It scanned only `.ts`/`.mjs` under
 * `e2e-hil/` (missing `.js`/`.cjs`/`.mts`/`.tsx` and `playwright.hil.config.ts`, which sits OUTSIDE
 * the harness dir) and it exempted the guard file itself from every pattern. It never caught
 * `locator.click()` / `dblclick()` / `selectOption()` / `press()` / `fill()` / `type()` / `check()` /
 * `tap()` / `dispatchEvent()` / `hover()`, `page.touchscreen`, an aliased `const m = page.mouse`,
 * `el.evaluate(n => n.click())`, a self-opened CDP session (`newCDPSession` + `Input.dispatch…`), or
 * a direct write `fetch(url, {method:'POST'})` / `page.request.post`. `locator.click()` IS a real CDP
 * press-and-release — the exact action that wrote to the owner's unit.
 *
 * THE MODEL, inverted to an ALLOWLIST:
 *   • A short list of member calls is permitted on a `page.`/locator receiver; anything else is a
 *     violation. So `page.mouse`, `page.keyboard`, `page.touchscreen`, `page.request`, `page.click`
 *     and a NEW unlisted capability are all caught by default.
 *   • A comprehensive ban on write CAPABILITIES (click/dblclick/tap/press/fill/type/check/uncheck/
 *     selectOption/setInputFiles/dragTo/dragAndDrop/dispatchEvent/hover/focus), on raw CDP
 *     (`newCDPSession`, `Input.dispatch…`) unless inside the one guard file, and on non-GET network
 *     writes (`XMLHttpRequest`, `sendBeacon`, `WebSocket`, `method:` != GET, `request.post`, `body:`).
 *   • `fetch` may appear ONLY inside `fetchJson` (support/hil.ts), which must assert `method === 'GET'`.
 *   • The guard file is NOT blanket-exempt: its synthetic-activation lines are permitted by an EXACT
 *     site list whose match COUNT is pinned, so a second `.click()` cannot ride along.
 *
 * The static scan is one half; the RUNTIME half is `installReadOnlyNetworkGuard()` in input-guard.ts
 * (a `page.route` over the api glob aborts every non-GET), which also cuts off APP-originated writes
 * that no source scan can see.
 *
 * Pure and dependency-free so a POSITIVE CONTROL can run it over a planted file and assert it goes red.
 */

export interface ScanFile {
  /** Harness-relative path (e.g. 'support/hil.ts'), or an absolute marker for a planted file. */
  rel: string;
  src: string;
}

export interface Violation {
  rel: string;
  line: number;
  text: string;
  why: string;
}

/** Member calls permitted on a `page.` receiver. Anything else on `page.` is a violation. */
export const ALLOWED_PAGE_METHODS: ReadonlySet<string> = new Set([
  // navigation / lifecycle (read-only)
  'goto', 'reload', 'url', 'title', 'content', 'close',
  'waitForSelector', 'waitForLoadState', 'waitForTimeout', 'waitForURL', 'waitForEvent', 'waitForFunction',
  // reads
  'evaluate', 'evaluateAll', 'evaluateHandle',
  'locator', 'getByRole', 'getByText', 'getByLabel', 'getByTestId',
  'isVisible', 'isHidden', 'isEnabled', 'isDisabled', 'innerText', 'textContent',
  'context', 'viewportSize', 'setViewportSize', 'screenshot',
  // read-only network enforcement + observation (NEVER a write)
  'route', 'unroute', 'on', 'once', 'off', 'addInitScript'
]);

/**
 * The ONLY permitted synthetic-activation site (all inside the input guard). Each entry is matched
 * against a source LINE; the count of matches per entry is asserted, so an added `.click()` fails.
 */
export const SYNTHETIC_ACTIVATION_SITES: Readonly<Record<string, readonly RegExp[]>> = {
  'support/input-guard.ts': [
    /\(n as HTMLElement\)\.click\(\)/, // the single synthetic activation
    /pointerId: 1, isPrimary: true, button: 0, buttons: 1, pointerType: 'mouse'/,
    /el\.dispatchEvent\(new PointerEvent\('pointerdown'/,
    /el\.dispatchEvent\(new MouseEvent\('mousedown'/,
    /el\.dispatchEvent\(new PointerEvent\('pointerup'/,
    /el\.dispatchEvent\(new MouseEvent\('mouseup'/,
    /el\.dispatchEvent\(new MouseEvent\('click'/
  ]
};

/** Files permitted to contain the raw network capability (the guard's CDP + the pg fetchJson). */
export const CDP_OWNER = 'support/input-guard.ts';
export const FETCH_OWNER = 'support/hil.ts'; // fetchJson only; other files use Node-side GET helpers

/** Comprehensive write-capability bans. A line matching one is a violation unless it matches an
 *  allowed synthetic-activation site for its file. */
const WRITE_CAPABILITY_BANS: readonly [RegExp, string][] = [
  [/\.click\s*\(/, 'calls click() — a DOM/CDP activation (a device WRITE through a knob/button)'],
  [/\.dblclick\s*\(/, 'calls dblclick()'],
  [/\.tap\s*\(/, 'calls tap() — a touch press'],
  [/\.press\s*\(/, 'calls press() — types a key at the instrument'],
  [/\.fill\s*\(/, 'calls fill() — types into a control'],
  [/\.type\s*\(/, 'calls type() — types at the instrument'],
  [/\.check\s*\(/, 'calls check() — toggles a checkbox'],
  [/\.uncheck\s*\(/, 'calls uncheck()'],
  [/\.selectOption\s*\(/, 'calls selectOption() — a <select> that may write on change'],
  [/\.setInputFiles\s*\(/, 'calls setInputFiles()'],
  [/\.dragTo\s*\(/, 'drags'],
  [/\.dragAndDrop\s*\(/, 'drags'],
  [/\.dispatchEvent\s*\(/, 'dispatches a synthetic DOM event outside the guard'],
  [/\.hover\s*\(/, 'calls hover() — activation must go through the guard\'s dispatchHover'],
  [/\.focus\s*\(/, 'focuses a control'],
  [/mousePressed|mouseReleased/, 'names a mouse press/release'],
  [/buttons\s*:\s*0*1\b/, 'sends/creates a HELD button (press)'],
  [/\bpage\.(mouse|keyboard|touchscreen)\b/, 'names page.mouse/page.keyboard/page.touchscreen (an unguarded input path, aliased or not)'],
  [/\.mouse\.(down|up|click|dblclick|wheel|move)\b/, 'drives page.mouse directly'],
  [/Input\.dispatch(?!MouseEvent)/, 'sends a non-mouse CDP input event'],
  [/Input\.dispatchTouchEvent|Input\.dispatchKeyEvent|Input\.dispatchDragEvent|Input\.insertText/, 'sends a CDP input event that is not a hover']
];

/** Network-write bans (apply to every scanned file). */
const NETWORK_WRITE_BANS: readonly [RegExp, string][] = [
  [/\bmethod\s*:\s*['"](?!GET\b)/i, 'a non-GET HTTP method'],
  [/\bXMLHttpRequest\b/, 'opens an XMLHttpRequest (an uncontrolled network write path)'],
  [/\bnavigator\.sendBeacon\b|\bsendBeacon\b/, 'uses sendBeacon'],
  [/\bnew\s+WebSocket\b/, 'opens a WebSocket'],
  [/\bpage\.request\b/, 'uses page.request (a raw HTTP path outside fetchJson)'],
  [/\.request\.(post|put|patch|delete)\b/i, 'issues a non-GET fetch through a request object'],
  [/\bfetch\s*\([^)]*\{[^}]*\bbody\s*:/, 'sends a request BODY (a write payload)']
];

/** The rule book (this module) defines the ban patterns, so it must quote them; it is exempt from the
 *  token bans but NOT from the page allowlist. `checkRulebookComplete()` guards against a deleted ban. */
export const RULEBOOK = 'support/readonly-scan.ts';

/** Scan one file; returns its violations. `rel` is used for reporting + the site allowlist. */
export function scanFile(file: ScanFile): Violation[] {
  const out: Violation[] = [];
  const allow = SYNTHETIC_ACTIVATION_SITES[file.rel] ?? [];
  const lines = file.src.split('\n');
  const isCdpOwner = file.rel === CDP_OWNER;
  const isFetchOwner = file.rel === FETCH_OWNER;
  const isRulebook = file.rel === RULEBOOK;
  const isSpec = /(^|\/)specs\//.test(file.rel) || /\.(spec|test)\.[cm]?[jt]sx?$/.test(file.rel);

  // The rule book QUOTES every ban pattern and every capability probe, so per-line scanning it is all
  // noise. Its integrity is proven instead by `checkRulebookComplete()` (which runs the probes through
  // `scanFile` and requires each to be caught) — a deleted ban fails that self-test.
  if (isRulebook) return out;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    const siteAllowed = allow.some((re) => re.test(line));

    // 1. write-capability bans (skip an exactly-allowlisted synthetic site; skip the rule book)
    if (!siteAllowed && !isRulebook) {
      for (const [re, why] of WRITE_CAPABILITY_BANS) {
        if (re.test(line)) out.push({ rel: file.rel, line: i + 1, text: trimmed.slice(0, 120), why });
      }
    }

    // 2. network-write bans (skip the rule book, which quotes them)
    if (!isRulebook) {
      for (const [re, why] of NETWORK_WRITE_BANS) {
        if (re.test(line)) out.push({ rel: file.rel, line: i + 1, text: trimmed.slice(0, 120), why });
      }
    }

    // 3. raw CDP outside the guard
    if (!isCdpOwner && /newCDPSession\s*\(/.test(line)) {
      out.push({ rel: file.rel, line: i + 1, text: trimmed.slice(0, 120), why: 'opens a CDP session outside the guard' });
    }

    // 4. EVERY fetch must be an explicit GET; a spec may not fetch at all (it reads through fetchJson)
    if (/\bfetch\s*\(/.test(line)) {
      const hasGet = /method\s*:\s*['"]GET['"]/.test(line);
      if (isSpec) out.push({ rel: file.rel, line: i + 1, text: trimmed.slice(0, 120), why: 'a spec must read through fetchJson(), never a raw fetch' });
      else if (!hasGet && !isFetchOwner) out.push({ rel: file.rel, line: i + 1, text: trimmed.slice(0, 120), why: 'raw fetch without an explicit method: GET' });
    }

    // 5. page.<member>() allowlist
    const m = line.match(/\bpage\.([A-Za-z_$][\w$]*)\s*\(/);
    if (m && !ALLOWED_PAGE_METHODS.has(m[1]!)) {
      out.push({ rel: file.rel, line: i + 1, text: trimmed.slice(0, 120), why: `page.${m[1]}() is not on the read-only allowlist` });
    }
  }
  return out;
}

/** Assert the pinned synthetic-activation site counts (a THIRD activation is caught). */
export function checkActivationSites(files: readonly ScanFile[]): Violation[] {
  const out: Violation[] = [];
  for (const [rel, sites] of Object.entries(SYNTHETIC_ACTIVATION_SITES)) {
    const f = files.find((x) => x.rel === rel);
    if (!f) {
      out.push({ rel, line: 0, text: '', why: `the synthetic-activation owner ${rel} is missing from the scan set` });
      continue;
    }
    for (const re of sites) {
      const n = f.src.split('\n').filter((l) => re.test(l)).length;
      if (n !== 1) out.push({ rel, line: 0, text: re.source, why: `expected exactly 1 activation line for ${re.source}, found ${n}` });
    }
  }
  return out;
}

/** fetchJson must assert GET — otherwise it is just a fetch with a name. */
export function checkFetchJsonAssertsGet(files: readonly ScanFile[]): Violation[] {
  const f = files.find((x) => x.rel === FETCH_OWNER);
  if (!f) return [{ rel: FETCH_OWNER, line: 0, text: '', why: 'support/hil.ts (the fetchJson owner) is missing' }];
  const out: Violation[] = [];
  if (!/method\s*:\s*'GET'/.test(f.src)) out.push({ rel: FETCH_OWNER, line: 0, text: '', why: "fetchJson must pass { method: 'GET' }" });
  if (!/method\s*===\s*'GET'/.test(f.src)) out.push({ rel: FETCH_OWNER, line: 0, text: '', why: 'fetchJson must ASSERT the request method is GET' });
  return out;
}

/**
 * Capability probes: each snippet MUST be caught by the scanner. If a ban is deleted (so a real
 * write capability stops being detected) this self-test fails. This is the hole-closer for the
 * rule-book exemption (the rule book may quote the patterns, so it must PROVE it still detects them).
 */
const CAPABILITY_PROBES: readonly string[] = [
  "await page.locator('#x').click();",
  "await page.locator('#x').dblclick();",
  "await page.locator('#x').selectOption('a');",
  "await page.keyboard.press('Enter');",
  "await page.locator('#x').fill('a');",
  "await page.locator('#x').type('a');",
  "await page.locator('#x').check();",
  'await page.touchscreen.tap(4, 4);',
  "await el.dispatchEvent(new Event('x'));",
  'await el.evaluate((n) => n.click());',
  'const m = page.mouse; m.down();',
  'const s = await page.context().newCDPSession(page);',
  "await page.request.post('/api/x');",
  "await page.evaluate(() => fetch('/api/x', { method: 'POST' }));",
  'const x = new XMLHttpRequest();',
  "navigator.sendBeacon('/x');",
  'session.send("Input.dispatchKeyEvent", {});'
];

/** At least one of these snippets must ALSO be a non-violation (a guard against over-blocking). */
const CONTROL_SNIPPETS: readonly string[] = [
  "await page.route('**/api/**', (r) => r.continue());",
  "await page.waitForSelector('.aw-root');",
  'await page.evaluate(() => document.title);'
];

export function checkRulebookComplete(): Violation[] {
  const out: Violation[] = [];
  for (const src of CAPABILITY_PROBES) {
    const hits = scanFile({ rel: 'specs/__probe__.spec.ts', src });
    if (hits.length === 0) out.push({ rel: RULEBOOK, line: 0, text: src, why: 'the scanner FAILED to catch a known write capability (a ban was deleted?)' });
  }
  for (const src of CONTROL_SNIPPETS) {
    const hits = scanFile({ rel: 'specs/__control__.spec.ts', src });
    if (hits.length > 0) out.push({ rel: RULEBOOK, line: 0, text: src, why: `the scanner wrongly flags a read-only control: ${hits[0]!.why}` });
  }
  return out;
}

/** Scan a set of files. Returns every violation across all files + the cross-file invariants. */
export function scanSources(files: readonly ScanFile[]): Violation[] {
  return [...files.flatMap(scanFile), ...checkActivationSites(files), ...checkFetchJsonAssertsGet(files), ...checkRulebookComplete()];
}
