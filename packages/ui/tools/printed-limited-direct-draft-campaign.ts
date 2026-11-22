/** Compact direct evidence for printed Limited draft-policy decisions. */
import { isDeepStrictEqual } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import type {
  PhysicalCubeChooseInput,
  PreparedPrintedLimitedFormat,
  PrintedBoosterPayload,
} from '@mtg/draft-export';
import { runPrintedLimitedDraft } from '@mtg/draft-export';
import { comparePairedPromotion, type PairedPromotionResult } from '@mtg/metrics';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { z } from 'zod';
import { createPrintedReplayBot, PRINTED_GENERAL_BOT } from '../src/routes/printed/draft-bot';
import {
  printedDraftQuality,
  printedDraftRatingsPolicy,
  validatePrintedDraftRatings,
  type PrintedDraftRatings,
} from '../src/lab/printed-draft-ratings';
import { printedLimitedSubjectIdentity } from './printed-limited-construction-campaign';
import { printedLimitedDraftPolicies } from './printed-limited-draft-campaign';

const HexSha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const PolicySchema = z.strictObject({
  policyId: z.string().trim().min(1),
  configSha256: HexSha256,
  modelSha256: HexSha256.nullable(),
  dataSha256: HexSha256.nullable(),
});
const RuntimeSchema = z.strictObject({
  kind: z.literal('native'),
  version: z.string().trim().min(1),
  buildSha256: HexSha256,
});
const SubjectSchema = z.strictObject({
  id: z.string().trim().min(1),
  formatSha256: HexSha256,
  cardsSha256: HexSha256,
});

export const PrintedDirectDraftPlanSchema = z
  .strictObject({
    version: z.literal('printed-direct-draft-plan/v1'),
    id: z.string().trim().min(1),
    split: z.enum(['tuning', 'holdout']),
    claim: z.literal('draft-pick-quality'),
    gameplayEvidence: z.literal(false),
    runtime: RuntimeSchema,
    subject: SubjectSchema,
    policies: z.strictObject({ baseline: PolicySchema, candidate: PolicySchema }),
    topTierQuality: z.number().min(0).max(5),
    minimumIndependentUnits: z.number().int().min(2),
    smallestUsefulEffect: z.number().positive().max(1),
    regressionMargin: z.number().min(0).max(1),
    schedule: z.array(
      z.strictObject({
        unitId: z.string().trim().min(1),
        seed: z.string().trim().min(1),
      }),
    ),
  })
  .superRefine((plan, context) => {
    for (const field of ['unitId', 'seed'] as const) {
      const values = plan.schedule.map((row) => row[field]);
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: 'custom', message: `direct draft schedule repeats ${field}` });
      }
    }
    if (plan.schedule.length < plan.minimumIndependentUnits) {
      context.addIssue({ code: 'custom', message: 'direct draft schedule is smaller than its minimum' });
    }
  });
export type PrintedDirectDraftPlan = z.infer<typeof PrintedDirectDraftPlanSchema>;

export interface BuildPrintedDirectDraftPlanOptions {
  readonly id: string;
  readonly split: 'tuning' | 'holdout';
  readonly runtime: PrintedDirectDraftPlan['runtime'];
  readonly subject: PrintedDirectDraftPlan['subject'];
  readonly policies: PrintedDirectDraftPlan['policies'];
  readonly seeds: readonly string[];
  readonly topTierQuality: number;
  readonly minimumIndependentUnits: number;
  readonly smallestUsefulEffect: number;
  readonly regressionMargin: number;
}

export function buildPrintedDirectDraftPlan(
  options: BuildPrintedDirectDraftPlanOptions,
): PrintedDirectDraftPlan {
  return PrintedDirectDraftPlanSchema.parse({
    version: 'printed-direct-draft-plan/v1',
    id: options.id,
    split: options.split,
    claim: 'draft-pick-quality',
    gameplayEvidence: false,
    runtime: options.runtime,
    subject: options.subject,
    policies: options.policies,
    topTierQuality: options.topTierQuality,
    minimumIndependentUnits: options.minimumIndependentUnits,
    smallestUsefulEffect: options.smallestUsefulEffect,
    regressionMargin: options.regressionMargin,
    schedule: options.seeds.map((seed, index) => ({
      unitId: `pod-${String(index).padStart(2, '0')}`,
      seed,
    })),
  });
}

