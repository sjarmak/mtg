/**
 * The whole construction in one call: criteria in, a measured cube out.
 *
 * The order is the ZFC split made executable — code narrows the pool, the model
 * chooses the cards and says what each one is for, code checks every choice
 * against the store, code measures the finished list. Nothing skips ahead: the
 * model is never consulted about arithmetic, and code never decides whether a
 * card serves an archetype.
 *
 * The finished list is then drafted. `mtg-bc2.25` asks for archetype
 * availability measured across many seeded 8-player drafts, and `mtg-bc2.116`
 * landed the runtime that supplies them, so a cube whose cards are DSL cards
 * reports how often a seat could assemble each archetype alongside the pod
 * capacity and the per-archetype census. A cube cut from the card store is
 * measured but not drafted, and so is one holding a card twice; both say so and
 * why, and `availability.ts` holds those reasons and the four runtime limits
 * behind them.
 */
import type { DataStore } from '@mtg/data';
import type { LlmProvider } from '@mtg/llm';
import type { AvailabilityOptions } from './availability';
import { measureAvailability } from './availability';
import type { CubeCriteria, CubeCriteriaInput } from './criteria';
import { CubeCriteriaSchema } from './criteria';
import type { CubeRejection } from './propose';
import { proposeCubeCards, verifyCubeProposals } from './propose';
import type { CubePool } from './universe';
import { selectCubePool } from './universe';
import type { CubeEntry, CubeValidation } from './validate';
import { validateCube } from './validate';

/** Rounds a construction gets before it reports what it has. */
export const DEFAULT_CUBE_ROUNDS = 6;

/**
 * What one construction round costs, in dollars, split into the part that does
 * not move with the cube and the part that does.
 *
 * Both figures are decomposed from the one live round this package recorded
 * (`fixtures/llm/`, `claude-fable-5`, eighteen cards, $1.496908 reported) at
 * `@mtg/llm`'s own price table: 51,825 cache-creation tokens and 97,698 cache
 * reads are the transport's per-call overhead and come to $1.134 whatever is
 * being asked for, while the 7,253 output tokens are 403 per card at $50 per
 * million, or $0.0202 a card. Each is rounded up, because a bound sized on the
 * typical round is a bound that clips the expensive one.
 *
 * A cube round is worth about three deck rounds even at eighteen cards, and a
 * cube's `size` runs from 45 to 1080, so `@mtg/decklab`'s flat per-round figure
 * cannot be carried across: it would foreclose every cube above the smallest.
 */
const ROUND_FIXED_USD = 1.15;
const ROUND_PER_CARD_USD = 0.021;

/** What one round asking for `cards` cards costs. */
export function cubeRoundCostUsd(cards: number): number {
  return ROUND_FIXED_USD + ROUND_PER_CARD_USD * Math.max(0, cards);
}

/**
 * Dollars of model spend one construction may reach before it stops asking.
 *
 * Sized at what the round budget costs, which leaves the money bound doing the
 * one job the round count cannot: a round is a round whether it proposes four
 * cards or four hundred, and it is the expensive round, not the extra round,
 * that this stops. Every round is priced at the whole cube, because a round asks
 * for whatever is still missing and the first one asks for all of it.
 *
 * Sized *at* it, not above it, which makes the tie reachable rather than
 * theoretical: at 100 cards a round is $3.25 and six of them are $19.50 to the
 * cent, so a build spending exactly the modeled cost lands on the ceiling as its
 * last granted round ends. `fill` settles that tie by checking the round count
 * first, so such a build is reported as what it is — out of rounds — and the
 * money bound never takes credit for a round the rounds had already spent.
 *
 * A build granted no rounds still gets a well-formed meter — one round's worth,
 * which it never spends — rather than a zero the meter would refuse. The cent
 * it is stated in is rounded up rather than to nearest, because a ceiling
 * rounded down is a ceiling that clips, if only by half a cent.
 *
 * A provider that cannot report what a call cost reports zero, so this bound
 * never binds there and the round count is what holds. That is why both stay.
 */
