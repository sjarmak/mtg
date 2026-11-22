/**
 * A draft over one physical singleton cube.
 *
 * This is deliberately below both card representations in the workspace. The
 * loop sees an opaque payload and a stable physical id; a caller that knows
 * printed cards, DSL cards, or something else supplies the score. Unlike the
 * generated-set path, packs are not independent samples from rarity sheets.
 * The whole input is shuffled exactly once, the first `seats * rounds *
 * packSize` cards are cut into packs, and the rest remain explicit.
 *
 * Human progress is a replay document rather than a mutable draft snapshot.
 * Append a physical id to the owed seat's pick log and call again with the same
 * cube, seed, configuration, and deterministic scorer. Every prior choice is
 * validated against its reconstructed pack before the pod advances.
 */
import type { BotEvidenceEpisode } from '@mtg/bot-evidence';
import type { PassDirection } from './draft-structure';
import { passDirection } from './draft-structure';
import type { DraftDecisionEvidence, DraftEvidenceRequest } from './draft-evidence';
import {
  completedPhysicalDraftEvidence,
  draftEvidenceIdentity,
  incompleteDraftEvidence,
  physicalDraftDecisionEvidence,
} from './draft-evidence';
import { DraftError } from './errors';
import { createRng, nextBelow } from './rng';

/** The ordinary paper cube pod. */
export const PHYSICAL_CUBE_DEFAULT_SEATS = 8;

/** One pack is opened per seat in each of three rounds. */
export const PHYSICAL_CUBE_DEFAULT_ROUNDS = 3;

/** A paper booster-sized cube pack. */
export const PHYSICAL_CUBE_DEFAULT_PACK_SIZE = 15;

export const PHYSICAL_CUBE_DEFAULT_SEED = 'physical-cube/v1';

/** An opaque card payload with the identity of this one physical copy. */
export interface PhysicalCubeCard<Payload> {
  readonly physicalId: string;
  readonly payload: Payload;
}

/** One initial physical pack, either cut from a cube or opened from a product. */
export interface PhysicalCubePack<Payload> {
  /** 1-based pack round. */
  readonly round: number;
  /** The backend-neutral id of the seat that opened it. */
  readonly openedBy: string;
  readonly cards: readonly PhysicalCubeCard<Payload>[];
}

/** Everything a caller may use to score one offered physical card. */
export interface PhysicalCubeScoreInput<Payload> {
  readonly card: PhysicalCubeCard<Payload>;
  readonly seatId: string;
  readonly picked: readonly PhysicalCubeCard<Payload>[];
  readonly round: number;
  readonly pickNumber: number;
  readonly packSize: number;
  readonly openedBy: string;
}

/**
 * A pure deterministic card score. Highest wins; ties keep pack order.
 *
 * Tie-breaking consumes no randomness. The seed therefore drives exactly one
 * operation—the cube shuffle—and never depends on scorer evaluation order.
 */
export type PhysicalCubeScore<Payload> = (input: PhysicalCubeScoreInput<Payload>) => number;

/** A policy that compares a pack in one call and returns its chosen zero-based index. */
export interface PhysicalCubeChooseInput<Payload> {
  readonly cards: readonly PhysicalCubeCard<Payload>[];
  readonly seatId: string;
  readonly picked: readonly PhysicalCubeCard<Payload>[];
  readonly round: number;
  readonly pickNumber: number;
  readonly packSize: number;
  readonly openedBy: string;
}
export type PhysicalCubeChoose<Payload> = (input: PhysicalCubeChooseInput<Payload>) => number;

export interface PhysicalCubeDraftOptions<Payload> {
  readonly seed?: string;
  /** Stable participant ids; defaults to `seat-1` through `seat-8`. */
  readonly seatIds?: readonly string[];
  readonly rounds?: number;
  readonly packSize?: number;
  /** Seats whose choices come from `picks`; every other seat uses `score`. */
  readonly humanSeatIds?: readonly string[];
  /** Physical ids in pick order, keyed by backend-neutral seat id. */
  readonly picks?: Readonly<Record<string, readonly string[]>>;
  readonly score: PhysicalCubeScore<Payload>;
  /** Optional whole-pack fast path. The card scorer remains the compatibility contract. */
  readonly choose?: PhysicalCubeChoose<Payload>;
  /** Collect automated-seat choices and the final or paused draft outcome. */
  readonly evidence?: DraftEvidenceRequest | null;
}

