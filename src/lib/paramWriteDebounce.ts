// Debounce timers for continuous param writes, keyed by BLOCK + param (`eid:pid`).
//
// A continuous knob streams at high frequency, so the editor coalesces a gesture's writes into one
// send on a short timer. Keying that timer by the PARAM ID alone was a data-loss bug: a write to pid N
// on block X was cancelled by a write to pid N on another block within the debounce window, so one of
// the two writes was silently dropped. The key is the block+param pair.
//
// Framework-free (no runes / DOM) so it is unit-tested directly; `editor.svelte.ts` is the only caller.

/** The debounce key for a param write: block effectId + paramId, so two blocks never share a slot. */
export function paramWriteKey(effectId: number, paramId: number): string {
  return `${effectId}:${paramId}`;
}

/** Per-(block,param) trailing-edge debounce. A later schedule on the same key replaces the pending
 *  one; a schedule on a different key is fully independent. */
export class ParamWriteDebouncer {
  #timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Schedule `run` after `delayMs`, replacing any pending run for this (block,param). */
  schedule(effectId: number, paramId: number, delayMs: number, run: () => void): void {
    const key = paramWriteKey(effectId, paramId);
    const cur = this.#timers.get(key);
    if (cur != null) clearTimeout(cur);
    this.#timers.set(
      key,
      setTimeout(() => {
        this.#timers.delete(key);
        run();
      }, delayMs)
    );
  }

  /** Drop any pending run for this (block,param). */
  cancel(effectId: number, paramId: number): void {
    const key = paramWriteKey(effectId, paramId);
    const cur = this.#timers.get(key);
    if (cur != null) {
      clearTimeout(cur);
      this.#timers.delete(key);
    }
  }
}
