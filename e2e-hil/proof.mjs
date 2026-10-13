#!/usr/bin/env node
/**
 * HIL read-only proof + provenance.
 *
 * WHY (2026-10-12 review): "byte-identical edit buffer" only proves the NET body is unchanged — it
 * cannot see a `store` overwriting a flash slot, a preset RENAME (the name lives in rawPatch[0x08..0x28],
 * outside the body), GLOBAL/FC parameters, tempo, scene index, cursor, the tuner page, cab user banks,
 * server-side state, or any GET with a side effect. So this takes a BROADER before/after snapshot of
 * read-only GETs and requires the DEVICE-STATE set to be identical, and it records the provenance that
 * made the 2026-10-12 incident unattributable: the body hash, preset number/name/CRC, firmware, the
 * runtime device-cache key + builtAt, and the commit SHAs of the three repos.
 *
 * The claim is "net device state unchanged" — NEVER "no write".
 *
 * Usage:
 *   node proof.mjs snapshot --out <jsonfile>
 *   node proof.mjs finalize --before <jsonfile> --after <jsonfile> --out <jsonfile>
 * Env: HIL_BASE (default http://127.0.0.1:5173).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STACK_ROOT = join(HERE, '..', '..');
const BASE = process.env.HIL_BASE ?? 'http://127.0.0.1:5173';

const argv = process.argv.slice(2);
const argOf = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };

// Strict set: a DIFFERENCE here means the device state moved (a write) — FAIL.
const STRICT = [
  '/api/preset/body',
  '/api/preset/blocks/1/raw',
  '/api/preset/blocks/199/raw',
  '/api/preset/scene-state',
  '/api/scene',
  '/api/tempo',
  '/api/preset/grid',
  '/api/preset/switches',
  '/api/preset/locations'
];
// Evidence-only: recorded for provenance, NOT equality-checked. `/device` and friends run the live
// detect → applyRuntimeCache path, so the harness's OWN readiness gate can swap the served profile —
// a self-inflicted hazard that must not masquerade as a write.
const EVIDENCE = ['/api/device', '/api/device/detect', '/api/device/cache', '/api/preset', '/api/fc/state'];

const get = async (url) => {
  try {
    const r = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15000) });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: r.status, json, text: json ? undefined : text.slice(0, 2000) };
  } catch (e) {
    return { status: 0, error: String(e.message) };
  }
};

const bodyHex = (snap) => {
  const b = snap?.['/api/preset/body']?.json;
  return b && typeof b.hex === 'string' ? b.hex.trim() : null;
};

async function snapshot(out) {
  const snaps = {};
  for (const ep of [...STRICT, ...EVIDENCE]) snaps[ep] = await get(BASE + ep);
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), base: BASE, snaps }, null, 2));
  const hex = bodyHex(snaps);
  console.log(`snapshot: ${Object.keys(snaps).length} endpoints; body ${hex ? hex.length / 2 + ' bytes' : 'unavailable'}`);
}

function gitHead(repo) {
  try { return execSync('git rev-parse HEAD', { cwd: join(STACK_ROOT, repo), encoding: 'utf8' }).trim(); } catch { return null; }
}

async function finalize(beforePath, afterPath, out) {
  if (!existsSync(beforePath) || !existsSync(afterPath)) {
    console.error('proof.mjs finalize: a snapshot file is missing');
    process.exit(2);
  }
  const before = JSON.parse(readFileSync(beforePath, 'utf8'));
  const after = JSON.parse(readFileSync(afterPath, 'utf8'));
  // canon() folds the HTTP STATUS in with the payload. The payload alone cannot tell a repeated
  // FAILURE apart from "unchanged": on 2026-10-13 `/api/preset/blocks/199/raw` answered 503 in
  // BOTH snapshots, so the old status-blind canon() called it 'unchanged' and the proof printed
  // ok:true on an endpoint that served NO DATA. Same for any 5xx/501/0 (fetch threw) twice.
  const statusOf = (snap, ep) => snap.snaps?.[ep]?.status ?? 0;
  const failedStatus = (st) => st === 0 || st >= 400; // 0 = fetch threw / no response
  const canon = (snap, ep) => {
    const s = snap.snaps?.[ep];
    return JSON.stringify({ status: s?.status ?? 0, body: s?.json ?? s?.text ?? null });
  };

  // Three explicit buckets. `ok` is true ONLY when nothing changed AND nothing failed/unproven,
  // so an endpoint that produced no data can never be counted as evidence of "unchanged".
  const provenUnchanged = []; // 200 (2xx) on BOTH sides with an identical status+payload
  const failed = [];          // status 0 or >=400 on EITHER side -> cannot prove unchanged
  const changed = [];         // status or payload moved -> VIOLATION
  for (const ep of STRICT) {
    const sb = statusOf(before, ep);
    const sa = statusOf(after, ep);
    if (failedStatus(sb) || failedStatus(sa)) {
      failed.push({ endpoint: ep, before: sb, after: sa });
    } else if (canon(before, ep) !== canon(after, ep)) {
      changed.push(ep);
    } else {
      provenUnchanged.push(ep);
    }
  }

  const hb = bodyHex(before.snaps);
  const ha = bodyHex(after.snaps);
  const hash = (h) => (h ? createHash('sha256').update(h).digest('hex') : null);
  const bodyOk = hb != null && ha != null && hb === ha;
  // A 2xx with no hex is not independently checkable either — an endpoint that produced no
  // payload must not count as 'unchanged' evidence.
  if ((hb == null || ha == null) && !failed.some((f) => f.endpoint === '/api/preset/body')) {
    failed.push({ endpoint: '/api/preset/body', before: statusOf(before, '/api/preset/body'), after: statusOf(after, '/api/preset/body'), note: 'hex unavailable' });
  }

  const ok = changed.length === 0 && failed.length === 0;
  const readOnly = ok
    ? 'net device state unchanged'
    : changed.length
      ? `VIOLATION: ${changed.join(', ')}`
      : `UNPROVEN: ${failed.map((f) => f.endpoint).join(', ')}`;

  const cache = after.snaps['/api/device/cache']?.json;
  const device = after.snaps['/api/device']?.json;
  const preset = after.snaps['/api/preset']?.json;
  const proof = {
    ok,
    readOnly,
    bodyHashBefore: hash(hb),
    bodyHashAfter: hash(ha),
    bodyByteIdentical: bodyOk,
    provenUnchangedEndpoints: provenUnchanged,
    failedOrUnprovenEndpoints: failed,
    changedEndpoints: changed,
    differingEndpoints: changed, // kept: backward-compatible name for the VIOLATION list
    checkedEndpoints: STRICT,
    evidenceOnlyEndpoints: EVIDENCE,
    at: new Date().toISOString(),
    provenance: {
      firmware: device?.firmware ?? null,
      device: device ? { model: device.model, modelId: device.modelId, port: device.port } : null,
      cache: cache?.meta ? { key: cache.key, builtAt: cache.meta.builtAt, recordCount: cache.meta.recordCount, source: cache.meta.source, firmware: cache.meta.firmware } : cache ?? null,
      preset: preset ? { number: preset.number ?? preset.index ?? null, name: preset.name ?? null, crc: preset.crc ?? null } : null,
      commits: { axis: gitHead('Axis'), forgefx: gitHead('ForgeFX'), midi: gitHead('forgefx-midi') }
    }
  };
  writeFileSync(out, JSON.stringify(proof, null, 2));
  console.log(`proof: ${ok ? 'OK — net device state unchanged' : changed.length ? 'VIOLATION' : 'UNPROVEN'} (body ${hash(hb)?.slice(0, 12)}); changed: ${changed.join(', ') || 'none'}; failed/unproven: ${failed.map((f) => `${f.endpoint}[${f.before}/${f.after}]`).join(', ') || 'none'}`);
  process.exit(ok ? 0 : 1);
}

const cmd = argv[0];
if (cmd === 'snapshot') {
  await snapshot(argOf('--out') ?? 'snapshot.json');
} else if (cmd === 'finalize') {
  await finalize(argOf('--before'), argOf('--after'), argOf('--out') ?? 'proof.json');
} else {
  console.error('proof.mjs: expected `snapshot` or `finalize`');
  process.exit(2);
}
