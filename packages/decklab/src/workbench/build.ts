/**
 * One workbench build: stated criteria in, a saved variation out.
 *
 * This is `buildInformedDeck` narrowed to the workbench's one pool and widened
 * by the two things a shelf needs and a report does not — an identity, and a
 * link to the variation this one came from.
 *
 * Nothing here decides anything about the deck. The criteria go to the same
 * pipeline the CLI uses, and every field below is read off what came back. A
 * mapper that computed a number the build did not produce would be a second
 * answer to a question the build already answered.
 */
import { randomUUID } from 'node:crypto';
import type { Card, Color } from '@mtg/dsl';
import { BASIC_LAND_FOR_COLOR, COLORS } from '@mtg/dsl';
import type { LlmProvider } from '@mtg/llm';
import { CASTABILITY_TARGET, HEAVY_CASTABILITY_TARGET } from '../assemble';
import type { BuiltDeck } from '../build';
import { buildInformedDeck } from '../build';
import { enumerateCriteria } from '../criteria';
import { describeUnfilled } from '../report';
import type { PoolSet, SetPool } from '../pool';
import { setDeckPool } from '../pool';
import { statedCriteria } from './pool-check';
import type { Inclusion } from '../verify';
import type { DeckVariation, VariationBasic, VariationEntry, WorkbenchCriteria } from './variation';
import { DECK_VARIATION_VERSION } from './variation';

export interface WorkbenchBuildInput {
  readonly provider: LlmProvider;
  /** Every staged set the criteria named, already read off disk by the caller. */
  readonly sets: readonly PoolSet[];
  readonly criteria: WorkbenchCriteria;
  /** What to call the result on the shelf. */
  readonly name: string;
  /** The variation this was rebuilt from, or `null` for a first build. */
  readonly parentId: string | null;
  /**
   * Dollars of model spend this build may reach.
   *
   * Required rather than defaulted, and required all the way up to the flag a
   * person types. A surface whose button spends money must not be reachable by
   * forgetting something.
   */
  readonly maxSpendUsd: number;
  /** Injected so a test gets a stable id and a stable timestamp. */
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export async function buildVariation(input: WorkbenchBuildInput): Promise<DeckVariation> {
  // The criteria are the workbench's own shape; the build takes the package's.
  // `statedCriteria` is that translation and lives beside the check that runs it
  // on every form edit, because the value of checking early is that it is this
  // same assembly: two spellings would let the form pass a draft this refuses.
  const stated = statedCriteria(input.criteria);

  const pool = setDeckPool(input.sets, stated);
  const built = await buildInformedDeck({
    pool,
    provider: input.provider,
    criteria: stated,
    maxSpendUsd: input.maxSpendUsd,
  });

  return toVariation(built, pool, input);
}

function toVariation(built: BuiltDeck, pool: SetPool, input: WorkbenchBuildInput): DeckVariation {
  const now = (input.now ?? (() => new Date()))();
  const newId = input.newId ?? randomUUID;
  const unfilled = describeUnfilled(built.shortBy, built.stop, built.rejections);

  return {
    version: DECK_VARIATION_VERSION,
    id: newId(),
    name: input.name,
    builtAt: now.toISOString(),
    parentId: input.parentId,
    criteria: input.criteria,
    statedCriteria: enumerateCriteria(built.criteria),
    plan: built.plan,
    spells: built.deck.spells.map(toEntry),
    lands: built.deck.lands.map(toEntry),
    basics: basicsOf(built, pool),
    manaBase: {
      totalLands: built.deck.manaBase.totalLands,
      nonBasicLands: built.deck.manaBase.nonBasicLands,
      castabilityTarget: CASTABILITY_TARGET,
      heavyCastabilityTarget: HEAVY_CASTABILITY_TARGET,
      colors: built.deck.manaBase.reports.map((report) => ({
        color: report.color,
        pipCount: report.pipCount,
        sources: report.sources,
        sourceFloor: report.sourceFloor,
        castability: report.castability,
        meetsTarget: report.meetsTarget,
      })),
      landReason: built.landPlan.reason,
      landSource: built.landPlan.source === 'stated' ? 'stated' : 'model',
    },
    universeSize: built.universeSize,
    // The assembled deck's own shortfalls, plus the one it cannot know: whether
    // the selection loop was still filling the deck when something stopped it.
    // `mtg-yp33.6`. Without this the shelf said "3 cards against a target of 60"
    // and never said the build had reached its spend ceiling after one round,
    // which is the half of the sentence that names what to change. The markdown
    // report has always carried it; this surface was reading past it.
    shortfalls: [...built.deck.shortfalls, ...(unfilled === null ? [] : [unfilled])],
    construction: built.construction,
    // `mtg-yp33.7`. Read off the build rather than recomputed: the meter that
    // knows the spend is the one the loop checked its ceiling against, and a
    // second arithmetic here would be a second answer to a settled question.
    build: {
      rounds: built.rounds,
      spentUsd: built.spend.spentUsd,
      maxSpendUsd: built.spend.maxSpendUsd,
    },
  };
}

function toEntry(inclusion: Inclusion): VariationEntry {
  return {
    // The candidate's `oracleId` is the DSL card's own id over a set pool, which
    // is what `@mtg/ui` reopens a build against. See `../pool.ts`.
    id: inclusion.card.oracleId,
    name: inclusion.card.name,
    count: inclusion.count,
    manaCost: inclusion.card.manaCost,
    manaValue: inclusion.card.manaValue,
    typeLine: inclusion.card.typeLine,
    criteria: inclusion.criteria,
    reason: inclusion.reason,
  };
}

/**
 * The apportioned basics, each carrying the set's own id for that basic.
 *
 * Zero counts are dropped rather than written: five rows where three are zero is
 * a mana base that reads as five colors deep, and the page would draw it.
 */
function basicsOf(built: BuiltDeck, pool: SetPool): readonly VariationBasic[] {
  const byType = new Map<string, Card>(pool.basics.map((card) => [card.name, card]));
  const out: VariationBasic[] = [];
  for (const color of COLORS) {
    const count = built.deck.manaBase.basics[color];
    if (count <= 0) continue;
    const card = byType.get(BASIC_LAND_FOR_COLOR[color as Color]);
    // `setBasics` returns all five by construction, so a miss here is a set whose
    // own printed basic is named something else — worth failing on rather than
    // substituting an id nothing can resolve.
    if (card === undefined) {
      throw new Error(
        `the pool has no ${BASIC_LAND_FOR_COLOR[color as Color]} to apportion ${String(count)} of`,
      );
    }
    out.push({ color, count, id: card.id });
  }
  return out;
}
