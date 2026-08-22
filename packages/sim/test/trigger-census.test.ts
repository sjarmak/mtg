/**
 * The per-condition trigger census: chances offered, chances taken.
 *
 * `@mtg/deckbuild`'s `DEFAULT_TRIGGER_FIRE_COUNT` is the number
 * `evaluateCard` multiplies a triggered ability's effects by, and every row of
 * it was written by hand. What makes it measurable is a denominator, and the
 * denominator has to be the *arrival* rather than the game: fires per game
 * folds in how often the card was drawn and how many copies the deck ran, and
 * the scorer is asking neither of those. So the assertions below are about the
 * denominator at least as much as the count.
 *
 * The end-to-end case is the one that keeps the instrument honest. `selfEnters`
 * fires exactly once per arrival by construction — the arrival *is* the
 * triggering event — so `fires === instances` on a real seeded game is a
 * closed-form check that arrivals and fires are being paired correctly. Any
 * other reading there is an instrument bug rather than a fact about a set.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card, CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { DeckList, GameEvent, GameObject, GameState } from '@mtg/kernel';
import { NO_COUNTERS, scenario } from '@mtg/kernel';
import {
  censusGameTriggers,
  createBot,
  emptyTriggerCensus,
  firesPerInstance,
  greedySpec,
  mergeTriggerCensus,
  playSimGame,
  sumTriggerCensus,
} from '@mtg/sim';
import { PLAINS } from './cards';

const GAIN_ON_ENTER: AbilityInput = {
  kind: 'triggered',
  condition: 'selfEnters',
  effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
};

const GAIN_ON_DEATH: AbilityInput = {
  kind: 'triggered',
  condition: 'selfDies',
  effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
};

function herald(name: string, collectorNumber: number, abilities: readonly AbilityInput[]): Card {
  const input: CardInput = {
    kind: 'creature',
    id: `tst-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
    abilities: [...abilities],
    power: 2,
    toughness: 2,
  };
  return parseCard(input);
}

const TWO_TRIGGERS = herald('Twin Herald', 900, [GAIN_ON_ENTER, GAIN_ON_DEATH]);
const ENTER_ONLY = herald('Dawn Herald', 901, [GAIN_ON_ENTER]);

/** A final state naming `oid` as the given card, which is all the census reads. */
function stateWith(entries: readonly (readonly [string, Card])[]): GameState {
  const base = scenario().state;
  const objects: Record<string, GameObject> = { ...base.objects };
  for (const [oid, card] of entries) {
    objects[oid] = {
      oid,
      card,
      owner: 0,
      controller: 0,
      zone: 'battlefield',
      token: false,
      tapped: false,
      summoningSick: false,
      damage: 0,
      deathtouched: false,
      counters: NO_COUNTERS,
    };
  }
  return { ...base, objects };
}

function entered(oid: string): GameEvent {
  return { type: 'permanentEntered', oid, controller: 0 };
}

function fired(source: string, condition: 'selfEnters' | 'selfDies', oid: string): GameEvent {
  return { type: 'abilityTriggered', player: 0, oid, source, index: 0, condition };
}

