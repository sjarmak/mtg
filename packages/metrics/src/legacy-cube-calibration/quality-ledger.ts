/** Freeze simulated review scope before seeing judgments; consumed seeds survive interrupted runs. */
import { createHash } from 'node:crypto';
import { mkdir, readdir, rmdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { LEGACY_CUBE_ADVISOR_MODEL, parseAdvisorWeights } from '@mtg/draft-export';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { calibrationSeed, DRAFT_BOT_VERSION } from './draft';
import { CALIBRATION_BUILDER_VERSION } from './deck';
import { advisorModelFingerprint } from './tuning';
import { readCalibrationJson } from './artifact-io';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const unique = (values: readonly unknown[]) => new Set(values).size === values.length;
const requestSchema = z
  .object({
    root: z.string().trim().min(1).max(256),
    split: z.enum(['tuning', 'holdout']),
    indices: z.array(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)).min(1).max(1000).refine(unique),
    policies: z
      .array(
        z
          .string()
          .refine((policy) =>
            [
              'power',
              'current',
              'flexible',
              'pivot',
              ...LEGACY_CUBE_ADVISOR_MODEL.archetypes.map((a) => `pin:${a.id}`),
            ].includes(policy),
          ),
      )
      .min(1)
      .max(32)
      .refine(unique),
    baseline: z.unknown().transform(parseAdvisorWeights),
    candidate: z.unknown().transform(parseAdvisorWeights),
    runtimeSha256: sha,
  })
  .strict();
const digest = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');

function campaignBody(request: z.infer<typeof requestSchema>, catalogSha256: string, modelSha256: string) {
  const sessions = request.indices.map((index) =>
    calibrationSeed(request.root, request.split, 'draft', index),
  );
  return {
    version: 'legacy-cube-quality-campaign/v1',
    request,
    catalogSha256,
    modelSha256,
    draftBotVersion: DRAFT_BOT_VERSION,
    builderVersion: CALIBRATION_BUILDER_VERSION,
    sessions,
    units: request.indices.flatMap((index, position) =>
      request.policies.map((policy) => ({
        index,
        policy,
        session: sessions[position]!,
      })),
    ),
    protocol: {
      independentUnit: 'draft-seed',
      advicePicks: [0, 7, 15, 29, 37, 44],
      criteria: [
        'coherence',
        'castability',
        'pool-alternatives',
        'explanation-accuracy',
        'exploration-usefulness',
      ],
      unchangedSubjectDisagreement: 'reviewer-inconsistency',
      uncertainVerdict: 'unresolved',
    },
    limitations: ['model-review-not-independent-human-evidence', 'reservation-is-not-adoption-approval'],
  };
}

/** Pure pre-registration: no drafts are generated and no model is invoked. */
export function buildQualityCampaign(catalog: PrintedCardCatalog, input: unknown) {
  const request = requestSchema.parse(input);
  const body = campaignBody(request, catalog.contentSha256, advisorModelFingerprint());
  return { ...body, sha256: digest(body) };
}

export function readQualityCampaign(catalog: PrintedCardCatalog, input: unknown, runtime: unknown) {
  const { request } = z.object({ request: requestSchema }).parse(input);
  if (request.runtimeSha256 !== sha.parse(runtime)) throw new Error('Quality campaign runtime mismatch');
  const canonical = buildQualityCampaign(catalog, request);
  if (!isDeepStrictEqual(input, canonical)) throw new Error('Modified or stale quality campaign');
  return canonical;
}

async function assertUnused(root: string, sessions: readonly string[]) {
  const names = (await readdir(root)).filter((name) => name.startsWith('quality-') && name.endsWith('.json'));
  for (const name of names) {
    const input = await readCalibrationJson(join(root, name));
    const fields = z.object({ request: requestSchema, catalogSha256: sha, modelSha256: sha }).parse(input);
    // Historical fingerprints need not equal today's runtime, but their consumed seeds still count.
    const body = campaignBody(fields.request, fields.catalogSha256, fields.modelSha256);
    const canonical = { ...body, sha256: digest(body) };
    if (name !== `quality-${canonical.sha256}.json` || !isDeepStrictEqual(input, canonical))
      throw new Error('Quality reservation digest/content mismatch');
    if (canonical.sessions.some((session) => sessions.includes(session)))
      throw new Error('Quality draft seed already used by a recorded campaign');
  }
}

/** Reserve before exporting any review subjects. A caller must retain this ledger across campaigns. */
export async function reserveQualityCampaign(directory: string, catalog: PrintedCardCatalog, input: unknown) {
  const campaign = buildQualityCampaign(catalog, input);
  const root = resolve(directory);
  const lock = join(root, '.quality-lock');
  await mkdir(root, { recursive: true });
  await mkdir(lock);
  try {
    await assertUnused(root, campaign.sessions);
    const path = join(root, `quality-${campaign.sha256}.json`);
    await writeFile(path, `${JSON.stringify(campaign, null, 2)}\n`, { flag: 'wx' });
    return { campaign, path };
  } finally {
    await rmdir(lock);
  }
}
