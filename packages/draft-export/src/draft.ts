/**
 * The pick loop: a set, eight seats, three packs each, and a pool per seat.
 *
 * `mtg-bc2.116` asked whether the loop is ours or Draftmancer's. It is ours,
 * and the reason is availability rather than preference: running a real
 * self-hosted Draftmancer against the emitted file is the shape that buys
 * evidence about the *file*, and it needs a clone and an install, neither of
 * which this environment permits. So this is the other shape — the seat model
 * and the pick loop in TypeScript over the ratings `rateCards` already computes
 * — and it settles nothing in ADR-0003 §3. Those seven guesses stay open, the
 * first real import is still the test that closes them, and this loop adds an
 * eighth thing for that import to check: that these picks are the picks
 * Draftmancer makes. What it does buy is a draft that runs in CI, seeded, over
 * the collation the export already compiles.
 *
 * Everything a bot knows is `simple-bot.ts`, which mirrors ADR-0003 §1's
 * reading of `SimpleBot`. No model is consulted: the bot is arithmetic by
 * design, because the number it reasons over is the one we emit.
 *
 * Seeded end to end. Two runs at one seed produce identical pick sequences, and
 * the seeding is structural rather than incidental: every pack and every
 * tie-break draws from a stream named after its position in the draft, so a
 * pick cannot move because the loop visited the seats in another order.
 *
 * Packs pass left in the first round and alternate after it, which is the
 * paper convention and Draftmancer's. All seats pick from their current pack
 * before any pack moves, so a draft is a sequence of simultaneous rounds rather
 * than a turn order.
 */
import type { BoosterRecipe, CardScoreWeights } from '@mtg/deckbuild';
import { boosterRecipeFor } from '@mtg/deckbuild';
import type { Card } from '@mtg/dsl';
import type { DraftmancerLayouts, DraftmancerSheet } from './collation';
import { buildLayouts, buildSheets, collationReport, formatCollationReport } from './collation';
import { DraftError } from './errors';
import { openPackFromLayouts } from './packs';
import type { CardRating } from './rating';
import { rateCards } from './rating';
import { createRng } from './rng';
import { simpleBotPick } from './simple-bot';

/** A full pod. Draftmancer seats eight by default and so does paper Limited. */
export const DEFAULT_SEATS = 8;

/** Packs each seat opens, one per round. Three is the format's default. */
export const DEFAULT_PACKS_PER_SEAT = 3;

export const DEFAULT_DRAFT_SEED = 'draft/v0';

/** `+1` passes to the next seat, `-1` to the previous one. */
export type PassDirection = 1 | -1;

export interface DraftOptions {
  readonly seed?: string;
  readonly seats?: number;
  /** Packs per seat; one round is opened per pack. */
  readonly packs?: number;
  /** The pack every seat opens. Defaults to the recipe derived from the set. */
  readonly recipe?: BoosterRecipe;
  /** Scoring weights behind the ratings. Defaults to the deck builder's. */
  readonly weights?: CardScoreWeights;
}

/** Inputs that make one seat a person while every other seat keeps the simple bot. */
export interface HumanDraftOptions extends DraftOptions {
  /** The seat whose choices come from `picks`. Defaults to seat zero. */
  readonly humanSeat?: number;
  /** Card ids in pick order. An omitted next entry pauses the draft for a choice. */
  readonly picks?: readonly string[];
}

export interface DraftPick {
  /** 1-based pack round. */
  readonly round: number;
  /** 1-based pick within the round: pick 1 of 12 is a different read from 12 of 12. */
  readonly pickNumber: number;
  readonly seat: number;
  readonly card: Card;
  /** Cards in the pack when this pick was made. */
  readonly packSize: number;
  /**
   * The seat that opened this pack, which is a pack's identity for the round.
   * It is also where the direction of passing is legible: in a round that
   * passes to the next seat, pick `n` comes from the pack opened `n - 1` seats
   * back.
   */
  readonly openedBy: number;
}

