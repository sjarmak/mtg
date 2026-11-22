/** Pool-aware bot policy for drafts run inside this repository. */
import type { CardEvaluation, CardScoreWeights } from '@mtg/deckbuild';
import {
  DEFAULT_SCORE_WEIGHTS,
  deckContextOf,
  deckContextWith,
  evaluateCard,
  resolveConfig,
} from '@mtg/deckbuild';
import type { Card, Color } from '@mtg/dsl';
import { cardManaValue, colorPips, isLand } from '@mtg/dsl';
import { projectedPoolValueOfChecked } from './limited-evaluation/deck';
import type { EvaluationCard } from './limited-evaluation/model';
import { DraftError } from './errors';
import type { EvaluatorRating } from './rating';
import type { Rng } from './rng';
import { nextBelow } from './rng';

/** The policy Draftmancer applies to generated custom cards in an exported file. */
export const DRAFTMANCER_SIMPLE_BOT_POLICY = 'draftmancer-simple/v1';

/** The strongest-play policy used by native generated-set draft seats. */
export const NATIVE_DECK_CONDITIONED_BOT_POLICY = 'native-deck-conditioned/v1';

export const DEFAULT_NATIVE_DRAFT_BOT_POLICY = NATIVE_DECK_CONDITIONED_BOT_POLICY;

export type NativeDraftBotPolicy =
  typeof DRAFTMANCER_SIMPLE_BOT_POLICY | typeof NATIVE_DECK_CONDITIONED_BOT_POLICY;

export interface NativeDraftScoreOptions {
  /** Set-relative ratings produced once for the complete drafted set. */
  readonly ratings?: ReadonlyMap<string, EvaluatorRating>;
  /** Context-free evaluations prepared once by a full draft runtime. */
  readonly contextFree?: ReadonlyMap<string, CardEvaluation>;
  readonly weights?: CardScoreWeights;
}

function fixedPips(card: Card): Partial<Record<Color, number>> {
  if (isLand(card)) return {};
  return Object.fromEntries(colorPips(card.manaCost).filter(([, count]) => count > 0));
}

function baseRating(card: Card, options: NativeDraftScoreOptions): number {
  const known = options.ratings?.get(card.id);
  return known?.rating ?? evaluateCard(card, options.weights ?? DEFAULT_SCORE_WEIGHTS).score;
}

function clampQuality(value: number): number {
  return Math.max(0, Math.min(5, value));
}

function evaluationCard(card: Card, instanceId: string, quality: number, isRemoval: boolean): EvaluationCard {
  const land = isLand(card);
  return {
    id: instanceId,
    colors: card.colors,
    manaValue: cardManaValue(card),
    type: land ? 'nonbasic-land' : card.kind === 'creature' ? 'creature' : 'noncreature-spell',
    pips: fixedPips(card),
    sources: land ? card.producesMana.filter((color): color is Color => color !== 'C') : [],
    quality: clampQuality(quality),
    roles: isRemoval ? ['interaction'] : [],
    tags: [],
    payoffs: [],
  };
}

interface PreparedPick {
  readonly card: Card;
  readonly evaluated: EvaluationCard;
}

function preparePicked(picked: readonly Card[], options: NativeDraftScoreOptions): readonly PreparedPick[] {
  const weights = options.weights ?? DEFAULT_SCORE_WEIGHTS;
  return picked.map((card, index) => {
    const evaluated = options.contextFree?.get(card.id) ?? evaluateCard(card, weights);
    return {
      card,
      evaluated: evaluationCard(
        card,
        `pick/${String(index)}/${card.id}`,
        baseRating(card, options),
        evaluated.isRemoval,
      ),
    };
  });
}

function candidatePoolValue(
  candidate: EvaluatorRating,
  picked: readonly PreparedPick[],
  baseContext: ReturnType<typeof deckContextOf>,
  options: NativeDraftScoreOptions,
): number {
  const weights = options.weights ?? DEFAULT_SCORE_WEIGHTS;
  const context = deckContextWith(baseContext, candidate.card, weights);
  const contextual = evaluateCard(candidate.card, weights, context);
  const evaluated = [
    ...picked.map((entry) => entry.evaluated),
    evaluationCard(
      candidate.card,
      `candidate/${String(picked.length)}/${candidate.card.id}`,
      candidate.rating + contextual.score - candidate.score,
      contextual.isRemoval,
    ),
  ];
  const flexibility = 0.05 * Math.max(0, 1 - picked.length / 23) * candidate.rating;
  return projectedPoolValueOfChecked(evaluated) + flexibility;
}

/** Every visible candidate's projected observed-pool deck value, in pack order. */
export function nativeDraftScores(
  pack: readonly EvaluatorRating[],
  picked: readonly Card[],
  options: NativeDraftScoreOptions = {},
): readonly number[] {
  if (pack.length === 0) throw new DraftError('a bot cannot score an empty pack');
  const prepared = preparePicked(picked, options);
  const weights = options.weights ?? DEFAULT_SCORE_WEIGHTS;
  const context = deckContextOf(picked, resolveConfig({ weights }));
  return pack.map((candidate) => candidatePoolValue(candidate, prepared, context, options));
}

/** Argmax over native deck values, with the caller's seeded tie-break stream. */
export function nativeDraftPick(
  pack: readonly EvaluatorRating[],
  picked: readonly Card[],
  rng: Rng,
  options: NativeDraftScoreOptions = {},
): readonly [number, Rng] {
  const scores = nativeDraftScores(pack, picked, options);
  const best = Math.max(...scores);
  const tied = scores.flatMap((score, index) => (score === best ? [index] : []));
  const [choice, advanced] = nextBelow(rng, tied.length);
  const index = tied[choice];
  if (index === undefined) throw new DraftError('a scored pack produced no best card');
  return [index, advanced];
}
