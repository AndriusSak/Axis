/**
 * HIL stack gate — is the live stack up AND is a device ACTUALLY attached (not merely cached)?
 *
 * The HIL suite compares what the app RENDERS against what a LIVE ForgeFX server SERVES from a real
 * device. It must never run against a mocked backend and never false-pass when no device is present:
 * with no device the app renders its offline state and every device-derived assertion would be
 * meaningless (or vacuously green).
 *
 * FIX (2026-10-12): `/api/device` returns a CACHED device profile carrying a `model` name even when no
 * physical unit is attached (`/dev/ttyACM0` absent, the serial port unowned), so a `typeof model ===
 * 'string'` check false-passes. The gate now requires the LIVE probe `/api/device/detect` to report
 * `connected === true` (or a non-null firmware on `/api/device`); a cached profile alone is 'no-device'.
 *
 * The check is two questions, both answered through the VITE DEV PROXY (so it also proves vite is up):
 *   1. `GET <base>/api/healthz` → 200 (the stack is UP).
 *   2. `GET <base>/api/device/detect` → `connected === true` (a DEVICE is on the wire).
 *
 * Verdicts: 'up' | 'no-device' | 'down'. The shell entry point turns 'no-device' into a distinct
 * non-zero SKIP exit so a missing unit is never reported as a pass or as a test failure.
 */

export type StackVerdict = 'up' | 'no-device' | 'down';

export interface StackState {
  verdict: StackVerdict;
  base: string;
  healthz?: unknown;
  device?: unknown;
  detect?: unknown;
  reason: string;
}

const DEFAULT_BASE = 'http://127.0.0.1:5173';

const getJson = async (url: string): Promise<any> => {
  const r = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(4000) });
  return r.status === 200 ? await r.json() : { __httpStatus: r.status };
};

/** Read the healthz + live-detect payloads through the dev proxy. Node-18 global fetch. */
export async function checkStack(base = process.env.HIL_BASE ?? DEFAULT_BASE): Promise<StackState> {
  let healthz: any = null;
  try {
    healthz = await getJson(`${base}/api/healthz`);
    if (!healthz || healthz.__httpStatus || healthz.ok !== true) {
      return { verdict: 'down', base, healthz, reason: `healthz not ok (${JSON.stringify(healthz).slice(0, 80)})` };
    }
  } catch (e) {
    return { verdict: 'down', base, reason: `stack unreachable at ${base} (${(e as Error).message})` };
  }

  // The LIVE probe: `/device/detect` actually talks to the serial port. A cached `/device` profile is
  // NOT evidence of a unit on the wire.
  let detect: any = null;
  let device: any = null;
  try {
    detect = await getJson(`${base}/api/device/detect`);
    device = await getJson(`${base}/api/device`);
  } catch (e) {
    return { verdict: 'no-device', base, healthz, reason: `device probe unreachable (${(e as Error).message})` };
  }

  // MEASURED: `/api/device` carries a cached `firmware.version` ("13.0") even with no unit on the wire,
  // so firmware alone is NOT a device test. Only the LIVE probe `/device/detect` distinguishes it.
  const firmware = device?.firmware?.version ?? null;
  const connected = detect?.connected === true;
  if (!connected) {
    return {
      verdict: 'no-device',
      base,
      healthz,
      device,
      detect,
      reason: `no device on the wire (/device/detect connected=${detect?.connected}; cached model=${device?.model ?? 'none'})`
    };
  }
  return { verdict: 'up', base, healthz, device, detect, reason: `device: ${detect?.name ?? device?.model ?? 'unknown'} (fw ${firmware ?? '?'})` };
}

/** The human-readable SKIP line (stdout of the shell entry point when no unit is attached). */
export function skipMessage(state: StackState): string {
  return [
    'HIL-UI SKIP: no device attached — nothing was compared against hardware.',
    `  reason : ${state.reason}`,
    `  base   : ${state.base}`,
    '  The HIL UI harness (verify-ui-hardware.sh) only runs against a LIVE ForgeFX server holding a',
    '  real device. Start the stack with an FM3/FM9/Axe-Fx III attached, then re-run.',
    '  (exit 3 = SKIPPED, distinct from 1 = a red assertion and 2 = the stack is down)'
  ].join('\n');
}
