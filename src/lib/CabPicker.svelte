<script lang="ts">
  import { getEditorSurface } from './editorSurface';
  import { catFor } from './catalog';
  import { loadCabIrsCachedFirst } from './cabIrsCache';
  import { forgefx } from './forgefx';
  import { planLibraryMove, libraryCanMove, CAB_LIBRARY_NOTE } from './cabMove';
  import type { CabState, CabLibraryListEntry } from './types';

  const editor = getEditorSurface();

  let cs = $state<CabState | null>(null);
  let irs = $state<Record<string, string[]>>({});
  let loading = $state(false);
  let slot = $state(0); // 0-based slot index
  let mode = $state<'legacy' | 'dyna'>('legacy');
  let bank = $state('FACTORY 1');
  let query = $state('');
  let hi = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);

  const cat = catFor('Cab', 'Cab'); // cab accent for chips
  const mob = $derived(editor.isMobile);

  const curSlot = $derived(cs?.slots[slot]);

  // favorites + recents (persisted), keyed by `${mode}:${bank}:${name}`
  let favs = $state<string[]>([]);
  let recents = $state<string[]>([]);
  const KEY = 'axs.cabirs';
  function loadStore() {
    try {
      const j = JSON.parse(localStorage.getItem(KEY) || 'null');
      favs = Array.isArray(j?.fav) ? j.fav : [];
      recents = Array.isArray(j?.rec) ? j.rec : [];
    } catch {
      /* */
    }
  }
  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ fav: favs, rec: recents }));
    } catch {
      /* */
    }
  }
  const idOf = (name: string) => `${mode}:${mode === 'legacy' ? bank : 'dyna'}:${name}`;
  const isFav = (id: string) => favs.includes(id);
  function toggleFav(id: string) {
    favs = isFav(id) ? favs.filter((x) => x !== id) : [id, ...favs].slice(0, 120);
    persist();
  }
  function pushRecent(id: string) {
    recents = [id, ...recents.filter((x) => x !== id)].slice(0, 16);
    persist();
  }

  // load cab state + IR catalog when opened
  $effect(() => {
    if (!editor.cabPickerOpen || !editor.selected?.pack) return;
    query = '';
    hi = 0;
    loadStore();
    loading = true;
    const eid = editor.selected.effectId;
    Promise.all([editor.cabState(eid), loadCabIrsCachedFirst()])
      .then(([state, banks]) => {
        cs = state;
        irs = banks;
        slot = 0;
        mode = state.mode.label.toUpperCase().includes('DYNA') ? 'dyna' : 'legacy';
        bank = state.slots[0]?.bank.label ?? state.bankOptions[0] ?? 'FACTORY 1';
      })
      .catch(() => (cs = null))
      .finally(() => (loading = false));
    // §2.7 — the IR byte library, best-effort: a failed read must not block the picker (the move
    // then falls back to the file with a named reason, not a silent failure).
    forgefx
      .cabLibrary()
      .then((l) => {
        irLib = l.entries;
        irLibScope = l.scope;
      })
      .catch(() => {});
    setTimeout(() => inputEl?.focus(), 0);
  });

  // when slot changes, follow that slot's current bank
  function selectSlot(i: number) {
    slot = i;
    bank = cs?.slots[i]?.bank.label ?? bank;
    hi = 0;
  }

  type Row = { id: string; name: string; sub: string; index: number; value: number };

  // ── the USER bank ─────────────────────────────────────────────────────────────────────────────
  // The device's own bank list has a `USER` entry, but this stack has NO user-bank NAME source: the
  // bundled cache covers FACTORY 1/2 + LEGACY (+ SCRATCHPAD) only, the cab/IR name tables are not
  // param-addressable over the wire, and the firmware refuses the documented cab-name read. So instead
  // of an empty list, the USER bank is built from what CAN be read — the unit's own per-slot state
  // (`GET /cab/slots`, read-only): occupied or empty, per slot, with no invented names.
  let userSlots = $state<Map<number, boolean | null> | null>(null);
  // User-slot NAMES, decoded from the unit's own per-slot reply (measured 2026-10-08). Only populated
  // slots get one — an empty slot's field holds the device's literal "<EMPTY>" plus stale bytes, so a name
  // from an empty slot is never shown.
  let userNames = $state<Map<number, string>>(new Map());
  let userLoading = $state(false);
  let userErr = $state('');
  let userTried = $state(false); // a FAILED read must not make the effect retry forever
  let clearMsg = $state('');
  let clearMsgOk = $state(true);
  let clearing = $state(false);

  // ERASE a user slot — the device's delete, and the ONLY way to empty one: an upload can replace a
  // slot's IR but cannot remove it (measured: a correctly-checksummed zeroed container is STORED and
  // reads populated; the blank container is what the unit treats as empty). Destructive, so confirm.
  async function clearSlot(slot: number) {
    if (clearing) return;
    if (!confirm(`Erase user slot ${slot}?\n\nThis sends the blank IR container, which is how this unit is cleared — the slot's current IR is gone. It cannot be undone from here.`)) return;
    clearing = true;
    clearMsg = '';
    try {
      const r = await forgefx.clearCabSlot({ user: slot });
      clearMsgOk = r.ok;
      clearMsg = r.ok
        ? `Slot ${slot}: ${r.reason}`
        : `Slot ${slot}: ${r.reason}`;
      if (r.ok) {
        // refresh the occupancy map so the row stops claiming "occupied"
        const page = 0x10 + Math.floor((slot - 1) / 128);
        const rows = await forgefx.cabSlots({ page, from: 0, to: 127 }).catch(() => null);
        if (rows) {
          const m = new Map(userSlots ?? []);
          const nm = new Map(userNames);
          for (const row of rows) {
            const slot = (page - 0x10) * 128 + row.index + 1;
            m.set(slot, row.populated);
            if (row.name && row.populated === true) nm.set(slot, row.name);
          }
          userSlots = m;
          userNames = nm;
        }
      }
    } catch (e) {
      clearMsgOk = false;
      clearMsg = `Slot ${slot}: NOT cleared — ${(e as Error).message}`;
    } finally {
      clearing = false;
    }
  }
  const USER_PAGES = [0x10, 0x11, 0x12, 0x13]; // 4 pages × 128 = the 512 user slots

  // SEQUENTIAL on purpose: one serial port, so parallel calls just queue behind each other, and a
  // 4-way parallel burst would make the last call outlive the client's 12 s request ceiling. One
  // 128-slot call measured 2.2 s on the unit, so the four calls total ~9 s and each stays safe. The
  // map is re-published per page so slots fill in as they arrive instead of after a 9 s blank.
  async function loadUserBank() {
    if (userLoading || userTried) return;
    userTried = true;
    userLoading = true;
    userErr = '';
    const m = new Map<number, boolean | null>();
    const nm = new Map<number, string>();
    try {
      for (const page of USER_PAGES) {
        const rows = await forgefx.cabSlots({ page, from: 0, to: 127 });
        for (const r of rows) {
          const slot = (page - 0x10) * 128 + r.index + 1;
          m.set(slot, r.populated);
          if (r.name && r.populated === true) nm.set(slot, r.name);
        }
        userSlots = new Map(m);
        userNames = new Map(nm);
      }
    } catch (e) {
      userErr = (e as Error).message;
      if (m.size === 0) userSlots = null;
    } finally {
      userLoading = false;
    }
  }

  // load lazily, the first time the USER bank is shown
  $effect(() => {
    if (mode === 'legacy' && bank === 'USER' && !userTried && !userLoading) void loadUserBank();
  });

  // all selectable rows for the current mode/bank
  const allRows = $derived.by<Row[]>(() => {
    if (mode === 'dyna') return (cs?.dynaOptions ?? []).map((o) => ({ id: `dyna:dyna:${o.label}`, name: o.label, sub: `Dyna #${o.value}`, index: o.value, value: o.value }));
    if (bank === 'USER') {
      // The slot's name is decoded from the unit's own reply — the editor reads the same field, which is
      // why FM3-Edit can show a name for a cab the stack uploaded over the wire.
      const m = userSlots;
      const names = userNames;
      return Array.from({ length: 512 }, (_, i) => {
        const slot = i + 1;
        const occ = m?.get(slot);
        const state = occ === true ? 'occupied' : occ === false ? 'empty' : occ === null ? 'no state' : '…';
        const decoded = names.get(slot);
        return {
          id: `legacy:USER:${slot}`,
          name: decoded ? `${decoded}` : `USER #${slot}`,
          sub: decoded ? `occupied · USER #${slot}` : `${state} · USER #${slot}`,
          index: i,
          value: i
        };
      });
    }
    const list = irs[bank] ?? [];
    return list.map((name, i) => ({ id: `legacy:${bank}:${name}`, name, sub: `${bank} #${i + 1}`, index: i, value: i }));
  });

  const CAP = 250; // cap rendered rows (Factory banks have 1024 IRs) — search to narrow
  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return q ? allRows.filter((r) => r.name.toLowerCase().includes(q)) : allRows;
  });

  // sectioned: query overrides; else Favorites / Recent / All (capped)
  const view = $derived.by(() => {
    let i = 0;
    const seq = (rows: Row[]) => rows.map((r) => ({ ...r, fi: i++ }));
    if (query.trim()) {
      const rows = seq(filtered.slice(0, CAP));
      return { sections: [{ label: `${filtered.length} result${filtered.length === 1 ? '' : 's'}`, rows }], flat: rows, total: filtered.length };
    }
    const byId = new Map(allRows.map((r) => [r.id, r]));
    const mk = (ids: string[]) => ids.map((id) => byId.get(id)).filter((r): r is Row => !!r);
    const raw: { label: string; rows: Row[] }[] = [];
    const fr = mk(favs);
    if (fr.length) raw.push({ label: 'FAVORITES', rows: fr });
    const rr = mk(recents).filter((r) => !favs.includes(r.id));
    if (rr.length) raw.push({ label: 'RECENT', rows: rr });
    raw.push({ label: mode === 'dyna' ? 'ALL DYNA-CABS' : `ALL · ${bank}`, rows: allRows.slice(0, CAP) });
    const sections = raw.map((s) => ({ label: s.label, rows: seq(s.rows) }));
    return { sections, flat: sections.flatMap((s) => s.rows), total: allRows.length };
  });

  // is a row the live selection?
  function isCurrent(r: Row): boolean {
    if (!curSlot) return false;
    if (mode === 'dyna') return cs?.mode.value === 1 && curSlot.dyna.value === r.value;
    return cs?.mode.value === 0 && curSlot.bank.label === bank && curSlot.irIndex === r.index;
  }

  async function pick(r: Row | undefined) {
    if (!r || !cs || !curSlot) return;
    pushRecent(r.id);
    if (mode === 'dyna') {
      await editor.applyCab([
        { paramId: cs.modeParam, value: 1 },
        { paramId: curSlot.dynaParam, value: r.value }
      ]);
      editor.showToast(`Slot ${slot + 1}: ${r.name}`, '#35c9d6');
    } else {
      const bankOrd = cs.bankOptions.indexOf(bank);
      await editor.applyCab([
        { paramId: cs.modeParam, value: 0 },
        { paramId: curSlot.bankParam, value: bankOrd < 0 ? 0 : bankOrd },
        { paramId: curSlot.irParam, value: r.index }
      ]);
      editor.showToast(`Slot ${slot + 1}: ${r.name}`, '#35c9d6');
    }
    // refresh so the highlight + header follow the device
    editor
      .cabState(editor.selected!.effectId)
      .then((s) => (cs = s))
      .catch(() => {});
  }

  // ── user-cab IR import (§2.5) ──────────────────────────────────────────────────────────────────
  // The upload replays the .syx container's own frames and writes ONE field: the 0x7A destination.
  // Two things this UI must say plainly, both measured:
  //  • the destination is REQUIRED — the export carries a "no destination" sentinel and the unit
  //    refuses it, and it refuses every scratchpad target too. Only user slots 1..512 are accepted,
  //    and writing one OVERWRITES that cabinet IR;
  //  • the result is the device's own frame-by-frame acknowledgement. That is the same evidence
  //    FM3-Edit relies on, but this firmware cannot read a slot's name back, so it means
  //    "acknowledged" — never "installed".
  let irInput = $state<HTMLInputElement | null>(null);
  let irFile = $state<File | null>(null);
  let irRename = $state('');
  let irSlot = $state<number>(1);
  // MOVE: an optional source slot to ERASE after a verified upload. This is how a user cab is moved — a
  // capture of FM3-Edit's "move to a different slot" is exactly two container uploads (the IR re-uploaded to
  // the destination, the source written with a container named "<EMPTY>"). No device-side move op exists, so
  // a move needs the IR's BYTES, which is why this needs the file picked here: Axis cannot read a slot's
  // samples, so it cannot check that the source held this same IR. 0 = a plain upload.
  let irMoveFrom = $state<number>(0);
  let irBusy = $state(false);
  let irMsg = $state('');
  let irMsgOk = $state(true);
  // §2.7 — the server-side IR byte library, loaded best-effort when the picker opens. Only IRs
  // uploaded THROUGH Axis are here (scope is shown verbatim); a move from an unlisted slot still
  // works by picking the file, it just is not silent about why.
  let irLib = $state<CabLibraryListEntry[]>([]);
  let irLibScope = $state('');
  let irLibMode = $state(false);
  const canMoveFromLib = $derived(libraryCanMove(irLib, Number(irMoveFrom)));

  function onPickIr(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0] ?? null;
    irFile = f;
    irRename = '';
    irMsg = '';
    (e.target as HTMLInputElement).value = '';
  }

  async function sendIr() {
    const slot = Number(irSlot);
    if (!Number.isInteger(slot) || slot < 1 || slot > 512) {
      irMsgOk = false;
      irMsg = 'Destination must be a user cab slot 1–512. The scratchpad bank is not an upload target on this unit.';
      return;
    }
    const from = Number(irMoveFrom);
    irBusy = true;
    irMsg = '';
    try {
      // §2.7 — the move's bytes come from the picked FILE, or — when no file is picked and a source
      // slot is named — from the server-side IR library (preferred for a move, since the IR is already
      // on the unit and the file may be long gone). When the source is not in the library, say so and
      // fall back to the file: never fail silently.
      let bytes: Uint8Array;
      let usingLib: CabLibraryListEntry | null = null;
      if (irFile) {
        bytes = new Uint8Array(await irFile.arrayBuffer());
      } else {
        const plan = planLibraryMove(irLib, from, slot);
        if (!plan.ok) {
          irMsgOk = false;
          irMsg = plan.reason;
          return;
        }
        usingLib = plan.entry;
        const stored = await forgefx.cabLibraryBytes(plan.entry.id).catch(() => null);
        if (!stored) {
          irMsgOk = false;
          irMsg = `The stored bytes for slot ${from} could not be read — pick the IR file instead.`;
          return;
        }
        bytes = new Uint8Array(stored);
      }
      const srcNote = usingLib ? `Source: the IR stored by Axis for slot ${from} (“${usingLib.name}”). ` : '';
      const wanted = irRename.trim();
      // Read the destination BEFORE the send, so "did it land" has a baseline. Best-effort: a read that
      // fails must not block the upload, it only weakens the confirmation.
      const before = await forgefx.cabSlots({ user: slot }).then((r) => r[0] ?? null).catch(() => null);
      const r = await forgefx.uploadCabIr(bytes, {
        user: slot,
        name: wanted || undefined,
        // a rename is the only path the server gates: the close frame's value is carried verbatim
        allowUnverified: wanted !== '',
      });
      irMsgOk = r.ok;
      // A 0x13 close answer means the unit THREW THE UPLOAD AWAY even though every frame was acked.
      // Report that first and in full — it is the difference between "sent" and "stored".
      if (r.discarded) {
        irMsgOk = false;
        irMsg = `DISCARDED by the unit — nothing was stored. Every frame was acknowledged, but the close frame answered 0x13: the container's content does not match the checksum in its own close frame. Axis recomputes that checksum for a rename or any other edit, so this should not happen from this UI — report it if it does.`;
        irFile = null;
        return;
      }
      // The upload's acks are the unit ACCEPTING the frames. The slot state is the unit's OWN answer
      // about the slot — the independent check the acks cannot give. It is occupancy, not a name.
      const after = await forgefx.cabSlots({ user: slot }).then((s) => s[0] ?? null).catch(() => null);
      let verify = 'slot state could not be read back — verify on the unit.';
      if (after) {
        if (after.populated === true) {
          const wasEmpty = before?.populated === false;
          verify = wasEmpty
            ? `slot ${slot} reads OCCUPIED now (it was empty before) — the upload landed.`
            : `slot ${slot} reads occupied (it was already occupied, so this shows occupancy, not content).`;
        } else if (after.populated === false) {
          verify = `slot ${slot} still reads EMPTY — treat this upload as FAILED.`;
          irMsgOk = false;
        } else {
          verify = `the unit gave no readable state for slot ${slot} (${after.note ?? 'unparsed reply'}) — verify on the unit.`;
        }
      }
      irMsg = srcNote + (r.ok
        ? `Acknowledged: “${r.name}” → user slot ${slot} (${r.frames} frames; start + ${r.acks.data}/${r.acks.expectedData} data + end acked). ${verify}`
        : `Sent, but NOT acknowledged: ${r.acks.data}/${r.acks.expectedData} data frames acked, start=${r.acks.start} end=${r.acks.end}. Treat that as a failed upload.`);

      // MOVE, second half: erase the source — and only when the upload was actually verified as landed on
      // the destination. Erasing after an unverified upload would DELETE the only copy the user has.
      if (from > 0) {
        if (!(r.ok && after?.populated === true)) {
          irMsgOk = false;
          irMsg += ` NOT erased: source slot ${from} is left alone because the destination was not verified as populated. Erasing now could destroy the only copy.`;
        } else if (from === slot) {
          irMsgOk = false;
          irMsg += ` Source slot ${from} is the destination — nothing to erase.`;
        } else {
          const c = await forgefx.clearCabSlot({ user: from }).catch(() => null);
          if (c?.ok) {
            irMsg += ` Moved: source slot ${from} is now ERASED (“${c.reason ?? 'ok'}”) — the unit reported it empty after the blank container was accepted.`;
          } else {
            irMsgOk = false;
            irMsg += ` NOT erased: source slot ${from} — ${c?.reason ?? 'the clear did not confirm'}. The IR now exists in BOTH slots; erase slot ${from} from the USER list when you have checked it.`;
          }
        }
      }
      irFile = null;
    } catch (err) {
      irMsgOk = false;
      irMsg = `Not sent: ${(err as Error).message}`;
    } finally {
      irBusy = false;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      hi = Math.min(view.flat.length - 1, hi + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      hi = Math.max(0, hi - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(view.flat[hi]);
    } else if (e.key === 'Escape') {
      editor.cabPickerOpen = false;
    }
  }
</script>

{#if editor.cabPickerOpen}
  <div class="bg" class:mob role="presentation" onclick={() => (editor.cabPickerOpen = false)}>
    <div class="card" class:mob role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
      <div class="search">
        <svg width="19" height="19" viewBox="0 0 16 16"><circle cx="7" cy="7" r="5.2" fill="none" style="stroke:var(--textfaint)" stroke-width="1.5" /><path d="M10.8 10.8 L14.5 14.5" style="stroke:var(--textfaint)" stroke-width="1.5" stroke-linecap="round" /></svg>
        <input bind:this={inputEl} bind:value={query} oninput={() => (hi = 0)} onkeydown={onKey} placeholder={mode === 'dyna' ? 'Search DynaCabs…' : 'Search cab IRs…'} />
        <span class="count mono">{view.total} cab{view.total === 1 ? '' : 's'}</span>
        <button class="x" aria-label="Close" onclick={() => (editor.cabPickerOpen = false)}>✕</button>
      </div>

      <div class="chips">
        <!-- mode = the Legacy / DynaCab swap, right in the search -->
        <div class="seg">
          <button class:on={mode === 'legacy'} onclick={() => { mode = 'legacy'; hi = 0; }}>Legacy</button>
          <button class:on={mode === 'dyna'} onclick={() => { mode = 'dyna'; hi = 0; }}>DynaCab</button>
        </div>
        {#if cs && cs.slots.length > 1}
          <div class="seg slots">
            {#each cs.slots as s, i (s.slot)}
              <button class:on={slot === i} onclick={() => selectSlot(i)}>Slot {s.slot}</button>
            {/each}
          </div>
        {/if}
        <button class="cat import" title="Upload a user-cab IR .syx to the unit" onclick={() => irInput?.click()} disabled={irBusy}>＋ Import IR…</button>
        <input bind:this={irInput} type="file" accept=".syx" class="hidden-file" onchange={onPickIr} />
        <button class="cat move" title={`Move an IR Axis has already stored — no file needed. ${CAB_LIBRARY_NOTE}`} onclick={() => { irLibMode = !irLibMode; irMsg = ''; }} disabled={irBusy}>⇄ Move stored IR…</button>
        {#if curSlot}
          <span class="cur" title="Current selection">{mode === 'dyna' ? curSlot.dyna.label : curSlot.irName}</span>
        {/if}
      </div>

      {#if irLibMode && !irFile}
        <div class="irimport" class:bad={!irMsgOk}>
          <span class="note lisrcope" title={irLibScope || CAB_LIBRARY_NOTE}>
            {irLibScope || CAB_LIBRARY_NOTE}
          </span>
          <label class="slotfield" title="The 1..512 user slot to MOVE INTO. This OVERWRITES the destination slot.">
            → user slot
            <input class="slotnum" type="number" min="1" max="512" bind:value={irSlot} disabled={irBusy} />
          </label>
          <label class="slotfield" title="The user slot to move FROM. If that slot's IR is in the Axis library, its stored bytes are re-uploaded and the slot is then erased — no file needed. If it is not, pick the IR file instead (the unit cannot read a slot's samples).">
            move from
            <input class="slotnum" type="number" min="1" max="512" bind:value={irMoveFrom} disabled={irBusy} />
          </label>
          {#if Number(irMoveFrom) > 0 && canMoveFromLib}
            <span class="note oknote">slot {irMoveFrom} is in the Axis library — it can be moved without a file.</span>
          {:else if Number(irMoveFrom) > 0}
            <span class="note">slot {irMoveFrom} is NOT in the Axis library (it was not uploaded through Axis) — use ＋ Import IR… and pick the file.</span>
          {/if}
          <button class="go" onclick={sendIr} disabled={irBusy || Number(irMoveFrom) === 0}>{irBusy ? 'Moving…' : 'Move'}</button>
          <button class="cancel" onclick={() => { irLibMode = false; irMsg = ''; }} disabled={irBusy}>Cancel</button>
          {#if irMsg}<span class="note">{irMsg}</span>{/if}
        </div>
      {/if}

      {#if irFile || (irMsg && !irLibMode)}
        <div class="irimport" class:bad={!irMsgOk}>
          {#if irFile}
            <span class="fname mono" title={irFile.name}>{irFile.name}</span>
            <label class="slotfield" title="User cab slots 1–512. The scratchpad bank is NOT an upload destination on this unit, and this OVERWRITES the slot you name.">
              → user slot
              <input class="slotnum" type="number" min="1" max="512" bind:value={irSlot} disabled={irBusy} />
            </label>
            <label class="slotfield" title="MOVE: after the upload is VERIFIED as landed, the source slot is erased with the blank container — the same two steps FM3-Edit performs when you move a cab to a different slot (measured from a capture: the IR re-uploaded to the destination, the source written with a container named &quot;&lt;EMPTY&gt;&quot;). There is no device-side move op. Axis cannot read a slot's samples, so it cannot check that the source held THIS file — only erase it. Leave 0 for a plain upload.">
              move from
              <input class="slotnum" type="number" min="0" max="512" bind:value={irMoveFrom} disabled={irBusy} />
            </label>
            <input
              class="rename"
              bind:value={irRename}
              maxlength="32"
              placeholder="rename (32 chars — the close frame is recomputed)"
              title="MEASURED 2026-10-08: the container's close frame is a CHECKSUM over its content, and the unit DISCARDS any container whose close value does not match. A rename therefore recomputes it — measured working: the unit answered close-code 0x00 and the destination slot became populated. Leaving this blank uploads the container unchanged."
            />
            <button class="go" onclick={sendIr} disabled={irBusy}>{irBusy ? 'Sending…' : 'Send to unit'}</button>
            <button class="cancel" onclick={() => { irFile = null; irMsg = ''; }} disabled={irBusy}>Cancel</button>
          {:else}
            <span class="note">{irMsg}</span>
            <button class="cancel" onclick={() => (irMsg = '')}>Dismiss</button>
          {/if}
        </div>
      {/if}

      {#if mode === 'legacy'}
        <div class="cats scroll">
          {#each cs?.bankOptions ?? [] as b (b)}
            <button class="cat" class:on={bank === b} onclick={() => { bank = b; hi = 0; }}>{b}</button>
          {/each}
        </div>
      {/if}

      <div class="list scroll">
        {#if bank === 'USER' && mode === 'legacy'}
          <div class="banknote mono">
            {#if userLoading}
              reading the unit's user-slot states…
            {:else if userErr}
              user-bank state read failed: {userErr}
              <button class="retry" onclick={() => { userTried = false; userSlots = null; }}>retry</button>
            {:else}
              occupancy read from the unit — this firmware cannot read user-slot NAMES back (FM3-Edit
              shows the names it recorded itself), so slots are listed as occupied/empty.
              <span class="erasehint">· × erases a slot (sends the blank IR container)</span>
            {/if}
            {#if clearMsg}
              <div class="clearmsg" class:bad={!clearMsgOk}>{clearMsg}</div>
            {/if}
          </div>
        {/if}
        {#if loading}
          <div class="empty">Loading…</div>
        {:else if view.flat.length === 0}
          <div class="empty">{query ? `No cabs match “${query}”.` : 'No cabs in this bank.'}</div>
        {:else}
          {#each view.sections as s (s.label)}
            <div class="section mono">{s.label}{#if s.label.startsWith('ALL') && view.total > CAP && !query}<span class="more"> · showing {CAP} of {view.total}, search to narrow</span>{/if}</div>
            {#each s.rows as r (`${r.id}#${r.fi}`)}
              <div class="rowwrap" class:hi={r.fi === hi} class:sel={isCurrent(r)}>
                <button class="row" onmouseenter={() => (hi = r.fi)} onclick={() => pick(r)}>
                  <span class="chip" style="background:linear-gradient(180deg,{cat.accent}, {cat.accent}88); border-color:{cat.accent};">{cat.glyph}</span>
                  <span class="rtext">
                    <span class="rname">{r.name}</span>
                    <span class="rsub">{r.sub}</span>
                  </span>
                  {#if isCurrent(r)}<span class="now mono">● live</span>{:else if r.fi === hi}<span class="ret mono">↵</span>{/if}
                </button>
                {#if mode === 'legacy' && bank === 'USER' && r.sub.startsWith('occupied')}
                  <button
                    class="erase"
                    aria-label="Erase slot"
                    title="Erase this slot — sends the blank IR container, which is how this unit is cleared. Destructive; the IR cannot be recovered from here."
                    disabled={clearing}
                    onclick={() => clearSlot(r.index + 1)}>×</button>
                {/if}
                <button class="star" class:on={isFav(r.id)} aria-label="Favorite" title={isFav(r.id) ? 'Unfavorite' : 'Favorite'} onclick={() => toggleFav(r.id)}>{isFav(r.id) ? '★' : '☆'}</button>
              </div>
            {/each}
          {/each}
        {/if}
      </div>

      {#if !mob}
        <div class="foot mono"><span>↑↓ Navigate</span><span>⏎ Load</span><span>★ Favorite</span><span>Esc Close</span></div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .bg {
    position: absolute;
    inset: 0;
    background: rgba(6, 6, 8, 0.66);
    backdrop-filter: blur(3px);
    z-index: 200;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 7vh 12px 12px;
    animation: axsOverlay 0.12s ease;
  }
  .card {
    width: 760px;
    max-width: 100%;
    max-height: 84vh;
    background: var(--surface);
    border: 1px solid var(--border2);
    border-radius: 16px;
    box-shadow: 0 32px 80px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: axsPalette 0.15s cubic-bezier(0.2, 0.8, 0.3, 1);
  }
  /* mobile: dock as a bottom sheet */
  .bg.mob {
    align-items: flex-end;
    padding: 0;
  }
  .card.mob {
    width: 100%;
    max-width: 100%;
    max-height: 92vh;
    border-radius: 18px 18px 0 0;
    animation: axsSheet 0.28s cubic-bezier(0.2, 0.85, 0.25, 1);
  }
  .card.mob .search {
    padding: 15px 16px;
  }
  .card.mob .chips {
    flex-wrap: wrap;
  }
  .card.mob .cur {
    margin-left: 0;
    max-width: 100%;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 13px;
    padding: 18px 20px;
    border-bottom: 1px solid var(--surface2);
  }
  .search input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text);
    font-family: inherit;
    font-size: 17px;
    font-weight: 500;
  }
  .count {
    font-size: 12px;
    color: var(--textmuted);
    white-space: nowrap;
  }
  .x {
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    border: 1px solid var(--border-2);
    background: var(--surface2);
    color: var(--textdim);
    cursor: pointer;
    font-size: 13px;
  }
  .chips {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 16px;
    border-bottom: 1px solid var(--surface2);
  }
  .seg {
    display: flex;
    gap: 2px;
    background: var(--panel-2);
    border: 1px solid var(--surface-3);
    border-radius: 9px;
    padding: 2px;
  }
  .seg button {
    border: 0;
    background: transparent;
    color: var(--textdim);
    font-size: 12px;
    font-weight: 600;
    padding: 6px 13px;
    border-radius: 7px;
    cursor: pointer;
  }
  .seg button.on {
    background: var(--accent-tint);
    color: var(--accent);
  }
  .seg.slots button.on {
    background: var(--amber-tint);
    color: var(--amber);
  }
  .cur {
    margin-left: auto;
    font-size: 11px;
    font-weight: 600;
    color: var(--accentbright);
    background: var(--accent-tint);
    border: 1px solid var(--accent-border);
    border-radius: 7px;
    padding: 6px 11px;
    max-width: 46%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cats {
    display: flex;
    gap: 6px;
    padding: 10px 16px;
    overflow-x: auto;
    border-bottom: 1px solid var(--surface2);
    flex: none;
  }
  /* mobile: wrap banks onto multiple rows instead of a hidden horizontal scrollbar */
  .card.mob .cats {
    flex-wrap: wrap;
    overflow-x: visible;
  }
  .cat {
    flex: none;
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid var(--surface-3);
    background: var(--panel-2);
    color: var(--textdim);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    outline: none;
  }
  .cat.on {
    background: var(--accent-tint);
    border-color: var(--accent-border);
    color: var(--accent);
  }
  .list {
    flex: 1;
    min-height: 160px;
    overflow-y: auto;
    padding: 8px 8px 10px;
  }
  .section {
    font: 600 10px/1 var(--font-mono);
    color: var(--textmuted);
    letter-spacing: 0.1em;
    padding: 13px 10px 8px;
  }
  .more {
    color: var(--border3);
    letter-spacing: 0;
  }
  .rowwrap {
    display: flex;
    align-items: center;
    border-radius: 10px;
  }
  .rowwrap.hi {
    background: var(--accent-tint);
    box-shadow: inset 0 0 0 1px var(--accent-border);
  }
  .rowwrap.sel {
    background: var(--ok-tint);
  }
  .row {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 13px;
    padding: 10px 12px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    cursor: pointer;
    text-align: left;
  }
  .chip {
    flex: none;
    width: 46px;
    height: 32px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    color: var(--text);
    border: 1px solid;
  }
  .rtext {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .rname {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rsub {
    font-size: 11px;
    color: var(--textfaint);
  }
  .now {
    flex: none;
    font-size: 10px;
    font-weight: 600;
    color: var(--ok, var(--ok));
  }
  .ret {
    flex: none;
    font-size: 10px;
    font-weight: 600;
    color: var(--accent);
    background: var(--accent-tint);
    border: 1px solid var(--accent-border);
    border-radius: 5px;
    padding: 4px 6px;
  }
  .star {
    flex: none;
    width: 38px;
    height: 38px;
    margin-right: 6px;
    border: 0;
    background: transparent;
    color: var(--border3);
    font-size: 16px;
    cursor: pointer;
    border-radius: 9px;
  }
  .star:hover,
  .star.on {
    color: var(--amber);
  }
  .empty {
    padding: 40px 20px;
    text-align: center;
    color: var(--text-faint);
    font-size: 13px;
    line-height: 1.5;
  }
  .foot {
    display: flex;
    gap: 16px;
    padding: 10px 16px;
    border-top: 1px solid var(--surface2);
    font-size: 10px;
    color: var(--text-faint);
    flex: none;
  }
  .banknote .retry {
    margin-left: 6px;
    font: inherit;
    color: var(--text);
    background: transparent;
    border: 1px solid var(--surface-3);
    border-radius: 5px;
    padding: 1px 6px;
    cursor: pointer;
  }
  .erasehint {
    color: var(--text-faint);
  }
  .clearmsg {
    margin-top: 4px;
    color: var(--text);
  }
  .clearmsg.bad {
    color: var(--amber, #d9a34a);
  }
  .rowwrap .erase {
    flex: none;
    background: transparent;
    border: 1px solid var(--surface-3);
    border-radius: 6px;
    color: var(--textmuted);
    font-size: 13px;
    line-height: 1;
    padding: 4px 7px;
    cursor: pointer;
  }
  .rowwrap .erase:hover {
    color: var(--text);
    border-color: var(--red, #b4544a);
  }
  .rowwrap .erase:disabled {
    opacity: 0.45;
    cursor: default;
  }
  /* ── USER bank occupancy note ── */
  .banknote {
    padding: 7px 10px 6px;
    font-size: 10.5px;
    line-height: 1.45;
    color: var(--textmuted);
    border-bottom: 1px solid var(--surface-3);
    background: var(--surface-2, rgba(255, 255, 255, 0.02));
  }
  /* ── user-cab IR import strip (§2.5) ── */
  .cat.import {
    border-style: dashed;
  }
  .cat.import:hover {
    border-color: var(--accent-border);
    color: var(--accent);
  }
  .hidden-file {
    display: none;
  }
  .irimport {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 16px;
    border-bottom: 1px solid var(--surface2);
    background: var(--panel-2);
    font-size: 12px;
    flex: none;
  }
  .irimport.bad {
    background: var(--danger-tint, rgba(220, 90, 90, 0.12));
  }
  .irimport .fname {
    max-width: 30%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--textdim);
  }
  .irimport .rename {
    flex: 1;
    min-width: 90px;
    background: var(--surface);
    border: 1px solid var(--surface-3);
    border-radius: 7px;
    color: var(--text);
    font-size: 12px;
    padding: 5px 9px;
    outline: none;
  }
  .irimport .note {
    color: var(--textmuted);
    font-size: 11px;
  }
  .irimport .slotfield {
    display: flex;
    align-items: center;
    gap: 5px;
    flex: none;
    font-size: 11px;
    color: var(--textmuted);
    white-space: nowrap;
  }
  .irimport .slotnum {
    width: 58px;
    background: var(--surface);
    border: 1px solid var(--surface-3);
    border-radius: 7px;
    color: var(--text);
    font-size: 12px;
    padding: 4px 6px;
    outline: none;
  }
  .irimport .note {
    flex: 1;
  }
  .irimport .go,
  .irimport .cancel {
    flex: none;
    border-radius: 7px;
    font-size: 12px;
    font-weight: 600;
    padding: 5px 11px;
    cursor: pointer;
  }
  .irimport .go {
    border: 1px solid var(--accent-border);
    background: var(--accent-tint);
    color: var(--accent);
  }
  .irimport .cancel {
    border: 1px solid var(--surface-3);
    background: transparent;
    color: var(--textdim);
  }
  .irimport .go:disabled,
  .irimport .cancel:disabled {
    opacity: 0.55;
    cursor: default;
  }
</style>