export function defaultMaxCubeSpendUsd(size: number, maxRounds: number): number {
  return Math.ceil(Math.max(1, maxRounds) * cubeRoundCostUsd(size) * 100) / 100;
}

/** Which bound ended construction. Everything but `filled` leaves it short. */
export type ConstructionStop =
  /** The cube reached its stated size. */
  | { readonly kind: 'filled' }
  /** A round produced nothing that survived verification. */
  | { readonly kind: 'stalled' }
  /** The rounds ran out. */
  | { readonly kind: 'rounds'; readonly limit: number }
  /** The dollars this construction was allowed to spend on model calls ran out. */
  | { readonly kind: 'spend'; readonly limit: number; readonly spentUsd: number };

export interface AssembleCubeInput {
  readonly pool: CubePool;
  readonly provider: LlmProvider;
  readonly criteria: CubeCriteriaInput;
  readonly maxRounds?: number;
  /**
   * Dollars of model spend this construction may reach, measured from what the
   * provider's budget guard had already recorded when it started. Absent takes
   * `defaultMaxCubeSpendUsd` for the cube's size and round budget; a stated
   * number is honored exactly as given, and must be positive the way `@mtg/llm`'s
   * own ceilings must be.
   *
   * It bounds the construction loop and nothing else, which here is the whole of
   * what a cube build spends: unlike a deck build, no model call is made before
   * the loop starts.
   */
  readonly maxSpendUsd?: number;
  /**
   * How many seeded drafts the finished list is measured over, and under which
   * seed. Absent takes `DEFAULT_AVAILABILITY_DRAFTS` at
   * `DEFAULT_AVAILABILITY_SEED`, which is a measurement anyone can reproduce
   * without being told the numbers.
   */
  readonly availability?: AvailabilityOptions;
}

export interface ConstructCubeInput extends Omit<AssembleCubeInput, 'pool'> {
  readonly store: DataStore;
}

export interface ConstructedCube {
  readonly criteria: CubeCriteria;
  readonly entries: readonly CubeEntry[];
  /** The model's own words on what this cube is for. */
  readonly plan: string;
  /** Problems still outstanding after the last round. */
  readonly rejections: readonly CubeRejection[];
  readonly poolSize: number;
  readonly rounds: number;
  /** Cards the loop never filled; 0 when it reached the stated size. */
  readonly shortBy: number;
  readonly stop: ConstructionStop;
  readonly validation: CubeValidation;
}

export class EmptyCubePoolError extends Error {
  constructor(readonly filters: readonly string[]) {
    super(`no cards satisfy the cube's restrictions: ${filters.join('; ')}`);
    this.name = 'EmptyCubePoolError';
  }
}

/** Narrow the store to the legal pool, then assemble against it. */
export async function constructCube(input: ConstructCubeInput): Promise<ConstructedCube> {
  const criteria = CubeCriteriaSchema.parse(input.criteria);
  return assemble(selectCubePool(input.store, criteria), input, criteria);
}

/**
 * Assemble a cube against a pool that already exists.
 *
 * Split from `constructCube` so the loop can be exercised over a hand-written
 * pool: the store is 626 MB and absent in CI, and none of what happens here
 * needs it once the pool has been computed.
 */
export async function assembleCube(input: AssembleCubeInput): Promise<ConstructedCube> {
  return assemble(input.pool, input, CubeCriteriaSchema.parse(input.criteria));
}

/**
 * The construction both entry points share, over criteria their own caller has
 * already parsed — once each, rather than once per layer, so there is a single
 * place a default is applied.
 */
async function assemble(
  pool: CubePool,
  input: Omit<AssembleCubeInput, 'criteria' | 'pool'>,
  criteria: CubeCriteria,
): Promise<ConstructedCube> {
  if (pool.universe.cards.length === 0) throw new EmptyCubePoolError(pool.universe.filters);

  const maxRounds = input.maxRounds ?? DEFAULT_CUBE_ROUNDS;
  const filled = await fill(input.provider, criteria, pool, {
    maxRounds,
    spend: spendMeter(input.provider, input.maxSpendUsd ?? defaultMaxCubeSpendUsd(criteria.size, maxRounds)),
  });

  // Measured after the loop, over the list that was actually built: a cube is
  // drafted as it finished, short rounds and all, not as it was asked for.
  const availability = measureAvailability(
    filled.entries,
    criteria,
    pool.draftable,
    input.availability ?? {},
  );

  return {
    criteria,
    entries: filled.entries,
    plan: filled.plan,
    rejections: filled.rejections,
    poolSize: pool.universe.cards.length,
    rounds: filled.rounds,
    shortBy: Math.max(0, criteria.size - cardsIn(filled.entries)),
    stop: filled.stop,
    validation: validateCube(filled.entries, criteria, availability),
  };
}

