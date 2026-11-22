import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  hasKeyword,
  legalActions,
  pendingDecision,
  playerOf,
  powerOf,
  scenario,
  toughnessOf,
  type Action,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { onlyObject, retype, withContinuous } from './continuous-helpers';
import { creature, FOREST, PLAINS } from './cards';
import { apply, oidOf, oidsOf } from './helpers';

const GROVE = parseCard({
  kind: 'land',
  id: 'rtr-240-grove-of-the-guardian-kernel',
  name: 'Grove of the Guardian',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 240 },
  producesMana: ['C'],
  abilities: [
    {
      kind: 'activated',
      printedSourceReference: 'thisLand',
      cost: {
        mana: { generic: 3, G: 1, W: 1 },
        printedManaPips: ['G', 'W'],
        tapSelf: true,
        tapMatching: { count: 2, filter: { cardTypes: ['creature'] } },
        sacrificeSelf: true,
      },
      effects: [
        {
          kind: 'createToken',
          count: 1,
          token: {
            name: 'Elemental',
            power: 8,
            toughness: 8,
            colors: ['G', 'W'],
            subtypes: ['Elemental'],
            keywords: ['vigilance'],
          },
        },
      ],
    },
  ],
} satisfies CardInput);

type Activation = Extract<Action, { readonly type: 'activateAbility' }> & {
  readonly taps?: readonly ObjectId[];
};

function activations(state: GameState, source: ObjectId): readonly Activation[] {
  return legalActions(state).filter(
    (action): action is Extract<Action, { readonly type: 'activateAbility' }> =>
      action.type === 'activateAbility' && action.oid === source && action.abilityIndex === 0,
  ) as readonly Activation[];
}

function resolveStack(current: ReduceResult): ReduceResult {
  let result = current;
  for (let guard = 0; result.state.stack.length > 0 && guard < 12; guard += 1) {
    const decision = pendingDecision(result.state);
    if (decision?.kind !== 'priority') throw new Error('Grove of the Guardian test lost priority');
    result = apply(result, { type: 'passPriority', player: decision.player });
  }
  if (result.state.stack.length > 0) throw new Error('Grove of the Guardian stack did not resolve');
  return result;
}

function readyBoard(): { readonly opened: ReduceResult; readonly source: ObjectId } {
  const opened = scenario({
    battlefield: [
      { card: GROVE, controller: 0 },
      { card: FOREST, controller: 0 },
      { card: FOREST, controller: 0 },
      { card: FOREST, controller: 0 },
      { card: FOREST, controller: 0 },
      { card: PLAINS, controller: 0 },
      { card: creature('Sick Grove Helper', 1, 1), controller: 0, summoningSick: true },
      { card: creature('Ready Grove Helper', 2, 2), controller: 0 },
      { card: creature('Tapped Grove Helper', 3, 3), controller: 0, tapped: true },
      { card: creature('Enemy Grove Helper', 4, 4), controller: 1 },
    ],
  });
  return { opened, source: oidOf(opened.state, GROVE.name) };
}

describe('RTR #240 Grove of the Guardian', () => {
  it('pays with two controlled untapped creatures, including a sick one, but never the tapped or opposing bodies', () => {
    const { opened, source } = readyBoard();
    const action = activations(opened.state, source)[0];
    if (action === undefined) throw new Error('Grove of the Guardian activation was not offered');

    expect((action.taps ?? []).map((oid) => opened.state.objects[oid]?.card.name).sort()).toEqual([
      'Ready Grove Helper',
      'Sick Grove Helper',
    ]);
  });

  it('does not offer the tap-self source again when current type effects also make that land a creature', () => {
    const { opened, source } = readyBoard();
    const animated = withContinuous(opened.state, [retype(onlyObject(source), { addTypes: ['creature'] })]);
    const action = activations(animated, source)[0];
    if (action === undefined) throw new Error('animated Grove of the Guardian activation was not offered');

    expect(action.taps).not.toContain(source);
    expect(action.taps).toHaveLength(2);
  });

  it('sacrifices the land and taps the cohort before resolution, then creates the exact token', () => {
    const { opened, source } = readyBoard();
    const action = activations(opened.state, source)[0];
    if (action === undefined) throw new Error('Grove of the Guardian activation was not offered');
    const activated = apply(opened, action);

    expect(activated.state.objects[source]?.zone).toBe('graveyard');
    expect(playerOf(activated.state, 0).graveyard).toContain(source);
    expect(activated.state.stack).toHaveLength(1);
    for (const oid of action.taps ?? []) expect(activated.state.objects[oid]?.tapped).toBe(true);

    const resolved = resolveStack(activated);
    const tokens = oidsOf(resolved.state, 'Elemental');
    expect(tokens).toHaveLength(1);
    const token = tokens[0];
    if (token === undefined) throw new Error('Grove of the Guardian created no Elemental');
    expect(powerOf(resolved.state, token)).toBe(8);
    expect(toughnessOf(resolved.state, token)).toBe(8);
    expect(resolved.state.objects[token]?.card.colors).toEqual(['G', 'W']);
    expect(resolved.state.objects[token]?.card.subtypes).toEqual(['Elemental']);
    expect(hasKeyword(resolved.state, token, 'vigilance')).toBe(true);
  });

  it('offers no activation with an insufficient valid cohort', () => {
    const opened = scenario({
      battlefield: [
        { card: GROVE, controller: 0 },
        ...Array.from({ length: 4 }, () => ({ card: FOREST, controller: 0 as const })),
        { card: PLAINS, controller: 0 },
        { card: creature('Only Grove Helper', 1, 1), controller: 0 },
        { card: creature('Unavailable Grove Helper', 1, 1), controller: 0, tapped: true },
        { card: creature('Opposing Grove Helper', 1, 1), controller: 1 },
      ],
    });
    const source = oidOf(opened.state, GROVE.name);

    expect(activations(opened.state, source)).toEqual([]);
  });
});
