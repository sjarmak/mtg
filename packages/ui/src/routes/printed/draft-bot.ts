/** Reproducible UI baseline, not strategic AKH/HOU qualification. Bump the recipe policy on any change. */
import {
  countPickedColors,
  simpleBotScore,
  evaluatePrintedCard,
  evaluateStructuralPrintedCard,
  printedPickValue,
  PRINTED_EVALUATION_POLICY,
  structuralPrintedPickValue,
  STRUCTURAL_PRINTED_EVALUATION_POLICY,
} from '@mtg/draft-export';
import type {
  PrintedLimitedDraftOptions,
  PreparedPrintedLimitedFormat,
  EvaluationCard,
} from '@mtg/draft-export';
import type { PrintedCardCatalogEntry } from '@mtg/printed-card';
import {
  isPrintedDraftRatingsPolicy,
  evaluateRankedPrintedCard,
  printedDraftRatingsPolicy,
} from '../../lab/printed-draft-ratings';
import type { PrintedDraftRatings } from '../../lab/printed-draft-ratings';
import { printedStructuralScore } from './limited-facts';

export const PRINTED_BASELINE_BOT: Pick<PrintedLimitedDraftOptions, 'botPolicy' | 'score'> = {
  botPolicy: 'printed-limited-v1',
  score: ({ card, picked }) =>
    simpleBotScore(
      { card: card.payload.printing, rating: printedStructuralScore(card.payload.printing) / 20 },
      countPickedColors(picked.map((copy) => copy.payload.printing)),
    ),
};

/** Observed picks and the offered card are the complete scoring input. */
export const PRINTED_EVALUATED_BOT: Pick<PrintedLimitedDraftOptions, 'botPolicy' | 'score'> = {
  botPolicy: PRINTED_EVALUATION_POLICY,
  score: ({ card, picked }) =>
    printedPickValue(
      evaluatePrintedCard(card.payload.printing, card.physicalId),
      picked.map((copy) => evaluatePrintedCard(copy.payload.printing, copy.physicalId)),
    ),
};

/** General strongest-play policy derived from printed structure and the observed pool. */
export const PRINTED_GENERAL_BOT: Pick<PrintedLimitedDraftOptions, 'botPolicy' | 'score'> = {
  botPolicy: STRUCTURAL_PRINTED_EVALUATION_POLICY,
  score: ({ card, picked }) =>
    structuralPrintedPickValue(
      evaluateStructuralPrintedCard(card.payload.printing, card.physicalId),
      picked.map((copy) => evaluateStructuralPrintedCard(copy.payload.printing, copy.physicalId)),
    ),
};

type PrintedBot = Pick<PrintedLimitedDraftOptions, 'botPolicy' | 'score'>;

function rankedBot(ratings: PrintedDraftRatings): PrintedBot {
  return {
    botPolicy: printedDraftRatingsPolicy(ratings),
    score: ({ card, picked }) =>
      rankedPrintedPickValue(
        evaluateRankedPrintedCard(ratings, card.payload.printing, card.physicalId),
        picked.map((copy) => evaluateRankedPrintedCard(ratings, copy.payload.printing, copy.physicalId)),
      ),
  };
}

/** Static rank carries early picks until the observed pool contains enough signal to plan a deck. */
function rankedPrintedPickValue(card: EvaluationCard, picked: readonly EvaluationCard[]): number {
  if (picked.length === 0) return card.quality;
  const earlyRankWeight = Math.max(0.15, 1 - picked.length / 23);
  return structuralPrintedPickValue(card, picked) + earlyRankWeight * card.quality;
}

export function printedBotForPolicy(policy: string | undefined, ratings?: PrintedDraftRatings): PrintedBot {
  if (policy === undefined || policy === PRINTED_BASELINE_BOT.botPolicy) return PRINTED_BASELINE_BOT;
  if (policy === PRINTED_GENERAL_BOT.botPolicy) return PRINTED_GENERAL_BOT;
  if (policy === PRINTED_EVALUATED_BOT.botPolicy) return PRINTED_EVALUATED_BOT;
  if (ratings !== undefined && policy === printedDraftRatingsPolicy(ratings)) return rankedBot(ratings);
  throw new Error(`Saved draft bot policy is unavailable: ${policy}`);
}

export function botForNewPrintedDraft(
  prepared: Pick<PreparedPrintedLimitedFormat, 'format'>,
  ratings?: PrintedDraftRatings,
): PrintedBot {
  // This version's authored judgments cover precisely these authenticated source catalogs.
  return prepared.format.sources.length > 0 &&
    prepared.format.sources.every((source) => EVALUATED_CATALOGS.includes(source.catalogSha256))
    ? PRINTED_EVALUATED_BOT
    : ratings === undefined
      ? PRINTED_GENERAL_BOT
      : rankedBot(ratings);
}

/** Short user-facing identity for the policy recorded in a draft transcript. */
export function printedBotLabel(policy: string | undefined): string {
  if (isPrintedDraftRatingsPolicy(policy)) return 'Ranked deck-aware';
  const bot = printedBotForPolicy(policy);
  if (bot.botPolicy === PRINTED_EVALUATED_BOT.botPolicy) return 'Deck-aware';
  if (bot.botPolicy === PRINTED_GENERAL_BOT.botPolicy) return 'General structural';
  return 'Baseline';
}

