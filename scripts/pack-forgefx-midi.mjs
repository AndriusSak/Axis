#!/usr/bin/env node
// Materialise `forgefx-midi` for packaging, and put it back afterwards.
//
// WHY THIS EXISTS
// forgefx-midi is a sibling repo linked into two node_modules trees with a symlink, so edits to its
// source are picked up without reinstalling. Electron-builder stages the app into dist-desktop/ and
// runs 7za over it; the staged link points at a relative path that does not exist inside the staging
// tree, so 7za aborts with `errno=2 : No such file or directory` and the Windows build fails — after
// the whole bundle has been built. The earlier workaround was to swap the links for copies by hand,
// which is easy to forget and easy to leave behind.
//
// WHAT IT DOES
//   prepare  — replaces each symlink with a real directory holding the package's published files
//              (package.json, dist, LICENSE, NOTICE, README.md), remembering the link target in a
//              sibling marker file so it can be restored exactly.
//   restore  — deletes the copy and re-creates the original symlink from the marker.
//   status   — reports which shape each tree is in (for the release checklist / CI).
//
// It is idempotent in both directions and refuses to run if the package's dist/ is missing or empty
// (packaging a stale or empty package is worse than failing).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AXIS = path.resolve(HERE, '..');
const STACK = path.resolve(AXIS, '..');
const PKG = path.join(STACK, 'forgefx-midi');
const MARKER = '.forgefx-midi.link';

/** The two trees electron-builder walks: the app's own deps, and the bundled ForgeFX server's deps. */
const TARGETS = [
  path.join(AXIS, 'node_modules', 'forgefx-midi'),
  path.join(STACK, 'ForgeFX', 'server', 'node_modules', 'forgefx-midi')
];

const COPIED = ['package.json', 'dist', 'LICENSE', 'NOTICE', 'README.md'];

function requireDist() {
  const dist = path.join(PKG, 'dist');
  const ok = fs.existsSync(dist) && fs.statSync(dist).isDirectory() && fs.readdirSync(dist).length > 0;
  if (!ok) {
    console.error(`forgefx-midi/dist is missing or empty (${dist}). Run "npm run build" in ${PKG} first.`);
    process.exit(1);
  }
}

function prepareOne(target) {
  // The marker sits next to the target, inside node_modules: never packaged, never committed.
  const markerPath = `${target}.${MARKER}.json`;

  let st = null;
  try { st = fs.lstatSync(target); } catch { st = null; }

  if (st && st.isDirectory()) {
    if (fs.existsSync(markerPath)) {
      console.log(`already materialised: ${target}`);
      return 'already';
    }
    console.log(`left alone (real directory, not a link): ${target}`);
    return 'skipped';
  }

  if (st && st.isSymbolicLink()) {
    fs.writeFileSync(markerPath, JSON.stringify({ link: fs.readlinkSync(target) }, null, 2) + '\n');
    fs.unlinkSync(target);
  } else if (st) {
    throw new Error(`unexpected entry at ${target}`);
  } else {
    // Nothing there at all (fresh clone): record nothing, just materialise the package.
    console.log(`no entry at ${target} — materialising without a link to restore`);
  }

  fs.mkdirSync(target, { recursive: true });
  for (const name of COPIED) {
    const from = path.join(PKG, name);
    if (!fs.existsSync(from)) continue;
    fs.cpSync(from, path.join(target, name), { recursive: true });
  }
  console.log(`materialised: ${target}`);
  return 'prepared';
}

function restoreOne(target) {
  const markerPath = `${target}.${MARKER}.json`;
  if (!fs.existsSync(markerPath)) {
    console.log(`nothing to restore: ${target}`);
    return 'noop';
  }
  const { link } = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  fs.rmSync(target, { recursive: true, force: true });
  fs.symlinkSync(link, target);
  fs.unlinkSync(markerPath);
  console.log(`restored link: ${target} -> ${link}`);
  return 'restored';
}

function statusOne(target) {
  let st = null;
  try { st = fs.lstatSync(target); } catch { st = null; }
  const markerPath = `${target}.${MARKER}.json`;
  const shape = !st ? 'absent' : st.isSymbolicLink() ? `symlink -> ${fs.readlinkSync(target)}` : 'directory';
  console.log(`${shape.padEnd(34)} ${target}`);
  if (fs.existsSync(markerPath)) console.log(`  (marker present — "restore" will bring the link back)`);
}

const cmd = process.argv[2];
if (process.argv.includes('--help') || !cmd) {
  console.log('usage: pack-forgefx-midi.mjs prepare|restore|status');
  process.exit(cmd ? 0 : 2);
}

if (cmd === 'prepare') requireDist();

for (const t of TARGETS) {
  if (cmd === 'prepare') prepareOne(t);
  else if (cmd === 'restore') restoreOne(t);
  else if (cmd === 'status') statusOne(t);
  else { console.error(`unknown command: ${cmd}`); process.exit(2); }
}
