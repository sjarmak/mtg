/** Greedy policy coverage for Viashino Racketeer's two linked decisions. */
import { parseCard } from '@mtg/dsl';
import { pendingDecision, reduce, scenario, validateAction, type GameState } from '@mtg/kernel';
import { observeState } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG, decideGreedy } from '@mtg/sim';
import { describe, expect, it } from 'vitest';
import { creature, MOUNTAIN } from './cards';

const RACKETEER = parseCard({
  kind: 'creature',
  id: 'rtr-112-viashino-racketeer-policy',
  name: 'Viashino Racketeer',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 112 },
  manaCost: { generic: 2, R: 1 },
  colors: ['R'],
  subtypes: ['Lizard', 'Rogue'],
  power: 2,
  toughness: 1,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      printedSourceReference: 'thisCreature',
      optional: true,
      effects: [
        { kind: 'discardCards', count: 1, target: { kind: 'noTarget' } },
        { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
      ],
    },
  ],
});

const HELD_ONE = creature('Racketeer Policy Held One', 1, 1);
const HELD_TWO = creature('Racketeer Policy Held Two', 4, 4);
const DRAWN = creature('Racketeer Policy Drawn', 2, 2);

function decide(state: GameState) {
  const decision = pendingDecision(state);
  if (decision === null) throw new Error('Racketeer policy had no decision');
  const action = decideGreedy(
    {
      state: observeState(state, decision.player, 'test/rtr-viashino-racketeer-policy.test.ts:40'),
      player: decision.player,
      decision,
    },
    DEFAULT_GREEDY_CONFIG,
  );
  expect(validateAction(state, action)).toBeNull();
  return action;
}

function untilOptional(): GameState {
  let state = scenario({
    seed: 'sim/rtr-viashino-racketeer',
    battlefield: Array.from({ length: 3 }, () => ({ card: MOUNTAIN, controller: 0 as const })),
    hands: [[RACKETEER, HELD_ONE, HELD_TWO], []],
    libraries: [[DRAWN], []],
  }).state;
  const source = state.players[0].hand.find((oid) => state.objects[oid]?.card.name === RACKETEER.name);
  if (source === undefined) throw new Error('Racketeer policy source missing');
  state = reduce(state, { type: 'castSpell', player: 0, oid: source, targets: [] }).state;
  for (let guard = 0; guard < 12; guard += 1) {
    const decision = pendingDecision(state);
    if (decision?.kind === 'optionalTrigger') return state;
    if (decision?.kind !== 'priority') throw new Error(`Racketeer policy stopped on ${decision?.kind}`);
    state = reduce(state, { type: 'passPriority', player: decision.player }).state;
  }
  throw new Error('Racketeer policy never reached its optional trigger');
}

describe('Viashino Racketeer bot policy', () => {
  it('accepts the free rummage and submits one legal discard before the draw', () => {
    let state = untilOptional();
    const optional = decide(state);
    expect(optional).toMatchObject({ type: 'answerOptionalTrigger', player: 0, accept: true });
    state = reduce(state, optional).state;

    const discard = decide(state);
    expect(discard).toMatchObject({ type: 'chooseDiscards', player: 0 });
    if (discard.type !== 'chooseDiscards') throw new Error('Racketeer bot did not choose a discard');
    expect(discard.oids).toHaveLength(1);
    state = reduce(state, discard).state;

    expect(state.players[0].graveyard).toHaveLength(1);
    expect(state.players[0].library).toEqual([]);
    expect(state.players[0].hand).toHaveLength(2);
    expect(state.players[0].hand.map((oid) => state.objects[oid]?.card.name)).toContain(DRAWN.name);
  });
});