/** Short user-facing statement of where this policy gets set-specific judgment. */
export function printedBotCalibrationNote(policy: string | undefined): string {
  if (isPrintedDraftRatingsPolicy(policy)) return 'use staged Forge set rankings with deck-aware picks';
  const bot = printedBotForPolicy(policy);
  if (bot.botPolicy === PRINTED_EVALUATED_BOT.botPolicy)
    return 'use authored set evaluations with deck-aware picks';
  return 'are not format-calibrated';
}

const EVALUATED_CATALOGS: readonly string[] = [
  'fd566c80257ffc11d7901ec7f96fc0fe5a9537f64f5dc68751388686f80e24c8',
  '8b838178bdcb24d4e8995e6cece4a443b760237effd2469649e871e64ee06a6c',
  'feaccf1784926c2bd9f50ed6bc1de164f7840e66c8e205279dcee96ab7ae4011',
];

/** One mounted draft owns this cache; nothing is shared across sessions or policies. */
export function createPrintedReplayBot(
  policy: string | undefined,
  ratings?: PrintedDraftRatings,
): Pick<PrintedLimitedDraftOptions, 'botPolicy' | 'score'> &
  Partial<Pick<PrintedLimitedDraftOptions, 'choose'>> {
  const bot = printedBotForPolicy(policy, ratings);
  if (bot === PRINTED_BASELINE_BOT) return bot;
  const ranked = ratings !== undefined && bot.botPolicy === printedDraftRatingsPolicy(ratings);
  const evaluate = (printing: PrintedCardCatalogEntry, id: string) => {
    if (bot.botPolicy === PRINTED_EVALUATED_BOT.botPolicy) return evaluatePrintedCard(printing, id);
    const structural = evaluateStructuralPrintedCard(printing, id);
    return ranked ? evaluateRankedPrintedCard(ratings, printing, id) : structural;
  };
  const pickValue =
    bot.botPolicy === PRINTED_EVALUATED_BOT.botPolicy
      ? printedPickValue
      : ranked
        ? rankedPrintedPickValue
        : structuralPrintedPickValue;
  const cards = new WeakMap<
    PrintedCardCatalogEntry,
    { readonly card: EvaluationCard; readonly token: number }
  >();
  let nextToken = 0;
  interface PreparedPool {
    readonly cards: readonly EvaluationCard[];
    readonly identity: string;
    readonly values: Map<string, Map<number, number>>;
  }
  const canonicalPools = new Map<string, PreparedPool>();
  const pools = new WeakMap<Parameters<PrintedLimitedDraftOptions['score']>[0]['picked'], PreparedPool>();
  const entry = (printing: PrintedCardCatalogEntry) => {
    let cached = cards.get(printing);
    if (cached === undefined) {
      cached = { card: evaluate(printing, printing.physicalId), token: nextToken++ };
      cards.set(printing, cached);
    }
    return cached;
  };
  const poolOf = (picked: Parameters<PrintedLimitedDraftOptions['score']>[0]['picked']) => {
    const known = pools.get(picked);
    if (known !== undefined) return known;
    const prepared = picked.map((copy) => ({ copy, entry: entry(copy.payload.printing) }));
    const identity = JSON.stringify(
      prepared.map(({ copy, entry: cached }) => [copy.physicalId, cached.token] as const),
    );
    let pool = canonicalPools.get(identity);
    if (pool === undefined) {
      pool = {
        cards: prepared.map(({ copy, entry: cached }) => ({ ...cached.card, id: copy.physicalId })),
        identity,
        values: new Map(),
      };
      if (canonicalPools.size >= 512) canonicalPools.clear();
      canonicalPools.set(identity, pool);
    }
    pools.set(picked, pool);
    return pool;
  };
  const score: PrintedLimitedDraftOptions['score'] = ({ card, picked }) => {
    const candidate = entry(card.payload.printing);
    const pool = poolOf(picked);
    // Prepared catalog entries are immutable. Distinct payload objects get distinct tokens.
    let values = pool.values.get(card.physicalId);
    if (values === undefined) {
      values = new Map();
      pool.values.set(card.physicalId, values);
    }
    const cached = values.get(candidate.token);
    if (cached !== undefined) return cached;
    const value = pickValue({ ...candidate.card, id: card.physicalId }, pool.cards);
    values.set(candidate.token, value);
    return value;
  };
  const choices = new Map<string, string>();
  const choose: NonNullable<PrintedLimitedDraftOptions['choose']> = (input) => {
    const pool = poolOf(input.picked);
    const candidates = input.cards.map((card) => {
      const candidate = entry(card.payload.printing);
      return [card.physicalId, candidate.token] as const;
    });
    const key = JSON.stringify([
      input.seatId,
      input.round,
      input.pickNumber,
      input.packSize,
      input.openedBy,
      pool.identity,
      candidates,
    ]);
    const known = choices.get(key);
    if (known !== undefined) return input.cards.findIndex((card) => card.physicalId === known);
    const scores = input.cards.map((card) => score({ ...input, card }));
    const best = Math.max(...scores);
    const index = scores.findIndex((value) => value === best);
    const selected = input.cards[index];
    if (selected === undefined) throw new Error('Printed draft policy chose no card.');
    if (choices.size >= 512) choices.clear();
    choices.set(key, selected.physicalId);
    return index;
  };
  return {
    botPolicy: bot.botPolicy,
    score,
    choose,
  };
}
