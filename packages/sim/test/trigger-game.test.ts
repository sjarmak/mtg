/**
 * A triggered ability played through the real game loop, not a scenario.
 *
 * Every other assertion about triggers in this repository builds a position
 * with `scenario()` and hands the reducer a scripted list of actions. That
 * proves the rule and proves nothing about the loop: `playSimGame` is what the
 * balance gate runs, and its seat is a bot choosing from `legalActions` under a
 * decision budget, over a shuffled library, for as many turns as the game
 * lasts. A trigger that put the game in a state the bot could not answer, or
 * that made `settle` loop, would pass every unit test in `@mtg/kernel` and fail
 * here.
 *
 * The evidence is the per-turn log rather than the win column. Life above the
 * starting total can only have come from the enters trigger — no card in either
 * deck gains life any other way — so `eot_life > 20` is the trigger's
 * fingerprint, read off the same log the metrics lane grades.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card, CardInput } from '@mtg/dsl';
import { basicLand, parseCard } from '@mtg/dsl';
import type { DeckList } from '@mtg/kernel';
import type { GameOutcome } from '@mtg/sim';
import { FIXTURE_DECK_RW, agentSeed, createBot, gameSeed, greedySpec, playSimGame } from '@mtg/sim';

const RUN_SEED = 'trigger/etb';
const GAMES = 12;

const GAIN_TWO_ON_ENTER: AbilityInput = {
  kind: 'triggered',
  condition: 'selfEnters',
  effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
};

function herald(): Card {
  const input: CardInput = {
    kind: 'creature',
    id: 'tst-tide-herald',
    name: 'Tide Herald',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 610 },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
    power: 2,
    toughness: 2,
    abilities: [GAIN_TWO_ON_ENTER],
  };
  return parseCard(input);
}

/** 23 heralds and 17 Plains: every spell in the deck carries the trigger. */
function heraldDeck(): DeckList {
  const cards: Card[] = [];
  const card = herald();
  for (let slot = 0; slot < 23; slot += 1) cards.push(card);
  const plains = basicLand('Plains', 'TST', 611);
  for (let slot = 0; slot < 17; slot += 1) cards.push(plains);
  return { name: 'Herald ETB', cards };
}

const DECKS: readonly [DeckList, DeckList] = [heraldDeck(), FIXTURE_DECK_RW];

function play(index: number): GameOutcome {
  const seed = gameSeed(RUN_SEED, index);
  return playSimGame({
    index,
    seed,
    decks: DECKS,
    agents: [
      createBot(greedySpec('greedy-herald'), agentSeed(RUN_SEED, index, 0), 0),
      createBot(greedySpec('greedy-rw'), agentSeed(RUN_SEED, index, 1), 1),
    ],
    startingPlayer: index % 2 === 0 ? 0 : 1,
    log: {
      runSeed: RUN_SEED,
      expansion: 'TST',
      eventType: 'Sim',
      gameTime: '2026-01-01T00:00:00.000Z',
      botNames: ['greedy-herald', 'greedy-rw'],
    },
  });
}

const OUTCOMES: readonly GameOutcome[] = Array.from({ length: GAMES }, (_ignored, index) => play(index));

/** Turns whose end-of-turn snapshot shows seat 0 above its starting life. */
function turnsAboveStartingLife(outcome: GameOutcome): number {
  return (outcome.log?.turns ?? []).filter((turn) => turn.user.eot_life > 20).length;
}

describe('a triggered ability in a seeded game', () => {
  it('plays every game to a real result', () => {
    expect(OUTCOMES).toHaveLength(GAMES);
    for (const outcome of OUTCOMES) {
      // A game that ended any other way did not end: `playSimGame` throws on a
      // blown decision budget, and the loop cannot leave without a result.
      expect(['lifeZero', 'emptyLibrary', 'concede', 'turnLimit']).toContain(outcome.reason);
      expect(outcome.turns).toBeGreaterThan(0);
      expect(outcome.log?.turns.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('gains the life the trigger prints, in every game', () => {
    const gained = OUTCOMES.map((outcome) => turnsAboveStartingLife(outcome));
    expect(gained.filter((count) => count > 0)).toHaveLength(GAMES);
  });

  it('replays identically at the same seed', () => {
    const again = play(0);
    expect(again).toEqual(OUTCOMES[0]);
  });
});
