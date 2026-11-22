/**
 * CR 603.2c through Phantom Beast: a permanent becomes a target when a spell
 * or ability's target choice first names it.
 *
 * The kernel records four ways that can happen: a cast spell, a copied spell,
 * an activated ability, and a triggered ability after CR 603.3d chooses its
 * targets. All four feed one source-bound trigger condition. Repeating the same
 * permanent in two slots on one object is still one triggering event.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card } from '@mtg/dsl';
import {
  beginTrace,
  copySpellOnStack,
  eventsOfType,
  moveObject,
  pendingDecision,
  scenario,
  settle,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { changeSpellTargetsOnStack } from '../src/stack-spell-targets';
import { artifact, creature, instant } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const SACRIFICE_WHEN_TARGETED: AbilityInput = {
  kind: 'triggered',
  condition: 'selfBecomesTarget',
  effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfCreature' } }],
};

const AIM: AbilityInput = {
  kind: 'activated',
  cost: { mana: {}, tapSelf: true },
  effects: [{ kind: 'tapPermanent', target: { kind: 'targetCreature' } }],
};

function phantomBeast(): Card {
  return creature('Phantom Beast', 4, 5, {
    cost: { generic: 3, U: 1 },
    subtypes: ['Illusion', 'Beast'],
    abilities: [SACRIFICE_WHEN_TARGETED],
  });
}

function firedBy(result: ReduceResult, source: ObjectId): number {
  return eventsOfType(result.events, 'abilityTriggered').filter(
    (event) => event.source === source && event.condition === 'selfBecomesTarget',
  ).length;
}

function passUntilNonPriority(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 30; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    if (current.state.stack.length === 0) return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('the target-trigger stack did not settle');
}

function castAtBeast(spell: Card): {
  readonly cast: ReduceResult;
  readonly beast: ObjectId;
  readonly spell: ObjectId;
} {
  const start = scenario({
    battlefield: [{ card: phantomBeast(), controller: 1 }],
    hands: [[spell], []],
  });
  const beast = oidOf(start.state, 'Phantom Beast');
  const spellOid = handOidOf(start.state, 0, spell.name);
  const cast = apply(start, {
    type: 'castSpell',
    player: 0,
    oid: spellOid,
    targets: [{ kind: 'permanent', oid: beast }],
  });
  return { cast, beast, spell: spellOid };
}

describe('selfBecomesTarget', () => {
  it('fires above a spell and sacrifices Phantom Beast before that spell resolves', () => {
    const spell = instant(
      'Pinning Glance',
      [{ kind: 'tapPermanent', target: { kind: 'targetCreature' } }],
      {},
    );
    const { cast, beast } = castAtBeast(spell);
    expect(firedBy(cast, beast)).toBe(1);

    const done = passUntilNonPriority(cast);
    expect(done.state.objects[beast]?.zone).toBe('graveyard');
    expect(eventsOfType(done.events, 'permanentSacrificed').map((event) => event.oid)).toContain(beast);
    expect(eventsOfType(done.events, 'spellFizzled')).toHaveLength(1);
  });

  it('fires once when one spell names the same permanent in two target slots', () => {
    const spell = instant(
      'Double Glance',
      [
        { kind: 'tapPermanent', target: { kind: 'targetCreature' } },
        {
          kind: 'pumpUntilEndOfTurn',
          power: 1,
          toughness: 1,
          target: { kind: 'targetCreature' },
        },
      ],
      {},
    );
    const start = scenario({
      battlefield: [{ card: phantomBeast(), controller: 1 }],
      hands: [[spell], []],
    });
    const beast = oidOf(start.state, 'Phantom Beast');
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, spell.name),
      targets: [
        { kind: 'permanent', oid: beast },
        { kind: 'permanent', oid: beast },
      ],
    });
    expect(firedBy(cast, beast)).toBe(1);
  });

  it('does not fire when a spell targets a player instead', () => {
    const spell = instant(
      'Pointed Loss',
      [{ kind: 'loseLife', amount: 1, target: { kind: 'targetPlayer' } }],
      {},
    );
    const start = scenario({
      battlefield: [{ card: phantomBeast(), controller: 1 }],
      hands: [[spell], []],
    });
    const beast = oidOf(start.state, 'Phantom Beast');
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, spell.name),
      targets: [{ kind: 'player', player: 1 }],
    });
    expect(firedBy(cast, beast)).toBe(0);
  });

  it('fires when a copied spell keeps Phantom Beast as its target', () => {
    const spell = instant(
      'Copied Glance',
      [{ kind: 'tapPermanent', target: { kind: 'targetCreature' } }],
      {},
    );
    const { cast, beast, spell: original } = castAtBeast(spell);
    const copied = settle(copySpellOnStack(beginTrace(cast.state), original));
    const result = { state: copied.state, events: copied.events };
    expect(firedBy(result, beast)).toBe(1);
  });

  it('reads counted target lists and preserves them on a copied spell', () => {
    const spell = instant(
      'Counted Glance',
      [{ kind: 'tapPermanent', target: { kind: 'targetCreature', count: 3 } }],
      {},
    );
    const start = scenario({
      battlefield: [{ card: phantomBeast(), controller: 1 }],
      hands: [[spell], []],
    });
    const beast = oidOf(start.state, 'Phantom Beast');
    const original = handOidOf(start.state, 0, spell.name);
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: original,
      targets: [null],
      multiTargets: { 0: [{ kind: 'permanent', oid: beast }] },
    });
    expect(firedBy(cast, beast)).toBe(1);

    const copied = settle(copySpellOnStack(beginTrace(cast.state), original));
    const result = { state: copied.state, events: copied.events };
    expect(firedBy(result, beast)).toBe(1);
  });

  it('does not retarget a new incarnation on copy, but does when targets are chosen again', () => {
    const spell = instant(
      'Incarnation Glance',
      [{ kind: 'tapPermanent', target: { kind: 'targetCreature' } }],
      {},
    );
    const { cast, beast, spell: original } = castAtBeast(spell);
    const left = moveObject(beginTrace(cast.state), beast, 'hand');
    const returned = moveObject(left, beast, 'battlefield', { controller: 1 });

    const copied = settle(copySpellOnStack(beginTrace(returned.state), original));
    expect(firedBy({ state: copied.state, events: copied.events }, beast)).toBe(0);

    const changed = settle(
      changeSpellTargetsOnStack(beginTrace(returned.state), 0, original, {
        targets: [{ kind: 'permanent', oid: beast }],
      }),
    );
    expect(eventsOfType(changed.events, 'spellTargetsChanged')).toHaveLength(1);
    expect(firedBy({ state: changed.state, events: changed.events }, beast)).toBe(1);
  });

  it('keeps plural copy and retarget events bound to the chosen incarnation', () => {
    const spell = instant(
      'Counted Incarnation Glance',
      [{ kind: 'tapPermanent', target: { kind: 'targetCreature', count: 3 } }],
      {},
    );
    const start = scenario({
      battlefield: [{ card: phantomBeast(), controller: 1 }],
      hands: [[spell], []],
    });
    const beast = oidOf(start.state, 'Phantom Beast');
    const original = handOidOf(start.state, 0, spell.name);
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: original,
      targets: [null],
      multiTargets: { 0: [{ kind: 'permanent', oid: beast }] },
    });
    const left = moveObject(beginTrace(cast.state), beast, 'hand');
    const returned = moveObject(left, beast, 'battlefield', { controller: 1 });

    const copied = settle(copySpellOnStack(beginTrace(returned.state), original));
    expect(firedBy({ state: copied.state, events: copied.events }, beast)).toBe(0);

    const changed = settle(
      changeSpellTargetsOnStack(beginTrace(returned.state), 0, original, {
        targets: [null],
        multiTargets: { 0: [{ kind: 'permanent', oid: beast }] },
      }),
    );
    expect(eventsOfType(changed.events, 'spellTargetsChanged')).toHaveLength(1);
    expect(firedBy({ state: changed.state, events: changed.events }, beast)).toBe(1);
  });

  it('fires when an activated ability targets Phantom Beast', () => {
    const start = scenario({
      battlefield: [
        { card: artifact('Aiming Lens', {}, [AIM]), controller: 0 },
        { card: phantomBeast(), controller: 1 },
      ],
    });
    const beast = oidOf(start.state, 'Phantom Beast');
    const aimed = apply(start, {
      type: 'activateAbility',
      player: 0,
      oid: oidOf(start.state, 'Aiming Lens'),
      abilityIndex: 0,
      targets: [{ kind: 'permanent', oid: beast }],
      sacrifices: [],
    });
    expect(firedBy(aimed, beast)).toBe(1);
  });

  it('fires when a triggered ability chooses Phantom Beast as its target', () => {
    const caller = creature('Target Caller', 1, 1, {
      cost: {},
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [{ kind: 'tapPermanent', target: { kind: 'targetCreature' } }],
        },
      ],
    });
    const start = scenario({
      battlefield: [{ card: phantomBeast(), controller: 1 }],
      hands: [[caller], []],
    });
    const beast = oidOf(start.state, 'Phantom Beast');
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, caller.name),
      targets: [],
    });
    const choosing = passUntilNonPriority(cast);
    const decision = pendingDecision(choosing.state);
    if (decision?.kind !== 'triggerTargets') throw new Error('the entering trigger did not ask for a target');
    const trigger = choosing.state.stack.find((entry) => entry.ability !== null)?.oid;
    if (trigger === undefined) throw new Error('the entering trigger is not on the stack');
    const aimed = apply(choosing, {
      type: 'chooseTriggerTargets',
      player: decision.player,
      oid: trigger,
      targets: [{ kind: 'permanent', oid: beast }],
    });
    expect(firedBy(aimed, beast)).toBe(1);
  });
});
