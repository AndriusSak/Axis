import { describe, it, expect } from 'vitest';
import { buildParamValueMenuItems } from './paramClipMenu';

// The parameter-value items added to the EXISTING control context menu (parity audit §2.11). Pure
// builder so the shapes are pinned without mounting ControlSurface.svelte (node-env vitest).

describe('buildParamValueMenuItems', () => {
  it('offers Copy always and Paste once a value is copied', () => {
    let copied = 0;
    let pasted = 0;
    const items = buildParamValueMenuItems({ label: 'Drive', kind: 'cont' }, { hasClip: true, clipName: 'Drive' }, () => copied++, () => pasted++);
    expect(items.map((i) => i.id)).toEqual(['param.copyValue', 'param.pasteValue']);
    expect(items[0].label).toContain('Drive');
    expect(items[1].label).toContain('Drive');
    expect(items[1].disabled).toBe(false);
    expect(items[1].separatorBefore).toBe(true);
    items[0].run();
    items[1].run();
    expect([copied, pasted]).toEqual([1, 1]);
  });

  it('disables Paste when nothing has been copied, with an honest title', () => {
    const items = buildParamValueMenuItems({ label: 'Level', kind: 'cont' }, { hasClip: false, clipName: null }, () => {}, () => {});
    expect(items[1].label).toBe('Paste value');
    expect(items[1].disabled).toBe(true);
    expect(items[1].title).toMatch(/No parameter value copied/i);
  });

  it('labels a discrete control copy as an ordinal (not a knob norm)', () => {
    const [copy] = buildParamValueMenuItems({ label: 'Model', kind: 'select' }, { hasClip: false, clipName: null }, () => {}, () => {});
    expect(copy.title).toMatch(/ordinal/i);
  });
});
