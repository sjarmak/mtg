/** Native resolution of a targeted game-loss effect. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  eventsOfType,
  legalActions,
  pendingDecision,
  reduce,
  scenario,
  type Action,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { FOREST, ISLAND, MOUNTAIN, PLAINS, SWAMP, lands } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const DOOR = parseCard({
  kind: 'artifact',
  id: 'm13-203-door-kernel',
  name: 'Door to Nothingness',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 203 },
  manaCost: { generic: 5 },
  colors: [],
  entryReplacement: { kind: 'entersTapped' },
  abilities: [
    {
      kind: 'activated',
      cost: {
        mana: { W: 2, U: 2, B: 2, R: 2, G: 2 },
        tapSelf: true,
        sacrificeSelf: true,
      },
      effects: [{ kind: 'loseGame', target: { kind: 'targetPlayer' } }],
    },
  ],
} as unknown as CardInput);

const PLATINUM_ANGEL = parseCard({
  kind: 'creature',
  id: 'm11-212-door-probe',
  name: 'Door Probe Angel',
  rarity: 'mythic',
  set: { code: 'M11', collectorNumber: 212 },
  manaCost: { generic: 7 },
  colors: [],
  artifact: true,
  power: 4,
  toughness: 4,
  subtypes: ['Angel'],
  keywords: ['flying'],
  abilities: [{ kind: 'staticGameRule', rule: 'controllerCantLoseAndOpponentsCantWin' }],
});

const TERMINAL_SPELL = parseCard({
  kind: 'sorcery',
  id: 'tst-terminal-game-loss',
  name: 'Terminal Game Loss',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { B: 1 },
  colors: ['B'],
  effects: [
    { kind: 'loseGame', target: { kind: 'targetPlayer' } },
    { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
  ],
});

const MANA = [
  ...lands(PLAINS, 2),
  ...lands(ISLAND, 2),
  ...lands(SWAMP, 2),
  ...lands(MOUNTAIN, 2),
  ...lands(FOREST, 2),
];

function activation(
  state: GameState,
  source: ObjectId,
  target: 0 | 1,
): Extract<Action, { type: 'activateAbility' }> {
  const action = legalActions(state).find(
    (candidate): candidate is Extract<Action, { type: 'activateAbility' }> =>
      candidate.type === 'activateAbility' &&
      candidate.oid === source &&
      candidate.targets[0]?.kind === 'player' &&
      candidate.targets[0].player === target,
  );
  if (action === undefined) throw new Error(`Door did not offer player ${String(target)}`);
  return action;
}

function resolve(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 8; guard += 1) {
    if (current.state.stack.length === 0 || current.state.result !== null) return current;
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error('Door probe lost priority');
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Door probe did not resolve');
}

function board(protectedTarget = false): ReduceResult {
  return scenario({
    battlefield: [
      { card: DOOR, controller: 0 },
      ...MANA.map((card) => ({ card, controller: 0 as const })),
      ...(protectedTarget ? [{ card: PLATINUM_ANGEL, controller: 1 as const }] : []),
    ],
  });
}

describe('targeted game loss in the kernel', () => {
  it('ends resolution immediately without moving the spell or applying later effects', () => {
    const open = scenario({
      battlefield: [{ card: SWAMP, controller: 0 }],
      hands: [[TERMINAL_SPELL], []],
      libraries: [[PLAINS], [ISLAND]],
    });
    const spellOid = handOidOf(open.state, 0, TERMINAL_SPELL.name);
    const cast = legalActions(open.state).find(
      (candidate): candidate is Extract<Action, { type: 'castSpell' }> =>
        candidate.type === 'castSpell' &&
        candidate.oid === spellOid &&
        candidate.targets[0]?.kind === 'player' &&
        candidate.targets[0].player === 1,
    );
    if (cast === undefined) throw new Error('terminal spell did not offer player 1');

    const done = resolve(reduce(open.state, cast));
    const gameEnded = done.events.findIndex((event) => event.type === 'gameEnded');

    expect(gameEnded).toBeGreaterThanOrEqual(0);
    expect(done.events.slice(gameEnded + 1)).toEqual([]);
    expect(eventsOfType(done.events, 'cardDrawn')).toEqual([]);
    expect(done.state.objects[spellOid]?.zone).toBe('stack');
  });

  it('pays every cost before the target loses and emits the explicit reason', () => {
    const open = board();
    const source = oidOf(open.state, DOOR.name);
    const activated = reduce(open.state, activation(open.state, source, 1));

    expect(activated.state.objects[source]?.zone).toBe('graveyard');
    expect(activated.state.stack).toHaveLength(1);

    const done = resolve(activated);
    expect(done.state.result).toEqual({
      winner: 0,
      loser: 1,
      reason: 'spellOrAbility',
      endedOnTurn: 2,
    });
    expect(eventsOfType(done.events, 'playerLost')).toEqual([
      expect.objectContaining({ player: 1, reason: 'spellOrAbility' }),
    ]);
  });

  it('spends and sacrifices the source but cannot make a protected target lose', () => {
    const open = board(true);
    const source = oidOf(open.state, DOOR.name);
    const done = resolve(reduce(open.state, activation(open.state, source, 1)));

    expect(done.state.objects[source]?.zone).toBe('graveyard');
    expect(done.state.result).toBeNull();
    expect(done.state.players[1].lost).toBe(false);
    expect(eventsOfType(done.events, 'playerLost')).toEqual([]);
  });
});
