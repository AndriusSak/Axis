/**
 * HIL stack gate — is the live stack up AND is a device actually attached?
 *
 * The HIL suite compares what the app RENDERS against what a LIVE ForgeFX server SERVES from a real
 * device. It must never run against a mocked backend and never false-pass when no device is present:
 * with no device the app renders its offline state and every device-derived assertion would be
 * meaningless (or vacuously green).
 *
 * The check is two questions, both answered through the VITE DEV PROXY (so it also proves vite is up):
 *   1. `GET <base>/api/healthz` → 200 with `{ ok: true }`   → the stack is UP.
 *   2. `GET <base>/api/device`  → a connected device       → a DEVICE is attached.
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
  reason: string;
}

const DEFAULT_BASE = 'http://127.0.0.1:5173';

/** Read the healthz + device payloads through the dev proxy. Node-18 global fetch. */
export async function checkStack(base = process.env.HIL_BASE ?? DEFAULT_BASE): Promise<StackState> {
  let healthz: any = null;
  try {
    const r = await fetch(`${base}/api/healthz`, { signal: AbortSignal.timeout(4000) });
    if (r.status !== 200) return { verdict: 'down', base, reason: `healthz HTTP ${r.status}` };
    healthz = await r.json();
    if (!healthz || healthz.ok !== true) return { verdict: 'down', base, healthz, reason: 'healthz not ok' };
  } catch (e) {
    return { verdict: 'down', base, reason: `stack unreachable at ${base} (${(e as Error).message})` };
  }

  let device: any = null;
  try {
    const r = await fetch(`${base}/api/device`, { signal: AbortSignal.timeout(4000) });
    device = r.status === 200 ? await r.json() : null;
  } catch (e) {
    return { verdict: 'no-device', base, healthz, reason: `/api/device unreachable (${(e as Error).message})` };
  }

  const connected = !!device && (device.connected === true || (typeof device.model === 'string' && device.model.length > 0));
  if (!connected) {
    return { verdict: 'no-device', base, healthz, device, reason: 'no device attached (/api/device reports none)' };
  }
  return { verdict: 'up', base, healthz, device, reason: `device: ${device.model ?? device.name ?? 'unknown'}` };
}

/** The human-readable SKIP line (stdout of the shell entry point when no unit is attached). */
export function skipMessage(state: StackState): string {
  return [
    'HIL-UI SKIP: no device attached — nothing was compared against hardware.',
    `  reason : ${state.reason}`,
    `  base   : ${state.base}`,
    '  The HIL UI harness (verify-ui-hardware.sh) only runs against a LIVE ForgeFX server holding a',
    '  real device. Start the stack with an FM3/FM9/Axe-Fx III attached, then re-run.',
    '  (exit 3 = SKIPPED, distinct from 1 = a red assertion and 2 = the stack is down)',
  ].join('\n');
}
