import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { playerOf, reduce, reduceAll, scenario, type Action, type GameState, type Target } from '@mtg/kernel';
import { artifact, creature, MOUNTAIN, SWAMP } from './cards';

const RAKDOS_CHARM = parseCard({
  kind: 'instant',
  id: 'rtr-184-rakdos-charm-kernel',
  name: 'Rakdos Charm',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 184 },
  manaCost: { B: 1, R: 1 },
  colors: ['B', 'R'],
  effects: [],
  modes: [
    { effects: [{ kind: 'exileGraveyard', target: { kind: 'targetPlayer' } }] },
    {
      effects: [
        {
          kind: 'destroyPermanent',
          target: { kind: 'targetPermanent', filter: { cardTypes: ['artifact'] } },
        },
      ],
    },
    {
      effects: [
        {
          kind: 'dealDamage',
          amount: 1,
          target: { kind: 'noTarget' },
          scope: 'allPermanents',
          scopeFilter: { cardTypes: ['creature'] },
          eachScopedPermanentDealsToItsController: true,
        },
      ],
    },
  ],
} as unknown as CardInput);

const MINE = creature('Rakdos Buried Mine', 1, 1);
const THEIRS = creature('Rakdos Buried Theirs', 2, 2);

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
    life: [20, 20],
    battlefield: [
      { card: SWAMP, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: creature('Rakdos Lifelinker', 2, 2, { keywords: ['lifelink'] }), controller: 0 },
      { card: creature('Rakdos Ally', 3, 3), controller: 0 },
      { card: artifact('Rakdos Relic'), controller: 0 },
      { card: creature('Rakdos Rival', 4, 4), controller: 1 },
    ],
    hands: [[RAKDOS_CHARM], []],
    graveyards: [[MINE], [THEIRS]],
  }).state;
}

describe('RTR #184 Rakdos Charm', () => {
  it("exiles only the chosen player's graveyard", () => {
    const resolved = castMode(board(), 0, [{ kind: 'player', player: 1 }]);

    expect(playerOf(resolved, 1).graveyard).toEqual([]);
    expect(playerOf(resolved, 0).graveyard.map((oid) => resolved.objects[oid]?.card.name)).toEqual([
      MINE.name,
      RAKDOS_CHARM.name,
    ]);
  });

  it('destroys only the artifact selected by its targeted mode', () => {
    const start = board();
    const relic = oidNamed(start, 'Rakdos Relic');
    const ally = oidNamed(start, 'Rakdos Ally');
    const resolved = castMode(start, 1, [{ kind: 'permanent', oid: relic }]);

    expect(resolved.objects[relic]?.zone).toBe('graveyard');
    expect(resolved.objects[ally]?.zone).toBe('battlefield');
  });

  it('makes every creature damage its current controller and preserves source lifelink', () => {
    const resolved = castMode(board(), 2, [null]);

    // The ordinary allied creature costs player 0 one life. The lifelinker also
    // hits player 0, then gains that same player one life from its own damage.
    expect(playerOf(resolved, 0).life).toBe(19);
    expect(playerOf(resolved, 1).life).toBe(19);
    expect(resolved.objects[oidNamed(resolved, 'Rakdos Relic')]?.damage).toBe(0);
  });
});
