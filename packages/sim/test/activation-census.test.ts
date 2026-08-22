/**
 * The per-arm activation census: chances offered, chances taken, hosts armed.
 *
 * `@mtg/deckbuild` prices an activated ability three different ways —
 * `activationUseCount`, that times `activationTapFactor` when the cost carries
 * `{T}`, and `equipHostCount` instead of either for an equip — and all three
 * were written by hand. The arms below are what makes them separately
 * measurable, so the assertions are about which arm an ability lands in at
 * least as much as about the count.
 *
 * The equip arm is the one that can go quietly wrong. It counts distinct hosts
 * rather than payments, because `equipHostCount`'s own docblock says paying
 * twice in a turn is worth nothing at all, and the cases below pin both halves
 * of that: a second equip onto the same creature adds no host, and a permanent
 * that arrives a second time starts its host set empty.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card, CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { DeckList, GameEvent, GameObject, GameState } from '@mtg/kernel';
import { NO_COUNTERS, scenario } from '@mtg/kernel';
import {
  activationArm,
  censusGameActivations,
  createBot,
  emptyActivationCensus,
  greedySpec,
  hostsPerInstance,
  mergeActivationCensus,
  playSimGame,
  sumActivationCensus,
  tapFactor,
  usesPerInstance,
} from '@mtg/sim';
import { PLAINS } from './cards';

const PING: AbilityInput = {
  kind: 'activated',
  cost: { mana: { generic: 1 }, tapSelf: false, sacrificeSelf: false },
  effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'targetCreature' } }],
};

const TAP_PING: AbilityInput = {
  kind: 'activated',
  cost: { mana: { generic: 1 }, tapSelf: true, sacrificeSelf: false },
  effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'targetCreature' } }],
};

const EQUIP: AbilityInput = {
  kind: 'activated',
  cost: { mana: { generic: 2 }, tapSelf: false, sacrificeSelf: false },
  attach: { modifications: [{ kind: 'statBonus', power: 2, toughness: 0 }] },
  effects: [],
};

function bearer(name: string, collectorNumber: number, abilities: readonly AbilityInput[]): Card {
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

const PINGER = bearer('Lantern Sentry', 910, [PING]);
const TAPPER = bearer('Tolling Sentry', 911, [TAP_PING]);
const BOTH = bearer('Twin Sentry', 912, [PING, TAP_PING]);

function weapon(name: string, collectorNumber: number): Card {
  const input: CardInput = {
    kind: 'artifact',
    id: `tst-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber },
    manaCost: { generic: 1 },
    colors: [],
    subtypes: ['Equipment'],
    abilities: [EQUIP],
  };
  return parseCard(input);
}

const WEAPON = weapon('Field Blade', 913);

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

function activated(source: string, index: number, host: string | null = null): GameEvent {
  return {
    type: 'abilityActivated',
    player: 0,
    oid: `${source}-ab`,
    source,
    index,
    targets: host === null ? [] : [{ kind: 'permanent', oid: host }],
    chosenX: null,
  };
}

describe('which weight prices an ability', () => {
  it('sorts a plain paid ability, a tap ability and an equip into three arms', () => {
    expect(activationArm(PINGER.abilities[0]!)).toBe('paid');
    expect(activationArm(TAPPER.abilities[0]!)).toBe('tapped');
    expect(activationArm(WEAPON.abilities[0]!)).toBe('equip');
  });

  it('is null for an ability no activation weight prices', () => {
    const triggered: AbilityInput = {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
    };
    expect(activationArm(bearer('Dawn Sentry', 914, [triggered]).abilities[0]!)).toBeNull();
  });
});

describe('the activation census', () => {
  it('counts one chance per arrival per printed activated ability', () => {
    const census = censusGameActivations([entered('o1'), activated('o1', 0)], stateWith([['o1', BOTH]]));
    expect(census.arms.paid).toEqual({ instances: 1, activations: 1, hosts: 0, games: 1 });
    // The tap ability was printed and never used: one chance, no takings.
    expect(census.arms.tapped).toEqual({ instances: 1, activations: 0, hosts: 0, games: 1 });
  });

  it('raises the denominator for an ability that is never used, so 0 is a measurement', () => {
    const census = censusGameActivations([entered('o1')], stateWith([['o1', PINGER]]));
    expect(usesPerInstance(census, 'paid')).toBe(0);
  });

  it('reports an unplayed arm as unmeasured rather than as zero', () => {
    const census = censusGameActivations([entered('o1')], stateWith([['o1', PINGER]]));
    expect(census.arms.equip.instances).toBe(0);
    expect(usesPerInstance(census, 'equip')).toBeNull();
    expect(hostsPerInstance(census)).toBeNull();
  });

  it('counts the same permanent twice when it arrives twice', () => {
    const census = censusGameActivations(
      [entered('o1'), activated('o1', 0), entered('o1'), activated('o1', 0)],
      stateWith([['o1', PINGER]]),
    );
    expect(census.arms.paid).toEqual({ instances: 2, activations: 2, hosts: 0, games: 1 });
  });

  it('reports an arrival the final state cannot name instead of dropping it', () => {
    const census = censusGameActivations([entered('missing')], stateWith([]));
    expect(census.unresolvedArrivals).toBe(1);
    expect(census.arms.paid.instances).toBe(0);
  });

  it('reports an activation whose source the final state cannot name', () => {
    const census = censusGameActivations([activated('missing', 0)], stateWith([]));
    expect(census.unresolvedActivations).toBe(1);
    expect(census.arms.paid.activations).toBe(0);
  });

  it('reads the tap factor as a ratio of the two arms rather than as a count', () => {
    const census = censusGameActivations(
      [entered('o1'), activated('o1', 0), activated('o1', 0), activated('o1', 1)],
      stateWith([['o1', BOTH]]),
    );
    expect(usesPerInstance(census, 'paid')).toBe(2);
    expect(usesPerInstance(census, 'tapped')).toBe(1);
    expect(tapFactor(census)).toBe(0.5);
  });

  it('leaves the tap factor unmeasured when either arm has no sample', () => {
    const census = censusGameActivations([entered('o1'), activated('o1', 0)], stateWith([['o1', PINGER]]));
    expect(tapFactor(census)).toBeNull();
  });

  it('counts an equip once per host however many times it was paid for', () => {
    const census = censusGameActivations(
      [entered('w1'), activated('w1', 0, 'c1'), activated('w1', 0, 'c1'), activated('w1', 0, 'c2')],
      stateWith([['w1', WEAPON]]),
    );
    expect(census.arms.equip).toEqual({ instances: 1, activations: 3, hosts: 2, games: 1 });
    expect(hostsPerInstance(census)).toBe(2);
    // The payments are kept beside the hosts because a run where the two
    // diverge sharply is worth looking at, and they are not the same number.
    expect(usesPerInstance(census, 'equip')).toBe(3);
  });

  it('starts a re-entering weapon on an empty host set', () => {
    const census = censusGameActivations(
      [entered('w1'), activated('w1', 0, 'c1'), entered('w1'), activated('w1', 0, 'c1')],
      stateWith([['w1', WEAPON]]),
    );
    // Two instances, and the same creature armed once in each life is two hosts.
    expect(census.arms.equip).toEqual({ instances: 2, activations: 2, hosts: 2, games: 1 });
    expect(hostsPerInstance(census)).toBe(1);
  });

  it('adds instances, activations, hosts and games when censuses merge', () => {
    const first = censusGameActivations([entered('o1'), activated('o1', 0)], stateWith([['o1', PINGER]]));
    const second = censusGameActivations([entered('o2')], stateWith([['o2', PINGER]]));
    const merged = mergeActivationCensus(first, second);
    expect(merged.arms.paid).toEqual({ instances: 2, activations: 1, hosts: 0, games: 2 });
    expect(merged.games).toBe(2);
    expect(usesPerInstance(merged, 'paid')).toBe(0.5);
  });

  it('counts a game only once per arm however many arrivals it held', () => {
    const census = censusGameActivations(
      [entered('o1'), entered('o2')],
      stateWith([
        ['o1', PINGER],
        ['o2', PINGER],
      ]),
    );
    expect(census.arms.paid).toEqual({ instances: 2, activations: 0, hosts: 0, games: 1 });
  });

  it('sums to the empty census over no games', () => {
    expect(sumActivationCensus([])).toEqual(emptyActivationCensus());
    expect(emptyActivationCensus().games).toBe(0);
  });
});

function sentryDeck(name: string, card: Card): DeckList {
  return {
    name,
    cards: [...Array.from({ length: 16 }, () => card), ...Array.from({ length: 24 }, () => PLAINS)],
  };
}

describe('the census over a real seeded game', () => {
  it('offers a chance for every sentry that reached the battlefield', () => {
    const outcome = playSimGame({
      index: 0,
      seed: 'activation-census/0',
      decks: [sentryDeck('sentries-a', TAPPER), sentryDeck('sentries-b', TAPPER)],
      agents: [createBot(greedySpec('greedy-a'), 'a', 0), createBot(greedySpec('greedy-b'), 'b', 1)],
      startingPlayer: 0,
      log: null,
      censusAbilities: true,
    });
    const census = outcome.activationCensus;
    expect(census).not.toBeNull();
    if (census === null) return;
    expect(census.unresolvedArrivals).toBe(0);
    expect(census.unresolvedActivations).toBe(0);
    expect(census.arms.tapped.instances).toBeGreaterThan(0);
    // Nothing in this deck prints either other arm, so both stay unmeasured.
    expect(usesPerInstance(census, 'paid')).toBeNull();
    expect(usesPerInstance(census, 'equip')).toBeNull();
  });

  it('builds no census when the caller did not ask for one', () => {
    const outcome = playSimGame({
      index: 0,
      seed: 'activation-census/1',
      decks: [sentryDeck('sentries-a', PINGER), sentryDeck('sentries-b', PINGER)],
      agents: [createBot(greedySpec('greedy-a'), 'a', 0), createBot(greedySpec('greedy-b'), 'b', 1)],
      startingPlayer: 0,
      log: null,
    });
    expect(outcome.activationCensus).toBeNull();
  });
});
