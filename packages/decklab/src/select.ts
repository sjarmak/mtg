/**
 * The semantic half of the ZFC split: the model chooses the cards.
 *
 * It is asked for names, counts, and a citation per inclusion, and it is asked
 * for nothing else. It does not decide how the basics split or whether the curve
 * is right — that is arithmetic `assemble.ts` does exactly, and a model asked to
 * do hypergeometric math will produce a plausible number rather than a correct
 * one. How many lands the deck runs *is* a judgment and *is* the model's, but
 * it is settled one stage earlier in `land-plan.ts`, because the spell target
 * this stage is asked to fill is what is left over after it.
 *
 * ## Lands are a choice; basics are arithmetic
 *
 * The model is asked for the spells *and* for any nonbasic lands the deck
 * wants, because which utility land or dual belongs in a deck is a judgment
 * about the deck, not a calculation. It is never asked how many basics to run
 * or how they split: that is apportionment over the pip demand of whatever it
 * chose, and `assemble.ts` does it exactly.
 *
 * The earlier split asked for non-land cards only, so nonbasic lands could
 * never be proposed and every deck came out with a mana base of pure basics. A
 * blind comparison lost on quality 2-4 and the judge named the all-basics mana
 * base in almost every loss.
 *
 * ## The repair loop
 *
 * A first answer usually contains a few cards that are illegal in the format,
 * outside the deck's colors, or simply not real. Rather than failing the build
 * or silently dropping them, each rejection is handed back with the specific
 * reason and the model is asked to replace them. The loop always returns
 * whatever verified, so a partial deck plus named problems beats an exception.
 *
 * ## What bounds the loop
 *
 * `DEFAULT_MAX_ROUNDS` is the budget every build is guaranteed; past it the loop
 * keeps going only while the last round actually added spells, and stops the
 * instant one does not. A fixed budget stopped a budget-pauper build at 58 cards
 * against a stated 60 while the model was still filling it, which is a deck
 * nobody asked for.
 *
 * The guarantee is narrow rather than absolute. It exists to buy the round after
 * a round of rejections, so it is spent on any round that told the loop
 * something — a card accepted, or a problem list that is not the one the round
 * before ended with. Only a round that did neither leaves the next prompt
 * byte-for-byte identical, and paying for the same question twice is not a
 * guarantee of anything (mtg-bc2.90).
 *
 * Two ceilings bound the rounds past the guarantee. `roundsCeiling` is the loop
 * guard: a model that adds one card a round must not be able to buy thirty-six.
 * It is a proxy, though — a round proposing forty cards and a round proposing
 * one are one round each and nothing like the same money — so the bound that
 * means what it says is `maxSpendUsd`, read off `@mtg/llm`'s own budget guard
 * rather than from a second set of books (mtg-bc2.89). Its default is derived
 * from the same spell target the ceiling is, because a flat figure clear of a
 * 60-card build stops a 99-card one halfway.
 *
 * Which bound ended the loop is returned as `stop`, and what it left unfilled as
 * `shortBy`. Both are printed. A deck that comes back short has to name the
 * constraint that made it short, and only the loop knows which one it was: the
 * rejections outstanding at the end are the wrong answer when the rounds ran
 * out, and "the model stopped proposing cards" is false when the last round
 * proposed a fresh one.
 */
import { z } from 'zod';
import type { LlmProvider } from '@mtg/llm';
import type { CandidateUniverse } from './candidates';
import type { ResolvedCriteria } from './criteria';
import { enumerateCriteria } from './criteria';
import type { Inclusion, Proposal, Rejection, UniverseLookup } from './verify';
import { enforceDeckBudget, enforceLandSlot, landCount, spellCount, verifyProposals } from './verify';

/** Rounds every build gets, as long as each of them tells the loop something. */
export const DEFAULT_MAX_ROUNDS = 3;

/**
 * What one selection round costs, in dollars, at the effort `@mtg/llm`'s
 * claude-cli transport states.
 *
 * Two live rounds measured $0.4735 and $0.4980, and the most expensive scenario
 * in the eval runs about $0.55. The larger is what the default bound is sized
 * on: a ceiling sized on the typical round is a ceiling that clips the expensive
 * one, which is the failure this constant exists to stop reproducing.
 */
