/**
 * How many cards are in the deck the editor is holding, read off the screen.
 *
 * `mtg-84703`. Every printed Limited surface used to assert on the sentence
 * `40 cards in deck`, which the status banner over the editor carried. That
 * banner is gone -- the playtester asked for the space back, and the count was
 * already being said a pane away -- so the one place that says it is the deck
 * pane's own note, `builderCountsLine`'s `40 of 40 cards · 14 creatures · …`.
 *
 * Reading it here rather than in eight tests keeps the tests asserting the fact
 * they were always about (the deck is 40 cards) rather than the sentence that
 * happened to carry it, which is what made them all fail at once.
 * `packages/ui/tools/live-journey.ts` reads the same note from the other side,
 * in a real browser, for the same reason.
 */
import { screen } from '@testing-library/react';

const DECK_COUNT = /^(\d+) of \d+ cards\b/u;

export function deckCardCount(): number {
  const notes = screen.getAllByText(DECK_COUNT);
  const found = notes
    .map((note) => DECK_COUNT.exec((note as unknown as { textContent: string }).textContent ?? ''))
    .find((match): match is RegExpExecArray => match !== null);
  if (found === undefined) throw new Error('no pane on this screen counts the deck');
  return Number(found[1]);
}
