/**
 * An activated ability paid for by a bot in the real game loop, not a scenario.
 *
 * `trigger-game.test.ts` makes this argument for slice B and it is the same
 * argument: every other assertion about activations in this repository builds a
 * position with `scenario()` and hands the reducer a scripted list of actions,
 * which proves the rule and proves nothing about the loop. `playSimGame` is
 * what the balance gate runs, and its seat is a bot choosing from
 * `legalActions` under a decision budget, over a shuffled library, for as many
 * turns as the game lasts. An activation that stranded mana, or that put the
 * game in a state the bot could not answer, or that made `settle` loop, would
 * pass every unit test in `@mtg/kernel` and fail here.
 *
 * The evidence is the per-turn log rather than the win column. Seat 0 plays 23
 * copies of one 2/2 and 17 Plains, and the only line in either deck that adds
 * life is the warden's `{T}` ability, so a turn ending with seat 0 above its
 * starting total is that ability having been enumerated, chosen, paid for and
 * resolved. This is the usage floor risk 3 of
 * `docs/design/dsl-v1-ability-model.md` asks for: an enumerated action nothing
 * scores is invisible to a balance run, which reports healthy win-rate bands
 * for a format in which the mechanic was never played.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card, CardInput } from '@mtg/dsl';
import { basicLand, parseCard } from '@mtg/dsl';
import type { DeckList } from '@mtg/kernel';
import type { GameOutcome } from '@mtg/sim';
import { FIXTURE_DECK_RW, agentSeed, createBot, gameSeed, greedySpec, playSimGame } from '@mtg/sim';

const RUN_SEED = 'activate/font';
const GAMES = 12;

/** `{T}: You gain 3 life.` No mana, so a warden the bot taps is a warden it does not swing. */
const TAP_FOR_LIFE: AbilityInput = {
  kind: 'activated',
  cost: { mana: {}, tapSelf: true },
  effects: [{ kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } }],
};

function warden(): Card {
  const input: CardInput = {
    kind: 'creature',
    id: 'tst-spring-warden',
    name: 'Spring Warden',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 630 },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
    power: 2,
    toughness: 2,
    abilities: [TAP_FOR_LIFE],
  };
  return parseCard(input);
}

/** 23 wardens and 17 Plains: every spell in the deck carries the activation. */
function wardenDeck(): DeckList {
  const cards: Card[] = [];
  const card = warden();
  for (let slot = 0; slot < 23; slot += 1) cards.push(card);
  const plains = basicLand('Plains', 'TST', 631);
  for (let slot = 0; slot < 17; slot += 1) cards.push(plains);
  return { name: 'Warden Activations', cards };
}

const DECKS: readonly [DeckList, DeckList] = [wardenDeck(), FIXTURE_DECK_RW];

function play(index: number): GameOutcome {
  const seed = gameSeed(RUN_SEED, index);
  return playSimGame({
    index,
    seed,
    decks: DECKS,
    agents: [
      createBot(greedySpec('greedy-warden'), agentSeed(RUN_SEED, index, 0), 0),
      createBot(greedySpec('greedy-rw'), agentSeed(RUN_SEED, index, 1), 1),
    ],
    startingPlayer: index % 2 === 0 ? 0 : 1,
    log: {
      runSeed: RUN_SEED,
      expansion: 'TST',
      eventType: 'Sim',
      gameTime: '2026-01-01T00:00:00.000Z',
      botNames: ['greedy-warden', 'greedy-rw'],
    },
  });
}

const OUTCOMES: readonly GameOutcome[] = Array.from({ length: GAMES }, (_ignored, index) => play(index));

/** Turns whose end-of-turn snapshot shows seat 0 above its starting life. */
function turnsAboveStartingLife(outcome: GameOutcome): number {
  return (outcome.log?.turns ?? []).filter((turn) => turn.user.eot_life > 20).length;
}

describe('an activated ability in a seeded game', () => {
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

  it('gains the life the ability prints, in every game', () => {
    const gained = OUTCOMES.map((outcome) => turnsAboveStartingLife(outcome));
    expect(gained.filter((count) => count > 0)).toHaveLength(GAMES);
  });

  it('counts what it paid for in the replay-superset log', () => {
    // `{owner}_turn_{N}_{side}_abilities` is 17lands' column and was shipped as
    // a hardcoded zero, described in `@mtg/metrics`' join contract as
    // structural. These twelve games are the counter-example: seat 0 pays for
    // an activation in every one of them, and seat 1's deck prints none, so the
    // column separates a real count from a real zero rather than reporting the
    // same number for both.
    for (const outcome of OUTCOMES) {
      const turns = outcome.log?.turns ?? [];
      const paid = turns.reduce((sum, turn) => sum + turn.user.abilities, 0);
      const opponent = turns.reduce((sum, turn) => sum + turn.oppo.abilities, 0);
      expect(paid).toBeGreaterThan(0);
      expect(opponent).toBe(0);
    }
  });

  it('replays identically at the same seed', () => {
    const again = play(0);
    expect(again).toEqual(OUTCOMES[0]);
  });
});
