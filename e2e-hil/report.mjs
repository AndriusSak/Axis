#!/usr/bin/env node
/**
 * HIL report generator + drift diff.
 *
 * Reads the run's assertion log (JSONL, one record per VALUE/NAME/VISIBILITY/PRESENCE assertion —
 * written by the specs WHETHER OR NOT the assertion passed) plus the manifest and device evidence, and
 * writes:
 *   <reviewDir>/ui-verification.json   machine-readable (also copied into the run dir)
 *   <reviewDir>/ui-verification.md     the human matrix
 *   <reviewDir>/ui-verification-diff.md  drift vs the PREVIOUS run (status changes per assertion)
 *
 * Usage:
 *   node e2e-hil/report.mjs --run-dir <dir> [--review-dir <dir>] [--no-diff]
 * Env fallbacks: HIL_RUN_DIR, HIL_ASSERTIONS, HIL_REVIEW_DIR.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const runDir = argOf('--run-dir') ?? process.env.HIL_RUN_DIR;
if (!runDir) {
  console.error('report.mjs: no --run-dir (or HIL_RUN_DIR)');
  process.exit(2);
}
const reviewDir = argOf('--review-dir') ?? process.env.HIL_REVIEW_DIR ?? dirname(dirname(runDir));
const wantDiff = !args.includes('--no-diff');

const readJson = (p, dflt = null) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : dflt);
const readLines = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const assertPath = process.env.HIL_ASSERTIONS ?? join(runDir, 'assertions.jsonl');
const records = readLines(assertPath);
const manifest = readJson(join(runDir, 'manifest.json'), []);
const device = readJson(join(runDir, 'device.json'), null);

const runAt = new Date().toISOString();
const key = (r) => `${r.feature}|${r.control}|${r.kind}`;
const tally = (rs) => ({ pass: rs.filter((r) => r.status === 'pass').length, fail: rs.filter((r) => r.status === 'fail').length, pending: rs.filter((r) => r.status === 'pending').length, info: rs.filter((r) => r.status === 'info').length });

// Group by feature (manifest order first, then any extras).
const features = [];
const seen = new Set();
for (const m of manifest) {
  const rs = records.filter((r) => r.feature === m.feature);
  features.push({ feature: m.feature, title: m.title, area: m.area, spec: m.spec, implemented: m.implemented, assertions: m.assertions, counts: tally(rs), results: rs });
  seen.add(m.feature);
}
for (const r of records) {
  if (seen.has(r.feature)) continue;
  seen.add(r.feature);
  features.push({ feature: r.feature, title: r.feature, area: '', spec: '', implemented: true, assertions: [], counts: tally([r]), results: [r] });
}

const totals = tally(records);
const verdict = totals.fail > 0 ? 'RED' : records.length === 0 ? 'EMPTY' : 'GREEN';

const report = {
  runAt,
  baseUrl: process.env.HIL_BASE ?? 'http://127.0.0.1:5173',
  device: device?.stack ?? null,
  verdict,
  totals,
  features
};

const jsonPath = join(reviewDir, 'ui-verification.json');
const prevCopy = join(reviewDir, 'ui-verification.prev.json');
let baseline = null;
if (existsSync(jsonPath)) {
  baseline = readJson(jsonPath);
  copyFileSync(jsonPath, prevCopy);
}
mkdirSync(reviewDir, { recursive: true });
writeFileSync(jsonPath, JSON.stringify(report, null, 2));
writeFileSync(join(runDir, 'ui-verification.json'), JSON.stringify(report, null, 2));

// ── markdown matrix ──
const icon = (s) => (s === 'pass' ? '✅' : s === 'fail' ? '❌' : s === 'pending' ? '⚠️' : 'ℹ️');
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
let md = `# HIL UI verification — ${runAt}\n\n`;
md += `- Base: \`${report.baseUrl}\`\n`;
md += `- Device: \`${device?.stack?.device?.model ?? 'n/a'}\` — ${device?.stack?.reason ?? 'n/a'}\n`;
md += `- Verdict: **${verdict}**  ·  pass ${totals.pass} · fail ${totals.fail} · pending ${totals.pending} · info ${totals.info}\n\n`;
md += `> Oracle = the payload the UI itself consumes, read through the app's own \`/api\` proxy. This is render-vs-wire, not render-vs-fixture.\n\n`;

const KIND_ORDER = ['VALUE', 'NAME', 'VISIBILITY', 'PRESENCE'];
md += `## Matrix (feature × assertion kind — worst status per cell)\n\n`;
md += `| feature | ${KIND_ORDER.join(' | ')} |\n| --- | ${KIND_ORDER.map(() => '---').join(' | ')} |\n`;
const worst = (a, b) => (a === 'fail' || b === 'fail' ? 'fail' : a === 'pending' || b === 'pending' ? 'pending' : a === 'info' && b === 'info' ? 'info' : 'pass');
for (const f of features) {
  const cells = KIND_ORDER.map((k) => {
    const rs = f.results.filter((r) => r.kind === k && r.status !== 'info');
    if (!rs.length) return '—';
    return icon(rs.map((r) => r.status).reduce(worst));
  });
  md += `| ${esc(f.feature)} | ${cells.join(' | ')} |\n`;
}
md += `\n## Detail\n\n`;
for (const f of features) {
  md += `### ${icon(f.counts.fail ? 'fail' : f.counts.pending && !f.counts.pass ? 'pending' : 'pass')} ${esc(f.feature)} — ${esc(f.title)}\n\n`;
  md += `_${esc(f.area)}_ · spec \`${esc(f.spec)}\`${f.implemented ? '' : ' · **NOT IMPLEMENTED (PENDING)**'}\n\n`;
  const rs = f.results.filter((r) => r.status !== 'info');
  if (!rs.length) { md += `_no assertions recorded_\n\n`; continue; }
  md += `| control | kind | status | expected | actual | detail |\n| --- | --- | --- | --- | --- | --- |\n`;
  for (const r of rs) md += `| ${esc(r.control)} | ${r.kind} | ${icon(r.status)} ${r.status} | ${esc(r.expected)} | ${esc(r.actual)} | ${esc(r.detail)} |\n`;
  md += `\n`;
}
writeFileSync(join(reviewDir, 'ui-verification.md'), md);
writeFileSync(join(runDir, 'ui-verification.md'), md);

// ── drift diff ──
if (wantDiff) {
  let d = `# HIL UI drift — ${runAt}\n\n`;
  if (!baseline) {
    d += `_No previous report under \`${reviewDir}\` — this run is the baseline._\n`;
  } else {
    const prevByKey = new Map(baseline.features.flatMap((f) => f.results.filter((r) => r.status !== 'info').map((r) => [key(r), r])));
    const curByKey = new Map(records.filter((r) => r.status !== 'info').map((r) => [key(r), r]));
    const changed = [];
    for (const [k, cur] of curByKey) {
      const prev = prevByKey.get(k);
      if (!prev) changed.push({ k, from: '(new)', to: cur.status, detail: cur.detail });
      else if (prev.status !== cur.status) changed.push({ k, from: prev.status, to: cur.status, detail: cur.detail });
    }
    for (const [k, prev] of prevByKey) if (!curByKey.has(k)) changed.push({ k, from: prev.status, to: '(gone)', detail: '' });
    d += `Baseline run: ${baseline.runAt} (${baseline.verdict}, fail ${baseline.totals.fail})\n\n`;
    d += `Current run : ${runAt} (${verdict}, fail ${totals.fail})\n\n`;
    if (!changed.length) d += `_No drift — every assertion kept its status._\n`;
    else {
      d += `| assertion | from | to |\n| --- | --- | --- |\n`;
      for (const c of changed) d += `| ${esc(c.k)} | ${c.from} | ${icon(c.to)} ${c.to} |\n`;
    }
  }
  writeFileSync(join(reviewDir, 'ui-verification-diff.md'), d);
  writeFileSync(join(runDir, 'ui-verification-diff.md'), d);
  console.log('\n' + d);
}

console.log(`\nReport: ${jsonPath}\nMatrix: ${join(reviewDir, 'ui-verification.md')}\nVerdict: ${verdict} (pass ${totals.pass} / fail ${totals.fail} / pending ${totals.pending})`);
process.exit(verdict === 'RED' ? 1 : 0);
