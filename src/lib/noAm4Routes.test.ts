import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

// P7 "AM4 alias removal" successor guard. Replaces the retired `am4Deprecation.{ts,test.ts}`
// pair, whose whole premise was that the client still called ForgeFX's deprecated `/am4/*`
// alias routes from live `legacyAm4` / `!isV2` fallback branches. The fallback is gone: every
// device (the AM4 included) now goes through the unified API-v2 routes, and `forgefx.ts` no
// longer carries any `am4*` helper. This guard makes a reintroduction fail loudly.
//
// HARDENED (P10): the old scan only looked for the exact substring `/am4/`, so it missed a route
// built by concatenation (`'/am4' + x`, `"/am4"`) and any `am4Xxx` identifier (`function am4Foo(`).
// It also scanned raw source, so a COMMENT mentioning `/am4/` counted. This version strips comments
// first and flags (a) any `/am4` route PREFIX — `/am4`, `/am4/`, `'/am4'`, `` `/am4` `` — and (b) any
// `am4Xxx` identifier. Test files are excluded so this guard's own patterns don't match themselves.

const here = dirname(fileURLToPath(import.meta.url)); // src/lib
const srcRoot = join(here, '..'); // src

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|svelte)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Strip line + block comments so a comment mentioning an am4 route is not flagged (and cannot hide). */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// A `/am4` route PREFIX: `/am4`, `/am4/`, `'/am4'`, `"/am4"`, `` `/am4` ``, `'/am4' + x` — i.e. `/am4`
// not followed by another alphanumeric (so `/am40` is a different token).
const AM4_ROUTE = /\/am4(?![a-z0-9])/i;
// An `am4Xxx` identifier — a helper/function/const reintroduced (e.g. `function am4Foo(`, `const am4Bar =`).
const AM4_IDENT = /\bam4[A-Z][A-Za-z0-9_]*/;

describe('AM4 alias removal — no /am4/ route references remain', () => {
  it('no source file under src/ references a /am4 route or an am4* helper', () => {
    const offenders: string[] = [];
    for (const f of sourceFiles(srcRoot)) {
      const src = stripComments(readFileSync(f, 'utf8'));
      if (AM4_ROUTE.test(src) || AM4_IDENT.test(src)) offenders.push(relative(srcRoot, f));
    }
    expect(
      offenders,
      `these files still reference a /am4 route or an am4* helper: ${offenders.join(', ')}`
    ).toEqual([]);
  });

  it('forgefx.ts (the client transport) carries no am4* helper', () => {
    const src = stripComments(readFileSync(join(here, 'forgefx.ts'), 'utf8'));
    expect(src).not.toMatch(/\bam4[A-Z]\w*/);
  });
});
