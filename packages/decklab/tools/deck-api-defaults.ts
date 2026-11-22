/**
 * Where the deck API listens and where it keeps what it is given.
 *
 * Three constants two launchers share. `./deckbench.ts` is the workbench, which
 * can build; `./deck-library.ts` is the same server with no build route, started
 * behind `npm run play`. They are here rather than in either launcher so the one
 * that cannot spend has no import path to the one that can — the library server
 * resolves no provider and reaching for a constant must not put one in its
 * graph.
 */
import { join } from 'node:path';

/** The loopback port `packages/ui/vite.config.ts` proxies `/deck-api` to. */
export const DEFAULT_DECK_PORT = 5278;

/** Where variations are kept. Under `out/`, which is gitignored. */
export const DEFAULT_VARIATION_DIR = join('out', 'deckbench', 'variations');

/**
 * Where saved decks are kept, and deliberately not under `out/deckbench/`.
 *
 * `mtg-j1rg`. A variation belongs to the workbench, which is one launcher's
 * surface; the deck library belongs to the lab, and `npm run play` writes to it
 * without ever starting a workbench. Filing the library under the workbench's
 * directory would say the wrong thing about which one owns it, and would make
 * "clear the workbench" mean "throw away every deck anybody has saved".
 */
export const DEFAULT_DECK_LIBRARY_DIR = join('out', 'deck-library');
