import { describe, expect, it } from 'vitest';
import { CPU_FRAME_CAP, frameDiff, frameKinds, installCpuFrameTap, isCpuFrame, recordCpuFrame, type CpuFrameSample } from './cpuFrameTap';

/**
 * A synthetic status reply: F0 00 01 74 11 01 2E … F7.
 *
 * The payload is 7-bit MSB-first packed, and the CPU is a float32 at decoded offset 12 — so the
 * helper builds the decoded payload first, then packs it, exactly like the device does.
 */
function statusFrame(cpuPercent = 22): number[] {
  const payload = new Uint8Array(496);
  new DataView(payload.buffer).setFloat32(12, cpuPercent, true);
  const septets: number[] = [];
  let bits = 0;
  let n = 0;
  for (const b of payload) {
    bits = (bits << 8) | b;
    n += 8;
    while (n >= 7) {
      n -= 7;
      septets.push((bits >>> n) & 0x7f);
    }
  }
  if (n > 0) septets.push((bits << (7 - n)) & 0x7f); // flush the final partial septet
  const f = new Array<number>(21 + septets.length + 2).fill(0);
  f[0] = 0xf0;
  f[1] = 0x00;
  f[2] = 0x01;
  f[3] = 0x74;
  f[4] = 0x11;
  f[5] = 0x01;
  f[6] = 0x2e;
  septets.forEach((s, i) => (f[21 + i] = s));
  f[f.length - 1] = 0xf7;
  return f;
}

describe('CPU frame tap', () => {
  it('matches only fn 0x01 / sub 0x2E frames', () => {
    expect(isCpuFrame(statusFrame())).toBe(true);
    const meter = statusFrame();
    meter[6] = 0x19; // leveling meter reply
    expect(isCpuFrame(meter)).toBe(false);
  });

  it('records the length and the decoded CPU percentage', () => {
    const frames: CpuFrameSample[] = [];
    recordCpuFrame(frames, statusFrame(75), new Date('2026-11-02T13:00:00Z'));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ len: 590, cpuPercent: 75, at: '2026-11-02T13:00:00.000Z' });
    expect(frames[0].head.startsWith('f0 00 01 74 11 01 2e')).toBe(true);
    expect(frames[0].tail.endsWith('f7')).toBe(true);
  });

  it('keeps only the newest samples and ignores unrelated frames', () => {
    const frames: CpuFrameSample[] = [];
    for (let i = 0; i < CPU_FRAME_CAP + 3; i++) recordCpuFrame(frames, statusFrame(i));
    expect(frames).toHaveLength(CPU_FRAME_CAP);
    expect(frames.at(-1)?.cpuPercent).toBe(CPU_FRAME_CAP + 2);
    const before = frames.length;
    const other = statusFrame();
    other[6] = 0x19;
    recordCpuFrame(frames, other);
    expect(frames).toHaveLength(before);
  });

  it('reports only the offsets that differ, labelled with their data index', () => {
    const a = statusFrame(22);
    const b = statusFrame(71);
    const report = frameDiff([a, b]);
    expect(report).toContain('frame ');
    expect(report).toContain('(data ');
    expect(frameDiff([a])).toContain('need at least 2 frames');
    expect(frameDiff([a, a])).toContain('no offset differs');
  });

  it('counts every frame kind, parsed or not', () => {
    let handler: ((f: number[]) => void) | null = null;
    const target: Record<string, unknown> = {};
    installCpuFrameTap({ onFrame: (h) => { handler = h; return () => { handler = null; }; } }, target);
    const meter = statusFrame();
    meter[6] = 0x19;
    handler!(meter);
    handler!(statusFrame(22));
    const kinds = (target.__axisFrameKinds as () => string)();
    expect(kinds).toContain('fn 1 sub 19 len 590  x1');
    expect(kinds).toContain('fn 1 sub 2e len 590  x1');
    expect(frameKinds(new Map())).toContain('no frames recorded');
  });

  it('installs on a transport and exposes the samples', () => {
    let handler: ((f: number[]) => void) | null = null;
    const target: Record<string, unknown> = {};
    installCpuFrameTap({ onFrame: (h) => { handler = h; return () => { handler = null; }; } }, target);
    handler!(statusFrame(22));
    expect((target.__axisCpuFrames as CpuFrameSample[])[0].cpuPercent).toBe(22);
  });
});