describe('the trigger census', () => {
  it('counts one chance per arrival per printed triggered ability', () => {
    const census = censusGameTriggers(
      [entered('o1'), fired('o1', 'selfEnters', 'ab1')],
      stateWith([['o1', TWO_TRIGGERS]]),
    );
    expect(census.conditions.selfEnters).toEqual({ instances: 1, fires: 1, games: 1 });
    // The death trigger was printed and never fired: one chance, no takings.
    expect(census.conditions.selfDies).toEqual({ instances: 1, fires: 0, games: 1 });
  });

  it('raises the denominator for an ability that never fires, so 0 is a measurement', () => {
    const census = censusGameTriggers([entered('o1')], stateWith([['o1', ENTER_ONLY]]));
    expect(firesPerInstance(census, 'selfEnters')).toBe(0);
  });

  it('reports an unplayed condition as unmeasured rather than as zero', () => {
    const census = censusGameTriggers([entered('o1')], stateWith([['o1', ENTER_ONLY]]));
    expect(census.conditions.youGainLife.instances).toBe(0);
    expect(firesPerInstance(census, 'youGainLife')).toBeNull();
  });

  it('counts the same permanent twice when it arrives twice', () => {
    const census = censusGameTriggers(
      [entered('o1'), fired('o1', 'selfEnters', 'ab1'), entered('o1'), fired('o1', 'selfEnters', 'ab2')],
      stateWith([['o1', ENTER_ONLY]]),
    );
    expect(census.conditions.selfEnters).toEqual({ instances: 2, fires: 2, games: 1 });
  });

  it('reports an arrival the final state cannot name instead of dropping it', () => {
    const census = censusGameTriggers([entered('missing')], stateWith([]));
    expect(census.unresolvedArrivals).toBe(1);
    expect(census.conditions.selfEnters.instances).toBe(0);
  });

  it('adds instances, fires and games when censuses merge', () => {
    const first = censusGameTriggers(
      [entered('o1'), fired('o1', 'selfEnters', 'ab1')],
      stateWith([['o1', ENTER_ONLY]]),
    );
    const second = censusGameTriggers([entered('o2')], stateWith([['o2', ENTER_ONLY]]));
    const merged = mergeTriggerCensus(first, second);
    expect(merged.conditions.selfEnters).toEqual({ instances: 2, fires: 1, games: 2 });
    expect(merged.games).toBe(2);
    expect(firesPerInstance(merged, 'selfEnters')).toBe(0.5);
  });

  it('counts a game only once per condition however many arrivals it held', () => {
    const census = censusGameTriggers(
      [entered('o1'), entered('o2')],
      stateWith([
        ['o1', ENTER_ONLY],
        ['o2', ENTER_ONLY],
      ]),
    );
    expect(census.conditions.selfEnters).toEqual({ instances: 2, fires: 0, games: 1 });
  });

  it('sums to the empty census over no games', () => {
    expect(sumTriggerCensus([])).toEqual(emptyTriggerCensus());
    expect(emptyTriggerCensus().games).toBe(0);
  });
});

function heraldDeck(name: string, card: Card): DeckList {
  return {
    name,
    cards: [...Array.from({ length: 16 }, () => card), ...Array.from({ length: 24 }, () => PLAINS)],
  };
}

describe('the census over a real seeded game', () => {
  it('pairs every selfEnters fire with exactly one arrival', () => {
    const deck = heraldDeck('heralds', ENTER_ONLY);
    const outcome = playSimGame({
      index: 0,
      seed: 'trigger-census/0',
      decks: [deck, heraldDeck('heralds-b', ENTER_ONLY)],
      agents: [createBot(greedySpec('greedy-a'), 'a', 0), createBot(greedySpec('greedy-b'), 'b', 1)],
      startingPlayer: 0,
      log: null,
      censusAbilities: true,
    });
    const census = outcome.triggerCensus;
    expect(census).not.toBeNull();
    if (census === null) return;
    expect(census.unresolvedArrivals).toBe(0);
    expect(census.conditions.selfEnters.instances).toBeGreaterThan(0);
    // The arrival is the triggering event, so the ratio is 1 by construction.
    expect(census.conditions.selfEnters.fires).toBe(census.conditions.selfEnters.instances);
    expect(firesPerInstance(census, 'selfEnters')).toBe(1);
  });

  it('builds no census when the caller did not ask for one', () => {
    const deck = heraldDeck('heralds', ENTER_ONLY);
    const outcome = playSimGame({
      index: 0,
      seed: 'trigger-census/1',
      decks: [deck, heraldDeck('heralds-b', ENTER_ONLY)],
      agents: [createBot(greedySpec('greedy-a'), 'a', 0), createBot(greedySpec('greedy-b'), 'b', 1)],
      startingPlayer: 0,
      log: null,
    });
    expect(outcome.triggerCensus).toBeNull();
  });
});
