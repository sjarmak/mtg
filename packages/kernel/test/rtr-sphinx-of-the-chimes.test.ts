/** Exact relational hand payment and pre-stack discard timing for RTR #52. */
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  legalActions,
  pendingDecision,
  scenario,
  validateAction,
  type Action,
  type GameState,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, ISLAND, lands } from './cards';
import { apply, oidOf } from './helpers';

const SPHINX = parseCard({
  kind: 'creature',
  id: 'rtr-052-sphinx-of-the-chimes-kernel',
  name: 'Sphinx of the Chimes',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 52 },
  manaCost: { generic: 4, U: 2 },
  colors: ['U'],
  subtypes: ['Sphinx'],
  power: 5,
  toughness: 6,
  keywords: ['flying'],
  abilities: [
    {
      kind: 'activated',
      cost: {
        mana: {},
        discardMatching: { count: 2, filter: 'nonland', relation: 'sameName' },
      },
      effects: [{ kind: 'drawCards', count: 4, target: { kind: 'noTarget' } }],
    },
  ],
} as CardInput);

const CHIME = creature('Matching Chime', 1, 1);
const OTHER = creature('Different Chime', 1, 1);

function activations(state: GameState): readonly Extract<Action, { type: 'activateAbility' }>[] {
  const source = oidOf(state, SPHINX.name);
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' && action.oid === source,
  );
}

function resolveTop(current: ReduceResult): ReduceResult {
  for (let guard = 0; guard < 4 && current.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error('Sphinx stack lost priority');
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  return current;
}

describe('RTR #52 Sphinx of the Chimes', () => {
  it('offers only a same-name nonland pair, pays it before stacking, and draws four', () => {
    const start = scenario({
      battlefield: [{ card: SPHINX, controller: 0 }],
      hands: [[OTHER, CHIME, ISLAND, CHIME, ISLAND], []],
      libraries: [lands(ISLAND, 8), lands(ISLAND, 8)],
      active: 0,
      step: 'precombatMain',
      seed: 'rtr/sphinx-of-the-chimes/pair',
    });
    const offered = activations(start.state);
    expect(offered).toHaveLength(1);
    const activation = offered[0];
    if (activation === undefined) throw new Error('Sphinx offered no activation');
    expect(activation.discards?.map((oid) => start.state.objects[oid]?.card.name)).toEqual([
      CHIME.name,
      CHIME.name,
    ]);

    const stacked = apply(start, activation);
    expect(stacked.state.stack).toHaveLength(1);
    expect(stacked.state.players[0].graveyard).toEqual(activation.discards);
    expect(stacked.state.players[0].hand).toHaveLength(3);

    const resolved = resolveTop(stacked);
    expect(resolved.state.stack).toHaveLength(0);
    expect(resolved.state.players[0].hand).toHaveLength(7);
  });

  it('refuses different names, lands, too few cards, and a card no longer in hand', () => {
    const start = scenario({
      battlefield: [{ card: SPHINX, controller: 0 }],
      hands: [[CHIME, CHIME, OTHER, ISLAND, ISLAND], []],
      libraries: [lands(ISLAND, 8), lands(ISLAND, 8)],
      active: 0,
      step: 'precombatMain',
      seed: 'rtr/sphinx-of-the-chimes/refusals',
    });
    expect(activations(start.state)).toHaveLength(1);
    const noPair = scenario({
      battlefield: [{ card: SPHINX, controller: 0 }],
      hands: [[CHIME, OTHER, ISLAND, ISLAND], []],
      libraries: [lands(ISLAND, 8), lands(ISLAND, 8)],
      active: 0,
      step: 'precombatMain',
      seed: 'rtr/sphinx-of-the-chimes/no-pair',
    });
    expect(activations(noPair.state)).toEqual([]);
    const source = oidOf(start.state, SPHINX.name);
    const chime = start.state.players[0].hand.find(
      (oid) => start.state.objects[oid]?.card.name === CHIME.name,
    );
    const other = start.state.players[0].hand.find(
      (oid) => start.state.objects[oid]?.card.name === OTHER.name,
    );
    const islands = start.state.players[0].hand.filter(
      (oid) => start.state.objects[oid]?.card.kind === 'land',
    );
    const stale = start.state.players[1].library[0];
    if (chime === undefined || other === undefined || islands.length !== 2 || stale === undefined) {
      throw new Error('Sphinx refusal rig lost a card');
    }
    const action = (discards: readonly string[]): Action => ({
      type: 'activateAbility',
      player: 0,
      oid: source,
      abilityIndex: 0,
      targets: [null],
      sacrifices: [],
      discards: [...discards],
    });
    expect(validateAction(start.state, action([chime, other]))).toBe(
      'the discarded cards do not have the same name',
    );
    expect(validateAction(start.state, action(islands))).toContain('does not match the discard filter');
    expect(validateAction(start.state, action([chime]))).toBe('the cost discards 2 cards, and 1 was offered');
    expect(validateAction(start.state, action([chime, stale]))).toBe(`${stale} is not in your hand`);
  });
});