const ROUND_COST_USD = 0.55;

/** The per-round fill the ceiling is sized around: one legal four-of. */
const SPELLS_PER_ROUND_FLOOR = 4;

/**
 * The hard stop on the rounds the loop grants itself past its budget.
 *
 * Progress alone is not a bound: a model that supplies one usable card per round
 * against a 36-spell target would keep making progress for 36 live calls, which
 * turns one deck into an open-ended spend. So the cap is what the deck being
 * asked for needs at one legal four-of a round, plus the guarantee as slack for
 * the rounds a rejection eats.
 *
 * It has to scale, because a fixed number is right for one deck size and wrong
 * for the next: a cap of eight is generous for a 40-card deck and one round
 * short of a 60-card deck's ordinary nine, which reproduces the undersized deck
 * this loop was fixed for with different digits.
 */
export function roundsCeiling(spellTarget: number): number {
  return Math.ceil(Math.max(0, spellTarget) / SPELLS_PER_ROUND_FLOOR) + DEFAULT_MAX_ROUNDS;
}

/**
 * Dollars of model spend one card selection may reach before it stops asking,
 * sized to the deck it was handed.
 *
 * A flat bound cannot be right at both ends of a `size` that runs from 40 to
 * 250. Five dollars was clear of a 60-card build and stopped a 99-card deck ten
 * rounds into the nineteen its ceiling grants, with 21 spells still to find —
 * mtg-bc2.49's shipped-short deck again, at the money bound instead of the round
 * bound, on a deck size `DECK_SIZES.commander` names and the criteria accept. So
 * the default is what the round ceiling costs: every round the loop may grant
 * itself, priced at what a round costs.
 *
 * That leaves the money bound doing the job the ceiling cannot do rather than a
 * job it already does. A round proposing forty cards and a round proposing four
 * are one round each and nothing like the same money, and it is the expensive
 * round, not the extra round, that this stops (mtg-bc2.89).
 *
 * A provider that cannot report what a call cost reports zero, so this bound
 * never binds there and `roundsCeiling` is what holds. That is the reason the
 * ceiling stays.
 */
export function defaultMaxSpendUsd(spellTarget: number): number {
  return Math.round(roundsCeiling(spellTarget) * ROUND_COST_USD * 100) / 100;
}

const ProposalSchema = z.object({
  name: z.string().min(1).describe('exact printed card name'),
  count: z.int().min(1).max(100).describe('number of copies'),
  criteria: z
    .array(z.string().min(1))
    .min(1)
    .describe('ids of the stated criteria this card serves; use the ids given, verbatim'),
  reason: z.string().min(1).describe('one sentence on why this card serves those criteria'),
});

export const DeckProposalSchema = z.object({
  cards: z.array(ProposalSchema).min(1),
  plan: z.string().min(1).describe('two or three sentences on the deck plan'),
});

export type DeckProposal = z.infer<typeof DeckProposalSchema>;

const SYSTEM = [
  'You are a Magic: the Gathering deck builder.',
  'You choose which cards go in a deck and why: the spells, and any nonbasic',
  'lands the deck wants. You never choose basic lands and never compute the',
  'basic-land split or draw probabilities; those are calculated separately from',
  'your picks, and anything you say about them is discarded.',
  'Propose only real cards whose exact printed names you are certain of.',
  'Every card must cite at least one of the stated criterion ids, verbatim.',
].join(' ');

export interface SelectionOptions {
  /**
   * Rounds the loop is guaranteed. A number above what `roundsCeiling` grants is
   * honored: the ceiling bounds what the loop grants itself, not what a caller
   * has already agreed to spend.
   */
  readonly maxRounds?: number;
  /**
   * Dollars of model spend this selection may reach, measured from what the
   * provider's budget guard had already recorded when it started. Absent takes
   * `defaultMaxSpendUsd` for the deck's spell target; a stated number is honored
   * exactly as given, and must be positive the way `@mtg/llm`'s own ceilings
   * must be.
   *
   * It bounds card selection and nothing else. The land-plan call `build.ts`
   * makes before selection starts is a model call this never sees, so a build's
   * whole bill is this plus that one round.
   */
  readonly maxSpendUsd?: number;
}

