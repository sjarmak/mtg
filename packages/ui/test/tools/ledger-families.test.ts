/**
 * The single-file ledger readers in `../../tools/ledger-families.ts`: each
 * turns its metadata file into one record keyed by the join key, and a file
 * that fails its schema into a refusal naming the file and the field.
 */
import { describe, expect, it } from 'vitest';
import { LEGACY_CUBE_FORMAT } from '../../src/routes/legacy-cube/model';
import {
  readCampaignReport,
  readDeckReviewManifest,
  readObservedSweep,
  readQualityCollection,
  subjectFor,
} from '../../tools/ledger-families';
import {
  campaignReport,
  deckReviewManifest,
  observedSweep,
  qualityCollection,
} from './support/ledger-fixtures';

const CONTEXT = { path: 'out/fixture', modified: '2026-09-10T12:00:00.000Z' };

describe('subjectFor', () => {
  it('types the Legacy Cube as a cube and anything else as a format', () => {
    expect(subjectFor(LEGACY_CUBE_FORMAT, null)).toEqual({
      kind: 'cube',
      id: LEGACY_CUBE_FORMAT,
      code: null,
    });
    expect(subjectFor('akh-hou', 'AKH')).toEqual({ kind: 'format', id: 'akh-hou', code: 'AKH' });
  });
});

describe('the Legacy Cube bot calibration report', () => {
  it('is games evidence about the cube, counting decided games as finished', () => {
    const read = readCampaignReport(CONTEXT, campaignReport());
    if (read.kind !== 'records') throw new Error(read.why);
    const [record] = read.records;
    expect(record?.family).toBe('legacy-cube-bot-calibration');
    expect(record?.subject).toEqual({ kind: 'cube', id: LEGACY_CUBE_FORMAT, code: null });
    expect(record?.produced).toBe(CONTEXT.modified);
    expect(record?.matchup).toBe('pin:reanimator, pin:tempo against 3 built opponent deck(s)');
    expect(record?.evidence).toEqual({
      strength: 'games',
      trials: { attempted: 3, completed: 2 },
      arms: null,
      source: 'report',
      episode: null,
      status: 'tuning split, seed campaign-1',
    });
  });

  it('refuses a report of another version by file and field', () => {
    const read = readCampaignReport(CONTEXT, campaignReport({ version: 'legacy-cube-bot-calibration/v2' }));
    expect(read).toEqual({
      kind: 'skip',
      path: 'out/fixture',
      why: expect.stringMatching(/^report\.json .* at `version`$/) as unknown,
    });
  });
});

describe('the printed observed sweep report', () => {
  it('is games evidence about the printed format, carrying its catalog codes and qualification', () => {
    const read = readObservedSweep(CONTEXT, observedSweep());
    if (read.kind !== 'records') throw new Error(read.why);
    const [record] = read.records;
    expect(record?.family).toBe('printed-observed-sweep');
    expect(record?.version).toBe('printed-observed-sweep/1');
    expect(record?.subject).toEqual({ kind: 'format', id: 'akh-hou', code: 'AKH+HOU' });
    expect(record?.matchup).toBe('draft sessions, sampled deck against sampled deck');
    if (record?.evidence.strength !== 'games') throw new Error('expected games evidence');
    expect(record.evidence.trials).toEqual({ attempted: 3, completed: 2 });
    expect(record.evidence.status).toBe('unproven');
  });

  it('refuses a report with no sessions list', () => {
    const read = readObservedSweep(CONTEXT, observedSweep({ sessions: undefined }));
    expect(read.kind).toBe('skip');
    if (read.kind !== 'skip') return;
    expect(read.why).toMatch(/^report\.json .* at `sessions`$/);
  });
});

describe('the Legacy Cube quality collection', () => {
  it('is judgment evidence carrying the gate origin and both booleans', () => {
    const read = readQualityCollection(CONTEXT, qualityCollection());
    if (read.kind !== 'records') throw new Error(read.why);
    const [record] = read.records;
    expect(record?.family).toBe('legacy-cube-quality');
    expect(record?.matchup).toBe('candidate against current advisor, gate retain-baseline');
    expect(record?.evidence).toEqual({
      strength: 'judgment',
      origin: 'model',
      independentHumanEvidence: false,
      adoptionEligible: false,
    });
  });

  it('names the nested file when it refuses', () => {
    const read = readQualityCollection(
      CONTEXT,
      qualityCollection({ quality: { status: 'retain-baseline' } }),
    );
    if (read.kind !== 'skip') throw new Error('expected a refusal');
    expect(read.why).toMatch(/^collected\/report\.json /);
    expect(read.why).toContain('quality.');
  });
});

describe('the Legacy Cube deck review manifest', () => {
  it('is judgment evidence that states neither boolean', () => {
    const read = readDeckReviewManifest(CONTEXT, deckReviewManifest());
    if (read.kind !== 'records') throw new Error(read.why);
    const [record] = read.records;
    expect(record?.family).toBe('legacy-cube-deck-review');
    expect(record?.matchup).toBe('pin:reanimator deck by two-color-package-preserving/v1, tuning split');
    expect(record?.evidence).toEqual({
      strength: 'judgment',
      origin: 'simulation',
      independentHumanEvidence: null,
      adoptionEligible: null,
    });
  });

  it('refuses a manifest that is not an object', () => {
    const read = readDeckReviewManifest(CONTEXT, 'manifest');
    expect(read.kind).toBe('skip');
    if (read.kind === 'skip') expect(read.why).toMatch(/^manifest\.json /);
  });
});
