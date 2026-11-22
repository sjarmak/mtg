import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { preparePrintedLimitedFormat, printedSourceFingerprint } from '@mtg/draft-export';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import { printedLimitedSubjectIdentity } from '../../tools/printed-limited-construction-campaign';
import {
  buildPrintedDirectDraftPlan,
  runPrintedLimitedDirectDraftCampaign,
  writePrintedDirectDraftArtifacts,
} from '../../tools/printed-limited-direct-draft-campaign';
import { printedLimitedDraftPolicies } from '../../tools/printed-limited-draft-campaign';
import {
  PrintedDraftRatingsSchema,
  printedDraftRatingsFingerprintInput,
  type PrintedDraftRatings,
} from '../../src/lab/printed-draft-ratings';

const A = 'a'.repeat(64);
const runtime = { kind: 'native' as const, version: 'direct-draft/test', buildSha256: A };
let prepared: Awaited<ReturnType<typeof preparePrintedLimitedFormat>>;
let catalog: ReturnType<typeof parsePrintedCardCatalog>;
let ratings: PrintedDraftRatings;

beforeAll(async () => {
  const read = (file: string): unknown => JSON.parse(readFileSync(`packages/data/data/isd/${file}`, 'utf8'));
  catalog = parsePrintedCardCatalog(read('isd-printed-catalog-v1.json'));
  const full = await preparePrintedLimitedFormat(
    read('isd-limited-format-v1.json'),
    [catalog],
    async (text) => createHash('sha256').update(text).digest('hex'),
  );
  const openDraftPacks = full.openDraftPacks.bind(full);
  prepared = {
    ...full,
    format: {
      ...full.format,
      draft: { ...full.format.draft, seats: 2, rounds: full.format.draft.rounds.slice(0, 2) },
    },
    openDraftPacks: (seed) =>
      openDraftPacks(seed).filter(
        (pack) => pack.round <= 2 && (pack.openedBy === 'seat-1' || pack.openedBy === 'seat-2'),
      ),
  };
  const ratedCatalogs = [
    {
      code: 'ISD',
      catalogSha256: catalog.contentSha256,
      cards: catalog.cards.map((card, index) => ({
        physicalId: card.physicalId,
        sourceFingerprint: printedSourceFingerprint(card),
        quality: index % 17 === 0 ? 5 : index % 7 === 0 ? 4 : 2,
      })),
    },
  ];
  const source = { version: 'test', bridgeFingerprint: A };
  ratings = PrintedDraftRatingsSchema.parse({
    schemaVersion: 1,
    kind: 'printed-draft-ratings',
    source: {
      kind: 'forge-limited-rankings',
      ...source,
      fingerprint: createHash('sha256')
        .update(printedDraftRatingsFingerprintInput(source, ratedCatalogs))
        .digest('hex'),
    },
    catalogs: ratedCatalogs,
  });
});

function plan() {
  return buildPrintedDirectDraftPlan({
    id: 'isd-direct-draft-test-v1',
    split: 'holdout',
    runtime,
    subject: printedLimitedSubjectIdentity(prepared),
    policies: printedLimitedDraftPolicies(ratings),
    seeds: ['pod-a', 'pod-b'],
    topTierQuality: 4,
    minimumIndependentUnits: 2,
    smallestUsefulEffect: 0.01,
    regressionMargin: 0.1,
  });
}

