/** Exact live player-history and blocking-creature targets for RTR #192. */
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  gainLife,
  legalActions,
  loseLife,
  opponentOf,
  pendingDecision,
  powerOf,
  scenario,
  toughnessOf,
  type Action,
  type GameState,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { beginTurn } from '../src/turn';
import { creature, lands, MOUNTAIN, SWAMP } from './cards';
import { apply, oidOf } from './helpers';

const RIX_MAADI = parseCard({
  kind: 'creature',
  id: 'rtr-192-rix-maadi-guildmage-kernel',
  name: 'Rix Maadi Guildmage',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 192 },
  manaCost: { B: 1, R: 1 },
  colors: ['B', 'R'],
  subtypes: ['Human', 'Shaman'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { B: 1, R: 1 } },
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: -1,
          toughness: -1,
          target: { kind: 'targetCreature', filter: { combat: 'blocking' } },
        },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: { B: 1, R: 1 } },
      effects: [
        {
          kind: 'loseLife',
          amount: 1,
          target: {
            kind: 'targetPlayer',
            restriction: { kind: 'playerLostLifeThisTurn' },
          },
        },
      ],
    },
  ],
} as CardInput);

const ATTACKER = creature('Rix Maadi Attacker', 3, 3);
const BLOCKER = creature('Rix Maadi Blocker', 2, 2);
const IDLE = creature('Rix Maadi Idle Creature', 2, 2);

function activationActions(
  state: GameState,
  abilityIndex: number,
): readonly Extract<Action, { type: 'activateAbility' }>[] {
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' &&
      action.oid === oidOf(state, RIX_MAADI.name) &&
      action.abilityIndex === abilityIndex,
  );
}

function resolveTop(current: ReduceResult): ReduceResult {
  for (let guard = 0; guard < 4 && current.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error('Rix Maadi stack lost priority');
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  return current;
}

function afterBlocks(): GameState {
  const start = scenario({
    battlefield: [
      { card: ATTACKER, controller: 0 },
      { card: RIX_MAADI, controller: 0 },
      { card: SWAMP, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: BLOCKER, controller: 1 },
      { card: IDLE, controller: 1 },
    ],
    active: 0,
    turn: 4,
    step: 'declareAttackers',
  });
  let current = apply(start, {
    type: 'declareAttackers',
    player: 0,
    attackers: [{ oid: oidOf(start.state, ATTACKER.name), defender: opponentOf(0) }],
  });
  for (let guard = 0; guard < 8; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind === 'declareBlockers') break;
    if (decision?.kind !== 'priority') throw new Error('combat did not reach blockers');
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  return apply(current, {
    type: 'declareBlockers',
    player: 1,
    blocks: [{ blocker: oidOf(current.state, BLOCKER.name), attacker: oidOf(current.state, ATTACKER.name) }],
  }).state;
}

function lifeBoard(): ReduceResult {
  return scenario({
    battlefield: [
      { card: RIX_MAADI, controller: 0 },
      ...lands(SWAMP, 2).map((card) => ({ card, controller: 0 as const })),
      ...lands(MOUNTAIN, 2).map((card) => ({ card, controller: 0 as const })),
    ],
  });
}

describe('Rix Maadi Guildmage in the kernel', () => {
  it('offers the first activation only on the creature actually blocking, then shrinks it', () => {
    const state = afterBlocks();
    const blocker = oidOf(state, BLOCKER.name);
    const idle = oidOf(state, IDLE.name);
    const actions = activationActions(state, 0);

    expect(actions.map(({ targets }) => targets)).toEqual([[{ kind: 'permanent', oid: blocker }]]);
    expect(actions.flatMap(({ targets }) => targets)).not.toContainEqual({ kind: 'permanent', oid: idle });

    const chosen = actions[0];
    if (chosen === undefined) throw new Error('blocking-creature activation was not offered');
    const done = resolveTop(apply({ state, events: [] }, chosen));
    expect(powerOf(done.state, blocker)).toBe(1);
    expect(toughnessOf(done.state, blocker)).toBe(1);
  });

  it('offers the second activation only for players with positive life lost this turn', () => {
    const start = lifeBoard();
    expect(activationActions(start.state, 1)).toEqual([]);

    const opponentLost = loseLife(beginTrace(start.state), 1, 3);
    expect(activationActions(opponentLost.state, 1).map(({ targets }) => targets)).toEqual([
      [{ kind: 'player', player: 1 }],
    ]);

    const bothLost = loseLife(opponentLost, 0, 2);
    expect(activationActions(bothLost.state, 1).map(({ targets }) => targets)).toEqual([
      [{ kind: 'player', player: 0 }],
      [{ kind: 'player', player: 1 }],
    ]);
  });

  it('counts direct life loss, keeps eligibility after gain, loses one more life, and resets next turn', () => {
    const start = lifeBoard();
    const lost = loseLife(beginTrace(start.state), 1, 2);
    const regained = gainLife(lost, 1, 5, false);
    const action = activationActions(regained.state, 1)[0];
    if (action === undefined) throw new Error('life-qualified activation was not offered');

    const before = regained.state.players[1].life;
    const done = resolveTop(apply({ state: regained.state, events: [] }, action));
    expect(done.state.players[1].life).toBe(before - 1);

    const next = beginTurn(beginTrace(done.state), 1);
    expect(activationActions(next.state, 1)).toEqual([]);
  });
});
