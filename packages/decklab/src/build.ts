/**
 * The whole feature in one call: criteria in, explained deck out.
 *
 * The order is the ZFC split made executable — code narrows, the model sizes the
 * mana base, the model chooses the cards, code verifies, code computes. Each
 * stage's output is the next stage's input and nothing skips ahead: the model is
 * never consulted about arithmetic, and code never decides whether a card is
 * good or how many lands the deck wants.
 */
import type { LlmProvider } from '@mtg/llm';
import type { AssembledDeck } from './assemble';
import { assembleDeck } from './assemble';
import type { DeckCriteriaInput, ResolvedCriteria } from './criteria';
import { DeckCriteriaSchema } from './criteria';
import type { LandPlan } from './land-plan';
import { planLandCount, resolveCriteria } from './land-plan';
import type { DeckPool } from './pool';
import { formatConstructedDeckReport } from './report';
import type { SelectionOptions, SelectionStop } from './select';
import { selectCards } from './select';
import type { Adjustment, Rejection } from './verify';
import {
  completedDeckbuildingEvidence,
  DeckbuildingEvidenceError,
  deckbuildingEvidenceIdentity,
  failedDeckbuildingEvidence,
  recordDeckbuildingModelEvidence,
  type DeckbuildingEvidenceRequest,
} from './deck-evidence';
import type { BotEvidenceEpisode } from '@mtg/bot-evidence';
import type { ConstructedFormatContract, ConstructedSelectionPolicy } from './constructed-policy';
import { constructedFormatContract, constructedSelectionPolicy } from './constructed-policy';

export interface BuildDeckInput extends SelectionOptions {
  /**
   * What may go in the deck, and what counts as a card that exists.
   *
   * The store used to be the argument here, and the pool is what it always
   * meant: `storeDeckPool` and `setDeckPool` are the two ways to answer that
   * question, and nothing below this line can tell which one answered it.
   */
  readonly pool: DeckPool;
  readonly provider: LlmProvider;
  readonly criteria: DeckCriteriaInput;
  /** Optional collection of reproducible model decisions and the verified build outcome. */
  readonly evidence?: DeckbuildingEvidenceRequest | null;
}

/** What one build cost, and the ceiling that bounded the part of it that had one. */
export interface BuildSpend {
  /** Every dollar this build's model calls cost, the land plan included. */
  readonly spentUsd: number;
  /** What the selection loop spent, which is the part `maxSpendUsd` bounded. */
  readonly selectionUsd: number;
  /** The ceiling in force, stated by the caller or derived from the deck's size. */
  readonly maxSpendUsd: number;
}

export interface BuiltDeck {
  /** The stated criteria plus the land count that was decided for this build. */
  readonly criteria: ResolvedCriteria;
  /** The land count and where it came from: the player, or the model. */
  readonly landPlan: LandPlan;
  /** Versioned construction inputs and policy identity for replay and comparison. */
  readonly construction: {
    readonly format: ConstructedFormatContract;
    readonly selection: ConstructedSelectionPolicy;
  };
  readonly deck: AssembledDeck;
  readonly plan: string;
  readonly rejections: readonly Rejection[];
  /** Counts trimmed to the stated copy limit rather than refused. */
  readonly adjustments: readonly Adjustment[];
  readonly universeSize: number;
  readonly rounds: number;
  /**
   * What this build cost, and the ceiling the selection loop ran under.
   *
   * `mtg-yp33.7`. Three numbers rather than two, because the ceiling does not
   * bound the whole build: `planLandCount` is a model call made before the loop
   * starts and outside its meter, so a total reported against the loop's ceiling
   * could read as a breach the ceiling never had. `spentUsd` is the bill,
   * `selectionUsd` is the part the ceiling governed, and the difference is the
   * land plan.
   */
  readonly spend: BuildSpend;
  /** What ended the selection loop, so a surface can say it rather than guess. */
  readonly stop: SelectionStop;
  /** Spells the selection loop never filled; 0 when it met the spell target. */
  readonly shortBy: number;
  readonly report: string;
  /** Present only when the caller explicitly enables evidence collection. */
  readonly evidence?: BotEvidenceEpisode;
}

export class EmptyUniverseError extends Error {
  constructor(readonly filters: readonly string[]) {
    super(`no cards satisfy the stated criteria: ${filters.join('; ')}`);
    this.name = 'EmptyUniverseError';
  }
}

export async function buildInformedDeck(input: BuildDeckInput): Promise<BuiltDeck> {
  if (input.evidence === undefined || input.evidence === null) return buildInformedDeckCore(input);

  const episode = deckbuildingEvidenceIdentity(input.evidence);
  const recorder = recordDeckbuildingModelEvidence(input.provider);
  try {
    const built = await buildInformedDeckCore({ ...input, provider: recorder.provider });
    return {
      ...built,
      evidence: completedDeckbuildingEvidence(episode, recorder.decisions(), built),
    };
  } catch (cause: unknown) {
    throw new DeckbuildingEvidenceError(
      failedDeckbuildingEvidence(episode, recorder.decisions(), cause),
      cause,
    );
  }
}

async function buildInformedDeckCore(input: BuildDeckInput): Promise<BuiltDeck> {
  const stated = DeckCriteriaSchema.parse(input.criteria);

  const universe = input.pool.universe;
  if (universe.cards.length === 0) throw new EmptyUniverseError(universe.filters);

  // Read before the first model call rather than from zero: the guard belongs to
  // the provider and counts the whole process, so a second build in it must not
  // report the first one's bill as its own.
  const spentBefore = input.provider.budget.snapshot().spentUsd;

  // Before the cards, because the spell target is what is left after the lands.
  // Asked after the universe check so an impossible request costs no model call.
  const landPlan = await planLandCount(input.provider, stated);
  const criteria = resolveCriteria(stated, landPlan);

  const knownNames = input.pool.knownNames;
  const worldName =
    input.pool.kind === 'set'
      ? (stated.sets ?? []).join(', ')
      : input.pool.kind === 'printed-format'
        ? `${input.pool.formatId} printed format`
        : 'the store';
  const selection = await selectCards(input.provider, input.pool, criteria, { knownNames, worldName }, {
    ...(input.maxRounds === undefined ? {} : { maxRounds: input.maxRounds }),
    ...(input.maxSpendUsd === undefined ? {} : { maxSpendUsd: input.maxSpendUsd }),
  } satisfies SelectionOptions);

  const deck = assembleDeck(selection.inclusions, criteria);
  const report = formatConstructedDeckReport({
    criteria,
    deck,
    landPlan,
    plan: selection.plan,
    rejections: selection.rejections,
    adjustments: selection.adjustments,
    shortBy: selection.shortBy,
    stop: selection.stop,
    universeSize: universe.cards.length,
  });

  return {
    criteria,
    landPlan,
    construction: {
      format: constructedFormatContract(input.pool, criteria),
      selection: constructedSelectionPolicy(input.provider),
    },
    deck,
    plan: selection.plan,
    rejections: selection.rejections,
    adjustments: selection.adjustments,
    universeSize: universe.cards.length,
    rounds: selection.rounds,
    spend: {
      spentUsd: input.provider.budget.snapshot().spentUsd - spentBefore,
      selectionUsd: selection.spend.spentUsd,
      maxSpendUsd: selection.spend.maxSpendUsd,
    },
    stop: selection.stop,
    shortBy: selection.shortBy,
    report,
  };
}