it('compares frozen identical pods with compact first-pick and later-pick evidence', async () => {
  const result = await runPrintedLimitedDirectDraftCampaign({
    plan: plan(),
    runtime,
    subjects: new Map([['isd', { prepared, catalogs: [{ code: 'ISD', catalog }], ratings }]]),
  });

  expect(result.claim).toBe('draft-pick-quality');
  expect(result.gameplayEvidence).toBe(false);
  expect(result.offerPairing).toEqual({
    initialPacks: 'identical',
    laterDecisions: 'arm-specific-after-prior-picks',
  });
  expect(result.estimands).toEqual({
    firstPickQuality: 'identical-offer-direct-choice',
    laterFullPodQuality: 'full-pod-policy-ecology',
  });
  expect(result.metricProvenance).toEqual({
    qualityDataSha256: ratings.source.fingerprint,
    deckAwareReferencePolicyId: result.plan.policies.candidate.policyId,
    deckAwareUse: 'policy-alignment-diagnostic',
  });
  expect(result.comparison).not.toHaveProperty('laterPickDeckAware');
  expect(result.comparison).not.toHaveProperty('laterPickQuality');
  expect(result.comparison).toHaveProperty('laterFullPodQuality');
  expect(result.units).toHaveLength(2);
  expect(
    result.units.every(
      (unit) => unit.arms.baseline.initialPacksSha256 === unit.arms.candidate.initialPacksSha256,
    ),
  ).toBe(true);
  expect(result.summary.baseline.firstPicks.decisions).toBe(4);
  expect(result.summary.baseline.laterPicks.decisions).toBeGreaterThan(0);
  expect(result.summary.candidate.laterByPoolMaturity.map((row) => row.id)).toEqual([
    'early',
    'middle',
    'late',
  ]);
  expect(result.units[0]!.arms.candidate.picks[0]).toMatchObject({
    poolSize: 0,
    quality: { regret: 0 },
    topTier: { offered: expect.any(Boolean), captured: expect.any(Boolean) },
  });
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain('oracleText');
  expect(serialized).not.toContain('payload');
  expect(serialized.length).toBeLessThan(500_000);
});

it('rejects source and policy drift before opening the holdout', async () => {
  const sourceDrift = {
    ...prepared,
    format: { ...prepared.format, contentSha256: 'b'.repeat(64) },
  };
  await expect(
    runPrintedLimitedDirectDraftCampaign({
      plan: plan(),
      runtime,
      subjects: new Map([['isd', { prepared: sourceDrift, catalogs: [{ code: 'ISD', catalog }], ratings }]]),
    }),
  ).rejects.toThrow(/subject.*differs/u);

  const policyDrift = structuredClone(plan());
  policyDrift.policies.candidate.policyId = 'stale-policy';
  await expect(
    runPrintedLimitedDirectDraftCampaign({
      plan: policyDrift,
      runtime,
      subjects: new Map([['isd', { prepared, catalogs: [{ code: 'ISD', catalog }], ratings }]]),
    }),
  ).rejects.toThrow(/policies.*differ/u);
});

it('persists one collision-safe compact artifact', async () => {
  const output = mkdtempSync(join(tmpdir(), 'mtg-direct-draft-'));
  try {
    const result = await runPrintedLimitedDirectDraftCampaign({
      plan: plan(),
      runtime,
      subjects: new Map([['isd', { prepared, catalogs: [{ code: 'ISD', catalog }], ratings }]]),
    });
    const path = writePrintedDirectDraftArtifacts(output, result);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(result);
    expect(() => writePrintedDirectDraftArtifacts(output, result)).toThrow(/exists/u);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

it('refuses a subject whose staging left a card unranked', async () => {
  const partialCatalogs = ratings.catalogs.map((entry) => ({
    ...entry,
    cards: entry.cards.map((card, index) => (index === 3 ? { ...card, quality: null } : card)),
  }));
  const source = { version: 'test', bridgeFingerprint: A };
  const partial = PrintedDraftRatingsSchema.parse({
    schemaVersion: 1,
    kind: 'printed-draft-ratings',
    source: {
      kind: 'forge-limited-rankings',
      ...source,
      fingerprint: createHash('sha256')
        .update(printedDraftRatingsFingerprintInput(source, partialCatalogs))
        .digest('hex'),
    },
    catalogs: partialCatalogs,
  });

  await expect(
    runPrintedLimitedDirectDraftCampaign({
      plan: plan(),
      runtime,
      subjects: new Map([['isd', { prepared, catalogs: [{ code: 'ISD', catalog }], ratings: partial }]]),
    }),
  ).rejects.toThrow(/partial ranking \(1 cards unranked/u);
});
