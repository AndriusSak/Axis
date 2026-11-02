// CPU-frame tap: keeps the last few fn 0x01 / sub 0x2E system-status replies so a CPU reading that
// disagrees with the unit's own panel can be diagnosed from the shipped app — no dev build, no capture
// rig. The CPU percentage is a float32 at decoded payload offset 12 (the payload is 7-bit MSB-first),
// so each sample carries both the decoded value and the raw frame it came from.
//
// Cost: one predicate per inbound frame; only matching frames are kept (at most CPU_FRAME_CAP).
// Access in a Direct-mode session's console:
//   __axisCpuFrames              → the raw samples (head/cpuPercent/hex)
//   __axisCpuReport()            → "these offsets differ between the stored samples", with values
//
// Note on `data`: forgefx-midi slices `data = frame[12:-2]`, so data byte N is frame byte N + 12.

import { parseCpuPercent } from 'forgefx-midi/gen3/axe-fx-iii';

const FN_PARAMETER = 0x01;
const SUB_SYSTEM_STATUS = 0x2e;
export const CPU_FRAME_CAP = 6;

export interface CpuFrameSample {
  /** ISO timestamp of arrival. */
  at: string;
  /** Whole-frame length (the parser requires >= 590). */
  len: number;
  /** Decoded CPU percentage (float32 at payload offset 12), or null if the frame did not decode. */
  cpuPercent: number | null;
  /** First 48 bytes — the header, where a model/function mismatch shows up. */
  head: string;
  /** Last 8 bytes — checksum + F7. */
  tail: string;
  /** The whole frame, so the CPU field can be located by diffing several samples. */
  hex: string;
}

const hex = (bytes: ArrayLike<number>): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

/** True for the frame the CPU parser consumes (same predicate as forgefx-midi's isCpuResponse). */
export function isCpuFrame(frame: readonly number[]): boolean {
  return frame[5] === FN_PARAMETER && frame[6] === SUB_SYSTEM_STATUS;
}

/** Append a sample for a matching frame; keeps the newest `CPU_FRAME_CAP`. Pure apart from `frames`. */
export function recordCpuFrame(frames: CpuFrameSample[], frame: readonly number[], at: Date = new Date()): void {
  if (!isCpuFrame(frame)) return;
  frames.push({
    at: at.toISOString(),
    len: frame.length,
    cpuPercent: parseCpuPercent(frame),
    head: hex(frame.slice(0, 48)),
    tail: hex(frame.slice(-8)),
    hex: hex(frame)
  });
  if (frames.length > CPU_FRAME_CAP) frames.splice(0, frames.length - CPU_FRAME_CAP);
}

/**
 * Offsets whose value is not identical in every stored frame. A field that carries the CPU load shows
 * up here as soon as a preset change moves it; a constant part of the frame does not.
 */
export function frameDiff(raws: readonly (readonly number[])[]): string {
  if (raws.length < 2) return `need at least 2 frames, have ${raws.length}`;
  const len = Math.min(...raws.map((r) => r.length));
  const lines: string[] = [];
  for (let i = 0; i < len; i++) {
    const first = raws[0][i];
    if (raws.every((r) => r[i] === first)) continue;
    // frame[i] with the data-byte index forgefx-midi would call it
    lines.push(`frame ${i} (data ${i - 12}): ${raws.map((r) => r[i]).join(' ')}`);
  }
  return lines.length ? lines.join('\n') : 'no offset differs — all stored frames are identical';
}

/**
 * Every distinct (fn, sub, length) seen, with a count. A value the app never asks for — a CPU push, for
 * instance — shows up here as a frame kind nobody parses.
 */
export function frameKinds(kinds: Map<string, number>): string {
  if (!kinds.size) return 'no frames recorded yet';
  return [...kinds.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}  x${n}`)
    .join('\n');
}

/** Install the tap on a transport; returns the unsubscribe fn. Exposes `__axisCpuFrames`/`__axisCpuReport`. */
export function installCpuFrameTap(
  transport: { onFrame(handler: (frame: number[]) => void): () => void },
  target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>
): () => void {
  const frames: CpuFrameSample[] = [];
  const raws: number[][] = [];
  const kinds = new Map<string, number>();
  target.__axisCpuFrames = frames;
  target.__axisCpuReport = () => frameDiff(raws);
  target.__axisFrameKinds = () => frameKinds(kinds);
  return transport.onFrame((frame) => {
    const key = `fn ${(frame[5] ?? 0).toString(16)} sub ${(frame[6] ?? 0).toString(16)} len ${frame.length}`;
    kinds.set(key, (kinds.get(key) ?? 0) + 1);
    if (!isCpuFrame(frame)) return;
    recordCpuFrame(frames, frame);
    raws.push([...frame]);
    if (raws.length > CPU_FRAME_CAP) raws.splice(0, raws.length - CPU_FRAME_CAP);
  });
}
