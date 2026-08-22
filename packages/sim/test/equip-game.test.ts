/**
 * A weapon picked up by a bot in the real game loop, not a scenario.
 *
 * `activation-game.test.ts` makes this argument for an activated ability with a
 * payload and it is the same argument for the one ability kind that has none:
 * `bot-equip.test.ts` builds its positions with `scenario()` and hands the
 * reducer a scripted board, which proves the policy and proves nothing about
 * the loop. `playSimGame` is what the balance gate runs — a bot choosing from
 * `legalActions` under a decision budget, over a shuffled library, for as many
 * turns as the game lasts. An equip that stranded mana, or that made `settle`
 * loop, or that the sorcery-speed window never actually offered, would pass
 * every unit test in `@mtg/kernel` and `@mtg/sim` and fail here.
 *
 * The evidence is the per-turn log rather than the win column. Seat 0 plays 11
 * weapons, 12 bodies and 17 Plains, and the equip clause is the only activated
 * ability in either deck, so a paid activation in the log is a weapon that was
 * cast, offered at a main phase and attached.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { basicLand, parseCard } from '@mtg/dsl';
import type { DeckList } from '@mtg/kernel';
import type { GameOutcome } from '@mtg/sim';
import { FIXTURE_DECK_RW, agentSeed, createBot, gameSeed, greedySpec, playSimGame } from '@mtg/sim';

const RUN_SEED = 'equip/sword';
const GAMES = 10;

/** `Equipped creature gets +2/+0.` / `Equip {2}` */
function sword(): Card {
  const input: CardInput = {
    kind: 'artifact',
    id: 'tst-moonblade',
    name: 'Moonblade',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 640 },
    manaCost: { generic: 2 },
    subtypes: ['Equipment'],
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { generic: 2 } },
        attach: { modifications: [{ kind: 'statBonus', power: 2, toughness: 0 }] },
        effects: [],
      },
    ],
  };
  return parseCard(input);
}

function squire(): Card {
  const input: CardInput = {
    kind: 'creature',
    id: 'tst-castle-squire',
    name: 'Castle Squire',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 641 },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
    power: 2,
    toughness: 2,
  };
  return parseCard(input);
}

/** 11 weapons, 12 bodies to carry them and 17 Plains. */
function armoryDeck(): DeckList {
  const cards: Card[] = [];
  const weapon = sword();
  for (let slot = 0; slot < 11; slot += 1) cards.push(weapon);
  const body = squire();
  for (let slot = 0; slot < 12; slot += 1) cards.push(body);
  const plains = basicLand('Plains', 'TST', 642);
  for (let slot = 0; slot < 17; slot += 1) cards.push(plains);
  return { name: 'Castle Armory', cards };
}

const DECKS: readonly [DeckList, DeckList] = [armoryDeck(), FIXTURE_DECK_RW];

function play(index: number): GameOutcome {
  const seed = gameSeed(RUN_SEED, index);
  return playSimGame({
    index,
    seed,
    decks: DECKS,
    agents: [
      createBot(greedySpec('greedy-armory'), agentSeed(RUN_SEED, index, 0), 0),
      createBot(greedySpec('greedy-rw'), agentSeed(RUN_SEED, index, 1), 1),
    ],
    startingPlayer: index % 2 === 0 ? 0 : 1,
    log: {
      runSeed: RUN_SEED,
      expansion: 'TST',
      eventType: 'Sim',
      gameTime: '2026-01-01T00:00:00.000Z',
      botNames: ['greedy-armory', 'greedy-rw'],
    },
  });
}

const OUTCOMES: readonly GameOutcome[] = Array.from({ length: GAMES }, (_ignored, index) => play(index));

function activationsPaid(outcome: GameOutcome): number {
  return (outcome.log?.turns ?? []).reduce((sum, turn) => sum + turn.user.abilities, 0);
}

describe('an equip ability in a seeded game', () => {
  it('plays every game to a real result', () => {
    expect(OUTCOMES).toHaveLength(GAMES);
    for (const outcome of OUTCOMES) {
      expect(['lifeZero', 'emptyLibrary', 'concede', 'turnLimit']).toContain(outcome.reason);
      expect(outcome.turns).toBeGreaterThan(0);
    }
  });

  /**
   * The risk-3 assertion, in the loop the balance gate runs. Every weapon in
   * this deck is a two-mana artifact that does nothing at all until the equip
   * is paid for, so a run whose count is zero is a run in which the format's
   * mechanic never happened.
   *
   * Most games rather than every game, and the gap is the policy working:
   * `chooseCast` runs before `chooseActivation` and an equip only ever spends
   * mana the cast policy declined, so a game seat 0 spends behind on bodies is
   * a game it never picks a weapon up. Three of these ten are that game.
   */
  it('is paid for across the run, and only by the seat whose deck prints one', () => {
    const paid = OUTCOMES.map((outcome) => activationsPaid(outcome));
    expect(paid.reduce((sum, count) => sum + count, 0)).toBeGreaterThan(0);
    expect(paid.filter((count) => count > 0).length).toBeGreaterThanOrEqual(GAMES / 2);
    for (const outcome of OUTCOMES) {
      const opponent = (outcome.log?.turns ?? []).reduce((sum, turn) => sum + turn.oppo.abilities, 0);
      expect(opponent).toBe(0);
    }
  });

  it('replays identically at the same seed', () => {
    expect(play(0)).toEqual(OUTCOMES[0]);
  });
});
