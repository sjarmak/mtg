/** M13's Ring cycle through late-bound Equipment-host resolution. */
import { describe, expect, it } from 'vitest';
import { isAttachingAbility, parseCard, type Card, type Color, type Keyword } from '@mtg/dsl';
import {
  beginTrace,
  collectTriggers,
  destroyPermanent,
  eligibleAttackers,
  eventsOfType,
  hasKeyword,
  hasKeywordAbility,
  legalActions,
  moveObject,
  objectFilter,
  putTriggersOnStack,
  resolveTop,
  scenario,
  targetChoicesFor,
  type Action,
  type ContinuousEffect,
  type GameState,
  type ObjectId,
  type Trace,
} from '@mtg/kernel';
import { attachTo, unattach } from '../src/attach';
import { creature, FOREST, instant, lands } from './cards';
import { apply, oidOf, playCombat } from './helpers';

function ring(
  name: string,
  color: Color,
  grant: Keyword | null,
  distinct: 'hexproof' | 'regenerate' | null = null,
): Card {
  const equip = {
    kind: 'activated' as const,
    cost: { mana: { generic: 1 } },
    attach: { modifications: grant === null ? [] : [{ kind: 'grantKeyword' as const, keyword: grant }] },
    effects: [],
  };
  const upkeep = {
    kind: 'triggered' as const,
    condition: 'beginningOfYourUpkeep' as const,
    effects: [
      {
        kind: 'putCounters' as const,
        counter: 'plusOnePlusOne' as const,
        count: 1,
        target: { kind: 'equippedCreature' as const },
        recipientCondition: { kind: 'hasColor' as const, color },
      },
    ],
  };
  const distinctAbility =
    distinct === 'hexproof'
      ? {
          kind: 'activated' as const,
          cost: { mana: { generic: 2 } },
          effects: [
            {
              kind: 'grantKeywordUntilEndOfTurn' as const,
              keyword: 'hexproof' as const,
              target: { kind: 'equippedCreature' as const },
            },
          ],
        }
      : distinct === 'regenerate'
        ? {
            kind: 'activated' as const,
            cost: { mana: { generic: 2 } },
            effects: [
              { kind: 'regeneratePermanent' as const, target: { kind: 'equippedCreature' as const } },
            ],
          }
        : null;
  return parseCard({
    kind: 'artifact',
    id: `tst-${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`,
    name,
    rarity: 'uncommon',
    set: { code: 'M13', collectorNumber: 211 },
    manaCost: { generic: 2 },
    subtypes: ['Equipment'],
    abilities: distinctAbility === null ? [equip, upkeep] : [distinctAbility, upkeep, equip],
  });
}

