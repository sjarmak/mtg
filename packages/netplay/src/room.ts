/**
 * The phase before the deal: two people, two pools, two decks nobody else cut.
 *
 * `deal.ts` builds both decks itself and seats them, and says outright why:
 * nobody cuts their own deck over the wire, and when somebody wants to, it is a
 * phase *before* the deal rather than a change to it — the output is still a
 * `GameSetup` with two decks in it. the playtester wanted it ("so we're able to build
 * sealed decks to play against each other"), and this is that phase.
 *
 * A room is what exists between pressing the button and there being a game. It
 * holds the two seat tokens, one sealed pool per seat, and one submitted deck
 * per seat; when the second deck lands it creates the `Table` **under the same
 * tokens**, so both pages fall straight through to the board they already know
 * how to draw. Nothing reissues a capability halfway through, which is what
 * would otherwise make a room a second link to hand to somebody.
 *
 * # A seat sends indices, and the server builds the deck
 *
 * The wire carries pool indices and a basic-land count, never cards. That is the
 * whole of how a seat is stopped from playing a card its pool never held: an
 * index addresses the pool this server opened, so there is no card to smuggle
 * in. The deck itself is assembled here by `buildFromSpells`, the same function
 * the builder screen previews with, so what the page showed and what the table
 * shuffles are one computation rather than two that agree today.
 *
 * Indices rather than ids for the reason `@mtg/ui`'s `sealed.ts` gives: six
 * packs routinely open the same common three times, and three copies are three
 * separate things to include or cut.
 *
 * # Why the pool goes out as ids, and where the cards come from
 *
 * The page draws the cards, so it needs them; sending ids rather than whole
 * cards keeps a 90-card pool inside a couple of kilobytes and keeps the poll
 * small. What it does *not* do is assume the page already holds them. It used
 * to: the ids were resolved against whatever set the tab had open, and since
 * the lab stages every set it found and lets a person switch between them, a
 * room dealt from one set and read by a tab on another refused a pool that was
 * perfectly good. So the room carries its `set` and the server serves it
 * (`GET /api/room/:token/set`), and the ids are resolved against the set they
 * were printed in rather than against the reader's current choice.
 *
 * # A bot seat is already built
 *
 * A room whose second seat has no token gets that seat's deck at open time, from
 * `buildDeck`, exactly as `dealSealedTable` would. It is free, it keeps the two
 * paths deriving the same thing, and it makes "you build, the machine plays what
 * it was dealt" a room rather than a special case.
 */
import type { Card, Color } from '@mtg/dsl';
import { COLORS } from '@mtg/dsl';
import { buildDeck, buildFromSpells, openSealedPool } from '@mtg/deckbuild';
import type { BasicLandCounts } from '@mtg/deckbuild';
import { DEFAULT_NATIVE_DRAFT_BOT_POLICY, DraftError, draftedPool, runSeatedDraft } from '@mtg/draft-export';
import type { NativeDraftBotPolicy, SeatedDraftProgress } from '@mtg/draft-export';
import type { DeckList, PlayerId } from '@mtg/kernel';
import { poolSeedFor, tableSpecFor } from './deal';
import type { TableDealOptions } from './deal';
import { NETPLAY_PROTOCOL } from './protocol';
import { createTable } from './table';
import type { Table } from './table';

/**
 * Where a room is in its own life.
 *
 * Three states in order, and a room enters at either of the first two: a sealed
 * room opens on `build` with a pool already dealt, and a drafting one opens on
 * `draft` and reaches `build` holding what the two people took. `playing` is
 * the same end for both, under the same tokens.
 */
export type RoomPhase = 'draft' | 'build' | 'playing';

/** The most basics a seat may count out, which is far more than a deck holds. */
export const MAX_BASICS = 100;

/** One seat as the other side of the room sees it. */
export interface RoomSeatView {
  readonly name: string;
  /**
   * Whether this seat has done the thing the room is currently waiting on.
   *
   * One field for two questions on purpose, because the page asks one: during
   * the draft it is *has taken this pick*, and during the build it is *has sent
   * a deck*. What a screen does with it — waiting for Sam — is the same
   * sentence either way, and a second field would be a second thing to keep in
   * step with the phase.
   */
  readonly ready: boolean;
}

/**
 * The pack in front of this seat, while it owes a pick.
 *
 * Null whenever nothing is owed: between picks in a drafting room (the other
 * seat has not answered yet), and always in one that is not drafting. The cards
 * are ids for the reason the pool is — the room serves the set they are printed
 * in — and a pick addresses this list by position, so a pick of a card that is
 * not in the pack is unsayable rather than merely refused.
 */
export interface RoomPackView {
  readonly cards: readonly string[];
  /** 1-based pack round, which is how far through the draft this is. */
  readonly round: number;
  /** 1-based pick within the round. Pick 1 of 15 reads differently from 15. */
  readonly pickNumber: number;
}

