/** Canonical review -> fixed regression commands -> reversible, provisional local trial.
 * This route uses no gameplay scores and makes no independent human-validation claim.
 */
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { LEGACY_CUBE_ADVISOR_MODEL, validateAdvisorMetadata } from '@mtg/draft-export';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { readCalibrationJson } from './artifact-io';
import { calibrationSourceFingerprint, writeCalibrationJson } from './io';
import { collectQualityBundle } from './quality-bundle';
import { readQualityCampaign } from './quality-ledger';
import { buildTransferReviewTasks, recordTransferReviewEvidence } from './transfer-review';
import { advisorModelFingerprint } from './tuning';
import { readWeightStore, transitionWeights } from './weight-store';
import { runAdoptionRegressions } from './adoption-regressions';

const path = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes('\0'));
const pathsSchema = z
  .object({
    bundle: path,
    ledger: path,
    receipts: path,
    store: path,
    out: path,
    transferCorpus: path,
    transferReceipts: path,
  })
  .strict();
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Collection = Awaited<ReturnType<typeof collectQualityBundle>>;

function reviewReasons(
  campaign: Collection['campaign'],
  collection: Collection | null,
  active: Awaited<ReturnType<typeof readWeightStore>>,
) {
  const expectedPolicies = [
    'current',
    'flexible',
    'pivot',
    ...LEGACY_CUBE_ADVISOR_MODEL.archetypes.map((a) => `pin:${a.id}`),
  ];
  const provenance = (collection?.reviews ?? []).flatMap((review) =>
    [review.baseline, review.candidate].flatMap((arm) =>
      [arm.deck, ...arm.advice].map((receipt) => receipt.provenance),
    ),
  );
  const reviewers = new Set(
    provenance.map((p) => JSON.stringify([p.provider, p.cliVersion, p.requestedModel, p.resolvedModel])),
  );
  const { revision: _before, ...before } = campaign.request.baseline;
  const { revision: _after, ...after } = campaign.request.candidate;
  return [
    ...(collection?.report.quality.reasons ?? ['missing-quality-review']),
    ...(collection === null || collection.report.quality.status === 'quality-supported'
      ? []
      : ['quality-not-supported']),
    ...(campaign.request.split === 'holdout' ? [] : ['not-held-out']),
    ...(isDeepStrictEqual(active.weights, campaign.request.baseline)
      ? []
      : ['baseline-does-not-match-active-weights']),
    ...(isDeepStrictEqual(before, after) ? ['no-weight-change'] : []),
    ...(expectedPolicies.every((p) => campaign.request.policies.includes(p))
      ? []
      : ['incomplete-exploration-coverage']),
    ...(collection === null ||
    (provenance.length && provenance.every((p) => p.requestedModel !== null) && reviewers.size === 1)
      ? []
      : ['unpinned-or-inconsistent-reviewers']),
  ];
}

