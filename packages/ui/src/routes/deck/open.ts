/**
 * Which deck the Decks tab opens on arrival, written into the hash.
 *
 * `mtg-aqxi.19`. the playtester asked for the landing page to "show our available
 * decks with the build a deck or edit a deck options", and a list of decks whose
 * every row lands on the same tab and leaves you to find the deck again is not
 * that list. So a row carries which deck it is, the tab reads it, and the link
 * is a real link: it can be bookmarked, opened in a second tab, and sent to the
 * other person on the LAN.
 *
 * # Why a string rather than two params
 *
 * `#/deck?open=saved:d-7` rather than `?kind=saved&id=d-7`. The two halves are
 * never independent — there is no deck that is `saved` and nothing else, and no
 * id that means anything without knowing which list it indexes — so a pair of
 * params would make two invalid states reachable for no gain. `build` carries no
 * id at all, which is the same reason `LibrarySelection`'s own `build` does not:
 * there is one builder and it holds its own state.
 *
 * # Why an unreadable value is not an error
 *
 * A stale bookmark, an id whose deck was deleted, a hand-typed hash: all of them
 * parse to `null` and the tab opens the way it opens with no param at all. That
 * is `../../app/router.ts`'s rule for an unrecognized mode, for the same reason
 * — a URL is somebody else's input and the page it names should still be a page.
 * The one case that does *say* something is a saved id that no longer resolves,
 * and that message belongs to the panel that owns the list rather than here.
 */

/** What the `open` param resolves to. */
export type DeckOpen =
  | { readonly kind: 'build'; readonly savedId?: string }
  | { readonly kind: 'precon'; readonly id: string }
  | { readonly kind: 'artifact' }
  /**
   * A deck the workbench built, by the id its server files it under. The Cards
   * tab's deck gallery (`../cards/DeckGallery.ts`) links each tile here, so an
   * Edit press lands on the workbench showing that deck rather than on the
   * library with the deck somewhere below.
   */
  | { readonly kind: 'variation'; readonly id: string };

/** The param name, spelled once so a link and its reader cannot drift. */
export const DECK_OPEN_PARAM = 'open';

const SAVED_PREFIX = 'saved:';
const PRECON_PREFIX = 'precon:';
const VARIATION_PREFIX = 'variation:';

/**
 * The staged `@mtg/decklab` artifact, which carries no id for the same reason
 * `build` does not: there is one of it, staged beside the app, and a second one
 * would be a second staging run rather than a second row in a list.
 *
 * It became linkable with `mtg-nuk3`. Until then the tab opened on it whenever
 * nothing else was asked for, so a link to it was a link to the tab; once the
 * tab lands on the library instead, an artifact deck with no name of its own is
 * the one deck in the list nobody can send to anybody.
 */
const ARTIFACT = 'artifact';

/** A request to the param value that reproduces it. */
export function deckOpenParam(open: DeckOpen): string {
  if (open.kind === 'precon') return `${PRECON_PREFIX}${open.id}`;
  if (open.kind === 'variation') return `${VARIATION_PREFIX}${open.id}`;
  if (open.kind === 'artifact') return ARTIFACT;
  return open.savedId === undefined ? 'build' : `${SAVED_PREFIX}${open.savedId}`;
}

/** The param value to a request, or `null` when it names nothing this tab has. */
export function parseDeckOpen(raw: string | undefined): DeckOpen | null {
  if (raw === undefined || raw === '') return null;
  if (raw === 'build') return { kind: 'build' };
  if (raw === ARTIFACT) return { kind: 'artifact' };
  if (raw.startsWith(SAVED_PREFIX)) {
    const savedId = raw.slice(SAVED_PREFIX.length);
    return savedId === '' ? null : { kind: 'build', savedId };
  }
  if (raw.startsWith(PRECON_PREFIX)) {
    const id = raw.slice(PRECON_PREFIX.length);
    return id === '' ? null : { kind: 'precon', id };
  }
  if (raw.startsWith(VARIATION_PREFIX)) {
    const id = raw.slice(VARIATION_PREFIX.length);
    return id === '' ? null : { kind: 'variation', id };
  }
  return null;
}
