/** Exact native execution for RTR's filtered cost and timing permissions. */
import { isCastable, parseCard, renderOracleText, type Card, type CastableCard } from '@mtg/dsl';
import {
  beginTrace,
  effectiveManaCost,
  legalActions,
  moveObject,
  scenario,
  type Action,
  type GameState,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, FOREST, instant, ISLAND, lands, MOUNTAIN, sorcery } from './cards';
import { apply, oidOf } from './helpers';

function castable(card: Card): CastableCard {
  if (!isCastable(card)) throw new Error(`${card.name} is not castable`);
  return card;
}

const ELECTROMANCER = parseCard({
  kind: 'creature',
  id: 'rtr-163-goblin-electromancer-kernel',
  name: 'Goblin Electromancer',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 163 },
  manaCost: { U: 1, R: 1 },
  colors: ['U', 'R'],
  subtypes: ['Goblin', 'Wizard'],
  power: 2,
  toughness: 2,
  costReduction: { amount: 1, cardTypes: ['instant', 'sorcery'] },
});
const HYPERSONIC_DRAGON = parseCard({
  kind: 'creature',
  id: 'rtr-170-hypersonic-dragon-kernel',
  name: 'Hypersonic Dragon',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 170 },
  manaCost: { generic: 3, U: 1, R: 1 },
  colors: ['U', 'R'],
  subtypes: ['Dragon'],
  power: 4,
  toughness: 4,
  keywords: ['flying', 'haste'],
  abilities: [
    {
      kind: 'staticPlayerRule',
      players: 'controller',
      rule: 'castSpellsAsThoughFlash',
      spellFilter: { cardTypes: ['sorcery'] },
      flashTimingReminder: true,
    },
  ],
});
const PROBE_EFFECT = [{ kind: 'gainLife' as const, amount: 1, target: { kind: 'noTarget' as const } }];
const INSTANT = castable(instant('Casting Rule Instant', PROBE_EFFECT, { generic: 2, U: 1 }));
const SORCERY = castable(sorcery('Casting Rule Sorcery', PROBE_EFFECT, { generic: 2, R: 1 }));
const CREATURE = castable(creature('Casting Rule Creature', 2, 2, { cost: { generic: 2, R: 1 } }));

function castNames(state: GameState, player: 0 | 1): readonly string[] {
  return legalActions(state)
    .filter(
      (action): action is Extract<Action, { type: 'castSpell' }> =>
        action.type === 'castSpell' && action.player === player,
    )
    .map((action) => state.objects[action.oid]?.card.name)
    .filter((name): name is string => name !== undefined)
    .sort();
}

describe('Goblin Electromancer', () => {
  it('reduces either named spell type, stacks, preserves colored pips, and ignores creatures', () => {
    const start = scenario({
      battlefield: [
        { card: ELECTROMANCER, controller: 0 },
        { card: ELECTROMANCER, controller: 0 },
      ],
      hands: [[INSTANT, SORCERY, CREATURE], []],
    });
    expect(effectiveManaCost(start.state, 0, INSTANT)).toEqual({ ...INSTANT.manaCost, generic: 0 });
    expect(effectiveManaCost(start.state, 0, SORCERY)).toEqual({ ...SORCERY.manaCost, generic: 0 });
    expect(effectiveManaCost(start.state, 0, CREATURE)).toEqual(CREATURE.manaCost);
  });

  it('expires only the modifier registered by the departed incarnation', () => {
    const start = scenario({
      battlefield: [
        { card: ELECTROMANCER, controller: 0 },
        { card: ELECTROMANCER, controller: 0 },
      ],
      hands: [[SORCERY], []],
    });
    const sources = Object.values(start.state.objects)
      .filter((object) => object.card.name === ELECTROMANCER.name)
      .map((object) => object.oid);
    const departed = sources[0];
    if (departed === undefined) throw new Error('missing Electromancer source');
    const moved = moveObject(beginTrace(start.state), departed, 'graveyard');
    expect(moved.state.costModifiers).toHaveLength(1);
    expect(effectiveManaCost(moved.state, 0, SORCERY).generic).toBe(1);
  });
});

describe('Hypersonic Dragon', () => {
  function responseState(): GameState {
    const opened = scenario({
      active: 1,
      battlefield: [
        { card: HYPERSONIC_DRAGON, controller: 0 },
        ...lands(FOREST, 3).map((card) => ({ card, controller: 0 as const })),
        { card: ISLAND, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[INSTANT, SORCERY, CREATURE], []],
    });
    return apply(opened, { type: 'passPriority', player: 1 }).state;
  }

  it('grants only its controller sorcery timing during an opponent priority window', () => {
    const state = responseState();
    expect(castNames(state, 0)).toEqual(['Casting Rule Instant', 'Casting Rule Sorcery']);
    expect(renderOracleText(HYPERSONIC_DRAGON)).toBe(
      'Flying, haste\nYou may cast sorcery spells as though they had flash. (You may cast them any time you could cast an instant.)',
    );
  });

  it('withdraws the permission immediately when its source leaves', () => {
    const state = responseState();
    const moved = moveObject(beginTrace(state), oidOf(state, HYPERSONIC_DRAGON.name), 'graveyard');
    expect(castNames(moved.state, 0)).toEqual(['Casting Rule Instant']);
  });
});
