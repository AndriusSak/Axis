<script lang="ts">
  import { editor } from './editor.svelte';
  import { history } from './history.svelte';
  import { gateRailItem } from './gateRailItems';

  const RAIL = [
    { id: 'build', label: 'Build', short: 'Grid', icon: '▦' },
    { id: 'library', label: 'Preset Browser', short: 'Lib', icon: '≣' },
    { id: 'controllers', label: 'Controllers', short: 'Ctrl', icon: '⊜' },
    { id: 'fc', label: 'Footswitches', short: 'FC', icon: '⬚' },
    { id: 'scenes', label: 'Scene Mgr', short: 'Scn', icon: '❏' },
    { id: 'perform', label: 'Perform', short: 'Live', icon: '▷' },
    { id: 'sets', label: 'Sets & Songs', short: 'Sets', icon: '≣' },
    { id: 'settings', label: 'Settings', short: 'Setup', icon: '⚙' }
  ];

  // Rail items backed by a virtual effect: "the block editor pointed at effectId N".
  // Static fallback for legacy (v1) servers; on API v2 the device's caps.virtualEffects wins.
  const VIRTUAL: Record<string, { eid: number; slug: string; name: string }> = {
    settings: { eid: 1, slug: 'global', name: 'Setup' },
    controllers: { eid: 2, slug: 'controllers', name: 'Controllers' },
    fc: { eid: 199, slug: 'fc', name: 'Footswitches' }
  };
  const VIRTUAL_SLUG: Record<string, string> = { settings: 'global', controllers: 'controllers', fc: 'fc' };
  /** The virtual effect backing a rail item — the device's own caps entry when available. */
  const virtualFor = (id: string): { eid: number; slug: string; name: string } | undefined =>
    editor.caps?.virtualEffects?.find((v) => v.slug === VIRTUAL_SLUG[id]) ?? VIRTUAL[id];

  // Rail visibility + availability is capability-driven (gateRailItems.ts, parity audit §3.5). Setup
  // and Controllers are NEVER silently removed: when the served capabilities do not carry their virtual
  // effect the entry stays visible and renders DISABLED with the exact reason in its tooltip, so the
  // user learns why the screen is unavailable instead of finding it gone (no-dead-nav rule, 01-shell §9).
  // build/library are always available; the out-of-scope ids (FC + the coming-soon routing family) keep
  // the legacy capability filter.
  const railItems = $derived.by(() => {
    const input = { isV2: editor.isV2, isAm4: editor.isAm4, caps: editor.caps };
    return RAIL.map((r) => ({ ...r, ...gateRailItem(input, r.id) })).filter((r) => r.visible);
  });
  // Device Tools shows whenever the device has ANY tool capability. A v1 server (or an AM4, which
  // serves no capabilities) advertises none, so the button must NOT appear — every DeviceTools gate
  // is `!!caps?.X`, so an AM4/v1 with no caps would otherwise open an empty modal (P9 review).
  const showTools = $derived(
    editor.isV2 && editor.caps
      ? !!(editor.caps.backupDump || editor.caps.restoreDump || editor.caps.firmwareValidate || editor.caps.modifiers?.model)
      : false
  );

  const closeDrawer = () => (editor.drawerOpen = false);

  function pick(id: string) {
    closeDrawer(); // mobile: dismiss the drawer on any nav pick
    if (id === 'build') {
      editor.openBuild();
      return;
    }
    if (id === 'library') {
      editor.openLibrary();
      return;
    }
    const v = virtualFor(id);
    if (v) {
      editor.railActive = id;
      editor.openVirtual(v.eid, v.slug, v.name);
      return;
    }
    // No fallthrough: every remaining rail id (perform/sets/scenes) is gated DISABLED by gateRailItems
    // (no-dead-nav rule, 01-shell §9), so its button is not clickable and cannot arrive here. There is
    // deliberately no placeholder WIP toast — an unavailable screen renders disabled with its reason in
    // the tooltip instead of lying about it.
  }

  const dot = $derived(
    editor.conn.state === 'online' ? 'var(--ok)' : editor.conn.state === 'offline' ? 'var(--danger)' : 'var(--amber)'
  );
  const connText = $derived(
    editor.conn.state === 'online' ? `Connected${editor.conn.fw ? ` · FW ${editor.conn.fw}` : ''}` : editor.conn.state === 'offline' ? 'Offline' : 'Connecting…'
  );
