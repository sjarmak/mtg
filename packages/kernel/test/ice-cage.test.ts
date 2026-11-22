/** Ice Cage follows one live attachment for activation locks and target triggers. */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { Action, GameEvent, GameState, ObjectId, ReduceResult, Trace } from '@mtg/kernel';
import {
  beginTrace,
  collectTriggers,
  copySpellOnStack,
  eligibleAttackers,
  eligibleBlockers,
  eventsOfType,
  legalActions,
  moveObject,
  putTriggersOnStack,
  reduce,
  resolveTop,
  scenario,
  settle,
  validateAction,
} from '@mtg/kernel';
import { attachAuraTo } from '../src/attach';
import { changeSpellTargetsOnStack } from '../src/stack-spell-targets';
import { artifact, creature, FOREST, instant } from './cards';
import { onlyObject, retype, setPt, withContinuous } from './continuous-helpers';
import { apply, handOidOf, oidOf } from './helpers';

const TAP_FOR_GREEN: AbilityInput = {
  kind: 'activated',
  cost: { mana: {}, tapSelf: true },
  effects: [{ kind: 'addMana', produces: ['G'], amount: 1 }],
};

const TAP_OTHER: AbilityInput = {
  kind: 'activated',
  cost: { mana: {}, tapSelf: true },
  effects: [{ kind: 'tapPermanent', target: { kind: 'targetCreature' } }],
};

const HOST = creature('Caged Mystic', 2, 2, {
  abilities: [TAP_FOR_GREEN, TAP_OTHER],
});
const OTHER = creature('Other Creature', 2, 2, { abilities: [TAP_FOR_GREEN, TAP_OTHER] });
const AIM: AbilityInput = {
  kind: 'activated',
  cost: { mana: {}, tapSelf: true },
  effects: [{ kind: 'tapPermanent', target: { kind: 'targetCreature' } }],
};
const LENS = artifact('Aiming Lens', {}, [AIM]);

const ICE_CAGE = parseCard({
  kind: 'enchantment',
  id: 'm11-ice-cage',
  name: 'Ice Cage',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 57 },
  manaCost: { generic: 1, U: 1 },
  colors: ['U'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [{ kind: 'cantAttack' }, { kind: 'cantBlock' }, { kind: 'cantActivateAbilities' }],
  },
  abilities: [
    {
      kind: 'triggered',
      condition: 'enchantedCreatureBecomesTarget',
      effects: [{ kind: 'destroyPermanent', target: { kind: 'selfPermanent' } }],
    },
  ],
});

function attachedBoard(): {
  readonly state: GameState;
  readonly aura: ObjectId;
  readonly host: ObjectId;
  readonly other: ObjectId;
} {
  const start = scenario({
    battlefield: [
      { card: HOST, controller: 0, summoningSick: false },
      { card: OTHER, controller: 0, summoningSick: false },
      { card: LENS, controller: 0 },
    ],
    hands: [[ICE_CAGE], []],
  }).state;
  const aura = handOidOf(start, 0, 'Ice Cage');
  const host = oidOf(start, 'Caged Mystic');
  const other = oidOf(start, 'Other Creature');
  const entered = moveObject(beginTrace(start), aura, 'battlefield', { auraHost: host });
  return { state: entered.state, aura, host, other };
}

function triggersFor(state: GameState, event: GameEvent) {
  const trace: Trace = { state, events: [event], eventStates: [state] };
  return collectTriggers(trace, 0);
}

function targetingSpell(name = 'Chipping Ray'): Card {
  return instant(name, [{ kind: 'tapPermanent', target: { kind: 'targetCreature' } }], {});
}

function castAt(state: GameState, spell: Card, target: ObjectId): ReduceResult {
  const targetName = state.objects[target]?.card.name;
  if (targetName === undefined) throw new Error(`missing target ${target}`);
  const withSpell = scenario({
    battlefield: state.battlefield.map((oid) => {
      const object = state.objects[oid];
      if (object === undefined) throw new Error(`missing ${oid}`);
      return {
        card: object.card,
        controller: object.controller,
        summoningSick: object.summoningSick,
        tapped: object.tapped,
      };
    }),
    hands: [[spell, ICE_CAGE], []],
  }).state;
  const host = oidOf(withSpell, 'Caged Mystic');
  const aura = handOidOf(withSpell, 0, 'Ice Cage');
  const attached = moveObject(beginTrace(withSpell), aura, 'battlefield', { auraHost: host }).state;
  return apply(
    { state: attached, events: [] },
    {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(attached, 0, spell.name),
      targets: [
        {
          kind: 'permanent',
          oid: oidOf(attached, targetName),
        },
      ],
    },
  );
}

