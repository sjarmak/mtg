/**
 * `selfDealsCombatDamageToCreature` and the gloom counter it puts down.
 *
 * The two additions are one mechanic and are tested together, because either
 * one alone proves nothing about the card: a trigger that fires on the wrong
 * event still puts a counter somewhere, and a counter that shrinks the wrong
 * creature still shrinks one. What the assertions below pin is the *cause* —
 * the trigger fires on combat damage to a creature and on nothing else, and the
 * counter lands on the creature that took it.
 *
 * The negative arms are the load-bearing ones. `damageDealt` is a single event
 * covering every source of damage in the kernel, so the condition is a set of
 * narrowings on one record (`triggers.ts`) and each gets a board here: damage
 * to a player rather than a creature, damage from the same creature's own
 * activated ability rather than from combat, and a combat this creature took no
 * part in. Each is read off `abilityTriggered` rather than off the board,
 * because "no gloom counter appeared" is also what a trigger that fired and
 * fizzled looks like.
 *
 * The last describe holds the counter's own half: gloom is a -1/-1 in every
 * respect layer 7d can see, so two of them take a 3/3 to a 1/1 and three kill
 * it as a state-based action (CR 704.5f), with no branch anywhere reading the
 * kind by name.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { counterReminderText, gloomAbility } from '@mtg/dsl';
import type { GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import { characteristicsOf, eventsOfType, pendingDecision, scenario } from '@mtg/kernel';
import { creature, FOREST, instant } from './cards';
import { apply, handOidOf, inGraveyard, oidOf, playCombat } from './helpers';

/**
 * `Whenever CARDNAME deals combat damage to a creature, put a gloom counter on
 * that creature.` plus `{T}: CARDNAME deals 1 damage to target creature.`
 *
 * The second ability is not decoration: it is the only way to make this exact
 * source deal damage that is not combat damage, which is the narrowing the
 * `combat` flag exists for. A different source dealing the damage would prove
 * only that the trigger reads `sourceOid`.
 */
const GLOOM_STALKER: Card = creature('Gloom Stalker', 2, 2, {
  cost: { generic: 2, B: 1 },
  subtypes: ['Horror'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDealsCombatDamageToCreature',
      effects: [{ kind: 'putCounters', counter: 'gloom', count: 1, target: { kind: 'triggeringCreature' } }],
    },
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'targetCreature' } }],
    },
  ],
});

/** The body that takes the damage and survives it, so the counter has somewhere to sit. */
const BULWARK: Card = creature('Stone Bulwark', 0, 5, { cost: { generic: 3 } });

/** A 3/3 with no abilities, for the counter arithmetic. */
const OX: Card = creature('Gray Ox', 3, 3, { cost: { generic: 3 } });

/** `Put two gloom counters on target creature.` */
const CREEPING_GLOOM: Card = instant('Creeping Gloom', [
  { kind: 'putCounters', counter: 'gloom', count: 2, target: { kind: 'targetCreature' } },
]);

/** The third counter, cast separately so the lethal one is its own move. */
const LAST_SHADOW: Card = instant('Last Shadow', [
  { kind: 'putCounters', counter: 'gloom', count: 1, target: { kind: 'targetCreature' } },
]);

function conditionsFiredBy(result: ReduceResult, source: ObjectId): readonly string[] {
  return eventsOfType(result.events, 'abilityTriggered')
    .filter((event) => event.source === source)
    .map((event) => event.condition);
}

function gloomOn(state: GameState, oid: ObjectId): number {
  return state.objects[oid]?.counters.gloom ?? 0;
}

function statsOf(state: GameState, oid: ObjectId): string {
  const current = characteristicsOf(state, oid);
  return `${current.power}/${current.toughness}`;
}

/** Casts the named spell from player 0's hand at one permanent, and resolves it. */
function castAt(current: ReduceResult, name: string, victim: ObjectId): ReduceResult {
  return emptyStack(
    apply(current, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(current.state, 0, name),
      targets: [{ kind: 'permanent', oid: victim }],
    }),
  );
}

/** Passes priority until the stack is empty, so a trigger finishes resolving. */
function emptyStack(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 16; guard += 1) {
    if (current.state.stack.length === 0) return current;
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('the stack did not empty');
}

