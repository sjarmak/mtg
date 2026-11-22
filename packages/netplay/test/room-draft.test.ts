/**
 * The same room, dealt by drafting it: two people, one pod, one table.
 *
 * `mtg-28bh`, and the second half of what the playtester asked for — "to draft in
 * the same pool as one another then play against each other". The claims here
 * are the ones that only exist once a draft is behind a socket:
 *
 *  - A drafting room opens holding nothing. The pool is what a seat takes, and
 *    it is the same field the build screen reads afterwards, so there is no
 *    conversion step where a draft becomes a sealed pool.
 *  - The pack moves only when both seats have picked. One player being quick
 *    must not change what the other one is looking at.
 *  - A pick addresses the pack by position, so taking a card that was never
 *    offered is unsayable; a position the pack does not have is a refusal.
 *  - The build phase is the sealed room's build phase, unchanged, and the table
 *    at the end answers to the same two tokens.
 *
 * The set is the tideglass fixture rather than `EXAMPLE_CARDS` because a draft
 * needs collation sheets: `room.test.ts`'s set opens a sealed pool and cannot
 * fill a pack.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { DEFAULT_NATIVE_DRAFT_BOT_POLICY, DRAFTMANCER_SIMPLE_BOT_POLICY } from '@mtg/draft-export';
import { openRoom } from '@mtg/netplay';
import type { Room, RoomView, SeatPlan } from '@mtg/netplay';

const SET_FIXTURE = fileURLToPath(
  new URL('../../setgen/fixtures/sets/tideglass-reach.set.json', import.meta.url),
);

function loadSet(): readonly Card[] {
  const raw: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
  const { cards } = raw as { cards: unknown[] };
  return cards.map((card) => parseCard(card));
}

const SET = loadSet();
const SEED = 'netplay/room-draft/v0';

const PLAN: readonly [SeatPlan, SeatPlan] = [
  { name: 'One', token: 'token-one' },
  { name: 'Two', token: 'token-two' },
];

/** Three packs, which is what fills a pool big enough to cut a deck out of. */
function drafting(plan: readonly [SeatPlan, SeatPlan] = PLAN, packs = 3): Room {
  return openRoom({ id: 'room-1', set: SET, seed: SEED, plan, draft: { packs } });
}

function packOf(room: Room, seat: 0 | 1): RoomView['pack'] {
  return room.viewFor(seat).pack;
}

/** Takes the last card of whatever each seat is shown, until the draft is over. */
function draftOut(room: Room): void {
  for (let guard = 0; guard < 200; guard += 1) {
    if (room.viewFor(0).phase !== 'draft') return;
    for (const seat of [0, 1] as const) {
      const pack = packOf(room, seat);
      if (pack === null) continue;
      const refusal = room.pick(seat, pack.cards.length - 1);
      if (refusal !== null) throw new Error(refusal);
    }
  }
  throw new Error('the draft did not finish');
}

