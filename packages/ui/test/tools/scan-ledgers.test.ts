/**
 * The scanner in `../../tools/scan-ledgers.ts` over a file system in memory:
 * which directories it opens, how each family lands in the snapshot, the byte
 * budget, the fingerprint reuse of a streamed trials file, and every refusal
 * a bad ledger turns into.
 */
import { describe, expect, it } from 'vitest';
import { gameplayIndexLabel, ledgerCandidates, scanLedgers } from '../../tools/scan-ledgers';
import type { LedgerIo } from '../../tools/scan-ledgers';
import type { EvidenceSnapshot } from '../../src/routes/analysis/evidence-record';
import {
  botStrengthComparison,
  botStrengthPlan,
  campaignReport,
  comparison,
  deckReviewManifest,
  decision,
  gameplayRow,
  jsonl,
  memoryIo,
  observedSweep,
  qualityCollection,
  stagePlan,
  trialRow,
} from './support/ledger-fixtures';
import type { MemoryFile } from './support/ledger-fixtures';

const OUT = '/repo/out';
const GAMEPLAY = '/repo/data/gameplay';
const ISD = `${OUT}/isd-limited-draft-holdout-v10`;
const NOW = new Date('2026-09-16T12:00:00.000Z');
const OPTIONS = { budgetBytes: 1024 * 1024, now: () => NOW };

const TRIALS = jsonl([
  trialRow({ unitId: 'u1', arm: 'baseline' }),
  trialRow({ unitId: 'u1', arm: 'candidate' }),
  trialRow({ unitId: 'u2', arm: 'baseline' }),
]);

function text(value: unknown): string {
  return JSON.stringify(value);
}

/** Every family root at once, beside the directories the scan must never open. */
function fullTree(): Record<string, string | MemoryFile> {
  return {
    [`${OUT}/legacy-cube-bot-final-20260910/report.json`]: text(campaignReport()),
    [`${OUT}/legacy-cube-bot-plan-20260910/plan.json`]: text({ planned: true }),
    [`${OUT}/legacy-cube-live-quality-ledger/ledger.jsonl`]: '{}\n',
    [`${OUT}/legacy-cube-live-quality-tuning-v1/collected/report.json`]: text(qualityCollection()),
    [`${OUT}/legacy-cube-stage-tuning-v1/draft/plan.json`]: text(stagePlan()),
    [`${OUT}/legacy-cube-stage-tuning-v1/draft/comparison.json`]: text(comparison()),
    [`${OUT}/legacy-cube-stage-tuning-v1/draft/decision.json`]: text(decision()),
    [`${OUT}/legacy-cube-stage-tuning-v1/notes.md`]: 'not a campaign directory',
    [`${OUT}/bot-strength/general-forge-v1/plan.json`]: text(botStrengthPlan()),
    [`${OUT}/bot-strength/general-forge-v1/comparison.json`]: text(botStrengthComparison()),
    [`${ISD}/plan.json`]: text(stagePlan()),
    [`${ISD}/trials.jsonl`]: TRIALS,
    [`${OUT}/validation-pilot/akh-hou-observed-sweep-1/report.json`]: text(observedSweep()),
    [`${OUT}/legacy-cube-deck-review-pilot-1/manifest.json`]: text(deckReviewManifest()),
    [`${OUT}/art/xmp/art.json`]: '{}',
    [`${OUT}/shots/board.png`]: 'png',
    [`${OUT}/XMP/set.json`]: '{}',
    [`${GAMEPLAY}/index.jsonl`]: jsonl([gameplayRow()]),
  };
}

function scan(
  files: Record<string, string | MemoryFile>,
  previous: EvidenceSnapshot | null = null,
  io: LedgerIo = memoryIo(files),
): Promise<EvidenceSnapshot> {
  return scanLedgers({ outRoot: OUT, gameplayDir: GAMEPLAY }, previous, OPTIONS, io);
}

describe('ledgerCandidates', () => {
  it('names every family root in sorted order and opens nothing else', () => {
    const io = memoryIo(fullTree());
    expect(ledgerCandidates(OUT, io).map((candidate) => `${candidate.reads} ${candidate.rel}`)).toEqual([
      'stage-strength bot-strength/general-forge-v1',
      'stage-strength isd-limited-draft-holdout-v10',
      'campaign-report legacy-cube-bot-final-20260910',
      'campaign-report legacy-cube-bot-plan-20260910',
      'deck-review legacy-cube-deck-review-pilot-1',
      'quality-collection legacy-cube-live-quality-ledger',
      'quality-collection legacy-cube-live-quality-tuning-v1',
      'stage-strength legacy-cube-stage-tuning-v1/draft',
      'observed-sweep validation-pilot/akh-hou-observed-sweep-1',
    ]);
    expect(io.listed).toEqual([
      OUT,
      `${OUT}/bot-strength`,
      `${OUT}/legacy-cube-stage-tuning-v1`,
      `${OUT}/validation-pilot`,
    ]);
  });

  it('is empty when the out root does not exist', () => {
    expect(ledgerCandidates(OUT, memoryIo({}))).toEqual([]);
  });
});