type Arm = 'baseline' | 'candidate';
type ChooseInput = PhysicalCubeChooseInput<PrintedBoosterPayload>;

export interface DirectDraftPick {
  readonly seatId: string;
  readonly round: number;
  readonly pickNumber: number;
  readonly poolSize: number;
  readonly openedBy: string;
  readonly offeredSha256: string;
  readonly chosenPhysicalId: string;
  readonly quality: MetricChoice;
  readonly deckAware: MetricChoice;
  readonly topTier: { readonly offered: boolean; readonly captured: boolean };
}

interface MetricChoice {
  readonly chosen: number;
  readonly best: number;
  readonly regret: number;
  readonly bestPhysicalId: string;
}

export interface DirectDraftArmEvidence {
  readonly policyId: string;
  readonly initialPacksSha256: string;
  readonly picks: readonly DirectDraftPick[];
}

export interface DirectDraftUnit {
  readonly unitId: string;
  readonly seed: string;
  readonly arms: Readonly<Record<Arm, DirectDraftArmEvidence>>;
}

interface MetricSummary {
  readonly decisions: number;
  readonly meanQualityRegret: number | null;
  readonly topTierOffers: number;
  readonly topTierCaptures: number;
  readonly topTierCaptureRate: number | null;
  readonly meanDeckAwareRegret: number | null;
}

interface MaturitySummary extends MetricSummary {
  readonly id: 'early' | 'middle' | 'late';
}

export interface PrintedDirectDraftResult {
  readonly version: 'printed-direct-draft-result/v1';
  readonly claim: 'draft-pick-quality';
  readonly gameplayEvidence: false;
  readonly offerPairing: {
    readonly initialPacks: 'identical';
    readonly laterDecisions: 'arm-specific-after-prior-picks';
  };
  readonly estimands: {
    readonly firstPickQuality: 'identical-offer-direct-choice';
    readonly laterFullPodQuality: 'full-pod-policy-ecology';
  };
  readonly metricProvenance: {
    readonly qualityDataSha256: string | null;
    readonly deckAwareReferencePolicyId: string;
    readonly deckAwareUse: 'policy-alignment-diagnostic';
  };
  readonly plan: PrintedDirectDraftPlan;
  readonly units: readonly DirectDraftUnit[];
  readonly summary: Readonly<
    Record<
      Arm,
      {
        readonly firstPicks: MetricSummary;
        readonly laterPicks: MetricSummary;
        readonly laterByPoolMaturity: readonly MaturitySummary[];
      }
    >
  >;
  readonly comparison: {
    readonly firstPickQuality: PairedPromotionResult;
    readonly laterFullPodQuality: PairedPromotionResult;
  };
}

export interface PrintedDirectDraftSubject {
  readonly prepared: PreparedPrintedLimitedFormat;
  readonly catalogs: readonly { readonly code: string; readonly catalog: PrintedCardCatalog }[];
  readonly ratings: PrintedDraftRatings;
}

export interface PrintedDirectDraftCampaignOptions {
  readonly plan: PrintedDirectDraftPlan;
  readonly runtime: PrintedDirectDraftPlan['runtime'];
  readonly subjects: ReadonlyMap<string, PrintedDirectDraftSubject>;
}

function initialPacksSha256(prepared: PreparedPrintedLimitedFormat, seed: string): string {
  return botEvidenceSha256(
    prepared.openDraftPacks(seed).map((pack) => ({
      round: pack.round,
      openedBy: pack.openedBy,
      cards: pack.cards.map((card) => [card.physicalId, card.payload.printing.physicalId]),
    })),
  );
}

function choiceMetric(
  cards: ChooseInput['cards'],
  values: readonly number[],
  chosenIndex: number,
): MetricChoice {
  const best = Math.max(...values);
  const bestIndex = values.findIndex((value) => value === best);
  const chosen = values[chosenIndex];
  const bestCard = cards[bestIndex];
  if (chosen === undefined || bestCard === undefined) throw new Error('direct draft metric lost a choice');
  return { chosen, best, regret: best - chosen, bestPhysicalId: bestCard.physicalId };
}

