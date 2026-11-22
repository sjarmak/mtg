/** Exact native execution for M13 #226, Hellion Crucible. */
import { parseCard, type Card } from '@mtg/dsl';
import {
  advanceToStep,
  beginTrace,
  counterCount,
  eligibleAttackers,
  eventsOfType,
  getObject,
  legalActions,
  moveObject,
  pendingDecision,
  placeCounters,
  reduce,
  scenario,
  stateFingerprint,
  validateAction,
  type Action,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { MOUNTAIN } from './cards';

const HELLION_CRUCIBLE: Card = parseCard({
  kind: 'land',
  id: 'm13-hellion-crucible',
  name: 'Hellion Crucible',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 226 },
  producesMana: ['C'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1, R: 1 }, tapSelf: true },
      effects: [{ kind: 'putCounters', counter: 'pressure', count: 1, target: { kind: 'selfPermanent' } }],
    },
    {
      kind: 'activated',
      cost: {
        mana: { generic: 1, R: 1 },
        tapSelf: true,
        removeCounter: { counter: 'pressure', count: 2 },
        sacrificeSelf: true,
      },
      effects: [
        {
          kind: 'createToken',
          count: 1,
          token: {
            name: 'Hellion',
            power: 4,
            toughness: 4,
            colors: ['R'],
            subtypes: ['Hellion'],
            keywords: ['haste'],
          },
        },
      ],
    },
  ],
});

function mountains(count: number): readonly { readonly card: Card; readonly controller: 0 }[] {
  return Array.from({ length: count }, () => ({ card: MOUNTAIN, controller: 0 as const }));
}

function board(
  pressure: number,
  options: { readonly mountains?: number; readonly tapped?: boolean } = {},
): { readonly state: GameState; readonly source: ObjectId } {
  const start = scenario({
    seed: `hellion-crucible/${String(pressure)}`,
    battlefield: [
      { card: HELLION_CRUCIBLE, controller: 0, tapped: options.tapped ?? false },
      ...mountains(options.mountains ?? 2),
    ],
  });
  const source = start.state.battlefield.find(
    (oid) => start.state.objects[oid]?.card.id === HELLION_CRUCIBLE.id,
  );
  if (source === undefined) throw new Error('Hellion Crucible probe lost its source');
  const state =
    pressure === 0 ? start.state : placeCounters(beginTrace(start.state), source, 'pressure', pressure).state;
  return { state, source };
}

function activations(
  state: GameState,
  source: ObjectId,
): readonly Extract<Action, { readonly type: 'activateAbility' }>[] {
  return legalActions(state).filter(
    (action): action is Extract<Action, { readonly type: 'activateAbility' }> =>
      action.type === 'activateAbility' && action.oid === source,
  );
}

function resolveStack(current: ReduceResult): ReduceResult {
  let result = current;
  for (let guard = 0; guard < 20 && result.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(result.state);
    if (decision?.kind !== 'priority') throw new Error('Hellion Crucible stack lost priority');
    const next = reduce(result.state, { type: 'passPriority', player: decision.player });
    result = { state: next.state, events: [...result.events, ...next.events] };
  }
  if (result.state.stack.length > 0) throw new Error('Hellion Crucible stack did not resolve');
  return result;
}

function hatchAction(state: GameState, source: ObjectId) {
  return activations(state, source).find((action) => action.abilityIndex === 1);
}

describe('Hellion Crucible activation legality', () => {
  it.each([0, 1, 2] as const)('offers the hatch only with two counters (has %i)', (pressure) => {
    const { state, source } = board(pressure);
    expect(activations(state, source).some((action) => action.abilityIndex === 0)).toBe(true);
    expect(hatchAction(state, source) !== undefined).toBe(pressure === 2);
  });

  it('refuses the hatch when mana, untapped source, or live source is missing', () => {
    const poor = board(2, { mountains: 1 });
    expect(hatchAction(poor.state, poor.source)).toBeUndefined();

    const tapped = board(2, { tapped: true });
    expect(hatchAction(tapped.state, tapped.source)).toBeUndefined();

    const ready = board(2);
    const action = hatchAction(ready.state, ready.source);
    expect(action).toBeDefined();
    if (action === undefined) return;
    const activated = reduce(ready.state, action);
    expect(validateAction(activated.state, action)).toBe('source is not on the battlefield');
  });
});