/** Dimensions come from the opened packs; all packs must have the same size. */
export type PhysicalPackDraftOptions<Payload> = Omit<
  PhysicalCubeDraftOptions<Payload>,
  'rounds' | 'packSize'
>;

export interface PhysicalCubeDraftPick<Payload> {
  readonly round: number;
  readonly pickNumber: number;
  readonly seatId: string;
  readonly card: PhysicalCubeCard<Payload>;
  readonly packSize: number;
  readonly openedBy: string;
}

export interface PhysicalCubeDraftSeat<Payload> {
  readonly seatId: string;
  readonly picks: readonly PhysicalCubeDraftPick<Payload>[];
}

export interface PhysicalCubeDraftResult<Payload> {
  readonly seed: string;
  readonly seats: readonly PhysicalCubeDraftSeat<Payload>[];
  readonly rounds: number;
  readonly packSize: number;
  readonly directions: readonly PassDirection[];
  /** The initial packs in round-major, seat-major deal order. */
  readonly packs: readonly PhysicalCubePack<Payload>[];
  /** The shuffled tail not used by this pod. */
  readonly undealt: readonly PhysicalCubeCard<Payload>[];
}

/** One human seat's current pack. */
export interface PhysicalCubeDraftChoice<Payload> {
  readonly seatId: string;
  readonly round: number;
  readonly pickNumber: number;
  readonly packSize: number;
  readonly openedBy: string;
  readonly cards: readonly PhysicalCubeCard<Payload>[];
}

/**
 * Internal replay state stopped at human input, or the completed draft.
 * This includes hidden packs and bot pools; it is NOT a player-view DTO.
 * Advisors consume a seat-scoped observation/pick projection, never this state.
 */
export interface PhysicalCubeDraftProgress<Payload> {
  /** Human-visible packs in decision order, never original hidden packs or bot hands. */
  readonly observations: readonly PhysicalCubeDraftChoice<Payload>[];
  readonly seed: string;
  readonly humanSeatIds: readonly string[];
  readonly picks: Readonly<Record<string, readonly string[]>>;
  readonly seats: readonly PhysicalCubeDraftSeat<Payload>[];
  readonly rounds: number;
  readonly packSize: number;
  readonly directions: readonly PassDirection[];
  readonly packs: readonly PhysicalCubePack<Payload>[];
  readonly undealt: readonly PhysicalCubeCard<Payload>[];
  readonly owed: readonly PhysicalCubeDraftChoice<Payload>[];
  readonly result: PhysicalCubeDraftResult<Payload> | null;
  /** Present only when the caller explicitly enables evidence collection. */
  readonly evidence?: BotEvidenceEpisode;
}

interface PhysicalPackState<Payload> {
  readonly openedBy: string;
  readonly cards: readonly PhysicalCubeCard<Payload>[];
}

interface PhysicalSeatState<Payload> {
  readonly seatId: string;
  readonly picks: readonly PhysicalCubeDraftPick<Payload>[];
  readonly pack: PhysicalPackState<Payload>;
}

interface PreparedPhysicalDraft<Payload> {
  readonly seed: string;
  readonly seatIds: readonly string[];
  readonly rounds: number;
  readonly packSize: number;
  readonly directions: readonly PassDirection[];
  readonly packs: readonly PhysicalCubePack<Payload>[];
  readonly undealt: readonly PhysicalCubeCard<Payload>[];
  readonly humanSeatIds: readonly string[];
  readonly logs: ReadonlyMap<string, readonly string[]>;
  readonly score: PhysicalCubeScore<Payload>;
  readonly choose: PhysicalCubeChoose<Payload> | null;
  readonly evidence: BotEvidenceEpisode['episode'] | null;
}

function defaultSeatIds(): readonly string[] {
  return Array.from({ length: PHYSICAL_CUBE_DEFAULT_SEATS }, (_unused, index) => `seat-${String(index + 1)}`);
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new DraftError(`${label} must be a positive integer, got ${String(value)}`);
  }
}

