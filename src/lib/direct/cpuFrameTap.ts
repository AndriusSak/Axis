// CPU-frame tap: keeps the last few fn 0x01 / sub 0x2E system-status replies so a CPU reading that
// disagrees with the unit's own panel can be diagnosed from the shipped app — no dev build, no capture
// rig. The CPU percentage is ONE byte (offset 37) of that frame, so the frame itself is the evidence.
//
// Cost: one predicate per inbound frame, and only matching frames are copied (at most SAMPLE_CAP).
// Access: `window.__axisCpuFrames` in the browser console of a Direct-mode session.

const FN_PARAMETER = 0x01;
const SUB_SYSTEM_STATUS = 0x2e;
export const CPU_FRAME_CAP = 6;

export interface CpuFrameSample {
  /** ISO timestamp of arrival. */
  at: string;
  /** Whole-frame length (the parser requires >= 590). */
  len: number;
  /** The byte the app calls CPU%. */
  byte37: number;
  /** First 48 bytes — the header, where a model/function mismatch shows up. */
  head: string;
  /** Last 8 bytes — checksum + F7. */
  tail: string;
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
    byte37: frame[37] ?? -1,
    head: hex(frame.slice(0, 48)),
    tail: hex(frame.slice(-8))
  });
  if (frames.length > CPU_FRAME_CAP) frames.splice(0, frames.length - CPU_FRAME_CAP);
}

/** Install the tap on a transport; returns the unsubscribe fn. Exposes `target.__axisCpuFrames`. */
export function installCpuFrameTap(
  transport: { onFrame(handler: (frame: number[]) => void): () => void },
  target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>
): () => void {
  const frames: CpuFrameSample[] = [];
  target.__axisCpuFrames = frames;
  return transport.onFrame((frame) => recordCpuFrame(frames, frame));
}
