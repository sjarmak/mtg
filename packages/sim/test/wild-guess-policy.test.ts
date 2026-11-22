/** Greedy casting prices the card Wild Guess discards as part of its cost. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { legalActions, scenario, type AgentView, type ObjectId } from '@mtg/kernel';
import { observeState } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG, bestTargetingPerCard } from '@mtg/sim';

const WILD_GUESS = parseCard({
  kind: 'sorcery',
  id: 'm13-wild-guess-policy',
  name: 'Wild Guess',
  rarity: 'common',
  set: { code: 'M13', collectorNumber: 157 },
  colors: ['R'],
  manaCost: { R: 2 },
  additionalCost: { discard: 1 },
  effects: [{ kind: 'drawCards', count: 2, target: { kind: 'noTarget' } }],
} as CardInput);

const CHEAP = parseCard({
  kind: 'creature',
  id: 'wild-guess-cheap',
  name: 'Cheap Creature',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { generic: 1 },
  power: 1,
  toughness: 1,
} as CardInput);

const VALUABLE = parseCard({
  kind: 'creature',
  id: 'wild-guess-valuable',
  name: 'Valuable Creature',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 2 },
  manaCost: { generic: 6 },
  power: 6,
  toughness: 6,
} as CardInput);

const MOUNTAIN = parseCard({
  kind: 'land',
  id: 'wild-guess-mountain',
  name: 'Mountain',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 3 },
  supertypes: ['basic'],
  basicLandType: 'Mountain',
  producesMana: ['R'],
} as CardInput);

function oidNamed(view: AgentView, name: string): ObjectId {
  const oid = view.state.players[0].hand.find(
    (candidate) => view.state.objects[candidate]?.card.name === name,
  );
  if (oid === undefined) throw new Error(`the fixture has no ${name}`);
  return oid;
}

function hostileView(): AgentView {
  const state = scenario({
    battlefield: [
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
    ],
    hands: [[WILD_GUESS, CHEAP, VALUABLE], []],
    seed: 'sim/wild-guess/hostile-order',
  }).state;
  const casts = legalActions(state).filter(
    (action) => action.type === 'castSpell' && state.objects[action.oid]?.card.name === 'Wild Guess',
  );
  const valuable = state.players[0].hand.find((oid) => state.objects[oid]?.card.name === 'Valuable Creature');
  if (valuable === undefined) throw new Error('the fixture has no valuable card');
  casts.sort((left, right) =>
    left.type === 'castSpell' && left.discards?.includes(valuable) === true
      ? -1
      : right.type === 'castSpell' && right.discards?.includes(valuable) === true
        ? 1
        : 0,
  );
  return {
    state: observeState(state, 0, 'test/wild-guess-policy.test.ts:81'),
    player: 0,
    decision: { kind: 'priority', player: 0, options: casts, complete: true },
  };
}

describe('Wild Guess payment policy', () => {
  it('chooses the cheaper discard even when the expensive payment is enumerated first', () => {
    const view = hostileView();
    const [candidate] = bestTargetingPerCard(view, DEFAULT_GREEDY_CONFIG);
    expect(candidate?.action.discards).toEqual([oidNamed(view, 'Cheap Creature')]);
  });

  it('subtracts the discarded card value from the candidate score', () => {
    const view = hostileView();
    const options = view.decision.options.filter((action) => action.type === 'castSpell');
    const scores = options.map(
      (action) =>
        bestTargetingPerCard(
          {
            state: view.state,
            player: view.player,
            decision: { kind: 'priority', player: view.player, options: [action], complete: true },
          },
          DEFAULT_GREEDY_CONFIG,
        )[0]?.value,
    );
    expect(scores[0]).toBeLessThan(scores[1] ?? Number.NEGATIVE_INFINITY);
  });
});