describe('a trigger on combat damage dealt to a creature', () => {
  it('puts a gloom counter on the blocker it damaged', () => {
    const start = scenario({
      battlefield: [
        { card: GLOOM_STALKER, controller: 0 },
        { card: BULWARK, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const stalker = oidOf(start.state, 'Gloom Stalker');
    const bulwark = oidOf(start.state, 'Stone Bulwark');

    const done = playCombat(start, {
      attackers: [stalker],
      blocks: [{ blocker: bulwark, attacker: stalker }],
    });

    expect(conditionsFiredBy(done, stalker)).toEqual(['selfDealsCombatDamageToCreature']);
    expect(gloomOn(done.state, bulwark)).toBe(1);
    expect(statsOf(done.state, bulwark)).toBe('-1/4');
    // The counter went on the creature that took the damage and nowhere else.
    expect(gloomOn(done.state, stalker)).toBe(0);
  });

  it('does not fire when the damage went to a player', () => {
    const start = scenario({
      battlefield: [{ card: GLOOM_STALKER, controller: 0 }],
      step: 'declareAttackers',
    });
    const stalker = oidOf(start.state, 'Gloom Stalker');

    const done = playCombat(start, { attackers: [stalker], blocks: [] });

    expect(done.state.players[1].life).toBe(18);
    expect(conditionsFiredBy(done, stalker)).toEqual([]);
  });

  /**
   * Same source, same creature, same amount of damage — and no trigger, because
   * the damage did not come from a combat damage step. This is the arm a kernel
   * that read `damageDealt` without its `combat` flag would fail.
   */
  it('does not fire on damage from its own activated ability', () => {
    const start = scenario({
      battlefield: [
        { card: GLOOM_STALKER, controller: 0 },
        { card: BULWARK, controller: 1 },
      ],
    });
    const stalker = oidOf(start.state, 'Gloom Stalker');
    const bulwark = oidOf(start.state, 'Stone Bulwark');

    const pinged = emptyStack(
      apply(start, {
        type: 'activateAbility',
        player: 0,
        oid: stalker,
        abilityIndex: 1,
        targets: [{ kind: 'permanent', oid: bulwark }],
        sacrifices: [],
      }),
    );

    const damage = eventsOfType(pinged.events, 'damageDealt');
    expect(damage.map((event) => ({ source: event.sourceOid, combat: event.combat }))).toEqual([
      { source: stalker, combat: false },
    ]);
    expect(conditionsFiredBy(pinged, stalker)).toEqual([]);
    expect(gloomOn(pinged.state, bulwark)).toBe(0);
  });

  /**
   * An unblocked attack by somebody else, with the stalker sitting at home. The
   * combat damage step ran and the trigger still has nothing to read, which is
   * the `sourceOid` half of the condition.
   */
  it('does not fire on a combat its source took no part in', () => {
    const start = scenario({
      battlefield: [
        { card: GLOOM_STALKER, controller: 0 },
        { card: OX, controller: 0 },
        { card: BULWARK, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const stalker = oidOf(start.state, 'Gloom Stalker');
    const ox = oidOf(start.state, 'Gray Ox');
    const bulwark = oidOf(start.state, 'Stone Bulwark');

    const done = playCombat(start, {
      attackers: [ox],
      blocks: [{ blocker: bulwark, attacker: ox }],
    });

    expect(conditionsFiredBy(done, stalker)).toEqual([]);
    expect(gloomOn(done.state, bulwark)).toBe(0);
  });
});

describe('what a gloom counter does', () => {
  /**
   * Driven by a hand-authored spell rather than by the trigger, on purpose: the
   * arithmetic is a property of the declaration and layer 7d, and running it
   * through combat would make this a second test of the trigger with a slower
   * setup. The spell is legal DSL — `parseCard` in `./cards` would refuse it
   * otherwise — which is also the check that `putCounters` accepts the new kind.
   */
  it('shrinks a 3/3 to a 1/1, and a lethal count kills it as a state-based action', () => {
    const start = scenario({
      battlefield: [
        { card: OX, controller: 0 },
        ...Array.from({ length: 4 }, () => ({ card: FOREST, controller: 0 as const })),
      ],
      hands: [[CREEPING_GLOOM, LAST_SHADOW], []],
    });
    const ox = oidOf(start.state, 'Gray Ox');
    expect(statsOf(start.state, ox)).toBe('3/3');

    const twice = castAt(start, 'Creeping Gloom', ox);
    expect(gloomOn(twice.state, ox)).toBe(2);
    expect(statsOf(twice.state, ox)).toBe('1/1');
    expect(inGraveyard(twice.state, ox)).toBe(false);
    // Nothing was marked on it: the shrink is a continuous effect, not damage.
    expect(twice.state.objects[ox]?.damage).toBe(0);

    const lethal = castAt(twice, 'Last Shadow', ox);
    // CR 704.5f: toughness 0, so it goes to the graveyard.
    expect(inGraveyard(lethal.state, ox)).toBe(true);
  });
});

describe('the printed reminder', () => {
  it('says what the counter does, derived from the declaration', () => {
    expect(counterReminderText('gloom')).toBe('(A creature with a gloom counter gets -1/-1.)');
  });
});

/**
 * The ability word landed after this file did, and it names the exact structure
 * the cases above already drive: `gloomAbility` builds the same trigger, so this
 * arm is here to keep the word and the engine from drifting apart. A rank of two
 * rather than one, because a rank the builder multiplies wrongly would be
 * invisible at one.
 */
describe('Gloom N, the ability word', () => {
  const REAPER: Card = creature('Gloom Reaper', 2, 2, {
    cost: { generic: 2, B: 1 },
    subtypes: ['Horror'],
    abilities: [gloomAbility(2)],
  });

  it('marks the creature it damaged with as many counters as its rank', () => {
    const start = scenario({
      battlefield: [
        { card: REAPER, controller: 0 },
        { card: BULWARK, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const reaper = oidOf(start.state, 'Gloom Reaper');
    const bulwark = oidOf(start.state, 'Stone Bulwark');

    const done = playCombat(start, {
      attackers: [reaper],
      blocks: [{ blocker: bulwark, attacker: reaper }],
    });

    expect(conditionsFiredBy(done, reaper)).toEqual(['selfDealsCombatDamageToCreature']);
    expect(gloomOn(done.state, bulwark)).toBe(2);
    expect(statsOf(done.state, bulwark)).toBe('-2/3');
  });
});
