// CPU gauge thresholds — taken from FM3-Edit's own warning text (1.07.17), not invented:
//   85 %  — "CPU usage for this preset is approaching the limit of 85 %. …the unit may become sluggish"
//   100 % — "CPU usage for this preset exceeds 100 % … The audio will remain muted until blocks are removed
//            or reconfigured."
// The device therefore has exactly two states worth flagging, and a bar that goes amber at some arbitrary
// 62 % is lying about the hardware's own behaviour.

export const CPU_WARN_PCT = 85;
export const CPU_MUTE_PCT = 100;

export type CpuLevel = 'unknown' | 'ok' | 'warn' | 'muted';

export function cpuLevel(pct: number | null | undefined): CpuLevel {
  if (pct == null || !Number.isFinite(pct)) return 'unknown';
  if (pct >= CPU_MUTE_PCT) return 'muted';
  if (pct >= CPU_WARN_PCT) return 'warn';
  return 'ok';
}

export function cpuColor(pct: number | null | undefined): string {
  switch (cpuLevel(pct)) {
    case 'muted':
      return '#d6543f';
    case 'warn':
      return '#f5a623';
    case 'ok':
      return '#33c46b';
    default:
      return '#56565e';
  }
}

/** Tooltip text: states what the device does at each threshold, so the colour is never a guess. */
export function cpuTitle(pct: number | null | undefined): string {
  const base = 'Live CPU load (decoded from the device meters frame)';
  switch (cpuLevel(pct)) {
    case 'muted':
      return `${base} — at or over 100 % the FM3 mutes audio until blocks are removed or reconfigured`;
    case 'warn':
      return `${base} — approaching the FM3's 85 % limit; the unit and this editor can become sluggish`;
    default:
      return base;
  }
}
