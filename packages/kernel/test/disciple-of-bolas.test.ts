/** Native M13 #88 sacrifice choice, LKI, linkage, and source-hostility probes. */
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  eventsOfType,
  legalActions,
  moveObject,
  pendingDecision,
  scenario,
  type Action,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, lands, SWAMP } from './cards';
import { onlyObject, pump, withContinuous } from './continuous-helpers';
import { apply, oidOf } from './helpers';

const SACRIFICED_POWER = { kind: 'sacrificedPermanentPowerThisResolution' } as const;

const DISCIPLE = parseCard({
  kind: 'creature',
  id: 'm13-088-disciple-of-bolas-kernel',
  name: 'Disciple of Bolas',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 88 },
  manaCost: { generic: 3, B: 1 },
  colors: ['B'],
  subtypes: ['Human', 'Wizard'],
  power: 2,
  toughness: 1,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [
        {
          kind: 'sacrificePermanent',
          filter: { cardTypes: ['creature'] },
          excludeSource: true,
          target: { kind: 'noTarget' },
        },
        { kind: 'gainLife', amount: SACRIFICED_POWER, target: { kind: 'noTarget' } },
        { kind: 'drawCards', count: SACRIFICED_POWER, target: { kind: 'noTarget' } },
      ],
    },
  ],
} as unknown as CardInput);

const BEAR = creature('Disciple Probe Bear', 2, 2, { subtypes: ['Bear'] });
const OTHER = creature('Disciple Probe Other', 1, 4);
const TOKEN = creature('Disciple Probe Token', 3, 3);
const DRAW = creature('Disciple Probe Draw', 1, 1);

function castDisciple(start: ReduceResult): ReduceResult {
  const action = legalActions(start.state).find(
    (candidate): candidate is Extract<Action, { type: 'castSpell' }> =>
      candidate.type === 'castSpell' && start.state.objects[candidate.oid]?.card.id === DISCIPLE.id,
  );
  if (action === undefined) throw new Error('Disciple was not castable');
  let current = apply(start, action);
  current = apply(current, { type: 'passPriority', player: 0 });
  return apply(current, { type: 'passPriority', player: 1 });
}

function board(
  permanents: readonly { readonly card: typeof BEAR; readonly controller: 0 | 1; readonly token?: boolean }[],
): ReduceResult {
  return scenario({
    life: [10, 20],
    battlefield: [...lands(SWAMP, 4).map((card) => ({ card, controller: 0 as const })), ...permanents],
    hands: [[DISCIPLE], []],
    libraries: [[DRAW, DRAW, DRAW, DRAW, DRAW, DRAW], [DRAW]],
    seed: 'disciple-of-bolas/native',
  });
}

function untilSacrifice(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 12; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind === 'permanentSacrifice') return current;
    if (decision?.kind !== 'priority') {
      throw new Error(`Disciple met ${decision?.kind ?? 'nothing'} before its sacrifice choice`);
    }
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Disciple never reached its sacrifice choice');
}

function choose(start: ReduceResult, oid: ObjectId): ReduceResult {
  const decision = pendingDecision(start.state);
  if (decision?.kind !== 'permanentSacrifice') throw new Error('no Disciple sacrifice is pending');
  return apply(start, { type: 'sacrificePermanent', player: decision.player, oid });
}

function withController(state: GameState, oid: ObjectId, controller: 0 | 1): GameState {
  const object = state.objects[oid];
  if (object === undefined) throw new Error('source disappeared before the control change');
  return { ...state, objects: { ...state.objects, [oid]: { ...object, controller } } };
}

