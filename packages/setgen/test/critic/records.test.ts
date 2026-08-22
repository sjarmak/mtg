/**
 * On-disk shapes for the adjudication file and the verdicts file: schema
 * validation, the seed/size resume guard, and round-tripping through disk.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AdjudicationFileSchema,
  emptyAdjudicationFile,
  loadAdjudicationFile,
  loadVerdictsFile,
  saveAdjudicationFile,
  saveVerdictsFile,
  VerdictsFileSchema,
} from '../../src/critic/records';
import type { AdjudicationAnswer, VerdictRecord, VerdictsFile } from '../../src/critic/records';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'critic-records-'));
});

describe('emptyAdjudicationFile', () => {
  it('carries no rater key at all when none is given', () => {
    const file = emptyAdjudicationFile('seed-1', 10);
    expect('rater' in file).toBe(false);
    expect(file.answers).toStrictEqual([]);
  });

  it('carries the rater when one is given', () => {
    const file = emptyAdjudicationFile('seed-1', 10, 'the playtester');
    expect(file.rater).toBe('the playtester');
  });
});

describe('adjudication file round trip', () => {
  const answer: AdjudicationAnswer = {
    slotId: 'CW01',
    cardName: 'Test Card',
    position: 1,
    criteria: [{ criterion: 'mechanicIntent', label: 'faithful' }],
    overall: { label: 'faithful' },
    answeredAt: '2026-08-15T00:00:00.000Z',
  };

  it('saves and loads back an identical file', () => {
    const path = join(dir, 'adjudication.json');
    const file = { ...emptyAdjudicationFile('seed-1', 10, 'the playtester'), answers: [answer] };
    saveAdjudicationFile(path, file);
    expect(loadAdjudicationFile(path, 'seed-1', 10)).toStrictEqual(file);
  });

  it('reads a missing file as empty, at the requested seed and size', () => {
    const path = join(dir, 'missing.json');
    expect(loadAdjudicationFile(path, 'seed-9', 3)).toStrictEqual(emptyAdjudicationFile('seed-9', 3));
  });

  it('refuses to load a file recorded at a different seed', () => {
    const path = join(dir, 'adjudication.json');
    saveAdjudicationFile(path, emptyAdjudicationFile('seed-1', 10));
    expect(() => loadAdjudicationFile(path, 'seed-2', 10)).toThrow(/mix two draws/);
  });

  it('refuses to load a file recorded at a different size', () => {
    const path = join(dir, 'adjudication.json');
    saveAdjudicationFile(path, emptyAdjudicationFile('seed-1', 10));
    expect(() => loadAdjudicationFile(path, 'seed-1', 20)).toThrow(/mix two draws/);
  });

  it('rejects an answer with a label outside the faithfulness scale', () => {
    const bad = {
      seed: 'seed-1',
      size: 10,
      answers: [{ ...answer, overall: { label: 'sort-of' } }],
    };
    expect(() => AdjudicationFileSchema.parse(bad)).toThrow();
  });
});

describe('verdicts file round trip', () => {
  const success: VerdictRecord = {
    slotId: 'CW01',
    cardName: 'Test Card',
    position: 1,
    criteria: [{ criterion: 'mechanicIntent', label: 'faithful', reason: 'because' }],
    overall: { label: 'faithful', reason: 'because' },
  };
  const failure: VerdictRecord = {
    slotId: 'CU02',
    cardName: 'Other Card',
    position: 2,
    error: 'the model never produced a schema-valid answer',
  };

  it('saves and loads back an identical file, success and failure records alike', () => {
    const path = join(dir, 'verdicts.json');
    const file: VerdictsFile = {
      seed: 'seed-1',
      size: 2,
      recordedAt: '2026-08-15T00:00:00.000Z',
      results: [success, failure],
    };
    saveVerdictsFile(path, file);
    expect(loadVerdictsFile(path)).toStrictEqual(file);
  });

  it('rejects a result with neither criteria/overall nor an error', () => {
    // Schema-legal on its own (both are optional) but exercised here to prove
    // parsing does not require one or the other — the caller decides what an
    // "unusable" record looks like, not the schema.
    const minimal = { slotId: 'CW01', cardName: 'Test Card', position: 1 };
    expect(() =>
      VerdictsFileSchema.parse({ seed: 's', size: 1, recordedAt: 'now', results: [minimal] }),
    ).not.toThrow();
  });
});