describe('scanLedgers over every family', () => {
  it('lands one record per artifact subject, labeled by its out-relative path', async () => {
    const io = memoryIo(fullTree());
    const snapshot = await scan(fullTree(), null, io);
    expect(snapshot.formatVersion).toBe('mtg-ui/analysis-evidence/1');
    expect(snapshot.scannedAt).toBe(NOW.toISOString());
    expect(snapshot.outRoot).toBe(OUT);
    expect(snapshot.gameplayRoot).toBe(GAMEPLAY);
    expect(snapshot.records.map((record) => `${record.family} ${record.path} ${record.subject.id}`)).toEqual([
      'bot-strength out/bot-strength/general-forge-v1 akh-hou',
      'bot-strength out/bot-strength/general-forge-v1 legacy-cube-2021-08',
      'stage-strength out/isd-limited-draft-holdout-v10 isd',
      'legacy-cube-bot-calibration out/legacy-cube-bot-final-20260910 legacy-cube-2021-08',
      'legacy-cube-deck-review out/legacy-cube-deck-review-pilot-1 legacy-cube-2021-08',
      'legacy-cube-quality out/legacy-cube-live-quality-tuning-v1 legacy-cube-2021-08',
      'stage-strength out/legacy-cube-stage-tuning-v1/draft isd',
      'printed-observed-sweep out/validation-pilot/akh-hou-observed-sweep-1 akh-hou',
      'recorded-games data/gameplay/index.jsonl XMP',
    ]);
    expect(snapshot.skipped).toEqual([
      { path: 'out/legacy-cube-bot-plan-20260910', why: 'has no report.json' },
      { path: 'out/legacy-cube-live-quality-ledger', why: 'has no collected/report.json' },
    ]);
    expect(snapshot.truncated).toEqual([]);
    expect(io.streamed).toEqual([`${ISD}/trials.jsonl`, `${GAMEPLAY}/index.jsonl`]);
  });

  it('streams the trials only where the comparison is absent, and fingerprints that read', async () => {
    const snapshot = await scan(fullTree());
    const streamed = snapshot.records.find((record) => record.path === 'out/isd-limited-draft-holdout-v10');
    if (streamed?.evidence.strength !== 'games') throw new Error('expected games evidence');
    expect(streamed.evidence.source).toBe('trials-stream');
    expect(streamed.evidence.trials).toEqual({ attempted: 3, completed: 1 });
    expect(streamed.evidence.arms).toEqual({
      baseline: { attempted: 2, completed: 2 },
      candidate: { attempted: 1, completed: 1 },
    });
    expect(streamed.evidence.episode?.id).toBe('game-u1-baseline');
    const compared = snapshot.records.find(
      (record) => record.path === 'out/legacy-cube-stage-tuning-v1/draft',
    );
    if (compared?.evidence.strength !== 'games') throw new Error('expected games evidence');
    expect(compared.evidence.source).toBe('comparison');
    expect(compared.evidence.status).toBe('retain-baseline, decided retain-baseline');
    expect(compared.produced).toBe(new Date(1_000).toISOString());
    const planSize = Buffer.byteLength(text(stagePlan()), 'utf8');
    expect(snapshot.scanned).toEqual([
      {
        path: 'out/isd-limited-draft-holdout-v10',
        size: Buffer.byteLength(TRIALS, 'utf8') + planSize,
        mtimeMs: 1_000,
      },
    ]);
  });

  it('is an empty snapshot when neither root exists', async () => {
    const snapshot = await scan({});
    expect(snapshot.records).toEqual([]);
    expect(snapshot.skipped).toEqual([]);
    expect(snapshot.truncated).toEqual([]);
    expect(snapshot.scanned).toEqual([]);
  });
});