const BLUE_RING = ring('Ring of Evos Isle', 'U', null, 'hexproof');
const GREEN_RING = ring('Ring of Kalonia', 'G', 'trample');
const WHITE_RING = ring('Ring of Thune', 'W', 'vigilance');
const RED_RING = ring('Ring of Valkas', 'R', 'haste');
const BLACK_RING = ring('Ring of Xathrid', 'B', null, 'regenerate');
const BLUE = creature('Blue Host', 2, 2, { cost: { U: 1 } });
const GREEN = creature('Green Host', 2, 2, { cost: { G: 1 } });
const MULTICOLOR = parseCard({
  kind: 'creature',
  id: 'tst-multicolor-host',
  name: 'Multicolor Host',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { U: 1, G: 1 },
  colors: ['U', 'G'],
  power: 2,
  toughness: 2,
});
const HOSTILE_TARGET = instant(
  'White Damage',
  [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
  { generic: 1 },
);

function equipAbility(card: Card) {
  const ability = card.abilities.find(isAttachingAbility);
  if (ability === undefined) throw new Error(`${card.name} lost Equip`);
  return ability;
}

function attachedBoard(card: Card, host: Card = BLUE): { state: GameState; ring: ObjectId; host: ObjectId } {
  const state = scenario({
    battlefield: [
      { card, controller: 0 },
      { card: host, controller: 0 },
      ...[BLUE, GREEN, MULTICOLOR]
        .filter((candidate) => candidate.id !== host.id)
        .map((candidate) => ({ card: candidate, controller: 0 as const })),
    ],
  }).state;
  const ringOid = oidOf(state, card.name);
  const hostOid = oidOf(state, host.name);
  return {
    state: attachTo(beginTrace(state), ringOid, hostOid, equipAbility(card)).state,
    ring: ringOid,
    host: hostOid,
  };
}

interface ActivatedBoard {
  readonly activated: Trace;
  readonly action: Extract<Action, { type: 'activateAbility' }>;
  readonly ring: ObjectId;
  readonly oldHost: ObjectId;
  readonly newHost: ObjectId;
}

function activateDistinct(card: Card): ActivatedBoard {
  const start = scenario({
    active: 0,
    turn: 2,
    step: 'precombatMain',
    battlefield: [
      { card, controller: 0 },
      { card: BLUE, controller: 0 },
      { card: GREEN, controller: 0 },
      ...lands(FOREST, 2).map((land) => ({ card: land, controller: 0 as const })),
    ],
  });
  const ringOid = oidOf(start.state, card.name);
  const oldHost = oidOf(start.state, BLUE.name);
  const newHost = oidOf(start.state, GREEN.name);
  const attached = attachTo(start, ringOid, oldHost, equipAbility(card));
  const distinctIndex = card.abilities.findIndex(
    (ability) => ability.kind === 'activated' && !isAttachingAbility(ability),
  );
  const action = legalActions(attached.state).find(
    (candidate): candidate is Extract<Action, { type: 'activateAbility' }> =>
      candidate.type === 'activateAbility' &&
      candidate.oid === ringOid &&
      candidate.abilityIndex === distinctIndex,
  );
  if (action === undefined) throw new Error(`${card.name} did not offer its distinct activation`);
  return { activated: apply(attached, action), action, ring: ringOid, oldHost, newHost };
}

function upkeepTriggers(state: GameState, active: 0 | 1) {
  const event = { type: 'stepBegan', turn: state.turn.number, step: 'upkeep', active } as const;
  const trace: Trace = { state, events: [event], eventStates: [state] };
  return collectTriggers(trace, 0);
}

function stackUpkeep(state: GameState): Trace {
  return putTriggersOnStack(beginTrace(state), upkeepTriggers(state, 0));
}

function withColors(state: GameState, oid: ObjectId, colors: readonly Color[]): GameState {
  const timestamp = state.nextId;
  const effect: ContinuousEffect = {
    id: `continuous:${String(timestamp)}`,
    kind: 'colorChange',
    layer: '5',
    affects: objectFilter({ oids: [oid] }),
    setColors: [...colors],
    addColors: [],
    duration: 'endOfTurn',
    timestamp,
    sourceOid: oid,
    enabledWhile: null,
  };
  return { ...state, nextId: timestamp + 1, continuous: [...state.continuous, effect] };
}

function withController(state: GameState, oid: ObjectId, controller: 0 | 1): GameState {
  const timestamp = state.nextId;
  const effect: ContinuousEffect = {
    id: `continuous:${String(timestamp)}`,
    kind: 'control',
    layer: '2',
    affects: objectFilter({ oids: [oid] }),
    controller,
    duration: 'endOfTurn',
    timestamp,
    sourceOid: oid,
    enabledWhile: null,
  };
  return { ...state, nextId: timestamp + 1, continuous: [...state.continuous, effect] };
}

describe('M13 Ring upkeep resolution', () => {
  it('offers the controller trigger unconditionally, never on the opponent upkeep', () => {
    const { state, ring: ringOid, host } = attachedBoard(BLUE_RING, GREEN);
    expect(upkeepTriggers(state, 0).map(({ sourceOid, condition }) => [sourceOid, condition])).toEqual([
      [ringOid, 'beginningOfYourUpkeep'],
    ]);
    expect(upkeepTriggers(state, 1)).toEqual([]);

    const source = state.objects[ringOid];
    if (source === undefined) throw new Error('Ring disappeared');
    const { attachedTo: _host, ...unattached } = source;
    const detached = { ...state, objects: { ...state.objects, [ringOid]: unattached } };
    expect(upkeepTriggers(detached, 0)).toHaveLength(1);
    expect(resolveTop(stackUpkeep(detached)).state.objects[host]?.counters.plusOnePlusOne).toBe(0);
  });

  it('uses the live layered color and current host only when the trigger resolves', () => {
    const { state, ring: ringOid, host: oldHost } = attachedBoard(BLUE_RING, BLUE);
    const newHost = oidOf(state, GREEN.name);
    const stacked = stackUpkeep(state);
    const recolored = withColors(stacked.state, newHost, ['U']);
    const moved = attachTo({ ...stacked, state: recolored }, ringOid, newHost, equipAbility(BLUE_RING));
    const done = resolveTop(moved);

    expect(done.state.objects[oldHost]?.counters.plusOnePlusOne).toBe(0);
    expect(done.state.objects[newHost]?.counters.plusOnePlusOne).toBe(1);
  });

  it('matches mono- and multicolor hosts once each and no-ops on a nonmatch', () => {
    for (const host of [BLUE, MULTICOLOR]) {
      const board = attachedBoard(BLUE_RING, host);
      const done = resolveTop(stackUpkeep(board.state));
      expect(done.state.objects[board.host]?.counters.plusOnePlusOne, host.name).toBe(1);
    }
    const nonmatch = attachedBoard(BLUE_RING, GREEN);
    const done = resolveTop(stackUpkeep(nonmatch.state));
    expect(done.state.objects[nonmatch.host]?.counters.plusOnePlusOne).toBe(0);
  });

  it('keeps resolving through a host control change because Equipment attachment remains legal', () => {
    const board = attachedBoard(BLUE_RING, BLUE);
    const stacked = stackUpkeep(board.state);
    const stolen = { ...stacked, state: withController(stacked.state, board.host, 1) };

    expect(resolveTop(stolen).state.objects[board.host]?.counters.plusOnePlusOne).toBe(1);
  });

  it('no-ops when detached, the source leaves, or the host leaves before resolution', () => {
    const detached = attachedBoard(BLUE_RING);
    const sourceGone = moveObject(stackUpkeep(detached.state), detached.ring, 'graveyard');
    expect(resolveTop(sourceGone).state.objects[detached.host]?.counters.plusOnePlusOne).toBe(0);

    const hostGone = attachedBoard(BLUE_RING);
    const moved = moveObject(stackUpkeep(hostGone.state), hostGone.host, 'graveyard');
    expect(resolveTop(moved).state.objects[hostGone.host]?.counters.plusOnePlusOne).toBe(0);
  });

  it('rejects a new source incarnation even if the Ring returns and reattaches before resolution', () => {
    const board = attachedBoard(BLUE_RING);
    const stacked = stackUpkeep(board.state);
    const left = moveObject(stacked, board.ring, 'exile');
    const returned = moveObject(left, board.ring, 'battlefield', { controller: 0 });
    const reattached = attachTo(returned, board.ring, board.host, equipAbility(BLUE_RING));

    expect(resolveTop(reattached).state.objects[board.host]?.counters.plusOnePlusOne).toBe(0);
  });
});

describe('the three static Ring grants', () => {
  it.each([
    [GREEN_RING, 'trample'],
    [WHITE_RING, 'vigilance'],
    [RED_RING, 'haste'],
  ] as const)(
    '$0 follows the current host through the generic layer-6 attachment effect',
    (ringCard, keyword) => {
      const board = attachedBoard(ringCard, BLUE);
      const nextHost = oidOf(board.state, GREEN.name);
      expect(hasKeyword(board.state, board.host, keyword)).toBe(true);

      const moved = attachTo(beginTrace(board.state), board.ring, nextHost, equipAbility(ringCard));
      expect(hasKeyword(moved.state, board.host, keyword)).toBe(false);
      expect(hasKeyword(moved.state, nextHost, keyword)).toBe(true);
    },
  );

  it('Thune vigilance changes combat by leaving the equipped attacker untapped', () => {
    const start = scenario({
      active: 0,
      step: 'declareAttackers',
      battlefield: [
        { card: WHITE_RING, controller: 0 },
        { card: BLUE, controller: 0 },
      ],
    });
    const ringOid = oidOf(start.state, WHITE_RING.name);
    const host = oidOf(start.state, BLUE.name);
    const attached = attachTo(start, ringOid, host, equipAbility(WHITE_RING));
    const done = playCombat(attached, { attackers: [host] });

    expect(done.state.objects[host]?.tapped).toBe(false);
  });

  it('Valkas haste moves attack eligibility with the Ring between summoning-sick hosts', () => {
    const start = scenario({
      active: 0,
      step: 'declareAttackers',
      battlefield: [
        { card: RED_RING, controller: 0 },
        { card: BLUE, controller: 0, summoningSick: true },
        { card: GREEN, controller: 0, summoningSick: true },
      ],
    });
    const ringOid = oidOf(start.state, RED_RING.name);
    const oldHost = oidOf(start.state, BLUE.name);
    const newHost = oidOf(start.state, GREEN.name);
    const first = attachTo(start, ringOid, oldHost, equipAbility(RED_RING));
    expect(eligibleAttackers(first.state)).toContain(oldHost);
    expect(eligibleAttackers(first.state)).not.toContain(newHost);

    const moved = attachTo(first, ringOid, newHost, equipAbility(RED_RING));
    expect(eligibleAttackers(moved.state)).not.toContain(oldHost);
    expect(eligibleAttackers(moved.state)).toContain(newHost);
  });
});

describe('the two activated Ring abilities', () => {
  it('Evos Isle pays {2} without a target and grants live-host hexproof that blocks an opponent', () => {
    const board = activateDistinct(BLUE_RING);
    expect(board.action.targets).toEqual([null]);
    const forests = board.activated.state.battlefield.filter(
      (oid) => board.activated.state.objects[oid]?.card.name === FOREST.name,
    );
    expect(forests).toHaveLength(2);
    expect(forests.every((oid) => board.activated.state.objects[oid]?.tapped === true)).toBe(true);

    const moved = attachTo(board.activated, board.ring, board.newHost, equipAbility(BLUE_RING));
    const done = resolveTop(moved);
    expect(hasKeywordAbility(done.state, board.oldHost, 'hexproof')).toBe(false);
    expect(hasKeywordAbility(done.state, board.newHost, 'hexproof')).toBe(true);
    expect(targetChoicesFor(done.state, HOSTILE_TARGET, 1)[0]).not.toContainEqual({
      kind: 'permanent',
      oid: board.newHost,
    });
    expect(targetChoicesFor(done.state, HOSTILE_TARGET, 0)[0]).toContainEqual({
      kind: 'permanent',
      oid: board.newHost,
    });
  });

  it('Xathrid pays {2} without a target and its live-host shield performs regeneration', () => {
    const board = activateDistinct(BLACK_RING);
    expect(board.action.targets).toEqual([null]);
    const moved = attachTo(board.activated, board.ring, board.newHost, equipAbility(BLACK_RING));
    const hostObject = moved.state.objects[board.newHost];
    if (hostObject === undefined) throw new Error('Xathrid host disappeared');
    const wounded: Trace = {
      ...moved,
      state: {
        ...moved.state,
        objects: {
          ...moved.state.objects,
          [board.newHost]: { ...hostObject, damage: 1 },
        },
        combat: {
          ...moved.state.combat,
          attacks: [{ oid: board.newHost, defender: 1 }],
        },
      },
    };
    const resolved = resolveTop(wounded);
    const destroyedOld = destroyPermanent(resolved, board.oldHost, 'destroyEffect');
    const destroyedNew = destroyPermanent(destroyedOld, board.newHost, 'destroyEffect');

    expect(destroyedNew.state.objects[board.oldHost]?.zone).toBe('graveyard');
    expect(destroyedNew.state.objects[board.newHost]?.zone).toBe('battlefield');
    expect(destroyedNew.state.objects[board.newHost]?.tapped).toBe(true);
    expect(destroyedNew.state.objects[board.newHost]?.damage).toBe(0);
    expect(destroyedNew.state.combat.attacks).not.toContainEqual(
      expect.objectContaining({ oid: board.newHost }),
    );
    expect(eventsOfType(destroyedNew.events, 'permanentRegenerated')).toEqual([
      { type: 'permanentRegenerated', oid: board.newHost },
    ]);
    expect(
      destroyedNew.state.replacements.some(
        (replacement) => replacement.trigger.kind === 'destroy' && replacement.trigger.oid === board.newHost,
      ),
    ).toBe(false);
  });

  it.each([
    ['detached', (board: ActivatedBoard) => unattach(board.activated, board.ring)],
    ['departed source', (board: ActivatedBoard) => moveObject(board.activated, board.ring, 'graveyard')],
    [
      'new source incarnation',
      (board: ActivatedBoard) => {
        const exiled = moveObject(board.activated, board.ring, 'exile');
        const returned = moveObject(exiled, board.ring, 'battlefield', { controller: 0 });
        return attachTo(returned, board.ring, board.oldHost, equipAbility(BLUE_RING));
      },
    ],
  ] as const)('Evos Isle becomes a no-op with a %s', (_label, change) => {
    const board = activateDistinct(BLUE_RING);
    const done = resolveTop(change(board));
    expect(hasKeywordAbility(done.state, board.oldHost, 'hexproof')).toBe(false);
  });

  it.each([
    ['detached', (board: ActivatedBoard) => unattach(board.activated, board.ring)],
    ['departed source', (board: ActivatedBoard) => moveObject(board.activated, board.ring, 'graveyard')],
    [
      'new source incarnation',
      (board: ActivatedBoard) => {
        const exiled = moveObject(board.activated, board.ring, 'exile');
        const returned = moveObject(exiled, board.ring, 'battlefield', { controller: 0 });
        return attachTo(returned, board.ring, board.oldHost, equipAbility(BLACK_RING));
      },
    ],
  ] as const)('Xathrid becomes a no-op with a %s', (_label, change) => {
    const board = activateDistinct(BLACK_RING);
    const done = resolveTop(change(board));
    const destroyed = destroyPermanent(done, board.oldHost, 'destroyEffect');
    expect(destroyed.state.objects[board.oldHost]?.zone).toBe('graveyard');
    expect(eventsOfType(destroyed.events, 'permanentRegenerated')).toEqual([]);
  });
});
