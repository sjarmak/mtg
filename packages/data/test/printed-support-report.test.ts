/** Real printing population, synthetic script/receipt bytes: infrastructure evidence only. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  parsePrintedCardCatalog,
  parsePrintedLimitedFormat,
  serializedPrintedCardCatalogContent,
  serializedPrintedLimitedFormatContent,
} from '@mtg/printed-card';
import { buildPrintedFormatSupportReport } from '../src/printed-card/support-report';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const data = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../data/akh-hou/${name}.json`, import.meta.url), 'utf8'));
const script = 'Name:Example\nK:Cycling:2\n';
const catalogs = ['akh', 'hou', 'mp2'].map((code) => {
  const catalog = parsePrintedCardCatalog(data(`${code}-printed-catalog-v1`));
  const changed = {
    ...catalog,
    cards: catalog.cards.map((card) => ({ ...card, forgeScriptSha256: hash(script) })),
  };
  return { ...changed, contentSha256: hash(serializedPrintedCardCatalogContent(changed)) };
});
const original = parsePrintedLimitedFormat(data('akh-hou-limited-format-v1'));
const changed = {
  ...original,
  sources: original.sources.map((source) => ({
    ...source,
    catalogSha256: catalogs.find((catalog) => catalog.format === source.catalogFormat)!.contentSha256,
  })),
};
const format = { ...changed, contentSha256: hash(serializedPrintedLimitedFormatContent(changed)) };
const runtime = {
  forgeVersion: '2.0.14',
  forgeJarSha256: 'a'.repeat(64),
  scriptArchiveSha256: 'b'.repeat(64),
  resourcesSha256: 'c'.repeat(64),
  bridgeSha256: 'd'.repeat(64),
  adapterSha256: 'e'.repeat(64),
  protocolVersion: 1,
};
const subject = {
  ...runtime,
  formatId: format.id,
  formatSha256: format.contentSha256,
  catalogs: Object.fromEntries(format.sources.map((source) => [source.code, source.catalogSha256])),
};
const id = catalogs[0]!.cards[0]!.physicalId;
const result = {
  id: 'local',
  scope: 'card',
  controller: 'local',
  cardIds: [id],
  decisionFamilies: ['one-measured-branch'],
  status: 'passed',
  assertions: ['Exact public state change.'],
};
const receipt = JSON.stringify({ schemaVersion: 1, kind: 'printed-play-probe-receipt', subject, result });
const artifact = {
  schemaVersion: 1,
  kind: 'printed-play-admission',
  subject,
  cards: [
    {
      id,
      review: 'pending',
      decisionFamilies: ['one-measured-branch'],
      probeIds: ['local'],
      note: 'Partial evidence only.',
    },
  ],
  matchProbeIds: [],
  probes: [{ ...result, evidence: { path: 'receipts/local.json', sha256: hash(receipt) } }],
};
const options = () => ({
  admission: JSON.stringify(artifact),
  format,
  catalogs,
  measuredRuntime: runtime,
  readEvidence: vi.fn(() => receipt),
  readScript: vi.fn(() => script),
});

describe('format support report joins checked inventory and receipt claims', () => {
  it('keeps the verified admission snapshot when an IO callback changes caller-owned inputs', () => {
    const input = options();
    input.readEvidence.mockImplementation(() => {
      input.admission = JSON.stringify({
        ...artifact,
        cards: [{ ...artifact.cards[0], review: 'reviewed' }],
      });
      return receipt;
    });
    expect(buildPrintedFormatSupportReport(input).cards[0]?.review).toBe('pending');
  });
  it('accounts for all 550 actual printing IDs without promoting script hints to support', () => {
    const input = options();
    const report = buildPrintedFormatSupportReport(input);
    expect(report.cards.map((card) => card.physicalId)).toEqual(
      catalogs.flatMap((catalog) => catalog.cards.map((card) => card.physicalId)).sort(),
    );
    expect(report.cards).toHaveLength(550);
    expect(report.cards[0]).toMatchObject({
      physicalId: id,
      review: 'pending',
      declaredFamilies: ['one-measured-branch'],
      claimedPassedFamilies: { local: ['one-measured-branch'], engine: [] },
      script: { path: catalogs[0]!.cards[0]!.forgeScript, sha256: hash(script), keywords: ['Cycling'] },
    });
    expect(report.cards.filter((card) => card.review === 'missing')).toHaveLength(549);
    expect(report.cards[1]?.declaredFamilies).toEqual([]);
    expect(report.admitted).toBe(false);
    expect(report.evidenceVerification).toBe('verified');
    expect(input.readEvidence).toHaveBeenCalledTimes(1);
    expect(buildPrintedFormatSupportReport({ ...options(), catalogs: [...catalogs].reverse() })).toEqual(
      report,
    );
  });

  it('rejects changed runtime, recipe, catalog and script evidence', () => {
    expect(() =>
      buildPrintedFormatSupportReport({ ...options(), measuredRuntime: { ...runtime, protocolVersion: 2 } }),
    ).toThrow('subject-mismatch');
    expect(() =>
      buildPrintedFormatSupportReport({ ...options(), format: { ...format, name: 'Changed' } }),
    ).toThrow('format checksum');
    expect(() => buildPrintedFormatSupportReport({ ...options(), catalogs: catalogs.slice(1) })).toThrow(
      'exactly',
    );
    expect(() => buildPrintedFormatSupportReport({ ...options(), readScript: () => 'changed' })).toThrow(
      'script checksum',
    );
    expect(() => buildPrintedFormatSupportReport({ ...options(), readEvidence: () => '{}' })).toThrow(
      'checksum mismatch',
    );
  });

  it('refuses a stale recipe before reading any script', () => {
    const input = options();
    expect(() =>
      buildPrintedFormatSupportReport({ ...input, format: { ...format, name: 'Changed' } }),
    ).toThrow();
    expect(input.readScript).not.toHaveBeenCalled();
    expect(input.readEvidence).not.toHaveBeenCalled();
  });
});
