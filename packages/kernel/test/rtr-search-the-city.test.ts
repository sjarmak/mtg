/** Native linked exile, matching play, sacrifice, and extra turn for RTR #49. */
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  collectTriggers,
  emit,
  moveObject,
  pendingDecision,
  putTriggersOnStack,
  resolveTop,
  scenario,
  type GameEvent,
  type GameState,
  type ObjectId,
  type Trace,
} from '@mtg/kernel';
import { finishCleanup } from '../src/turn';
import { describe, expect, it } from 'vitest';
import { instant, ISLAND } from './cards';
import { apply, oidOf } from './helpers';

const SEARCH = parseCard({
  kind: 'enchantment',
  id: 'rtr-49-search-the-city-kernel',
  name: 'Search the City',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 49 },
  manaCost: { generic: 4, U: 1 },
  colors: ['U'],
  subtypes: [],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [],
      searchTheCityProfile: 'exileTopFive',
    },
    {
      kind: 'triggered',
      condition: 'youCastSpell',
      optional: true,
      effects: [],
      searchTheCityProfile: 'matchingNameCompletion',
    },
  ],
} satisfies CardInput);

const MATCH = instant('Remembered Route', [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }]);
const OTHER = instant('Other Route', [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }]);

function stackTriggers(trace: Trace): Trace {
  return putTriggersOnStack(trace, collectTriggers(trace, 0));
}

function enter(state: GameState): Trace {
  const source = oidOf(state, SEARCH.name);
  return resolveTop(
    stackTriggers(emit(beginTrace(state), { type: 'permanentEntered', oid: source, controller: 0 })),
  );
}

function playEvent(state: GameState, oid: ObjectId, kind: 'spell' | 'land'): Trace {
  const event: GameEvent =
    kind === 'spell'
      ? { type: 'spellCast', player: 0, oid, targets: [], chosenX: null }
      : { type: 'landPlayed', player: 0, oid };
  return stackTriggers(emit(beginTrace(state), event));
}

function answer(trace: Trace, accept: boolean): Trace {
  const asked = resolveTop(trace);
  const decision = pendingDecision(asked.state);
  expect(decision?.kind).toBe('optionalTrigger');
  if (decision?.kind !== 'optionalTrigger') throw new Error('matching play did not ask its may choice');
  return apply(asked, { type: 'answerOptionalTrigger', player: 0, oid: decision.oid, accept });
}

describe('Search the City entry', () => {
  it('exiles at most the top five cards and links only those exact exile incarnations', () => {
    const start = scenario({
      battlefield: [{ card: SEARCH, controller: 0 }],
      libraries: [[MATCH, OTHER, ISLAND, MATCH, OTHER, ISLAND], []],
    });
    const done = enter(start.state);
    const source = oidOf(done.state, SEARCH.name);
    expect(done.state.exile).toHaveLength(5);
    expect(done.state.players[0].library).toHaveLength(1);
    expect(done.state.objects[source]?.linkedExile).toHaveLength(5);
    for (const reference of done.state.objects[source]?.linkedExile ?? []) {
      expect(done.state.objects[reference.oid]).toMatchObject({
        zone: 'exile',
        linkedExileId: reference.linkId,
      });
    }
  });
});

