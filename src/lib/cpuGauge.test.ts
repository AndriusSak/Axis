import { describe, it, expect } from 'vitest';
import { cpuLevel, cpuColor, cpuTitle, CPU_WARN_PCT, CPU_MUTE_PCT } from './cpuGauge';

describe('cpuGauge — thresholds come from FM3-Edit 1.07.17', () => {
  it('pins the device thresholds', () => {
    expect(CPU_WARN_PCT).toBe(85);
    expect(CPU_MUTE_PCT).toBe(100);
  });

  it('classifies around 85 %', () => {
    expect(cpuLevel(84.9)).toBe('ok');
    expect(cpuLevel(85)).toBe('warn');
    expect(cpuLevel(99.9)).toBe('warn');
  });

  it('classifies at and over 100 % as muted — the unit silences audio there', () => {
    expect(cpuLevel(100)).toBe('muted');
    expect(cpuLevel(112.5)).toBe('muted');
  });

  it('treats a missing reading as unknown, never as 0 %', () => {
    expect(cpuLevel(null)).toBe('unknown');
    expect(cpuLevel(undefined)).toBe('unknown');
    expect(cpuLevel(Number.NaN)).toBe('unknown');
    expect(cpuColor(null)).toBe('#56565e');
  });

  it('colours: green under 85, amber to 99.9, red at 100', () => {
    expect(cpuColor(30)).toBe('#33c46b');
    expect(cpuColor(85)).toBe('#f5a623');
    expect(cpuColor(100)).toBe('#d6543f');
  });

  it('tooltip states the consequence, so the colour is not a guess', () => {
    expect(cpuTitle(100)).toMatch(/mutes audio/);
    expect(cpuTitle(90)).toMatch(/85 %/);
    expect(cpuTitle(10)).not.toMatch(/mutes audio|85 %/);
  });
});
