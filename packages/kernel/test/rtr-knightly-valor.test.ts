/** Native attachment and entry-trigger behavior for RTR #13, Knightly Valor. */
import { parseCard, type Card } from '@mtg/dsl';
import {
  attachmentOf,
  controllerOf,
  hasKeyword,
  powerOf,
  reduce,
  reduceAll,
  scenario,
  toughnessOf,
  type Action,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, lands, PLAINS } from './cards';

const KNIGHTLY_VALOR = parseCard({
  kind: 'enchantment',
  id: 'rtr-013-knightly-valor-kernel',
  name: 'Knightly Valor',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 13 },
  manaCost: { generic: 4, W: 1 },
  colors: ['W'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [
      { kind: 'statBonus', power: 2, toughness: 2 },
      { kind: 'grantKeyword', keyword: 'vigilance' },
    ],
  },
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      printedSourceReference: 'thisAura',
      effects: [
        {
          kind: 'createToken',
          count: 1,
          token: {
            name: 'Knight',
            power: 2,
            toughness: 2,
            colors: ['W'],
            subtypes: ['Knight'],
            keywords: ['vigilance'],
            printedKeywordReminder: 'vigilance',
          },
        },
      ],
    },
  ],
});

const HOST = creature('Knightly Valor Host', 6, 6);
const CONTROL = creature('Knightly Valor Control', 2, 2);
function passesFrom(player: 0 | 1): readonly Action[] {
  const opponent: 0 | 1 = player === 0 ? 1 : 0;
  return [
    { type: 'passPriority' as const, player },
    { type: 'passPriority' as const, player: opponent },
  ];
}

function named(state: GameState, name: string): ObjectId {
  const matches = state.battlefield.filter((oid) => state.objects[oid]?.card.name === name);
  if (matches.length !== 1) throw new Error(`expected one ${name}, found ${String(matches.length)}`);
  return matches[0] as ObjectId;
}

function castAura(start: GameState, player: 0 | 1, target: ObjectId): ReduceResult {
  const aura = start.players[player].hand.find((oid) => start.objects[oid]?.card.id === KNIGHTLY_VALOR.id);
  if (aura === undefined) throw new Error('Knightly Valor test lost the Aura');
  const cast = reduce(start, {
    type: 'castSpell',
    player,
    oid: aura,
    targets: [{ kind: 'permanent', oid: target }],
  });
  const entered = reduceAll(cast.state, passesFrom(player));
  return { state: entered.state, events: [...cast.events, ...entered.events] };
}

function board(caster: 0 | 1): GameState {
  const opponent = caster === 0 ? 1 : 0;
  return scenario({
    active: caster,
    battlefield: [
      { card: HOST, controller: opponent },
      { card: CONTROL, controller: opponent },
      ...lands(PLAINS, 5).map((card) => ({ card, controller: caster })),
    ],
    hands: caster === 0 ? [[KNIGHTLY_VALOR], []] : [[], [KNIGHTLY_VALOR]],
  }).state;
}

describe('Knightly Valor in the kernel', () => {
  it('attaches before its trigger and modifies only the enchanted creature', () => {
    const start = board(0);
    const host = named(start, HOST.name);
    const control = named(start, CONTROL.name);
    const entered = castAura(start, 0, host);
    const aura = named(entered.state, KNIGHTLY_VALOR.name);

    expect(attachmentOf(entered.state, aura)).toBe(host);
    expect(entered.state.stack).toHaveLength(1);
    expect(entered.state.battlefield.some((oid) => entered.state.objects[oid]?.card.name === 'Knight')).toBe(
      false,
    );
    expect([powerOf(entered.state, host), toughnessOf(entered.state, host)]).toEqual([8, 8]);
    expect(hasKeyword(entered.state, host, 'vigilance')).toBe(true);
    expect([powerOf(entered.state, control), toughnessOf(entered.state, control)]).toEqual([2, 2]);
    expect(hasKeyword(entered.state, control, 'vigilance')).toBe(false);
  });

  it('creates exactly one white 2/2 vigilant Knight for the Aura controller', () => {
    const start = board(1);
    const entered = castAura(start, 1, named(start, HOST.name));
    const resolved = reduceAll(entered.state, passesFrom(1));
    const token = named(resolved.state, 'Knight');
    const card: Card = resolved.state.objects[token]!.card;

    expect(controllerOf(resolved.state, token)).toBe(1);
    expect([powerOf(resolved.state, token), toughnessOf(resolved.state, token)]).toEqual([2, 2]);
    expect(card.colors).toEqual(['W']);
    expect(card.subtypes).toEqual(['Knight']);
    expect(hasKeyword(resolved.state, token, 'vigilance')).toBe(true);
  });
});
