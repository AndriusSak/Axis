<script lang="ts">
  import { onMount } from 'svelte';
  import { editor } from '$lib/editor.svelte';
  import { history } from '$lib/history.svelte';
  import { surfInit } from '$lib/surfaceStore.svelte';
  import HistoryPanel from '$lib/HistoryPanel.svelte';
  import ToolRail from '$lib/ToolRail.svelte';
  import TopBar from '$lib/TopBar.svelte';
  import SignalGrid from '$lib/SignalGrid.svelte';
  import BlockEditor from '$lib/BlockEditor.svelte';
  import VirtualScreen from '$lib/VirtualScreen.svelte';
  import PresetBrowser from '$lib/PresetBrowser.svelte';
  import FcEditor from '$lib/FcEditor.svelte';
  import CommandPalette from '$lib/CommandPalette.svelte';
  import CabPicker from '$lib/CabPicker.svelte';
  import DeviceTools from '$lib/DeviceTools.svelte';
  import ConvertDialog from '$lib/ConvertDialog.svelte';
  import ConvertScratchView from '$lib/ConvertScratchView.svelte';
  import { convert } from '$lib/convert.svelte';
  import { convertScratch } from '$lib/convertScratch.svelte';
  import PresetPicker from '$lib/PresetPicker.svelte';
  import SaveDialog from '$lib/SaveDialog.svelte';
  import BlockLibraryPanel from '$lib/BlockLibraryPanel.svelte';
  import PresetTemplatesPanel from '$lib/PresetTemplatesPanel.svelte';
  import TunerOverlay from '$lib/TunerOverlay.svelte';
  import CachePrompt from '$lib/CachePrompt.svelte';
  import DeviceDefsPrompt from '$lib/DeviceDefsPrompt.svelte';
  import AxisPanel from '$lib/AxisPanel.svelte';
  import ThemePicker from '$lib/ThemePicker.svelte';
  import Notices from '$lib/Notices.svelte';
  import StatusBar from '$lib/StatusBar.svelte';
  import Tour from '$lib/Tour.svelte';
  import Toast from '$lib/Toast.svelte';
  import AxisWorkbenchShell from '$lib/axis-workbench/AxisWorkbenchShell.svelte';
  import RemoteGate from '$lib/RemoteGate.svelte';
  import DirectGate from '$lib/DirectGate.svelte';
  import MobileGate from '$lib/MobileGate.svelte';
  import { remoteBoot } from '$lib/remote.svelte';
  import { directBoot } from '$lib/direct.svelte';
  import { mobileBoot } from '$lib/mobile.svelte';
  import { notifyReady as otaNotifyReady, checkForUpdate as otaCheck } from '$lib/direct/ota';
  import { isAxisWorkbenchFeatureEnabled } from '$lib/axis-workbench/featureGate';
  import { pollIntervalsFor } from '$lib/pollIntervals';
  import { resolveShortcut, isEditingTarget } from '$lib/shortcuts';

  // In the remote web build, gate the app behind sign-in + relay-connect; start the editor only once the
  // remote transport is live. In the desktop build (remoteBoot.active=false) it starts immediately.
  let started = $state(false);
  const workbenchEnabled = isAxisWorkbenchFeatureEnabled(import.meta.env);
  function startApp() {
    if (started) return;
    started = true;
    void surfInit(); // load control-surface layouts from the config store (host: cache is already seeded)
    editor.init();
    editor.poll();
  }
  // Poll/preset-watch loops. The interval depends on the active telemetry polling mode (META-17/AXIS-40):
  // faster modes reflect device changes sooner at the cost of traffic; remote sessions are event-driven
  // and clamp to a slow relay floor (pollIntervals.ts). Rebuild BOTH intervals whenever the mode changes
  // (this $effect re-runs on editor.pollingMode / started) — clearing + re-creating the two setIntervals.
  $effect(() => {
    if (!started) return;
    const { pollMs, watchMs } = pollIntervalsFor(editor.pollingMode, remoteBoot.active);
    const tp = setInterval(() => editor.poll(), pollMs);
    const tw = setInterval(() => editor.watchPreset(), watchMs);
    return () => { clearInterval(tp); clearInterval(tw); };
  });
  // Web build: start the app the moment the relay session (remote) or the in-page runtime (direct)
  // goes live. Desktop starts immediately in onMount.
  $effect(() => { if (remoteBoot.active && remoteBoot.phase === 'ready') startApp(); });
  $effect(() => { if (directBoot.active && directBoot.phase === 'ready') startApp(); });
  $effect(() => { if (mobileBoot.active && mobileBoot.phase === 'ready') startApp(); });

  onMount(() => {
    editor.setViewport(window.innerWidth, window.innerHeight);
    if (mobileBoot.active) {
      // Confirm the running web bundle so Capgo doesn't roll it back, then check for an OTA update.
      // MobileGate drives connect; startApp() fires when ready.
      void otaNotifyReady().then(() => otaCheck());
    } else if (remoteBoot.active) remoteBoot.init(); // resume session / show the gate; startApp() fires when ready
    else if (directBoot.active) { /* DirectGate drives connect; startApp() fires when ready */ }
    else startApp();

    const onResize = () => editor.setViewport(window.innerWidth, window.innerHeight);
    // Central shortcut dispatch — the registry ($lib/shortcuts) owns the chord map; this switch binds
    // each wired id to its action. Bare chords never fire while typing (isEditingTarget guard); chords
    // that must reach a field (⌘K palette, ⌘S save) are flagged allowWhileEditing in the registry.
    const onKey = (e: KeyboardEvent) => {

      const def = resolveShortcut(e, isEditingTarget(e.target));
      if (!def || def.status !== 'wired') return;
      switch (def.id) {
        case 'palette':
          e.preventDefault();
          editor.paletteMode = 'place';
          editor.placeTarget = null;
          editor.paletteOpen = true;
          return;
        case 'undo':
          e.preventDefault();
          void history.undo();
          return;
        case 'redo':
          e.preventDefault();
          void history.redo();
          return;
        case 'save':
          e.preventDefault();
          editor.openSave();
          return;
        case 'presetPicker':
          if (editor.presetOpen) return;
          e.preventDefault();
          editor.presetOpen = true;
          return;
        // FM3-Edit A/B/C/D channel keys — apply to the selected block; do nothing (and DON'T swallow the
        // key) when nothing is selected, so grid/keyboard navigation is unaffected.
        case 'channelA': case 'channelB': case 'channelC': case 'channelD': {
          if (!editor.selected) return;
          e.preventDefault();
          void editor.setChannel(def.id.slice(-1).toUpperCase());
          return;
        }
        case 'bypass':
          if (!editor.selected) return; // no selection → let Space scroll the page
          e.preventDefault();
          void editor.toggleBypass();
          return;
        case 'deleteBlock':
          if (!editor.selected) return;
          e.preventDefault();
          void editor.removeSelected();
          return;
        case 'dismiss':
          if (editor.tourActive) return; // Tour.svelte owns Escape while the tour is up
          if (editor.tuner.active) editor.toggleTuner();
          else if (history.panelOpen) history.panelOpen = false;
          else if (editor.cabPickerOpen) editor.cabPickerOpen = false;
          else if (editor.paletteOpen) editor.paletteOpen = false;
          else if (convertScratch.open) convertScratch.close();
          else if (convert.open) convert.close();
          else if (editor.presetOpen) editor.presetOpen = false;
          else if (editor.linkFrom) editor.cancelLink(); // disarm tap-to-connect before closing the editor
          else if (editor.editorOpen) editor.closeEditor();
          return;
        // grid/structure ops (audit §2.9) — FM3-Edit Cmd+D/U/I/C/V
        case 'disconnectCable': {
          const c = editor.selected;
          if (!c) return; // no selection → don't swallow the key
          e.preventDefault();
          void editor.disconnectAll(c.row, c.col);
          return;
        }
        case 'insertShunt': {
          const t = editor.firstEmptyCell;
          if (!t) return;
          e.preventDefault();
          void editor.insertShunt(t.row, t.col);
          return;
        }
        case 'resetChannel': {
          const c = editor.selected;
          if (!c || c.kind !== 'block') return;
          e.preventDefault();
          void editor.resetBlock(c);
          return;
        }
        case 'copyBlock': {
          const c = editor.selected;
          if (!c || c.kind !== 'block') return;
          e.preventDefault();
          void editor.copyBlock(c);
          return;
        }
        case 'pasteBlock': {
          const t = editor.selected ?? editor.firstEmptyCell;
          if (!t) return;
          e.preventDefault();
          void editor.pasteBlock(t.row, t.col);
          return;
        }

      }
    };
    // Unsaved-changes guard, web mode only — in the desktop build the Electron main process owns the
    // close dialog (fed by the setDirty $effect below); double-blocking here would fight it.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if ((window as unknown as { axisDesktop?: { isDesktop?: boolean } }).axisDesktop?.isDesktop) return;
      if (!editor.layout.crcValid) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      // The poll/watch intervals are owned by the $effect above (it clears them on teardown).
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  });

  // Desktop: push the edit-buffer dirty flag to the Electron main process, which shows the native
  // "Unsaved changes" dialog on window close (crcValid = device CRC matches the stored preset).
  $effect(() => {
    (window as unknown as { axisDesktop?: { setDirty?: (d: boolean) => void } }).axisDesktop?.setDirty?.(!editor.layout.crcValid);
  });