function assertSeatIds(seatIds: readonly string[]): void {
  if (seatIds.length < 2) {
    throw new DraftError(`a draft needs at least 2 seat ids to pass between, got ${String(seatIds.length)}`);
  }
  const seen = new Set<string>();
  for (const seatId of seatIds) {
    if (seatId.trim().length === 0) throw new DraftError('a seat id must not be empty');
    if (seen.has(seatId)) throw new DraftError(`seat id ${seatId} is listed twice`);
    seen.add(seatId);
  }
}

function assertPhysicalIds<Payload>(
  cards: readonly PhysicalCubeCard<Payload>[],
  collection = 'this singleton cube',
): void {
  const seen = new Set<string>();
  for (const card of cards) {
    if (card.physicalId.trim().length === 0) throw new DraftError('a physical id must not be empty');
    if (seen.has(card.physicalId)) {
      throw new DraftError(`physical id ${card.physicalId} appears twice in ${collection}`);
    }
    seen.add(card.physicalId);
  }
}

/** Fisher-Yates over a private copy, drawing from one stream and no other. */
function shuffleCube<Payload>(
  cards: readonly PhysicalCubeCard<Payload>[],
  seed: string,
): readonly PhysicalCubeCard<Payload>[] {
  const shuffled = [...cards];
  let rng = createRng(seed);
  for (let high = shuffled.length - 1; high > 0; high -= 1) {
    const [low, advanced] = nextBelow(rng, high + 1);
    rng = advanced;
    const held = shuffled[high];
    const selected = shuffled[low];
    if (held === undefined || selected === undefined) throw new DraftError('the cube shuffle lost a card');
    shuffled[high] = selected;
    shuffled[low] = held;
  }
  return shuffled;
}

function preparePhysicalDraft<Payload>(
  cards: readonly PhysicalCubeCard<Payload>[],
  options: PhysicalCubeDraftOptions<Payload>,
): PreparedPhysicalDraft<Payload> {
  const seed = options.seed ?? PHYSICAL_CUBE_DEFAULT_SEED;
  const seatIds = options.seatIds ?? defaultSeatIds();
  const rounds = options.rounds ?? PHYSICAL_CUBE_DEFAULT_ROUNDS;
  const packSize = options.packSize ?? PHYSICAL_CUBE_DEFAULT_PACK_SIZE;
  assertSeatIds(seatIds);
  assertPositiveInteger(rounds, 'rounds');
  assertPositiveInteger(packSize, 'pack size');
  assertPhysicalIds(cards);

  const capacity = seatIds.length * rounds * packSize;
  if (!Number.isSafeInteger(capacity))
    throw new DraftError('the requested draft capacity is not a safe integer');
  if (cards.length < capacity) {
    throw new DraftError(
      `this draft needs ${String(capacity)} physical cards, but the cube holds ${String(cards.length)}`,
    );
  }

  const shuffled = shuffleCube(cards, seed);
  const packs = Array.from({ length: rounds }, (_unused, index) =>
    seatIds.map((openedBy, seatIndex) => {
      const offset = (index * seatIds.length + seatIndex) * packSize;
      return { round: index + 1, openedBy, cards: shuffled.slice(offset, offset + packSize) };
    }),
  ).flat();
  return prepareReplay(packs, shuffled.slice(capacity), { ...options, seed, seatIds, rounds, packSize });
}

