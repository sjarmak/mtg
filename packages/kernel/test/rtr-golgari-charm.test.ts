import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  characteristicsOf,
  cleanupTurnEffects,
  destroyPermanent,
  playerOf,
  reduce,
  reduceAll,
  scenario,
  type Action,
  type GameState,
  type Target,
} from '@mtg/kernel';
import { artifact, creature, enchantment, FOREST, SWAMP } from './cards';

const GOLGARI_CHARM = parseCard({
  kind: 'instant',
  id: 'rtr-164-golgari-charm-kernel',
  name: 'Golgari Charm',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 164 },
  manaCost: { B: 1, G: 1 },
  colors: ['B', 'G'],
  effects: [],
  modes: [
    {
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: -1,
          toughness: -1,
          target: { kind: 'noTarget' },
          scope: 'allPermanents',
          scopeFilter: { cardTypes: ['creature'] },
        },
      ],
    },
    {
      effects: [
        {
          kind: 'destroyPermanent',
          target: { kind: 'targetPermanent', filter: { cardTypes: ['enchantment'] } },
        },
      ],
    },
    {
      effects: [
        {
          kind: 'regeneratePermanent',
          target: { kind: 'noTarget' },
          scope: 'permanentsYouControl',
          scopeFilter: { cardTypes: ['creature'] },
        },
      ],
    },
  ],
} as unknown as CardInput);

function pass(state: GameState): Action {
  const player = state.turn.priority;
  if (player === null) throw new Error('nobody has priority');
  return { type: 'passPriority', player };
}

function oidNamed(state: GameState, name: string): string {
  const oid = state.battlefield.find((candidate) => state.objects[candidate]?.card.name === name);
  if (oid === undefined) throw new Error(`no battlefield object named ${name}`);
  return oid;
}

function castMode(start: GameState, mode: number, targets: readonly (Target | null)[]): GameState {
  const oid = playerOf(start, 0).hand[0] ?? '';
  const cast = reduce(start, { type: 'castSpell', player: 0, oid, mode, targets });
  return reduceAll(cast.state, [pass(cast.state), { type: 'passPriority', player: 1 }]).state;
}

function board(): GameState {
  return scenario({
    battlefield: [
      { card: SWAMP, controller: 0 },
      { card: FOREST, controller: 0 },
      { card: creature('Charm Ally One', 3, 3), controller: 0 },
      { card: creature('Charm Ally Two', 4, 4), controller: 0 },
      { card: artifact('Charm Relic'), controller: 0 },
      { card: creature('Charm Rival', 3, 3), controller: 1 },
      { card: enchantment('Charm Ward'), controller: 1 },
    ],
    hands: [[GOLGARI_CHARM], []],
  }).state;
}

describe('RTR #164 Golgari Charm', () => {
  it('shrinks every creature for the turn and no noncreature permanent', () => {
    const start = board();
    const ally = oidNamed(start, 'Charm Ally One');
    const rival = oidNamed(start, 'Charm Rival');
    const relic = oidNamed(start, 'Charm Relic');
    const resolved = castMode(start, 0, [null]);

    expect(characteristicsOf(resolved, ally)).toMatchObject({ power: 2, toughness: 2 });
    expect(characteristicsOf(resolved, rival)).toMatchObject({ power: 2, toughness: 2 });
    expect(characteristicsOf(resolved, relic).cardTypes).toEqual(['artifact']);
    const cleaned = cleanupTurnEffects(beginTrace(resolved)).state;
    expect(characteristicsOf(cleaned, ally)).toMatchObject({ power: 3, toughness: 3 });
  });

  it('destroys only the enchantment selected by its targeted mode', () => {
    const start = board();
    const ward = oidNamed(start, 'Charm Ward');
    const rival = oidNamed(start, 'Charm Rival');
    const resolved = castMode(start, 1, [{ kind: 'permanent', oid: ward }]);

    expect(resolved.objects[ward]?.zone).toBe('graveyard');
    expect(resolved.objects[rival]?.zone).toBe('battlefield');
  });

  it('shields each creature the caster controls and no opposing or noncreature permanent', () => {
    const start = board();
    const first = oidNamed(start, 'Charm Ally One');
    const second = oidNamed(start, 'Charm Ally Two');
    const relic = oidNamed(start, 'Charm Relic');
    const rival = oidNamed(start, 'Charm Rival');
    const resolved = castMode(start, 2, [null]);

    expect(
      resolved.replacements
        .filter((replacement) => replacement.modification.kind === 'regenerate')
        .map((replacement) => replacement.sourceOid)
        .sort(),
    ).toEqual([first, second].sort());
    expect(resolved.replacements.some((replacement) => replacement.sourceOid === relic)).toBe(false);
    expect(resolved.replacements.some((replacement) => replacement.sourceOid === rival)).toBe(false);

    const savedFirst = destroyPermanent(beginTrace(resolved), first, 'destroyEffect');
    const savedSecond = destroyPermanent(savedFirst, second, 'destroyEffect');
    const deadRival = destroyPermanent(savedSecond, rival, 'destroyEffect');
    expect(deadRival.state.objects[first]?.zone).toBe('battlefield');
    expect(deadRival.state.objects[second]?.zone).toBe('battlefield');
    expect(deadRival.state.objects[rival]?.zone).toBe('graveyard');
  });
});
