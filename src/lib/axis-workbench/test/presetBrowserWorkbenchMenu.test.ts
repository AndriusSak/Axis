import { describe, expect, it, vi } from 'vitest';
import {
  AXIS_PB_NO_ERASE_REASON,
  AXIS_PB_NO_COPY_REASON,
  buildAxisPbMenuActions,
  toWorkbenchMenuItems,
  type AxisPbMenuEntry
} from '../presetBrowser/presetBrowserWorkbenchMenu';

function entry(over: Partial<AxisPbMenuEntry> = {}): AxisPbMenuEntry {
  return {
    id: 'dev:1',
    cloudOnly: false,
    deviceSlot: true,
    fav: false,
    syncState: 'none',
    ...over
  };
}

const CAPS = { canRename: true, cloudOn: false, canCopySlots: true };

describe('context menu building (§4.4)', () => {
  it('device slot signed out → Load + Audition + Rename + librarian + Convert + Favorite', () => {
    const actions = buildAxisPbMenuActions(entry(), CAPS);
    expect(actions.map((a) => a.id)).toEqual([
      'load',
      'audition',
      'rename',
      'duplicate',
      'swap',
      'move',
      'crossConvert',
      'favorite',
      'delete'
    ]);
    expect(actions[0].label).toBe('Load preset');
    expect(actions.find((a) => a.id === 'favorite')?.label).toBe('Add to favorites');
  });

  it('enables Duplicate/Swap when the device exposes the copy primitives', () => {
    const actions = buildAxisPbMenuActions(entry(), CAPS);
    const dup = actions.find((a) => a.id === 'duplicate');
    const swap = actions.find((a) => a.id === 'swap');
    expect(dup).toMatchObject({ label: 'Duplicate to slot…' });
    expect(swap).toMatchObject({ label: 'Swap with slot…' });
    expect(dup?.disabled).toBeUndefined();
    expect(swap?.disabled).toBeUndefined();
  });

  it('disables Duplicate/Swap (with the reason) when canCopySlots is false', () => {
    const actions = buildAxisPbMenuActions(entry(), { ...CAPS, canCopySlots: false });
    for (const id of ['duplicate', 'swap'] as const) {
      const item = actions.find((a) => a.id === id);
      expect(item?.disabled).toBe(true);
      expect(item?.reason).toBe(AXIS_PB_NO_COPY_REASON);
    }
  });

  it('renders Move as an honest disabled stub carrying the no-erase reason', () => {
    const actions = buildAxisPbMenuActions(entry(), CAPS);
    const move = actions.find((a) => a.id === 'move');
    expect(move).toMatchObject({ label: 'Move to slot…', disabled: true, reason: AXIS_PB_NO_ERASE_REASON });
  });

  it('renders Delete as an honest disabled, danger stub for device rows', () => {
    const actions = buildAxisPbMenuActions(entry(), CAPS);
    const del = actions.find((a) => a.id === 'delete');
    expect(del).toMatchObject({ label: 'Delete everywhere', disabled: true, danger: true, reason: AXIS_PB_NO_ERASE_REASON });
    expect(del?.separatorBefore).toBe(true);
  });

  it('omits Rename when the device cannot rename', () => {
    const actions = buildAxisPbMenuActions(entry(), { ...CAPS, canRename: false });
    expect(actions.map((a) => a.id)).toEqual([
      'load',
      'audition',
      'duplicate',
      'swap',
      'move',
      'crossConvert',
      'favorite',
      'delete'
    ]);
  });

  it('non-device rows (files) get Load + Convert + Favorite (no audition/rename/librarian)', () => {
    const actions = buildAxisPbMenuActions(entry({ deviceSlot: false }), CAPS);
    expect(actions.map((a) => a.id)).toEqual(['load', 'crossConvert', 'favorite']);
  });

  it('cloud-only rows load "from cloud" and skip audition/rename/librarian', () => {
    const actions = buildAxisPbMenuActions(
      entry({ cloudOnly: true, deviceSlot: false, syncState: 'cloudOnly' }),
      { ...CAPS, cloudOn: true }
    );
    expect(actions[0].label).toBe('Load from cloud');
    expect(actions.map((a) => a.id)).toContain('cloudDownload');
    expect(actions.map((a) => a.id)).not.toContain('audition');
    expect(actions.map((a) => a.id)).not.toContain('duplicate');
  });

  it('flips the favorite label for favourited rows', () => {
    const actions = buildAxisPbMenuActions(entry({ fav: true }), { ...CAPS, canRename: false });
    expect(actions.find((a) => a.id === 'favorite')?.label).toBe('Remove from favorites');
  });

  it('picks the cloud action label + direction by sync state (signed in)', () => {
    const cloudOf = (syncState: string) =>
      buildAxisPbMenuActions(entry({ syncState }), { ...CAPS, canRename: false, cloudOn: true }).find(
        (a) => a.id === 'cloudUpload' || a.id === 'cloudDownload'
      );
    expect(cloudOf('modified')).toMatchObject({ id: 'cloudUpload', label: 'Upload changes' });
    expect(cloudOf('outdated')).toMatchObject({ id: 'cloudDownload', label: 'Update from cloud' });
    expect(cloudOf('deviceOnly')).toMatchObject({ id: 'cloudUpload', label: 'Back up to cloud' });
    expect(cloudOf('synced')).toMatchObject({ id: 'cloudUpload', label: 'Re-upload to cloud' });
  });

  it('marks the cloud action with a separator so it sits below the core group', () => {
    const actions = buildAxisPbMenuActions(entry({ syncState: 'modified' }), { ...CAPS, cloudOn: true });
    expect(actions.find((a) => a.id === 'cloudUpload')?.separatorBefore).toBe(true);
  });

  it('saved conversions get a reduced menu: Open in converter + Favorite + Delete (no device actions)', () => {
    const actions = buildAxisPbMenuActions(
      entry({ id: 'conv:x', deviceSlot: false, converted: true }),
      { ...CAPS, cloudOn: true }
    );
    expect(actions.map((a) => a.id)).toEqual(['openConverter', 'favorite', 'deleteConverted']);
    expect(actions.map((a) => a.id)).not.toContain('load'); // not a device slot — no load-to-device
    expect(actions.map((a) => a.id)).not.toContain('crossConvert');
    expect(actions.find((a) => a.id === 'deleteConverted')?.danger).toBe(true);
  });

  it('adapts to WorkbenchMenuItems whose run dispatches the action id', () => {
    const actions = buildAxisPbMenuActions(entry(), CAPS);
    const dispatch = vi.fn();
    const items = toWorkbenchMenuItems(actions, dispatch);
    expect(items.map((i) => i.id)).toEqual(actions.map((a) => a.id));
    items.find((i) => i.id === 'load')?.run();
    expect(dispatch).toHaveBeenCalledWith('load');
  });

  it('carries disabled + reason onto the WorkbenchMenuItem title (honest stub tooltip)', () => {
    const actions = buildAxisPbMenuActions(entry(), CAPS);
    const items = toWorkbenchMenuItems(actions, vi.fn());
    const move = items.find((i) => i.id === 'move');
    expect(move?.disabled).toBe(true);
    expect(move?.title).toBe(AXIS_PB_NO_ERASE_REASON);
  });
});
