/**
 * The whole feature in one call: criteria in, explained deck out.
 *
 * The order is the ZFC split made executable — code narrows, the model sizes the
 * mana base, the model chooses the cards, code verifies, code computes. Each
 * stage's output is the next stage's input and nothing skips ahead: the model is
 * never consulted about arithmetic, and code never decides whether a card is
 * good or how many lands the deck wants.
 */
import type { DataStore } from '@mtg/data';
import type { LlmProvider } from '@mtg/llm';
import type { AssembledDeck } from './assemble';
import { assembleDeck } from './assemble';
import { loadKnownNames, selectUniverse } from './candidates';
import type { DeckCriteriaInput, ResolvedCriteria } from './criteria';
import { DeckCriteriaSchema } from './criteria';
import type { LandPlan } from './land-plan';
import { planLandCount, resolveCriteria } from './land-plan';
import { formatConstructedDeckReport } from './report';
import type { SelectionOptions } from './select';
import { selectCards } from './select';
import type { Rejection } from './verify';

export interface BuildDeckInput extends SelectionOptions {
  readonly store: DataStore;
  readonly provider: LlmProvider;
  readonly criteria: DeckCriteriaInput;
}

export interface BuiltDeck {
  /** The stated criteria plus the land count that was decided for this build. */
  readonly criteria: ResolvedCriteria;
  /** The land count and where it came from: the player, or the model. */
  readonly landPlan: LandPlan;
  readonly deck: AssembledDeck;
  readonly plan: string;
  readonly rejections: readonly Rejection[];
  readonly universeSize: number;
  readonly rounds: number;
  /** Spells the selection loop never filled; 0 when it met the spell target. */
  readonly shortBy: number;
  readonly report: string;
}

export class EmptyUniverseError extends Error {
  constructor(readonly filters: readonly string[]) {
    super(`no cards satisfy the stated criteria: ${filters.join('; ')}`);
    this.name = 'EmptyUniverseError';
  }
}

export async function buildInformedDeck(input: BuildDeckInput): Promise<BuiltDeck> {
  const stated = DeckCriteriaSchema.parse(input.criteria);

  const universe = selectUniverse(input.store, stated);
  if (universe.cards.length === 0) throw new EmptyUniverseError(universe.filters);

  // Before the cards, because the spell target is what is left after the lands.
  // Asked after the universe check so an impossible request costs no model call.
  const landPlan = await planLandCount(input.provider, stated);
  const criteria = resolveCriteria(stated, landPlan);

  const knownNames = loadKnownNames(input.store);
  const selection = await selectCards(input.provider, universe, criteria, { knownNames }, {
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
    shortBy: selection.shortBy,
    stop: selection.stop,
    universeSize: universe.cards.length,
  });

  return {
    criteria,
    landPlan,
    deck,
    plan: selection.plan,
    rejections: selection.rejections,
    universeSize: universe.cards.length,
    rounds: selection.rounds,
    shortBy: selection.shortBy,
    report,
  };
}
