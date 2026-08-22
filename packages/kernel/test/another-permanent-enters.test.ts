/**
 * `anotherControlledPermanentEnters` and `anotherControlledCreatureEnters`:
 * CR 603.6e's "another permanent" trigger, and its creature-filtered sibling.
 *
 * Both extend `case 'permanentEntered'`, the same event `selfEnters` already
 * reads, so the three assertions this file has to carry are the ones that
 * event alone does not settle: that the scan excludes the entering permanent
 * itself (it is "another", never the permanent that just arrived), that the
 * creature-filtered member narrows to creatures and the unfiltered one does
 * not, and that both stay scoped to the entering permanent's own controller —
 * "you control", not "enters the battlefield" unqualified.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import {
  eventsOfType,
  playerOf,
  reduce,
  reduceAll,
  scenario,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { artifact, creature, MOUNTAIN, sorcery } from './cards';
import { oidOf } from './helpers';

/** A noncreature permanent, so its trigger can only be the unfiltered member. */
function permanentWarden(name: string): Card {
  return artifact(name, { generic: 1 }, [
    {
      kind: 'triggered',
      condition: 'anotherControlledPermanentEnters',
      effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
    },
  ]);
}

function creatureWarden(name: string): Card {
  return creature(name, 2, 2, {
    abilities: [
      {
        kind: 'triggered',
        condition: 'anotherControlledCreatureEnters',
        effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
      },
    ],
  });
}

/**
 * A token that carries the unfiltered condition on itself, so its own arrival
 * is the self-exclusion check: if the scan ever included the entering
 * permanent, this is the ability that would fire off nothing else.
 */
const MAKE_SELF_WATCHING_TOKEN = sorcery(
  'Call the Sentinel',
  [
    {
      kind: 'createToken',
      count: 1,
      token: {
        name: 'Sentinel',
        power: 2,
        toughness: 2,
        colors: ['R'],
        subtypes: ['Soldier'],
        keywords: [],
        abilities: [
          {
            kind: 'triggered',
            condition: 'anotherControlledPermanentEnters',
            effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
          },
        ],
      },
    },
  ],
  { generic: 1, R: 1 },
);

function conditionsFiredBy(result: ReduceResult, source: ObjectId): readonly string[] {
  return eventsOfType(result.events, 'abilityTriggered')
    .filter((event) => event.source === source)
    .map((event) => event.condition);
}

/** Casts the lone sorcery in the caster's hand and resolves it fully. */
function castAndResolve(state: GameState, player: 0 | 1): ReduceResult {
  const oid = playerOf(state, player).hand[0] ?? '';
  const cast = reduce(state, { type: 'castSpell', player, oid, targets: [null] });
  const resolved = reduceAll(cast.state, [
    { type: 'passPriority', player: 0 },
    { type: 'passPriority', player: 1 },
  ]);
  return { state: resolved.state, events: [...cast.events, ...resolved.events] };
}

function tokenOid(state: GameState): ObjectId {
  const found = state.battlefield.find((oid) => state.objects[oid]?.token === true);
  if (found === undefined) throw new Error('no token on the battlefield');
  return found;
}

describe('whenever another permanent you control enters the battlefield', () => {
  it('fires the permanent watcher and the creature watcher off a creature token, never the token itself', () => {
    const start = scenario({
      battlefield: [
        { card: permanentWarden('Permanent Warden'), controller: 0 },
        { card: creatureWarden('Creature Warden'), controller: 0 },
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[MAKE_SELF_WATCHING_TOKEN], []],
    }).state;

    const result = castAndResolve(start, 0);
    const permanentOid = oidOf(result.state, 'Permanent Warden');
    const creatureOid = oidOf(result.state, 'Creature Warden');
    const sentinel = tokenOid(result.state);

    expect(conditionsFiredBy(result, permanentOid)).toEqual(['anotherControlledPermanentEnters']);
    expect(conditionsFiredBy(result, creatureOid)).toEqual(['anotherControlledCreatureEnters']);
    // The self-exclusion check: the token prints the same unfiltered
    // condition, and its own arrival is not "another" to itself.
    expect(conditionsFiredBy(result, sentinel)).toEqual([]);
  });

  it('fires the permanent watcher but not the creature watcher when a land enters', () => {
    const start = scenario({
      battlefield: [
        { card: permanentWarden('Permanent Warden'), controller: 0 },
        { card: creatureWarden('Creature Warden'), controller: 0 },
      ],
      hands: [[MOUNTAIN], []],
    }).state;
    const oid = playerOf(start, 0).hand[0] ?? '';
    const result = reduce(start, { type: 'playLand', player: 0, oid });

    const permanentOid = oidOf(result.state, 'Permanent Warden');
    const creatureOid = oidOf(result.state, 'Creature Warden');
    expect(conditionsFiredBy(result, permanentOid)).toEqual(['anotherControlledPermanentEnters']);
    expect(conditionsFiredBy(result, creatureOid)).toEqual([]);
  });

  it("does not fire for a permanent watcher when the entering permanent is the opponent's", () => {
    const start = scenario({
      battlefield: [{ card: permanentWarden('Permanent Warden'), controller: 0 }],
      hands: [[], [MOUNTAIN]],
      active: 1,
    }).state;
    const oid = playerOf(start, 1).hand[0] ?? '';
    const result = reduce(start, { type: 'playLand', player: 1, oid });

    const permanentOid = oidOf(result.state, 'Permanent Warden');
    expect(conditionsFiredBy(result, permanentOid)).toEqual([]);
  });
});
