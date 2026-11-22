/** Street Sweeper targets one land, then queries its live Aura attachments. */
import { parseCard, type Card } from '@mtg/dsl';
import {
  beginTrace,
  eventsOfType,
  moveObject,
  pendingDecision,
  reduce,
  scenario,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { ISLAND, PLAINS } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const STREET_SWEEPER = parseCard({
  kind: 'creature',
  id: 'rtr-234-street-sweeper-kernel',
  name: 'Street Sweeper',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 234 },
  manaCost: { generic: 6 },
  artifact: true,
  subtypes: ['Construct'],
  power: 4,
  toughness: 6,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfAttacks',
      printedSourceReference: 'thisCreature',
      effects: [
        {
          kind: 'destroyAttachedPermanents',
          target: { kind: 'targetPermanent', filter: { cardTypes: ['land'] } },
          filter: { subtypes: ['Aura'] },
        },
      ],
    },
  ],
});

function aura(name: string, collectorNumber: number): Card {
  return parseCard({
    kind: 'enchantment',
    id: `rtr-street-sweeper-${collectorNumber}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber },
    manaCost: { W: 1 },
    colors: ['W'],
    subtypes: ['Aura'],
    aura: {
      enchant: 'land',
      modifications: [
        {
          kind: 'grantActivatedAbility',
          ability: {
            kind: 'activated',
            cost: { mana: {}, tapSelf: true },
            effects: [
              {
                kind: 'preventNextDamageToYouAndRetaliate',
                amount: 1,
                target: { kind: 'noTarget' },
              },
            ],
          },
        },
      ],
    },
  });
}

const TARGET_AURA = aura('Street Sweeper Target Aura', 901);
const OTHER_AURA = aura('Street Sweeper Other Aura', 902);
const NON_AURA = parseCard({
  kind: 'artifact',
  id: 'rtr-street-sweeper-non-aura',
  name: 'Street Sweeper Non-Aura Attachment',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 903 },
  manaCost: { generic: 1 },
});

function attach(state: GameState, attachment: ObjectId, host: ObjectId): GameState {
  const object = state.objects[attachment];
  if (object === undefined) throw new Error(`missing attachment ${attachment}`);
  return {
    ...state,
    objects: { ...state.objects, [attachment]: { ...object, attachedTo: host } },
  };
}

function position() {
  const opened = scenario({
    active: 0,
    step: 'declareAttackers',
    battlefield: [
      { card: STREET_SWEEPER, controller: 0, summoningSick: false },
      { card: PLAINS, controller: 1 },
      { card: ISLAND, controller: 1 },
      { card: NON_AURA, controller: 1 },
    ],
    hands: [[], [TARGET_AURA, OTHER_AURA]],
  });
  const sweeper = oidOf(opened.state, STREET_SWEEPER.name);
  const plains = oidOf(opened.state, PLAINS.name);
  const island = oidOf(opened.state, ISLAND.name);
  const targetAura = handOidOf(opened.state, 1, TARGET_AURA.name);
  const otherAura = handOidOf(opened.state, 1, OTHER_AURA.name);
  const nonAura = oidOf(opened.state, NON_AURA.name);
  const firstEntered = moveObject(beginTrace(opened.state), targetAura, 'battlefield', {
    controller: 1,
    auraHost: plains,
  });
  const secondEntered = moveObject(firstEntered, otherAura, 'battlefield', {
    controller: 1,
    auraHost: island,
  });
  const state = attach(secondEntered.state, nonAura, plains);
  return { state, sweeper, plains, island, targetAura, otherAura, nonAura };
}

function aimAtLand() {
  const subject = position();
  const declared = reduce(subject.state, {
    type: 'declareAttackers',
    player: 0,
    attackers: [{ oid: subject.sweeper, defender: 1 }],
  });
  const decision = pendingDecision(declared.state);
  if (decision?.kind !== 'triggerTargets') throw new Error('Street Sweeper did not ask for a target');
  const offered = decision.options.flatMap((option) =>
    option.type === 'chooseTriggerTargets'
      ? option.targets.flatMap((target) => (target?.kind === 'permanent' ? [target.oid] : []))
      : [],
  );
  const choice = decision.options.find(
    (option) =>
      option.type === 'chooseTriggerTargets' &&
      option.targets[0]?.kind === 'permanent' &&
      option.targets[0].oid === subject.plains,
  );
  if (choice?.type !== 'chooseTriggerTargets') throw new Error('Plains was not offered as a target');
  const entry = declared.state.stack.find((candidate) => candidate.ability !== null)?.oid;
  if (entry === undefined) throw new Error('Street Sweeper trigger did not reach the stack');
  return { ...subject, offered, aimed: apply(declared, { ...choice, oid: entry }) };
}

function settle(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 20 && current.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error(`resolution paused at ${decision?.kind ?? 'nothing'}`);
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  if (current.state.stack.length > 0) throw new Error('Street Sweeper trigger did not settle');
  return current;
}

describe("Street Sweeper's attack trigger", () => {
  it('offers only lands and destroys only Auras attached to the chosen land', () => {
    const subject = aimAtLand();
    expect([...new Set(subject.offered)].sort()).toEqual([subject.island, subject.plains].sort());

    const done = settle(subject.aimed);
    expect(done.state.objects[subject.targetAura]?.zone).toBe('graveyard');
    expect(done.state.objects[subject.otherAura]?.zone).toBe('battlefield');
    expect(done.state.objects[subject.nonAura]?.zone).toBe('battlefield');
    expect(eventsOfType(done.events, 'permanentDestroyed').map((event) => event.oid)).toEqual([
      subject.targetAura,
    ]);
  });

  it('fizzles after the chosen land leaves instead of sweeping another attachment group', () => {
    const subject = aimAtLand();
    const removed = moveObject(beginTrace(subject.aimed.state), subject.plains, 'graveyard');
    const done = settle(removed);

    expect(done.state.objects[subject.otherAura]?.zone).toBe('battlefield');
    expect(eventsOfType(done.events, 'permanentDestroyed')).toEqual([]);
  });
});
