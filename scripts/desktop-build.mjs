#!/usr/bin/env node
// One packaging entry point: materialise forgefx-midi, build the UI for the desktop shell, run
// electron-builder for the asked targets, and ALWAYS put the symlinks back — even when the build
// fails. Chaining this in package.json with && leaves the tree materialised on a failed build, which
// is exactly the state that later confuses a dev run ("why is my change to forgefx-midi ignored?").
//
//   node scripts/desktop-build.mjs linux|win|mac|host [extra electron-builder args…]
//
// The UI build here is the DESKTOP one (relative asset paths, no VITE_AXIS_REMOTE). The live web
// bundle is a different build — see the deploy recipe — and must not be replaced by this one.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AXIS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ?? 'host';
const extra = process.argv.slice(3);

const ARGS = {
  linux: ['--linux', 'AppImage'],
  win: ['--win', 'nsis'],
  mac: ['--mac', 'zip', '--x64', '--arm64'],
  host: []
};

if (!(target in ARGS)) {
  console.error(`unknown target "${target}" — use linux, win, mac or host`);
  process.exit(2);
}

const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { cwd: AXIS, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}`);
};

let failed = null;
try {
  run('node', ['scripts/pack-forgefx-midi.mjs', 'prepare']);
  // Relative asset paths for the packaged shell; no remote flag, or the SPA would expect a server.
  run('npx', ['vite', 'build'], { VITE_FORGEFX_BASE: '' });
  run('npx', ['electron-builder', ...ARGS[target], '--publish', 'never', ...extra]);
} catch (e) {
  failed = e;
} finally {
  const r = spawnSync('node', ['scripts/pack-forgefx-midi.mjs', 'restore'], { cwd: AXIS, stdio: 'inherit' });
  if (r.status !== 0 && !failed) failed = new Error('restore failed — check the symlinks by hand');
}

if (failed) {
  console.error(`\nbuild failed: ${failed.message}`);
  process.exit(1);
}
console.log(`\nbuilt (${target}); forgefx-midi symlinks restored`);