/**
 * What one seat is told about the room it is sitting in.
 *
 * `pool` is *this* seat's pool and no other: the other seat's cards are not in
 * the bytes, for the same reason `table.ts` conceals a hand. A room is not a
 * game yet, but the pool somebody is building from is theirs.
 */
export interface RoomView {
  readonly protocol: number;
  readonly room: string;
  readonly phase: RoomPhase;
  readonly seat: PlayerId;
  readonly seats: readonly RoomSeatView[];
  /** Rises on every accepted submission, so a page can poll for a change. */
  readonly revision: number;
  /**
   * This seat's pool, as card ids in pool order. Indices address it.
   *
   * In a drafting room it is what this seat has taken so far, growing by one
   * card per pick, and it becomes the build pool when the last pack empties.
   * Same field, because it is the same thing at two moments: the cards this
   * person has to build a deck out of.
   */
  readonly pool: readonly string[];
  /** The deck size the room will accept, so the page can count down to it. */
  readonly deckSize: number;
  /** The pack this seat owes a pick from, or null. See `RoomPackView`. */
  readonly pack: RoomPackView | null;
  /** Packs each seat opens. Zero in a room that deals sealed pools. */
  readonly rounds: number;
  /** The replay-stable automated-seat policy, or null for a sealed room. */
  readonly draftBotPolicy: NativeDraftBotPolicy | null;
}

/** One seat's built deck, as it crosses the wire. */
export interface RoomBuild {
  /** Pool indices, each addressing one physical card in this seat's pool. */
  readonly chosen: readonly number[];
  /** The basics counted out, or null to let the builder apportion them. */
  readonly basics: BasicLandCounts | null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A submission off the wire, or the reason it is not one.
 *
 * The reading side's own validator, which is the rule everywhere on this seam:
 * the sender is the thing that might be wrong. The range check is not here —
 * this function does not know how big a pool is — but everything that can be
 * decided from the bytes alone is, so `submit` is left with one question rather
 * than eight.
 */
export function readRoomBuild(value: unknown): RoomBuild | string {
  if (!isRecord(value)) return 'a build is an object';
  const chosen: unknown = value['chosen'];
  if (!Array.isArray(chosen)) return 'a build names the pool indices it plays';
  const indices: number[] = [];
  for (const entry of chosen) {
    if (typeof entry !== 'number' || !Number.isSafeInteger(entry) || entry < 0) {
      return 'every chosen card is a whole pool index';
    }
    indices.push(entry);
  }
  if (new Set(indices).size !== indices.length) return 'the same card is played twice';
  const basics: unknown = value['basics'];
  if (basics === null || basics === undefined) return { chosen: indices, basics: null };
  if (!isRecord(basics)) return 'the basics are counted by color';
  const counted: Partial<Record<Color, number>> = {};
  let total = 0;
  for (const [key, count] of Object.entries(basics)) {
    if (!(COLORS as readonly string[]).includes(key)) return `${key} is not a color`;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      return 'a basic land count is a whole number of lands';
    }
    total += count;
    counted[key as Color] = count;
  }
  if (total > MAX_BASICS) return `a mana base of ${String(total)} lands is more than any deck plays`;
  return { chosen: indices, basics: counted };
}

/**
 * A pick off the wire, or the reason it is not one.
 *
 * One number, addressing the pack this seat was shown. The shape is this small
 * because everything else about a pick — which pack, which round, whose turn —
 * is state the server holds and the sender has no business restating; a body
 * that named the round could disagree with the room about what round it is.
 */
export function readRoomPick(value: unknown): number | string {
  if (!isRecord(value)) return 'a pick is an object';
  const pick: unknown = value['pick'];
  if (typeof pick !== 'number' || !Number.isSafeInteger(pick) || pick < 0) {
    return 'a pick is a whole position in the pack';
  }
  return pick;
}

/**
 * A pre-game room: two pools, two decks on their way, one table at the end.
 *
 * The shape mirrors `Table` on purpose — `seatOf` goes token to seat and never
 * back, and `revision` is what a poll compares — because the server holds the
 * two in one list and a page moves from one to the other without changing links.
 */
export interface Room {
  readonly id: string;
  /**
   * The set this room deals from, which is the set its pool ids are printed in.
   *
   * Carried rather than left to the page, because the page has its own set and
   * the two are not the same thing: the lab stages every set it found and lets
   * a person switch between them, so *whatever this tab has open* is a fact
   * about the reader and not about the room. A pool resolved against it drew
   * "this lab has no card for m13-194" over a pool that was perfectly good.
   * The server holds the one set the pool was cut from and this is how it says
   * so; `server.ts` serves it, and `@mtg/ui`'s room screen draws from it.
   */
  readonly set: readonly Card[];
  /** The seat a capability addresses, or null. Never the inverse. */
  seatOf(token: string): PlayerId | null;
  viewFor(seat: PlayerId): RoomView;
  /** Records this seat's deck, or says in one sentence why it did not. */
  submit(seat: PlayerId, build: RoomBuild): string | null;
  /**
   * Takes this seat's pick out of the pack in front of it, by position, or says
   * in one sentence why it did not. Only a drafting room answers it.
   */
  pick(seat: PlayerId, index: number): string | null;
  /** The table, once every seat has built. Null until then. */
  table(): Table | null;
  readonly revision: number;
}

