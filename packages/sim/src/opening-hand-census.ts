/**
 * What the bots actually do with their opening hands, measured.
 *
 * `policies/mulligan.ts` is a two-number band, and the file says outright that
 * the numbers exist to be moved on evidence. This is the instrument that
 * produces the evidence: it plays a real seeded round robin, watches every
 * opening-hand decision from inside the seat that makes it, and joins what it
 * saw to the game the seat went on to win or lose.
 *
 * It is a census, not a gate. Nothing here asserts a band — it reports
 * distributions, and the reading is an argument someone has to make. What makes
 * it worth keeping in `src/` rather than in a scratch file is that the same
 * function measures any profile: an arm is a `MulliganPolicyConfig` override, so
 * "before" and "after" are two arms of one run over one schedule and one seed,
 * which is the only way two readings of a noisy statistic are comparable.
 *
 * The instrumentation is an agent wrapper rather than a hook in the policy, so
 * the policy under measurement is the shipped policy, byte for byte. That costs
 * a worker boundary — a closure cannot be `structuredClone`d — so a census runs
 * serially. It is a few minutes at gate volume, which is the price of watching.
 */
import type { Card } from '@mtg/dsl';
import type { Action, AgentView, DeckList, ObjectId, PlayerAgent, PlayerId } from '@mtg/kernel';
import { getObject, landsControlledBy } from '@mtg/kernel';
import type { AgentFactory } from './bots';
import { createBot, greedySpec } from './bots';
import type { GreedyBotConfig, MulliganPolicyConfig } from './config';
import { greedyConfig } from './config';
import type { GameOutcome } from './driver';
import type { MatchSpec } from './match';
import { readCastability } from './policies/castability';
import { landsWantedFor } from './policies/mulligan';
import { roundRobinSpecs } from './round-robin';
import { runMatchSerial } from './runner';

/** One profile under measurement: a label and the mulligan section it overrides. */
export interface CensusArm {
  readonly label: string;
  readonly mulligan: Partial<MulliganPolicyConfig>;
}

/** Everything one seat of one game did with its opening hand, plus how it ended. */
export interface SeatRecord {
  readonly deck: string;
  readonly opponent: string;
  readonly seat: PlayerId;
  readonly onThePlay: boolean;
  /** Lands in each seven-card hand this seat was dealt, in the order dealt. */
  readonly dealtLands: readonly number[];
  /**
   * The seat's first seven: inside the land band, and able to cast something by
   * turn 3.
   *
   * These two are the paired-comparison handle, and they are read off the dealt
   * seven rather than off what was kept, which makes them a property of the
   * deal and not of the policy. Nothing is bottomed before the first mulligan
   * decision, so this hand is identical across arms of one seed — which is what
   * lets "hands the castability rule would send back" be scored as one cohort
   * under a policy that keeps them and a policy that does not. An aggregate win
   * rate cannot answer that question: a round robin is zero-sum, so both arms
   * read 50% whatever the rule does.
   */
  readonly firstHandInBand: boolean;
  readonly firstHandCastable: boolean;
  readonly mulligans: number;
  readonly keptSize: number;
  readonly keptLands: number;
  /** The kept hand can cast one of its own spells from its own lands by turn 3. */
  readonly castableByThree: boolean;
  /** It cannot, and the reason is colors rather than land count. */
  readonly colorBlocked: boolean;
  /**
   * Lands this seat controlled at the end of its own Nth turn, keyed by N.
   *
   * Its **own** turns, not the kernel's global turn counter, which increments
   * once per player turn: "turn 3" for a screw reading means the seat's third
   * land drop, and on the global counter that is turn 5 or turn 6 depending on
   * which seat is asked. A distribution mixing the two reads a full board as a
   * stalled one half the time.
   */
  readonly landsByTurn: ReadonlyMap<number, number>;
  readonly won: boolean;
  readonly drew: boolean;
  readonly turns: number;
}

/** The turn the castability reading is taken at, for the census only. */
const CENSUS_CASTABLE_TURN = 3;

interface Sink {
  readonly records: Map<string, MutableRecord>;
}

interface MutableRecord {
  dealtLands: number[];
  mulligans: number;
  keptSize: number;
  keptLands: number;
  castableByThree: boolean;
  colorBlocked: boolean;
  firstHandInBand: boolean;
  firstHandCastable: boolean;
  landsByTurn: Map<number, number>;
  ownTurns: number;
  lastOwnTurn: number;
}

function cardsOf(view: AgentView, oids: readonly ObjectId[]): readonly Card[] {
  return oids.map((oid) => getObject(view.state, oid).card);
}

function landCount(cards: readonly Card[]): number {
  return cards.filter((card) => card.kind === 'land').length;
}

function blank(): MutableRecord {
  return {
    dealtLands: [],
    mulligans: 0,
    keptSize: 0,
    keptLands: 0,
    castableByThree: false,
    colorBlocked: false,
    firstHandInBand: false,
    firstHandCastable: false,
    landsByTurn: new Map<number, number>(),
    ownTurns: 0,
    lastOwnTurn: 0,
  };
}

/**
 * Wraps the registry's bot and writes down what it saw. Every decision it
 * returns is the wrapped bot's own, unread and unmodified.
 */