function prepareReplay<Payload>(
  packs: readonly PhysicalCubePack<Payload>[],
  undealt: readonly PhysicalCubeCard<Payload>[],
  options: PhysicalCubeDraftOptions<Payload> & {
    readonly seed: string;
    readonly seatIds: readonly string[];
    readonly rounds: number;
    readonly packSize: number;
  },
): PreparedPhysicalDraft<Payload> {
  const { seed, seatIds, rounds, packSize } = options;
  const evidence =
    options.evidence === undefined || options.evidence === null
      ? null
      : draftEvidenceIdentity(options.evidence, seed);
  const humanSeatIds = options.humanSeatIds ?? [];
  if (new Set(humanSeatIds).size !== humanSeatIds.length) {
    throw new DraftError('the same human seat id is listed twice');
  }
  const seats = new Set(seatIds);
  for (const humanSeatId of humanSeatIds) {
    if (!seats.has(humanSeatId)) {
      throw new DraftError(`human seat id ${humanSeatId} is not in this draft`);
    }
  }
  const humans = new Set(humanSeatIds);
  for (const seatId of Object.keys(options.picks ?? {})) {
    if (!humans.has(seatId)) {
      throw new DraftError(`pick log for ${seatId} is not a declared human seat`);
    }
  }

  return {
    seed,
    seatIds,
    rounds,
    packSize,
    directions: Array.from({ length: rounds }, (_unused, index) => passDirection(index + 1)),
    packs,
    undealt,
    humanSeatIds,
    logs: new Map(humanSeatIds.map((seatId) => [seatId, options.picks?.[seatId] ?? []])),
    score: options.score,
    choose: options.choose ?? null,
    evidence,
  };
}

function emptyPhysicalSeats<Payload>(seatIds: readonly string[]): readonly PhysicalSeatState<Payload>[] {
  return seatIds.map((seatId) => ({ seatId, picks: [], pack: { openedBy: seatId, cards: [] } }));
}

function openedPack<Payload>(
  prepared: PreparedPhysicalDraft<Payload>,
  round: number,
  openedBy: string,
): PhysicalPackState<Payload> {
  const pack = prepared.packs.find(
    (candidate) => candidate.round === round && candidate.openedBy === openedBy,
  );
  if (pack === undefined) throw new DraftError(`round ${String(round)} has no pack for ${openedBy}`);
  return { openedBy, cards: pack.cards };
}

function scorePick<Payload>(
  state: PhysicalSeatState<Payload>,
  prepared: PreparedPhysicalDraft<Payload>,
  round: number,
  pickNumber: number,
): PhysicalSeatState<Payload> {
  const { cards } = state.pack;
  if (cards.length === 0) return state;
  const picked = state.picks.map((pick) => pick.card);
  const choice = {
    cards,
    seatId: state.seatId,
    picked,
    round,
    pickNumber,
    packSize: cards.length,
    openedBy: state.pack.openedBy,
  };
  let index: number;
  if (prepared.choose !== null) {
    index = prepared.choose(choice);
    if (!Number.isInteger(index) || index < 0 || index >= cards.length) {
      throw new DraftError(`the policy chose invalid card index ${String(index)} for ${state.seatId}`);
    }
  } else {
    const scores = cards.map((card) =>
      prepared.score({
        card,
        seatId: state.seatId,
        picked,
        round,
        pickNumber,
        packSize: cards.length,
        openedBy: state.pack.openedBy,
      }),
    );
    const invalid = scores.find((value) => !Number.isFinite(value));
    if (invalid !== undefined) {
      throw new DraftError(`the scorer returned ${String(invalid)} for ${state.seatId}`);
    }
    const best = Math.max(...scores);
    index = scores.findIndex((value) => value === best);
  }
  const card = cards[index];
  if (index < 0 || card === undefined) throw new DraftError('the scorer chose no card from a nonempty pack');
  return takePhysicalPick(state, card, index, round, pickNumber);
}

function takePhysicalPick<Payload>(
  state: PhysicalSeatState<Payload>,
  card: PhysicalCubeCard<Payload>,
  index: number,
  round: number,
  pickNumber: number,
): PhysicalSeatState<Payload> {
  return {
    seatId: state.seatId,
    picks: [
      ...state.picks,
      {
        round,
        pickNumber,
        seatId: state.seatId,
        card,
        packSize: state.pack.cards.length,
        openedBy: state.pack.openedBy,
      },
    ],
    pack: {
      openedBy: state.pack.openedBy,
      cards: state.pack.cards.filter((_unused, at) => at !== index),
    },
  };
}

