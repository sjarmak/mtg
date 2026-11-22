/**
 * Which page a printed selection is on.
 *
 * `mtg-a982g.1`. The printed routes read `route.mode` to decide whether they
 * were listing decks, dealing a draft or browsing cards, and the modes moved
 * under them when Draft became a section of Play. The tab that renders a
 * selection knows which page it is, so it says so in one word and the routes
 * stop reading the hash for it; the hash still carries the seed and the deck.
 */
export type PrintedPage = 'decks' | 'gallery' | 'constructed' | 'draft' | 'sealed' | 'commander';

/** The pages that seat a game, as against the ones that list or browse. */
export function printedPlayPage(page: PrintedPage): boolean {
  return page === 'constructed' || page === 'sealed' || page === 'commander';
}