function instrumentedFactory(sink: Sink, config: GreedyBotConfig): AgentFactory {
  return (spec, seed, seat): PlayerAgent => {
    const inner = createBot(spec, seed, seat);
    const record = sink.records.get(seed) ?? blank();
    sink.records.set(seed, record);
    return {
      name: inner.name,
      decide(view: AgentView): Action {
        const action = inner.decide(view);
        if (view.decision.kind === 'mulligan') {
          const hand = cardsOf(view, view.decision.hand);
          record.dealtLands.push(landCount(hand));
          if (view.decision.mulligans === 0) {
            // Nothing is bottomed on a first look, so the dealt seven is also
            // the hand the band judges: no `chooseDiscards` replay is needed.
            const band = landsWantedFor(hand.length, view.state.config.openingHandSize, config.mulligan);
            const lands = landCount(hand);
            record.firstHandInBand = lands >= band.min && lands <= band.max;
            record.firstHandCastable = readCastability(hand, CENSUS_CASTABLE_TURN).castable;
          }
          if (action.type === 'mulligan') {
            record.mulligans += 1;
          } else if (action.type === 'keepHand') {
            const bottomed = new Set<ObjectId>(action.bottom);
            const kept = view.decision.hand.filter((oid) => !bottomed.has(oid));
            const keptCards = cardsOf(view, kept);
            const reading = readCastability(keptCards, CENSUS_CASTABLE_TURN);
            record.keptSize = kept.length;
            record.keptLands = reading.lands;
            record.castableByThree = reading.castable;
            record.colorBlocked = reading.colorBlocked;
          }
        } else if (view.state.turn.active === view.player) {
          const turn = view.state.turn.number;
          if (turn !== record.lastOwnTurn) {
            record.lastOwnTurn = turn;
            record.ownTurns += 1;
          }
          record.landsByTurn.set(record.ownTurns, landsControlledBy(view.state, view.player).length);
        }
        return action;
      },
    };
  };
}

export interface CensusOptions {
  readonly runSeed: string;
  readonly gamesPerMatchup: number;
  readonly maximumTurns?: number | undefined;
}

/** Plays one arm over the whole round robin and returns a record per seat per game. */
export function censusRoundRobin(
  decks: readonly DeckList[],
  arm: CensusArm,
  options: CensusOptions,
): readonly SeatRecord[] {
  const config: GreedyBotConfig = greedyConfig({ mulligan: arm.mulligan });
  const specs: readonly MatchSpec[] = roundRobinSpecs(decks, {
    runSeed: options.runSeed,
    gamesPerMatchup: options.gamesPerMatchup,
    collectLogs: false,
    botFor: (deck) => greedySpec(`greedy:${deck.name}`, config),
    ...(options.maximumTurns === undefined ? {} : { maximumTurns: options.maximumTurns }),
  });
  const out: SeatRecord[] = [];
  for (const spec of specs) {
    const sink: Sink = { records: new Map<string, MutableRecord>() };
    const run = runMatchSerial(spec, { agentFactory: instrumentedFactory(sink, config) });
    for (const outcome of run.outcomes) {
      out.push(...seatRecords(spec, outcome, sink));
    }
  }
  return out;
}

function seatRecords(spec: MatchSpec, outcome: GameOutcome, sink: Sink): readonly SeatRecord[] {
  const seats: PlayerId[] = [0, 1];
  return seats.map((seat) => {
    const key = `${spec.runSeed}/game/${outcome.index}/seat/${seat}`;
    const record = sink.records.get(key);
    if (record === undefined) {
      throw new Error(`census: game ${outcome.seed} seat ${seat} was never asked a decision`);
    }
    return {
      deck: spec.decks[seat].name,
      opponent: spec.decks[seat === 0 ? 1 : 0].name,
      seat,
      onThePlay: outcome.startingPlayer === seat,
      dealtLands: record.dealtLands,
      mulligans: record.mulligans,
      keptSize: record.keptSize,
      keptLands: record.keptLands,
      castableByThree: record.castableByThree,
      colorBlocked: record.colorBlocked,
      firstHandInBand: record.firstHandInBand,
      firstHandCastable: record.firstHandCastable,
      landsByTurn: record.landsByTurn,
      won: outcome.winner === seat,
      drew: outcome.winner === null,
      turns: outcome.turns,
    };
  });
}

/** Win rate over decided games only; draws are excluded from both halves. */
export function decidedRate(records: readonly SeatRecord[]): { rate: number; n: number } {
  const decided = records.filter((record) => !record.drew);
  if (decided.length === 0) return { rate: 0, n: 0 };
  return { rate: decided.filter((record) => record.won).length / decided.length, n: decided.length };
}

/** Win rate per deck name, which for the balance decks is the color pair. */
export function pairWinRates(records: readonly SeatRecord[]): ReadonlyMap<string, number> {
  const byDeck = new Map<string, SeatRecord[]>();
  for (const record of records) {
    const bucket = byDeck.get(record.deck);
    if (bucket === undefined) byDeck.set(record.deck, [record]);
    else bucket.push(record);
  }
  const rates = new Map<string, number>();
  for (const [deck, bucket] of [...byDeck].toSorted((a, b) => a[0].localeCompare(b[0]))) {
    rates.set(deck, decidedRate(bucket).rate);
  }
  return rates;
}