function takeLoggedPick<Payload>(
  state: PhysicalSeatState<Payload>,
  physicalId: string,
  round: number,
  pickNumber: number,
  logIndex: number,
): PhysicalSeatState<Payload> {
  const index = state.pack.cards.findIndex((card) => card.physicalId === physicalId);
  if (index < 0) {
    throw new DraftError(
      `seat ${state.seatId} human pick ${String(logIndex + 1)} (${physicalId}) is not in round ${String(round)}, pick ${String(pickNumber)}`,
    );
  }
  const card = state.pack.cards[index];
  if (card === undefined) throw new DraftError('a logged physical card disappeared from its pack');
  return takePhysicalPick(state, card, index, round, pickNumber);
}

function passPhysicalPacks<Payload>(
  states: readonly PhysicalSeatState<Payload>[],
  direction: PassDirection,
): readonly PhysicalSeatState<Payload>[] {
  return states.map((state, index) => {
    const source = states[(index - direction + states.length) % states.length];
    if (source === undefined) throw new DraftError('a physical draft seat has no neighbor');
    return { ...state, pack: source.pack };
  });
}

function publicSeats<Payload>(
  states: readonly PhysicalSeatState<Payload>[],
): readonly PhysicalCubeDraftSeat<Payload>[] {
  return states.map((state) => ({ seatId: state.seatId, picks: state.picks }));
}

/**
 * Deals and replays one physical singleton cube until input is owed or it ends.
 */
export function runPhysicalCubeDraft<Payload>(
  cards: readonly PhysicalCubeCard<Payload>[],
  options: PhysicalCubeDraftOptions<Payload>,
): PhysicalCubeDraftProgress<Payload> {
  return replayPhysicalDraft(preparePhysicalDraft(cards, options));
}

/**
 * Replay independently opened boosters through the same physical-card loop.
 * Product collation stays with the caller. Each occurrence needs its own
 * physical id, even when two occurrences carry the same printing payload.
 * Input pack order is immaterial; rounds and seat order determine passing.
 */
export function runPhysicalPackDraft<Payload>(
  packs: readonly PhysicalCubePack<Payload>[],
  options: PhysicalPackDraftOptions<Payload>,
): PhysicalCubeDraftProgress<Payload> {
  const seatIds = options.seatIds ?? defaultSeatIds();
  assertSeatIds(seatIds);
  const first = packs[0];
  if (first === undefined) throw new DraftError('a physical booster draft needs opened packs');
  const packSize = first.cards.length;
  assertPositiveInteger(packSize, 'pack size');
  // Derive from count, not the largest supplied round: malformed round numbers
  // must not cause unbounded allocation before validation.
  const rounds = packs.length / seatIds.length;
  assertPositiveInteger(rounds, 'rounds');
  const byRound = new Map<number, Map<string, PhysicalCubePack<Payload>>>();
  for (const pack of packs) {
    assertPositiveInteger(pack.round, 'pack round');
    if (pack.round > rounds) throw new DraftError('pack round exceeds the draft round count');
    if (!seatIds.includes(pack.openedBy)) throw new DraftError(`unknown opener ${pack.openedBy}`);
    if (pack.cards.length !== packSize) throw new DraftError('physical booster packs must have equal sizes');
    const round = byRound.get(pack.round) ?? new Map<string, PhysicalCubePack<Payload>>();
    if (round.has(pack.openedBy)) throw new DraftError('two packs have the same round and opener');
    round.set(pack.openedBy, pack);
    byRound.set(pack.round, round);
  }
  assertPhysicalIds(
    packs.flatMap((pack) => pack.cards),
    'this physical booster draft',
  );
  const ordered = Array.from({ length: rounds }, (_unused, index) =>
    seatIds.map((seatId) => {
      const pack = byRound.get(index + 1)?.get(seatId);
      if (pack === undefined) throw new DraftError(`round ${String(index + 1)} has no pack for ${seatId}`);
      return pack;
    }),
  ).flat();
  return replayPhysicalDraft(
    prepareReplay(ordered, [], {
      ...options,
      seed: options.seed ?? 'physical-packs/v1',
      seatIds,
      rounds,
      packSize,
    }),
  );
}

