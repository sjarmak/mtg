/**
 * What deals a table when somebody presses the button on the Play page.
 *
 * `netplay.ts` deals one table at startup from flags a person typed. This deals
 * one per request, from the set `play.ts` already staged, and that difference is
 * the whole reason this file exists: everything a deal needs — the cards, the
 * written decks, this machine's addresses, the port the *page* is served on — is
 * a launcher fact, and `@mtg/netplay`'s server has no business knowing any of
 * it. So the server takes a function, and this is the function.
 *
 * # The addresses are resolved per deal
 *
 * `networkInterfaces()` is called when a table is dealt rather than when the lab
 * starts. A laptop that joined a Wi-Fi network after `npm run play` was running
 * has a LAN address the launcher never saw, and a link built from a snapshot
 * taken at boot would be a link to nowhere. The reader still chooses between
 * every address that answers (`netplay-links.ts` argues that), so nothing here
 * guesses which network the other device is on.
 *
 * # Written decks when there are two, sealed otherwise
 *
 * The same rule `netplay.ts` follows, minus the flag: a set with a matching
 * precon file seats its first two decks, and everything else opens two sealed
 * pools.
 *
 * # And the room, for the game the two people build themselves
 *
 * `roomDealer` below is the second press. It opens a room rather than a table —
 * two sealed pools and no decks — and the seats build their own before there is
 * a game. It ignores the precon file outright: a room exists to be cut from a
 * pool, and there is nothing for a written deck to do in one. The invite it
 * hands out addresses `?room=`, because the page reads which kind of game it is
 * off the link rather than by probing for it.
 *
 * A `draft` option on the same dealer is the third press: the two seats draft
 * their pools out of shared packs and then build out of what they took. The
 * invite is still `?room=` — a drafting room becomes a building room becomes a
 * table under one token, and a second link would be a second thing to lose.
 *
 * Every identifier comes from `newId`, injected rather than reached for, so a
 * test can deal a table without `randomUUID` and still assert on which token
 * went where.
 */
import type { Card } from '@mtg/dsl';
import type { PreconFile } from '@mtg/deckbuild';
import { createTable, dealPreconTable, dealSealedTable, openRoom } from '@mtg/netplay';
import type { DealtRoom, DealtSeats, RoomDraftPlan, SeatPlan, TableInvite } from '@mtg/netplay';
import type { InterfaceInfo } from './lan-address';
import { tableInvite } from './netplay-links';
import type { SeatParam } from './netplay-links';
import { selectPreconPair } from './netplay-decks';

/** The two names a dealt table seats, until somebody asks to type their own. */
export const DEALER_NAMES: readonly [string, string] = ['You', 'Your opponent'];

export interface TableDealerOptions {
  /** The staged set, parsed once by the launcher rather than per table. */
  readonly set: readonly Card[];
  /** The decks written for it, or null to deal sealed pools. */
  readonly precons: PreconFile | null;
  /** Vite's port. The links are to the page, not to the game server. */
  readonly webPort: number;
  /** This machine's interfaces, asked again for every deal. See the header. */
  readonly interfaces: () => Readonly<Record<string, readonly InterfaceInfo[] | undefined>>;
  /** Seat tokens, table ids and seeds. One source, so a test can pin all three. */
  readonly newId: () => string;
  readonly names?: readonly [string, string] | undefined;
}

/** Whether this precon file can seat a table, which takes two decks. */
function seatsTwo(precons: PreconFile | null): precons is PreconFile {
  return precons !== null && precons.decks.length >= 2;
}

/**
 * A dealer, declared synchronous rather than as the contract's wider type.
 *
 * `TableDealer` allows a promise, because a dealer that had to read a file or
 * ask a service is a real one. This one does neither, and saying so is what lets
 * a caller — a test, mostly — read the table it just dealt without awaiting a
 * value that was never a promise. It is still a `TableDealer` — `play.ts` hands
 * it to `serveTable` as one, so the narrowing is checked where it is used.
 */
export function tableDealer(options: TableDealerOptions): () => DealtSeats {
  return (): DealtSeats => {
    const seating = seat(options, 'table');
    const seed = options.newId();
    const dealt = seatsTwo(options.precons)
      ? dealPreconTable({
          id: options.newId(),
          set: options.set,
          decks: selectPreconPair(options.precons, undefined),
          seed,
          plan: seating.plan,
        })
      : dealSealedTable({ id: options.newId(), set: options.set, seed, plan: seating.plan });
    return { table: createTable(dealt.spec), invite: seating.invite, hostToken: seating.hostToken };
  };
}

/** What a room needs, which is a table's inputs minus the written decks. */
export interface RoomDealerOptions extends Omit<TableDealerOptions, 'precons'> {
  /**
   * Deals the pools by drafting them instead of opening them sealed.
   *
   * One option rather than a second dealer, because a drafting room and a sealed
   * room differ in how the cards reach a seat and in nothing else: the same
   * seating, the same invite, the same token from the first pack to the last
   * turn. `@mtg/netplay`'s room says the same thing from the other side — its
   * draft phase hands each seat the field the build phase reads.
   */
  readonly draft?: RoomDraftPlan | undefined;
}

/**
 * Opens a room per press: two pools, and two people who cut their own decks.
 *
 * Synchronous for the reason `tableDealer` is, and built from the same seating
 * so a room and a table cannot drift on who the host is or which port a link
 * names. What differs is one word in the invite (`?room=`) and the absence of
 * any deck at all until somebody sends one.
 */
export function roomDealer(options: RoomDealerOptions): () => DealtRoom {
  return (): DealtRoom => {
    const seating = seat(options, 'room');
    const room = openRoom({
      id: options.newId(),
      set: options.set,
      seed: options.newId(),
      plan: seating.plan,
      ...(options.draft === undefined ? {} : { draft: options.draft }),
    });
    return { room, invite: seating.invite, hostToken: seating.hostToken };
  };
}

interface Seating {
  readonly plan: readonly [SeatPlan, SeatPlan];
  readonly invite: TableInvite;
  /**
   * Seat 0, which is `netplay-links.ts`'s `HOST_SEAT` and the seat the invite
   * hands out from. Whoever pressed the button is that seat.
   */
  readonly hostToken: string;
}

/** Two names, two fresh tokens, and the links that address the second one. */
function seat(options: RoomDealerOptions, param: SeatParam): Seating {
  const names = options.names ?? DEALER_NAMES;
  const tokens: readonly [string, string] = [options.newId(), options.newId()];
  return {
    plan: [
      { name: names[0], token: tokens[0] },
      { name: names[1], token: tokens[1] },
    ],
    invite: tableInvite({
      names,
      tokens,
      port: options.webPort,
      interfaces: options.interfaces(),
      param,
    }),
    hostToken: tokens[0],
  };
}
