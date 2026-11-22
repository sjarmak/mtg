/** Cast-policy coverage for structured Overload profiles. */
import { basicLand, parseCard } from '@mtg/dsl';
import { legalActions, pendingDecision, reduce, scenario, type AgentView, type GameState } from '@mtg/kernel';
import { observeState } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG } from '@mtg/sim';
import { describe, expect, it } from 'vitest';
import { bestTargetingPerCard } from '../src/policies/cast';
import { scoreTargets } from '../src/policies/target';

const CYCLONIC_RIFT = parseCard({
  kind: 'instant',
  id: 'rtr-35-cyclonic-rift',
  name: 'Cyclonic Rift',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 35 },
  colors: ['U'],
  manaCost: { generic: 1, U: 1 },
  effects: [
    {
      kind: 'returnToHand',
      target: { kind: 'targetNonlandPermanentYouDontControl' },
    },
  ],
  overload: {
    cost: { generic: 6, U: 1 },
    effects: [
      {
        kind: 'returnToHand',
        scope: 'permanentsYouDontControl',
        scopeFilter: { excludeCardTypes: ['land'] },
        target: { kind: 'noTarget' },
      },
    ],
  },
});

const CREATURE = parseCard({
  kind: 'creature',
  id: 'sim-rtr-creature',
  name: 'Sim Overload Target',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 270 },
  colors: ['G'],
  manaCost: { generic: 2, G: 1 },
  power: 3,
  toughness: 3,
  effects: [],
});

const COUNTERFLUX = parseCard({
  kind: 'instant',
  id: 'rtr-153-counterflux',
  name: 'Counterflux',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 153 },
  colors: ['U', 'R'],
  manaCost: { U: 2, R: 1 },
  cannotBeCountered: true,
  effects: [{ kind: 'counterSpell' }],
  overload: {
    cost: { generic: 1, U: 2, R: 1 },
    effects: [{ kind: 'counterSpell', spellSelection: 'spellsYouDontControl' }],
  },
});

const STACK_SPELL = parseCard({
  kind: 'instant',
  id: 'sim-rtr-stack-spell',
  name: 'Sim Stack Spell',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 4 },
  colors: [],
  manaCost: {},
  effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
});

const UNCOUNTERABLE_STACK_SPELL = parseCard({
  kind: 'instant',
  id: 'sim-rtr-uncounterable-stack-spell',
  name: 'Sim Uncounterable Stack Spell',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 5 },
  colors: [],
  manaCost: {},
  cannotBeCountered: true,
  effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
});

function withOpposingSpell(cannotBeCountered: boolean): GameState {
  const card = cannotBeCountered ? UNCOUNTERABLE_STACK_SPELL : STACK_SPELL;
  const open = scenario({
    seed: `sim/overload-counterflux/${String(cannotBeCountered)}`,
    active: 1,
    step: 'precombatMain',
    hands: [[], [card]],
  }).state;
  const action = legalActions(open).find(
    (candidate) => candidate.type === 'castSpell' && candidate.player === 1,
  );
  if (action === undefined) throw new Error('opposing spell was not castable');
  return reduce(open, action).state;
}

function counterfluxOverloadScore(state: GameState): number {
  return scoreTargets(
    state,
    0,
    COUNTERFLUX,
    [null],
    DEFAULT_GREEDY_CONFIG.cast,
    DEFAULT_GREEDY_CONFIG.target,
    DEFAULT_GREEDY_CONFIG.race,
    0,
    null,
    undefined,
    undefined,
    undefined,
    'overload',
  );
}

describe('Overload cast policy', () => {
  it('scores the replacement cohort and budgets the selected alternate cost', () => {
    const state = scenario({
      seed: 'sim/overload-policy',
      active: 0,
      step: 'precombatMain',
      battlefield: [
        ...[1, 2, 3, 4, 5, 6, 7].map((collectorNumber) => ({
          card: basicLand('Island', 'TST', collectorNumber),
          controller: 0 as const,
        })),
        { card: CREATURE, controller: 1 },
        { card: { ...CREATURE, id: 'sim-rtr-creature-two', name: 'Sim Overload Target Two' }, controller: 1 },
      ],
      hands: [[CYCLONIC_RIFT], []],
    }).state;
    const decision = pendingDecision(state);
    if (decision?.kind !== 'priority') throw new Error('Overload policy probe did not reach priority');

    const config = {
      ...DEFAULT_GREEDY_CONFIG,
      cast: { ...DEFAULT_GREEDY_CONFIG.cast, holdInstants: false },
    };
    const [candidate] = bestTargetingPerCard(
      {
        state: observeState(state, 0, 'test/overload-policy.test.ts:144'),
        player: 0,
        decision,
      } satisfies AgentView,
      config,
    );

    expect(candidate?.action.castingCost).toBe('overload');
    expect(candidate?.cost).toBe(7);
  });

  it('does not score an uncounterable spell as an Overload recipient', () => {
    expect(counterfluxOverloadScore(withOpposingSpell(true))).toBe(0);
    expect(counterfluxOverloadScore(withOpposingSpell(false))).toBeGreaterThan(0);
  });

  it('does not score a spell protected from Counterflux colors', () => {
    const open = withOpposingSpell(false);
    const sourceOid = open.stack.at(-1)?.oid;
    if (sourceOid === undefined) throw new Error('opposing spell did not reach the stack');
    const protectedState: GameState = {
      ...open,
      turnPlayerRules: [
        ...open.turnPlayerRules,
        {
          rule: 'spellsCantBeCounteredBySpellColors',
          sourceOid,
          player: 1,
          colors: ['U', 'R'],
        },
      ],
    };
    expect(counterfluxOverloadScore(protectedState)).toBe(0);
  });
});
