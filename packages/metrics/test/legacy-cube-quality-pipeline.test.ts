/** Full software wiring with synthetic reviewers; these judgments are not calibration evidence. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_ADVISOR_WEIGHTS } from '@mtg/draft-export';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import corpus from '../data/legacy-cube-transfer-decks-v1.json';
import { main } from '../tools/legacy-cube-quality';
import { calibrationSourceFingerprint } from '../src/legacy-cube-calibration/io';
import { runQualityReviews } from '../src/legacy-cube-calibration/quality-run';
import type { QualityReviewer } from '../src/legacy-cube-calibration/quality-run';
import { runTransferReviews } from '../src/legacy-cube-calibration/transfer-run';

function syntheticReviewer(runtime: string, transfer = false): QualityReviewer {
  return {
    model: 'synthetic-pipeline-reviewer',
    async review({ prompt, taskSha256 }) {
      const deck = prompt.includes('"selected"');
      const criteria = deck
        ? ['coherence', 'castability', 'pool-alternatives']
        : ['explanation-accuracy', 'exploration-usefulness'];
      return {
        response: transfer
          ? {
              taskSha256,
              lessons: [
                {
                  claim: 'Synthetic software fixture only.',
                  applicability: 'uncertain',
                  sourceCards: [],
                  cubeCards: [],
                  rationale: 'No strategic evidence.',
                  conditions: [],
                },
              ],
              environmentDifferences: ['Different source list.'],
              uncertainty: ['Synthetic review.'],
            }
          : {
              taskSha256,
              criteria: criteria.map((criterion) => ({
                criterion,
                assessment: 'uncertain',
                rationale: 'Synthetic software fixture only.',
                cards: [],
                ...(deck ? { improvements: [] } : { claims: [], archetypes: [], corrections: [] }),
              })),
              uncertainty: ['Synthetic review.'],
            },
        provenance: {
          provider: 'codex-cli',
          authentication: 'chatgpt-oauth',
          cliVersion: 'synthetic',
          requestedModel: 'synthetic-pipeline-reviewer',
          resolvedModel: null,
          runId: taskSha256,
          completedAt: '2026-09-11T04:00:00Z',
          generatorRuntimeSha256: runtime,
        },
      };
    },
  };
}

// Two complete seeds across all 20 policies: this is a filesystem/simulation integration test.
// The stages run in order over one directory; each is its own test so it gets its own time budget
// rather than the whole flow sharing one, and a failure names the stage that broke.
describe('quality pipeline: propose, review, adopt', () => {
  const corpusPath = 'packages/metrics/data/legacy-cube-transfer-decks-v1.json';
  const catalog = parsePrintedCardCatalog(catalogJson);
  const read = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
  let root: string;
  let runtime: string;
  let output: MockInstance<typeof process.stdout.write>;
  let store: string;
  let proposal: string;
  let bundle: string;
  let ledger: string;
  let out: string;
  let proposed: Awaited<ReturnType<typeof read>>;
  let reviewed: Awaited<ReturnType<typeof runQualityReviews>>;
  let transferred: Awaited<ReturnType<typeof runTransferReviews>>;
  // One reviewer across stages, so the call count can be compared with the reviewed count.
  let reviewer: QualityReviewer;
  let qualityCalls: MockInstance<QualityReviewer['review']>;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'mtg-quality-pipeline-'));
    output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    runtime = await calibrationSourceFingerprint();
    store = join(root, 'store');
    proposal = join(root, 'proposal');
    bundle = join(root, 'bundle');
    ledger = join(root, 'ledger');
    out = join(root, 'decision');
    reviewer = syntheticReviewer(runtime);
    qualityCalls = vi.spyOn(reviewer, 'review');
  });

  afterAll(async () => {
    output.mockRestore();
    await rm(root, { recursive: true, force: true });
  });

  it('proposes a campaign and exports its bundle', async () => {
    await main([
      'propose',
      '--corpus',
      corpusPath,
      '--store',
      store,
      '--root',
      'synthetic-full-quality-pipeline',
      '--indices',
      '0,1',
      '--out',
      proposal,
    ]);
    proposed = await read(join(proposal, 'proposal.json'));
    expect(proposed.status).toBe('insufficient-evidence');
    expect(proposed.campaign.request.policies).toHaveLength(20);
    await main(['export', '--request', join(proposal, 'request.json'), '--ledger', ledger, '--out', bundle]);
    expect(await read(join(bundle, 'campaign.json'))).toEqual(proposed.campaign);
  }, 60000);

  it('reviews every exported task and the transfer sample', async () => {
    reviewed = await runQualityReviews({ bundle, ledger, maxCalls: 280 }, catalog, runtime, reviewer);
    expect(reviewed.modelCalls).toBeGreaterThan(0);
    expect(qualityCalls).toHaveBeenCalledTimes(reviewed.modelCalls);
    transferred = await runTransferReviews(
      { ledger, split: 'tuning', maxCalls: 1 },
      corpus,
      catalog,
      runtime,
      syntheticReviewer(runtime, true),
    );
  }, 60000);

  it('adopts without installing uncertain weights', async () => {
    await main([
      'adopt',
      '--bundle',
      bundle,
      '--ledger',
      ledger,
      '--receipts',
      reviewed.receipts,
      '--transfer-corpus',
      corpusPath,
      '--transfer-receipts',
      transferred.receipts,
      '--store',
      store,
      '--out',
      out,
    ]);
    const decision = await read(join(out, 'decision.json'));
    expect(decision).toMatchObject({
      status: 'retain-baseline',
      campaign: proposed.campaign.sha256,
      baseline: DEFAULT_ADVISOR_WEIGHTS,
      independentHumanValidation: false,
      gameplayEvidenceUsed: false,
      regressions: null,
    });
    expect(decision.reasons).toContain('unresolved-quality-judgments');
    expect(decision.reasons).not.toContain('missing-quality-review');
    expect(decision.reasons).not.toContain('missing-transfer-review');
    expect(decision.reasons).not.toContain('incomplete-exploration-coverage');
    expect(decision.transfer.role).toBe('context-only-not-held-out-validation');
    const report = await read(join(out, 'quality', 'report.json'));
    expect(report.reservationVerified).toBe(true);
    expect(report.summary.independentSessions).toBe(2);
    expect(decision.collection).toBe(report.sha256);
    expect((await read(join(out, 'result.json'))).activeHead).toBeNull();
    await expect(readdir(store)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 90000);

  it('resumes a finished review run without another model call', async () => {
    const before = qualityCalls.mock.calls.length;
    const resumed = await runQualityReviews({ bundle, ledger, maxCalls: 0 }, catalog, runtime, reviewer);
    expect(resumed.modelCalls).toBe(0);
    expect(qualityCalls).toHaveBeenCalledTimes(before);
  }, 60000);
});
