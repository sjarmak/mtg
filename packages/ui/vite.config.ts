/**
 * Vite config for `@mtg/ui`, scoped to this package.
 *
 * Workspace packages resolve source-first (`main: ./src/index.ts`, no build
 * step in dev), so `@mtg/*` is aliased straight at each package's entry rather
 * than left to node resolution, which would otherwise hand Vite a bare `.ts`
 * main from outside the project root.
 *
 * `@mtg/sim` is imported at runtime for exactly one module, the tier-1 bot, and
 * only through its `@mtg/sim/bot` subpath. Its *barrel* stays out of the bundle
 * — that is what drags `node:worker_threads` and `node:fs` in — so the replay
 * reader still takes types from it and nothing else.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const packageDir = fileURLToPath(new URL('.', import.meta.url));
const packagesDir = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root: packageDir,
  plugins: [react()],
  // Which symbol set the page paints rules text with, decided by whoever
  // started the server rather than compiled in. `tools/stage-symbols.ts` sets
  // `MTG_SYMBOL_SET` to `local` only when it has served every symbol from
  // `public/symbols/`; anything else — a bare `vite dev`, a launcher that could
  // not reach the host — leaves it empty and `src/card/symbols.ts` falls back to
  // the lab's own drawings. A substitution rather than `import.meta.env` because
  // that module is read by Node too, where `import.meta.env` does not exist.
  define: { __MTG_SYMBOL_SET__: JSON.stringify(process.env['MTG_SYMBOL_SET'] ?? '') },
  resolve: {
    alias: [
      // `@mtg/dsl`'s barrel reaches `node:crypto` through its fingerprint
      // module; see `src/shims/node-crypto.ts` for why a stand-in is needed and
      // why it throws instead of faking a digest.
      { find: /^node:crypto$/, replacement: `${packageDir}src/shims/node-crypto.ts` },
      // The tier-1 bot, and the reason it is named before the general rule
      // below: `@mtg/sim/bot` is one module rather than the package, so the
      // catch-all would resolve it to a `sim/bot/` directory that does not
      // exist. It is also the whole point of the subpath — the barrel it skips
      // is what reaches `node:worker_threads` and `node:fs`.
      { find: /^@mtg\/sim\/bot$/, replacement: `${packagesDir}sim/src/greedy-bot.ts` },
      { find: /^@mtg\/(.*)$/, replacement: `${packagesDir}$1/src/index.ts` },
    ],
  },
  // Vite answers "Blocked request. This host is not allowed" to any request
  // whose Host header is a name rather than an IP literal, which is its
  // defense against DNS rebinding. The lab is meant to be looked at over a
  // tunnel — `npm run lab` already copies art locally so the page holds up on
  // the far end of one — and a Tailscale MagicDNS name is exactly the Host
  // header that arrives there. The leading dot allows any `*.ts.net` tailnet
  // and nothing else; `true` would allow every name on the internet.
  //
  // `host` and `allowedHosts` are two halves of one arrangement and neither
  // works alone. Vite binds to loopback by default, so a request arriving on
  // the Tailscale interface never reaches the listener however the Host header
  // is spelled: `allowedHosts` on its own is a door policy on a door nobody can
  // walk up to. Binding every interface is what makes the tunnel reachable, and
  // `allowedHosts` is then what keeps it narrow, because the listener answers
  // an IP literal or a `*.ts.net` name and refuses every other name it is asked
  // for. Widening one without the other is the mistake: `host` alone puts the
  // lab on every network this machine sits on, and this file has carried
  // `allowedHosts` alone since the tunnel was first wanted.
  // `/api` is a table on the game server (`@mtg/netplay`), and proxying it is
  // what keeps the arrangement to one listener on the network. The server binds
  // loopback; this process is already the thing that is deliberately reachable
  // from another machine, with the host policy above deciding who may ask. So a
  // second player's iPad talks to Vite, Vite talks to loopback, and the game
  // server needs no CORS header and no opinion about origins — which is the
  // whole of its security story, and it is short because the bead says two known
  // people on one network and no accounts.
  //
  // The port comes from the launcher (`tools/netplay.ts`) rather than being
  // fixed here, because the launcher takes it from a flag and a fixed number
  // here would send every table to whichever one started first.
  server: {
    host: true,
    port: 5273,
    // Vite's default on a busy port is to walk upward until something binds,
    // and the two ports directly above this one are the netplay server's and
    // the curation writer's. So the default walk lands the page on a service
    // port, and then this file's own proxy targets point at the page: `npm run
    // curate` came back `EADDRINUSE 127.0.0.1:5275` because a Vite left over
    // from an earlier run had taken the curation writer's port on its way up
    // from here. Failing to start is the honest answer, and it names the port.
    strictPort: true,
    allowedHosts: ['.ts.net'],
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env['MTG_NETPLAY_PORT'] ?? '5274'}`,
        changeOrigin: false,
      },
      // The art curation grid's write endpoint, a loopback server `npm run
      // curate` starts beside this one, on the same arrangement and for the same
      // reason as `/api` above: it binds loopback, this process is the one thing the
      // tablet can reach, and the host policy above is what decides who may ask.
      // It is proxied rather than served from here because the writer imports
      // the art pipeline, which depends on `@mtg/card-render`, which depends on this
      // package — a middleware in this file would close that cycle.
      '/curation-api': {
        target: `http://127.0.0.1:${process.env['MTG_CURATION_PORT'] ?? '5275'}`,
        changeOrigin: false,
      },
    },
  },
  // Two pages, and a build that names only the first one drops the second
  // silently: Vite's default input is `index.html` alone, so `curate.html` would
  // dev-serve and then vanish from `dist/`.
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        index: `${packageDir}index.html`,
        curate: `${packageDir}curate.html`,
      },
    },
  },
});
