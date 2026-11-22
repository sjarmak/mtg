/**
 * The staged deck artifact, and why `npm run play` removes it.
 *
 * `npm run lab` writes `packages/ui/public/deck.json`: a `@mtg/decklab`
 * artifact, which is a deck of **real printings** chosen out of the 656 MB card
 * store, keyed by printed name, carrying the prompt it was asked for, the
 * criteria it was held to, a price per card and a mana-base report. The Decks
 * tab reads it whenever it is there.
 *
 * `npm run play` opens a DSL set, and no artifact is ever about one. There is no
 * staged set whose cards those printings are, no id that resolves against the
 * pool, and nothing on that page can deal them into a game. So the file is not
 * stale in the way a previous set's precon file is stale — it is a document from
 * a different lane that this lane has no reading of at all.
 *
 * Left in place it is worse than useless, because the tab presents it as one of
 * the decks you have. the playtester, 2026-08-22, on a flagship set launch: "I
 * don't want that database build aggressive Boros deck under 75 dollars showing
 * up anymore, it was an old placeholder". It was a real deck, from a real
 * `npm run lab` run months earlier, still being served because nothing ever
 * cleared it — the same failure the run log had (`stage-run-log.ts`) and the
 * flat art manifest had, and it is fixed the same way.
 *
 * Unconditional rather than matched, which is the one difference from those two.
 * A precon file can belong to the set being played and a run log can carry its
 * code, so both are searched and only removed when nothing matches. An artifact
 * has no set to match against, so there is no candidate to keep.
 */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** The file Customize's Decks section fetches, staged into `packages/ui/public/`. */
export const DECK_FILENAME = 'deck.json';

/**
 * Removes a staged deck artifact.
 *
 * Returns whether one was there, so a launcher can say it removed something
 * rather than printing a line about a file nobody staged.
 */
export function clearStagedDeck(publicDir: string): boolean {
  const target = join(publicDir, DECK_FILENAME);
  const had = existsSync(target);
  rmSync(target, { force: true });
  return had;
}

/** The launcher's line, or nothing at all when there was nothing to clear. */
export function describeClearedDeck(cleared: boolean): string {
  return cleared
    ? 'Cleared a deck staged by an earlier `npm run lab`; it is a deck of real printings\n' +
        'and no set staged here prints them. Run `npm run lab` to look at one.'
    : '';
}
