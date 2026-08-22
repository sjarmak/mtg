/**
 * A set on disk to a table two people can sit down at.
 *
 * Each seat opens its own six packs from the same set and gets the deck
 * `@mtg/deckbuild` would build out of them, which is what a sealed match is
 * minus the part this lane deliberately does not build: **nobody cuts their own
 * deck over the wire.** A networked deckbuilder is a second screen, a second
 * ready state and a second protocol, and none of it is what "two people on two
 * machines play a game" needed. `@mtg/ui`'s `deal.ts` says the same thing about
 * the hot-seat path and for the same reason. When somebody wants it, it is a
 * phase before this one rather than a change to it: the output is still a
 * `GameSetup` with two decks in it.
 *
 * Both pool seeds derive from the table seed, so a whole match — the two pools,
 * the two builds, the two shuffles — reproduces from one string.
 */
import type { Card } from '@mtg/dsl';
import { buildDeck, buildPrecon, openSealedPool } from '@mtg/deckbuild';
import type { PreconDeck } from '@mtg/deckbuild';
import type { DeckList, GameSetup, PlayerId, Seat } from '@mtg/kernel';
import { botSeat, humanSeat, simpleAgent } from '@mtg/kernel';
import type { TableSeating, TableSpec } from './table';

/** Who is sitting in a seat, and what to call them. */
export interface SeatPlan {
  readonly name: string;
  /**
   * The capability that addresses this seat, or null to seat a bot there.
   *
   * The caller mints it, because minting one needs a random source and this
   * module has no business reaching for one — `@mtg/ui` must be able to import
   * this package without a Node built-in arriving in a browser bundle.
   */
  readonly token: string | null;
}

export interface TableDealOptions {
  readonly id: string;
  readonly set: readonly Card[];
  readonly seed: string;
  readonly plan: readonly [SeatPlan, SeatPlan];
  /** Packs per seat; `openSealedPool`'s own default when absent. */
  readonly boosters?: number | undefined;
  readonly maximumTurns?: number | undefined;
}

export interface DealtTable {
  readonly spec: TableSpec;
  /** Seat-indexed, so an operator can print what each side is playing. */
  readonly decks: readonly [DeckList, DeckList];
}

export interface PreconTableDealOptions extends TableDealOptions {
  /** The written list each seat is testing, in seat order. */
  readonly decks: readonly [PreconDeck, PreconDeck];
}

/**
 * The kernel seat for a plan.
 *
 * A bot seat takes the kernel's own `simpleAgent` rather than one of
 * `@mtg/sim`'s, and that is a constraint rather than a preference: the sim's
 * bots reach `node:worker_threads` through their runner, and this package is
 * imported by a browser bundle.
 */
function seatFor(plan: SeatPlan): Seat {
  return plan.token === null ? botSeat(simpleAgent(plan.name)) : humanSeat(plan.name);
}

function seatingFor(plan: SeatPlan): TableSeating {
  return { name: plan.name, token: plan.token };
}

function sealedDeck(set: readonly Card[], seed: string, name: string, boosters?: number): DeckList {
  const pool = openSealedPool(set, { seed, ...(boosters === undefined ? {} : { boosters }) });
  return { name: `${name} sealed`, cards: buildDeck(pool.cards).deck };
}

function tableSpec(options: TableDealOptions, decks: readonly [DeckList, DeckList]): TableSpec {
  const [first, second] = options.plan;
  const setup: GameSetup = {
    seed: options.seed,
    decks,
    ...(options.maximumTurns === undefined ? {} : { maximumTurns: options.maximumTurns }),
  };
  return {
    id: options.id,
    setup,
    seats: [seatFor(first), seatFor(second)],
    seating: [seatingFor(first), seatingFor(second)],
  };
}

export function dealSealedTable(options: TableDealOptions): DealtTable {
  const [first, second] = options.plan;
  const decks: readonly [DeckList, DeckList] = [
    sealedDeck(options.set, `${options.seed}/seat0`, first.name, options.boosters),
    sealedDeck(options.set, `${options.seed}/seat1`, second.name, options.boosters),
  ];
  return { decks, spec: tableSpec(options, decks) };
}

/** Turns two authored deck lists into the same concealed table as sealed play. */
export function dealPreconTable(options: PreconTableDealOptions): DealtTable {
  const decks: readonly [DeckList, DeckList] = [
    { name: options.decks[0].name, cards: buildPrecon(options.decks[0], options.set).deck },
    { name: options.decks[1].name, cards: buildPrecon(options.decks[1], options.set).deck },
  ];
  return { decks, spec: tableSpec(options, decks) };
}

/** The seats a person is sitting in, which is what the launcher prints links for. */
export function humanSeatsOf(plan: readonly [SeatPlan, SeatPlan]): readonly PlayerId[] {
  const seats: PlayerId[] = [];
  if (plan[0].token !== null) seats.push(0);
  if (plan[1].token !== null) seats.push(1);
  return seats;
}
