/** Greedy choices for Redirect/Reverberate's resolution-time target decision. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { basicLand, parseCard } from '@mtg/dsl';
import type { Action, GameState } from '@mtg/kernel';
import { pendingDecision, reduce, scenario, validateAction } from '@mtg/kernel';
import { observeState } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG, decideGreedy } from '@mtg/sim';
import { creature, instant, MOUNTAIN } from './cards';

const SPARK = instant('Forked Spark', [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }], {});
const ISLAND = basicLand('Island', 'TST', 505);
const REVERBERATE = instant(
  'Reverberate',
  [{ kind: 'copySpell', spellFilter: { cardTypes: ['instant', 'sorcery'] } }],
  { R: 2 },
  ['R'],
);
const SWITCHEROO = parseCard({
  kind: 'sorcery',
  id: 'm13-switcheroo-policy',
  name: 'Switcheroo',
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 71 },
  manaCost: { generic: 4, U: 1 },
  colors: ['U'],
  effects: [{ kind: 'exchangeControl', target: { kind: 'targetCreature', count: 2, minimum: 2 } }],
} as CardInput);

function apply(state: GameState, action: Action): GameState {
  return reduce(state, action).state;
}

function pass(state: GameState): GameState {
  const decision = pendingDecision(state);
  if (decision?.kind !== 'priority') throw new Error('priority is not available');
  return apply(state, { type: 'passPriority', player: decision.player });
}

describe('spell target policy', () => {
  it('aims a copied burn spell at the opponent instead of preserving an own-goal target', () => {
    let state = scenario({
      active: 1,
      battlefield: [
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[REVERBERATE], [SPARK]],
    }).state;
    const spark = state.players[1].hand[0];
    if (spark === undefined) throw new Error('Forked Spark is not in hand');
    state = apply(state, {
      type: 'castSpell',
      player: 1,
      oid: spark,
      targets: [{ kind: 'player', player: 0 }],
    });
    state = pass(state);
    const decision = pendingDecision(state);
    if (decision?.kind !== 'priority') throw new Error('Reverberate has no priority window');
    const cast = decision.options.find(
      (action) =>
        action.type === 'castSpell' && action.targets[0]?.kind === 'spell' && action.targets[0].oid === spark,
    );
    if (cast === undefined) throw new Error('Reverberate was not offered');
    state = apply(state, cast);
    state = pass(pass(state));
    const targets = pendingDecision(state);
    if (targets?.kind !== 'spellTargets') throw new Error('the copy did not ask for targets');

    const chosen = decideGreedy(
      { state: observeState(state, 0, 'test/spell-target-policy.test.ts:70'), player: 0, decision: targets },
      DEFAULT_GREEDY_CONFIG,
    );
    expect(validateAction(state, chosen)).toBeNull();
    expect(chosen).toMatchObject({
      type: 'chooseSpellTargets',
      targets: [{ kind: 'player', player: 1 }],
    });
  });

  it('offers the least valuable own creature for the most valuable opposing creature', () => {
    const start = scenario({
      battlefield: [
        ...Array.from({ length: 5 }, () => ({ card: ISLAND, controller: 0 as const })),
        { card: creature('Small Ally', 1, 1), controller: 0 },
        { card: creature('Large Ally', 5, 5), controller: 0 },
        { card: creature('Small Opponent', 2, 2), controller: 1 },
        { card: creature('Large Opponent', 6, 6), controller: 1 },
      ],
      hands: [[SWITCHEROO], []],
    });
    const spell = start.state.players[0].hand[0];
    if (spell === undefined) throw new Error('Switcheroo is not in hand');
    const begun = reduce(start.state, {
      type: 'beginCastSpell',
      player: 0,
      oid: spell,
      targets: [null],
    });
    const firstDecision = pendingDecision(begun.state);
    if (firstDecision?.kind !== 'pluralTargets') throw new Error('first exchange target was not staged');
    const first = decideGreedy(
      {
        state: observeState(begun.state, 0, 'test/spell-target-policy.test.ts:100'),
        player: 0,
        decision: firstDecision,
      },
      DEFAULT_GREEDY_CONFIG,
    );
    expect(first).toMatchObject({
      type: 'choosePluralTarget',
      target: {
        kind: 'permanent',
        oid: Object.values(begun.state.objects).find((object) => object.card.name === 'Small Ally')?.oid,
      },
    });

    const selected = reduce(begun.state, first);
    const secondDecision = pendingDecision(selected.state);
    if (secondDecision?.kind !== 'pluralTargets') throw new Error('second exchange target was not staged');
    const second = decideGreedy(
      {
        state: observeState(selected.state, 0, 'test/spell-target-policy.test.ts:115'),
        player: 0,
        decision: secondDecision,
      },
      DEFAULT_GREEDY_CONFIG,
    );
    expect(second).toMatchObject({
      type: 'choosePluralTarget',
      target: {
        kind: 'permanent',
        oid: Object.values(selected.state.objects).find((object) => object.card.name === 'Large Opponent')
          ?.oid,
      },
    });
  });
});