function replayPhysicalDraft<Payload>(
  prepared: PreparedPhysicalDraft<Payload>,
): PhysicalCubeDraftProgress<Payload> {
  const picks: Record<string, readonly string[]> = Object.fromEntries(prepared.logs);
  let states = emptyPhysicalSeats<Payload>(prepared.seatIds);
  let logIndex = 0;
  let observations: readonly PhysicalCubeDraftChoice<Payload>[] = [];
  let decisions: readonly DraftDecisionEvidence[] = [];

  const progressAt = (
    current: readonly PhysicalSeatState<Payload>[],
    owed: readonly PhysicalCubeDraftChoice<Payload>[],
    result: PhysicalCubeDraftResult<Payload> | null,
  ): PhysicalCubeDraftProgress<Payload> => {
    const evidence =
      prepared.evidence === null
        ? null
        : result === null
          ? incompleteDraftEvidence(prepared.evidence, decisions, 'awaiting human draft picks')
          : completedPhysicalDraftEvidence(prepared.evidence, decisions, result);
    return {
      observations,
      seed: prepared.seed,
      humanSeatIds: prepared.humanSeatIds,
      picks,
      seats: publicSeats(current),
      rounds: prepared.rounds,
      packSize: prepared.packSize,
      directions: prepared.directions,
      packs: prepared.packs,
      undealt: prepared.undealt,
      owed,
      result,
      ...(evidence === null ? {} : { evidence }),
    };
  };

  for (let round = 1; round <= prepared.rounds; round += 1) {
    states = states.map((state) => ({
      ...state,
      pack: openedPack(prepared, round, state.seatId),
    }));
    const direction = passDirection(round);
    for (let pickNumber = 1; pickNumber <= prepared.packSize; pickNumber += 1) {
      const owed: PhysicalCubeDraftChoice<Payload>[] = [];
      let taken = states;
      for (const seatId of prepared.humanSeatIds) {
        const state = taken.find((candidate) => candidate.seatId === seatId);
        if (state === undefined) throw new DraftError(`human seat ${seatId} disappeared from the pod`);
        const logged = prepared.logs.get(seatId)?.[logIndex];
        const observation = {
          seatId,
          round,
          pickNumber,
          packSize: state.pack.cards.length,
          openedBy: state.pack.openedBy,
          cards: state.pack.cards,
        };
        observations = [...observations, observation];
        if (logged === undefined) {
          owed.push(observation);
          continue;
        }
        taken = taken.map((candidate) =>
          candidate.seatId === seatId
            ? takeLoggedPick(state, logged, round, pickNumber, logIndex)
            : candidate,
        );
      }
      if (owed.length > 0) return progressAt(taken, owed, null);
      const botStates = taken.filter(
        (state) => !prepared.logs.has(state.seatId) && state.pack.cards.length > 0,
      );
      const chosen = taken.map((state) =>
        prepared.logs.has(state.seatId) ? state : scorePick(state, prepared, round, pickNumber),
      );
      if (prepared.evidence !== null) {
        const pickDecisions = botStates.map((state, index) => {
          const chosenState = chosen.find((candidate) => candidate.seatId === state.seatId);
          const pick = chosenState?.picks.at(-1);
          if (pick === undefined) {
            throw new DraftError('a physical bot pick disappeared before evidence collection');
          }
          return physicalDraftDecisionEvidence(
            {
              seatId: state.seatId,
              round,
              pickNumber,
              openedBy: state.pack.openedBy,
              pack: state.pack.cards,
              pool: state.picks.map((prior) => prior.card),
            },
            pick.card,
            decisions.length + index,
          );
        });
        decisions = [...decisions, ...pickDecisions];
      }
      states = passPhysicalPacks(chosen, direction);
      logIndex += 1;
    }
  }

  for (const seatId of prepared.humanSeatIds) {
    const extra = (prepared.logs.get(seatId)?.length ?? 0) - logIndex;
    if (extra > 0) {
      throw new DraftError(
        `seat ${seatId}'s pick log has ${String(extra)} extra entry after the draft finished`,
      );
    }
  }
  const result: PhysicalCubeDraftResult<Payload> = {
    seed: prepared.seed,
    seats: publicSeats(states),
    rounds: prepared.rounds,
    packSize: prepared.packSize,
    directions: prepared.directions,
    packs: prepared.packs,
    undealt: prepared.undealt,
  };
  return progressAt(states, [], result);
}