/**
 * Which bound ended card selection.
 *
 * Everything but `filled` leaves the deck short, and the report names the one
 * that did it. A reader told the model stopped proposing cards goes looking for
 * a card-supply problem, and that is the wrong place to look when what happened
 * is that the loop ran out of rounds.
 */
export type SelectionStop =
  /** The spell target was met. */
  | { readonly kind: 'filled' }
  /** A round added no spell the deck did not already have. */
  | { readonly kind: 'stalled' }
  /**
   * A round inside the guaranteed budget added nothing and surfaced no problem
   * the round before it did not already have, so the next round would have
   * asked the identical question. Distinct from `stalled`, which is the loop
   * running out of headway past the rounds it promised.
   */
  | { readonly kind: 'idle' }
  /** The dollars this selection was allowed to spend on model calls ran out. */
  | { readonly kind: 'spend'; readonly limit: number; readonly spentUsd: number }
  /** The rounds the caller stated ran out. */
  | { readonly kind: 'budget'; readonly limit: number }
  /** The cap on the rounds the loop grants itself ran out. */
  | { readonly kind: 'ceiling'; readonly limit: number };

export interface SelectionResult {
  readonly inclusions: readonly Inclusion[];
  /** Problems still outstanding after the last round. */
  readonly rejections: readonly Rejection[];
  readonly plan: string;
  readonly rounds: number;
  /**
   * Spells the loop never filled, and 0 when it filled them. This is the number
   * the report owes the reader when a deck comes back under its size: "58 cards
   * against 60" says the deck is short, not that the model ran out of rounds
   * with two spells still to find.
   */
  readonly shortBy: number;
  /** What ended the loop, so the report can name it rather than guess at it. */
  readonly stop: SelectionStop;
}

/** What every round is asked with; fixed for the length of one build. */
interface RoundContext {
  readonly provider: LlmProvider;
  readonly universe: CandidateUniverse;
  readonly criteria: ResolvedCriteria;
  readonly lookup: UniverseLookup;
}

/** What the rounds so far have produced. */
interface RoundState {
  readonly accepted: readonly Inclusion[];
  readonly rejections: readonly Rejection[];
  /** The first round's plan; later rounds are repairs and do not restate it. */
  readonly plan: string;
}

/** The three bounds one selection runs under, settled before the first round. */
interface RoundBounds {
  readonly maxRounds: number;
  readonly ceiling: number;
  /** This selection's spend and its ceiling, read fresh before every round. */
  readonly spend: () => { readonly spentUsd: number; readonly maxSpendUsd: number };
}

interface RoundsRun {
  readonly state: RoundState;
  readonly rounds: number;
  readonly stop: SelectionStop;
}

export async function selectCards(
  provider: LlmProvider,
  universe: CandidateUniverse,
  criteria: ResolvedCriteria,
  lookup: UniverseLookup,
  options: SelectionOptions = {},
): Promise<SelectionResult> {
  const context: RoundContext = { provider, universe, criteria, lookup };
  const spellTarget = Math.max(0, criteria.size - criteria.landCount);
  const run = await runRounds(context, spellTarget, {
    maxRounds: options.maxRounds ?? DEFAULT_MAX_ROUNDS,
    ceiling: roundsCeiling(spellTarget),
    spend: spendMeter(provider, options.maxSpendUsd ?? defaultMaxSpendUsd(spellTarget)),
  });

  return {
    inclusions: run.state.accepted,
    rejections: run.state.rejections,
    plan: run.state.plan,
    rounds: run.rounds,
    shortBy: Math.max(0, spellTarget - spellCount(run.state.accepted)),
    stop: run.stop,
  };
}

/**
 * What this selection has spent, against what it may.
 *
 * The guard belongs to the provider and counts the whole run, so a second build
 * in the same process must not inherit the first one's bill: this selection's
 * spend is the distance from where it found the guard.
 */
function spendMeter(provider: LlmProvider, maxSpendUsd: number): RoundBounds['spend'] {
  if (!Number.isFinite(maxSpendUsd) || maxSpendUsd <= 0) {
    throw new Error(`maxSpendUsd must be a positive finite number of dollars, got ${maxSpendUsd}`);
  }
  const before = provider.budget.snapshot().spentUsd;
  return () => ({ spentUsd: provider.budget.snapshot().spentUsd - before, maxSpendUsd });
}

