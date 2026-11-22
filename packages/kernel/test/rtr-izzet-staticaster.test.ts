/** Izzet Staticaster's simultaneous target-relative same-name damage. */
import { parseCard } from '@mtg/dsl';
import {
  eventsOfType,
  legalActions,
  pendingDecision,
  scenario,
  type Action,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature } from './cards';
import { apply, oidOf } from './helpers';

const STATICASTER = parseCard({
  kind: 'creature',
  id: 'rtr-173-izzet-staticaster-kernel',
  name: 'Izzet Staticaster',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 173 },
  manaCost: { generic: 1, U: 1, R: 1 },
  colors: ['U', 'R'],
  subtypes: ['Human', 'Wizard'],
  power: 0,
  toughness: 3,
  keywords: ['haste'],
  keywordAbilities: [{ kind: 'flash' }],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      printedSourceReference: 'thisCreature',
      effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'targetCreature' } }],
      damageTargetAndCreaturesWithSameName: true,
    },
  ],
});

const TWIN = creature('Staticaster Twin', 2, 2);
const OTHER = creature('Staticaster Other', 2, 2);

function activation(state: GameState, target: ObjectId): Extract<Action, { type: 'activateAbility' }> {
  const found = legalActions(state).find(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' &&
      action.oid === oidOf(state, STATICASTER.name) &&
      action.targets[0]?.kind === 'permanent' &&
      action.targets[0].oid === target,
  );
  if (found === undefined) throw new Error('Staticaster activation was not offered');
  return found;
}

function resolve(from: ReduceResult): ReduceResult {
  let current = from;
  for (let count = 0; count < 2; count += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error('priority was not offered');
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  return current;
}

describe('Izzet Staticaster in the kernel', () => {
  it('damages the target and every other creature with its current name simultaneously', () => {
    const start = scenario({
      active: 0,
      battlefield: [
        { card: STATICASTER, controller: 0 },
        { card: TWIN, controller: 0 },
        { card: TWIN, controller: 1 },
        { card: OTHER, controller: 1 },
      ],
    });
    const twins = start.state.battlefield.filter((oid) => start.state.objects[oid]?.card.name === TWIN.name);
    const resolved = resolve(apply(start, activation(start.state, twins[0]!)));
    const damaged = eventsOfType(resolved.events, 'damageDealt').flatMap((event) =>
      event.target.kind === 'permanent' ? [event.target.oid] : [],
    );
    expect(damaged).toEqual(expect.arrayContaining(twins));
    expect(damaged).toHaveLength(2);
    expect(resolved.state.objects[oidOf(resolved.state, OTHER.name)]?.damage).toBe(0);
  });

  it('fizzles the whole activation when its sole target leaves', () => {
    const start = scenario({
      active: 0,
      battlefield: [
        { card: STATICASTER, controller: 0 },
        { card: TWIN, controller: 0 },
        { card: TWIN, controller: 1 },
      ],
    });
    const twins = start.state.battlefield.filter((oid) => start.state.objects[oid]?.card.name === TWIN.name);
    const activated = apply(start, activation(start.state, twins[0]!));
    const state = {
      ...activated.state,
      battlefield: activated.state.battlefield.filter((oid) => oid !== twins[0]),
      objects: {
        ...activated.state.objects,
        [twins[0]!]: { ...activated.state.objects[twins[0]!]!, zone: 'graveyard' as const },
      },
    };
    const resolved = resolve({ ...activated, state });
    expect(eventsOfType(resolved.events, 'damageDealt')).toEqual([]);
    expect(resolved.state.objects[twins[1]!]?.damage).toBe(0);
  });
});
