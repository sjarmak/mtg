/**
 * The phase before the deal: two pools, two people, one table at the end.
 *
 * `deal.ts` builds both decks and seats them. A room is what the playtester asked for
 * instead — "so we're able to build sealed decks to play against each other" —
 * and the claims worth pinning are the ones that make it safe to put a build
 * screen on the other end of a socket:
 *
 *  - A seat sees its own pool and nothing else. The other seat's cards are not
 *    in the bytes, before there is a game to conceal them from.
 *  - A seat cannot play a card its pool never held. The wire carries indices,
 *    the server holds the pool, and an index it does not have is a refusal.
 *  - The table that comes out answers to the same two tokens the room did, so
 *    nobody is handed a second link halfway through.
 *  - Both pools derive from the table seed, exactly as `dealSealedTable`'s two
 *    built decks do, so one string still names the whole match.
 */
import { describe, expect, it } from 'vitest';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import { openSealedPool } from '@mtg/deckbuild';
import { openRoom, poolSeedFor, readRoomBuild } from '@mtg/netplay';
import type { Room, RoomBuild, SeatPlan } from '@mtg/netplay';

const SEED = 'netplay/room/v0';

const PLAN: readonly [SeatPlan, SeatPlan] = [
  { name: 'One', token: 'token-one' },
  { name: 'Two', token: 'token-two' },
];

function room(plan: readonly [SeatPlan, SeatPlan] = PLAN): Room {
  return openRoom({ id: 'room-1', set: EXAMPLE_CARDS, seed: SEED, plan });
}

/**
 * A legal deck out of a seat's pool: the first spells it holds, and the mana
 * base the builder apportions.
 *
 * Written as a function of the pool rather than as a fixture, because the pool
 * is dealt and a hard-coded index list would be a claim about a shuffle.
 */
function legalBuild(pool: readonly string[], target: number): RoomBuild {
  const byId = new Map(EXAMPLE_CARDS.map((card: Card) => [card.id, card]));
  const chosen: number[] = [];
  for (const [index, id] of pool.entries()) {
    if (chosen.length >= target) break;
    if (byId.get(id)?.kind === 'land') continue;
    chosen.push(index);
  }
  return { chosen, basics: null };
}

function buildFor(seat: Room, index: 0 | 1): RoomBuild {
  const view = seat.viewFor(index);
  return legalBuild(view.pool, 23);
}

