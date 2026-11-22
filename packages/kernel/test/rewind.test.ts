/** Rewind's counter followed by a non-targeted, optional land selection. */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import type { GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import {
  beginTrace,
  eventsOfType,
  moveObject,
  pendingDecision,
  playerOf,
  reduce,
  scenario,
  seatState,
  validateAction,
} from '@mtg/kernel';
import { artifact, instant, ISLAND, MOUNTAIN } from './cards';

const REWIND = instant(
  'Rewind',
  [{ kind: 'counterSpell' }, { kind: 'untapPermanents', upTo: 4, filter: { cardTypes: ['land'] } }],
  {},
);

const BAIT = instant('Rewind Bait', [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }], {});

const CANCEL = instant('Rewind Cancel', [{ kind: 'counterSpell' }], {});

function spellNamed(state: GameState, name: string): { kind: 'spell'; oid: ObjectId } {
  const entry = state.stack.find((candidate) => state.objects[candidate.oid]?.card.name === name);
  if (entry === undefined) throw new Error(`no spell named ${name} is on the stack`);
  return { kind: 'spell', oid: entry.oid };
}

function pausedOnRewind(
  battlefield: readonly {
    readonly card: Card;
    readonly controller: 0 | 1;
    readonly tapped?: boolean;
  }[],
): ReduceResult {
  const start = scenario({
    battlefield,
    hands: [
      [BAIT, ISLAND],
      [REWIND, MOUNTAIN],
    ],
    seed: 'm13/rewind',
  });
  const bait = reduce(start.state, {
    type: 'castSpell',
    player: 0,
    oid: playerOf(start.state, 0).hand[0] ?? '',
    targets: [null],
  });
  const offered = reduce(bait.state, { type: 'passPriority', player: 0 });
  const rewind = reduce(offered.state, {
    type: 'castSpell',
    player: 1,
    oid: playerOf(offered.state, 1).hand[0] ?? '',
    targets: [spellNamed(offered.state, BAIT.name), null],
  });
  const passed = reduce(rewind.state, { type: 'passPriority', player: 1 });
  const paused = reduce(passed.state, { type: 'passPriority', player: 0 });
  return {
    state: paused.state,
    events: [...bait.events, ...offered.events, ...rewind.events, ...passed.events, ...paused.events],
  };
}

function untapDecision(state: GameState) {
  const decision = pendingDecision(state);
  if (decision?.kind !== 'permanentUntap') throw new Error('Rewind is not awaiting permanent choices');
  return decision;
}

function answer(current: ReduceResult, oid: ObjectId | null): ReduceResult {
  return reduce(current.state, { type: 'choosePermanentToUntap', player: 1, oid });
}

