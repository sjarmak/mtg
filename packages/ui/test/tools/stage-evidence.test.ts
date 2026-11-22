/**
 * The writer in `../../tools/stage-evidence.ts` over a real temporary tree:
 * the snapshot lands whole under the public directory the test names, never
 * under `packages/ui/public/`, a run with nothing to say removes the file, a
 * second run reuses the streamed trials, and the flags refuse by name.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readEvidenceSnapshot } from '../../src/routes/analysis/evidence-record';
import { OutPathError } from '../../tools/out-path';
import { REAL_LEDGER_IO, SCAN_BUDGET_BYTES } from '../../tools/scan-ledgers';
import type { LedgerIo } from '../../tools/scan-ledgers';
import {
  clearStagedEvidence,
  describeEvidence,
  EVIDENCE_FILENAME,
  readEvidenceArgs,
  stageEvidence,
} from '../../tools/stage-evidence';
import { gameplayRow, jsonl, stagePlan, trialRow } from './support/ledger-fixtures';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Tree {
  readonly root: string;
  readonly out: string;
  readonly gameplay: string;
  readonly publicDir: string;
}

function tree(): Tree {
  const root = mkdtempSync(join(tmpdir(), 'mtg-stage-evidence-'));
  roots.push(root);
  return {
    root,
    out: join(root, 'out'),
    gameplay: join(root, 'data', 'gameplay'),
    publicDir: join(root, 'public'),
  };
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function populate(paths: Tree): void {
  const campaign = join(paths.out, 'isd-limited-draft-holdout-v10');
  write(join(campaign, 'plan.json'), JSON.stringify(stagePlan()));
  write(
    join(campaign, 'trials.jsonl'),
    jsonl([trialRow({ unitId: 'u1', arm: 'baseline' }), trialRow({ unitId: 'u1', arm: 'candidate' })]),
  );
  write(join(paths.gameplay, 'index.jsonl'), jsonl([gameplayRow()]));
}

const NOW = () => new Date('2026-09-16T12:00:00.000Z');

describe('stageEvidence', () => {
  it('writes a snapshot the browser reader parses, leaving no temporary file behind', async () => {
    const paths = tree();
    populate(paths);
    const staged = await stageEvidence(paths.out, paths.gameplay, paths.publicDir, { now: NOW });
    expect(staged.written).toBe(join(paths.publicDir, EVIDENCE_FILENAME));
    expect(staged).toMatchObject({ records: 2, skipped: 0, truncated: 0, reused: 0 });
    expect(existsSync(`${staged.written ?? ''}.tmp`)).toBe(false);
    const read = readEvidenceSnapshot(JSON.parse(readFileSync(staged.written ?? '', 'utf8')), 'snapshot');
    if (!read.ok) throw new Error(read.message);
    expect(read.snapshot.scannedAt).toBe(NOW().toISOString());
    expect(read.snapshot.records.map((record) => record.family)).toEqual([
      'stage-strength',
      'recorded-games',
    ]);
    expect(read.snapshot.scanned).toHaveLength(1);
  });

  it('reuses the streamed trials on a second run when the file has not changed', async () => {
    const paths = tree();
    populate(paths);
    await stageEvidence(paths.out, paths.gameplay, paths.publicDir, { now: NOW });
    const noTrials: LedgerIo = {
      ...REAL_LEDGER_IO,
      lines(path: string): AsyncIterable<string> {
        if (path.endsWith('trials.jsonl')) throw new Error(`streamed ${path} again`);
        return REAL_LEDGER_IO.lines(path);
      },
    };
    const again = await stageEvidence(paths.out, paths.gameplay, paths.publicDir, { now: NOW }, noTrials);
    expect(again).toMatchObject({ records: 2, skipped: 0, truncated: 0, reused: 1 });
  });

  it('removes a stale snapshot when there is nothing to stage', async () => {
    const paths = tree();
    populate(paths);
    const first = await stageEvidence(paths.out, paths.gameplay, paths.publicDir, { now: NOW });
    rmSync(paths.out, { recursive: true, force: true });
    rmSync(paths.gameplay, { recursive: true, force: true });
    const second = await stageEvidence(paths.out, paths.gameplay, paths.publicDir, { now: NOW });
    expect(second.written).toBeNull();
    expect(existsSync(first.written ?? '')).toBe(false);
  });

  it('records a trials file over the budget rather than reading it', async () => {
    const paths = tree();
    populate(paths);
    const staged = await stageEvidence(paths.out, paths.gameplay, paths.publicDir, {
      now: NOW,
      budgetBytes: 1,
    });
    expect(staged).toMatchObject({ records: 1, skipped: 0, truncated: 1, reused: 0 });
  });

  it('clears a staged file on request and tolerates there being none', () => {
    const paths = tree();
    write(join(paths.publicDir, EVIDENCE_FILENAME), '{}');
    clearStagedEvidence(paths.publicDir);
    clearStagedEvidence(paths.publicDir);
    expect(existsSync(join(paths.publicDir, EVIDENCE_FILENAME))).toBe(false);
  });
});

describe('describeEvidence', () => {
  it('says plainly when nothing was staged, and counts what was', () => {
    expect(describeEvidence({ written: null, records: 0, skipped: 0, truncated: 0, reused: 0 })).toBe(
      'Evidence: no ledger under out/ and no recorded game under data/gameplay/, so the Analysis tab says nothing is staged.',
    );
    expect(
      describeEvidence({
        written: '/p/analysis-evidence.json',
        records: 1,
        skipped: 0,
        truncated: 0,
        reused: 0,
      }),
    ).toBe('Evidence: 1 record staged at /p/analysis-evidence.json.');
    expect(
      describeEvidence({
        written: '/p/analysis-evidence.json',
        records: 9,
        skipped: 2,
        truncated: 1,
        reused: 3,
      }),
    ).toBe(
      'Evidence: 9 records staged at /p/analysis-evidence.json (3 reused from the last scan, 2 not read, 1 over the byte budget).',
    );
  });
});

describe('readEvidenceArgs', () => {
  const repo = '/repo';

  it('defaults to the repository out directory and the scan budget', () => {
    expect(readEvidenceArgs([], repo)).toEqual({
      budgetBytes: SCAN_BUDGET_BYTES,
      outRoot: join(repo, 'out'),
    });
  });

  it('takes a whole number of bytes and refuses anything else', () => {
    expect(readEvidenceArgs(['--budget', '4096'], repo).budgetBytes).toBe(4096);
    expect(() => readEvidenceArgs(['--budget', '4k'], repo)).toThrow(
      '--budget takes a whole number of bytes, not 4k',
    );
    expect(() => readEvidenceArgs(['--budget'], repo)).toThrow('not nothing');
    expect(() => readEvidenceArgs(['--budget', '-1'], repo)).toThrow('whole number');
  });

  it('resolves --out through the same guard every rig uses', () => {
    const paths = tree();
    expect(readEvidenceArgs(['--out', paths.out], repo).outRoot).toBe(paths.out);
    expect(() => readEvidenceArgs(['--out', '/etc'], repo)).toThrow(OutPathError);
    expect(() => readEvidenceArgs(['--out'], repo)).toThrow('--out takes a directory');
  });

  it('refuses an unknown flag by name', () => {
    expect(() => readEvidenceArgs(['--verbose'], repo)).toThrow(
      'unknown flag --verbose; this tool takes --budget <bytes> and --out <dir>',
    );
  });
});