interface RoomSeat {
  readonly name: string;
  readonly token: string | null;
  /** Mutable, because a drafting room fills it one pick at a time. */
  pool: readonly Card[];
  deck: DeckList | null;
}

/**
 * What makes a room a drafting one, stated by the launcher that opened it.
 *
 * Absent means sealed, which is the room `mtg-j73a` shipped and still the
 * default: a flag rather than a second kind of object, because everything after
 * the last pick is identical — the same build screen, the same submission, the
 * same table under the same tokens.
 */
export interface RoomDraftPlan {
  /** Packs each seat opens. `@mtg/draft-export`'s own default when absent. */
  readonly packs?: number | undefined;
  /** Automated-seat policy. Defaults to the strongest native policy. */
  readonly botPolicy?: NativeDraftBotPolicy | undefined;
}

/** A room's inputs: a table's, plus how it deals the cards. */
export interface RoomOptions extends TableDealOptions {
  readonly draft?: RoomDraftPlan | undefined;
}

/**
 * Opens a room over the same inputs a sealed table is dealt from.
 *
 * `TableDealOptions` unchanged, and the pool seeds are `deal.ts`'s own, so the
 * table seed still names the whole match: the same string that would have dealt
 * two built decks now deals the two pools they are built out of.
 */
export function openRoom(options: RoomOptions): Room {
  const seats: readonly [RoomSeat, RoomSeat] = [openSeat(options, 0), openSeat(options, 1)];
  let table: Table | null = null;
  let revision = 0;

  const start = (): void => {
    const first = seats[0].deck;
    const second = seats[1].deck;
    if (first === null || second === null) return;
    table = createTable(
      tableSpecFor(options, [first, second], options.draft === undefined ? 'sealed' : 'draft'),
    );
  };

  // Every seat with a token is a person; the rest of the pod is the bot the
  // draft loop already has. A sealed room has no pod at all, and `draft` is
  // null forever.
  const people = seats.flatMap((seat, index) => (seat.token === null ? [] : [index]));
  const logs: [string[], string[]] = [[], []];
  const draft = options.draft;
  const draftBotPolicy = draft === undefined ? null : (draft.botPolicy ?? DEFAULT_NATIVE_DRAFT_BOT_POLICY);

  /**
   * The draft as it stands, recomputed from the seed and the two pick logs.
   *
   * Recomputing rather than holding a pod is `runSeatedDraft`'s own decision and
   * the reason this room can be asked anything at any time: the durable state is
   * a seed and two lists of card ids, so a page that reloads, a seat that polls
   * twice, and a room that has been sitting idle all reconstruct one draft.
   */
  const replay = (): SeatedDraftProgress =>
    runSeatedDraft(options.set, {
      seats: seats.length,
      ...(draft?.packs === undefined ? {} : { packs: draft.packs }),
      ...(draftBotPolicy === null ? {} : { botPolicy: draftBotPolicy }),
      seed: `${options.seed}/draft`,
      humanSeats: people,
      picks: { 0: logs[0], 1: logs[1] },
    });

  /**
   * Hands each seat what it has taken, and closes the draft when it is over.
   *
   * The pool grows a card at a time and is the same field the build phase reads,
   * so nothing converts a draft into a sealed pool: the two phases are the same
   * screen looking at the same list at two moments.
   */
  const settle = (progress: SeatedDraftProgress): SeatedDraftProgress => {
    const finished = progress.result;
    for (const [index, seat] of seats.entries()) {
      const drafted = (finished ?? progress).seats[index];
      seat.pool = drafted === undefined ? [] : draftedPool(drafted);
      if (finished !== null && seat.token === null && seat.deck === null) {
        seat.deck = { name: `${seat.name} drafted`, cards: buildDeck(seat.pool).deck };
      }
    }
    if (finished !== null) start();
    return progress;
  };

  let progress: SeatedDraftProgress | null = draft === undefined ? null : settle(replay());
  // A seat nobody is sitting in has already built, which is what makes a room
  // with one human a room rather than a game that never starts. A drafting room
  // reaches this through `settle`, once there is a pool to build from.
  start();

  /** The pack this seat owes a pick from, or null when it owes none. */
  const packFor = (seat: PlayerId): RoomPackView | null => {
    const owed = progress?.owed.find((choice) => choice.seat === seat);
    if (owed === undefined) return null;
    return {
      cards: owed.cards.map((card) => card.id),
      round: owed.round,
      pickNumber: owed.pickNumber,
    };
  };

  /**
   * What the room is waiting on this seat for.
   *
   * During the draft that is the current pick and during the build it is a
   * deck, which is the two readings `RoomSeatView.ready` carries.
   */
  const readyAt = (seat: RoomSeat, index: number): boolean =>
    progress !== null && progress.result === null
      ? !progress.owed.some((choice) => choice.seat === index)
      : seat.deck !== null;

  const phaseNow = (): RoomPhase => {
    if (table !== null) return 'playing';
    return progress !== null && progress.result === null ? 'draft' : 'build';
  };

  return {
    id: options.id,
    set: options.set,
    seatOf(token: string): PlayerId | null {
      if (token.length === 0) return null;
      if (seats[0].token === token) return 0;
      if (seats[1].token === token) return 1;
      return null;
    },
    viewFor(seat: PlayerId): RoomView {
      const mine = seats[seat];
      return {
        protocol: NETPLAY_PROTOCOL,
        room: options.id,
        phase: phaseNow(),
        seat,
        seats: seats.map((entry, index) => ({ name: entry.name, ready: readyAt(entry, index) })),
        revision,
        pool: mine.pool.map((card) => card.id),
        deckSize: deckSizeOf(mine.pool, options.set),
        pack: packFor(seat),
        rounds: progress?.rounds ?? 0,
        draftBotPolicy,
      };
    },
    pick(seat: PlayerId, index: number): string | null {
      if (progress === null) return 'this room deals sealed pools; there is nothing to draft';
      if (progress.result !== null) return 'this draft is over';
      const owed = progress.owed.find((choice) => choice.seat === seat);
      if (owed === undefined) return 'this seat has already picked; the other one has not';
      const card = owed.cards[index];
      if (card === undefined) return `this pack has no card at position ${String(index)}`;
      const log = logs[seat];
      log.push(card.id);
      try {
        progress = settle(replay());
      } catch (cause: unknown) {
        // A refused replay is a bug rather than a bad request, and the log is
        // rolled back so the room stays the room the other seat is looking at.
        log.pop();
        return cause instanceof DraftError ? cause.message : String(cause);
      }
      revision += 1;
      return null;
    },
    submit(seat: PlayerId, build: RoomBuild): string | null {
      if (table !== null) return 'this table has already started';
      if (progress !== null && progress.result === null) return 'this draft is not over yet';
      const mine = seats[seat];
      const spells: Card[] = [];
      for (const index of build.chosen) {
        const card = mine.pool[index];
        if (card === undefined) return `this pool has no card at position ${String(index)}`;
        spells.push(card);
      }
      const config = { set: options.set };
      const deck =
        build.basics === null
          ? buildFromSpells(spells, mine.pool, config)
          : buildFromSpells(spells, mine.pool, config, build.basics);
      if (!deck.complete) {
        return `that deck is ${String(deck.deck.length)} cards; this table plays ${String(deck.config.deckSize)}`;
      }
      mine.deck = { name: `${mine.name} ${progress === null ? 'sealed' : 'drafted'}`, cards: deck.deck };
      revision += 1;
      start();
      return null;
    },
    table(): Table | null {
      return table;
    },
    get revision(): number {
      return revision;
    },
  };
}

