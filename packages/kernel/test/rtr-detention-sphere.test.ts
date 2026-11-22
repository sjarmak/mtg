/** Native target-cohort and incarnation probes for RTR #155. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import {
  beginTrace,
  moveObject,
  pendingDecision,
  scenario,
  settle,
  type ObjectId,
  type ReduceResult,
  type Trace,
} from '@mtg/kernel';
import { artifact, ISLAND, PLAINS } from './cards';
import { apply, handOidOf } from './helpers';

const SPHERE = parseCard({
  kind: 'enchantment',
  id: 'rtr-155-detention-sphere-kernel',
  name: 'Detention Sphere',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 155 },
  manaCost: { generic: 1, W: 1, U: 1 },
  colors: ['W', 'U'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      printedSourceReference: 'thisEnchantment',
      optional: true,
      effects: [
        {
          kind: 'exileTarget',
          target: { kind: 'targetPermanent', filter: { excludeCardTypes: ['land'] } },
          linkToSource: true,
          sameNameCohort: { excludedName: 'Detention Sphere' },
        },
      ],
    },
    {
      kind: 'triggered',
      condition: 'selfLeavesBattlefield',
      printedSourceReference: 'thisEnchantment',
      effects: [{ kind: 'moveSourceLinkedExile', destination: 'battlefieldUnderOwner', plural: true }],
    },
  ],
});

const SHARED = artifact('Shared Relic');
const OTHER = artifact('Other Relic');

function appendTrace(current: ReduceResult, trace: Trace): ReduceResult {
  return { state: trace.state, events: [...current.events, ...trace.events] };
}

function passUntil(start: ReduceResult, kind: 'triggerTargets' | 'optionalTrigger' | 'quiet'): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 30; guard += 1) {
    const decision = pendingDecision(current.state);
    if ((kind === 'quiet' && current.state.stack.length === 0) || decision?.kind === kind) return current;
    if (decision?.kind !== 'priority') throw new Error(`unexpected ${decision?.kind ?? 'quiet'} decision`);
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error(`Detention Sphere did not reach ${kind}`);
}

function opened(): ReduceResult {
  return scenario({
    battlefield: [
      { card: PLAINS, controller: 0 },
      { card: ISLAND, controller: 0 },
      { card: PLAINS, controller: 0 },
      { card: SHARED, controller: 0 },
      { card: SHARED, controller: 1 },
      { card: OTHER, controller: 1 },
      { card: SPHERE, controller: 1 },
    ],
    hands: [[SPHERE], []],
    active: 0,
  });
}

function castToTargetChoice(): ReduceResult {
  const start = opened();
  const cast = apply(start, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, SPHERE.name),
    targets: [],
  });
  return passUntil(cast, 'triggerTargets');
}

function sharedOids(state: ReduceResult['state']): readonly ObjectId[] {
  return state.battlefield.filter((oid) => state.objects[oid]?.card.name === SHARED.name);
}

function aim(from: ReduceResult, target: ObjectId): ReduceResult {
  const decision = pendingDecision(from.state);
  if (decision?.kind !== 'triggerTargets') throw new Error('Sphere target was not requested');
  return apply(from, {
    type: 'chooseTriggerTargets',
    player: decision.player,
    oid: decision.oid,
    targets: [{ kind: 'permanent', oid: target }],
  });
}

function answer(from: ReduceResult, accept: boolean): ReduceResult {
  const offered = passUntil(from, 'optionalTrigger');
  const decision = pendingDecision(offered.state);
  if (decision?.kind !== 'optionalTrigger') throw new Error('Sphere optional was not offered');
  return passUntil(
    apply(offered, {
      type: 'answerOptionalTrigger',
      player: decision.player,
      oid: decision.oid,
      accept,
    }),
    'quiet',
  );
}

describe('Detention Sphere', () => {
  it('offers nonland permanents except every permanent named Detention Sphere', () => {
    const choice = castToTargetChoice();
    const decision = pendingDecision(choice.state);
    if (decision?.kind !== 'triggerTargets') throw new Error('Sphere target was not requested');
    const names = decision.options.flatMap((option) =>
      option.type === 'chooseTriggerTargets' && option.targets[0]?.kind === 'permanent'
        ? [choice.state.objects[option.targets[0].oid]?.card.name]
        : [],
    );
    expect(names).toEqual(['Shared Relic', 'Shared Relic', 'Other Relic']);
  });

  it('exiles the target and every same-name permanent, then returns surviving cards to their owners', () => {
    const choice = castToTargetChoice();
    const cohort = sharedOids(choice.state);
    const source = choice.state.battlefield.find(
      (oid) =>
        choice.state.objects[oid]?.card.name === SPHERE.name && choice.state.objects[oid]?.controller === 0,
    );
    if (source === undefined) throw new Error('cast Sphere missing');
    const exiled = answer(aim(choice, cohort[0]!), true);
    expect(cohort.map((oid) => exiled.state.objects[oid]?.zone)).toEqual(['exile', 'exile']);
    const left = appendTrace(exiled, settle(moveObject(beginTrace(exiled.state), source, 'graveyard')));
    const returned = passUntil(left, 'quiet');
    expect(cohort.map((oid) => returned.state.objects[oid]?.zone)).toEqual(['battlefield', 'battlefield']);
    expect(cohort.map((oid) => returned.state.objects[oid]?.controller)).toEqual([0, 1]);
  });

  it('chooses a target before decline and exiles nothing when declined', () => {
    const choice = castToTargetChoice();
    const cohort = sharedOids(choice.state);
    const done = answer(aim(choice, cohort[0]!), false);
    expect(cohort.map((oid) => done.state.objects[oid]?.zone)).toEqual(['battlefield', 'battlefield']);
  });

  it('fizzles the whole cohort when the chosen target leaves before resolution', () => {
    const choice = castToTargetChoice();
    const cohort = sharedOids(choice.state);
    const aimed = aim(choice, cohort[0]!);
    const gone = appendTrace(aimed, settle(moveObject(beginTrace(aimed.state), cohort[0]!, 'graveyard')));
    const done = passUntil(gone, 'quiet');
    expect(done.state.objects[cohort[1]!]?.zone).toBe('battlefield');
  });
});
