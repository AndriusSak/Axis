/**
 * HIL global setup — refuse to run (and refuse to false-pass) when the stack or the device is absent,
 * and start the run's assertion log fresh.
 *
 * The shell entry point (`verify-ui-hardware.sh`) is the primary gate and gives the clean SKIP
 * (exit 3). This is the belt-and-braces guard for a DIRECT `npx playwright test --config
 * playwright.hil.config.ts`: Playwright has no clean "skip every test" hook, so we fail fast with a
 * distinct marker rather than let the specs boot against an empty device and pass vacuously.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { checkStack, skipMessage } from './support/stack';
import { assertionFile } from './support/hil';
import { MANIFEST } from './manifest';

export default async function globalSetup(): Promise<void> {
  const state = await checkStack();
  if (state.verdict !== 'up') {
    // Throwing fails the run (non-zero). The message is the SKIP line so the caller can tell the
    // difference between this and a red assertion.
    throw new Error(`HIL_SKIP: ${skipMessage(state)}`);
  }
  // Fresh assertion log for this run.
  const file = assertionFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '');
  // Stash the device evidence for the report step.
  const runDir = process.env.HIL_RUN_DIR;
  if (runDir) {
    mkdirSync(runDir, { recursive: true });
    writeFileSync(`${runDir}/device.json`, JSON.stringify({ stack: state, at: new Date().toISOString() }, null, 2));
    writeFileSync(`${runDir}/manifest.json`, JSON.stringify(MANIFEST, null, 2));
  }
  // eslint-disable-next-line no-console
  console.log(`[HIL] stack up · ${state.reason}`);
}