describe('Search the City matching plays', () => {
  function oneRemembered(
    card = MATCH,
    active: 0 | 1 = 0,
  ): { readonly trace: Trace; readonly played: ObjectId } {
    const start = scenario({
      active,
      battlefield: [{ card: SEARCH, controller: 0 }],
      libraries: [[card], []],
      hands: [[card, OTHER], []],
    });
    const trace = enter(start.state);
    const played = trace.state.players[0].hand[0];
    if (played === undefined) throw new Error('matching play card disappeared');
    return { trace, played };
  }

  it('returns one matching linked card, sacrifices on the last one, and queues an extra turn', () => {
    const { trace, played } = oneRemembered();
    const fired = playEvent(trace.state, played, 'spell');
    const source = oidOf(fired.state, SEARCH.name);
    expect(fired.state.stack).toHaveLength(1);
    const done = answer(fired, true);
    expect(done.state.objects[source]?.zone).toBe('graveyard');
    expect(done.state.players[0].hand.map((oid) => done.state.objects[oid]?.card.name)).toEqual([
      MATCH.name,
      OTHER.name,
      MATCH.name,
    ]);
    expect(done.state.extraTurnSequence).toEqual({ queue: [0], resume: 1 });

    const next = finishCleanup(beginTrace({ ...done.state, turn: { ...done.state.turn, step: 'cleanup' } }));
    expect(next.state.turn.active).toBe(0);
    expect(next.state.extraTurnSequence).toEqual({ queue: [], resume: 1 });
  });

  it('resumes the skipped ordinary player after an off-turn extra turn', () => {
    const { trace, played } = oneRemembered(MATCH, 1);
    const granted = answer(playEvent(trace.state, played, 'spell'), true);

    const extra = finishCleanup(
      beginTrace({ ...granted.state, turn: { ...granted.state.turn, active: 1, step: 'cleanup' } }),
    );
    expect(extra.state.turn.active).toBe(0);

    const resumed = finishCleanup(
      beginTrace({ ...extra.state, turn: { ...extra.state.turn, step: 'cleanup' } }),
    );
    expect(resumed.state.turn.active).toBe(0);
    expect(resumed.state.extraTurnSequence).toBeUndefined();
  });

  it('takes later-created extra turns first and preserves one ordinary resume point', () => {
    const start = scenario({ active: 0 });
    const queued = {
      ...start.state,
      extraTurnSequence: { queue: [1 as const, 0 as const], resume: 1 as const },
      turn: { ...start.state.turn, step: 'cleanup' as const },
    };
    const newest = finishCleanup(beginTrace(queued));
    expect(newest.state.turn.active).toBe(1);
    expect(newest.state.extraTurnSequence).toEqual({ queue: [0], resume: 1 });

    const older = finishCleanup(
      beginTrace({ ...newest.state, turn: { ...newest.state.turn, step: 'cleanup' } }),
    );
    expect(older.state.turn.active).toBe(0);
    expect(older.state.extraTurnSequence).toEqual({ queue: [], resume: 1 });

    const resumed = finishCleanup(
      beginTrace({ ...older.state, turn: { ...older.state.turn, step: 'cleanup' } }),
    );
    expect(resumed.state.turn.active).toBe(1);
    expect(resumed.state.extraTurnSequence).toBeUndefined();
  });

  it('leaves the linked card and source in place when the optional return is declined', () => {
    const { trace, played } = oneRemembered();
    const done = answer(playEvent(trace.state, played, 'spell'), false);
    const source = oidOf(done.state, SEARCH.name);
    expect(done.state.objects[source]?.zone).toBe('battlefield');
    expect(done.state.objects[source]?.linkedExile).toHaveLength(1);
    expect(done.state.extraTurnSequence).toBeUndefined();
  });

  it('returns only one of several same-name cards and completes on a later matching play', () => {
    const start = scenario({
      battlefield: [{ card: SEARCH, controller: 0 }],
      libraries: [[MATCH, MATCH], []],
      hands: [[MATCH], []],
    });
    const entered = enter(start.state);
    const played = entered.state.players[0].hand[0];
    if (played === undefined) throw new Error('matching play card disappeared');
    const once = answer(playEvent(entered.state, played, 'spell'), true);
    const source = oidOf(once.state, SEARCH.name);
    expect(once.state.exile).toHaveLength(1);
    expect(once.state.objects[source]?.linkedExile).toHaveLength(1);
    expect(once.state.extraTurnSequence).toBeUndefined();

    const twice = answer(playEvent(once.state, played, 'spell'), true);
    expect(twice.state.objects[source]?.zone).toBe('graveyard');
    expect(twice.state.exile).toHaveLength(0);
    expect(twice.state.extraTurnSequence).toEqual({ queue: [0], resume: 1 });
  });

  it('fires for a matching land play but not for another card name', () => {
    const land = oneRemembered(ISLAND);
    expect(playEvent(land.trace.state, land.played, 'land').state.stack).toHaveLength(1);

    const spell = oneRemembered();
    const foreign = Object.values(spell.trace.state.objects).find(
      (object) => object.card.name === OTHER.name,
    );
    const unrelated = foreign?.oid;
    if (unrelated === undefined) throw new Error('unrelated card disappeared');
    expect(playEvent(spell.trace.state, unrelated, 'spell').state.stack).toHaveLength(0);
  });

  it('uses the fired trigger link after the enchantment leaves but grants no turn without a sacrifice', () => {
    const { trace, played } = oneRemembered();
    const fired = playEvent(trace.state, played, 'spell');
    const source = oidOf(fired.state, SEARCH.name);
    const left = moveObject(fired, source, 'graveyard');
    const done = answer(left, true);
    expect(done.state.players[0].hand.map((oid) => done.state.objects[oid]?.card.name)).toEqual([
      MATCH.name,
      OTHER.name,
      MATCH.name,
    ]);
    expect(done.state.extraTurnSequence).toBeUndefined();
  });

  it('cannot sacrifice the enchantment after an opponent gains control of it', () => {
    const { trace, played } = oneRemembered();
    const fired = playEvent(trace.state, played, 'spell');
    const source = oidOf(fired.state, SEARCH.name);
    const object = fired.state.objects[source];
    if (object === undefined) throw new Error('Search the City source disappeared');
    const changed = {
      ...fired,
      state: {
        ...fired.state,
        objects: { ...fired.state.objects, [source]: { ...object, controller: 1 as const } },
      },
    };
    const done = answer(changed, true);
    expect(done.state.objects[source]?.zone).toBe('battlefield');
    expect(done.state.extraTurnSequence).toBeUndefined();
  });

  it('does not let an old exile relation fire from a new source incarnation', () => {
    const { trace, played } = oneRemembered();
    const source = oidOf(trace.state, SEARCH.name);
    const left = moveObject(trace, source, 'graveyard');
    const returned = moveObject(left, source, 'battlefield', { controller: 0 });
    expect(playEvent(returned.state, played, 'spell').state.stack).toHaveLength(0);
  });
});