function recordedArm(
  subject: PrintedDirectDraftSubject,
  seed: string,
  arm: Arm,
  topTierQuality: number,
): DirectDraftArmEvidence {
  const selected = createPrintedReplayBot(
    arm === 'baseline' ? PRINTED_GENERAL_BOT.botPolicy : printedDraftRatingsPolicy(subject.ratings),
    subject.ratings,
  );
  const reference = createPrintedReplayBot(printedDraftRatingsPolicy(subject.ratings), subject.ratings);
  const picks: DirectDraftPick[] = [];
  const choose = (input: ChooseInput): number => {
    const chosenIndex = selected.choose?.(input) ?? chooseHighest(input, selected.score);
    const qualities = input.cards.map((card) =>
      printedDraftQuality(subject.ratings, card.payload.printing.physicalId),
    );
    const deckValues = input.cards.map((card) => reference.score({ ...input, card }));
    const quality = choiceMetric(input.cards, qualities, chosenIndex);
    const deckAware = choiceMetric(input.cards, deckValues, chosenIndex);
    const offered = quality.best >= topTierQuality;
    picks.push({
      seatId: input.seatId,
      round: input.round,
      pickNumber: input.pickNumber,
      poolSize: input.picked.length,
      openedBy: input.openedBy,
      offeredSha256: botEvidenceSha256(input.cards.map((card) => card.physicalId)),
      chosenPhysicalId: input.cards[chosenIndex]!.physicalId,
      quality,
      deckAware,
      topTier: { offered, captured: offered && quality.chosen >= topTierQuality },
    });
    return chosenIndex;
  };
  const progress = runPrintedLimitedDraft(subject.prepared, {
    seed,
    botPolicy: selected.botPolicy,
    score: selected.score,
    choose,
  });
  if (progress.result === null) throw new Error(`direct draft ${seed}/${arm} did not complete`);
  return {
    policyId: selected.botPolicy,
    initialPacksSha256: initialPacksSha256(subject.prepared, seed),
    picks,
  };
}