async function transferReviews(paths: z.infer<typeof pathsSchema>, catalog: PrintedCardCatalog) {
  const corpus = await readCalibrationJson(paths.transferCorpus);
  const tasks = buildTransferReviewTasks(corpus, catalog);
  let receipts: ReturnType<typeof recordTransferReviewEvidence>[] = [];
  let missing = 0;
  for (const task of tasks) {
    let input: unknown;
    try {
      input = await readCalibrationJson(join(paths.transferReceipts, `${task.sha256}.json`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      missing += 1;
      continue;
    }
    const fields = z
      .object({ task: z.unknown(), judgment: z.unknown(), provenance: z.unknown() })
      .parse(input);
    const receipt = recordTransferReviewEvidence(
      catalog,
      corpus,
      fields.task,
      fields.judgment,
      fields.provenance,
    );
    if (receipt.task.sha256 !== task.sha256 || !isDeepStrictEqual(input, receipt))
      throw new Error('Modified or misplaced transfer review receipt');
    receipts = [...receipts, receipt];
  }
  return {
    role: 'context-only-not-held-out-validation' as const,
    sourceSplits: [...new Set(tasks.map((task) => task.coordinates.split))].sort(),
    corpusSha256: digest(corpus),
    receipts: receipts.map((r) => r.sha256),
    reasons: [
      ...(tasks.length ? [] : ['no-adjacent-human-context']),
      ...(missing ? ['missing-transfer-review'] : []),
    ],
  };
}

async function collectOrMissing(
  paths: z.infer<typeof pathsSchema>,
  out: string,
  catalog: PrintedCardCatalog,
  runtime: string,
) {
  try {
    return await collectQualityBundle(
      { bundle: paths.bundle, ledger: paths.ledger, receipts: paths.receipts, out: join(out, 'quality') },
      catalog,
      runtime,
    );
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    // Only an absent receipt is missing evidence. A damaged bundle, absent reservation,
    // permissions failure, or failed output publication must remain an operational error.
    if (
      failure.code === 'ENOENT' &&
      typeof failure.path === 'string' &&
      dirname(resolve(failure.path)) === resolve(paths.receipts)
    )
      return null;
    throw error;
  }
}

/** No input can assert approval, supply commands, or smuggle match outcomes into this decision. */
export async function adoptQualityCalibration(input: unknown, catalogInput: PrintedCardCatalog) {
  const paths = pathsSchema.parse(input);
  const catalog = structuredClone(catalogInput);
  const runtime = await calibrationSourceFingerprint();
  const identity = { catalogSha256: catalog.contentSha256, modelSha256: advisorModelFingerprint() };
  const previous = await readWeightStore(paths.store, identity);
  if (previous.transitionPending) throw new Error('Weight transition pending; inspect it before adoption');
  const out = resolve(paths.out);
  await mkdir(out);
  const campaign = readQualityCampaign(
    catalog,
    await readCalibrationJson(join(paths.bundle, 'campaign.json')),
    runtime,
  );
  const collection = await collectOrMissing(paths, out, catalog, runtime);
  if (collection !== null && !isDeepStrictEqual(campaign, collection.campaign))
    throw new Error('Quality campaign changed during adoption');
  const transfer = await transferReviews(paths, catalog);
  const metadata = validateAdvisorMetadata(catalog);
  const preliminary = [
    ...reviewReasons(campaign, collection, previous),
    ...transfer.reasons,
    ...(metadata.ok ? [] : ['invalid-advisor-metadata']),
  ];
  const regressions = preliminary.length ? null : await runAdoptionRegressions(join(out, 'regressions'));
  const reasons = [
    ...new Set([
      ...preliminary,
      ...(regressions !== null && !regressions.passed ? ['regression-gates-failed'] : []),
      ...((await calibrationSourceFingerprint()) === runtime ? [] : ['runtime-changed-during-review']),
    ]),
  ];
  const body = {
    version: 'legacy-cube-adoption-decision/v1',
    status: reasons.length ? ('retain-baseline' as const) : ('provisional-adopt' as const),
    identity,
    runtimeSha256: runtime,
    previousHead: previous.head,
    baseline: campaign.request.baseline,
    candidate: campaign.request.candidate,
    campaign: campaign.sha256,
    collection: collection?.report.sha256 ?? null,
    quality: collection?.report.quality ?? null,
    transfer,
    metadata,
    regressions,
    reasons,
    independentHumanValidation: false as const,
    gameplayEvidenceUsed: false as const,
    limitations: [
      'model-judgment-not-independent-human-validation',
      'adjacent-human-context-not-exact-pick-labels',
      'model-provenance-operator-asserted',
      'requested-model-pinned-resolved-version-may-be-unreported',
      'not-yet-bot-validated',
      'local-trial-not-proof-of-population-improvement',
    ],
  };
  const decision = { ...body, sha256: digest(body) };
  await writeCalibrationJson(join(out, 'decision.json'), decision);
  const active =
    decision.status === 'provisional-adopt'
      ? await transitionWeights(paths.store, identity, previous.head, {
          kind: 'install',
          weights: decision.candidate,
          decisionSha256: decision.sha256,
        })
      : previous;
  const result = { decision, activeHead: active.head };
  await writeCalibrationJson(join(out, 'result.json'), result);
  return result;
}
