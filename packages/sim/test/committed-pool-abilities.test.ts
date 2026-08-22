/**
 * A committed set fixture whose cards carry abilities, played through the real
 * game loop.
 *
 * **The gap this closes, stated as the measurement rather than the bead.** Every
 * ability kind is already resolved in a seeded game somewhere in this
 * repository: `activation-game.test.ts` pays for one and `trigger-game.test.ts`
 * fires one, both through `playSimGame`, and 56 files under
 * `packages/kernel/test` build the rules positions underneath them. What none of
 * that reaches is a *pool*. Both files above deal a deck stamped out of two
 * hand-written cards inside the test that plays it, and every committed set
 * fixture a public gate may open — `tideglass-reach.set.json`, which most of the
 * suite reads — prints zero static, zero triggered and zero activated abilities
 * across all ninety of its cards. So the seven public gates that build decks out
 * of a committed pool and resolve games with them have measured an ability-free
 * format, and nothing said so.
 *
 * **Why a new pool rather than a repointed gate.** The gates pinned to
 * `tideglass-reach` are pinned to what it is: `sealed-calibration.test.ts` needs
 * six packs a side off a real rarity distribution, and `closing.test.ts` mirrors
 * the balance gate's own decks and seed so its closure bands mean what the gate
 * means by them. A twelve-card shape corpus is not a replacement for a
 * ninety-card set and swapping one in would break the claim each of those files
 * makes. What was missing was a committed pool that prints the shapes at all, so
 * that is what `lantern-fen.set.json` is, and this is the gate that opens it.
 *
 * **What is asserted, and what is deliberately not.** The pool claim is read
 * with `missingShapes`, so a card edited out of the fixture fails here by name.
 * The game claims are read off `playSimGame`'s own census: a `tapped` activation
 * that was enumerated, chosen, paid for and resolved, and a `selfEnters` trigger
 * that fired. Both are exactly zero on `tideglass-reach`, which is the whole
 * point of asserting them. A *static* ability's application inside a game is not
 * separable from a log — a creature that is one point bigger leaves no event of
 * its own — so this file claims only that the pool prints one; that a static
 * applies is held by `packages/kernel/test/static-abilities.test.ts` and that a
 * bot reads one by `packages/sim/test/bot-statics.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Card, CardShape } from '@mtg/dsl';
import { missingShapes, parseCards, validateCard } from '@mtg/dsl';
import type { DeckList } from '@mtg/kernel';
import type { ActivationCensus, GameOutcome, TriggerCensus } from '@mtg/sim';
import {
  agentSeed,
  createBot,
  gameSeed,
  greedySpec,
  playSimGame,
  sumActivationCensus,
  sumTriggerCensus,
} from '@mtg/sim';

const SET_FIXTURE = fileURLToPath(new URL('../../dsl/fixtures/sets/lantern-fen.set.json', import.meta.url));

const RUN_SEED = 'lantern-fen/abilities';
const GAMES = 12;

/**
 * The shapes this pool exists to print. Seven of them were printed by no
 * committed set in the repository until it landed, and the three ability kinds
 * were printed by no *public* one.
 */
const REQUIRED: readonly CardShape[] = [
  'land',
  'basicLand',
  'may',
  'unless',
  'staticAbility',
  'triggeredAbility',
  'activatedAbility',
  'manaAbility',
  'keywordAbility',
  'costReduction',
  'entersTapped',
];

function pool(): readonly Card[] {
  const document: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
  if (typeof document !== 'object' || document === null || !('cards' in document)) {
    throw new Error(`${SET_FIXTURE}: not a set document`);
  }
  const { cards } = document as { readonly cards: unknown };
  if (!Array.isArray(cards)) throw new Error(`${SET_FIXTURE}: "cards" is not an array`);
  return parseCards(cards);
}

const POOL: readonly Card[] = pool();

function card(id: string): Card {
  const found = POOL.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`${SET_FIXTURE} no longer prints ${id}`);
  return found;
}

/** `count` copies of one printing, the way a constructed list holds them. */
function copies(id: string, count: number): readonly Card[] {
  const printing = card(id);
  return Array.from({ length: count }, () => printing);
}

