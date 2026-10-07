import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

// P7 "AM4 alias removal" successor guard. Replaces the retired `am4Deprecation.{ts,test.ts}`
// pair, whose whole premise was that the client still called ForgeFX's deprecated `/am4/*`
// alias routes from live `legacyAm4` / `!isV2` fallback branches. The fallback is gone: every
// device (the AM4 included) now goes through the unified API-v2 routes, and `forgefx.ts` no
// longer carries any `am4*` helper. This guard makes a reintroduction of a `/am4/*` route
// reference fail loudly — it scans EVERY source file under `src/` for the substring `/am4/`
// (not just `forgefx.ts`, so a new call site added anywhere is caught).
//
// Test files are excluded so this guard's own pattern doesn't match itself.

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

describe('AM4 alias removal — no /am4/ route references remain', () => {
  it('no source file under src/ references a /am4/* route path', () => {
    const offenders: string[] = [];
    for (const f of sourceFiles(srcRoot)) {
      if (readFileSync(f, 'utf8').includes('/am4/')) offenders.push(relative(srcRoot, f));
    }
    expect(
      offenders,
      `these files still reference a /am4/* route: ${offenders.join(', ')}`
    ).toEqual([]);
  });

  it('forgefx.ts (the client transport) carries no am4* helper', () => {
    const src = readFileSync(join(here, 'forgefx.ts'), 'utf8');
    expect(src).not.toMatch(/\bam4[A-Z]\w*\s*[:=]/);
  });
});