describe('a room that drafts its pools', () => {
  it('opens on the draft with nothing in either pool and a pack in front of both', () => {
    const room = drafting();
    const view = room.viewFor(0);
    expect(view.phase).toBe('draft');
    expect(view.pool).toEqual([]);
    expect(view.rounds).toBe(3);
    expect(view.draftBotPolicy).toBe(DEFAULT_NATIVE_DRAFT_BOT_POLICY);
    expect(view.pack?.round).toBe(1);
    expect(view.pack?.pickNumber).toBe(1);
    expect(view.pack?.cards.length).toBeGreaterThan(0);
    expect(view.seats.map((seat) => seat.ready)).toEqual([false, false]);
    // Both seats are asked at once, out of packs of their own.
    expect(packOf(room, 1)?.cards).not.toEqual(view.pack?.cards);
  });

  it('sends packs of cards this set prints, so the page can draw them', () => {
    const printed = new Set(SET.map((card) => card.id));
    const pack = packOf(drafting(), 0);
    expect(pack).not.toBeNull();
    for (const id of pack?.cards ?? []) expect(printed.has(id)).toBe(true);
  });

  it('holds the round open for the seat that has not picked', () => {
    const room = drafting();
    const before = packOf(room, 1);
    const taken = packOf(room, 0)?.cards[0];
    expect(room.pick(0, 0)).toBeNull();

    // The quick seat is holding its card and waiting; the other one is looking
    // at exactly the pack it was looking at a moment ago.
    expect(room.viewFor(0).pool).toEqual([taken]);
    expect(packOf(room, 0)).toBeNull();
    expect(room.viewFor(0).seats.map((seat) => seat.ready)).toEqual([true, false]);
    expect(packOf(room, 1)).toEqual(before);

    expect(room.pick(1, 0)).toBeNull();
    const next = packOf(room, 0);
    expect(next?.pickNumber).toBe(2);
    expect(next?.cards.length).toBe((before?.cards.length ?? 0) - 1);
  });

  it('refuses a second pick from a seat that has already taken one', () => {
    const room = drafting();
    expect(room.pick(0, 0)).toBeNull();
    expect(room.pick(0, 0)).toContain('already picked');
    expect(room.viewFor(0).pool.length).toBe(1);
  });

  it('refuses a position the pack does not have, and takes nothing', () => {
    const room = drafting();
    const size = packOf(room, 0)?.cards.length ?? 0;
    expect(room.pick(0, size)).toContain('no card at position');
    expect(room.viewFor(0).pool).toEqual([]);
    expect(packOf(room, 0)?.cards.length).toBe(size);
  });

  it('rises a revision on every accepted pick and on none that is refused', () => {
    const room = drafting();
    const before = room.revision;
    expect(room.pick(0, 999)).not.toBeNull();
    expect(room.revision).toBe(before);
    expect(room.pick(0, 0)).toBeNull();
    expect(room.revision).toBeGreaterThan(before);
  });

  it('will not take a deck while there are picks left', () => {
    const room = drafting();
    expect(room.submit(0, { chosen: [], basics: null })).toContain('not over yet');
  });

  it('hands both seats the pool they drafted, and then builds like any other room', () => {
    const room = drafting();
    draftOut(room);
    const first = room.viewFor(0);
    const second = room.viewFor(1);
    expect(first.phase).toBe('build');
    expect(first.pack).toBeNull();
    expect(first.pool.length).toBe(second.pool.length);
    expect(first.pool.length).toBeGreaterThan(0);
    expect(first.pool).not.toEqual(second.pool);
    // Nobody drafted the same physical card twice, and nobody has the other
    // seat's cards: a pod deals each card to exactly one person.
    expect(new Set([...first.pool, ...second.pool]).size).toBeGreaterThan(first.pool.length);
    expect(first.seats.map((seat) => seat.ready)).toEqual([false, false]);

    const build = (view: RoomView): { chosen: number[]; basics: null } => ({
      chosen: view.pool.map((_, index) => index).slice(0, 23),
      basics: null,
    });
    expect(room.submit(0, build(first))).toBeNull();
    expect(room.table()).toBeNull();
    expect(room.submit(1, build(second))).toBeNull();
    expect(room.table()?.seatOf('token-one')).toBe(0);
    expect(room.table()?.seatOf('token-two')).toBe(1);
    expect(room.viewFor(0).phase).toBe('playing');
    // The table knows it was drafted for, so a recorder files the game as a draft.
    const table = room.table();
    if (table === null) throw new Error('the room did not start');
    for (let guard = 0; guard < 4000 && table.snapshotFor(0).result === null; guard += 1) {
      const owed = table.snapshotFor(0).awaiting ?? 0;
      const owing = table.snapshotFor(owed);
      table.apply(owed, {
        kind: 'choose',
        index: (owing.pending?.options.length ?? 1) - 1,
        at: owing.decisions,
      });
    }
    expect(table.capture()?.format).toBe('draft');
  });

  it('refuses a card the drafted pool does not hold', () => {
    const room = drafting();
    draftOut(room);
    const size = room.viewFor(0).pool.length;
    expect(room.submit(0, { chosen: [size], basics: null })).toContain('no card at position');
  });

  it('drafts the same pod again from the same seed and the same picks', () => {
    const first = drafting();
    const again = drafting();
    expect(packOf(again, 0)).toEqual(packOf(first, 0));
    first.pick(0, 3);
    first.pick(1, 0);
    again.pick(0, 3);
    again.pick(1, 0);
    expect(again.viewFor(0).pool).toEqual(first.viewFor(0).pool);
    expect(packOf(again, 0)).toEqual(packOf(first, 0));
  });

  it('pins a requested policy through every replay and exposes its identity', () => {
    const room = openRoom({
      id: 'legacy-room',
      set: SET,
      seed: SEED,
      plan: PLAN,
      draft: { packs: 1, botPolicy: DRAFTMANCER_SIMPLE_BOT_POLICY },
    });
    expect(room.viewFor(0).draftBotPolicy).toBe(DRAFTMANCER_SIMPLE_BOT_POLICY);
    expect(room.pick(0, 0)).toBeNull();
    expect(room.viewFor(0).draftBotPolicy).toBe(DRAFTMANCER_SIMPLE_BOT_POLICY);
  });

  it('drafts for the empty seat too, and has its deck built by the time it matters', () => {
    const room = drafting([PLAN[0], { name: 'Bot', token: null }]);
    // Nobody is sitting there, so it never holds the round up.
    expect(room.viewFor(0).seats[1]?.ready).toBe(true);
    for (let guard = 0; guard < 200 && room.viewFor(0).phase === 'draft'; guard += 1) {
      const pack = packOf(room, 0);
      if (pack === null) throw new Error('the one person was owed no pick mid-draft');
      expect(room.pick(0, 0)).toBeNull();
    }
    expect(room.viewFor(0).phase).toBe('build');
    const view = room.viewFor(0);
    expect(
      room.submit(0, { chosen: view.pool.map((_, index) => index).slice(0, 23), basics: null }),
    ).toBeNull();
    expect(room.table()).not.toBeNull();
  });
});

describe('a room that deals sealed pools', () => {
  it('has nothing to draft and says so', () => {
    const sealed = openRoom({ id: 'room-2', set: SET, seed: SEED, plan: PLAN });
    expect(sealed.viewFor(0).phase).toBe('build');
    expect(sealed.viewFor(0).pack).toBeNull();
    expect(sealed.viewFor(0).rounds).toBe(0);
    expect(sealed.viewFor(0).draftBotPolicy).toBeNull();
    expect(sealed.pick(0, 0)).toContain('nothing to draft');
  });
});

describe('reading a pick off the wire', () => {
  it('takes a whole position and refuses everything else', async () => {
    const { readRoomPick } = await import('@mtg/netplay');
    expect(readRoomPick({ pick: 0 })).toBe(0);
    expect(readRoomPick({ pick: 7 })).toBe(7);
    expect(readRoomPick(null)).toBe('a pick is an object');
    expect(readRoomPick([1])).toBe('a pick is an object');
    expect(readRoomPick({})).toContain('whole position');
    expect(readRoomPick({ pick: -1 })).toContain('whole position');
    expect(readRoomPick({ pick: 1.5 })).toContain('whole position');
    expect(readRoomPick({ pick: '1' })).toContain('whole position');
  });
});