/** The trigger seat: a lamplighter's arrival is the only line in it that gains life. */
function whiteDeck(): DeckList {
  return {
    name: 'Lantern Wardens',
    cards: [
      ...copies('lnf-fen-warden', 4),
      ...copies('lnf-lamplighter', 4),
      ...copies('lnf-tollkeeper', 2),
      ...copies('lnf-stilt-walker', 4),
      ...copies('lnf-toll-of-passage', 2),
      ...copies('lnf-wayfarers-ledger', 2),
      ...copies('lnf-fen-causeway', 4),
      ...copies('lnf-plains', 18),
    ],
  };
}

/** The activation seat: the adept's `{T}` is the only line in it that burns. */
function redDeck(): DeckList {
  return {
    name: 'Peat Kindlers',
    cards: [
      ...copies('lnf-ember-adept', 6),
      ...copies('lnf-peat-runner', 6),
      ...copies('lnf-kindling-rite', 4),
      ...copies('lnf-fen-causeway', 4),
      ...copies('lnf-mountain', 20),
    ],
  };
}

const DECKS: readonly [DeckList, DeckList] = [whiteDeck(), redDeck()];

function play(index: number): GameOutcome {
  return playSimGame({
    index,
    seed: gameSeed(RUN_SEED, index),
    decks: DECKS,
    agents: [
      createBot(greedySpec('greedy-wardens'), agentSeed(RUN_SEED, index, 0), 0),
      createBot(greedySpec('greedy-kindlers'), agentSeed(RUN_SEED, index, 1), 1),
    ],
    startingPlayer: index % 2 === 0 ? 0 : 1,
    censusAbilities: true,
  });
}

const OUTCOMES: readonly GameOutcome[] = Array.from({ length: GAMES }, (_ignored, index) => play(index));

function activations(): ActivationCensus {
  return sumActivationCensus(
    OUTCOMES.map((outcome) => {
      const census = outcome.activationCensus;
      if (census === null) throw new Error(`game ${outcome.index} returned no activation census`);
      return census;
    }),
  );
}

function triggers(): TriggerCensus {
  return sumTriggerCensus(
    OUTCOMES.map((outcome) => {
      const census = outcome.triggerCensus;
      if (census === null) throw new Error(`game ${outcome.index} returned no trigger census`);
      return census;
    }),
  );
}

describe('the committed ability pool', () => {
  it('prints every shape it is opened for, and every card in it is legal', () => {
    expect(POOL.length).toBeGreaterThan(0);
    expect(missingShapes(POOL, REQUIRED)).toStrictEqual([]);
    for (const printing of POOL) {
      expect(validateCard(printing), `${printing.id} is not a legal card`).toStrictEqual([]);
    }
  });

  it('deals decks that carry the abilities, so a game could reach them', () => {
    for (const deck of DECKS) {
      expect(deck.cards).toHaveLength(40);
      const carrying = deck.cards.filter((printing) => printing.abilities.length > 0);
      expect(carrying.length, `${deck.name} holds no ability at all`).toBeGreaterThan(0);
    }
  });

  it('plays every game to a real result', () => {
    for (const outcome of OUTCOMES) {
      expect(['lifeZero', 'emptyLibrary', 'concede', 'turnLimit']).toContain(outcome.reason);
      expect(outcome.turns).toBeGreaterThan(0);
    }
  });

  /**
   * The assertion that is exactly zero on the pool every other gate opens. An
   * arrival with nothing scoring it is invisible to a balance run, so the
   * chances and the takings are read separately: a pool that stopped printing
   * the ability fails on `instances`, and a bot that stopped reaching for it
   * fails on `activations`.
   */
  it('resolves an activated ability out of the pool, in the real loop', () => {
    const census = activations();
    expect(census.games).toBe(GAMES);
    expect(census.unresolvedArrivals).toBe(0);
    expect(census.unresolvedActivations).toBe(0);
    expect(census.arms.tapped.instances, 'tap activations that reached a battlefield').toBeGreaterThan(0);
    expect(census.arms.tapped.activations, 'tap activations the bot paid for').toBeGreaterThan(0);
  });

  it('fires a triggered ability out of the pool, in the real loop', () => {
    const census = triggers();
    expect(census.games).toBe(GAMES);
    expect(census.unresolvedArrivals).toBe(0);
    expect(census.conditions.selfEnters.instances, 'arrivals carrying the trigger').toBeGreaterThan(0);
    expect(census.conditions.selfEnters.fires, 'times the trigger fired').toBeGreaterThan(0);
  });

  it('replays identically at the same seed', () => {
    expect(play(0)).toEqual(OUTCOMES[0]);
  });
});
