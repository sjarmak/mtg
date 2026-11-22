/** Korozda Guildmage composes a shared-target grant and paid toughness LKI. */
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  canBlock,
  hasKeywordAbility,
  legalActions,
  pendingDecision,
  scenario,
  toughnessOf,
  validateAction,
  type Action,
  type GameState,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { counterStackEntry } from '../src/counter';
import { creature, FOREST, SWAMP } from './cards';
import { withCounters } from './continuous-helpers';
import { apply, oidOf } from './helpers';

const KOROZDA = parseCard({
  kind: 'creature',
  id: 'rtr-176-korozda-guildmage-kernel',
  name: 'Korozda Guildmage',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 176 },
  manaCost: { B: 1, G: 1 },
  colors: ['B', 'G'],
  subtypes: ['Elf', 'Shaman'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1, B: 1, G: 1 } },
      effects: [
        { kind: 'pumpUntilEndOfTurn', power: 1, toughness: 1, target: { kind: 'targetCreature' } },
        {
          kind: 'grantKeywordUntilEndOfTurn',
          keyword: 'intimidate',
          target: { kind: 'thatCreature' },
        },
      ],
    },
    {
      kind: 'activated',
      cost: {
        mana: { generic: 2, B: 1, G: 1 },
        sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] }, nontoken: true },
      },
      effects: [
        {
          kind: 'createToken',
          count: { kind: 'paidSacrificeToughness' },
          token: {
            name: 'Saproling',
            power: 1,
            toughness: 1,
            colors: ['G'],
            subtypes: ['Saproling'],
            keywords: [],
          },
        },
      ],
    },
  ],
} as CardInput);

const ALLY = creature('Korozda Allied Creature', 2, 2, { cost: { G: 1 } });
const TOKEN = creature('Korozda Existing Token', 4, 4, { cost: { G: 1 } });
const BLUE = creature('Korozda Blue Blocker', 2, 2, { cost: { U: 1 } });

function board(): ReduceResult {
  return scenario({
    battlefield: [
      { card: KOROZDA, controller: 0 },
      { card: ALLY, controller: 0 },
      { card: TOKEN, controller: 0, token: true },
      { card: BLUE, controller: 1 },
      { card: FOREST, controller: 0 },
      { card: FOREST, controller: 0 },
      { card: SWAMP, controller: 0 },
      { card: SWAMP, controller: 0 },
    ],
  });
}

function activations(
  state: GameState,
  abilityIndex: number,
): readonly Extract<Action, { type: 'activateAbility' }>[] {
  const source = oidOf(state, KOROZDA.name);
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' && action.oid === source && action.abilityIndex === abilityIndex,
  );
}

function resolveTop(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 8 && current.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error(`stack paused at ${decision?.kind ?? 'nothing'}`);
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  if (current.state.stack.length > 0) throw new Error('stack did not resolve within the pass guard');
  return current;
}

describe('Korozda Guildmage activations', () => {
  it('pumps one creature and grants intimidate to that same creature', () => {
    const start = board();
    const ally = oidOf(start.state, ALLY.name);
    const blue = oidOf(start.state, BLUE.name);
    const action = activations(start.state, 0).find(
      (candidate) => candidate.targets[0]?.kind === 'permanent' && candidate.targets[0].oid === ally,
    );
    if (action === undefined) throw new Error('missing ally-targeted pump activation');

    expect(canBlock(start.state, blue, ally)).toBe(true);
    const done = resolveTop(apply(start, action));

    expect(toughnessOf(done.state, ally)).toBe(3);
    expect(hasKeywordAbility(done.state, ally, 'intimidate')).toBe(true);
    expect(canBlock(done.state, blue, ally)).toBe(false);
    expect(hasKeywordAbility(done.state, oidOf(done.state, KOROZDA.name), 'intimidate')).toBe(false);
  });

  it('offers nontoken creatures, including the source, but never a token or opposing creature', () => {
    const start = board();
    const source = oidOf(start.state, KOROZDA.name);
    const ally = oidOf(start.state, ALLY.name);
    const token = oidOf(start.state, TOKEN.name);
    const enemy = oidOf(start.state, BLUE.name);
    const payments = activations(start.state, 1).map((action) => action.sacrifices);

    expect(payments).toContainEqual([source]);
    expect(payments).toContainEqual([ally]);
    expect(payments).not.toContainEqual([token]);
    expect(payments).not.toContainEqual([enemy]);
    expect(
      validateAction(start.state, {
        type: 'activateAbility',
        player: 0,
        oid: source,
        abilityIndex: 1,
        targets: [null],
        sacrifices: [token],
      }),
    ).toMatch(/does not match/iu);
  });

  it("sacrifices before stacking and retains the paid creature's layered toughness", () => {
    const opened = board();
    const ally = oidOf(opened.state, ALLY.name);
    const strengthened = {
      ...opened,
      state: withCounters(opened.state, ally, 'plusOnePlusOne', 1),
    };
    const action = activations(strengthened.state, 1).find((candidate) => candidate.sacrifices[0] === ally);
    if (action === undefined) throw new Error('missing ally sacrifice activation');

    const paid = apply(strengthened, action);
    expect(paid.state.objects[ally]?.zone).toBe('graveyard');
    expect(paid.state.stack.at(-1)?.paidSacrificeToughness).toBe(3);

    const done = resolveTop(paid);
    const saprolings = done.state.battlefield.filter(
      (oid) => done.state.objects[oid]?.token === true && done.state.objects[oid]?.card.name === 'Saproling',
    );
    expect(saprolings).toHaveLength(3);
  });

  it('keeps a source sacrifice paid when the ability is countered', () => {
    const start = board();
    const source = oidOf(start.state, KOROZDA.name);
    const action = activations(start.state, 1).find((candidate) => candidate.sacrifices[0] === source);
    if (action === undefined) throw new Error('missing source sacrifice activation');

    const paid = apply(start, action);
    const ability = paid.state.stack.at(-1)?.oid;
    if (ability === undefined) throw new Error('missing activated ability stack object');
    const countered = counterStackEntry(beginTrace(paid.state), ability, 'test-counter');

    expect(countered.state.objects[source]?.zone).toBe('graveyard');
    expect(countered.state.stack).toHaveLength(0);
  });
});
