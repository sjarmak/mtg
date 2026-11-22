/** Live count, mixed-color, controller, and source-state probes for RTR #115. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import type { Action, GameState } from '@mtg/kernel';
import {
  beginTrace,
  legalActions,
  moveObject,
  playerOf,
  reduce,
  scenario,
  validateAction,
} from '@mtg/kernel';
import { creature } from './cards';
import { oidOf } from './helpers';

const AXEBANE = parseCard({
  kind: 'creature',
  id: 'rtr-115-axebane-guardian-kernel',
  name: 'Axebane Guardian',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 115 },
  colors: ['G'],
  manaCost: { generic: 2, G: 1 },
  subtypes: ['Human', 'Druid'],
  keywordAbilities: [{ kind: 'defender' }],
  power: 0,
  toughness: 3,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      effects: [
        {
          kind: 'addMana',
          produces: ['W', 'U', 'B', 'R', 'G'],
          amount: {
            kind: 'countMatching',
            filter: { cardTypes: ['creature'], keywordAbilities: ['defender'] },
          },
          distribution: 'anyCombinationOfColors',
        },
      ],
    },
  ],
});
const ALLY_WALL = creature('Axebane Ally Wall', 0, 4, {
  keywordAbilities: [{ kind: 'defender' }],
});
const OPPOSING_WALL = creature('Axebane Opposing Wall', 0, 4, {
  keywordAbilities: [{ kind: 'defender' }],
});
const BEAR = creature('Axebane Bear', 2, 2);

function manaActions(state: GameState, oid: string) {
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'activateManaAbility' }> =>
      action.type === 'activateManaAbility' && action.oid === oid,
  );
}

function board(options: { readonly active?: 0 | 1; readonly sick?: boolean } = {}): GameState {
  return scenario({
    active: options.active ?? 0,
    battlefield: [
      { card: AXEBANE, controller: 0, summoningSick: options.sick ?? false },
      { card: ALLY_WALL, controller: 0 },
      { card: BEAR, controller: 0 },
      { card: OPPOSING_WALL, controller: 1 },
    ],
  }).state;
}

describe('RTR Axebane Guardian in the kernel', () => {
  it('collects an uninterruptible sequence of colors and produces a genuinely mixed choice', () => {
    const state = board();
    const oid = oidOf(state, AXEBANE.name);
    const actions = manaActions(state, oid);
    expect(actions.map((action) => action.color)).toEqual(['W', 'U', 'B', 'R', 'G']);
    const white = actions.find((action) => action.color === 'W');
    expect(white).toBeDefined();
    const first = reduce(state, white!);
    expect(first.state.pendingManaCombination).toMatchObject({ player: 0, sourceOid: oid, remaining: 1 });
    expect(legalActions(first.state).some((action) => action.type === 'passPriority')).toBe(false);
    expect(validateAction(first.state, { type: 'passPriority', player: 0 })).toMatch(/color choice/);
    expect(validateAction(first.state, { type: 'activateManaAbility', player: 0, oid, color: 'C' })).toMatch(
      /colorless/,
    );
    const blue = manaActions(first.state, oid).find((action) => action.color === 'U');
    expect(blue).toBeDefined();
    const done = reduce(first.state, blue!);
    expect(playerOf(done.state, 0).pool).toMatchObject({ W: 1, U: 1, B: 0, R: 0, G: 0, C: 0 });
    expect(done.state.objects[oid]?.tapped).toBe(true);
    expect(done.state.pendingManaCombination).toBeUndefined();
  });

  it('counts only live controlled defenders and rejects hostile distributions', () => {
    const state = board();
    const oid = oidOf(state, AXEBANE.name);
    const wrong = {
      type: 'activateManaAbility',
      player: 0,
      oid,
      color: 'W',
      amount: 3,
    } as const;
    expect(validateAction(state, wrong as Action)).toMatch(/amount|produce/);

    const withoutAlly = moveObject(beginTrace(state), oidOf(state, ALLY_WALL.name), 'graveyard').state;
    const actions = manaActions(withoutAlly, oid);
    expect(actions).toHaveLength(5);
    const green = actions.find((action) => action.color === 'G');
    expect(green).toBeDefined();
    const done = reduce(withoutAlly, green!);
    expect(playerOf(done.state, 0).pool.G).toBe(1);
    expect(done.state.pendingManaCombination).toBeUndefined();
  });

  it('respects summoning sickness, current control, and source departure', () => {
    const sick = board({ sick: true });
    expect(manaActions(sick, oidOf(sick, AXEBANE.name))).toEqual([]);

    const state = board();
    const oid = oidOf(state, AXEBANE.name);
    const changed = {
      ...state,
      objects: { ...state.objects, [oid]: { ...state.objects[oid]!, controller: 1 as const } },
      turn: { ...state.turn, active: 1 as const, priority: 1 as const },
    };
    const controlled = manaActions(changed, oid);
    expect(controlled).toHaveLength(5);

    const gone = moveObject(beginTrace(state), oid, 'graveyard').state;
    expect(manaActions(gone, oid)).toEqual([]);
  });
});
