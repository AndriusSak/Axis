// Client-side decision for a `/preset/scene-state` response (the lightweight scene refresh path).
//
// The store (`editor.svelte.ts` `#refreshScene`) re-applies per-block bypass/channel onto the cached
// grid from this response, falling back to a full `load()` when it isn't usable. Extraction into a
// plain module keeps the rule unit-testable (the runes store cannot be loaded in node-env vitest).

export interface SceneStateBlock {
  effectId: number;
  bypassed: boolean | null;
  channel: string | null;
}

/** Whether a scene-state response can actually be applied. An empty array is NOT usable: a real preset
 *  always has at least the Output blocks, so `[]` means the server-side status read failed and returned
 *  nothing — applying it would silently leave the previous scene's bypass/channel on screen. */
export function isSceneStateUsable(st: unknown): st is SceneStateBlock[] {
  return Array.isArray(st) && st.length > 0;
}