export interface DraftSeat {
  readonly seat: number;
  /** Every card this seat took, in pick order. `draftedPool` is the deck seam. */
  readonly picks: readonly DraftPick[];
}

export interface DraftResult {
  readonly seed: string;
  readonly seats: readonly DraftSeat[];
  readonly rounds: number;
  /** The direction each round passed, in round order. */
  readonly directions: readonly PassDirection[];
  /** Every card in the set with the rating the bots drafted on. */
  readonly ratings: readonly CardRating[];
}

/** The pack a person must choose from before the pod can advance. */
export interface HumanDraftChoice {
  readonly round: number;
  readonly pickNumber: number;
  readonly packSize: number;
  readonly openedBy: number;
  readonly cards: readonly Card[];
}

/**
 * A draft reconstructed from its seed and accepted human choices.
 *
 * `nextPick` and `result` are complementary: the first is present only while a
 * choice is owed, and the second only after every pack is empty.
 */
export interface HumanDraftProgress {
  readonly seed: string;
  readonly humanSeat: number;
  readonly picks: readonly string[];
  readonly seats: readonly DraftSeat[];
  readonly rounds: number;
  readonly directions: readonly PassDirection[];
  readonly ratings: readonly CardRating[];
  readonly nextPick: HumanDraftChoice | null;
  readonly result: DraftResult | null;
}

interface DraftContext {
  readonly sheets: readonly DraftmancerSheet[];
  readonly layouts: DraftmancerLayouts;
  readonly ratings: ReadonlyMap<string, CardRating>;
  readonly seed: string;
}

/** A pack in front of a seat. It keeps the identity of its opener as it travels. */
interface Pack {
  readonly openedBy: number;
  readonly cards: readonly Card[];
}

interface SeatState {
  readonly seat: number;
  readonly picks: readonly DraftPick[];
  readonly pack: Pack;
}

/** Round 1 passes to the next seat, and every round after it turns around. */
export function passDirection(round: number): PassDirection {
  return round % 2 === 1 ? 1 : -1;
}

function ratingOf(context: DraftContext, card: Card): CardRating {
  const rated = context.ratings.get(card.id);
  if (rated === undefined) {
    throw new DraftError(`no rating for ${card.id}; the pack holds a card the set does not`);
  }
  return rated;
}

function takePick(state: SeatState, context: DraftContext, round: number, pickNumber: number): SeatState {
  const { cards } = state.pack;
  if (cards.length === 0) return state;
  const stream = `${context.seed}/pick/${String(round)}/${String(pickNumber)}/${String(state.seat)}`;
  const [index] = simpleBotPick(
    cards.map((card) => ratingOf(context, card)),
    state.picks.map((pick) => pick.card),
    createRng(stream),
  );
  const card = cards[index];
  if (card === undefined) throw new DraftError('the bot chose a card its pack does not hold');
  const pick: DraftPick = {
    round,
    pickNumber,
    seat: state.seat,
    card,
    packSize: cards.length,
    openedBy: state.pack.openedBy,
  };
  return {
    seat: state.seat,
    picks: [...state.picks, pick],
    pack: { openedBy: state.pack.openedBy, cards: cards.filter((_unused, at) => at !== index) },
  };
}

function takeHumanPick(
  state: SeatState,
  cardId: string,
  round: number,
  pickNumber: number,
  logIndex: number,
): SeatState {
  const index = state.pack.cards.findIndex((card) => card.id === cardId);
  if (index < 0) {
    throw new DraftError(
      `human pick ${String(logIndex + 1)} (${cardId}) is not in round ${String(round)}, pick ${String(pickNumber)}`,
    );
  }
  const card = state.pack.cards[index];
  if (card === undefined) throw new DraftError('the human chose a card its pack does not hold');
  const pick: DraftPick = {
    round,
    pickNumber,
    seat: state.seat,
    card,
    packSize: state.pack.cards.length,
    openedBy: state.pack.openedBy,
  };
  return {
    seat: state.seat,
    picks: [...state.picks, pick],
    pack: {
      openedBy: state.pack.openedBy,
      cards: state.pack.cards.filter((_unused, at) => at !== index),
    },
  };
}