/** Ask, fold in what verified, and stop at whichever bound comes first. */
async function runRounds(
  context: RoundContext,
  spellTarget: number,
  bounds: RoundBounds,
): Promise<RoundsRun> {
  let state: RoundState = { accepted: [], rejections: [], plan: '' };
  let round = 0;
  // Whether the round just run added spells; each round past the guarantee is
  // bought by the one before it. No round has run yet, so a stated budget of
  // zero rounds spends nothing rather than being handed a free call.
  let progressed = false;
  // Whether it changed anything the next prompt is built from; that is what the
  // guaranteed rounds are for, and a round that changed nothing has spent one
  // to no purpose.
  let informative = false;
  let stop: SelectionStop = { kind: 'filled' };

  for (;;) {
    // Nonbasic lands come out of the land slot, so they never count against the
    // spell target: a deck with all its spells is done even if it took no lands.
    const before = spellCount(state.accepted);
    const need = spellTarget - before;
    if (need <= 0) break;

    const halt = whyStopped({
      round,
      maxRounds: bounds.maxRounds,
      ceiling: bounds.ceiling,
      progressed,
      informative,
      ...bounds.spend(),
    });
    if (halt !== null) {
      stop = halt;
      break;
    }

    const previous = state;
    state = await runRound(context, state, need);
    round += 1;
    // Spells rather than cards. A round that names only nonbasic lands moves the
    // card count and leaves the spell target exactly where it was.
    progressed = spellCount(state.accepted) > before;
    informative = toldTheLoopSomething(previous, state);
  }

  return { state, rounds: round, stop };
}

/**
 * Whether the loop may ask again, and when it may not, which bound stopped it.
 *
 * Inside the stated budget the answer is yes for any round that told the loop
 * something: the repair loop exists to hand a rejection back, and the round
 * after a round of rejections is what the guarantee buys. It is no for the one
 * round that did not — the next prompt would be identical, and the guarantee is
 * of rounds that ask something, not of live calls. Past the budget, each round
 * is bought by the one before it having added spells, as far as the ceiling. A
 * caller who states more rounds than the ceiling grants gets them, and is told
 * their own budget is what ran out.
 *
 * Money is checked after headway and before either round bound. A build that
 * just stopped making headway is stopping whatever is left in the wallet, so
 * naming the wallet there would send the reader to raise a limit that buys
 * nothing; but no round bound may be spent past the dollars agreed to.
 */
function whyStopped(bounds: {
  readonly round: number;
  readonly maxRounds: number;
  readonly ceiling: number;
  readonly progressed: boolean;
  readonly informative: boolean;
  readonly spentUsd: number;
  readonly maxSpendUsd: number;
}): SelectionStop | null {
  const { round, maxRounds, ceiling } = bounds;
  // Nothing has run and nothing was granted: the caller bought no model call.
  if (round === 0 && maxRounds === 0) return { kind: 'budget', limit: maxRounds };

  if (round > 0) {
    if (round < maxRounds) {
      if (!bounds.informative) return { kind: 'idle' };
    } else if (!bounds.progressed) {
      return { kind: 'stalled' };
    }
  }

  if (bounds.spentUsd >= bounds.maxSpendUsd) {
    return { kind: 'spend', limit: bounds.maxSpendUsd, spentUsd: bounds.spentUsd };
  }

  if (round < maxRounds || round < ceiling) return null;
  return maxRounds >= ceiling ? { kind: 'budget', limit: maxRounds } : { kind: 'ceiling', limit: ceiling };
}

/**
 * Did the round just run change anything the next prompt is built from?
 *
 * The prompt is the accepted list, the outstanding problems, and how many spells
 * are still wanted. A round that left the first two as it found them left the
 * third alone too — accepting a spell is what moves it — so the next round would
 * be handed the same bytes and asked for the same answer.
 *
 * Rejections are keyed on the sentence the model is actually shown, because two
 * cards failing the same way are two different things to fix, and both lists are
 * compared whole rather than for arrivals. Asking only whether a key had
 * appeared that the round before did not have read a problem list that shrank or
 * came back reordered as "nothing new" — and those are precisely the rounds
 * whose next prompt would carry a different set of problems, so the round the
 * guarantee then refused to buy was a round that would have asked a different
 * question. Fewer problems is not the same question twice.
 */
