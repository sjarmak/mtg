import { describe, expect, it } from 'vitest';
import { parseCard, type Card, type CardInput } from '@mtg/dsl';
import {
  legalActions,
  pendingDecision,
  scenario,
  validateAction,
  type Action,
  type GameState,
  type ReduceResult,
} from '@mtg/kernel';
import { creature, instant, lands, SWAMP } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const LAUNCH_PARTY = parseCard({
  kind: 'instant',
  id: 'rtr-69-launch-party-kernel',
  name: 'Launch Party',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 69 },
  manaCost: { generic: 3, B: 1 },
  colors: ['B'],
  additionalCost: {
    sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } },
  },
  effects: [
    { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
    { kind: 'loseLife', amount: 2, target: { kind: 'thatCreaturesController' } },
  ],
} as unknown as CardInput);

const CONTROL_SHIFT = instant(
  'Launch Party Control Shift',
  [{ kind: 'gainControlUntilEndOfTurn', target: { kind: 'targetCreature' } }],
  { B: 1 },
);
const MURDER = instant(
  'Launch Party Murder Response',
  [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
  { B: 1 },
);
const OFFERING = creature('Launch Party Offering', 1, 1);
const SECOND_OFFERING = creature('Launch Party Second Offering', 2, 2);
const ENEMY_OFFERING = creature('Launch Party Enemy Offering', 3, 3);
const TARGET = creature('Launch Party Target', 4, 4);

function partyCasts(state: GameState): readonly Extract<Action, { type: 'castSpell' }>[] {
  const oid = handOidOf(state, 0, LAUNCH_PARTY.name);
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'castSpell' }> =>
      action.type === 'castSpell' && action.oid === oid,
  );
}

function settle(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 24; guard += 1) {
    if (current.state.stack.length === 0) return current;
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Launch Party stack did not settle');
}

function responseAt(start: ReduceResult, name: string, targetOid: string): ReduceResult {
  const spellOid = handOidOf(start.state, 0, name);
  const action = legalActions(start.state).find(
    (candidate): candidate is Extract<Action, { type: 'castSpell' }> =>
      candidate.type === 'castSpell' &&
      candidate.oid === spellOid &&
      candidate.targets[0]?.kind === 'permanent' &&
      candidate.targets[0].oid === targetOid,
  );
  if (action === undefined) throw new Error(`${name} was not offered against the target`);
  return apply(start, action);
}

function board(extraHand: readonly Card[] = []): ReduceResult {
  return scenario({
    active: 0,
    hands: [[LAUNCH_PARTY, ...extraHand], []],
    battlefield: [
      { card: OFFERING, controller: 0 },
      { card: SECOND_OFFERING, controller: 0 },
      { card: ENEMY_OFFERING, controller: 1 },
      { card: TARGET, controller: 1 },
      ...lands(SWAMP, 6).map((card) => ({ card, controller: 0 as const })),
    ],
  });
}

