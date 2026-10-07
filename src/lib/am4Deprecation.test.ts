import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AM4_ALIAS_INVENTORY, AM4_ALIAS_SUNSET } from './am4Deprecation';

// P3 "AM4 alias sunset" source guard. The `/am4/*` routes are deprecated ALIASES of the unified
// API-v2 routes (ForgeFX/server/src/app.ts) and sunset on 2026-12-01. Axis still calls several of
// them from live `legacyAm4` / `!isV2` fallback branches, so removing the aliases would 404 those
// branches silently. This test makes the sunset loud:
//   (a) every `/am4/*` path the client actually calls has a recorded unified equivalent, and
//   (b) the inventory has not drifted from ForgeFX's OWN alias list — a NEW alias (unrecorded) or a
//       REMOVED one (sunset) fails the test rather than rotting silently.
// The alias list, the client-called paths, the unified-route existence in BOTH tables and the
// sunset date are all read from source; only the alias→unified MAPPING is hand-maintained, and it is
// cross-checked by handler identity below (the alias and its recorded unified route must fold into
// the same server handler).

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const readServer = (rel: string): string => {
  const url = new URL(`../../../ForgeFX/server/src/${rel}`, import.meta.url);
  try {
    return readFileSync(fileURLToPath(url), 'utf8');
  } catch {
    throw new Error(
      `am4-deprecation guard: cannot read ForgeFX source at ${fileURLToPath(url)}. ` +
        `This guard is source-derived and needs the sibling ForgeFX worktree (deliberate symlink at ~/wt/p4-3/ForgeFX).`
    );
  }
};

interface Route {
  method: string;
  path: string;
  handler: string | null;
}

/** Parse every Fastify registration `app.<method>(…'/<path>'…` out of app.ts. The generic (`<…>`)
 *  holds no paren, so `[^(]*` safely skips it; each route's body runs to the next registration. */
function parseAppRoutes(src: string): Route[] {
  const re = /\n\s*app\.(get|post|put|delete)(?:<[^(]*>)?\(\s*'([^']+)'/g;
  const starts: { method: string; path: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) starts.push({ method: m[1].toUpperCase(), path: m[2], index: m.index });
  return starts.map((s, i) => {
    const body = src.slice(s.index, i + 1 < starts.length ? starts[i + 1].index : src.length);
    // the handler is the first `XH(` call — aliases also call `deprecated(` (no `H`) and `Number(`.
    const h = /([A-Za-z][A-Za-z0-9]*H)\(/.exec(body);
    return { method: s.method, path: s.path, handler: h ? h[1] : null };
  });
}

/** Parse the browser-direct transport table `on('METHOD', '/path', …)` out of runtime/router.ts. */
function parseRouterRoutes(src: string): { method: string; path: string }[] {
  const re = /\bon\('(GET|POST|PUT|DELETE)',\s*'([^']+)'/g;
  const out: { method: string; path: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push({ method: m[1], path: m[2] });
  return out;
}

/** Every literal `/am4/*` path the client's transport (forgefx.ts) can hit, incl. template literals. */
function clientAm4Paths(src: string): string[] {
  const re = /(['"`])(\/am4\/[^'"`]*)\1/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.add(m[2]);
  return [...out];
}

/** Collapse route params (`:pidLow`) and template interpolations (`${pidLow}`) to one token so the
 *  client's `/am4/blocks/${pidLow}/params` and the server's `/am4/blocks/:pidLow/params` compare. */
const norm = (p: string) => p.replace(/\$\{[^}]*\}/g, ':_').replace(/:[A-Za-z0-9_]+/g, ':_');
const key = (r: { method: string; path: string }) => `${r.method} ${norm(r.path)}`;
const invKey = (e: { method: string; aliasPath: string }) => `${e.method} ${norm(e.aliasPath)}`;

const appSrc = readServer('app.ts');
const appRoutes = parseAppRoutes(appSrc);
const aliasRoutes = appRoutes.filter((r) => r.path.startsWith('/am4/'));
const unifiedApp = appRoutes.filter((r) => !r.path.startsWith('/am4/'));
const browserKeys = new Set(parseRouterRoutes(readServer('runtime/router.ts')).map(key));
const clientPaths = clientAm4Paths(read('./forgefx.ts'));
const clientSet = new Set(clientPaths.map(norm));

describe('AM4 alias sunset — premise', () => {
  it('ForgeFX still registers the /am4/* aliases and Axis still calls them from live code', () => {
    expect(aliasRoutes.length).toBeGreaterThan(0);
    expect(clientPaths.length).toBeGreaterThan(0);
  });

  it('the pinned sunset date matches app.ts', () => {
    const m = /ALIAS_SUNSET = '([^']+)'/.exec(appSrc);
    expect(m?.[1], 'ALIAS_SUNSET not found in app.ts').toBeDefined();
    expect(m![1]).toBe(AM4_ALIAS_SUNSET);
    expect(AM4_ALIAS_SUNSET).toBe('Tue, 01 Dec 2026 00:00:00 GMT');
  });
});

