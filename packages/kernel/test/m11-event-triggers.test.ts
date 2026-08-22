/**
 * The three event readings M11's cards needed: a spell's color, noncombat
 * damage to a player, and a power threshold on an arrival.
 *
 * `packages/dsl/test/m11-event-triggers.test.ts` is what those cards *say*;
 * this file is what the kernel *does* with the events they watch. Each of the
 * three scans differently from everything `conditionsFrom` already had, and
 * the difference is what is asserted here rather than the payoff: the color
 * members scan the whole battlefield rather than the caster's half,
 * `opponentDealtNoncombatDamage` scans on an inverted controller filter, and
 * the power member is a strictly narrower arrival than the member beside it.
 *
 * Every fixture's payoff is `drawCards`, never the effect the printed card
 * carries. A trigger whose payoff is the event it watches for can refire
 * itself, and an assertion that only reads "it fired" cannot tell one firing
 * from a loop.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card, TriggerCondition } from '@mtg/dsl';
import {
  eventsOfType,
  playerOf,
  reduce,
  reduceAll,
  scenario,
  type GameState,
  type ObjectId,
  type ReduceResult,
  type Target,
} from '@mtg/kernel';
import { artifact, creature, instant, ISLAND, MOUNTAIN, PLAINS, sorcery } from './cards';
import { oidOf, playCombat } from './helpers';

function draws(condition: TriggerCondition): AbilityInput {
  return {
    kind: 'triggered',
    condition,
    effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
  };
}

function conditionsFiredBy(result: ReduceResult, source: ObjectId): readonly string[] {
  return eventsOfType(result.events, 'abilityTriggered')
    .filter((event) => event.source === source)
    .map((event) => event.condition);
}

/** Casts the lone spell in a seat's hand at the given targets and resolves it. */
function castAndResolve(
  state: GameState,
  player: 0 | 1,
  targets: readonly (Target | null)[] = [null],
): ReduceResult {
  const oid = playerOf(state, player).hand[0] ?? '';
  const cast = reduce(state, { type: 'castSpell', player, oid, targets });
  const resolved = reduceAll(cast.state, [
    { type: 'passPriority', player },
    { type: 'passPriority', player: player === 0 ? 1 : 0 },
  ]);
  return { state: resolved.state, events: [...cast.events, ...resolved.events] };
}

