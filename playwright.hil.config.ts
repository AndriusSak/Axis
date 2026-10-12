import { defineConfig } from '@playwright/test';

/**
 * HIL (hardware-in-the-loop) Playwright project — Layer 3 of the UI-verification stack.
 *
 * READ-ONLY GUARANTEE: this layer drives a LIVE instrument and may send ONLY a CDP
 * `Input.dispatchMouseEvent` of `type:'mouseMoved', button:'none', buttons:0` (hover) — never a press,
 * never a drag, and never a state-changing control. The guarantee is enforced in code by
 * `e2e-hil/support/input-guard.ts` (the sole dispatch site; it THROWS on press/drag) and re-checked
 * against the harness source by `e2e-hil/specs/00-readonly-guard.spec.ts`. The runtime proof is the
 * byte-identical pre/post edit-buffer body dump in `../verify-ui-hardware.sh`.
 *
 * This config is SEPARATE from `playwright.config.ts` (the mocked e2e suite) so neither breaks the
 * other and neither runs the other's tests:
 *   - testDir is `./e2e-hil/specs` (the mocked suite is `./e2e`).
 *   - there is NO `webServer` block: the runner targets the ALREADY-RUNNING stack. Starting a server
 *     here would either double-bind ports or replace the real one — both forbidden. The stack is
 *     started out-of-band (ForgeFX :5056 holding the serial port, vite dev :5173 with the DEV spelling).
 *   - it does NOT mock /api: every device read goes through the app's own proxy to the real unit.
 *
 * `reuseExistingServer` semantics do not apply (no server is launched). The gate is the shell entry
 * point `~/repos/stack/verify-ui-hardware.sh`, which checks healthz 200 AND a device, then runs:
 *     npx playwright test --config playwright.hil.config.ts
 *
 * Env:
 *   HIL_BASE        base URL of the live SPA (default http://127.0.0.1:5173)
 *   HIL_ASSERTIONS  JSONL path the specs append assertion records to
 *   HIL_RUN_DIR     directory for this run's artifacts (device.json, report inputs)
 */
const BASE = process.env.HIL_BASE ?? 'http://127.0.0.1:5173';

export default defineConfig({
  testDir: './e2e-hil/specs',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: './e2e-hil/global-setup.ts',
  use: {
    baseURL: BASE,
    // The 1280x800 (Steam Deck) profile is where the block-pane visibility defect shows.
    viewport: { width: 1280, height: 800 },
    actionTimeout: 12_000,
    trace: 'retain-on-failure'
  },
  projects: [
    {
      name: 'hil-chromium',
      use: { browserName: 'chromium' }
    }
  ]
});