describe('Disciple of Bolas resolve-time sacrifice', () => {
  it('requires another controlled creature, excludes the source, and asks only when a choice exists', () => {
    const asked = untilSacrifice(
      castDisciple(
        board([
          { card: BEAR, controller: 0 },
          { card: OTHER, controller: 0 },
        ]),
      ),
    );
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'permanentSacrifice') throw new Error('sacrifice choice vanished');
    const disciple = oidOf(asked.state, DISCIPLE.name);

    expect(decision.player).toBe(0);
    expect(decision.permanents).toEqual(
      expect.arrayContaining([oidOf(asked.state, BEAR.name), oidOf(asked.state, OTHER.name)]),
    );
    expect(decision.permanents).not.toContain(disciple);

    const alone = castDisciple(board([]));
    let settled = alone;
    for (let guard = 0; guard < 4 && pendingDecision(settled.state)?.kind === 'priority'; guard += 1) {
      const priority = settled.state.turn.priority;
      if (priority === null) break;
      settled = apply(settled, { type: 'passPriority', player: priority });
    }
    expect(pendingDecision(settled.state)?.kind).not.toBe('permanentSacrifice');
    expect(eventsOfType(settled.events, 'permanentSacrificed')).toEqual([]);
    expect(settled.state.players[0].life).toBe(10);
    expect(settled.state.players[0].hand).toHaveLength(0);
  });

  it('sacrifices before gaining life and drawing the same layered last-known power', () => {
    const entered = castDisciple(
      board([
        { card: BEAR, controller: 0 },
        { card: OTHER, controller: 0 },
      ]),
    );
    const bear = oidOf(entered.state, BEAR.name);
    const modified: ReduceResult = {
      ...entered,
      state: withContinuous(entered.state, [pump(onlyObject(bear), 3, 0)]),
    };
    const done = choose(untilSacrifice(modified), bear);

    expect(done.state.objects[bear]?.zone).toBe('graveyard');
    expect(done.state.players[0].life).toBe(15);
    expect(eventsOfType(done.events, 'cardDrawn')).toHaveLength(5);
    const ordered = done.events
      .filter(
        (event) =>
          event.type === 'permanentSacrificed' || event.type === 'lifeChanged' || event.type === 'cardDrawn',
      )
      .map((event) => event.type);
    expect(ordered).toEqual([
      'permanentSacrificed',
      'lifeChanged',
      'cardDrawn',
      'cardDrawn',
      'cardDrawn',
      'cardDrawn',
      'cardDrawn',
    ]);
  });

  it('uses zero for negative power and still performs the mandatory sacrifice', () => {
    const entered = castDisciple(
      board([
        { card: BEAR, controller: 0 },
        { card: OTHER, controller: 0 },
      ]),
    );
    const bear = oidOf(entered.state, BEAR.name);
    const negative: ReduceResult = {
      ...entered,
      state: withContinuous(entered.state, [pump(onlyObject(bear), -5, 0)]),
    };
    const done = choose(untilSacrifice(negative), bear);

    expect(pendingDecision(done.state)?.kind).not.toBe('permanentSacrifice');
    expect(done.state.objects[bear]?.zone).toBe('graveyard');
    expect(done.state.players[0].life).toBe(10);
    expect(eventsOfType(done.events, 'cardDrawn')).toHaveLength(0);
  });

  it('retains a token power even though the sacrificed token ceases to exist', () => {
    const entered = castDisciple(
      board([
        { card: TOKEN, controller: 0, token: true },
        { card: OTHER, controller: 0 },
      ]),
    );
    const token = oidOf(entered.state, TOKEN.name);
    const done = choose(untilSacrifice(entered), token);

    expect(eventsOfType(done.events, 'permanentSacrificed').map((event) => event.oid)).toContain(token);
    expect(done.state.players[0].life).toBe(13);
    expect(eventsOfType(done.events, 'cardDrawn')).toHaveLength(3);
  });

  it('uses the trigger controller after source control changes and survives source departure', () => {
    const entered = castDisciple(
      board([
        { card: BEAR, controller: 0 },
        { card: OTHER, controller: 0 },
        { card: TOKEN, controller: 1 },
      ]),
    );
    const source = oidOf(entered.state, DISCIPLE.name);
    const bear = oidOf(entered.state, BEAR.name);
    const changed: ReduceResult = { ...entered, state: withController(entered.state, source, 1) };
    const asked = untilSacrifice(changed);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'permanentSacrifice') throw new Error('controller-change choice vanished');
    expect(decision.player).toBe(0);
    expect(decision.permanents).toContain(bear);
    expect(decision.permanents).not.toContain(oidOf(asked.state, TOKEN.name));

    const departedStart = castDisciple(
      board([
        { card: BEAR, controller: 0 },
        { card: OTHER, controller: 0 },
      ]),
    );
    const departedSource = oidOf(departedStart.state, DISCIPLE.name);
    const departure = moveObject(beginTrace(departedStart.state), departedSource, 'graveyard');
    const returnToBattlefield = moveObject(departure, departedSource, 'battlefield');
    const departed = untilSacrifice({
      state: returnToBattlefield.state,
      events: [...departedStart.events, ...returnToBattlefield.events],
    });
    const departedDecision = pendingDecision(departed.state);
    if (departedDecision?.kind !== 'permanentSacrifice') throw new Error('departed source lost its choice');
    expect(departedDecision.player).toBe(0);
    expect(departedDecision.permanents).toEqual(
      expect.arrayContaining([
        departedSource,
        oidOf(departed.state, BEAR.name),
        oidOf(departed.state, OTHER.name),
      ]),
    );
  });
});