describe('RTR #69 Launch Party', () => {
  it('offers only controlled creature payments and rejects missing or opposing sacrifices', () => {
    const start = board();
    const spell = handOidOf(start.state, 0, LAUNCH_PARTY.name);
    const offering = oidOf(start.state, OFFERING.name);
    const second = oidOf(start.state, SECOND_OFFERING.name);
    const enemy = oidOf(start.state, ENEMY_OFFERING.name);
    const target = oidOf(start.state, TARGET.name);
    const land = start.state.battlefield.find((oid) => start.state.objects[oid]?.card.kind === 'land');
    if (land === undefined) throw new Error('Launch Party board has no land boundary');
    const actions = partyCasts(start.state);

    expect(new Set(actions.flatMap((action) => action.sacrifices ?? []))).toEqual(
      new Set([offering, second]),
    );
    expect(actions.some((action) => action.sacrifices?.includes(enemy))).toBe(false);
    expect(
      actions.some((action) => action.targets[0]?.kind === 'permanent' && action.targets[0].oid === land),
    ).toBe(false);
    expect(
      validateAction(start.state, {
        type: 'castSpell',
        player: 0,
        oid: spell,
        targets: [{ kind: 'permanent', oid: target }],
        sacrifices: [],
      }),
    ).not.toBeNull();
    expect(
      validateAction(start.state, {
        type: 'castSpell',
        player: 0,
        oid: spell,
        targets: [{ kind: 'permanent', oid: target }],
        sacrifices: [enemy],
      }),
    ).not.toBeNull();
    expect(
      validateAction(start.state, {
        type: 'castSpell',
        player: 0,
        oid: spell,
        targets: [{ kind: 'permanent', oid: land }],
        sacrifices: [offering],
      }),
    ).not.toBeNull();
  });

  it('pays the sacrifice before stacking, then destroys the target and drains its controller', () => {
    const start = board();
    const offering = oidOf(start.state, OFFERING.name);
    const target = oidOf(start.state, TARGET.name);
    const action = partyCasts(start.state).find(
      (candidate) =>
        candidate.sacrifices?.[0] === offering &&
        candidate.targets[0]?.kind === 'permanent' &&
        candidate.targets[0].oid === target,
    );
    if (action === undefined) throw new Error('Launch Party did not offer the chosen payment and target');

    const cast = apply(start, action);
    expect(cast.state.objects[offering]?.zone).toBe('graveyard');
    expect(cast.state.objects[target]?.zone).toBe('battlefield');
    expect(cast.state.stack).toHaveLength(1);

    const done = settle(cast);
    expect(done.state.objects[target]?.zone).toBe('graveyard');
    expect(done.state.players.map((player) => player.life)).toEqual([20, 18]);
  });

  it('charges the creature current controller after a response changes control', () => {
    const start = board([CONTROL_SHIFT]);
    const offering = oidOf(start.state, OFFERING.name);
    const target = oidOf(start.state, TARGET.name);
    const party = partyCasts(start.state).find(
      (action) =>
        action.sacrifices?.[0] === offering &&
        action.targets[0]?.kind === 'permanent' &&
        action.targets[0].oid === target,
    );
    if (party === undefined) throw new Error('Launch Party was not offered');

    const done = settle(responseAt(apply(start, party), CONTROL_SHIFT.name, target));
    expect(done.state.objects[target]?.zone).toBe('graveyard');
    expect(done.state.players.map((player) => player.life)).toEqual([18, 20]);
  });

  it('still drains the controller when indestructible stops the destruction', () => {
    const indestructible = creature('Launch Party Indestructible Target', 4, 4, {
      keywordAbilities: [{ kind: 'indestructible' }],
    });
    const start = scenario({
      active: 0,
      hands: [[LAUNCH_PARTY], []],
      battlefield: [
        { card: OFFERING, controller: 0 },
        { card: indestructible, controller: 1 },
        ...lands(SWAMP, 4).map((card) => ({ card, controller: 0 as const })),
      ],
    });
    const target = oidOf(start.state, indestructible.name);
    const action = partyCasts(start.state).find(
      (candidate) => candidate.targets[0]?.kind === 'permanent' && candidate.targets[0].oid === target,
    );
    if (action === undefined) throw new Error('Launch Party did not target the indestructible creature');

    const done = settle(apply(start, action));
    expect(done.state.objects[target]?.zone).toBe('battlefield');
    expect(done.state.players[1].life).toBe(18);
  });

  it('fizzles the linked life loss when the sole target leaves first', () => {
    const start = board([MURDER]);
    const offering = oidOf(start.state, OFFERING.name);
    const target = oidOf(start.state, TARGET.name);
    const party = partyCasts(start.state).find(
      (action) =>
        action.sacrifices?.[0] === offering &&
        action.targets[0]?.kind === 'permanent' &&
        action.targets[0].oid === target,
    );
    if (party === undefined) throw new Error('Launch Party was not offered');

    const done = settle(responseAt(apply(start, party), MURDER.name, target));
    expect(done.state.objects[offering]?.zone).toBe('graveyard');
    expect(done.state.objects[target]?.zone).toBe('graveyard');
    expect(done.state.players.map((player) => player.life)).toEqual([20, 20]);
  });

  it('is unavailable without a controlled creature to sacrifice', () => {
    const start = scenario({
      active: 0,
      hands: [[LAUNCH_PARTY], []],
      battlefield: [
        { card: TARGET, controller: 1 },
        ...lands(SWAMP, 4).map((card) => ({ card, controller: 0 as const })),
      ],
    });

    expect(partyCasts(start.state)).toEqual([]);
  });
});
