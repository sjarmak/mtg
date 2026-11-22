/** The greedy policy sees both halves of a paid source-sacrifice activation. */
import { parseCard, type CardInput } from '@mtg/dsl';
import { pendingDecision, scenario, type AgentView } from '@mtg/kernel';
import { observeState } from '@mtg/kernel';
import { chooseActivation, DEFAULT_GREEDY_CONFIG } from '@mtg/sim';
import { describe, expect, it } from 'vitest';
import { MOUNTAIN, SWAMP } from './cards';

const NAME = 'Hellhole Flailer';
const SOURCE = parseCard({
  kind: 'creature',
  id: 'rtr-167-hellhole-flailer-policy',
  name: NAME,
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 167 },
  manaCost: { generic: 1, B: 1, R: 1 },
  colors: ['B', 'R'],
  subtypes: ['Ogre', 'Warrior'],
  power: 3,
  toughness: 2,
  keywordAbilities: [{ kind: 'unleash' }],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 2, B: 1, R: 1 }, sacrificeSelf: true },
      effects: [
        {
          kind: 'dealDamage',
          amount: { kind: 'paidSacrificePower' },
          target: { kind: 'targetPlayerOrPlaneswalker' },
        },
      ],
    },
  ],
} as CardInput);

function view(opponentLife: number): AgentView {
  const state = scenario({
    life: [20, opponentLife],
    battlefield: [
      { card: SOURCE, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: SWAMP, controller: 0 },
      { card: SWAMP, controller: 0 },
    ],
  }).state;
  const decision = pendingDecision(state);
  if (decision?.kind !== 'priority') throw new Error('missing priority decision');
  return {
    state: observeState(state, 0, 'test/rtr-hellhole-flailer-policy.test.ts:49'),
    player: 0,
    decision,
  };
}

describe('source-sacrifice activation policy', () => {
  it('uses the retained power to take a lethal player target', () => {
    const action = chooseActivation(view(3), DEFAULT_GREEDY_CONFIG);
    expect(action?.targets).toEqual([{ kind: 'player', player: 1 }]);
  });

  it('prices the source as the paid permanent instead of treating the activation as free', () => {
    expect(chooseActivation(view(20), DEFAULT_GREEDY_CONFIG)).toBeNull();
  });
});
