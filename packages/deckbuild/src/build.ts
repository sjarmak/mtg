/**
 * `buildDeck`: sealed/draft pool -> 40-card Limited deck, deterministically.
 *
 * No LLM is consulted at this tier. Given the same pool and the same config the
 * result is byte-identical, which is what makes it usable as the baseline the
 * later LLM deck-building tier is measured against, and as the deck source for
 * seeded mass simulation.
 *
 * The pipeline is: score every card -> rank the ten color pairs -> select
 * spells against the target curve -> apportion basics by weighted pip demand ->
 * collect every gap into `shortfalls`.
 */
import type { Card, Color } from '@mtg/dsl';
import type { ColorPair, ColorPairEvaluation, PoolColorCounts } from './color-pair';
import { countPlayablesByColor, playablesFor, rankColorPairs } from './color-pair';
import type { DeckBuildConfig, DeckBuildConfigInput } from './config';
import { resolveConfig, spellCount } from './config';
import type { CurveBucket, CurveHistogram } from './curve-bucket';
import { CURVE_BUCKETS } from './curve-bucket';
import { priceAgainstDeck } from './deck-pricing';
import type { PoolCard } from './evaluate';
import { evaluatePool } from './evaluate';
import type { ManaBase } from './mana-base';
import { buildManaBase } from './mana-base';
import type { SpellSelection } from './select-spells';
import { selectSpells } from './select-spells';
import type { Shortfall } from './shortfall';
import { isComplete } from './shortfall';

/** Target vs achieved for one curve bucket. */
export interface CurveSlotReport {
  readonly bucket: CurveBucket;
  readonly target: number;
  readonly achieved: number;
  /** Achieved minus target: negative is a gap, positive is overflow. */
  readonly delta: number;
}

export interface CurveReport {
  readonly target: CurveHistogram;
  readonly achieved: CurveHistogram;
  readonly slots: readonly CurveSlotReport[];
  /** Spells at MV 2-4: the sourced "curve mass" measure. */
  readonly massTwoToFour: number;
  /** Spells at MV 5 and above. */
  readonly topEnd: number;
}

export interface DeckBuildResult {
  /** The finished deck: spells first (best pick first), then lands. */
  readonly deck: readonly Card[];
  readonly spells: readonly Card[];
  readonly lands: readonly Card[];
  readonly colorPair: ColorPair;
  /** All ten pairs, best-first, with the numbers behind the choice. */
  readonly colorPairs: readonly ColorPairEvaluation[];
  /** Non-land playables per color across the whole pool, plus colorless. */
  readonly poolColors: PoolColorCounts;
  readonly curve: CurveReport;
  readonly creatureCount: number;
  readonly removalCount: number;
  readonly manaBase: ManaBase;
  /** Per-card scores for the chosen spells, best first. */
  readonly picks: readonly PoolCard[];
  /** Playables the deck did not take, best-first: the sideboard. */
  readonly sideboard: readonly PoolCard[];
  readonly shortfalls: readonly Shortfall[];
  /** True when the deck is the full size, on curve, and color-sound. */
  readonly complete: boolean;
  readonly config: DeckBuildConfig;
}

/** Mana values counted as the curve's mass, per the Limited construction norms. */
const MASS_BUCKETS: readonly CurveBucket[] = [2, 3, 4];

function curveReport(target: CurveHistogram, achieved: CurveHistogram): CurveReport {
  const slots = CURVE_BUCKETS.map((bucket) => ({
    bucket,
    target: target[bucket],
    achieved: achieved[bucket],
    delta: achieved[bucket] - target[bucket],
  }));
  return {
    target,
    achieved,
    slots,
    massTwoToFour: MASS_BUCKETS.reduce<number>((sum, bucket) => sum + achieved[bucket], 0),
    topEnd: CURVE_BUCKETS.filter((bucket) => bucket >= 5).reduce<number>(
      (sum, bucket) => sum + achieved[bucket],
      0,
    ),
  };
}

function selectionShortfalls(selection: SpellSelection, config: DeckBuildConfig): Shortfall[] {
  const shortfalls: Shortfall[] = [];
  const wanted = spellCount(config);
  if (selection.spells.length < wanted) {
    shortfalls.push({
      kind: 'spellSlots',
      target: wanted,
      achieved: selection.spells.length,
      missing: wanted - selection.spells.length,
    });
  }
  for (const bucket of CURVE_BUCKETS) {
    const target = config.targetCurve[bucket];
    const achieved = selection.achievedCurve[bucket];
    if (achieved < target) {
      shortfalls.push({ kind: 'curveSlot', bucket, target, achieved, missing: target - achieved });
    }
  }
  if (selection.creatureCount < config.minCreatures) {
    shortfalls.push({
      kind: 'creatureFloor',
      target: config.minCreatures,
      achieved: selection.creatureCount,
      missing: config.minCreatures - selection.creatureCount,
    });
  }
  return shortfalls;
}

function assertPoolIsUsable(pool: readonly Card[]): void {
  if (pool.length === 0) throw new Error('buildDeck: pool is empty; nothing to build from');
}

/**
 * Builds the best 40-card deck the pool supports.
 *
 * The land count is always exactly `config.landCount` — basics are synthesized
 * when the pool has none. The spell count degrades when the pool cannot fill
 * it, and every gap lands in `shortfalls`, so an undersized deck is loud rather
 * than silent. Callers that require a legal deck check `result.complete`.
 */
export function buildDeck(pool: readonly Card[], input: DeckBuildConfigInput = {}): DeckBuildResult {
  assertPoolIsUsable(pool);
  const config = resolveConfig(input);
  const evaluations = evaluatePool(pool, config.weights);
  const colorPairs = rankColorPairs(evaluations, spellCount(config));

  const best = colorPairs[0];
  if (best === undefined) throw new Error('buildDeck: color-pair ranking produced no candidates');

  const playables = playablesFor(evaluations, best.pair);
  // Two passes, deliberately (`deck-pricing.ts`). The first prices every card
  // in isolation, which is all the colors' ranking could ever have; the second
  // prices it against the deck the first one produced, so a card whose worth
  // depends on what it is played beside is finally asked about that deck rather
  // than about the average of the ten this builder happened to build last time.
  const provisional = selectSpells(playables, config);
  const conditioned = priceAgainstDeck(playables, provisional.spells, config);
  const selection = selectSpells(conditioned, config);
  const manaBase = buildManaBase(selection.spells, best.pair, pool, config);

  const shortfalls: readonly Shortfall[] = [
    ...selectionShortfalls(selection, config),
    ...manaBase.shortfalls,
  ];
  const spells = selection.spells.map((pick) => pick.card);

  return {
    deck: [...spells, ...manaBase.lands],
    spells,
    lands: manaBase.lands,
    colorPair: best.pair,
    colorPairs,
    poolColors: countPlayablesByColor(pool),
    curve: curveReport(config.targetCurve, selection.achievedCurve),
    creatureCount: selection.creatureCount,
    removalCount: selection.spells.filter((pick) => pick.isRemoval).length,
    manaBase,
    picks: selection.spells,
    sideboard: selection.leftovers,
    shortfalls,
    complete: isComplete(shortfalls),
    config,
  };
}

/** Colors the finished deck actually casts spells in, WUBRG-ordered. */
export function deckColors(result: DeckBuildResult): readonly Color[] {
  return result.manaBase.reports.filter((report) => report.pipCount > 0).map((report) => report.color);
}
