/**
 * The pick loop: a set, eight seats, three packs each, and a pool per seat.
 *
 * `mtg-bc2.116` asked whether the loop is ours or Draftmancer's. It is ours,
 * and the reason is availability rather than preference: running a real
 * self-hosted Draftmancer against the emitted file is the shape that buys
 * evidence about the *file*, and it needs a clone and an install, neither of
 * which this environment permits. So this is the other shape — the seat model
 * and the pick loop in TypeScript over typed card semantics and the ratings
 * `rateCards` already computes. What it buys is a draft that runs in CI,
 * seeded, over the collation the export already compiles.
 *
 * Native seats default to `native-draft-bot.ts`: a versioned policy that
 * reprices each visible candidate against the observed pool and projects the
 * resulting deck. `simple-bot.ts` remains the separately named Draftmancer
 * export mirror and the replay policy for drafts created before this change.
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
import type { BoosterRecipe, CardEvaluation, CardScoreWeights, PackCollation } from '@mtg/deckbuild';
import { boosterRecipeFor, DEFAULT_SCORE_WEIGHTS, evaluateCard } from '@mtg/deckbuild';
import type { BotEvidenceEpisode } from '@mtg/bot-evidence';
import type { Card } from '@mtg/dsl';
import type { DraftmancerLayouts, DraftmancerSheet } from './collation';
import { buildLayouts, buildSheets, collationReport, formatCollationReport } from './collation';
import type { PassDirection } from './draft-structure';
import { passDirection } from './draft-structure';
import type { DraftDecisionEvidence, DraftEvidenceRequest } from './draft-evidence';
import { completedDraftEvidence, draftDecisionEvidence, draftEvidenceIdentity } from './draft-evidence';
import { DraftError } from './errors';
import {
  DEFAULT_NATIVE_DRAFT_BOT_POLICY,
  DRAFTMANCER_SIMPLE_BOT_POLICY,
  nativeDraftPick,
  type NativeDraftBotPolicy,
} from './native-draft-bot';
import type { PackSource } from './pack-source';
import { collationPackSource, layoutPackSource } from './pack-source';
import type { EvaluatorRating } from './rating';
import { rateCards } from './rating';
import { createRng } from './rng';
import { simpleBotPick } from './simple-bot';

/** A full pod. Draftmancer seats eight by default and so does paper Limited. */
export const DEFAULT_SEATS = 8;

/** Packs each seat opens, one per round. Three is the format's default. */
export const DEFAULT_PACKS_PER_SEAT = 3;

export const DEFAULT_DRAFT_SEED = 'draft/v0';

export { passDirection };
export type { PassDirection };

export interface DraftOptions {
  readonly seed?: string;
  readonly seats?: number;
  /** Packs per seat; one round is opened per pack. */
  readonly packs?: number;
  /** The pack every seat opens. Defaults to the recipe derived from the set. */
  readonly recipe?: BoosterRecipe;
  /**
   * The printing's own sheets, when the set carries them. A set collated this
   * way is dealt by `openCollatedPool`, exactly as its sealed pools are, so the
   * Draft tab and the Play tab open the same pack; a set without them keeps the
   * rarity recipe. Passing both is refused rather than resolved, because a
   * recipe and a collation are two answers to one question.
   */
  readonly collation?: PackCollation;
  /** Scoring weights behind the ratings. Defaults to the deck builder's. */
  readonly weights?: CardScoreWeights;
  /** Versioned policy used by every automated seat. Defaults to strongest native play. */
  readonly botPolicy?: NativeDraftBotPolicy;
  /** Collect the bot's visible pick context and final pools in the shared evidence schema. */
  readonly evidence?: DraftEvidenceRequest | null;
}

/** Inputs that make one seat a person while every other seat uses the selected bot policy. */
export interface HumanDraftOptions extends Omit<DraftOptions, 'evidence'> {
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
  readonly ratings: readonly EvaluatorRating[];
  readonly botPolicy: NativeDraftBotPolicy;
  /** Present only when evidence collection was requested. */
  readonly evidence?: BotEvidenceEpisode;
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
  readonly ratings: readonly EvaluatorRating[];
  readonly botPolicy: NativeDraftBotPolicy;
  readonly nextPick: HumanDraftChoice | null;
  readonly result: DraftResult | null;
}