</script>

{#if mobileBoot.active && mobileBoot.phase !== 'ready'}
  <MobileGate />
{:else if remoteBoot.active && remoteBoot.phase !== 'ready'}
  <RemoteGate />
{:else if directBoot.active && directBoot.phase !== 'ready'}
  <DirectGate />
{:else}
<div class="app">
  {#if workbenchEnabled}
    <AxisWorkbenchShell />
  {:else}
    <ToolRail />
    <div class="main">
      <TopBar />
      {#if editor.inLibrary}
        <PresetBrowser />
      {:else if editor.virtual?.slug === 'fc'}
        <FcEditor />
      {:else if editor.virtual}
        <VirtualScreen />
      {:else}
        <SignalGrid />
        <BlockEditor />
      {/if}
      <StatusBar />
    </div>
  {/if}
  <CommandPalette />
  <CabPicker />
  <DeviceTools />
  <ConvertDialog />
  <ConvertScratchView />
  <HistoryPanel />
  <PresetPicker />
  <SaveDialog />
  <BlockLibraryPanel />
  <PresetTemplatesPanel />
  <TunerOverlay />
  <CachePrompt />
  <DeviceDefsPrompt />
  <AxisPanel />
  {#if editor.themeOpen}<ThemePicker onclose={() => (editor.themeOpen = false)} />{/if}
  <Notices />
  <Tour />
  <Toast />
</div>
{/if}

<style>
  .app {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: row;
    background: var(--bg);
    color: var(--text);
    overflow: hidden;
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    position: relative;
  }
</style>