describe('Hellion Crucible payments and resolution', () => {
  it('pays mana, tap, two counters, and sacrifice atomically without mutating prior state', () => {
    const ready = board(2);
    const before = stateFingerprint(ready.state);
    const action = hatchAction(ready.state, ready.source);
    expect(action).toBeDefined();
    if (action === undefined) return;

    const activated = reduce(ready.state, action);
    expect(stateFingerprint(ready.state)).toBe(before);
    expect(getObject(ready.state, ready.source).zone).toBe('battlefield');
    expect(getObject(ready.state, ready.source).tapped).toBe(false);
    expect(counterCount(getObject(ready.state, ready.source).counters, 'pressure')).toBe(2);

    const types = activated.events.map((event) => event.type);
    const sourceTap = activated.events.findIndex(
      (event) => event.type === 'permanentTapped' && event.oid === ready.source,
    );
    const counterPayment = activated.events.findIndex(
      (event) =>
        event.type === 'counterRemoved' &&
        event.oid === ready.source &&
        event.counter === 'pressure' &&
        event.count === 2,
    );
    const sacrifice = activated.events.findIndex(
      (event) => event.type === 'permanentSacrificed' && event.oid === ready.source,
    );
    expect(types).toContain('manaPaid');
    expect(sourceTap).toBeGreaterThan(types.indexOf('manaPaid'));
    expect(counterPayment).toBeGreaterThan(sourceTap);
    expect(sacrifice).toBeGreaterThan(counterPayment);
    expect(types.indexOf('abilityActivated')).toBeGreaterThan(sacrifice);
    expect(getObject(activated.state, ready.source).zone).toBe('graveyard');
    expect(counterCount(getObject(activated.state, ready.source).counters, 'pressure')).toBe(0);
  });

  it('resolves from a departed source and ignores that card returning as a new incarnation', () => {
    const ready = board(2);
    const originalIncarnation = getObject(ready.state, ready.source).incarnation ?? 0;
    const action = hatchAction(ready.state, ready.source);
    expect(action).toBeDefined();
    if (action === undefined) return;
    const activated = reduce(ready.state, action);
    const returned = moveObject(beginTrace(activated.state), ready.source, 'battlefield');
    expect(getObject(returned.state, ready.source).incarnation).toBeGreaterThan(originalIncarnation);

    const resolved = resolveStack({
      state: returned.state,
      events: [...activated.events, ...returned.events],
    });
    const tokens = resolved.state.battlefield.filter(
      (oid) => resolved.state.objects[oid]?.card.name === 'Hellion',
    );
    expect(tokens).toHaveLength(1);
    expect(getObject(resolved.state, ready.source).zone).toBe('battlefield');
    expect(counterCount(getObject(resolved.state, ready.source).counters, 'pressure')).toBe(0);
    expect(eventsOfType(resolved.events, 'effectSkipped')).toEqual([]);
  });

  it('creates an exact hasty 4/4 that can attack on its arrival turn', () => {
    const ready = board(2);
    const action = hatchAction(ready.state, ready.source);
    expect(action).toBeDefined();
    if (action === undefined) return;
    const resolved = resolveStack(reduce(ready.state, action));
    const token = resolved.state.battlefield.find(
      (oid) => resolved.state.objects[oid]?.card.name === 'Hellion',
    );
    expect(token).toBeDefined();
    if (token === undefined) return;
    expect(getObject(resolved.state, token)).toMatchObject({ token: true, summoningSick: true });
    expect(getObject(resolved.state, token).card).toMatchObject({
      power: 4,
      toughness: 4,
      colors: ['R'],
      subtypes: ['Hellion'],
      keywords: ['haste'],
    });

    const combat = advanceToStep(resolved, 'declareAttackers');
    expect(eligibleAttackers(combat.state)).toContain(token);
    expect(
      validateAction(combat.state, {
        type: 'declareAttackers',
        player: 0,
        attackers: [{ oid: token, defender: 1 }],
      }),
    ).toBeNull();
  });
});
