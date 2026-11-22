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
  //
  // `MTG_SET_ICONS` is the same arrangement for the set icons: the codes
  // `tools/stage-set-icons.ts` actually served from `public/set-icons/`, comma
  // separated, and empty for every other way this server can be started, which
  // `@mtg/render-spec`'s `set-icon.ts` reads as "draw every set's mark".
  define: {
    __MTG_SYMBOL_SET__: JSON.stringify(process.env['MTG_SYMBOL_SET'] ?? ''),
    __MTG_SET_ICONS__: JSON.stringify(process.env['MTG_SET_ICONS'] ?? ''),
  },
  resolve: {
    // One React in the bundle, named rather than left to resolution.
    //
    // A `build.lib` pass over this config resolved `react` twice -- once for
    // the app's own `import { createElement } from 'react'` and once for the
    // copy `react-dom` requires -- and two instances share no dispatcher, so
    // the first hook in the first component read `useState` off a null one and
    // the page mounted nothing at all. The dev server never showed it because
    // its prebundle collapses the two on the way in. Naming both packages here
    // is Vite's own remedy and it costs a served page nothing.
    dedupe: ['react', 'react-dom'],
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
      // Backend-neutral EngineSession traffic gets its own prefix and process.
      // The gateway imports installed engines and node:http; keeping it behind
      // this loopback target keeps both out of the browser module graph.
      '/engine-api': {
        target: `http://127.0.0.1:${process.env['MTG_BACKEND_GATEWAY_PORT'] ?? '5277'}`,
        changeOrigin: false,
      },
      // The set designer's server (`@mtg/setgen`'s `design/server.ts`), which
      // `npm run design` starts beside this one. Its own prefix rather than
      // `/api`, because `/api` above is a table on the game server and a proxy
      // entry points at one port: sharing the prefix would mean a designer with
      // a LAN game open got the game server's 404 for every validation. It is
      // proxied rather than served from here for the reason the curation writer
      // is — it imports `@mtg/setgen`, whose canon data is read off disk at
      // import time, which is exactly what must not reach a browser bundle.
      '/design-api': {
        target: `http://127.0.0.1:${process.env['MTG_DESIGN_PORT'] ?? '5276'}`,
        changeOrigin: false,
      },
      // The deck workbench's server (`@mtg/decklab`'s `workbench/server.ts`),
      // which `npm run deckbench` starts beside this one. Its own prefix for the
      // same reason `/design-api` has one, and proxied rather than served from
      // here for a stronger version of the same reason: it imports `@mtg/data`
      // and therefore `better-sqlite3`, which cannot exist in a browser bundle
      // at all. It is also the one server behind this page that can spend money,
      // and the flag that arms it is typed at that launcher, never here.
      '/deck-api': {
        target: `http://127.0.0.1:${process.env['MTG_DECK_PORT'] ?? '5278'}`,
        changeOrigin: false,
      },
      // The feedback server (`tools/feedback/server.ts`), same arrangement: the
      // launcher spells the port and `DEFAULT_FEEDBACK_PORT` is the fallback.
      '/feedback-api': {
        target: `http://127.0.0.1:${process.env['MTG_FEEDBACK_PORT'] ?? '5279'}`,
        changeOrigin: false,
      },
      // The art curation grid's write endpoint, a loopback server `npm run
      // curate` starts beside this one, on the same arrangement and for the same
      // reason as `/api` above: it binds loopback, this process is the one thing the
      // tablet can reach, and the host policy above is what decides who may ask.
      // It is proxied rather than served from here because the writer imports
      // the art pipeline, which reaches `@mtg/setgen` and its canon data — read off
      // disk at import time, which is the same thing that keeps `/design-api`
      // above out of this process. The cycle this comment used to name is gone:
      // `@mtg/card-render` stopped importing this package in `mtg-ey09`.
      '/curation-api': {
        target: `http://127.0.0.1:${process.env['MTG_CURATION_PORT'] ?? '5275'}`,
        changeOrigin: false,
      },
    },
  },
  // Three pages, and a build that names only the first one drops the rest
  // silently: Vite's default input is `index.html` alone, so `curate.html` would
  // dev-serve and then vanish from `dist/`.
  //
  // `fixtures.html` is a development page (`src/dev/fixtures/FixturesApp.ts`),
  // not a product surface, and it is built anyway for one reason: a page only
  // the dev server can serve is a page the screenshot rig cannot reach from a
  // built artifact. It is not linked from the shell and `src/app/router.ts`
  // does not know the word, so nothing navigates to it by accident.
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        index: `${packageDir}index.html`,
        curate: `${packageDir}curate.html`,
        fixtures: `${packageDir}fixtures.html`,
      },
    },
  },
});
