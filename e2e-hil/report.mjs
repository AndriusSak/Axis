#!/usr/bin/env node
/**
 * HIL report generator + drift diff.
 *
 * Reads the run's assertion log (JSONL, one record per VALUE/NAME/VISIBILITY/PRESENCE assertion) plus
 * the manifest, device evidence and the READ-ONLY PROOF file, and writes:
 *   <reviewDir>/ui-verification.json       machine-readable (also copied into the run dir)
 *   <reviewDir>/ui-verification.md         the human matrix
 *   <reviewDir>/ui-verification-diff.md    drift vs the PREVIOUS run (status changes per assertion)
 *
 * FAIL-CLOSED (fixes the 2026-10-12 review):
 *   • EMPTY (no assertions at all) exits NON-ZERO — a stray `test.only` that records nothing can no
 *     longer print GREEN and exit 0.
 *   • An `implemented:true` manifest feature with no non-info record is a FAIL (so a spec that never
 *     ran cannot show ✅).
 *   • A feature whose only results are `pending` shows ⚠️, never ✅.
 *   • The Playwright exit code, the edit-buffer body result and `proof.json` are folded in — a crashed
 *     run or an unproven body can never report GREEN.
 *   • `--stub` writes an UNPROVEN report at the START of a run, so a crash cannot leave the previous
 *     GREEN in place.
 *
 * Verdicts: GREEN (exit 0) · AMBER (soft warn/weak, exit 0) · RED (exit 1) · EMPTY (exit 5).
 *
 * Usage:
 *   node e2e-hil/report.mjs --run-dir <dir> [--review-dir <dir>] [--no-diff]
 *                           [--pw-code N] [--body-result ok|violation|unproven] [--stub]
 * Env fallbacks: HIL_RUN_DIR, HIL_ASSERTIONS, HIL_REVIEW_DIR, HIL_PW_CODE, HIL_BODY_RESULT.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
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
const stub = args.includes('--stub');
const pwCode = argOf('--pw-code') != null ? Number(argOf('--pw-code')) : process.env.HIL_PW_CODE != null ? Number(process.env.HIL_PW_CODE) : null;
const bodyResult = argOf('--body-result') ?? process.env.HIL_BODY_RESULT ?? null;

const readJson = (p, dflt = null) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : dflt);
const readLines = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const assertPath = process.env.HIL_ASSERTIONS ?? join(runDir, 'assertions.jsonl');
const runAt = new Date().toISOString();
const baseUrl = process.env.HIL_BASE ?? 'http://127.0.0.1:5173';

mkdirSync(reviewDir, { recursive: true });
mkdirSync(runDir, { recursive: true });

// ── stub mode: mark the report UNPROVEN at the START of a run ──
if (stub) {
  const s = {
    runAt, baseUrl, device: null, verdict: 'UNPROVEN', totals: { pass: 0, fail: 0, pending: 0, info: 0, warn: 0, weak: 0 },
    features: [], failClosed: ['run started — no verdict yet'], readOnly: { claim: 'net device state unchanged', result: 'unproven' }
  };
  const md = `# HIL UI verification — ${runAt}\n\n- Verdict: **UNPROVEN** (run started; no result yet)\n\n> This stub is overwritten when the run completes. A crashed run leaves UNPROVEN, never a stale GREEN.\n`;
  writeFileSync(join(reviewDir, 'ui-verification.json'), JSON.stringify(s, null, 2));
  writeFileSync(join(runDir, 'ui-verification.json'), JSON.stringify(s, null, 2));
  writeFileSync(join(reviewDir, 'ui-verification.md'), md);
  writeFileSync(join(runDir, 'ui-verification.md'), md);
  console.log(`stub written: UNPROVEN (${join(reviewDir, 'ui-verification.json')})`);
  process.exit(0);
}

const records = readLines(assertPath);
const manifest = readJson(join(runDir, 'manifest.json'), []);
const device = readJson(join(runDir, 'device.json'), null);
const proof = readJson(join(runDir, 'proof.json'), null);

const key = (r) => `${r.feature}|${r.control}|${r.kind}`;
const tally = (rs) => ({
  pass: rs.filter((r) => r.status === 'pass').length,
  fail: rs.filter((r) => r.status === 'fail').length,
  pending: rs.filter((r) => r.status === 'pending').length,
  warn: rs.filter((r) => r.status === 'warn').length,
  weak: rs.filter((r) => r.status === 'weak').length,
  info: rs.filter((r) => r.status === 'info').length
});

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

// Per-feature status (fail-closed).
const featureStatus = (f) => {
  const rs = f.results.filter((r) => r.status !== 'info');
  if (f.counts.fail) return 'fail';
  if (!f.implemented) return 'pending';
  if (rs.length === 0) return 'fail'; // implemented but nothing recorded — fail closed
  if (rs.every((r) => r.status === 'pending')) return 'pending';
  if (f.counts.warn || f.counts.weak) return 'warn';
  return 'pass';
};
const featureFails = features.filter((f) => featureStatus(f) === 'fail').length;

const totals = tally(records);

// Fail-closed cross-checks (each forces RED).
const failClosed = [];
if (pwCode != null && pwCode !== 0) failClosed.push(`playwright exited ${pwCode}`);
if (bodyResult != null && bodyResult !== 'ok') failClosed.push(`read-only proof: ${bodyResult}`);
if (!proof) failClosed.push('proof.json missing (read-only proof + provenance not recorded)');
else if (proof.ok !== true) failClosed.push(`proof.json ok=${proof.ok}`);
if (featureFails) failClosed.push(`${featureFails} implemented manifest feature(s) produced no non-info record`);

let verdict;
if (records.length === 0) verdict = 'EMPTY';
else if (totals.fail > 0 || failClosed.length) verdict = 'RED';
else if (totals.warn > 0 || totals.weak > 0 || features.some((f) => featureStatus(f) === 'pending')) verdict = 'AMBER';
else verdict = 'GREEN';

const report = {
  runAt,
  baseUrl,
  device: device?.stack ?? null,
  verdict,
  totals,
  failClosed,
  readOnly: {
    claim: 'net device state unchanged',
    result: bodyResult ?? (proof?.readOnly ?? 'unknown'),
    bodyHashBefore: proof?.bodyHashBefore ?? null,
    bodyHashAfter: proof?.bodyHashAfter ?? null,
    proof
  },
  provenance: proof?.provenance ?? null,
  features
};

const jsonPath = join(reviewDir, 'ui-verification.json');
const prevCopy = join(reviewDir, 'ui-verification.prev.json');
let baseline = null;
if (existsSync(jsonPath)) {
  baseline = readJson(jsonPath);
  copyFileSync(jsonPath, prevCopy);
}
writeFileSync(jsonPath, JSON.stringify(report, null, 2));
writeFileSync(join(runDir, 'ui-verification.json'), JSON.stringify(report, null, 2));

// ── markdown matrix ──
const icon = (s) => (s === 'pass' ? '✅' : s === 'fail' ? '❌' : s === 'pending' ? '⚠️' : s === 'warn' ? '🟡' : s === 'weak' ? '🟠' : 'ℹ️');
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
let md = `# HIL UI verification — ${runAt}\n\n`;
md += `- Base: \`${report.baseUrl}\`\n`;
md += `- Device: \`${device?.stack?.device?.model ?? 'n/a'}\` — ${device?.stack?.reason ?? 'n/a'}\n`;
md += `- Verdict: **${verdict}**  ·  pass ${totals.pass} · fail ${totals.fail} · warn ${totals.warn} · weak ${totals.weak} · pending ${totals.pending} · info ${totals.info}\n`;
md += `- READ-ONLY: **net device state unchanged** — ${esc(report.readOnly.result)}\n\n`;
if (proof?.provenance) {
  const p = proof.provenance;
  md += `## Provenance\n\n`;
  md += `- firmware: \`${esc(p.firmware?.version ?? 'n/a')}\` (\`${esc(p.firmware?.build ?? '')}\`)\n`;
  md += `- device-cache: key \`${esc(p.cache?.key ?? 'n/a')}\` builtAt \`${esc(p.cache?.builtAt ?? 'n/a')}\` source \`${esc(p.cache?.source ?? '')}\`\n`;
  md += `- preset: #${esc(p.preset?.number ?? '?')} \`${esc(p.preset?.name ?? '?')}\` crc \`${esc(p.preset?.crc ?? '?')}\`\n`;
  md += `- body sha256 (before/after): \`${esc(proof.bodyHashBefore ?? '')}\` / \`${esc(proof.bodyHashAfter ?? '')}\`\n`;
  md += `- commits: axis \`${esc(p.commits?.axis ?? 'n/a')}\` forgefx \`${esc(p.commits?.forgefx ?? 'n/a')}\` midi \`${esc(p.commits?.midi ?? 'n/a')}\`\n\n`;
}
if (failClosed.length) md += `## Fail-closed cross-checks\n\n${failClosed.map((x) => `- ${esc(x)}`).join('\n')}\n\n`;
md += `> Oracle = the payload the UI itself consumes, read through the app's own \`/api\` proxy (render-vs-wire) **plus** an independent decode of the device's RAW bytes with the STATIC range table (\`support/oracle.ts\`). The human-in-the-loop items (taper feel, layout, LEDs, the device's own formatted string) are NOT automated claims.\n\n`;

const KIND_ORDER = ['VALUE', 'NAME', 'VISIBILITY', 'PRESENCE'];
md += `## Matrix (feature × assertion kind — worst status per cell)\n\n`;
md += `| feature | ${KIND_ORDER.join(' | ')} |\n| --- | ${KIND_ORDER.map(() => '---').join(' | ')} |\n`;
const rank = { fail: 5, warn: 4, weak: 3, pending: 2, info: 1, pass: 0 };
const worst = (a, b) => (rank[a] >= rank[b] ? a : b);
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
  md += `### ${icon(featureStatus(f))} ${esc(f.feature)} — ${esc(f.title)}\n\n`;
  md += `_${esc(f.area)}_ · spec \`${esc(f.spec)}\`${f.implemented ? '' : ' · **NOT IMPLEMENTED (PENDING)**'}\n\n`;
  const rs = f.results.filter((r) => r.status !== 'info');
  if (!rs.length) {
    md += f.implemented ? `**❌ FAIL — implemented but recorded no assertion**\n\n` : `_no assertions recorded (not implemented)_\n\n`;
    continue;
  }
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
    const prevByKey = new Map((baseline.features ?? []).flatMap((f) => f.results.filter((r) => r.status !== 'info').map((r) => [key(r), r])));
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

console.log(`\nReport: ${jsonPath}\nMatrix: ${join(reviewDir, 'ui-verification.md')}\nVerdict: ${verdict} (pass ${totals.pass} / fail ${totals.fail} / warn ${totals.warn} / weak ${totals.weak} / pending ${totals.pending})`);
if (failClosed.length) console.log('Fail-closed: ' + failClosed.join('; '));
process.exit(verdict === 'RED' ? 1 : verdict === 'EMPTY' ? 5 : 0);
