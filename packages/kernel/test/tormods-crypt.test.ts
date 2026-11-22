/** Native target selection and resolution for M13 #219, Tormod's Crypt. */
import { describe, expect, it } from 'vitest';
import { parseCard, type Card, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  eventsOfType,
  legalActions,
  moveObject,
  pendingDecision,
  playerOf,
  reduce,
  scenario,
  type Action,
  type GameState,
  type ObjectId,
  type PlayerId,
  type ReduceResult,
} from '@mtg/kernel';
import { creature } from './cards';
import { apply, oidOf } from './helpers';

const TORMOD_INPUT = {
  kind: 'artifact',
  id: 'm13-219-kernel',
  name: "Tormod's Crypt",
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 219 },
  manaCost: { generic: 0 },
  colors: [],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true, sacrificeSelf: true },
      effects: [{ kind: 'exileGraveyard', target: { kind: 'targetPlayer' } }],
    },
  ],
} as unknown as CardInput;

const LEYLINE = parseCard({
  kind: 'enchantment',
  id: 'm11-21-tormod-probe',
  name: 'Tormod Probe Leyline',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 21 },
  manaCost: { generic: 2, W: 2 },
  colors: ['W'],
  abilities: [{ kind: 'staticPlayerRule', players: 'controller', rule: 'hasHexproof' }],
});

const MINE = creature('Tormod Mine', 1, 1);
const THEIRS = creature('Tormod Theirs', 2, 2);

function tormod(): Card {
  return parseCard(TORMOD_INPUT);
}

function activations(
  state: GameState,
  source: ObjectId,
): readonly Extract<Action, { type: 'activateAbility' }>[] {
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' && action.oid === source,
  );
}

function aimedAt(
  state: GameState,
  source: ObjectId,
  player: PlayerId,
): Extract<Action, { type: 'activateAbility' }> {
  const action = activations(state, source).find(
    (candidate) => candidate.targets[0]?.kind === 'player' && candidate.targets[0].player === player,
  );
  if (action === undefined) throw new Error(`Tormod did not offer player ${String(player)}`);
  return action;
}

function resolve(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 8; guard += 1) {
    if (current.state.stack.length === 0) return current;
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error('Tormod probe lost priority');
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Tormod probe did not empty the stack');
}

describe("Tormod's Crypt target selection", () => {
  it('offers either player and excludes an opposing player with hexproof', () => {
    const open = scenario({ battlefield: [{ card: tormod(), controller: 0 }] });
    const source = oidOf(open.state, "Tormod's Crypt");
    expect(activations(open.state, source).map((action) => action.targets[0])).toEqual([
      { kind: 'player', player: 0 },
      { kind: 'player', player: 1 },
    ]);

    const protectedOpen = scenario({
      battlefield: [
        { card: tormod(), controller: 0 },
        { card: LEYLINE, controller: 1 },
      ],
    });
    const protectedSource = oidOf(protectedOpen.state, "Tormod's Crypt");
    expect(activations(protectedOpen.state, protectedSource).map((action) => action.targets[0])).toEqual([
      { kind: 'player', player: 0 },
    ]);
  });
});

describe("Tormod's Crypt resolution", () => {
  it.each([
    { target: 0 as const, emptied: 0 as const, spared: 1 as const, sparedCount: 1 },
    { target: 1 as const, emptied: 1 as const, spared: 0 as const, sparedCount: 2 },
  ])('empties player $target and spares the other graveyard', ({ target, emptied, spared, sparedCount }) => {
    const open = scenario({
      battlefield: [{ card: tormod(), controller: 0 }],
      graveyards: [[MINE], [THEIRS]],
    });
    const source = oidOf(open.state, "Tormod's Crypt");
    const done = resolve(reduce(open.state, aimedAt(open.state, source, target)));

    expect(playerOf(done.state, emptied).graveyard).toEqual([]);
    expect(done.state.exile.length).toBeGreaterThanOrEqual(1);
    expect(playerOf(done.state, spared).graveyard).toHaveLength(sparedCount);
    expect(done.state.stack).toEqual([]);
  });

  it('resolves after the tap-and-sacrifice cost removed its source', () => {
    const open = scenario({
      battlefield: [{ card: tormod(), controller: 0 }],
      graveyards: [[], [THEIRS]],
    });
    const source = oidOf(open.state, "Tormod's Crypt");
    const activated = reduce(open.state, aimedAt(open.state, source, 1));

    expect(activated.state.objects[source]?.zone).toBe('graveyard');
    expect(activated.state.objects[source]?.tapped).toBe(false);
    expect(activated.state.stack).toHaveLength(1);

    const done = resolve(activated);
    expect(playerOf(done.state, 1).graveyard).toEqual([]);
    expect(done.state.objects[source]?.zone).toBe('graveyard');
  });

  it('does nothing successfully to an empty graveyard', () => {
    const open = scenario({ battlefield: [{ card: tormod(), controller: 0 }], graveyards: [[], []] });
    const source = oidOf(open.state, "Tormod's Crypt");
    const done = resolve(reduce(open.state, aimedAt(open.state, source, 1)));

    expect(playerOf(done.state, 1).graveyard).toEqual([]);
    expect(done.state.exile).toEqual([]);
    expect(eventsOfType(done.events, 'effectSkipped')).toEqual([]);
  });

  it('fizzles when the chosen player gains hexproof before resolution', () => {
    const open = scenario({
      battlefield: [{ card: tormod(), controller: 0 }],
      hands: [[], [LEYLINE]],
      graveyards: [[], [THEIRS]],
    });
    const source = oidOf(open.state, "Tormod's Crypt");
    const activated = reduce(open.state, aimedAt(open.state, source, 1));
    const leyline = playerOf(activated.state, 1).hand[0];
    if (leyline === undefined) throw new Error('Tormod probe lost Leyline');
    const protectedTrace = moveObject(beginTrace(activated.state), leyline, 'battlefield', {
      controller: 1,
    });
    const done = resolve({
      state: protectedTrace.state,
      events: [...activated.events, ...protectedTrace.events],
    });

    expect(playerOf(done.state, 1).graveyard).toHaveLength(1);
    expect(done.state.exile).toEqual([]);
    expect(eventsOfType(done.events, 'effectSkipped')).toEqual([
      expect.objectContaining({ index: 0, why: 'target is no longer legal' }),
    ]);
  });
});