describe('AM4 alias sunset — inventory does not drift from the server', () => {
  it('inventory == the server alias list exactly (a new or removed alias fails here)', () => {
    const serverSet = [...new Set(aliasRoutes.map(key))].sort();
    const invSet = [...new Set(AM4_ALIAS_INVENTORY.map(invKey))].sort();
    expect(invSet).toEqual(serverSet);
  });

  it('every alias is registered by the server (no stale inventory rows)', () => {
    for (const e of AM4_ALIAS_INVENTORY) {
      expect(aliasRoutes.some((r) => key(r) === invKey(e)), `${invKey(e)} is in the inventory but not in app.ts`).toBe(true);
    }
  });
});

describe('AM4 alias sunset — client coverage', () => {
  it('every /am4/* path the client calls has a recorded unified equivalent', () => {
    for (const p of clientPaths) {
      const entry = AM4_ALIAS_INVENTORY.find((e) => norm(e.aliasPath) === norm(p));
      expect(entry, `client calls ${p} but it is not in the inventory`).toBeDefined();
      expect(entry!.unifiedPath, `${p} has no recorded unified equivalent`).toBeTruthy();
    }
  });

  it('every inventory row marked client-called really is called by forgefx.ts', () => {
    for (const e of AM4_ALIAS_INVENTORY) {
      if (e.clientHelper) {
        expect(clientSet.has(norm(e.aliasPath)), `${e.clientHelper} → ${e.aliasPath} is not called by the client`).toBe(true);
        expect(e.callSites.length, `${e.clientHelper} has no recorded call site`).toBeGreaterThan(0);
      }
    }
  });

  it('every recorded call-site file exists', () => {
    const files = new Set(AM4_ALIAS_INVENTORY.flatMap((e) => e.callSites.map((s) => s.split(':')[0])));
    for (const f of files) expect(() => read(`./${f}`), `${f} does not exist`).not.toThrow();
  });
});

describe('AM4 alias sunset — hand-mapping verified against source (handler identity)', () => {
  it('each alias and its recorded unified route fold into the SAME server handler', () => {
    for (const e of AM4_ALIAS_INVENTORY) {
      const alias = aliasRoutes.find((r) => key(r) === invKey(e));
      expect(alias, `alias ${invKey(e)} not registered in app.ts`).toBeDefined();
      expect(alias!.handler, `${e.aliasPath} has no recognisable handler`).toBeTruthy();
      const uni = unifiedApp.find((r) => key(r) === `${e.method} ${norm(e.unifiedPath)}`);
      expect(uni, `unified ${e.method} ${e.unifiedPath} not registered in app.ts`).toBeDefined();
      expect(uni!.handler, `${e.aliasPath} → ${e.unifiedPath}: handler mismatch`).toBe(alias!.handler);
    }
  });

  it('every unified equivalent also exists in the browser-direct router.ts table', () => {
    for (const e of AM4_ALIAS_INVENTORY) {
      expect(
        browserKeys.has(`${e.method} ${norm(e.unifiedPath)}`),
        `${e.method} ${e.unifiedPath} (unified for ${e.aliasPath}) is missing from runtime/router.ts`
      ).toBe(true);
    }
  });
});

describe('AM4 alias sunset — migration classification is grounded', () => {
  it('needs-capability-check rows the client calls sit behind a client caps gate', () => {
    const gatingFiles = ['DeviceTools.svelte', 'library.svelte.ts'];
    for (const e of AM4_ALIAS_INVENTORY) {
      if (e.status !== 'needs-capability-check' || !e.clientHelper) continue;
      const files = e.callSites.map((s) => s.split(':')[0]);
      expect(
        files.some((f) => gatingFiles.includes(f)),
        `${e.aliasPath} is marked needs-capability-check but has no caps-gating call site`
      ).toBe(true);
    }
  });
});