/** Hands each seat the pack from the seat it receives from this round. */
function passPacks(states: readonly SeatState[], direction: PassDirection): readonly SeatState[] {
  return states.map((state, index) => {
    const source = states[(index - direction + states.length) % states.length];
    if (source === undefined) throw new DraftError('a seat has no neighbor to pass to');
    return { ...state, pack: source.pack };
  });
}

function openRound(states: readonly SeatState[], context: DraftContext, round: number): readonly SeatState[] {
  return states.map((state) => {
    const stream = `${context.seed}/pack/${String(round)}/${String(state.seat)}`;
    const [cards] = openPackFromLayouts(context.sheets, context.layouts, createRng(stream));
    return { ...state, pack: { openedBy: state.seat, cards } };
  });
}

function draftRound(
  states: readonly SeatState[],
  context: DraftContext,
  round: number,
): readonly SeatState[] {
  const direction = passDirection(round);
  let current = openRound(states, context, round);
  for (let pickNumber = 1; current.some((state) => state.pack.cards.length > 0); pickNumber += 1) {
    current = passPacks(
      current.map((state) => takePick(state, context, round, pickNumber)),
      direction,
    );
  }
  return current;
}

function assertPodFits(seats: number, packs: number): void {
  if (!Number.isInteger(seats) || seats < 2) {
    throw new DraftError(
      `a draft needs at least 2 seats to pass between, got ${String(seats)}; one seat opening packs is openSealedPool`,
    );
  }
  if (!Number.isInteger(packs) || packs <= 0) {
    throw new DraftError(`packs per seat must be a positive integer, got ${String(packs)}`);
  }
}

function ratingsById(ratings: readonly CardRating[]): ReadonlyMap<string, CardRating> {
  const byId = new Map(ratings.map((rated) => [rated.card.id, rated]));
  if (byId.size !== ratings.length) {
    throw new DraftError('two cards in the set share an id; a pack could not be rated unambiguously');
  }
  return byId;
}

interface PreparedDraft {
  readonly context: DraftContext;
  readonly seats: number;
  readonly rounds: number;
  readonly ratings: readonly CardRating[];
}

function prepareDraft(cards: readonly Card[], options: DraftOptions): PreparedDraft {
  const seats = options.seats ?? DEFAULT_SEATS;
  const rounds = options.packs ?? DEFAULT_PACKS_PER_SEAT;
  assertPodFits(seats, rounds);
  if (cards.length === 0) throw new DraftError('cannot draft an empty set');

  const ratings = rateCards(cards, options.weights);
  const sheets = buildSheets(cards);
  return {
    seats,
    rounds,
    ratings,
    context: {
      sheets,
      layouts: resolveLayouts(options.recipe ?? boosterRecipeFor(cards), sheets),
      ratings: ratingsById(ratings),
      seed: options.seed ?? DEFAULT_DRAFT_SEED,
    },
  };
}

function emptySeats(seats: number): readonly SeatState[] {
  return Array.from({ length: seats }, (_unused, seat) => ({
    seat,
    picks: [],
    pack: { openedBy: seat, cards: [] },
  }));
}

function draftResult(
  context: DraftContext,
  states: readonly SeatState[],
  rounds: number,
  ratings: readonly CardRating[],
): DraftResult {
  return {
    seed: context.seed,
    seats: states.map((state) => ({ seat: state.seat, picks: state.picks })),
    rounds,
    directions: Array.from({ length: rounds }, (_unused, index) => passDirection(index + 1)),
    ratings,
  };
}

function resolveLayouts(recipe: BoosterRecipe, sheets: readonly DraftmancerSheet[]): DraftmancerLayouts {
  const layouts = buildLayouts(recipe, sheets);
  const report = collationReport(sheets, layouts);
  if (report.shortSlots.length > 0) {
    throw new DraftError(
      `this set cannot be drafted with this pack: ${formatCollationReport(report).join('; ')}`,
    );
  }
  if (Object.keys(layouts).length === 0) throw new DraftError('the recipe describes no pack layout');
  return layouts;
}

