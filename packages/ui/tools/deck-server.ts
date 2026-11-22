/**
 * Whether `npm run play` starts a deck server, and what it says about it.
 *
 * `mtg-j1rg`. Customize's Decks section saves decks, and until this lane they were saved in
 * the browser's `localStorage`: per browser, per origin, wiped by clearing site
 * data, and capable of refusing a write at quota with the deck gone the moment
 * the tab closed. The process that can keep a deck is a server, and
 * `@mtg/decklab`'s `/deck-api` is the one that already holds this shape.
 *
 * `@mtg/ui` may not import `@mtg/decklab` — that package reaches `@mtg/data` and
 * therefore `better-sqlite3`, which a browser bundle cannot have — so this
 * launcher reaches that server the one way left to it, by spawning the launcher
 * that owns it (`packages/decklab/tools/deck-library.ts`). That one starts the
 * deck API with no build route at all, so nothing `npm run play` starts can
 * spend a cent.
 *
 * # One server on a known port, not one per lab
 *
 * The page reaches `/deck-api` through Vite's proxy, and that proxy's target is
 * fixed when Vite boots: `../vite.config.ts` reads `MTG_DECK_PORT` and defaults
 * to `DEFAULT_DECK_PORT`. So the port cannot be a free one the operating system
 * picked, the way `startTableServer`'s is — the page would never ask there. That
 * makes the deck server a singleton on a known port, and every other case a
 * question of who owns it:
 *
 * | state                         | what play does                      |
 * | ----------------------------- | ----------------------------------- |
 * | `MTG_DECK_PORT` already set   | nothing: the launcher that spawned  |
 * |                               | this process owns that server       |
 * | something answers on the port | nothing: it is already serving      |
 * | the port is free              | starts one and hands Vite the port  |
 *
 * The middle row is the case that matters and it is deliberately not a refusal.
 * A `npm run deckbench` in another terminal is exactly the arrangement that
 * serves the library best — it has a build button as well — and a lab that
 * refused to start beside it would be refusing over a port it did not need.
 */

/**
 * The loopback port the page's proxy asks. Restated from
 * `@mtg/decklab`'s `tools/deck-api-defaults.ts`, which cannot be imported here
 * for the reason above; `../vite.config.ts` spells the same number for the same
 * reason, and `../test/tools/deck-server.test.ts` pins the three together.
 */
export const DEFAULT_DECK_PORT = 5278;

export type DeckServerPlan =
  /** Start one, and tell Vite where it is. */
  | { readonly kind: 'start'; readonly port: number; readonly message: string }
  /** Something already answers there; talk to it. */
  | { readonly kind: 'attach'; readonly port: number; readonly message: string }
  /** A parent launcher started it and will close it. */
  | { readonly kind: 'inherited'; readonly port: number; readonly message: string };

export interface DeckServerState {
  /** `process.env['MTG_DECK_PORT']`, which only a parent launcher sets. */
  readonly envPort: string | undefined;
  /** Whether anything is listening on the port this run would use. */
  readonly busy: boolean;
}

export function planDeckServer(state: DeckServerState): DeckServerPlan {
  const inherited = state.envPort === undefined ? undefined : Number(state.envPort);
  if (inherited !== undefined && Number.isInteger(inherited)) {
    return {
      kind: 'inherited',
      port: inherited,
      message: `Saved decks go to the deck server this lab was started under, on port ${String(inherited)}.`,
    };
  }
  if (state.busy) {
    return {
      kind: 'attach',
      port: DEFAULT_DECK_PORT,
      message:
        `Saved decks go to the deck server already running on port ${String(DEFAULT_DECK_PORT)} ` +
        '(a `npm run deckbench` in another terminal, usually). This run starts none.',
    };
  }
  return {
    kind: 'start',
    port: DEFAULT_DECK_PORT,
    message: 'Decks you save are kept by this machine rather than by the browser, so they survive it.',
  };
}

/** The command that serves the library, as `node:child_process` wants it. */
export function deckLibraryArgv(repoRoot: string, port: number): readonly string[] {
  return ['tsx', `${repoRoot}/packages/decklab/tools/deck-library.ts`, '--port', String(port)];
}