describe('the byte budget', () => {
  it('records a trials file over what is left as truncated and reads none of it', async () => {
    const files = { [`${ISD}/plan.json`]: text(stagePlan()), [`${ISD}/trials.jsonl`]: TRIALS };
    const io = memoryIo(files);
    const snapshot = await scanLedgers(
      { outRoot: OUT, gameplayDir: GAMEPLAY },
      null,
      { ...OPTIONS, budgetBytes: 10 },
      io,
    );
    expect(snapshot.truncated).toEqual([
      { path: 'out/isd-limited-draft-holdout-v10', bytes: Buffer.byteLength(TRIALS, 'utf8'), budget: 10 },
    ]);
    expect(snapshot.records).toEqual([]);
    expect(snapshot.skipped).toEqual([]);
    expect(snapshot.scanned).toEqual([]);
    expect(io.streamed).toEqual([]);
  });
});

describe('reusing the previous snapshot', () => {
  it('does not stream a trials file whose size and mtime the last run recorded', async () => {
    const first = await scan(fullTree());
    const io = memoryIo(fullTree());
    const second = await scan(fullTree(), first, io);
    expect(io.streamed).toEqual([`${GAMEPLAY}/index.jsonl`]);
    expect(second.records).toEqual(first.records);
    expect(second.scanned).toEqual(first.scanned);
  });

  it('streams it again when its modification time moved', async () => {
    const first = await scan(fullTree());
    const changed = { ...fullTree(), [`${ISD}/trials.jsonl`]: { text: TRIALS, mtimeMs: 2_000 } };
    const io = memoryIo(changed);
    const second = await scan(changed, first, io);
    expect(io.streamed).toContain(`${ISD}/trials.jsonl`);
    expect(second.scanned[0]?.mtimeMs).toBe(2_000);
  });
});

describe('refusals', () => {
  it('names an unreadable trial row by line, counts the rest, and still lands the record', async () => {
    const rows = `${text(trialRow({ unitId: 'u1', arm: 'baseline' }))}\nnot json\n${text({ unitId: 'u2' })}\n`;
    const snapshot = await scan({ [`${ISD}/plan.json`]: text(stagePlan()), [`${ISD}/trials.jsonl`]: rows });
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.skipped).toEqual([
      {
        path: 'out/isd-limited-draft-holdout-v10/trials.jsonl',
        why: 'line 2 is not JSON; 2 such rows are not counted',
      },
    ]);
  });

  it('names a campaign with a plan and nothing played', async () => {
    const snapshot = await scan({ [`${ISD}/plan.json`]: text(stagePlan()) });
    expect(snapshot.skipped).toEqual([
      {
        path: 'out/isd-limited-draft-holdout-v10',
        why: 'has neither comparison.json nor trials.jsonl, so nothing in it was played',
      },
    ]);
  });

  it('names a metadata file that is not JSON, by file', async () => {
    const snapshot = await scan({
      [`${ISD}/plan.json`]: '{',
      [`${OUT}/legacy-cube-bot-final-20260910/report.json`]: 'nope',
    });
    expect(snapshot.records).toEqual([]);
    expect(snapshot.skipped.map((entry) => `${entry.path}: ${entry.why}`)).toEqual([
      expect.stringMatching(/^out\/isd-limited-draft-holdout-v10: plan\.json is not JSON \(/) as unknown,
      expect.stringMatching(/^out\/legacy-cube-bot-final-20260910: report\.json is not JSON \(/) as unknown,
    ]);
  });

  it('turns an io error mid-stream into a refusal for that file', async () => {
    const files = {
      [`${ISD}/plan.json`]: text(stagePlan()),
      [`${ISD}/trials.jsonl`]: TRIALS,
      [`${GAMEPLAY}/index.jsonl`]: jsonl([gameplayRow()]),
    };
    const inner = memoryIo(files);
    const failing: LedgerIo = {
      ...inner,
      async *lines(path: string): AsyncIterable<string> {
        yield '';
        throw new Error(`disk fell off at ${path}`);
      },
    };
    const snapshot = await scan(files, null, failing);
    expect(snapshot.records).toEqual([]);
    expect(snapshot.skipped).toEqual([
      {
        path: 'out/isd-limited-draft-holdout-v10',
        why: `trials.jsonl could not be read: disk fell off at ${ISD}/trials.jsonl`,
      },
      {
        path: 'data/gameplay/index.jsonl',
        why: `could not be read: disk fell off at ${GAMEPLAY}/index.jsonl`,
      },
    ]);
  });
});

describe('gameplayIndexLabel', () => {
  it('is the last two directories and the file name', () => {
    expect(gameplayIndexLabel('/home/me/repo/data/gameplay')).toBe('data/gameplay/index.jsonl');
  });
});