/**
 * The deck size this room accepts, asked of the builder rather than stated.
 *
 * `buildFromSpells` carries the resolved config, and the number a page counts
 * down to has to be the number `submit` will check against. Asking an empty
 * build for it is cheap and leaves exactly one place where that number lives.
 */
function deckSizeOf(pool: readonly Card[], set: readonly Card[]): number {
  return buildFromSpells([], pool, { set }).config.deckSize;
}

/**
 * One seat, with the pool it opens.
 *
 * A drafting seat opens nothing: its pool is what it takes, and until the first
 * pick that is an empty list. Which is also why a bot seat in a drafting room
 * has no deck yet — there is nothing to build one out of — and why `settle`
 * rather than this function is where a bot's drafted deck comes from.
 */
function openSeat(options: RoomOptions, seat: PlayerId): RoomSeat {
  const plan = options.plan[seat];
  if (options.draft !== undefined) return { name: plan.name, token: plan.token, pool: [], deck: null };
  const pool = openSealedPool(options.set, {
    seed: poolSeedFor(options.seed, seat),
    ...(options.boosters === undefined ? {} : { boosters: options.boosters }),
  });
  return {
    name: plan.name,
    token: plan.token,
    pool: pool.cards,
    deck: plan.token === null ? { name: `${plan.name} sealed`, cards: buildDeck(pool.cards).deck } : null,
  };
}