function chooseHighest(
  input: ChooseInput,
  score: Parameters<typeof runPrintedLimitedDraft>[1]['score'],
): number {
  const values = input.cards.map((card) => score({ ...input, card }));
  const best = Math.max(...values);
  return values.findIndex((value) => value === best);
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarize(picks: readonly DirectDraftPick[]): MetricSummary {
  const offers = picks.filter((pick) => pick.topTier.offered);
  const captures = offers.filter((pick) => pick.topTier.captured).length;
  return {
    decisions: picks.length,
    meanQualityRegret: mean(picks.map((pick) => pick.quality.regret)),
    topTierOffers: offers.length,
    topTierCaptures: captures,
    topTierCaptureRate: offers.length === 0 ? null : captures / offers.length,
    meanDeckAwareRegret: mean(picks.map((pick) => pick.deckAware.regret)),
  };
}

function maturity(poolSize: number): MaturitySummary['id'] {
  if (poolSize <= 7) return 'early';
  if (poolSize <= 22) return 'middle';
  return 'late';
}

function armSummary(units: readonly DirectDraftUnit[], arm: Arm) {
  const picks = units.flatMap((unit) => unit.arms[arm].picks);
  const later = picks.filter((pick) => pick.poolSize > 0);
  return {
    firstPicks: summarize(picks.filter((pick) => pick.poolSize === 0)),
    laterPicks: summarize(later),
    laterByPoolMaturity: (['early', 'middle', 'late'] as const).map((id) => ({
      id,
      ...summarize(later.filter((pick) => maturity(pick.poolSize) === id)),
    })),
  };
}

function unitMean(unit: DirectDraftUnit, arm: Arm, first: boolean): number {
  const picks = unit.arms[arm].picks.filter((pick) => (pick.poolSize === 0) === first);
  return mean(picks.map((pick) => pick.quality.regret)) ?? 0;
}

function comparison(
  plan: PrintedDirectDraftPlan,
  units: readonly DirectDraftUnit[],
  first: boolean,
): PairedPromotionResult {
  return comparePairedPromotion({
    split: plan.split,
    units: units.map((unit) => ({
      unitId: unit.unitId,
      difference: (unitMean(unit, 'baseline', first) - unitMean(unit, 'candidate', first)) / 5,
      segments: {},
    })),
    segmentDimensions: [],
    minimumIndependentUnits: plan.minimumIndependentUnits,
    smallestUsefulEffect: plan.smallestUsefulEffect,
    regressionMargin: plan.regressionMargin,
    maximumFailureRate: 0,
    completion: { baseline: { rate: 1 }, candidate: { rate: 1 } },
  });
}

async function validated(options: PrintedDirectDraftCampaignOptions) {
  const plan = PrintedDirectDraftPlanSchema.parse(options.plan);
  if (!isDeepStrictEqual(plan.runtime, options.runtime))
    throw new Error('direct draft runtime differs from plan');
  const subject = options.subjects.get(plan.subject.id);
  if (subject === undefined) throw new Error(`direct draft has no subject ${plan.subject.id}`);
  const ratings = await validatePrintedDraftRatings(subject.ratings, subject.prepared, subject.catalogs);
  // Every pick this campaign measures is scored against the Forge rank of each
  // offered card, so a format whose staging left any card unranked has no
  // measurement to make. Say so here, where the whole ratings file is in hand,
  // rather than throwing out of `printedDraftQuality` on whichever pack first
  // opens one -- that is a partial run reported as a crash.
  const unranked = ratings.catalogs.flatMap((catalog) =>
    catalog.cards.filter((card) => card.quality === null).map((card) => card.physicalId),
  );
  if (unranked.length > 0) {
    throw new Error(
      `printed subject ${plan.subject.id} stages a partial ranking (${String(unranked.length)} cards unranked, first ${unranked[0] ?? ''}); a direct draft campaign needs a complete one`,
    );
  }
  if (!isDeepStrictEqual(printedLimitedSubjectIdentity(subject.prepared), plan.subject)) {
    throw new Error(`printed subject ${plan.subject.id} differs from direct draft plan`);
  }
  if (!isDeepStrictEqual(printedLimitedDraftPolicies(ratings), plan.policies)) {
    throw new Error('printed draft policies differ from direct draft plan');
  }
  return { plan, subject };
}

export async function runPrintedLimitedDirectDraftCampaign(
  options: PrintedDirectDraftCampaignOptions,
): Promise<PrintedDirectDraftResult> {
  const { plan, subject } = await validated(options);
  const units = plan.schedule.map((row): DirectDraftUnit => {
    const baseline = recordedArm(subject, row.seed, 'baseline', plan.topTierQuality);
    const candidate = recordedArm(subject, row.seed, 'candidate', plan.topTierQuality);
    if (baseline.initialPacksSha256 !== candidate.initialPacksSha256) {
      throw new Error(`direct draft ${row.unitId} arms did not open identical packs`);
    }
    return { ...row, arms: { baseline, candidate } };
  });
  return {
    version: 'printed-direct-draft-result/v1',
    claim: 'draft-pick-quality',
    gameplayEvidence: false,
    offerPairing: {
      initialPacks: 'identical',
      laterDecisions: 'arm-specific-after-prior-picks',
    },
    estimands: {
      firstPickQuality: 'identical-offer-direct-choice',
      laterFullPodQuality: 'full-pod-policy-ecology',
    },
    metricProvenance: {
      qualityDataSha256: plan.policies.candidate.dataSha256,
      deckAwareReferencePolicyId: plan.policies.candidate.policyId,
      deckAwareUse: 'policy-alignment-diagnostic',
    },
    plan,
    units,
    summary: { baseline: armSummary(units, 'baseline'), candidate: armSummary(units, 'candidate') },
    comparison: {
      firstPickQuality: comparison(plan, units, true),
      laterFullPodQuality: comparison(plan, units, false),
    },
  };
}

export function writePrintedDirectDraftArtifacts(
  outputDirectory: string,
  result: PrintedDirectDraftResult,
): string {
  const directory = resolve(outputDirectory);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'direct-draft-result.json');
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return path;
}