describe('whenever a player casts a spell of a named color', () => {
  const FEATHER = artifact('Test Feather', { generic: 2 }, [draws('aPlayerCastsWhiteSpell')]);
  const EYE = artifact('Test Eye', { generic: 2 }, [draws('aPlayerCastsBlueSpell')]);
  const WHITE_SPELL: Card = instant(
    'Test Blessing',
    [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
    { W: 1 },
  );
  const BLUE_SPELL: Card = instant(
    'Test Notion',
    [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
    { U: 1 },
  );
  const TWO_COLOR_SPELL: Card = instant(
    'Test Dawn Tide',
    [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
    { W: 1, U: 1 },
  );

  it('fires for its own controller casting the named color', () => {
    const start = scenario({
      battlefield: [
        { card: FEATHER, controller: 0 },
        { card: PLAINS, controller: 0 },
      ],
      hands: [[WHITE_SPELL], []],
    }).state;
    const result = castAndResolve(start, 0);
    expect(conditionsFiredBy(result, oidOf(result.state, 'Test Feather'))).toEqual([
      'aPlayerCastsWhiteSpell',
    ]);
  });

  /**
   * The assertion the condition exists for. Every other cast condition in this
   * vocabulary filters the scan to `event.player`; this one does not, because
   * the printed line says "a player" and the artifact sits on one seat's
   * battlefield watching both.
   */
  it('fires for the other seat casting the named color', () => {
    const start = scenario({
      battlefield: [
        { card: FEATHER, controller: 0 },
        { card: PLAINS, controller: 1 },
      ],
      hands: [[], [WHITE_SPELL]],
      active: 1,
    }).state;
    const result = castAndResolve(start, 1);
    expect(conditionsFiredBy(result, oidOf(result.state, 'Test Feather'))).toEqual([
      'aPlayerCastsWhiteSpell',
    ]);
  });

  it('stays silent on a spell of another color', () => {
    const start = scenario({
      battlefield: [
        { card: FEATHER, controller: 0 },
        { card: ISLAND, controller: 0 },
      ],
      hands: [[BLUE_SPELL], []],
    }).state;
    const result = castAndResolve(start, 0);
    expect(conditionsFiredBy(result, oidOf(result.state, 'Test Feather'))).toEqual([]);
  });

  /** CR 105.2b: a two-color spell is both colors, so it answers each once. */
  it('answers a two-color spell once per color rather than one member twice', () => {
    const start = scenario({
      battlefield: [
        { card: FEATHER, controller: 0 },
        { card: EYE, controller: 0 },
        { card: PLAINS, controller: 0 },
        { card: ISLAND, controller: 0 },
      ],
      hands: [[TWO_COLOR_SPELL], []],
    }).state;
    const result = castAndResolve(start, 0);
    expect(conditionsFiredBy(result, oidOf(result.state, 'Test Feather'))).toEqual([
      'aPlayerCastsWhiteSpell',
    ]);
    expect(conditionsFiredBy(result, oidOf(result.state, 'Test Eye'))).toEqual(['aPlayerCastsBlueSpell']);
  });
});

describe('whenever an opponent is dealt noncombat damage', () => {
  const EMBERKIN: Card = creature('Test Emberkin', 1, 3, {
    cost: { generic: 2, R: 1 },
    abilities: [draws('opponentDealtNoncombatDamage')],
  });
  const JOLT: Card = instant(
    'Test Jolt',
    [{ kind: 'dealDamage', amount: 2, target: { kind: 'targetPlayer' } }],
    { R: 1 },
  );
  const SINGE: Card = instant(
    'Test Singe',
    [{ kind: 'dealDamage', amount: 1, target: { kind: 'targetCreature' } }],
    { R: 1 },
  );

  it('fires when a spell damages the seat that does not control it', () => {
    const start = scenario({
      battlefield: [
        { card: EMBERKIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[JOLT], []],
    }).state;
    const result = castAndResolve(start, 0, [{ kind: 'player', player: 1 }]);
    expect(conditionsFiredBy(result, oidOf(result.state, 'Test Emberkin'))).toEqual([
      'opponentDealtNoncombatDamage',
    ]);
    expect(result.state.players[1].life).toBe(18);
  });

  /**
   * The inverted-filter half. "An opponent" is said from the source's own
   * controller's side, so the damaged seat's permanents are exactly the ones
   * that must not fire, and a scan written the ordinary way round would fire
   * here.
   */
  it('stays silent when its own controller is the damaged seat', () => {
    const start = scenario({
      battlefield: [
        { card: EMBERKIN, controller: 0 },
        { card: MOUNTAIN, controller: 1 },
      ],
      hands: [[], [JOLT]],
      active: 1,
    }).state;
    const result = castAndResolve(start, 1, [{ kind: 'player', player: 0 }]);
    expect(conditionsFiredBy(result, oidOf(result.state, 'Test Emberkin'))).toEqual([]);
    expect(result.state.players[0].life).toBe(18);
  });

  it('stays silent on damage aimed at a creature, because the condition names a player', () => {
    const dummy: Card = creature('Test Straw Man', 2, 2, { cost: { generic: 2 } });
    const start = scenario({
      battlefield: [
        { card: EMBERKIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
        { card: dummy, controller: 1 },
      ],
      hands: [[SINGE], []],
    }).state;
    const target = oidOf(start, 'Test Straw Man');
    const result = castAndResolve(start, 0, [{ kind: 'permanent', oid: target }]);
    expect(conditionsFiredBy(result, oidOf(result.state, 'Test Emberkin'))).toEqual([]);
  });

  it('stays silent on combat damage, which is the half `event.combat` already separated', () => {
    const bruiser: Card = creature('Test Bruiser', 3, 3, { cost: { generic: 3 } });
    const start = scenario({
      battlefield: [
        { card: EMBERKIN, controller: 0 },
        { card: bruiser, controller: 0 },
      ],
      step: 'declareAttackers',
    });
    const attacker = oidOf(start.state, 'Test Bruiser');
    const done = playCombat(start, { attackers: [attacker], blocks: [] });
    expect(done.state.players[1].life).toBe(17);
    expect(conditionsFiredBy(done, oidOf(done.state, 'Test Emberkin'))).toEqual([]);
  });
});

describe('whenever another creature you control with power 3 or greater enters', () => {
  const PACKLEADER: Card = creature('Test Packleader', 4, 4, {
    cost: { generic: 4, G: 1 },
    abilities: [draws('anotherControlledCreatureWithPowerThreeOrGreaterEnters')],
  });
  /** The same event with the power clause dropped, so the narrowing is visible. */
  const WATCHER: Card = creature('Test Watcher', 2, 2, {
    cost: { generic: 2 },
    abilities: [draws('anotherControlledCreatureEnters')],
  });

  function summon(name: string, power: number, toughness: number): Card {
    return sorcery(
      `Call the ${name}`,
      [
        {
          kind: 'createToken',
          count: 1,
          token: {
            name,
            power,
            toughness,
            colors: ['R'],
            subtypes: ['Soldier'],
            keywords: [],
          },
        },
      ],
      { generic: 1, R: 1 },
    );
  }

  function arrival(body: Card, controller: 0 | 1): ReduceResult {
    const start = scenario({
      battlefield: [
        { card: PACKLEADER, controller: 0 },
        { card: WATCHER, controller: 0 },
        { card: MOUNTAIN, controller },
        { card: MOUNTAIN, controller },
      ],
      hands: controller === 0 ? [[body], []] : [[], [body]],
      ...(controller === 1 ? { active: 1 as const } : {}),
    }).state;
    return castAndResolve(start, controller);
  }

  it('fires on a power-3 arrival under the same controller', () => {
    const result = arrival(summon('Boar', 3, 3), 0);
    expect(conditionsFiredBy(result, oidOf(result.state, 'Test Packleader'))).toEqual([
      'anotherControlledCreatureWithPowerThreeOrGreaterEnters',
    ]);
    expect(conditionsFiredBy(result, oidOf(result.state, 'Test Watcher'))).toEqual([
      'anotherControlledCreatureEnters',
    ]);
  });

  it('stays silent on a power-2 arrival that the wider member still answers', () => {
    const result = arrival(summon('Cub', 2, 2), 0);
    expect(conditionsFiredBy(result, oidOf(result.state, 'Test Packleader'))).toEqual([]);
    expect(conditionsFiredBy(result, oidOf(result.state, 'Test Watcher'))).toEqual([
      'anotherControlledCreatureEnters',
    ]);
  });

  it("stays silent on the other seat's big creature", () => {
    const result = arrival(summon('Ogre', 4, 4), 1);
    expect(conditionsFiredBy(result, oidOf(result.state, 'Test Packleader'))).toEqual([]);
    expect(conditionsFiredBy(result, oidOf(result.state, 'Test Watcher'))).toEqual([]);
  });
});
