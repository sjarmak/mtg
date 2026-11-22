/** Native Wild Guess casting: choose and discard a card before the spell reaches the stack. */
import { describe, expect, it } from 'vitest';
import { parseCard, type Card, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  eventsOfType,
  legalActions,
  reduce,
  scenario,
  validateAction,
  type Action,
  type GameState,
  type ObjectId,
} from '@mtg/kernel';
import { counterStackEntry } from '../src/counter';
import { creature, lands, MOUNTAIN } from './cards';
import { handOidOf } from './helpers';

const WILD_GUESS = parseCard({
  kind: 'sorcery',
  id: 'm13-157-wild-guess-kernel',
  name: 'Wild Guess',
  rarity: 'common',
  set: { code: 'M13', collectorNumber: 157 },
  colors: ['R'],
  manaCost: { R: 2 },
  additionalCost: { discard: 1 },
  effects: [{ kind: 'drawCards', count: 2, target: { kind: 'noTarget' } }],
} as unknown as CardInput);

const CHEAP = creature('Expendable Card', 1, 1, { cost: { generic: 1 } });
const VALUABLE = creature('Valuable Card', 6, 6, { cost: { generic: 6 } });

type CastAction = Extract<Action, { readonly type: 'castSpell' }>;

function discardsOf(action: CastAction): readonly ObjectId[] | undefined {
  return (action as CastAction & { readonly discards?: readonly ObjectId[] }).discards;
}

function board(hand: readonly Card[] = [WILD_GUESS, CHEAP, VALUABLE]): GameState {
  return scenario({
    battlefield: lands(MOUNTAIN, 2).map((land) => ({ card: land, controller: 0 as const })),
    hands: [hand, []],
    libraries: [lands(MOUNTAIN, 8), lands(MOUNTAIN, 8)],
    seed: 'spell-discard-cost/wild-guess',
  }).state;
}

function casts(state: GameState): readonly CastAction[] {
  const spell = handOidOf(state, 0, WILD_GUESS.name);
  return legalActions(state).filter(
    (action): action is CastAction => action.type === 'castSpell' && action.oid === spell,
  );
}

describe('Wild Guess spell payment', () => {
  it('is absent with no other hand card and never offers the spell as its own payment', () => {
    expect(casts(board([WILD_GUESS]))).toEqual([]);

    const state = board();
    const spell = handOidOf(state, 0, WILD_GUESS.name);
    expect(casts(state).map(discardsOf)).toEqual([
      [handOidOf(state, 0, CHEAP.name)],
      [handOidOf(state, 0, VALUABLE.name)],
    ]);
    expect(casts(state).some((action) => discardsOf(action)?.includes(spell) === true)).toBe(false);
  });

  it('rejects a missing, opposing, duplicate, or self payment', () => {
    const state = board();
    const spell = handOidOf(state, 0, WILD_GUESS.name);
    const mine = handOidOf(state, 0, CHEAP.name);
    const theirs = state.players[1].library[0];
    if (theirs === undefined) throw new Error('the opponent library is empty');
    const action = (discards: readonly ObjectId[]): Action =>
      ({ type: 'castSpell', player: 0, oid: spell, targets: [null], discards }) as unknown as Action;

    expect(validateAction(state, action([]))).not.toBeNull();
    expect(validateAction(state, action([spell]))).not.toBeNull();
    expect(validateAction(state, action([theirs]))).not.toBeNull();
    expect(validateAction(state, action([mine, mine]))).not.toBeNull();
    expect(validateAction(state, action([mine]))).toBeNull();
  });

  it('pays before the spell reaches the stack and never refunds a countered spell', () => {
    const state = board();
    const payment = handOidOf(state, 0, CHEAP.name);
    const action = casts(state).find((candidate) => discardsOf(candidate)?.[0] === payment);
    if (action === undefined) throw new Error('Wild Guess offered no expendable payment');

    const cast = reduce(state, action);
    const spell = handOidOf(state, 0, WILD_GUESS.name);
    expect(cast.state.objects[payment]?.zone).toBe('graveyard');
    expect(cast.state.stack.map((entry) => entry.oid)).toEqual([spell]);
    expect(eventsOfType(cast.events, 'cardsDiscarded').at(-1)?.oids).toEqual([payment]);
    expect(cast.events.findIndex((event) => event.type === 'cardsDiscarded')).toBeLessThan(
      cast.events.findIndex((event) => event.type === 'spellCast'),
    );

    const countered = counterStackEntry(beginTrace(cast.state), spell, 'test-counter');
    expect(countered.state.objects[payment]?.zone).toBe('graveyard');
    expect(countered.state.objects[spell]?.zone).toBe('graveyard');
    expect(countered.state.stack).toHaveLength(0);
  });
});
