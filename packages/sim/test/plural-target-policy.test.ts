/** Greedy cast scoring for plural target slots carried outside `Action.targets`. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import type { Action, AgentView, Target } from '@mtg/kernel';
import { pendingDecision, reduce, scenario } from '@mtg/kernel';
import { observeState } from '@mtg/kernel';
import { chooseTriggerTargets, DEFAULT_GREEDY_CONFIG } from '@mtg/sim';
import { bestTargetingPerCard } from '../src/policies/cast';

const FEAST = parseCard({
  kind: 'sorcery',
  id: 'm11-hunters-feast-policy',
  name: "Hunters' Feast",
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 182 },
  manaCost: { generic: 3, G: 1 },
  colors: ['G'],
  effects: [
    {
      kind: 'gainLife',
      amount: 6,
      target: { kind: 'targetPlayer', anyNumber: true },
    },
  ],
} as unknown as CardInput);

const INFERNO = parseCard({
  kind: 'creature',
  id: 'm11-inferno-titan-policy',
  name: 'Inferno Titan',
  rarity: 'mythic',
  set: { code: 'M11', collectorNumber: 146 },
  manaCost: { generic: 4, R: 2 },
  colors: ['R'],
  subtypes: ['Giant'],
  power: 6,
  toughness: 6,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEntersOrAttacks',
      effects: [
        {
          kind: 'dealDamage',
          amount: 3,
          target: { kind: 'anyTarget', count: 3, minimum: 1 },
          division: { kind: 'asYouChoose' },
        },
      ],
    },
  ],
} as unknown as CardInput);

const TARGET = parseCard({
  kind: 'creature',
  id: 'divided-damage-policy-target',
  name: 'Policy Target',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { generic: 1 },
  colors: [],
  power: 1,
  toughness: 1,
});

function action(oid: string, selected: readonly Target[]): Extract<Action, { type: 'castSpell' }> {
  return {
    type: 'castSpell',
    player: 0,
    oid,
    targets: [null],
    multiTargets: { 0: selected },
  };
}

describe('plural-target cast policy', () => {
  it("selects Hunters' Feast for its controller rather than retaining the first empty subset", () => {
    const state = scenario({ hands: [[FEAST], []] }).state;
    const oid = state.players[0].hand[0];
    if (oid === undefined) throw new Error("Hunters' Feast was not placed in hand");
    const options = [
      action(oid, []),
      action(oid, [{ kind: 'player', player: 0 }]),
      action(oid, [{ kind: 'player', player: 1 }]),
      action(oid, [
        { kind: 'player', player: 0 },
        { kind: 'player', player: 1 },
      ]),
    ];
    const view: AgentView = {
      state: observeState(state, 0, 'test/plural-target-policy.test.ts:90'),
      player: 0,
      decision: { kind: 'priority', player: 0, options, complete: true },
    };

    const [candidate] = bestTargetingPerCard(view, DEFAULT_GREEDY_CONFIG);
    if (candidate?.action.type !== 'castSpell') throw new Error('fixture did not produce a complete cast');
    expect(candidate.action.multiTargets?.[0]).toEqual([{ kind: 'player', player: 0 }]);
  });

  it('scores each Inferno Titan allocation against the target that receives it', () => {
    const start = scenario({
      battlefield: [
        { card: INFERNO, controller: 0, summoningSick: false },
        { card: TARGET, controller: 1 },
      ],
      life: [20, 2],
      active: 0,
      step: 'declareAttackers',
    });
    const titan = start.state.battlefield.find((oid) => start.state.objects[oid]?.card.id === INFERNO.id);
    const target = start.state.battlefield.find((oid) => start.state.objects[oid]?.card.id === TARGET.id);
    if (titan === undefined || target === undefined) throw new Error('policy board is incomplete');
    const attacked = reduce(start.state, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: titan, defender: 1 }],
    });
    const pending = pendingDecision(attacked.state);
    if (pending?.kind !== 'triggerTargets') throw new Error('Inferno Titan did not ask for targets');
    const base = {
      type: 'chooseTriggerTargets',
      player: 0,
      oid: pending.oid,
      targets: [null],
      multiTargets: {
        0: [
          { kind: 'player' as const, player: 1 as const },
          { kind: 'permanent' as const, oid: target },
        ],
      },
    } as const;
    const options: readonly Extract<Action, { type: 'chooseTriggerTargets' }>[] = [
      { ...base, damageAllocations: { 0: [1, 2] } },
      { ...base, damageAllocations: { 0: [2, 1] } },
    ];
    const decision = { ...pending, options };
    const view: AgentView = {
      state: observeState(attacked.state, 0, 'test/plural-target-policy.test.ts:137'),
      player: 0,
      decision,
    };

    expect(chooseTriggerTargets(view, DEFAULT_GREEDY_CONFIG, decision).damageAllocations).toEqual({
      0: [2, 1],
    });
  });
});
