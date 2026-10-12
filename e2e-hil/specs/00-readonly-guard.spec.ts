/**
 * HIL · READ-ONLY GUARD (source check) — the contract, re-checked against the harness's OWN source on
 * every run.
 *
 * The input guard (`support/input-guard.ts`) is the single dispatch site, but a future edit could add
 * a second one in a spec. This suite statically scans every harness source file and FAILS if any of
 * them can press, drag, or type at the live instrument. It is the code half of "read-only by
 * construction"; the byte-identical pre/post body dump in `verify-ui-hardware.sh` is the runtime half.
 */
import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { READ_ONLY_GUARANTEE } from '../support/input-guard';

// The harness lives under e2e-hil/ (this file is e2e-hil/specs/00-readonly-guard.spec.ts).
const HARNESS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function collect(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collect(p, out);
    else if (/\.(ts|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const FILES = collect(HARNESS_ROOT).map((p) => ({ path: p, rel: p.replace(HARNESS_ROOT + '/', ''), src: readFileSync(p, 'utf8') }));

test.describe('HIL · read-only input contract', () => {
  test('the guarantee is stated', () => {
    expect(READ_ONLY_GUARANTEE).toMatch(/mouseMoved/);
    expect(READ_ONLY_GUARANTEE).toMatch(/no press/);
  });

  test('no source file can press, drag or type at the instrument', () => {
    const violations: string[] = [];
    const check = (rel: string, re: RegExp, why: string) => {
      const f = FILES.find((x) => x.rel === rel);
      if (!f) return;
      for (const line of f.src.split('\n')) if (re.test(line)) violations.push(`${rel}: ${why} → ${line.trim().slice(0, 100)}`);
    };
    // The guard owns the one allowed dispatch; this suite's own patterns name the forbidden verbs, so
    // both are exempt from the scan.
    const EXEMPT = new Set(['support/input-guard.ts', 'specs/00-readonly-guard.spec.ts']);
    // Any other file must not even mention a mouse API.
    for (const f of FILES) {
      if (EXEMPT.has(f.rel)) continue;
      for (const [re, why] of [
        [/page\.mouse\./, 'uses page.mouse (a non-guarded input path)'],
        [/\bmouse\.(down|up|click|dblclick|wheel)\b/, 'drives the mouse outside the guard'],
        [/mousePressed|mouseReleased/, 'names a press/release'],
        [/\.dragTo\(|\.dragAndDrop\(/, 'drags'],
        [/page\.keyboard\./, 'types at the instrument'],
        [/buttons:\s*0*1\b/, 'sends/creates a held button']
      ] as [RegExp, string][]) {
        check(f.rel, re, why);
      }
    }
    // The guard itself may dispatch ONLY a mouseMoved with no buttons.
    const guard = FILES.find((f) => f.rel === 'support/input-guard.ts')!;
    // The REAL dispatch is a `.send('Input.dispatchMouseEvent', …)` call (comments may name it).
    const dispatchLines = guard.src.split('\n').filter((l) => /\.send\(\s*['"]Input\.dispatchMouseEvent['"]/.test(l));
    expect(dispatchLines.length, 'the guard must have exactly one CDP dispatch call').toBe(1);
    for (const l of dispatchLines) {
      expect(l, 'the only allowed dispatch is mouseMoved with buttons:0').toMatch(/mouseMoved/);
      expect(l).toMatch(/buttons:\s*0/);
      expect(l, 'no other event type may be sent').not.toMatch(/mousePressed|mouseReleased/);
    }
    // A held button inside a SYNTHETIC DOM event is allowed only in the guard's grid-cell select.
    for (const f of FILES) {
      if (EXEMPT.has(f.rel)) continue;
      if (/buttons:\s*1\b/.test(f.src)) violations.push(`${f.rel}: a held button outside the guard`);
    }
    expect(violations, `read-only violations:\n${violations.join('\n')}`).toEqual([]);
  });

  test('the runtime proof exists: the runner dumps the edit-buffer body before and after', () => {
    const runner = readFileSync(join(HARNESS_ROOT, '..', '..', 'verify-ui-hardware.sh'), 'utf8');
    expect(runner, 'the runner must capture the body BEFORE the suite via the server read-only route').toMatch(/preset\/body/);
    expect((runner.match(/preset\/body/g) ?? []).length, 'the body must be captured twice (before AND after)').toBeGreaterThanOrEqual(2);
  });
});