/**
 * Inputs for a draft where more than one seat is a person.
 *
 * `HumanDraftOptions` above is one person against seven bots, which is a draft
 * lab with a pick log. This is the same replay with a *set* of people in it,
 * and it exists because two of them cannot be reached by that shape: a pod
 * advances a pick only when every seat has taken one, so a second person is a
 * second log the loop has to wait on rather than a second call to the first
 * function. `runHumanDraft` is now a facade over `runSeatedDraft`, so there is
 * one pick loop and the one-person case cannot drift from the two-person one.
 */
export interface SeatedDraftOptions extends Omit<DraftOptions, 'evidence'> {
  /** The seats a person sits in. Every other seat uses the selected bot policy. */
  readonly humanSeats?: readonly number[];
  /** Card ids in pick order, per seat. A seat with no log owes pick one. */
  readonly picks?: Readonly<Record<number, readonly string[]>>;
}

/** A pack in front of one person, and the pick it is waiting on. */
export interface SeatedDraftChoice extends HumanDraftChoice {
  readonly seat: number;
}

/**
 * A draft reconstructed from its seed and every accepted choice.
 *
 * `owed` is the whole of what a caller waits on: it holds one entry per person
 * who has not answered the *current* pick, so a person who has already picked
 * simply is not in it and the draft advances when it empties. `result` is
 * present only once every pack is empty, and the two are complementary the way
 * `nextPick` and `result` are on the single-seat progress.
 */
export interface SeatedDraftProgress {
  readonly seed: string;
  readonly humanSeats: readonly number[];
  readonly picks: Readonly<Record<number, readonly string[]>>;
  readonly seats: readonly DraftSeat[];
  readonly rounds: number;
  readonly directions: readonly PassDirection[];
  readonly ratings: readonly EvaluatorRating[];
  readonly botPolicy: NativeDraftBotPolicy;
  /** Everyone who still owes the current pick. Empty when the draft is over. */
  readonly owed: readonly SeatedDraftChoice[];
  readonly result: DraftResult | null;
}

interface DraftContext {
  readonly openPack: PackSource;
  readonly ratings: ReadonlyMap<string, EvaluatorRating>;
  readonly contextFree: ReadonlyMap<string, CardEvaluation>;
  readonly seed: string;
  readonly botPolicy: NativeDraftBotPolicy;
  readonly weights: CardScoreWeights | undefined;
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

function ratingOf(context: DraftContext, card: Card): EvaluatorRating {
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
  const rated = cards.map((card) => ratingOf(context, card));
  const picked = state.picks.map((pick) => pick.card);
  const rng = createRng(stream);
  const [index] =
    context.botPolicy === DRAFTMANCER_SIMPLE_BOT_POLICY
      ? simpleBotPick(rated, picked, rng)
      : nativeDraftPick(rated, picked, rng, {
          ratings: context.ratings,
          contextFree: context.contextFree,
          ...(context.weights === undefined ? {} : { weights: context.weights }),
        });
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
    return { ...state, pack: { openedBy: state.seat, cards: context.openPack(stream) } };
  });
}

interface DraftRoundResult {
  readonly states: readonly SeatState[];
  readonly decisions: readonly DraftDecisionEvidence[];
}

