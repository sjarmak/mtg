/** Matched end-to-end trajectories; canonical tasks bind reviews to actual policy arms. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { parseAdvisorWeights } from '@mtg/draft-export';
import type { AdvisorWeights } from '@mtg/draft-export';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { calibrationSeed, draftCalibrationPool, DRAFT_BOT_VERSION } from './draft';
import type { DraftPolicy } from './draft';
import { buildCalibrationDeck, CALIBRATION_BUILDER_VERSION } from './deck';
import { buildDeckReviewTask } from './deck-review';
import { sampleDraftReviewTasks } from './model-review';
import { buildAdviceReviewTask } from './advice-review';
import { advisorModelFingerprint } from './tuning';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const requestSchema = z
  .object({
    root: z.string().trim().min(1).max(256),
    split: z.enum(['tuning', 'holdout']),
    index: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    policy: z.string().min(1).max(200),
    baseline: z.unknown().transform(parseAdvisorWeights),
    candidate: z.unknown().transform(parseAdvisorWeights),
    runtimeSha256: sha,
  })
  .strict();
const digest = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
type Request = z.infer<typeof requestSchema>;

function buildArm(catalog: PrintedCardCatalog, request: Request, session: string, weights: AdvisorWeights) {
  const draft = draftCalibrationPool(catalog, session, request.policy as DraftPolicy, weights);
  const deck = buildCalibrationDeck(draft.pool, 'Offline review deck');
  const basics = Object.fromEntries(
    ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].map((name) => [
      name,
      deck.ref.cards.find((card) => card.name === name)?.count ?? 0,
    ]),
  );
  const coordinates = { session, split: request.split };
  return {
    deck: buildDeckReviewTask(
      catalog,
      {
        pool: draft.pool.map((card) => card.physicalId),
        selected: deck.selected.map((card) => card.physicalId),
        basics,
      },
      coordinates,
    ),
    advice: sampleDraftReviewTasks(catalog, draft.trace, coordinates).map((task) =>
      buildAdviceReviewTask(catalog, task, weights),
    ),
  };
}

// The build is a pure function of (catalog, request) and costs ~0.15s; export, review, summary,
// comparison and adoption each rebuild every pair to verify it. Entries are JSON text, so a hit
// hands every caller a fresh object and none can corrupt another's copy.
const PAIR_CACHE_LIMIT = 256;
const pairCache = new Map<string, string>();

/** Callers must reserve held-out sessions before export; this pure builder cannot prove non-reuse. */
export function buildQualityReviewPair(catalog: PrintedCardCatalog, input: unknown) {
  const request = requestSchema.parse(input);
  const key = `${catalog.contentSha256}\n${JSON.stringify(request)}`;
  const hit = pairCache.get(key);
  if (hit !== undefined) return JSON.parse(hit) as ReturnType<typeof buildPair>;
  const pair = buildPair(catalog, request);
  if (pairCache.size >= PAIR_CACHE_LIMIT) pairCache.delete(pairCache.keys().next().value!);
  pairCache.set(key, JSON.stringify(pair));
  return pair;
}

function buildPair(catalog: PrintedCardCatalog, request: Request) {
  const session = calibrationSeed(request.root, request.split, 'draft', request.index);
  const baseline = buildArm(catalog, request, session, request.baseline);
  // Identical deterministic inputs need one simulation, but each arm owns its output.
  const candidate = isDeepStrictEqual(request.baseline, request.candidate)
    ? structuredClone(baseline)
    : buildArm(catalog, request, session, request.candidate);
  const body = {
    version: 'legacy-cube-quality-pair/v1',
    origin: 'simulation' as const,
    request,
    session,
    catalogSha256: catalog.contentSha256,
    modelSha256: advisorModelFingerprint(),
    draftBotVersion: DRAFT_BOT_VERSION,
    builderVersion: CALIBRATION_BUILDER_VERSION,
    baseline,
    candidate,
    limitations: [
      'simulated-not-human-draft',
      'matched-seed-not-identical-later-packs',
      'holdout-reservation-not-checked',
      'no-gameplay-evidence',
    ],
  };
  return { ...body, sha256: digest(body) };
}

/** A self-consistent digest alone would admit fabricated pools or swapped arm tasks. */
export function readQualityReviewPair(catalog: PrintedCardCatalog, input: unknown, runtimeInput: unknown) {
  const { request } = z.object({ request: requestSchema }).parse(input);
  if (request.runtimeSha256 !== sha.parse(runtimeInput)) throw new Error('Quality pair runtime mismatch');
  const canonical = buildQualityReviewPair(catalog, request);
  if (!isDeepStrictEqual(input, canonical)) throw new Error('Quality pair differs from canonical simulation');
  return canonical;
}