interface FillState {
  readonly entries: readonly CubeEntry[];
  readonly rejections: readonly CubeRejection[];
  readonly plan: string;
  readonly rounds: number;
}

/** The two bounds one construction runs under, settled before the first round. */
interface FillBounds {
  readonly maxRounds: number;
  /** This construction's spend and its ceiling, read fresh before every round. */
  readonly spend: () => { readonly spentUsd: number; readonly maxSpendUsd: number };
}

/**
 * What this construction has spent, against what it may.
 *
 * The mechanism is `@mtg/decklab`'s `spendMeter` and deliberately not a second
 * set of books: the guard belongs to the provider and counts the whole run, so
 * a second cube built in the same process must not inherit the first one's
 * bill. This construction's spend is the distance from where it found the guard.
 */
function spendMeter(provider: LlmProvider, maxSpendUsd: number): FillBounds['spend'] {
  if (!Number.isFinite(maxSpendUsd) || maxSpendUsd <= 0) {
    throw new Error(`maxSpendUsd must be a positive finite number of dollars, got ${maxSpendUsd}`);
  }
  const before = provider.budget.snapshot().spentUsd;
  return () => ({ spentUsd: provider.budget.snapshot().spentUsd - before, maxSpendUsd });
}

function cardsIn(entries: readonly CubeEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.count, 0);
}

/**
 * Ask, verify, fold in, repeat.
 *
 * A round that adds nothing ends the loop rather than buying another: the
 * feedback from a partial round already rides along with the next ask, so a
 * round where *everything* was rejected means the model is not converging and
 * further rounds are spend without progress. Whatever verified is kept either
 * way — a partial cube plus named problems beats an exception.
 *
 * The round count is checked before the money, because under the default the two
 * run out on the same iteration: the ceiling is the round budget priced at this
 * cube, so a build spending exactly the modeled round cost reaches it precisely
 * as its last granted round ends. Checking money first called that build
 * `spend` and the report told the designer to raise `--max-spend-usd`, which on
 * its own buys nothing — the rounds are gone too. Neither order can buy a round
 * past the dollars agreed to: whenever a round is left to grant, the spend check
 * below still runs before the ask.
 */
async function fill(
  provider: LlmProvider,
  criteria: CubeCriteria,
  pool: CubePool,
  bounds: FillBounds,
): Promise<FillState & { readonly stop: ConstructionStop }> {
  let state: FillState = { entries: [], rejections: [], plan: '', rounds: 0 };

  for (;;) {
    const need = criteria.size - cardsIn(state.entries);
    if (need <= 0) return { ...state, stop: { kind: 'filled' } };

    if (state.rounds >= bounds.maxRounds) {
      return { ...state, stop: { kind: 'rounds', limit: bounds.maxRounds } };
    }
    const { spentUsd, maxSpendUsd } = bounds.spend();
    if (spentUsd >= maxSpendUsd) {
      return { ...state, stop: { kind: 'spend', limit: maxSpendUsd, spentUsd } };
    }

    const proposal = await proposeCubeCards(provider, criteria, pool, need, state.entries, state.rejections);
    const verified = verifyCubeProposals({
      proposals: proposal.cards,
      pool,
      criteria,
      accepted: state.entries,
      room: need,
    });

    state = {
      entries: [...state.entries, ...verified.inclusions],
      rejections: verified.rejections,
      plan: state.plan === '' ? proposal.plan : state.plan,
      rounds: state.rounds + 1,
    };
    if (verified.inclusions.length === 0) return { ...state, stop: { kind: 'stalled' } };
  }
}