function hostActions(state: GameState, host: ObjectId): readonly Action[] {
  return legalActions(state).filter(
    (action) =>
      (action.type === 'activateAbility' || action.type === 'activateManaAbility') && action.oid === host,
  );
}

function stackOidOf(state: GameState, name: string): ObjectId {
  const entry = state.stack.find((candidate) => state.objects[candidate.oid]?.card.name === name);
  if (entry === undefined) throw new Error(`no spell named ${name} on the stack`);
  return entry.oid;
}

describe('Ice Cage in the kernel', () => {
  it('locks combat, ordinary activations, and mana activations only on its current host', () => {
    const { state, aura, host, other } = attachedBoard();
    expect(eligibleAttackers(state)).not.toContain(host);
    expect(eligibleBlockers(state)).not.toContain(host);
    expect(hostActions(state, host)).toEqual([]);
    expect(validateAction(state, { type: 'activateManaAbility', player: 0, oid: host, color: 'G' })).toMatch(
      /can't be activated/i,
    );
    expect(
      validateAction(state, {
        type: 'activateAbility',
        player: 0,
        oid: host,
        abilityIndex: 1,
        targets: [{ kind: 'permanent', oid: other }],
        sacrifices: [],
      }),
    ).toMatch(/can't be activated/i);
    expect(hostActions(state, other).length).toBeGreaterThan(0);

    const moved = attachAuraTo(beginTrace(state), aura, other).state;
    expect(hostActions(moved, host).length).toBeGreaterThan(0);
    expect(hostActions(moved, other)).toEqual([]);
  });

  it("locks an animated land's intrinsic mana ability", () => {
    const start = scenario({
      battlefield: [{ card: FOREST, controller: 0 }],
      hands: [[ICE_CAGE], []],
    }).state;
    const land = oidOf(start, 'Forest');
    const animated = withContinuous(start, [
      retype(onlyObject(land), { addTypes: ['creature'] }),
      setPt(onlyObject(land), 1, 1),
    ]);
    const aura = handOidOf(animated, 0, 'Ice Cage');
    const attached = moveObject(beginTrace(animated), aura, 'battlefield', { auraHost: land }).state;
    expect(hostActions(attached, land)).toEqual([]);
    expect(
      validateAction(attached, { type: 'activateManaAbility', player: 0, oid: land, color: 'G' }),
    ).toMatch(/can't be activated/i);
  });

  it('fires once when one spell names the attached host in repeated slots', () => {
    const { state, aura, host } = attachedBoard();
    const fired = triggersFor(state, {
      type: 'spellCast',
      player: 0,
      oid: 'o999',
      targets: [
        { kind: 'permanent', oid: host },
        { kind: 'permanent', oid: host },
      ],
      chosenX: null,
    });
    expect(fired.map(({ sourceOid, index }) => [sourceOid, index])).toEqual([[aura, 0]]);
  });

  it('ignores unrelated targets and a detached or blinked former host', () => {
    const { state, aura, host, other } = attachedBoard();
    expect(
      triggersFor(state, {
        type: 'spellCast',
        player: 1,
        oid: 'o999',
        targets: [{ kind: 'permanent', oid: other }],
        chosenX: null,
      }),
    ).toEqual([]);

    const departed = moveObject(beginTrace(state), aura, 'exile').state;
    expect(
      triggersFor(departed, {
        type: 'spellCast',
        player: 1,
        oid: 'o999',
        targets: [{ kind: 'permanent', oid: host }],
        chosenX: null,
      }),
    ).toEqual([]);

    const moved = attachAuraTo(beginTrace(state), aura, other).state;
    expect(
      triggersFor(moved, {
        type: 'spellCast',
        player: 1,
        oid: 'o999',
        targets: [{ kind: 'permanent', oid: host }],
        chosenX: null,
      }),
    ).toEqual([]);

    const blinked = moveObject(moveObject(beginTrace(state), host, 'exile'), host, 'battlefield').state;
    expect(blinked.objects[aura]?.attachedTo).toBeUndefined();
    expect(
      validateAction(blinked, {
        type: 'activateAbility',
        player: 0,
        oid: host,
        abilityIndex: 1,
        targets: [{ kind: 'permanent', oid: other }],
        sacrifices: [],
      }),
    ).not.toMatch(/can't be activated/i);
    expect(
      triggersFor(blinked, {
        type: 'spellCast',
        player: 1,
        oid: 'o999',
        targets: [{ kind: 'permanent', oid: host }],
        chosenX: null,
      }),
    ).toEqual([]);
  });

  it('destroys the live Aura when a spell targets its host', () => {
    const { state, host } = attachedBoard();
    const spell = targetingSpell();
    const result = castAt(state, spell, host);
    const aura = oidOf(result.state, 'Ice Cage');
    expect(
      eventsOfType(result.events, 'abilityTriggered').filter((event) => event.source === aura),
    ).toHaveLength(1);

    const destroyed = resolveTop(beginTrace(result.state));
    expect(destroyed.state.objects[aura]?.zone).toBe('graveyard');
    expect(eventsOfType(destroyed.events, 'permanentDestroyed').map((event) => event.oid)).toContain(aura);
  });

  it('fires when an activated ability targets the attached host', () => {
    const { state, aura, host } = attachedBoard();
    const aimed = reduce(state, {
      type: 'activateAbility',
      player: 0,
      oid: oidOf(state, 'Aiming Lens'),
      abilityIndex: 0,
      targets: [{ kind: 'permanent', oid: host }],
      sacrifices: [],
    });
    expect(
      eventsOfType(aimed.events, 'abilityTriggered').filter((event) => event.source === aura),
    ).toHaveLength(1);
  });

  it('fires for a copied spell and a newly retargeted spell', () => {
    const copiedSetup = attachedBoard();
    const copiedCast = castAt(copiedSetup.state, targetingSpell('Copied Ray'), copiedSetup.other);
    const copiedOriginal = stackOidOf(copiedCast.state, 'Copied Ray');
    const copiedHost = oidOf(copiedCast.state, 'Caged Mystic');
    const copiedAura = oidOf(copiedCast.state, 'Ice Cage');
    const copied = settle(
      copySpellOnStack(beginTrace(copiedCast.state), copiedOriginal, {
        controller: 0,
        targets: [{ kind: 'permanent', oid: copiedHost }],
      }),
    );
    expect(
      eventsOfType(copied.events, 'abilityTriggered').filter((event) => event.source === copiedAura),
    ).toHaveLength(1);

    const changedSetup = attachedBoard();
    const changedCast = castAt(changedSetup.state, targetingSpell('Redirected Ray'), changedSetup.other);
    const changedOriginal = stackOidOf(changedCast.state, 'Redirected Ray');
    const changedHost = oidOf(changedCast.state, 'Caged Mystic');
    const changedAura = oidOf(changedCast.state, 'Ice Cage');
    const changed = settle(
      changeSpellTargetsOnStack(beginTrace(changedCast.state), 0, changedOriginal, {
        targets: [{ kind: 'permanent', oid: changedHost }],
      }),
    );
    expect(
      eventsOfType(changed.events, 'abilityTriggered').filter((event) => event.source === changedAura),
    ).toHaveLength(1);
  });

  it('does not let an old trigger destroy an Aura that left and returned', () => {
    const { state, aura, host } = attachedBoard();
    const fired = triggersFor(state, {
      type: 'spellCast',
      player: 1,
      oid: 'o999',
      targets: [{ kind: 'permanent', oid: host }],
      chosenX: null,
    });
    const stacked = putTriggersOnStack(beginTrace(state), fired);
    const returned = moveObject(moveObject(stacked, aura, 'exile'), aura, 'battlefield', {
      auraHost: host,
    });
    expect(resolveTop(returned).state.objects[aura]?.zone).toBe('battlefield');
  });
});