describe('Rewind', () => {
  it('counters its target, then offers every tapped land on both sides and an immediate stop', () => {
    const cog = artifact('Rewind Cog');
    const paused = pausedOnRewind([
      { card: MOUNTAIN, controller: 0, tapped: true },
      { card: ISLAND, controller: 1 },
      { card: ISLAND, controller: 1, tapped: true },
      { card: cog, controller: 1, tapped: true },
    ]);
    const decision = untapDecision(paused.state);

    expect(paused.state.objects[spellNamedFromGraveyard(paused.state, BAIT.name)]?.zone).toBe('graveyard');
    expect(decision.player).toBe(1);
    expect(decision.remaining).toBe(4);
    expect(decision.permanents.map((oid) => paused.state.objects[oid]?.card.name)).toEqual([
      'Mountain',
      'Island',
    ]);
    expect(decision.options.at(-1)).toEqual({ type: 'choosePermanentToUntap', player: 1, oid: null });
  });

  it('accepts zero, one, or four distinct lands and untaps only the chosen group', () => {
    const battlefield = [
      { card: MOUNTAIN, controller: 0 as const, tapped: true },
      ...Array.from({ length: 4 }, () => ({ card: ISLAND, controller: 1 as const, tapped: true })),
    ];

    const zero = answer(pausedOnRewind(battlefield), null);
    expect(eventsOfType(zero.events, 'permanentUntapped')).toEqual([]);

    const oneStart = pausedOnRewind(battlefield);
    const opponentLand = untapDecision(oneStart.state).permanents[0];
    if (opponentLand === undefined) throw new Error('the rig has no opponent land');
    const oneSelected = answer(oneStart, opponentLand);
    expect(oneSelected.state.objects[opponentLand]?.tapped).toBe(true);
    expect(eventsOfType(oneSelected.events, 'permanentUntapped')).toEqual([]);
    const one = answer(oneSelected, null);
    expect(eventsOfType(one.events, 'permanentUntapped')).toEqual([
      { type: 'permanentUntapped', oid: opponentLand },
    ]);

    let four = pausedOnRewind(battlefield);
    const selected: ObjectId[] = [];
    for (let count = 0; count < 4; count += 1) {
      const next = untapDecision(four.state).permanents[0];
      if (next === undefined) throw new Error('the rig ran out of lands');
      selected.push(next);
      four = answer(four, next);
    }
    expect(eventsOfType(four.events, 'permanentUntapped').map((event) => event.oid)).toEqual(selected);
    expect(pendingDecision(four.state)?.kind).toBe('priority');
  });

  it('offers fewer than four when fewer exist and refuses stale or duplicate answers', () => {
    const paused = pausedOnRewind([
      { card: MOUNTAIN, controller: 0, tapped: true },
      { card: ISLAND, controller: 1, tapped: true },
    ]);
    const decision = untapDecision(paused.state);
    const first = decision.permanents[0];
    if (first === undefined) throw new Error('the rig has no land');
    const selected = answer(paused, first);

    expect(decision.permanents).toHaveLength(2);
    expect(
      validateAction(selected.state, { type: 'choosePermanentToUntap', player: 1, oid: first }),
    ).not.toBeNull();

    const disappeared: GameState = {
      ...paused.state,
      battlefield: paused.state.battlefield.filter((oid) => oid !== first),
      objects: {
        ...paused.state.objects,
        [first]: { ...paused.state.objects[first]!, zone: 'graveyard' },
      },
    };
    expect(
      validateAction(disappeared, { type: 'choosePermanentToUntap', player: 1, oid: first }),
    ).not.toBeNull();
  });

  it('does not offer untapped lands because untapping them is an impossible choice', () => {
    const done = pausedOnRewind([
      { card: MOUNTAIN, controller: 0 },
      { card: ISLAND, controller: 1 },
    ]);

    expect(done.state.pendingPermanentUntap).toBeUndefined();
    expect(eventsOfType(done.events, 'permanentUntapped')).toEqual([]);
  });

  it('keeps the public battlefield choice visible without exposing either hand', () => {
    const paused = pausedOnRewind([
      { card: MOUNTAIN, controller: 0, tapped: true },
      { card: ISLAND, controller: 1, tapped: true },
    ]);
    const watcher = seatState(paused.state, 0, 'watcher');
    const decision = untapDecision(paused.state);

    expect(watcher.pendingPermanentUntap?.permanents.map((candidate) => candidate.oid)).toEqual(
      decision.permanents,
    );
    expect(watcher.players[1].hand).toHaveLength(1);
    const hidden = watcher.players[1].hand[0];
    if (hidden === undefined) throw new Error('the rig has no hidden opponent card');
    expect(watcher.objects[hidden]).toBeUndefined();
  });

  it('rechecks earlier selections as non-targeted permanents before applying the group', () => {
    const paused = pausedOnRewind([
      { card: MOUNTAIN, controller: 0, tapped: true },
      { card: ISLAND, controller: 1, tapped: true },
    ]);
    const first = untapDecision(paused.state).permanents[0];
    if (first === undefined) throw new Error('the rig has no first land');
    const selected = answer(paused, first);
    const disappeared: GameState = {
      ...selected.state,
      battlefield: selected.state.battlefield.filter((oid) => oid !== first),
      objects: {
        ...selected.state.objects,
        [first]: { ...selected.state.objects[first]!, zone: 'graveyard' },
      },
    };

    const done = reduce(disappeared, { type: 'choosePermanentToUntap', player: 1, oid: null });

    expect(eventsOfType(done.events, 'permanentUntapped')).toEqual([]);
    expect(pendingDecision(done.state)?.kind).toBe('priority');
  });

  it('does not let a pending choice or selection follow a land into a new incarnation', () => {
    const paused = pausedOnRewind([
      { card: MOUNTAIN, controller: 0, tapped: true },
      { card: ISLAND, controller: 1, tapped: true },
    ]);
    const [first, second] = untapDecision(paused.state).permanents;
    if (first === undefined || second === undefined) throw new Error('the rig needs two lands');

    const noLongerTapped: GameState = {
      ...paused.state,
      objects: {
        ...paused.state.objects,
        [second]: { ...paused.state.objects[second]!, tapped: false },
      },
    };
    const revisedDecision = untapDecision(noLongerTapped);
    expect(revisedDecision.permanents).not.toContain(second);
    expect(revisedDecision.options).not.toContainEqual({
      type: 'choosePermanentToUntap',
      player: 1,
      oid: second,
    });

    const secondLeft = moveObject(beginTrace(paused.state), second, 'hand');
    const secondReturned = moveObject(secondLeft, second, 'battlefield', { controller: 1, tapped: true });
    const returnedDecision = untapDecision(secondReturned.state);
    expect(returnedDecision.permanents).not.toContain(second);
    expect(returnedDecision.options).not.toContainEqual({
      type: 'choosePermanentToUntap',
      player: 1,
      oid: second,
    });
    expect(
      validateAction(secondReturned.state, { type: 'choosePermanentToUntap', player: 1, oid: second }),
    ).not.toBeNull();

    const selected = answer(paused, first);
    const firstLeft = moveObject(beginTrace(selected.state), first, 'hand');
    const firstReturned = moveObject(firstLeft, first, 'battlefield', { controller: 0, tapped: true });
    const done = reduce(firstReturned.state, { type: 'choosePermanentToUntap', player: 1, oid: null });

    expect(eventsOfType(done.events, 'permanentUntapped')).toEqual([]);
    expect(done.state.objects[first]?.tapped).toBe(true);
  });

  it('does not ask for lands when its only target became illegal before resolution', () => {
    const start = scenario({
      battlefield: [
        { card: MOUNTAIN, controller: 0, tapped: true },
        { card: ISLAND, controller: 1, tapped: true },
      ],
      hands: [[BAIT, CANCEL], [REWIND]],
      seed: 'm13/rewind/fizzle',
    });
    const bait = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: playerOf(start.state, 0).hand[0] ?? '',
      targets: [null],
    });
    const offered = reduce(bait.state, { type: 'passPriority', player: 0 });
    const rewind = reduce(offered.state, {
      type: 'castSpell',
      player: 1,
      oid: playerOf(offered.state, 1).hand[0] ?? '',
      targets: [spellNamed(offered.state, BAIT.name), null],
    });
    const offeredAgain = reduce(rewind.state, { type: 'passPriority', player: 1 });
    const cancel = reduce(offeredAgain.state, {
      type: 'castSpell',
      player: 0,
      oid: playerOf(offeredAgain.state, 0).hand[0] ?? '',
      targets: [spellNamed(offeredAgain.state, BAIT.name)],
    });
    const cancelPassed = reduce(cancel.state, { type: 'passPriority', player: 0 });
    const cancelResolved = reduce(cancelPassed.state, { type: 'passPriority', player: 1 });
    const rewindPassed = reduce(cancelResolved.state, { type: 'passPriority', player: 0 });
    const done = reduce(rewindPassed.state, { type: 'passPriority', player: 1 });

    expect(done.state.pendingPermanentUntap).toBeUndefined();
    expect(pendingDecision(done.state)?.kind).toBe('priority');
  });

  it('replays the same optional selection byte-for-byte from the same seed', () => {
    const run = (): ReduceResult => {
      let current = pausedOnRewind([
        { card: MOUNTAIN, controller: 0, tapped: true },
        { card: ISLAND, controller: 1, tapped: true },
      ]);
      const first = untapDecision(current.state).permanents[0];
      if (first === undefined) throw new Error('the rig has no deterministic first land');
      current = answer(current, first);
      return answer(current, null);
    };

    expect(run()).toEqual(run());
  });
});

function spellNamedFromGraveyard(state: GameState, name: string): ObjectId {
  const oid = state.players
    .flatMap((player) => player.graveyard)
    .find((candidate) => state.objects[candidate]?.card.name === name);
  if (oid === undefined) throw new Error(`${name} is not in a graveyard`);
  return oid;
}