function draftRound(
  states: readonly SeatState[],
  context: DraftContext,
  round: number,
  sequence: number,
  collectEvidence: boolean,
): DraftRoundResult {
  const direction = passDirection(round);
  let current = openRound(states, context, round);
  let decisions: readonly DraftDecisionEvidence[] = [];
  for (let pickNumber = 1; current.some((state) => state.pack.cards.length > 0); pickNumber += 1) {
    const before = current;
    const chosen = current.map((state) => takePick(state, context, round, pickNumber));
    if (collectEvidence) {
      const pickDecisions = before.flatMap((state, index) => {
        if (state.pack.cards.length === 0) return [];
        const chosenState = chosen[index];
        const pick = chosenState?.picks.at(-1);
        if (pick === undefined) throw new DraftError('a bot pick disappeared before evidence collection');
        return [
          draftDecisionEvidence(
            {
              round,
              pickNumber,
              seat: state.seat,
              openedBy: state.pack.openedBy,
              pack: state.pack.cards,
              pool: state.picks.map((prior) => prior.card),
            },
            pick.card,
            sequence +
              decisions.length +
              before.slice(0, index).filter((earlier) => earlier.pack.cards.length > 0).length,
          ),
        ];
      });
      decisions = [...decisions, ...pickDecisions];
    }
    current = passPacks(chosen, direction);
  }
  return { states: current, decisions };
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

function ratingsById(ratings: readonly EvaluatorRating[]): ReadonlyMap<string, EvaluatorRating> {
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
  readonly ratings: readonly EvaluatorRating[];
}

function prepareDraft(cards: readonly Card[], options: DraftOptions): PreparedDraft {
  const seats = options.seats ?? DEFAULT_SEATS;
  const rounds = options.packs ?? DEFAULT_PACKS_PER_SEAT;
  assertPodFits(seats, rounds);
  if (cards.length === 0) throw new DraftError('cannot draft an empty set');

  if (options.collation !== undefined && options.recipe !== undefined) {
    throw new DraftError("a draft takes either the printing's collation or a booster recipe, not both");
  }
  const ratings = rateCards(cards, options.weights);
  const weights = options.weights ?? DEFAULT_SCORE_WEIGHTS;
  return {
    seats,
    rounds,
    ratings,
    context: {
      openPack: resolvePackSource(cards, options),
      ratings: ratingsById(ratings),
      contextFree: new Map(cards.map((card) => [card.id, evaluateCard(card, weights)])),
      seed: options.seed ?? DEFAULT_DRAFT_SEED,
      botPolicy: options.botPolicy ?? DEFAULT_NATIVE_DRAFT_BOT_POLICY,
      weights,
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
  ratings: readonly EvaluatorRating[],
): DraftResult {
  return {
    seed: context.seed,
    seats: states.map((state) => ({ seat: state.seat, picks: state.picks })),
    rounds,
    directions: Array.from({ length: rounds }, (_unused, index) => passDirection(index + 1)),
    ratings,
    botPolicy: context.botPolicy,
  };
}

/**
 * The printing's sheets when it has them, the rarity recipe when it does not.
 *
 * The recipe arm keeps `resolveLayouts`'s check, which refuses a set whose
 * sheet cannot fill its own slot before a pack is opened. The collated arm has
 * the same check inside `openCollatedPool`, which resolves every sheet and
 * every slot up front for the same reason, so neither arm discovers a short
 * pack on round three.
 */
function resolvePackSource(cards: readonly Card[], options: DraftOptions): PackSource {
  if (options.collation !== undefined) return collationPackSource(cards, options.collation);
  const sheets = buildSheets(cards);
  return layoutPackSource(sheets, resolveLayouts(options.recipe ?? boosterRecipeFor(cards), sheets));
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
 * Drafts a set. Every seat uses the selected versioned policy; the result is
 * the pick record `draftedPool` turns into the pool `buildDeck` takes.
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
  const seed = options.seed ?? DEFAULT_DRAFT_SEED;
  const botPolicy = options.botPolicy ?? DEFAULT_NATIVE_DRAFT_BOT_POLICY;
  if (
    options.evidence !== undefined &&
    options.evidence !== null &&
    options.evidence.behavior.policyId !== botPolicy
  ) {
    throw new DraftError(
      `draft evidence policy ${options.evidence.behavior.policyId} does not match runtime policy ${botPolicy}`,
    );
  }
  const identity =
    options.evidence === undefined || options.evidence === null
      ? null
      : draftEvidenceIdentity(options.evidence, seed);
  const prepared = prepareDraft(cards, options);
  let states = emptySeats(prepared.seats);
  let decisions: readonly DraftDecisionEvidence[] = [];
  for (let round = 1; round <= prepared.rounds; round += 1) {
    const result = draftRound(states, prepared.context, round, decisions.length, identity !== null);
    states = result.states;
    decisions = [...decisions, ...result.decisions];
  }
  const result = draftResult(prepared.context, states, prepared.rounds, prepared.ratings);
  if (identity === null) return result;
  return {
    ...result,
    evidence: completedDraftEvidence(identity, decisions, {
      rounds: result.rounds,
      directions: result.directions,
      seats: result.seats.map((seat) => ({
        seat: seat.seat,
        picks: seat.picks.map((pick) => pick.card.id),
      })),
    }),
  };
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
  const { humanSeat: seat, picks: log, ...rest } = options;
  const humanSeat = seat ?? 0;
  const picks = log ?? [];
  const progress = runSeatedDraft(cards, { ...rest, humanSeats: [humanSeat], picks: { [humanSeat]: picks } });
  const owed = progress.owed[0];
  return {
    seed: progress.seed,
    humanSeat,
    picks,
    seats: progress.seats,
    rounds: progress.rounds,
    directions: progress.directions,
    ratings: progress.ratings,
    botPolicy: progress.botPolicy,
    nextPick:
      owed === undefined
        ? null
        : {
            round: owed.round,
            pickNumber: owed.pickNumber,
            packSize: owed.packSize,
            openedBy: owed.openedBy,
            cards: owed.cards,
          },
    result: progress.result,
  };
}

/** A seat a person can actually sit in, checked before a pack is opened. */
function assertHumanSeat(seat: number, seats: number): void {
  if (!Number.isInteger(seat) || seat < 0 || seat >= seats) {
    throw new DraftError(`human seat must be an integer from 0 to ${String(seats - 1)}, got ${String(seat)}`);
  }
}

/**
 * Replays a pod until somebody owes a pick or every pack is empty.
 *
 * Recomputing from the structural RNG streams rather than holding a mutable
 * pod is the same decision `runHumanDraft` recorded and the reason two people
 * can draft over a wire at all: the durable document is a seed and two lists of
 * card ids, so a room that restarts, a page that reloads, or a seat that asks
 * twice all reconstruct the identical draft. It also checks every earlier
 * choice again against the pack it claims to have come from, on every call.
 *
 * Nobody picks until everybody has. That is the pod rule (`draftRound` takes
 * every seat's pick before a pack moves), and over a wire it is also what keeps
 * the two people honest with each other: the pack somebody is looking at cannot
 * have moved because the other player was quick.
 */
export function runSeatedDraft(
  cards: readonly Card[],
  options: SeatedDraftOptions = {},
): SeatedDraftProgress {
  const prepared = prepareDraft(cards, options);
  const humanSeats = options.humanSeats ?? [0];
  if (new Set(humanSeats).size !== humanSeats.length) {
    throw new DraftError('the same seat is listed as a person twice');
  }
  for (const seat of humanSeats) assertHumanSeat(seat, prepared.seats);
  const logs = new Map<number, readonly string[]>(
    humanSeats.map((seat) => [seat, options.picks?.[seat] ?? []]),
  );
  const picks: Record<number, readonly string[]> = Object.fromEntries(logs);
  let states = emptySeats(prepared.seats);
  let logIndex = 0;

  const progressAt = (
    current: readonly SeatState[],
    owed: readonly SeatedDraftChoice[],
    result: DraftResult | null,
  ): SeatedDraftProgress => ({
    seed: prepared.context.seed,
    humanSeats,
    picks,
    seats: current.map((state) => ({ seat: state.seat, picks: state.picks })),
    rounds: prepared.rounds,
    directions: Array.from({ length: prepared.rounds }, (_unused, index) => passDirection(index + 1)),
    ratings: prepared.ratings,
    botPolicy: prepared.context.botPolicy,
    owed,
    result,
  });

  for (let round = 1; round <= prepared.rounds; round += 1) {
    states = openRound(states, prepared.context, round);
    const direction = passDirection(round);
    for (let pickNumber = 1; states.some((state) => state.pack.cards.length > 0); pickNumber += 1) {
      // Each person's pick is taken the moment it is logged rather than when
      // the round completes. Two things depend on it: a pick that is not in
      // that seat's pack is refused *while the person who sent it is still
      // there to be told*, and a seat that has picked can be shown as having
      // picked. The pack still does not move until nobody is owed, which is
      // the rule that keeps the round simultaneous.
      const owed: SeatedDraftChoice[] = [];
      let taken = states;
      for (const seat of humanSeats) {
        const state = taken[seat];
        if (state === undefined) throw new DraftError('a seat disappeared from the pod');
        const logged = logs.get(seat)?.[logIndex];
        if (logged === undefined) {
          owed.push({
            seat,
            round,
            pickNumber,
            packSize: state.pack.cards.length,
            openedBy: state.pack.openedBy,
            cards: state.pack.cards,
          });
          continue;
        }
        taken = taken.map((entry) =>
          entry.seat === seat ? takeHumanPick(state, logged, round, pickNumber, logIndex) : entry,
        );
      }
      if (owed.length > 0) return progressAt(taken, owed, null);
      // The bots pick from their own packs, so taking them after the people
      // rather than beside them changes nothing either of them can see.
      const chosen = taken.map((state) =>
        logs.has(state.seat) ? state : takePick(state, prepared.context, round, pickNumber),
      );
      logIndex += 1;
      states = passPacks(chosen, direction);
    }
  }

  for (const seat of humanSeats) {
    const extra = (logs.get(seat)?.length ?? 0) - logIndex;
    if (extra > 0) {
      throw new DraftError(
        `seat ${String(seat)}'s pick log has ${String(extra)} extra entry after the draft finished`,
      );
    }
  }
  return progressAt(states, [], draftResult(prepared.context, states, prepared.rounds, prepared.ratings));
}
