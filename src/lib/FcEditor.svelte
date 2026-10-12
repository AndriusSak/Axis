<script lang="ts">
  // Foot Controller editor (effectId 199). Three render modes, decided PURELY by the served model's
  // shape (never by device/model id):
  //  1. liveState:true (FM3) — the full editor with live read-back, colors and custom labels.
  //  2. liveState:false + layout/switch geometry (FM9) — layout picker (1..8 + Master) × 12-slot
  //     switch grid, config = layout*configsPerLayout + switchSlot; per-switch category/function/
  //     display/params editing. Writes are blind (no read-back) but device-true.
  //  3. liveState:false, no geometry (Axe-Fx III) — flat config picker 0..configs-1 + the same
  //     per-config field editing.
  // Writes compute pid = field.base + config*stride (+index for value/label blocks). tapCategory
  // formula is device-verified; the field structure + enum vocabularies are cache/capture/binary
  // confirmed. Controls whose metadata is absent from the served model (colors, custom labels,
  // display-mode labels) are GATED — rendered disabled with the honest missing-metadata reason
  // (see fcFieldGates.ts, audit §3.7) — never silently hidden.
  import { onMount } from 'svelte';
  import { editor } from './editor.svelte';
  import { forgefx } from './forgefx';
  import type { FcModel } from './types';
  import {
    AXIS_FC_LAYOUT_CATEGORY,
    AXIS_FC_PER_PRESET_CATEGORY,
    axisFcParity
  } from './axis-workbench/fc/fcParity';
  import {
    axisFcFieldGate,
    axisFcGatedFields,
    type AxisFcFieldGate,
    type AxisFcFieldGateId
  } from './axis-workbench/fc/fcFieldGates';
  import {
    axisFcLayoutPackageWrites,
    buildAxisFcLayoutPackage,
    parseAxisFcLayoutPackage,
    serializeAxisFcLayoutPackage
  } from './axis-workbench/fc/fcLayoutPackage';
  // Named options for the 'block'-typed value slot (the FC "Effect" assignment). The names come from
  // the preset's PLACED BLOCKS (/preset/grid); the FC model itself carries none. See fcBlockOptions.ts.
  import {
    FC_BLOCK_VALUE_SPACE_CAVEAT,
    fcBlockOptionsIncluding,
    fcBlockRawHint,
    fcBlockRosterNote,
    type FcBlockCell
  } from './fcBlockOptions';

  const ACC = 'var(--amber)'; // FC accent follows the theme's amber token
  let model = $state<FcModel | null>(null);
  let err = $state<string | null>(null);
  let layout = $state(0);
  let view = $state(0);
  let sw = $state(0);
  let flatCfg = $state(0); // mode 3 (no geometry): the flat config index
  let edits = $state<Record<string, number>>({}); // field ordinals (read from unit + written this session)
  let labelText = $state<Record<string, string>>({}); // decoded label text, keyed `${side}Label:${config}`
  // Device read-back via the sub-0x1b value channel (GET /fc/state → Device.fcReadState). It returns the
  // live ordinals (category/function/display/color) + decoded label text per switch — the channel that
  // actually tracks param edits — so we populate cur()/labels from it and the controls reflect the unit.
  // `present` flags a switch as configured (its category is not Unassigned).
  let present = $state<Record<number, boolean>>({});
  let reading = $state(false);
  // The preset's placed blocks — the roster the FC "Effect" (block-typed) value slot is named from
  // (/preset/grid). A failed/absent read leaves it EMPTY and the field shows its id, MARKED, rather
  // than a fabricated name (see fcBlockOptions.ts).
  let placed = $state<FcBlockCell[]>([]);

  onMount(async () => {
    try {
      model = await forgefx.fcModel();
      if (!model) err = 'This device has no decoded Foot Controller model yet.';
    } catch (e) {
      err = (e as Error).message;
    }
    // the block picker is FM3-only (the typed value slots render in the liveState branch)
    if (model?.liveState) {
      try {
        const g = await forgefx.grid();
        placed = g.cells;
      } catch {
        /* roster stays empty → every block id renders marked */
      }
    }
  });

  // Read the live device state for the switches of the current layout+view, so each tile can flag
  // whether the unit actually has that switch configured. Fields stay blank until edited (see note).
  async function loadState() {
    if (!model || !model.liveState) return; // live per-switch read is FM3-only
    reading = true;
    try {
      const n = model.switches ?? 0;
      const states = await Promise.all(
        Array.from({ length: n }, (_, i) => forgefx.fcState(layout, view, i).catch(() => null))
      );
      const e = { ...edits };
      const lb = { ...labelText };
      const pr = { ...present };
      states.forEach((s) => {
        if (!s) return;
        const c = s.config;
        for (const [f, v] of Object.entries(s.fields)) if (v != null) e[`${f}:${c}`] = v;
        lb[`tapLabel:${c}`] = s.tapLabel;
        lb[`holdLabel:${c}`] = s.holdLabel;
        // configured on the unit = either side has a real (non-Unassigned) category
        pr[c] = (s.fields.tapCategory ?? 0) !== 0 || (s.fields.holdCategory ?? 0) !== 0;
      });
      edits = e;
      labelText = lb;
      present = pr;
    } catch (e) {
      editor.showToast('FC read failed: ' + (e as Error).message, '#ff6b6b');
    } finally {
      reading = false;
    }
  }
  $effect(() => {
    // re-read whenever the model loads or the layout/view changes
    if (model) {
      void layout;
      void view;
      loadState();
    }
  });

  const switches = $derived(model?.switches ?? 3);
  // on mobile the fixed N-column board gets cramped; wrap into readable min-width tiles instead
  const boardCols = $derived(editor.isMobile || switches > 6 ? 'repeat(auto-fill, minmax(150px, 1fr))' : `repeat(${switches}, 1fr)`);
  // Mode selection is model-SHAPE-driven: geometry = the model decomposes configs into
  // layout × switch-slot (FM3 additionally pages by view; FM9 has no views).
  const hasGeometry = $derived(!!(model && model.layouts && model.configsPerLayout && model.switches));
  // FM3 (views): config = layout*configsPerLayout + view*switches + sw. FM9 (no views, view stays 0):
  // the same formula reduces to layout*configsPerLayout + switchSlot. No geometry: the flat picker.
  const config = $derived(
    model ? (hasGeometry || model.liveState ? layout * (model.configsPerLayout ?? 0) + view * (model.switches ?? 0) + sw : flatCfg) : 0
  );
  const catList = $derived(model ? Object.entries(model.categories ?? {}).map(([v, label]) => ({ v: +v, label })).sort((a, b) => a.v - b.v) : []);
  const colorList = $derived(model ? Object.entries(model.colors ?? {}).map(([v, c]) => ({ v: +v, ...c })).sort((a, b) => a.v - b.v) : []);
  /** Width of a side's params value block (6 on gen-3) — from the field def, else the model width. */
  const paramWidth = (side: string) => model?.fields[side + 'Params']?.width ?? model?.paramsWidth ?? 0;

  function pidOf(field: string, cfg = config, index = 0): number {
    const f = model!.fields[field];
    return (f?.base ?? 0) + cfg * (f?.stride ?? 0) + index;
  }
  const ek = (field: string, cfg = config) => `${field}:${cfg}`;
  const cur = (field: string, cfg = config) => edits[ek(field, cfg)];

  async function write(field: string, value: number, cfg = config, index = 0) {
    if (!model) return;
    if (index === 0) edits = { ...edits, [ek(field, cfg)]: value };
    try {
      await forgefx.setParam(model.effectId, pidOf(field, cfg, index), value, false);
    } catch (e) {
      editor.showToast('Write failed: ' + (e as Error).message, '#ff6b6b');
    }
  }
  // Custom-label display-mode ordinal (capture-confirmed = 2). A switch only renders custom text when
  // its display mode is "Custom"; FM3-Edit sets that mode alongside the chars, so we do too — otherwise
  // the characters are stored but never shown.
  const customMode = $derived(model ? +(Object.entries(model.labelModes ?? {}).find(([, v]) => v === 'Custom')?.[0] ?? 2) : 2);
  async function writeLabel(field: string, text: string, cfg = config) {
    if (!model) return;
    edits = { ...edits, [ek(field, cfg)]: text.length };
    labelText = { ...labelText, [ek(field, cfg)]: text };
    const base = pidOf(field, cfg);
    for (let i = 0; i < (model.labelLen ?? 0); i++) {
      try {
        // each char is its own SET: pid = labelBase + i, value = float32(ASCII code), 0-padded
        await forgefx.setParam(model.effectId, base + i, i < text.length ? text.charCodeAt(i) : 0, false);
      } catch {
        /* */
      }
    }
    // put the switch into Custom display mode so the text actually shows (the side is the field prefix)
    if (text.length) await write(field.replace(/Label$/, 'Display'), customMode, cfg);
  }
  const layoutLabel = (i: number) => (i === 8 ? 'Master' : String(i + 1));
  const catName = (v: number | undefined) => (v != null ? (model?.categories?.[String(v)] ?? 'Cat ' + v) : '—');
  /** The cap disclosure for the block picker (the roster = the current preset's placed blocks). */
  const blockRosterNote = $derived(fcBlockRosterNote(placed));

  // ── function model: the selected function for a side drives its value-slots + label options ──
  const labelModeFallback = $derived(model ? Object.entries(model.labelModes ?? {}).map(([, l]) => l) : []);
  function funcsFor(side: string) {
    const cat = cur(side + 'Category');
    return cat != null ? (model?.functions?.[String(cat)] ?? []) : [];
  }
  function fnDefFor(side: string) {
    const sel = cur(side + 'Function') ?? 0;
    return funcsFor(side).find((f) => f.ord === sel);
  }
  const slotKey = (side: string, i: number) => `${side}Params#${i}:${config}`;
  const curSlot = (side: string, i: number) => edits[slotKey(side, i)];
  async function writeSlot(side: string, i: number, value: number) {
    if (!model) return;
    edits = { ...edits, [slotKey(side, i)]: value };
    try {
      await forgefx.setParam(model.effectId, pidOf(side + 'Params', config, i), value, false);
    } catch (e) {
      editor.showToast('Write failed: ' + (e as Error).message, '#ff6b6b');
    }
  }
  // changing category also resets the function to 0 (matches the editor)
  async function setCategory(side: string, v: number) {
    await write(side + 'Category', v);
    await write(side + 'Function', 0);
  }

  // Nav setters. Live FC read-back uses the sub-0x01 structured config-selector read (GET /fc/state):
  // it confirms which switch slots are configured on the unit (the `present` map drives the tile
  // badge). Field-value read-back (category/value/label) awaits a decode of the structured record's
  // interior bytes — until then those controls stay blank-until-edited, by design.
  const selLayout = (i: number) => (layout = i);
  const selView = (i: number) => (view = i);
  const selSwitch = (i: number) => (sw = i);
  const onDevice = (cfg: number) => !!present[cfg];

  // ── §3.8 FM3-Edit parity: capability status + layout import/export ──────────────────────────
  // Derived purely from the served /fc/model (see fcParity.ts). Features the device does not serve
  // (Per-Preset definitions, CS MIDI, FC Config/Devices) are shown with an honest reason, never
  // faked with an invented paramId.
  const parity = $derived(model ? axisFcParity(model) : []);
  const importExportReady = $derived(parity.find((f) => f.id === 'layoutImportExport')?.status === 'supported');
  // §3.7 field gates: which metadata-driven controls the served /fc/model can render. Shape-derived
  // (fcFieldGates.ts); a control whose metadata is absent renders disabled with its honest reason.
  const gate = (id: AxisFcFieldGateId): AxisFcFieldGate => axisFcFieldGate(model, id);
  /** How many metadata-driven controls the served model cannot render (0 on a complete model). */
  const gatedCount = $derived(model ? axisFcGatedFields(model).length : 0);
  let ioBusy = $state(false);

  function downloadText(name: string, text: string) {
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** Export the whole selected layout: live read-back on FM3, session writes otherwise. */
  async function exportLayout() {
    if (!model || !importExportReady) return;
    ioBusy = true;
    try {
      const m = model;
      const nSw = m.switches ?? 0;
      const nViews = m.views ?? 1;
      const vals: Record<string, number> = { ...edits };
      const lbls: Record<string, string> = { ...labelText };
      if (m.liveState) {
        for (let v = 0; v < nViews; v++) {
          const states = await Promise.all(
            Array.from({ length: nSw }, (_, i) => forgefx.fcState(layout, v, i).catch(() => null))
          );
          for (const s of states) {
            if (!s) continue;
            for (const [f, val] of Object.entries(s.fields)) if (val != null) vals[`${f}:${s.config}`] = val;
            lbls[`tapLabel:${s.config}`] = s.tapLabel;
            lbls[`holdLabel:${s.config}`] = s.holdLabel;
          }
        }
      }
      const pkg = buildAxisFcLayoutPackage({
        model: m,
        layout,
        value: (f, c) => vals[`${f}:${c}`],
        slot: (side, i, c) => vals[`${side}Params#${i}:${c}`],
        label: (side, c) => lbls[`${side}Label:${c}`]
      });
      const stem = pkg.layoutName.toLowerCase().replace(/[^\w-]+/g, '-');
      downloadText(`${stem}-fc-layout.json`, serializeAxisFcLayoutPackage(pkg));
      editor.showToast(`Exported ${pkg.switches.length} switches of ${pkg.layoutName}.`, 'var(--ok)');
    } catch (e) {
      editor.showToast('Export failed: ' + (e as Error).message, '#ff6b6b');
    } finally {
      ioBusy = false;
    }
  }

  /** Import a package into the selected layout (configs remapped; labels cleared when empty). */
  async function importLayout(ev: Event) {
    const input = ev.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // let the same file be re-imported
    if (!file || !model) return;
    ioBusy = true;
    try {
      const res = parseAxisFcLayoutPackage(await file.text());
      if (!res.ok) {
        editor.showToast('Import failed: ' + res.error, '#ff6b6b');
        return;
      }
      const writes = axisFcLayoutPackageWrites(res.pkg, layout, model);
      for (const w of writes) {
        if (w.kind === 'label') await writeLabel(`${w.side}Label`, w.text, w.config);
        else await forgefx.setParam(model.effectId, pidOf(w.field, w.config, w.index), w.value, false);
      }
      editor.showToast(`Imported ${res.pkg.switches.length} switches into ${layoutLabel(layout)}.`, 'var(--ok)');
      await loadState();
    } catch (e) {
      editor.showToast('Import failed: ' + (e as Error).message, '#ff6b6b');
    } finally {
      ioBusy = false;
    }
  }

  /** Discoverability hint for the two categories that map to the §3.8 features. */
  function categoryNote(side: string): string | null {
    const cat = cur(side + 'Category');
    if (cat === AXIS_FC_LAYOUT_CATEGORY) return 'Layout Link — changes layout after press (function: Select / Master Layout / Inc-Dec).';
    if (cat === AXIS_FC_PER_PRESET_CATEGORY) return 'Per-Preset switch — the PP definition itself is stored in the preset.';
    return null;
  }
</script>

<section class="fc" style="--c:{ACC}">
  <header class="fhead">
    <span class="dot"></span>
    <h2>Footswitches</h2>
    <span class="sub mono">FC EDIT · effect 199</span>
    <span class="spacer"></span>
    <button class="back" onclick={() => editor.openBuild()}>← Grid</button>
  </header>

  <!-- §3.8 FM3-Edit parity status. Every row is derived from the served /fc/model; gated features
       carry the honest reason instead of a control that would write an invented paramId. -->
  {#snippet parityPanel()}
    <div class="parity">
      <div class="ptitle mono">FM3-EDIT PARITY · §3.8</div>
      <ul class="plist">
        {#each parity as f (f.id)}
          <li class="prow {f.status}" title={f.detail}>
            <span class="pchip">{f.status === 'supported' ? 'available' : f.status === 'partial' ? 'partial' : 'gated'}</span>
            <span class="pname">{f.label}</span>
            <span class="pdetail">{f.detail}</span>
          </li>
        {/each}
      </ul>
      <div class="pio">
        <button class="pbtn" disabled={ioBusy || !importExportReady} onclick={exportLayout}>
          {ioBusy ? 'Working…' : `Export layout ${layoutLabel(layout)}`}
        </button>
        <label
          class="pbtn"
          class:disabled={ioBusy || !importExportReady}
          title={importExportReady ? 'Import an Axis FC layout file (.json)' : 'No switch geometry served — cannot enumerate a layout'}
        >
          Import layout
          <input
            class="pfile"
            type="file"
            accept=".json,application/json"
            disabled={ioBusy || !importExportReady}
            onchange={importLayout}
          />
        </label>
      </div>
    </div>
  {/snippet}

  <!-- §3.7 honesty gate: a metadata-driven control the served model cannot render, shown DISABLED
       with the exact missing metadata — so the editor never silently gets shorter. -->
  {#snippet gatedField(g: AxisFcFieldGate)}
    <div class="field gated" title={`${g.label} — gated: ${g.reason}`}>
      <span class="flbl">{g.label}</span>
      <span class="gbox" aria-disabled="true">
        <span class="gchip mono">gated</span>
        <span class="greason">{g.reason}</span>
      </span>
    </div>
  {/snippet}

  <!-- LED colour: swatches when the served model carries the colour table + base, else a gate. -->
  {#snippet colorField()}
    {#if gate('colors').available}
      <div class="field">
        <span class="flbl">Color</span>
        <div class="colors">
          {#each colorList as c (c.v)}
            <button class="csw" class:on={cur('color') === c.v} title={c.name} style="background:{c.hex}" onclick={() => write('color', c.v)} aria-label={c.name}></button>
          {/each}
        </div>
      </div>
    {:else}
      {@render gatedField(gate('colors'))}
    {/if}
  {/snippet}

  <!-- Custom label: the char input when labelLen + a label base are served, else a gate. -->
  {#snippet customLabelField(side: string)}
    {#if gate('customLabel').available}
      <div class="field">
        <span class="flbl">Custom Label</span>
        <input maxlength={model!.labelLen} placeholder="≤{model!.labelLen} chars" value={labelText[ek(side + 'Label')] ?? ''} onchange={(e) => writeLabel(side + 'Label', e.currentTarget.value)} />
      </div>
    {:else}
      {@render gatedField(gate('customLabel'))}
    {/if}
  {/snippet}

  {#if err}
    <div class="msg">{err}</div>
  {:else if !model}
    <div class="msg">Loading Foot Controller model…</div>
  {:else if !model.liveState}
    <!-- blind-write editor (no live read-back): FM9 = layout × switch grid; III = flat config picker -->
    <div class="body">
      <div class="banner">
        <b>No read-back on this device</b> — the fields below show what you've written this session
        (they start blank, not at the unit's current values). Writes are blind but device-true: they
        take effect on the unit immediately.
      </div>

      {#if hasGeometry}
        <div class="row">
          <span class="rlbl">LAYOUT</span>
          {#each Array(model.layouts) as _, i (i)}
            <button class="chip" class:on={layout === i} onclick={() => (layout = i)}>{layoutLabel(i)}</button>
          {/each}
        </div>

        <div class="board" style="grid-template-columns:{boardCols}">
          {#each Array(model.switches) as _, i (i)}
            {@const cfg = layout * (model.configsPerLayout ?? 0) + i}
            <button class="swtile" class:on={sw === i} onclick={() => (sw = i)}>
              <span class="swnum mono">{i + 1}</span>
              <span class="swcat">{catName(cur('tapCategory', cfg))}</span>
              <span class="swhold mono">HOLD · {catName(cur('holdCategory', cfg))}</span>
            </button>
          {/each}
        </div>
      {:else}
        <div class="row">
          <span class="rlbl">CONFIG</span>
          <input
            class="cfgnum mono"
            type="number"
            min="0"
            max={model.configs - 1}
            value={flatCfg}
            onchange={(e) => (flatCfg = Math.max(0, Math.min(model!.configs - 1, +e.currentTarget.value || 0)))}
          />
          <span class="cfghint mono">0…{model.configs - 1} — this device's FC config space is flat (no decomposition recovered)</span>
        </div>
      {/if}

      <div class="insp">
        <div class="ititle mono">
          {#if hasGeometry}SWITCH {sw + 1} · {layoutLabel(layout)}{:else}FC{/if}
          <span class="cfg">config {config}</span>
        </div>

        {#snippet blindCol(side: string, badge: string, badgeClass: string)}
          <div class="actcol">
            <div class="ahdr"><span class="abadge {badgeClass}">{badge}</span></div>
            <div class="field">
              <span class="flbl">Category {#if !catList.length}<span class="todo">raw</span>{/if}</span>
              {#if catList.length}
                <select value={cur(side + 'Category') ?? ''} onchange={(e) => setCategory(side, +e.currentTarget.value)}>
                  <option value="" disabled>—</option>
                  {#each catList as c (c.v)}<option value={c.v}>{c.label}</option>{/each}
                </select>
              {:else}
                <input type="number" min="0" value={cur(side + 'Category') ?? ''} placeholder="ordinal" onchange={(e) => setCategory(side, +e.currentTarget.value)} />
              {/if}
            </div>
            {#if categoryNote(side)}<span class="catnote">{categoryNote(side)}</span>{/if}
            <div class="field">
              <span class="flbl">Function <span class="todo">raw</span></span>
              <input type="number" min="0" value={cur(side + 'Function') ?? ''} placeholder="ordinal" onchange={(e) => write(side + 'Function', +e.currentTarget.value)} />
            </div>
            {#if labelModeFallback.length}
              <div class="field">
                <span class="flbl">Label</span>
                <select value={cur(side + 'Display') ?? ''} onchange={(e) => write(side + 'Display', +e.currentTarget.value)}>
                  <option value="" disabled>—</option>
                  {#each labelModeFallback as lab, li (li)}<option value={li}>{lab}</option>{/each}
                </select>
              </div>
            {:else}
              {@render gatedField(gate('labelModes'))}
            {/if}
            {@render customLabelField(side)}
            {#each Array(paramWidth(side)) as _, i (i)}
              <div class="field">
                <span class="flbl">Value {i + 1} <span class="todo">raw</span></span>
                <input type="number" value={curSlot(side, i) ?? ''} placeholder="—" onchange={(e) => writeSlot(side, i, +e.currentTarget.value)} />
              </div>
            {/each}
          </div>
        {/snippet}

        <div class="cols">
          {@render blindCol('tap', 'TAP', 'tap')}
          {@render blindCol('hold', 'HOLD', 'hold')}
        </div>

        {@render colorField()}

        <p class="note">
          Edits write to the unit immediately via the device-true FC parameter bases (effect
          {model.effectId}, {model.configs} configs). Function ordinals and the {model.paramsWidth}-wide
          value block are raw numeric fields — this device's per-category function lists aren't
          decoded yet. {#if gatedCount}Controls this device's served model cannot render ({gatedCount})
          are shown gated — disabled with the missing metadata named — rather than hidden.{:else}
          Every metadata-driven control is renderable from this device's served model.{/if}
        </p>
      </div>
      {@render parityPanel()}
    </div>
  {:else}
    <div class="body">
      <div class="row">
        <span class="rlbl">LAYOUT</span>
        {#each Array(model.layouts) as _, i (i)}
          <button class="chip" class:on={layout === i} onclick={() => selLayout(i)}>{layoutLabel(i)}</button>
        {/each}
      </div>
      <div class="row">
        <span class="rlbl">VIEW</span>
        {#each Array(model.views) as _, i (i)}
          <button class="chip mini" class:on={view === i} onclick={() => selView(i)}>{i + 1}</button>
        {/each}
      </div>

      <div class="board" style="grid-template-columns:{boardCols}">
        {#each Array(switches) as _, i (i)}
          {@const cfg = layout * (model.configsPerLayout ?? 0) + view * (model.switches ?? 0) + i}
          {@const col = colorList.find((x) => x.v === cur('color', cfg))?.hex ?? ACC}
          <button class="swtile" class:on={sw === i} onclick={() => selSwitch(i)}>
            <span class="led" style="background:{col}"></span>
            <span class="swnum mono">{i + 1}</span>
            {#if onDevice(cfg)}
              <span class="ondev mono" title="Configured on the device (live read)">●&nbsp;on unit</span>
            {/if}
            <span class="swcat">{catName(cur('tapCategory', cfg))}</span>
            <span class="swhold mono">HOLD · {catName(cur('holdCategory', cfg))}</span>
          </button>
        {/each}
      </div>

      <div class="insp">
        <div class="ititle mono">SWITCH {sw + 1} · {layoutLabel(layout)} · View {view + 1} <span class="cfg">config {config}</span></div>

        {#snippet actionCol(side: string, badge: string, badgeClass: string)}
          {@const fns = funcsFor(side)}
          {@const fnSel = cur(side + 'Function') ?? 0}
          {@const fnDef = fnDefFor(side)}
          {@const labels = fnDef?.labels?.length ? fnDef.labels : labelModeFallback}
          <div class="actcol">
            <div class="ahdr"><span class="abadge {badgeClass}">{badge}</span></div>
            <div class="field">
              <span class="flbl">Category</span>
              <select value={cur(side + 'Category') ?? ''} onchange={(e) => setCategory(side, +e.currentTarget.value)}>
                <option value="" disabled>—</option>
                {#each catList as c (c.v)}<option value={c.v}>{c.label}</option>{/each}
              </select>
            </div>
            {#if categoryNote(side)}<span class="catnote">{categoryNote(side)}</span>{/if}
            <div class="field">
              <span class="flbl">Function {#if !fns.length}<span class="todo">raw</span>{/if}</span>
              {#if fns.length}
                <select value={fnSel} onchange={(e) => write(side + 'Function', +e.currentTarget.value)}>
                  {#each fns as f (f.ord)}<option value={f.ord}>{f.name}</option>{/each}
                </select>
              {:else}
                <input type="number" min="0" value={cur(side + 'Function') ?? 0} onchange={(e) => write(side + 'Function', +e.currentTarget.value)} />
              {/if}
            </div>
            {#if fnDef}
              {#each fnDef.slots as slot (slot.i)}
                <div class="field">
                  <span class="flbl">{slot.role}</span>
                  {#if slot.type === 'bool'}
                    <select value={curSlot(side, slot.i) ?? 0} onchange={(e) => writeSlot(side, slot.i, +e.currentTarget.value)}>
                      <option value={0}>Off</option><option value={1}>On</option>
                    </select>
                  {:else if slot.type === 'enum'}
                    <select value={curSlot(side, slot.i) ?? 0} onchange={(e) => writeSlot(side, slot.i, +e.currentTarget.value)}>
                      {#each slot.options ?? [] as opt, oi (oi)}<option value={oi}>{opt}</option>{/each}
                    </select>
                  {:else if slot.type === 'channel'}
                    <select value={curSlot(side, slot.i) ?? 0} onchange={(e) => writeSlot(side, slot.i, +e.currentTarget.value)}>
                      {#each model!.channels as ch, ci (ci)}<option value={ci}>{ch}</option>{/each}
                    </select>
                  {:else if slot.type === 'block'}
                    <!-- The FC "Effect" assignment: a NAMED picker of the preset's placed blocks, not a bare
                         "block id" number. The raw id stays available (the mono hint), but the name is the
                         primary text; a value that names no placed block is MARKED, never a bare number. -->
                    {@const blockVal = curSlot(side, slot.i) ?? null}
                    {@const blockOpts = fcBlockOptionsIncluding(placed, blockVal)}
                    <select
                      value={blockVal === null ? '' : String(blockVal)}
                      title={blockRosterNote}
                      onchange={(e) => writeSlot(side, slot.i, +e.currentTarget.value)}
                    >
                      {#if blockVal === null}<option value="" disabled>— no value read</option>{/if}
                      {#each blockOpts as o (o.value)}
                        <option value={String(o.value)}>{o.label}</option>
                      {/each}
                    </select>
                    <span class="hint mono" title={FC_BLOCK_VALUE_SPACE_CAVEAT}>{fcBlockRawHint(blockVal)}</span>
                  {:else}
                    <input
                      type="number"
                      min={slot.min}
                      max={slot.max}
                      value={curSlot(side, slot.i) ?? slot.min ?? 0}
                      onchange={(e) => writeSlot(side, slot.i, +e.currentTarget.value)}
                    />
                  {/if}
                </div>
              {/each}
            {:else}
              <div class="field">
                <span class="flbl">Value <span class="todo">raw</span></span>
                <input type="number" min="0" onchange={(e) => writeSlot(side, 0, +e.currentTarget.value)} />
              </div>
            {/if}
            {#if labels.length}
              <div class="field">
                <span class="flbl">Label</span>
                <select value={cur(side + 'Display') ?? ''} onchange={(e) => write(side + 'Display', +e.currentTarget.value)}>
                  <option value="" disabled>—</option>
                  {#each labels as lab, li (li)}<option value={li}>{lab}</option>{/each}
                </select>
              </div>
            {:else}
              {@render gatedField(gate('labelModes'))}
            {/if}
            {@render customLabelField(side)}
          </div>
        {/snippet}

        <div class="cols">
          {@render actionCol('tap', 'TAP', 'tap')}
          {@render actionCol('hold', 'HOLD', 'hold')}
        </div>

        <!-- color -->
        {@render colorField()}

        <p class="note">
          Edits write to the FM3 immediately. Bank/Preset/Scene/Effect are fully modelled (function +
          typed value-slots); other categories show raw fields until decoded. A live read of the unit
          {#if reading}is in progress…{:else}flags which switches are configured on the device (the
          “on unit” badge){/if}; per-field value read-back (category/value/label) awaits a decode of the
          structured read's interior bytes. {#if gatedCount}{gatedCount} control{gatedCount === 1 ? '' : 's'}
          this model's served metadata cannot render {gatedCount === 1 ? 'is' : 'are'} shown gated, not
          hidden.{/if}
        </p>
      </div>
      {@render parityPanel()}
    </div>
  {/if}
</section>

<style>
  .fc {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .fhead {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 18px;
    border-bottom: 1px solid var(--line, var(--border2));
  }
  .fhead h2 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--c);
  }
  .sub {
    font-size: 11px;
    color: var(--textdim);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .spacer {
    flex: 1;
  }
  .back {
    background: transparent;
    border: 1px solid var(--line, var(--border2));
    color: var(--text);
    border-radius: 8px;
    padding: 6px 12px;
    font-size: 13px;
    cursor: pointer;
  }
  .back:hover {
    border-color: var(--c);
    color: var(--c);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 7px;
  }
  .rlbl {
    font: 700 10px/1 ui-monospace, monospace;
    color: var(--textfaint);
    letter-spacing: 0.08em;
    width: 54px;
  }
  .chip {
    min-width: 34px;
    height: 32px;
    padding: 0 11px;
    border-radius: 9px;
    border: 1px solid var(--border2);
    background: var(--track);
    color: var(--text2);
    font-weight: 700;
    font-size: 13px;
    cursor: pointer;
  }
  .chip.mini {
    min-width: 32px;
    padding: 0;
  }
  .chip.on {
    background: var(--c);
    border-color: var(--c);
    color: var(--bg2);
  }
  .board {
    display: grid;
    gap: 12px;
    max-width: 700px;
  }
  .swtile {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-height: 96px;
    padding: 16px 13px 12px;
    border-radius: 14px;
    border: 1px solid var(--border2);
    background: linear-gradient(180deg, var(--surface2), var(--surface));
    cursor: pointer;
    text-align: left;
  }
  .swtile.on {
    border-color: var(--c);
    box-shadow: 0 0 0 1px var(--c);
  }
  .led {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 5px;
    border-radius: 14px 14px 0 0;
  }
  .swnum {
    position: absolute;
    top: 9px;
    right: 11px;
    font-size: 10px;
    color: var(--textfaint);
  }
  .ondev {
    position: absolute;
    top: 9px;
    left: 11px;
    font-size: 9px;
    color: var(--ok);
    letter-spacing: 0.02em;
  }
  .swcat {
    font-size: 13px;
    font-weight: 700;
    color: var(--text);
  }
  .swhold {
    font-size: 10px;
    color: var(--textfaint);
  }
  .insp {
    border-top: 1px solid var(--surface2);
    padding-top: 14px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 620px;
  }
  .ititle {
    font-size: 11px;
    color: var(--text2);
    letter-spacing: 0.04em;
  }
  .cfg {
    color: var(--textmuted);
  }
  .cols {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }
  .actcol {
    flex: 1;
    min-width: 220px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ahdr {
    display: flex;
    align-items: center;
  }
  .abadge {
    font: 700 10px/1 ui-monospace, monospace;
    letter-spacing: 0.1em;
    padding: 4px 8px;
    border-radius: 6px;
  }
  .abadge.tap {
    background: var(--accent-tint);
    color: var(--accentbright);
  }
  .abadge.hold {
    background: var(--surface2);
    color: var(--amber);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .flbl {
    font-size: 12px;
    color: var(--textdim);
  }
  /* §3.7 honesty gate — a metadata-driven control shown disabled with its missing-metadata reason */
  .field.gated {
    opacity: 0.9;
  }
  .field.gated .flbl {
    color: var(--textfaint);
  }
  .gbox {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    padding: 7px 10px;
    border: 1px dashed var(--border2);
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.015);
    cursor: not-allowed;
  }
  .gchip {
    flex: none;
    font-size: 9px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--textfaint);
    border: 1px solid var(--border2);
    border-radius: 5px;
    padding: 1px 5px;
  }
  .greason {
    font-size: 10.5px;
    line-height: 1.4;
    color: var(--textfaint);
  }
  .todo {
    font-size: 9px;
    color: var(--textfaint);
    border: 1px solid var(--border2);
    border-radius: 4px;
    padding: 1px 4px;
  }
  select,
  input {
    height: 34px;
    background: var(--bg2);
    border: 1px solid var(--border2);
    border-radius: 9px;
    color: var(--text);
    padding: 0 11px;
    font-size: 13px;
    font-family: inherit;
  }
  select:focus,
  input:focus {
    border-color: var(--c);
    outline: none;
  }
  .colors {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .csw {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    border: 2px solid transparent;
    cursor: pointer;
  }
  .csw.on {
    border-color: var(--border3);
    box-shadow: 0 0 0 2px var(--c);
  }
  .note {
    font-size: 11.5px;
    color: var(--textfaint);
    line-height: 1.5;
    margin: 0;
    max-width: 620px;
  }
  .msg {
    flex: 1;
    display: grid;
    place-items: center;
    color: var(--textdim);
    font-size: 14px;
    padding: 24px;
    text-align: center;
  }
  /* blind-write mode (no read-back) */
  .banner {
    border: 1px solid var(--border2);
    border-left: 3px solid var(--c);
    border-radius: 9px;
    background: var(--surface);
    color: var(--textdim);
    font-size: 12px;
    line-height: 1.5;
    padding: 10px 12px;
    max-width: 700px;
  }
  .banner b {
    color: var(--text2);
  }
  .cfgnum {
    width: 110px;
  }
  .cfghint {
    font-size: 10px;
    color: var(--textfaint);
  }
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  /* the raw block id — AVAILABLE under the named picker, but secondary */
  .hint {
    font-size: 10px;
    color: var(--textfaint);
  }
  /* §3.8 parity status + layout import/export */
  .parity {
    border-top: 1px solid var(--surface2);
    padding-top: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 700px;
  }
  .ptitle {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--textfaint);
  }
  .plist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .prow {
    display: grid;
    grid-template-columns: 68px 150px 1fr;
    gap: 10px;
    align-items: baseline;
    font-size: 12px;
  }
  .pchip {
    font: 700 9px/1.6 ui-monospace, monospace;
    letter-spacing: 0.06em;
    text-align: center;
    text-transform: uppercase;
    border-radius: 6px;
    padding: 2px 6px;
    border: 1px solid var(--border2);
    color: var(--textdim);
  }
  .prow.supported .pchip {
    border-color: var(--ok);
    color: var(--ok);
  }
  .prow.unsupported .pchip {
    border-color: var(--border2);
    color: var(--textfaint);
  }
  .pname {
    color: var(--text);
    font-weight: 600;
  }
  .pdetail {
    color: var(--textfaint);
    font-size: 11px;
    line-height: 1.45;
  }
  .pio {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .pbtn {
    position: relative;
    display: inline-flex;
    align-items: center;
    height: 32px;
    padding: 0 12px;
    border-radius: 9px;
    border: 1px solid var(--border2);
    background: var(--track);
    color: var(--text2);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .pbtn:hover:not(.disabled) {
    border-color: var(--c);
    color: var(--c);
  }
  .pbtn.disabled,
  .pbtn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .pfile {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
    height: auto;
    padding: 0;
  }
  .catnote {
    font-size: 10.5px;
    line-height: 1.4;
    color: var(--amber);
  }
</style>