function toldTheLoopSomething(before: RoundState, after: RoundState): boolean {
  if (acceptedKey(before.accepted) !== acceptedKey(after.accepted)) return true;
  return problemsKey(before.rejections) !== problemsKey(after.rejections);
}

function problemsKey(rejections: readonly Rejection[]): string {
  return rejections.map(rejectionKey).join('|');
}

function acceptedKey(inclusions: readonly Inclusion[]): string {
  return inclusions.map((entry) => `${entry.count}x${entry.card.oracleId}`).join('|');
}

function rejectionKey(rejection: Rejection): string {
  return `${rejection.code}:${rejection.detail}`;
}

/**
 * One round: ask, verify, and fold what verified into the accumulated deck.
 *
 * Cards accepted in an earlier round are dropped rather than added twice. The
 * deck budget and the land slot are applied to the whole accumulated list rather
 * than to one round of proposals, because that is what they are properties of:
 * three rounds of $19 proposals each pass a $20 budget in isolation and total
 * $57 together.
 */
async function runRound(context: RoundContext, state: RoundState, need: number): Promise<RoundState> {
  const { universe, criteria } = context;
  const { value } = await context.provider.complete({
    system: SYSTEM,
    prompt: buildPrompt(criteria, universe, need, state.accepted, state.rejections),
    schema: DeckProposalSchema,
  });

  const verified = verifyProposals(value.cards as readonly Proposal[], universe, criteria, context.lookup);
  const have = new Set(state.accepted.map((entry) => entry.card.oracleId));
  const merged = [...state.accepted];
  for (const inclusion of verified.inclusions) {
    if (have.has(inclusion.card.oracleId)) continue;
    merged.push(inclusion);
    have.add(inclusion.card.oracleId);
  }

  const budgeted = enforceDeckBudget(merged, criteria);
  const slotted = enforceLandSlot(budgeted.inclusions, criteria);
  return {
    accepted: slotted.inclusions,
    rejections: [...verified.rejections, ...budgeted.rejections, ...slotted.rejections],
    plan: state.plan === '' ? value.plan : state.plan,
  };
}

function buildPrompt(
  criteria: ResolvedCriteria,
  universe: CandidateUniverse,
  need: number,
  accepted: readonly Inclusion[],
  rejections: readonly Rejection[],
): string {
  const stated = enumerateCriteria(criteria);
  const landRoom = criteria.landCount - landCount(accepted);
  const lines: string[] = [
    `The player asked for: ${criteria.prompt}`,
    '',
    `Format: ${criteria.format}. Deck size ${criteria.size}: ${criteria.size - criteria.landCount} non-land cards and ${criteria.landCount} lands.`,
    `Choose ${need} more non-land cards (counting copies).`,
    '',
    'Lands. You may also name nonbasic lands: duals, fetches, filters, creature-lands,',
    'and utility lands are deck choices and belong to you. Do not name basic lands.',
    `Every one of the ${criteria.landCount} land slots you do not fill becomes a basic,`,
    'apportioned across colours from the pip demand of the cards you chose.',
    landRoom > 0
      ? `There is room for ${landRoom} more nonbasic lands; naming none is a fine answer for a mono-coloured deck.`
      : 'The land slot is full; do not name any more lands.',
    '',
    'Stated criteria. Cite these ids verbatim:',
    ...stated.map((criterion) => `  ${criterion.id} — ${criterion.statement}`),
    '',
    'Structural filters already applied to the legal card pool:',
    ...universe.filters.map((filter) => `  ${filter}`),
    `The pool holds ${universe.cards.length} legal cards. A card outside it will be rejected.`,
  ];

  if (accepted.length > 0) {
    lines.push(
      '',
      'Already in the deck — do not propose these again:',
      ...accepted.map((entry) => `  ${entry.count}x ${entry.card.name}`),
    );
  }

  if (rejections.length > 0) {
    lines.push(
      '',
      'Your previous answer had these problems. Replace those cards:',
      ...rejections.map((rejection) => `  ${rejection.detail}`),
    );
  }

  return lines.join('\n');
}