/**
 * Drafts a set. Every seat is a `SimpleBot`; the result is the pick record for
 * each of them, which `draftedPool` turns into the pool `buildDeck` takes.
 *
 * An unreachable sheet is not an error here, matching the export's own CLI: a
 * set with rares drafted from a recipe with no rare slot drafts fine, minus the
 * rares. A slot its sheet cannot fill is an error, because there is no pack.
 *
 * That tolerance is why the default recipe is `boosterRecipeFor(cards)` and not
 * a constant. Drafting fine minus the rares is the quietest way to lose a whole
 * rarity tier, and the sheet the bots never see is the tier the set was
 * generated for.
 */
export function runDraft(cards: readonly Card[], options: DraftOptions = {}): DraftResult {
  const prepared = prepareDraft(cards, options);
  let states = emptySeats(prepared.seats);
  for (let round = 1; round <= prepared.rounds; round += 1) {
    states = draftRound(states, prepared.context, round);
  }
  return draftResult(prepared.context, states, prepared.rounds, prepared.ratings);
}

/**
 * Replays a pod until its human transcript runs out or the draft finishes.
 *
 * Recomputing from the structural RNG streams is deliberate: the durable
 * document is seed plus choices, never an opaque snapshot of seven bot seats.
 * A caller appends the chosen card id and calls again, which also validates
 * every earlier choice against the pack it claims to have come from.
 */
export function runHumanDraft(cards: readonly Card[], options: HumanDraftOptions = {}): HumanDraftProgress {
  const prepared = prepareDraft(cards, options);
  const humanSeat = options.humanSeat ?? 0;
  if (!Number.isInteger(humanSeat) || humanSeat < 0 || humanSeat >= prepared.seats) {
    throw new DraftError(
      `human seat must be an integer from 0 to ${String(prepared.seats - 1)}, got ${String(humanSeat)}`,
    );
  }
  const picks = options.picks ?? [];
  let states = emptySeats(prepared.seats);
  let logIndex = 0;

  for (let round = 1; round <= prepared.rounds; round += 1) {
    states = openRound(states, prepared.context, round);
    const direction = passDirection(round);
    for (let pickNumber = 1; states.some((state) => state.pack.cards.length > 0); pickNumber += 1) {
      const human = states[humanSeat];
      if (human === undefined) throw new DraftError('the human seat disappeared from the pod');
      const logged = picks[logIndex];
      if (logged === undefined) {
        return {
          seed: prepared.context.seed,
          humanSeat,
          picks,
          seats: states.map((state) => ({ seat: state.seat, picks: state.picks })),
          rounds: prepared.rounds,
          directions: Array.from({ length: prepared.rounds }, (_unused, index) => passDirection(index + 1)),
          ratings: prepared.ratings,
          nextPick: {
            round,
            pickNumber,
            packSize: human.pack.cards.length,
            openedBy: human.pack.openedBy,
            cards: human.pack.cards,
          },
          result: null,
        };
      }
      const chosen = states.map((state) =>
        state.seat === humanSeat
          ? takeHumanPick(state, logged, round, pickNumber, logIndex)
          : takePick(state, prepared.context, round, pickNumber),
      );
      logIndex += 1;
      states = passPacks(chosen, direction);
    }
  }

  if (logIndex < picks.length) {
    throw new DraftError(
      `human pick log has ${String(picks.length - logIndex)} extra entry after the draft finished`,
    );
  }
  const result = draftResult(prepared.context, states, prepared.rounds, prepared.ratings);
  return {
    seed: result.seed,
    humanSeat,
    picks,
    seats: result.seats,
    rounds: result.rounds,
    directions: result.directions,
    ratings: result.ratings,
    nextPick: null,
    result,
  };
}
