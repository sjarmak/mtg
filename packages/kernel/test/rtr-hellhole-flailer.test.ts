/** Paid activation costs retain the sacrificed permanent's layered power. */
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  legalActions,
  moveObject,
  pendingDecision,
  scenario,
  type Action,
  type GameState,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { counterStackEntry } from '../src/counter';
import { creature, MOUNTAIN, planeswalker, SWAMP } from './cards';
import { withCounters } from './continuous-helpers';
import { apply, oidOf } from './helpers';

const NAME = 'Hellhole Flailer';
const HELLHOLE = parseCard({
  kind: 'creature',
  id: 'rtr-167-hellhole-flailer-kernel',
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

const CREATURE = creature('Runeclaw Bear', 2, 2);
const WALKER = planeswalker('Ajani Goldmane', 8, []);

function board(withCounter = false): GameState {
  const opened = scenario({
    battlefield: [
      { card: HELLHOLE, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: SWAMP, controller: 0 },
      { card: SWAMP, controller: 0 },
      { card: CREATURE, controller: 1 },
      { card: WALKER, controller: 1 },
    ],
  }).state;
  if (!withCounter) return opened;
  return withCounters(opened, oidOf(opened, NAME), 'plusOnePlusOne', 1);
}

function activations(state: GameState): readonly Extract<Action, { type: 'activateAbility' }>[] {
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' && action.oid === oidOf(state, NAME),
  );
}

function passStack(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 8 && current.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error(`stack paused at ${decision?.kind ?? 'nothing'}`);
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  if (current.state.stack.length > 0) throw new Error('stack did not resolve within the pass guard');
  return current;
}

function atOpponent(state: GameState): Extract<Action, { type: 'activateAbility' }> {
  const action = activations(state).find(
    (candidate) => candidate.targets[0]?.kind === 'player' && candidate.targets[0].player === 1,
  );
  if (action === undefined) throw new Error('missing opponent-targeted activation');
  return action;
}

describe('the paid source-sacrifice activation', () => {
  it('offers players and planeswalkers, never creatures', () => {
    const state = board();
    const walker = oidOf(state, WALKER.name);
    const creatureOid = oidOf(state, CREATURE.name);
    const targets = activations(state).map((action) => action.targets[0]);

    expect(targets).toContainEqual({ kind: 'player', player: 0 });
    expect(targets).toContainEqual({ kind: 'player', player: 1 });
    expect(targets).toContainEqual({ kind: 'permanent', oid: walker });
    expect(targets).not.toContainEqual({ kind: 'permanent', oid: creatureOid });
  });

  it.each([
    { counter: false, retained: 3, endingLife: 17 },
    { counter: true, retained: 4, endingLife: 16 },
  ])('sacrifices before stacking and resolves retained layered power: $retained', (example) => {
    const state = board(example.counter);
    const source = oidOf(state, NAME);
    const paid = apply({ state, events: [] }, atOpponent(state));

    expect(paid.state.objects[source]?.zone).toBe('graveyard');
    expect(paid.state.stack.at(-1)?.paidSacrificePower).toBe(example.retained);
    expect(passStack(paid).state.players[1].life).toBe(example.endingLife);
  });

  it('does not refund the source when the ability is countered', () => {
    const state = board();
    const source = oidOf(state, NAME);
    const paid = apply({ state, events: [] }, atOpponent(state));
    const ability = paid.state.stack.at(-1)?.oid;
    if (ability === undefined) throw new Error('missing ability stack object');

    const countered = counterStackEntry(beginTrace(paid.state), ability, 'test-counter');
    expect(countered.state.objects[source]?.zone).toBe('graveyard');
    expect(countered.state.stack).toHaveLength(0);
  });

  it('fizzles against a planeswalker that leaves while keeping the source sacrificed', () => {
    const state = board(true);
    const source = oidOf(state, NAME);
    const walker = oidOf(state, WALKER.name);
    const action = activations(state).find(
      (candidate) => candidate.targets[0]?.kind === 'permanent' && candidate.targets[0].oid === walker,
    );
    if (action === undefined) throw new Error('missing planeswalker-targeted activation');

    const paid = apply({ state, events: [] }, action);
    const departed = moveObject(beginTrace(paid.state), walker, 'graveyard');
    const resolved = passStack(departed);

    expect(resolved.state.objects[source]?.zone).toBe('graveyard');
    expect(resolved.state.stack).toHaveLength(0);
  });
});
