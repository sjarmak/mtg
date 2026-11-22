/** Live payment, defender, controller, and source probes for RTR #24. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import {
  beginTrace,
  legalActions,
  moveObject,
  reduce,
  scenario,
  validateAction,
  type GameState,
} from '@mtg/kernel';
import { creature, enchantment, FOREST, lands, planeswalker } from './cards';
import { oidOf } from './helpers';

const SPHERE = parseCard({
  kind: 'enchantment',
  id: 'rtr-024-sphere-of-safety-kernel',
  name: 'Sphere of Safety',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 24 },
  colors: ['W'],
  manaCost: { generic: 4, W: 1 },
  abilities: [
    {
      kind: 'staticPlayerRule',
      players: 'eachOpponent',
      rule: 'attackControllerOrPlaneswalkersTaxedByControlledEnchantments',
    },
  ],
});
const BEAR = creature('Sphere Probe Bear', 2, 2);
const WOLF = creature('Sphere Probe Wolf', 2, 2);
const OTHER = enchantment('Sphere Probe Other Enchantment');
const WALKER = planeswalker('Sphere Probe Walker', 3, []);

function combat(
  options: {
    readonly payerLands?: number;
    readonly extraEnchantments?: number;
    readonly controller?: 0 | 1;
    readonly walker?: boolean;
  } = {},
): GameState {
  const controller = options.controller ?? 1;
  const extra = Array.from({ length: options.extraEnchantments ?? 0 }, (_, index) => ({
    card: enchantment(`${OTHER.name} ${String(index)}`),
    controller,
  }));
  const state = scenario({
    active: 0,
    battlefield: [
      { card: BEAR, controller: 0 },
      { card: WOLF, controller: 0 },
      ...lands(FOREST, options.payerLands ?? 4).map((card) => ({ card, controller: 0 as const })),
      { card: SPHERE, controller },
      ...extra,
      ...(options.walker === true ? [{ card: WALKER, controller: 1 as const }] : []),
    ],
  }).state;
  return {
    ...state,
    turn: {
      ...state.turn,
      step: 'declareAttackers' as const,
      priority: null,
      awaiting: 'attackers' as const,
      awaitingPlayer: 0 as const,
    },
  };
}

function declaration(state: GameState, attackers: readonly string[], planeswalker = false) {
  const walker = planeswalker ? oidOf(state, WALKER.name) : undefined;
  return {
    type: 'declareAttackers' as const,
    player: 0 as const,
    attackers: attackers.map((name) => ({
      oid: oidOf(state, name),
      defender: walker === undefined ? (1 as const) : { kind: 'planeswalker' as const, oid: walker },
    })),
  };
}

describe('RTR Sphere of Safety in the kernel', () => {
  it('charges the live enchantment count for each creature and taps the chosen mana sources', () => {
    const state = combat({ extraEnchantments: 1, payerLands: 4 });
    const action = declaration(state, [BEAR.name, WOLF.name]);
    expect(validateAction(state, action)).toBeNull();
    const done = reduce(state, action);
    expect(done.events.filter((event) => event.type === 'manaPaid')).toEqual([
      expect.objectContaining({ player: 0, cost: expect.objectContaining({ generic: 4 }) }),
    ]);
    expect(
      done.state.battlefield.filter(
        (oid) =>
          done.state.objects[oid]?.controller === 0 &&
          done.state.objects[oid]?.card.kind === 'land' &&
          done.state.objects[oid]?.tapped,
      ),
    ).toHaveLength(4);
  });

  it('omits and rejects unaffordable declarations while preserving empty and smaller attacks', () => {
    const state = combat({ extraEnchantments: 1, payerLands: 2 });
    const two = declaration(state, [BEAR.name, WOLF.name]);
    const one = declaration(state, [BEAR.name]);
    expect(validateAction(state, two)).toMatch(/pay/);
    expect(validateAction(state, one)).toBeNull();
    expect(legalActions(state)).toContainEqual(one);
    expect(legalActions(state)).not.toContainEqual(two);
    expect(validateAction(state, declaration(state, []))).toBeNull();
  });

  it('charges attacks on protected planeswalkers, reads controller changes, and stops after departure', () => {
    const protectedState = combat({ payerLands: 1, walker: true });
    expect(validateAction(protectedState, declaration(protectedState, [BEAR.name], true))).toBeNull();

    const changed = combat({ payerLands: 0, controller: 0 });
    expect(validateAction(changed, declaration(changed, [BEAR.name]))).toBeNull();

    const present = combat({ payerLands: 0 });
    expect(validateAction(present, declaration(present, [BEAR.name]))).toMatch(/pay/);
    const sphere = oidOf(present, SPHERE.name);
    const gone = moveObject(beginTrace(present), sphere, 'graveyard').state;
    expect(validateAction(gone, declaration(gone, [BEAR.name]))).toBeNull();
  });
});
