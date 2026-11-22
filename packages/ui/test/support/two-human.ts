/**
 * Two people at one table, as a fixture and nowhere else.
 *
 * The lab seats one person opposite a bot; a shared screen was an arm of
 * `routes/play/deal.ts` once and left with it. What the suites still need from
 * it is a table where neither seat is `You`: the seat-voice, beats, log and
 * move-name suites all pin that every sentence reads off the seat label rather
 * than off a viewer-relative pronoun, and a two-human table is the one where a
 * wrong pronoun has two answers. So the config is built here from the kernel's
 * own `humanSeat`, twice, the way the deal used to build it.
 */
import { buildDeck } from '@mtg/deckbuild';
import type { Card } from '@mtg/dsl';
import { humanSeat } from '@mtg/kernel';
import type { DeckList } from '@mtg/kernel';
import type { PlayConfig } from '../../src/routes/play/use-session';

/** What the two seats are called, in seat order. */
export const TWO_HUMAN_NAMES: readonly [string, string] = ['Player one', 'Player two'];

/** Two finished decks, one person at each. Seat 0 is on the play and is the viewer. */
export function twoHumanGame(you: readonly Card[], them: readonly Card[], seed: string): PlayConfig {
  const yours: DeckList = { name: `${TWO_HUMAN_NAMES[0]}'s deck`, cards: you };
  const theirs: DeckList = { name: `${TWO_HUMAN_NAMES[1]}'s deck`, cards: them };
  return {
    setup: { seed, decks: [yours, theirs] },
    seats: [humanSeat(TWO_HUMAN_NAMES[0]), humanSeat(TWO_HUMAN_NAMES[1])],
    viewer: 0,
    names: TWO_HUMAN_NAMES,
  };
}

/**
 * The mirror the deleted `dealMirrorGame(pool, { opponent: 'human' })` dealt:
 * one deck built from the pool, at both seats, under the play suite's seed.
 */
export function twoHumanMirror(pool: readonly Card[], seed = 'lab/play/v0'): PlayConfig {
  const deck = buildDeck(pool).deck;
  return twoHumanGame(deck, deck, seed);
}