</script>

{#if !editor.isMobile}
  <!-- ── desktop tool rail ── -->
  <nav class="rail">
    <div class="logo" aria-label="Axis">
      <svg width="30" height="30" viewBox="0 0 30 30">
        <circle cx="9" cy="9" r="3.4" fill="#35c9d6" />
        <circle cx="21" cy="9" r="3.4" fill="#4f6bed" />
        <circle cx="15" cy="21" r="3.4" fill="#f5a623" />
        <path d="M9 9 L21 9 L15 21 Z" fill="none" stroke="var(--border3)" stroke-width="1.6" />
      </svg>
    </div>
    {#each railItems as r}
      <button
        class="item"
        class:gated={!r.enabled}
        data-tour={r.id}
        class:active={editor.railActive === r.id}
        disabled={!r.enabled}
        title={r.enabled ? r.label : r.reason}
        onclick={() => pick(r.id)}
      >
        <span class="ic">{r.icon}</span>
        <span class="sh">{r.short}</span>
      </button>
    {/each}
    <div class="spacer"></div>
    {#if showTools}
      <button class="item" class:active={editor.deviceToolsOpen} title="Device Tools — preset backup/restore, .syx decode, firmware validate, modifiers" onclick={() => (editor.deviceToolsOpen = true)}>
        <span class="ic">⛃</span>
        <span class="sh">Tools</span>
      </button>
    {/if}
    <button class="item" class:active={history.panelOpen} title="History — changelog & undo (Ctrl+Z)" onclick={() => (history.panelOpen = !history.panelOpen)}>
      <span class="ic">↶</span>
      <span class="sh">History</span>
    </button>
    <button class="item" class:active={editor.themeOpen} title="Appearance — theme, accent & scale" onclick={() => (editor.themeOpen = true)}>
      <span class="ic">◐</span>
      <span class="sh">Theme</span>
    </button>
    <button class="item acct" data-tour="axis" class:active={editor.axisOpen} title={editor.cloud.user ? `Axis · ${editor.cloud.user.email}` : 'Axis — account, privacy & about'} onclick={() => editor.openAxis('account')}>
      {#if editor.cloud.user}
        <span class="av">{editor.cloud.user.email.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase() || '?'}</span>
        {#if editor.cloud.syncing}<span class="syncdot"></span>{/if}
      {:else}
        <span class="ic">◈</span>
      {/if}
      <span class="sh">Axis</span>
    </button>
    <button class="conn" data-tour="conn" title="Connection — click to pick the port" onclick={() => editor.openPorts()}>
      <span class="led" style="background:{dot}; box-shadow:0 0 8px {dot}"></span>
      <span class="mono fw">{editor.conn.fw ? `FW${editor.conn.fw}` : editor.conn.state === 'offline' ? 'OFF' : '···'}</span>
    </button>
  </nav>
{:else if editor.drawerOpen}
  <!-- ── mobile nav drawer (replaces the rail) ── -->
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div class="scrim" onclick={closeDrawer} role="presentation"></div>
  <aside class="drawer">
    <div class="d-head">
      <svg width="26" height="26" viewBox="0 0 30 30" class="d-logo">
        <circle cx="9" cy="9" r="3.4" fill="#35c9d6" />
        <circle cx="21" cy="9" r="3.4" fill="#4f6bed" />
        <circle cx="15" cy="21" r="3.4" fill="#f5a623" />
      </svg>
      <div class="d-title">
        Axis
        <div class="d-sub"><span class="d-led" style="background:{dot}"></span>{connText}</div>
      </div>
      <button class="d-x" aria-label="Close menu" onclick={closeDrawer}>✕</button>
    </div>

    <div class="d-body scroll">
      <div class="d-nav">
        {#each railItems as r}
          <button
            class="d-item"
            class:gated={!r.enabled}
            class:active={editor.railActive === r.id}
            disabled={!r.enabled}
            title={r.enabled ? r.label : r.reason}
            onclick={() => pick(r.id)}
          >
            <span class="d-ic">{r.icon}</span><span class="d-lbl">{r.label}</span>
          </button>
        {/each}
      </div>

      {#if editor.sceneCount > 0}
        <div class="d-sec">SCENE</div>
        <div class="d-scenes">
          {#each Array(editor.sceneCount) as _, i}
            {@const s = i + 1}
            <button class="d-scn" class:on={editor.scene === s} onclick={() => editor.selectScene(s)}>{s}</button>
          {/each}
        </div>
      {/if}

      <div class="d-sec">DEFAULT VIEW</div>
      <div class="d-seg">
        <button class:on={editor.globalMode === 'basic'} onclick={() => editor.setGlobalMode('basic')}>Basic</button>
        <button class:on={editor.globalMode === 'advanced'} onclick={() => editor.setGlobalMode('advanced')}>Advanced</button>
      </div>

      {#if editor.hasTuner || editor.hasTempo}
        <div class="d-sec">STATUS</div>
        <div class="d-status">
          {#if editor.hasTuner}
            <button class="d-stat" class:on={editor.tuner.active} onclick={() => { editor.toggleTuner(); closeDrawer(); }}>
              <span class="d-stat-ic">♪</span><span>Tuner</span><span class="d-stat-v mono">{editor.tuner.active ? (editor.tuner.note ?? '…') : ''}</span>
            </button>
          {/if}
          {#if editor.hasTempo}
            <button class="d-stat" onclick={() => editor.tapTempo()}>
              <span class="d-stat-ic">◷</span><span>Tap tempo</span><span class="d-stat-v mono">{editor.bpm} BPM</span>
            </button>
          {/if}
        </div>
      {/if}
    </div>

    <div class="d-foot">
      <button class="d-foot-b" onclick={() => { closeDrawer(); history.panelOpen = true; }}><span class="d-ic">↶</span>History</button>
      <button class="d-foot-b" onclick={() => { closeDrawer(); editor.themeOpen = true; }}><span class="d-ic">◐</span>Theme</button>
      <button class="d-foot-b" onclick={() => { closeDrawer(); editor.openAxis('account'); }}>
        <span class="d-ic">◈</span>{editor.cloud.user ? 'Account' : 'Sign in'}
      </button>
      <button class="d-foot-b" onclick={() => { closeDrawer(); editor.openPorts(); }}><span class="d-led" style="background:{dot}"></span>Connection</button>
    </div>
  </aside>
{/if}

<style>
  .rail {
    width: var(--rail-w);
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    padding: 13px 0;
    background: var(--bg-rail);
    border-right: 1px solid var(--border);
    z-index: 10;
  }
  .logo {
    margin-bottom: 10px;
  }
  .item {
    width: 52px;
    height: 50px;
    border: 1px solid transparent;
    border-radius: 12px;
    background: transparent;
    color: var(--text-mut);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .item:hover {
    background: var(--surface-2);
    color: var(--text2);
  }
  .item.active {
    color: var(--accent);
    background: var(--accent-tint);
    border-color: var(--accent-border);
  }
  /* §3.5 capability-gated entry: visibly disabled with its reason in the tooltip — never a silent
     removal, and never clickable (native `disabled` swallows the click). */
  .item:disabled,
  .item.gated {
    opacity: 0.38;
    cursor: not-allowed;
  }
  .item:disabled:hover {
    background: transparent;
    color: var(--text-mut);
  }
  .acct { position: relative; }
  .av {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accentink);
    font: 800 11px/28px 'JetBrains Mono', monospace;
    text-align: center;
  }
  .syncdot {
    position: absolute;
    top: 6px;
    right: 9px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--amber);
    border: 2px solid var(--surface, var(--bg2));
    box-shadow: 0 0 6px var(--amber);
  }
  .ic {
    font-size: 19px;
    line-height: 1;
  }
  .sh {
    font-size: 8.5px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .spacer {
    flex: 1;
  }
  .conn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 8px 0;
    width: 52px;
    border: 1px solid transparent;
    border-radius: 12px;
    background: transparent;
    cursor: pointer;
  }
  .conn:hover {
    background: var(--surface-2);
    border-color: var(--surface-3);
  }
  .led {
    width: 9px;
    height: 9px;
    border-radius: 50%;
  }
  .fw {
    font-size: 8px;
    color: var(--border3);
  }

  /* ── mobile drawer ── */
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 150;
    background: rgba(6, 6, 8, 0.6);
    backdrop-filter: blur(3px);
    animation: axsOverlay 0.14s ease;
  }
  .drawer {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 151;
    width: 286px;
    max-width: 84vw;
    display: flex;
    flex-direction: column;
    background: linear-gradient(180deg, var(--surface), var(--bg2));
    border-right: 1px solid var(--border2);
    box-shadow: 8px 0 44px rgba(0, 0, 0, 0.55);
    animation: axsDrawer 0.26s cubic-bezier(0.2, 0.8, 0.3, 1);
    padding-top: var(--axis-safe-top);
  }
  .d-head {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 18px 16px 15px;
    border-bottom: 1px solid var(--border);
    flex: none;
  }
  .d-logo { flex: none; }
  .d-title {
    flex: 1;
    min-width: 0;
    font-size: 16px;
    font-weight: 800;
    color: var(--text);
  }
  .d-sub {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 500;
    color: var(--textdim);
    margin-top: 2px;
  }
  .d-led {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
  }
  .d-x {
    flex: none;
    width: 34px;
    height: 34px;
    border: 0;
    border-radius: 9px;
    background: var(--bg2);
    color: var(--textdim);
    font-size: 14px;
    cursor: pointer;
  }
  .d-x:active { background: var(--surface2); }
  .d-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 12px 12px 8px;
  }
  .d-nav {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .d-item {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 46px;
    padding: 0 13px;
    border: 1px solid transparent;
    border-radius: 11px;
    background: transparent;
    color: var(--text2);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    text-align: left;
  }
  .d-item:active { background: var(--surface2); }
  .d-item.active {
    color: var(--accent);
    background: var(--accent-tint);
    border-color: var(--accent-border);
  }
  /* §3.5: a capability-gated entry stays visible in the drawer, disabled, reason in its tooltip. */
  .d-item:disabled,
  .d-item.gated {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .d-ic {
    font-size: 18px;
    width: 22px;
    text-align: center;
    flex: none;
  }
  .d-sec {
    font: 700 9px/1 var(--font-mono);
    letter-spacing: 0.12em;
    color: var(--textfaint);
    margin: 16px 4px 9px;
  }
  .d-scenes {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 7px;
  }
  .d-scn {
    height: 40px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--surface);
    color: var(--textdim);
    font: 700 13px/1 var(--font-mono);
    cursor: pointer;
  }
  .d-scn.on {
    background: var(--accent);
    color: var(--accentink);
    border-color: var(--accent);
  }
  .d-seg {
    display: flex;
    gap: 6px;
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 11px;
    padding: 4px;
  }
  .d-seg button {
    flex: 1;
    height: 36px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--textdim);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }
  .d-seg button.on {
    background: var(--accent);
    color: var(--accentink);
  }
  .d-status {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .d-stat {
    display: flex;
    align-items: center;
    gap: 11px;
    height: 44px;
    padding: 0 13px;
    border: 1px solid var(--border);
    border-radius: 11px;
    background: var(--surface);
    color: var(--text2);
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
    text-align: left;
  }
  .d-stat.on {
    color: var(--accent);
    background: var(--accent-tint);
    border-color: var(--accent-border);
  }
  .d-stat-ic { font-size: 16px; width: 20px; text-align: center; flex: none; }
  .d-stat-v {
    margin-left: auto;
    font-size: 12px;
    font-weight: 700;
    color: var(--textdim);
  }
  .d-foot {
    flex: none;
    display: flex;
    gap: 6px;
    padding: 10px 12px calc(10px + var(--axis-safe-bottom));
    border-top: 1px solid var(--border);
  }
  .d-foot-b {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    padding: 9px 4px;
    border: 1px solid var(--border);
    border-radius: 11px;
    background: var(--surface);
    color: var(--text2);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }
  .d-foot-b:active { background: var(--surface2); }

</style>
