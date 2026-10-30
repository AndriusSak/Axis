<script lang="ts">
  // Manage Cabs — a browsable, multi-select manager for the 512 user cab slots (FM3-Edit's "Manage Cabs").
  //
  // Everything it can do is built on measured primitives, and everything it cannot do says why:
  //   • the grid is the unit's own per-slot STATE (populated / empty) from GET /cab/slots, one 128-slot bank
  //     per request (the server's sweep cap — disclosed below the tabs). Slot NAMES are never read off the
  //     unit here; the only names shown are those of IRs Axis itself uploaded (the server-side library);
  //   • clear = the blank container, move = re-upload from the library then blank the source, restore =
  //     re-upload a library entry, rename = rewrite the name in a container Axis HOLDS and re-upload it;
  //   • there is NO slot-data read, so rename/move of an IR Axis does not hold is a disabled control with
  //     that reason (move falls back to importing the file) — never a fake;
  //   • every upload is judged by the unit's own answer: the close code (0x13 = DISCARDED) AND the slot-state
  //     read-back — never "uploaded" from the frame acks alone.
  // Decisions live in cabManagerOps.ts / cabImport.ts (unit-tested); this component renders them.
  import { editor } from './editor.svelte';
  import { forgefx } from './forgefx';
  import type { CabLibraryListEntry, CabLibraryListResult, CabSlotStateResult } from './types';
  import {
    CAB_BANKS,
    CAB_CONVERSION_UNVALIDATED_BADGE,
    CAB_GRID_DISCLOSURE,
    CAB_LIBRARY_SCOPE_FALLBACK,
    CAB_USER_SLOTS,
    bankCoverage,
    buildBankGrid,
    destStateOf,
    destWarning,
    isUserSlot,
    manageActions,
    planClear,
    planMove,
    rangeSelection,
    runClear,
    runMove,
    runRename,
    toggleSelection,
    uploadAndVerify,
    validateCabName,
    waveformPoints,
    type CabManagerIo,
    type GridSlot
  } from './cabManagerOps';
  import {
    CAB_IR_OUTPUT_FORMATS,
    DEFAULT_IMPORT_OPTIONS,
    IMPORT_OPTION_HELP,
    rewriteName,
    stageImport,
    type ImportOptions,
    type StagedImport
  } from './cabImport';

  const deviceReady = $derived(!!editor.caps?.cabIrs);
  const deviceReason = $derived(
    editor.caps
      ? 'This device does not serve user-cab IR upload (caps.cabIrs is off).'
      : 'No device is connected — connect a unit to manage its cabs.'
  );

  let bankIdx = $state(0);
  /** rows per bank index, from GET /cab/slots (null = not scanned). */
  let bankRows = $state<Record<number, CabSlotStateResult[] | null>>({});
  let scanning = $state(false);
  let scanMsg = $state('');
  let library = $state<CabLibraryListResult | null>(null);
  let libraryErr = $state('');
  let selection = $state<number[]>([]);
  let lastClicked = $state<number | null>(null);
  let mode = $state<'clear' | 'move' | 'rename' | 'import' | null>(null);
  let confirmed = $state(false);
  let busy = $state(false);
  let log = $state<{ ok: boolean; text: string }[]>([]);
  let importOpts = $state<ImportOptions>({ ...DEFAULT_IMPORT_OPTIONS });
  let importDest = $state(1);
  let staged = $state<StagedImport | null>(null);
  let stagedBytes = $state<Uint8Array | null>(null);
  let ackUnvalidated = $state(false);
  let stagedName = $state('');
  let renameTo = $state('');
  /** #9: Restore is destructive (it writes to a slot that may already hold an IR) — it needs a per-entry
   *  confirm like every other write path, not just a destination warning. */
  let restoreConfirmed = $state<Record<string, boolean>>({});
  const restoreArmed = (e: CabLibraryListEntry) => restoreConfirmed[e.id] === true;

  const bank = $derived(CAB_BANKS[bankIdx]!);
  const entries = $derived<CabLibraryListEntry[]>(library?.entries ?? []);
  const grid = $derived(buildBankGrid(bank, bankRows[bankIdx] ?? null, entries));
  const coverage = $derived(bankCoverage(bank, grid));
  // the selection may span banks, so the lookup covers every scanned bank
  const slotMap = $derived.by(() => {
    const m = new Map<number, GridSlot>();
    CAB_BANKS.forEach((b) => {
      if (bankRows[b.index]) for (const s of buildBankGrid(b, bankRows[b.index]!, entries)) m.set(s.user, s);
    });
    for (const s of grid) m.set(s.user, s);
    return m;
  });
  const actions = $derived(manageActions(selection, slotMap, { deviceReady, deviceReason, stagedImport: !!staged && staged.kind !== 'error', busy }));
  const disabledReasons = $derived(
    (['clear', 'move', 'rename', 'import'] as const)
      .filter((k) => !actions[k].enabled)
      .map((k) => ({ k, reason: actions[k].reason }))
  );

  const io: CabManagerIo = {
    upload: (bytes, user) => forgefx.uploadCabIr(bytes, { user }),
    readSlot: (user) => forgefx.cabSlots({ user }).then((r) => r[0] ?? null),
    clear: (user) => forgefx.clearCabSlot({ user }),
    libraryBytes: (entry) => forgefx.cabLibraryBytes(entry.id).then((b) => new Uint8Array(b))
  };

  function say(ok: boolean, text: string) {
    log = [{ ok, text }, ...log].slice(0, 30);
  }

  async function refreshLibrary() {
    try {
      library = await forgefx.cabLibrary();
      libraryErr = '';
    } catch (e) {
      libraryErr = (e as Error).message;
    }
  }

  async function scan(index = bankIdx) {
    if (scanning || !deviceReady) return;
    scanning = true;
    scanMsg = `Reading ${CAB_BANKS[index]!.label} from the unit…`;
    try {
      const b = CAB_BANKS[index]!;
      bankRows = { ...bankRows, [index]: await forgefx.cabSlots({ page: b.page, from: 0, to: 127 }) };
      scanMsg = '';
    } catch (e) {
      scanMsg = `Scan failed: ${(e as Error).message}`;
    } finally {
      scanning = false;
    }
  }

  /** Re-read the banks a run touched (read-only), plus the library the server may have just extended. */
  async function refreshAfter(users: number[]) {
    const idxs = [...new Set(users.filter(isUserSlot).map((u) => Math.floor((u - 1) / 128)))];
    for (const i of idxs) await scan(i);
    await refreshLibrary();
  }

  $effect(() => {
    void refreshLibrary();
  });

  function clickSlot(s: GridSlot, e: MouseEvent) {
    selection = e.shiftKey && lastClicked != null ? rangeSelection(selection, lastClicked, s.user) : toggleSelection(selection, s.user);
    lastClicked = s.user;
    confirmed = false;
  }

  function open(m: NonNullable<typeof mode>) {
    mode = mode === m ? null : m;
    confirmed = false;
    if (m === 'rename' && selection.length === 1) renameTo = slotMap.get(selection[0]!)?.held?.name ?? '';
    if (m === 'import' && selection.length === 1) importDest = selection[0]!;
  }

  // ── clear ──
  const clearPlan = $derived(planClear(selection, slotMap));
  async function doClear() {
    if (!confirmed || busy) return;
    busy = true;
    try {
      const out = await runClear(clearPlan.users, io);
      for (const o of out) say(o.ok, o.text);
      await refreshAfter(clearPlan.users);
      selection = out.filter((o) => !o.ok).map((o) => o.user);
    } finally {
      busy = false;
      confirmed = false;
    }
  }

  // ── move ──
  let moveDest = $state(1);
  const movePlan = $derived(planMove(selection, Number(moveDest), slotMap, entries));
  async function doMove() {
    if (!confirmed || busy || !movePlan.ok || movePlan.runnable.length === 0) return;
    busy = true;
    try {
      const out = await runMove(movePlan.runnable, io);
      for (const o of out) say(o.state === 'moved', o.text);
      await refreshAfter(out.flatMap((o) => [o.item.from, o.item.to]));
      selection = selection.filter((u) => !out.some((o) => o.state === 'moved' && o.item.from === u));
    } finally {
      busy = false;
      confirmed = false;
    }
  }
  function importInstead(to: number) {
    importDest = to;
    mode = 'import';
    confirmed = false;
  }

  // ── rename (held IRs only) ──
  const renameSlot = $derived(selection.length === 1 ? (slotMap.get(selection[0]!) ?? null) : null);
  const renameErr = $derived(renameTo === '' ? '' : validateCabName(renameTo));
  async function doRename() {
    if (busy || !confirmed) return;
    busy = true;
    try {
      if (selection.length === 0 && staged && staged.kind !== 'error') {
        // renaming the STAGED import: re-stage with the new name (nothing touches the unit)
        importOpts = { ...importOpts, name: renameTo };
        await restage();
        say(true, `Staged import renamed to “${renameTo}” (not uploaded yet).`);
        return;
      }
      const held = renameSlot?.held;
      if (!renameSlot || !held) return;
      const bytes = await io.libraryBytes(held).catch(() => null);
      if (!bytes) {
        say(false, `The stored bytes for slot ${renameSlot.user} could not be read — nothing was sent.`);
        return;
      }
      const r = await runRename(bytes, renameSlot.user, renameTo, io, rewriteName, held);
      say(!!r.verdict?.ok, r.text);
      await refreshAfter([renameSlot.user]);
    } finally {
      busy = false;
      confirmed = false;
    }
  }

  // ── import (.syx / .wav / .ir) ──
  const modelByte = $derived(typeof editor.detected?.modelId === 'number' ? editor.detected.modelId : undefined);

  async function onPick(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0] ?? null;
    (e.target as HTMLInputElement).value = '';
    if (!f) return;
    stagedBytes = new Uint8Array(await f.arrayBuffer());
    importOpts = { ...importOpts, name: '' };
    ackUnvalidated = false;
    stage(f.name);
  }
  function stage(filename = stagedName) {
    stagedName = filename;
    staged = stagedBytes ? stageImport(stagedBytes, filename, { ...importOpts, model: modelByte }) : null;
  }
  async function restage() {
    stage();
  }
  function setOpt<K extends keyof ImportOptions>(k: K, v: ImportOptions[K]) {
    importOpts = { ...importOpts, [k]: v };
    ackUnvalidated = false;
    // A NAME is content in the container (the close frame is a content XOR), so a rename must still rebuild
    // the bytes — but ONLY through the codec's cheap parse+rebuild. Restaging on every keystroke ran the whole
    // WAV → mono → resample → min-phase → container pipeline on the main thread, which a long 96 kHz file
    // turns into a frozen UI. Options that change the SAMPLES still restage in full.
    if (k === 'name') relabel();
    else stage();
  }

  /** Re-label the already-staged container without re-converting it. Falls back to a full stage when there is
   *  nothing staged yet (a fresh name still has to be built into a container). */
  function relabel() {
    stagedName = importOpts.name;
    if (!staged || staged.kind === 'error') { stage(importOpts.name); return; }
    const name = importOpts.name || staged.filename;
    try {
      staged = { ...staged, name, container: rewriteName(staged.container, name) };
    } catch (e) {
      say(false, `Could not rename the staged container: ${(e as Error).message}`);
    }
  }
  const destState = $derived(destStateOf(slotMap.get(Number(importDest))));
  const canUpload = $derived(
    !!staged && staged.kind !== 'error' && isUserSlot(Number(importDest)) && !busy && deviceReady && (staged.kind !== 'wav' || ackUnvalidated) && confirmed
  );
  async function doImport() {
    if (!canUpload || !staged || staged.kind === 'error') return;
    const user = Number(importDest);
    busy = true;
    try {
      const up = await uploadAndVerify(io, staged.container, user);
      say(
        up.verdict.ok,
        `Import “${staged.name}” → slot ${user}: ${up.verdict.text}` +
          (staged.kind === 'wav' ? ' This IR was CONVERTED — expect silence: the unit accepts the bytes but cannot play this payload.' : '')
      );
      await refreshAfter([user]);
    } finally {
      busy = false;
      confirmed = false;
    }
  }

  // ── restore from the library ──
  let restoreDest = $state<Record<string, number>>({});
  const destFor = (e: CabLibraryListEntry) => restoreDest[e.id] ?? e.user ?? 1;
  async function doRestore(e: CabLibraryListEntry) {
    const user = Number(destFor(e));
    if (!restoreArmed(e)) return; // #9: no confirm, no write
    if (busy || !isUserSlot(user)) return;
    busy = true;
    try {
      const bytes = await io.libraryBytes(e).catch(() => null);
      if (!bytes) {
        say(false, `The stored bytes for “${e.name}” could not be read — nothing was sent.`);
        return;
      }
      const up = await uploadAndVerify(io, bytes, user);
      say(up.verdict.ok, `Restore “${e.name}” → slot ${user}: ${up.verdict.text}`);
      await refreshAfter([user]);
    } finally {
      busy = false;
      restoreConfirmed = { ...restoreConfirmed, [e.id]: false };
    }
  }
  /** #10: the destination may be populated, empty, or — if its bank was never scanned — UNKNOWN. */
  const restoreDestState = (e: CabLibraryListEntry) => destStateOf(slotMap.get(Number(destFor(e))));

  const wavePts = $derived(staged && staged.kind === 'wav' ? waveformPoints(staged.samples, 480, 60) : '');
  const slotLabel = (s: GridSlot) =>
    `Slot ${s.user} ${s.status}${s.held && s.status !== 'empty' ? ` — Axis library: ${s.held.name}` : ''}${s.heldStale ? ' — library copy is stale: the unit reads this slot empty' : ''}`;
