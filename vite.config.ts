import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Kit 3 no longer reads svelte.config.js — the kit config lives here instead.
// The desktop app + ForgeFX load the built files over file:// / same-origin, so assets must be
// referenced RELATIVELY there. The remote web build (axisapp.live) is hosted at a domain root and
// relies on SPA fallback for any path, so it needs ABSOLUTE asset paths instead.
const remote = process.env.VITE_AXIS_REMOTE === '1';

export default defineConfig({
  // expose the package version to the client (used by the in-app update checker)
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: {
      // Kit 3 dropped the built-in `$lib` alias in favour of `#lib`. Keep `$lib` working so the
      // existing imports don't all need rewriting (see kit/module_removed_lib).
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
      // Vite dev pre-bundling resolves lazy dynamic imports too. The real serial transport lives in the
      // ForgeFX server/Electron Node process; browser/direct mode uses Web MIDI/Serial instead.
      serialport: fileURLToPath(new URL('./src/lib/shims/serialport.ts', import.meta.url))
    }
  },
  build: {
    rollupOptions: {
      // forgefx-midi's Node serial connector holds a LAZY `import('serialport')` that is only reachable
      // behind a Node-only connect call — Browser Direct injects Web MIDI/Serial transports instead, so
      // it never executes in the browser. Rollup insists on resolving it anyway; mark it external.
      external: ['serialport']
    }
  },
  plugins: [
    sveltekit({
      // Axis is a pure SPA (adapter-static, index.html fallback).
      adapter: adapter({ fallback: 'index.html', strict: false }),
      // `base` lets the web build live under a path prefix (e.g. /live on the dashboard) without
      // changing the catch-all: SvelteKit rewrites every asset/route URL, so hosting it as /live/
      // just works. Desktop and axisapp.live builds leave it empty.
      paths: {
        relative: !remote,
        base: (process.env.AXIS_BASE ?? '') as '' | `/${string}`
      },
      // Don't auto-register the service worker. The desktop build is served same-origin over
      // http://localhost, where an SW would intercept the ForgeFX API/SSE — so we register it
      // MANUALLY, and only in the remote web build (see +layout.svelte).
      serviceWorker: { register: false }
    })
  ],
  server: {
    // proxy API calls to ForgeFX during dev so the SPA can use same-origin /api paths
    proxy: {
      '/api': {
        target: 'http://localhost:5056',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, '')
      }
    }
  }
});