describe('a pre-game room', () => {
  it('gives each seat its own pool and no part of the other one', () => {
    const opened = room();
    const first = opened.viewFor(0);
    const second = opened.viewFor(1);
    expect(first.pool.length).toBeGreaterThan(0);
    expect(first.pool).not.toEqual(second.pool);
    // Every card in a pool is a card this set prints. A pool holding an id the
    // page cannot resolve is a build screen full of blanks.
    const printed = new Set(EXAMPLE_CARDS.map((card) => card.id));
    for (const id of first.pool) expect(printed.has(id)).toBe(true);
  });

  it('opens the pools the table seed names, which is the seed a deal would use', () => {
    const opened = room();
    const expected = openSealedPool(EXAMPLE_CARDS, { seed: poolSeedFor(SEED, 0) });
    expect(opened.viewFor(0).pool).toEqual(expected.cards.map((card) => card.id));
  });

  it('has no table until both seats have built, and then answers to the same tokens', () => {
    const opened = room();
    expect(opened.table()).toBeNull();
    expect(opened.submit(0, buildFor(opened, 0))).toBeNull();
    expect(opened.table()).toBeNull();
    expect(opened.viewFor(1).seats[0]?.ready).toBe(true);
    expect(opened.viewFor(1).seats[1]?.ready).toBe(false);

    expect(opened.submit(1, buildFor(opened, 1))).toBeNull();
    const table = opened.table();
    expect(table).not.toBeNull();
    // The whole point of the room: the link somebody was handed while they were
    // building is the link they play from.
    expect(table?.seatOf('token-one')).toBe(0);
    expect(table?.seatOf('token-two')).toBe(1);
    expect(opened.viewFor(0).phase).toBe('playing');
  });

  it('deals its table for sealed play, which is the shelf a recorder files the game under', () => {
    const opened = room([PLAN[0], { name: 'Bot', token: null }]);
    expect(opened.submit(0, buildFor(opened, 0))).toBeNull();
    const table = opened.table();
    if (table === null) throw new Error('the room did not start');
    for (let guard = 0; guard < 4000 && table.snapshotFor(0).result === null; guard += 1) {
      const owing = table.snapshotFor(0);
      table.apply(0, {
        kind: 'choose',
        index: (owing.pending?.options.length ?? 1) - 1,
        at: owing.decisions,
      });
    }
    expect(table.capture()?.format).toBe('sealed');
  });

  it('plays the cards the seat chose, and none it did not', () => {
    const opened = room();
    const build = buildFor(opened, 0);
    const pool = opened.viewFor(0).pool;
    expect(opened.submit(0, build)).toBeNull();
    expect(opened.submit(1, buildFor(opened, 1))).toBeNull();
    const table = opened.table();
    if (table === null) throw new Error('the room did not start');

    // Read off the seat rather than off the room: the snapshot is what the page
    // is handed, and the cards on it are the deck that was shuffled. The library
    // is concealed from its own seat, so what is readable here is the opening
    // hand — enough to say that a card nobody chose does not turn up in it.
    const wanted = new Set(build.chosen.map((index) => pool[index]));
    const spells = Object.values(table.snapshotFor(0).state.objects).filter(
      (object) => !object.card.supertypes.includes('basic'),
    );
    expect(spells.length).toBeGreaterThan(0);
    for (const object of spells) expect(wanted.has(object.card.id)).toBe(true);
  });

  it('refuses a card the pool does not hold', () => {
    const opened = room();
    const size = opened.viewFor(0).pool.length;
    expect(opened.submit(0, { chosen: [size], basics: null })).toContain('no card at position');
    expect(opened.table()).toBeNull();
  });

  it('refuses a deck that is not the size this table plays', () => {
    const opened = room();
    const refusal = opened.submit(0, { chosen: [0], basics: { W: 1 } });
    expect(refusal).toContain('this table plays');
    expect(opened.viewFor(0).seats[0]?.ready).toBe(false);
  });

  it('refuses a second submission once the game has started', () => {
    const opened = room();
    opened.submit(0, buildFor(opened, 0));
    opened.submit(1, buildFor(opened, 1));
    expect(opened.submit(0, buildFor(opened, 0))).toContain('already started');
  });

  it('starts as soon as the one person builds, when the other seat is a bot', () => {
    const opened = room([PLAN[0], { name: 'Bot', token: null }]);
    expect(opened.viewFor(0).seats[1]?.ready).toBe(true);
    expect(opened.submit(0, buildFor(opened, 0))).toBeNull();
    expect(opened.table()).not.toBeNull();
  });

  it('maps a token to its seat and nothing else', () => {
    const opened = room();
    expect(opened.seatOf('token-one')).toBe(0);
    expect(opened.seatOf('token-two')).toBe(1);
    expect(opened.seatOf('token-three')).toBeNull();
    expect(opened.seatOf('')).toBeNull();
  });

  it('rises a revision on every accepted build, so a page can poll for one', () => {
    const opened = room();
    const before = opened.revision;
    opened.submit(0, { chosen: [0], basics: null });
    expect(opened.revision).toBe(before);
    opened.submit(0, buildFor(opened, 0));
    expect(opened.revision).toBeGreaterThan(before);
  });
});

describe('reading a build off the wire', () => {
  it('takes a build with indices and a counted mana base', () => {
    expect(readRoomBuild({ chosen: [0, 2], basics: { W: 9, U: 8 } })).toEqual({
      chosen: [0, 2],
      basics: { W: 9, U: 8 },
    });
  });

  it('takes a build that asks for the apportioned mana base', () => {
    expect(readRoomBuild({ chosen: [1], basics: null })).toEqual({ chosen: [1], basics: null });
    expect(readRoomBuild({ chosen: [1] })).toEqual({ chosen: [1], basics: null });
  });

  it('refuses everything that is not one', () => {
    expect(readRoomBuild(null)).toBe('a build is an object');
    expect(readRoomBuild({})).toContain('pool indices');
    expect(readRoomBuild({ chosen: [1.5] })).toContain('whole pool index');
    expect(readRoomBuild({ chosen: [-1] })).toContain('whole pool index');
    // The same physical card twice is two copies of one object, which is the
    // one thing an index list can express and a pool cannot supply.
    expect(readRoomBuild({ chosen: [2, 2] })).toContain('twice');
    expect(readRoomBuild({ chosen: [], basics: { X: 1 } })).toContain('not a color');
    expect(readRoomBuild({ chosen: [], basics: { W: -1 } })).toContain('whole number');
    expect(readRoomBuild({ chosen: [], basics: { W: 1_000 } })).toContain('more than any deck plays');
  });
});
