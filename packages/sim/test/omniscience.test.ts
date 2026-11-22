/** Bot-policy proof that a live no-mana option wins its identical paid sibling. */
import { basicLand, parseCard } from '@mtg/dsl';
import { pendingDecision, scenario, type AgentView } from '@mtg/kernel';
import { observeState } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG, decideGreedy } from '@mtg/sim';
import { describe, expect, it } from 'vitest';
import { bestTargetingPerCard } from '../src/policies/cast';

const OMNISCIENCE = parseCard({
  kind: 'enchantment',
  id: 'sim-omniscience',
  name: 'Sim Omniscience',
  rarity: 'mythic',
  set: { code: 'TST', collectorNumber: 63 },
  manaCost: { generic: 7, U: 3 },
  colors: ['U'],
  abilities: [
    {
      kind: 'staticPlayerRule',
      players: 'controller',
      rule: 'castSpellsFromHandWithoutPayingManaCost',
    },
  ],
});

const SPELL = parseCard({
  kind: 'sorcery',
  id: 'sim-omniscience-spell',
  name: 'Sim Omniscience Spell',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 64 },
  manaCost: { generic: 1, U: 1 },
  colors: ['U'],
  effects: [{ kind: 'drawCards', count: 2, target: { kind: 'noTarget' } }],
});

describe('Omniscience cast policy', () => {
  it('chooses the free option when the same spell is also payable normally', () => {
    const state = scenario({
      seed: 'sim/omniscience',
      active: 0,
      step: 'precombatMain',
      battlefield: [
        { card: OMNISCIENCE, controller: 0 },
        { card: basicLand('Island', 'TST', 65), controller: 0 },
        { card: basicLand('Island', 'TST', 66), controller: 0 },
      ],
      hands: [[SPELL], []],
    }).state;
    const decision = pendingDecision(state);
    if (decision?.kind !== 'priority') throw new Error('Omniscience policy probe did not reach priority');
    const view: AgentView = {
      state: observeState(state, 0, 'test/omniscience.test.ts:51'),
      player: 0,
      decision,
    };
    const candidates = bestTargetingPerCard(view, DEFAULT_GREEDY_CONFIG);

    expect(
      decision.options.filter((action) => action.type === 'castSpell').map((action) => action.castingCost),
    ).toEqual([undefined, 'withoutMana']);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.action.castingCost).toBe('withoutMana');
    expect(decideGreedy(view, DEFAULT_GREEDY_CONFIG)).toMatchObject({
      type: 'castSpell',
      castingCost: 'withoutMana',
    });
  });
});