</script>

<section class="cab-manager" data-testid="cab-manager">
  <header>
    <div class="titles">
      <h2>Manage Cabs</h2>
      <p>The 512 user cab slots: clear, move, rename, import and restore.</p>
    </div>
    <button class="btn" onclick={() => scan()} disabled={scanning || busy || !deviceReady} title={deviceReady ? 'Read this bank from the unit (read-only)' : deviceReason}>
      {scanning ? 'Scanning…' : `Scan ${bank.label.split(' · ')[0]}`}
    </button>
  </header>

  {#if !deviceReady}
    <div class="gate" data-testid="cab-gate">{deviceReason}</div>
  {/if}

  <nav class="banks" aria-label="Cab banks">
    {#each CAB_BANKS as b (b.index)}
      <button class="bank" class:on={b.index === bankIdx} aria-pressed={b.index === bankIdx} onclick={() => (bankIdx = b.index)}>{b.label}</button>
    {/each}
  </nav>
  <p class="disclosure" data-testid="cab-disclosure">{CAB_GRID_DISCLOSURE}</p>
  <p class="coverage" data-testid="cab-coverage">{coverage.line}</p>
  {#if scanMsg}<p class="status">{scanMsg}</p>{/if}

  <div class="grid" role="group" aria-label="User cab slots" data-testid="cab-grid">
    {#each grid as s (s.user)}
      <button
        class="cell {s.status}"
        class:sel={selection.includes(s.user)}
        class:held={!!s.held}
        class:stale={s.heldStale}
        aria-pressed={selection.includes(s.user)}
        aria-label={slotLabel(s)}
        title={slotLabel(s)}
        data-slot={s.user}
        data-status={s.status}
        onclick={(e) => clickSlot(s, e)}
      >{s.user}</button>
    {/each}
  </div>
  <p class="legend">
    <span class="key populated"></span> populated <span class="key empty"></span> empty <span class="key unreadable"></span> unreadable (not “empty”)
    <span class="key unscanned"></span> unscanned <span class="dot"></span> a copy is held in the Axis library
  </p>

  <div class="bar" data-testid="cab-actions">
    <span class="count" data-testid="cab-selection-count">{selection.length} selected</span>
    <button class="btn" disabled={!actions.clear.enabled} title={actions.clear.reason} onclick={() => open('clear')}>Clear…</button>
    <button class="btn" disabled={!actions.move.enabled} title={actions.move.reason} onclick={() => open('move')}>Move…</button>
    <button class="btn" disabled={!actions.rename.enabled} title={actions.rename.reason} onclick={() => open('rename')} data-testid="cab-rename-btn">Rename…</button>
    <button class="btn" disabled={!actions.import.enabled} title={actions.import.reason} onclick={() => open('import')}>Import…</button>
    {#if selection.length}<button class="link" onclick={() => (selection = [])}>Clear selection</button>{/if}
  </div>
  {#if disabledReasons.length}
    <ul class="reasons" data-testid="cab-disabled-reasons">
      {#each disabledReasons as d (d.k)}<li data-action={d.k}><b>{d.k}:</b> {d.reason}</li>{/each}
    </ul>
  {/if}

  {#if mode === 'clear'}
    <div class="panel" data-testid="cab-panel-clear">
      <h3>Clear {clearPlan.users.length} slot{clearPlan.users.length === 1 ? '' : 's'}</h3>
      <p>
        Sends the blank container to each slot (the unit's own delete) and confirms through the slot-state read-back.
        {#if clearPlan.willErase.length}<b>{clearPlan.willErase.length} slot(s) will lose their IR:</b> {clearPlan.willErase.join(', ')}.{/if}
        {#if clearPlan.noop.length}Already empty: {clearPlan.noop.join(', ')}.{/if}
        This cannot be undone from here.
      </p>
      <label class="check"><input type="checkbox" bind:checked={confirmed} /> I understand — erase these slots</label>
      <button class="btn danger" disabled={!confirmed || busy || clearPlan.users.length === 0} onclick={doClear}>{busy ? 'Clearing…' : 'Clear'}</button>
    </div>
  {/if}

  {#if mode === 'move'}
    <div class="panel" data-testid="cab-panel-move">
      <h3>Move {selection.length} slot{selection.length === 1 ? '' : 's'}</h3>
      <p>
        A move is two uploads: the IR is re-uploaded to the destination, then the source is blanked. That needs the IR's bytes, which Axis holds only for IRs
        it uploaded. Before writing, Axis RE-READS each source slot and REFUSES the move unless it still holds the same IR (matched by the slot's own name) —
        if the slot was refilled outside Axis, nothing is written and no source is erased.
      </p>
      <label>First destination slot <input type="number" min="1" max={CAB_USER_SLOTS} bind:value={moveDest} data-testid="cab-move-dest" /></label>
      {#if !movePlan.ok}
        <p class="warn" data-testid="cab-move-blocker">{movePlan.blocker}</p>
      {:else}
        <ul class="plan" data-testid="cab-move-plan">
          {#each movePlan.items as it (it.from)}
            <li data-from={it.from} data-kind={it.source.kind}>
              {it.from} → {it.to}
              {#if it.source.kind === 'library'}
                — from the Axis library (“{it.source.entry.name}”){#if it.destState !== 'empty'}<b class="warn"> · {destWarning(it.destState, it.to)}</b>{/if}
              {:else}
                — <span class="warn">{it.source.reason}</span>
                <button class="link" onclick={() => importInstead(it.to)}>Import a file to slot {it.to}</button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
      <label class="check"><input type="checkbox" bind:checked={confirmed} /> I understand — copy to the destination only after Axis confirms the source still holds this IR, then erase each source</label>
      <button class="btn danger" disabled={!confirmed || busy || !movePlan.ok || movePlan.runnable.length === 0} onclick={doMove}>
        {busy ? 'Moving…' : `Move ${movePlan.ok ? movePlan.runnable.length : 0}${movePlan.ok && movePlan.needsFile.length ? ` of ${movePlan.items.length}` : ''}`}
      </button>
    </div>
  {/if}

  {#if mode === 'rename'}
    <div class="panel" data-testid="cab-panel-rename">
      <h3>Rename {renameSlot ? `slot ${renameSlot.user}` : 'the staged import'}</h3>
      <p>
        Rewrites the name inside the container Axis holds, recomputes its close value, uploads it over the same slot and verifies it through the slot-state
        read-back. Axis first re-reads the slot and REFUSES the rename unless it still holds this IR (matched by name) — otherwise the rename would silently
        replace content the unit changed outside Axis.
      </p>
      <label>New name <input type="text" maxlength="32" bind:value={renameTo} data-testid="cab-rename-input" /></label>
      {#if renameErr}<p class="warn">{renameErr}</p>{/if}
      <label class="check"><input type="checkbox" bind:checked={confirmed} /> I understand — this re-uploads the IR to the slot, only after Axis confirms the slot still holds it</label>
      <button class="btn" disabled={!confirmed || busy || !!renameErr || renameTo === ''} onclick={doRename}>{busy ? 'Renaming…' : 'Rename'}</button>
    </div>
  {/if}

  {#if mode === 'import'}
    <div class="panel" data-testid="cab-panel-import">
      <h3>Import an IR</h3>
      <label>File <input type="file" accept=".syx,.wav,.ir" onchange={onPick} data-testid="cab-import-file" /></label>
      {#if staged?.kind === 'error'}
        <p class="warn" data-testid="cab-import-error">{staged.reason}</p>
      {/if}
      <fieldset class="opts" data-testid="cab-import-options">
        <legend>Conversion (.wav only)</legend>
        <label title={IMPORT_OPTION_HELP.minimumPhase}>
          <input type="checkbox" checked={importOpts.minimumPhase} onchange={(e) => setOpt('minimumPhase', (e.target as HTMLInputElement).checked)} />
          Minimum-phase transform (MPT)
        </label>
        <label title={IMPORT_OPTION_HELP.autoTrim}>
          <input type="checkbox" checked={importOpts.autoTrim} onchange={(e) => setOpt('autoTrim', (e.target as HTMLInputElement).checked)} />
          Auto-trim (strip leading silence + normalise)
        </label>
        <label title={IMPORT_OPTION_HELP.outputFormat}>
          Output format
          <select value={importOpts.outputFormat} onchange={(e) => setOpt('outputFormat', (e.target as HTMLSelectElement).value)} data-testid="cab-import-format">
            {#each CAB_IR_OUTPUT_FORMATS as f (f.id)}
              <option value={f.id} disabled={!f.available} title={f.reason}>{f.label}{f.available ? '' : ' — unavailable'}</option>
            {/each}
          </select>
        </label>
        <ul class="reasons" data-testid="cab-format-reasons">
          {#each CAB_IR_OUTPUT_FORMATS.filter((f) => !f.available) as f (f.id)}<li><b>{f.label}:</b> {f.reason}</li>{/each}
        </ul>
      </fieldset>
      <label>Name <input type="text" maxlength="32" value={importOpts.name} placeholder={staged && staged.kind !== 'error' ? staged.name : ''} oninput={(e) => setOpt('name', (e.target as HTMLInputElement).value)} /></label>
      <label>Destination slot <input type="number" min="1" max={CAB_USER_SLOTS} bind:value={importDest} data-testid="cab-import-dest" /></label>
      {#if staged && staged.kind !== 'error'}
        <div class="staged" data-testid="cab-import-staged">
          <b>{staged.filename}</b> → “{staged.name}” · {staged.sampleSlots} sample slots · {staged.container.length} bytes
          {#each staged.notes as n (n)}<p class="note">{n}</p>{/each}
          {#if staged.kind === 'wav'}
            <p class="unvalidated" data-testid="cab-unvalidated">{CAB_CONVERSION_UNVALIDATED_BADGE}.</p>
            <ol class="steps" data-testid="cab-import-steps">{#each staged.report.steps as st (st)}<li>{st}</li>{/each}</ol>
            <svg class="wave" viewBox="0 0 480 60" aria-label="Converted IR waveform preview" role="img"><polyline points={wavePts} fill="none" stroke="currentColor" stroke-width="1" /></svg>
            <p class="note">
              Sample encoding: <b>{staged.report.encoding.label}</b>. Measured on an FM3 (2026-10-30): the unit ACCEPTS these bytes and the slot reads POPULATED,
              then plays <b>silence</b> — the device's own IR payload is a compressed format Axis does not write, so a converted container cannot be made
              audible by trying another encoding. Upload only a .syx exported by Fractal's software if you want sound.
            </p>
            <label class="check"><input type="checkbox" bind:checked={ackUnvalidated} data-testid="cab-ack-unvalidated" /> I understand this converted IR will upload but play NO SOUND on the unit</label>
          {/if}
        </div>
      {/if}
      {#if isUserSlot(Number(importDest)) && destWarning(destState, Number(importDest))}<p class="warn" data-testid="cab-import-dest-warn">{destWarning(destState, Number(importDest))}</p>{/if}
      <label class="check"><input type="checkbox" bind:checked={confirmed} /> Write to user slot {importDest}</label>
      <button class="btn" disabled={!canUpload} onclick={doImport} data-testid="cab-import-go">{busy ? 'Uploading…' : 'Upload'}</button>
    </div>
  {/if}

  {#if log.length}
    <ul class="log" role="status" data-testid="cab-log">
      {#each log as l, i (i)}<li class:bad={!l.ok}>{l.text}</li>{/each}
    </ul>
  {/if}

  <div class="library" data-testid="cab-library">
    <h3>Axis IR library</h3>
    <p class="scope" data-testid="cab-library-scope">{library?.scope ?? CAB_LIBRARY_SCOPE_FALLBACK}</p>
    {#if libraryErr}<p class="warn">The library could not be read: {libraryErr}</p>{/if}
    {#if library}
      <p class="coverage" data-testid="cab-library-count">
        {library.entries.length} of {library.total} stored IR{library.total === 1 ? '' : 's'} listed · library cap {library.cap}{library.skipped ? ` · ${library.skipped} malformed record(s) skipped` : ''}
      </p>
      <ul class="entries">
        {#each library.entries as e (e.id)}
          <li data-entry={e.id}>
            <span class="nm">{e.name || '(unnamed)'}</span>
            <span class="meta">last uploaded to {e.user != null ? `slot ${e.user}` : `page 0x${e.page.toString(16)} #${e.index}`}{e.available ? '' : ' · stored bytes missing'}</span>
            <input type="number" min="1" max={CAB_USER_SLOTS} value={destFor(e)} oninput={(ev) => (restoreDest = { ...restoreDest, [e.id]: Number((ev.target as HTMLInputElement).value) })} aria-label={`Restore ${e.name} to slot`} />
            <label class="check"><input type="checkbox" bind:checked={restoreConfirmed[e.id]} data-testid={`cab-restore-confirm-${e.id}`} /> I understand — write to slot {destFor(e)}</label>
            <button
              class="btn danger"
              disabled={!e.available || busy || !deviceReady || !isUserSlot(Number(destFor(e))) || !restoreArmed(e)}
              title={!e.available ? 'The stored bytes for this entry are missing.' : !deviceReady ? deviceReason : restoreArmed(e) ? 'Write this IR to the slot' : 'Tick the box to confirm this destructive write.'}
              onclick={() => doRestore(e)}
            >Restore to slot</button>
            {#if destWarning(restoreDestState(e), Number(destFor(e)))}<small class="warn">{destWarning(restoreDestState(e), Number(destFor(e)))}</small>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<style>
  .cab-manager {
    position: absolute;
    inset: 0;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: auto;
    background: var(--bg2);
    color: var(--text);
    font-size: 12px;
  }
  header {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px;
    border-bottom: 1px solid var(--border);
  }
  .titles { flex: 1; min-width: 0; }
  h2 { margin: 0; font-size: 15px; }
  h3 { margin: 0 0 6px; font-size: 13px; }
  p { margin: 0; color: var(--textdim); font-size: 11px; }
  .gate, .disclosure, .coverage, .status, .legend, .warn, .scope { padding: 6px 12px; }
  .gate { color: var(--amber, #d6a43f); border-bottom: 1px solid var(--border); }
  .warn { color: var(--amber, #d6a43f); }
  .coverage { font-family: var(--font-mono); color: var(--text); }
  .banks { display: flex; gap: 6px; padding: 8px 12px 0; flex-wrap: wrap; }
  .bank { height: 28px; padding: 0 10px; border: 1px solid var(--border2, var(--border)); border-radius: 7px; background: var(--surface); color: var(--text); cursor: pointer; }
  .bank.on { border-color: var(--accent); color: var(--accent); }
  .grid { display: grid; grid-template-columns: repeat(16, minmax(0, 1fr)); gap: 3px; padding: 6px 12px; }
  .cell { position: relative; height: 28px; padding: 0; border: 1px solid var(--border); border-radius: 5px; background: var(--surface); color: var(--textdim); font: 10px var(--font-mono); cursor: pointer; }
  .cell.populated { background: color-mix(in srgb, var(--ok, #35c97b) 22%, var(--surface)); color: var(--text); }
  .cell.empty { background: var(--surface); }
  .cell.unreadable { background: color-mix(in srgb, var(--amber, #d6a43f) 22%, var(--surface)); }
  .cell.unscanned { opacity: 0.55; border-style: dashed; }
  .cell.sel { outline: 2px solid var(--accent); outline-offset: -1px; }
  .cell.held::after { content: ''; position: absolute; top: 2px; right: 2px; width: 5px; height: 5px; border-radius: 50%; background: var(--accent); }
  .cell.stale::after { background: var(--amber, #d6a43f); }
  .legend { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; color: var(--textdim); font-size: 10.5px; }
  .key { display: inline-block; width: 10px; height: 10px; border: 1px solid var(--border); border-radius: 2px; }
  .key.populated { background: color-mix(in srgb, var(--ok, #35c97b) 40%, var(--surface)); }
  .key.unreadable { background: color-mix(in srgb, var(--amber, #d6a43f) 40%, var(--surface)); }
  .key.unscanned { border-style: dashed; }
  .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
  .bar { display: flex; gap: 8px; align-items: center; padding: 8px 12px; flex-wrap: wrap; border-top: 1px solid var(--border); }
  .count { font-family: var(--font-mono); margin-right: 6px; }
  .btn { height: 30px; padding: 0 12px; border: 1px solid var(--accent-border, var(--border2)); border-radius: 8px; background: var(--accent-tint, var(--surface)); color: var(--accent); font-weight: 700; cursor: pointer; }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn.danger { border-color: var(--danger, #d6543f); color: var(--danger, #d6543f); }
  .link { background: none; border: 0; color: var(--accent); cursor: pointer; text-decoration: underline; padding: 0 4px; }
  .reasons { margin: 0; padding: 0 12px 6px 28px; color: var(--textdim); font-size: 10.5px; }
  .panel, .library { margin: 6px 12px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; gap: 6px; }
  .check { display: flex; gap: 6px; align-items: center; }
  .opts { border: 1px solid var(--border); border-radius: 6px; display: flex; flex-direction: column; gap: 4px; }
  .staged { padding: 6px; border: 1px dashed var(--border2, var(--border)); border-radius: 6px; }
  .unvalidated { color: var(--amber, #d6a43f); font-weight: 800; padding: 4px 0; }
  .wave { width: 100%; max-width: 480px; height: 60px; color: var(--accent); background: var(--surface); border-radius: 4px; }
  .steps { margin: 4px 0; padding-left: 18px; color: var(--textdim); }
  .plan, .entries, .log { margin: 0; padding-left: 18px; }
  .log { margin: 6px 12px; padding: 8px 8px 8px 24px; border: 1px solid var(--border); border-radius: 8px; font-family: var(--font-mono); font-size: 10.5px; }
  .log li.bad { color: var(--danger, #d6543f); }
  .entries { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .entries li { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .entries input { width: 64px; }
  .nm { font-weight: 700; }
  .meta { color: var(--textdim); font-size: 10.5px; }
  .note { padding: 3px 0; }
</style>
