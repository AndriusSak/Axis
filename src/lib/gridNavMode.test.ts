import { describe, it, expect } from 'vitest';
import {
  shouldFetchOnGridAction,
  GRID_NAV_PARAM_REFUSAL,
  type GridNavDecision,
  type GridNavAction,
  type GridNavMode,
} from './gridNavMode';

describe('grid navigation mode — shouldFetchOnGridAction policy (audit §2.9)', () => {
  const actions: readonly GridNavAction[] = ['select', 'navigate', 'place', 'route', 'openEditor', 'paramEdit'];
  const modes: readonly GridNavMode[] = ['normal', 'gridNav'];

  it('the EXPLICIT open action always fetches, in both modes', () => {
    expect(shouldFetchOnGridAction('normal', 'openEditor')).toEqual({ kind: 'fetch' });
    expect(shouldFetchOnGridAction('gridNav', 'openEditor')).toEqual({ kind: 'fetch' });
  });

  it('normal mode: selecting a block auto-fetches its params (today’s tap → openCell behavior)', () => {
    expect(shouldFetchOnGridAction('normal', 'select')).toEqual({ kind: 'fetch' });
  });

  it('normal mode: every other grid action never fetched (they work on the held layout)', () => {
    for (const action of ['navigate', 'place', 'route', 'paramEdit'] as readonly GridNavAction[]) {
      expect(shouldFetchOnGridAction('normal', action), `normal/${action}`).toEqual({ kind: 'skip' });
    }
  });

  it('grid nav mode: the fast grid ops skip the per-block parameter fetch', () => {
    for (const action of ['select', 'navigate', 'place', 'route'] as readonly GridNavAction[]) {
      expect(shouldFetchOnGridAction('gridNav', action), `gridNav/${action}`).toEqual({ kind: 'skip' });
    }
  });

  it('grid nav mode: in-place param editing is refused with the named reason (no silent staleness)', () => {
    for (const action of ['paramEdit'] as readonly GridNavAction[]) {
      const d = shouldFetchOnGridAction('gridNav', action);
      expect(d.kind, `gridNav/${action}`).toBe('refuse');
      if (d.kind === 'refuse') expect(d.reason).toBe(GRID_NAV_PARAM_REFUSAL);
    }
  });

  it('the refusal reason names the mode and the fix — a user can act on it', () => {
    const d = shouldFetchOnGridAction('gridNav', 'paramEdit') as Extract<GridNavDecision, { kind: 'refuse' }>;
    expect(d.kind).toBe('refuse');
    expect(d.reason).toMatch(/Grid Navigation Mode/);
    expect(d.reason).toMatch(/open the block/i);
    expect(GRID_NAV_PARAM_REFUSAL).toBe(d.reason);
  });

  it('the decision is total: every mode × action combination resolves', () => {
    for (const mode of modes)
      for (const action of actions) {
        const d = shouldFetchOnGridAction(mode, action);
        expect(['fetch', 'skip', 'refuse'], `${mode}/${action}`).toContain(d.kind);
        if (d.kind === 'refuse') expect(d.reason).toBeTruthy();
      }
  });
});