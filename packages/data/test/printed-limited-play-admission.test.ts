import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { parsePrintedCardCatalog, parsePrintedLimitedFormat } from '@mtg/printed-card';
import { verifyPrintedLimitedPlayAdmission } from '../src/printed-card/play-admission';

const read = (file: string): unknown =>
  JSON.parse(readFileSync(`packages/data/data/akh-hou/${file}`, 'utf8'));
const format = parsePrintedLimitedFormat(read('akh-hou-limited-format-v1.json'));
const catalogs = ['akh', 'hou', 'mp2'].map((code) =>
  parsePrintedCardCatalog(read(`${code}-printed-catalog-v1.json`)),
);
const runtime = {
  forgeVersion: '2.0.14',
  forgeJarSha256: '1'.repeat(64),
  scriptArchiveSha256: '2'.repeat(64),
  resourcesSha256: '3'.repeat(64),
  bridgeSha256: '4'.repeat(64),
  adapterSha256: '5'.repeat(64),
  protocolVersion: 1,
};
const subject = {
  ...runtime,
  formatId: format.id,
  formatSha256: format.contentSha256,
  catalogs: Object.fromEntries(
    format.sources.map((source: { code: string; catalogSha256: string }) => [
      source.code,
      source.catalogSha256,
    ]),
  ),
};
const artifact = {
  schemaVersion: 1,
  kind: 'printed-play-admission',
  subject,
  cards: catalogs.flatMap((catalog) =>
    catalog.cards.map((card: { physicalId: string }) => ({
      id: card.physicalId,
      review: 'pending',
      decisionFamilies: ['ordinary-cast'],
      probeIds: [],
      note: 'Fixture: no compatibility evidence supplied.',
    })),
  ),
  matchProbeIds: [],
  probes: [],
};

it('derives the complete 550-printing admission population from the checked AKH/HOU/MP2 catalogs', () => {
  const result = verifyPrintedLimitedPlayAdmission(
    JSON.stringify(artifact),
    format,
    catalogs,
    runtime,
    () => {
      throw new Error('unexpected read');
    },
  );
  expect(result.admitted).toBe(false);
  expect(result.reasons.filter((reason) => reason.code === 'unreviewed-card')).toHaveLength(550);
  expect(
    result.reasons.some(
      (reason) =>
        reason.code === 'missing-card' ||
        reason.code === 'foreign-card' ||
        reason.code === 'subject-mismatch',
    ),
  ).toBe(false);
});

it('does not let a small evidence manifest choose its own admission population', () => {
  const reduced = { ...artifact, cards: artifact.cards.slice(0, 1) };
  const result = verifyPrintedLimitedPlayAdmission(
    JSON.stringify(reduced),
    format,
    catalogs,
    runtime,
    () => '',
  );
  expect(result.reasons.filter((reason) => reason.code === 'missing-card')).toHaveLength(549);
});

it('uses the independently supplied runtime rather than copying the manifest claim', () => {
  const result = verifyPrintedLimitedPlayAdmission(
    JSON.stringify(artifact),
    format,
    catalogs,
    { ...runtime, resourcesSha256: '9'.repeat(64) },
    () => '',
  );
  expect(result.reasons).toContainEqual({ code: 'subject-mismatch', subjectField: 'resourcesSha256' });
});

it.each([
  ['missing catalog', catalogs.slice(0, 2)],
  ['extra catalog', [...catalogs, catalogs[0]]],
  [
    'changed claimed catalog checksum',
    catalogs.map((catalog, i) => (i === 0 ? { ...catalog, contentSha256: '0'.repeat(64) } : catalog)),
  ],
  [
    'changed catalog provenance',
    catalogs.map((catalog, i) =>
      i === 0 ? { ...catalog, source: { ...catalog.source, provenanceArtifact: 'changed.json' } } : catalog,
    ),
  ],
  [
    'wrong source identity',
    catalogs.map((catalog, i) => (i === 0 ? { ...catalog, format: 'other-source' } : catalog)),
  ],
  [
    'changed catalog bytes',
    catalogs.map((catalog, i) => (i === 0 ? { ...catalog, cards: catalog.cards.slice(1) } : catalog)),
  ],
])('rejects %s before consulting evidence', (_name, input) => {
  const reader = vi.fn(() => '');
  expect(() =>
    verifyPrintedLimitedPlayAdmission(JSON.stringify(artifact), format, input, runtime, reader),
  ).toThrow();
  expect(reader).not.toHaveBeenCalled();
});

it('rejects a changed recipe that still claims the pinned hash', () => {
  expect(() =>
    verifyPrintedLimitedPlayAdmission(
      JSON.stringify(artifact),
      { ...format, name: 'Changed' },
      catalogs,
      runtime,
      () => '',
    ),
  ).toThrow(/format checksum/i);
});

it('does not depend on catalog input order', () => {
  expect(
    verifyPrintedLimitedPlayAdmission(
      JSON.stringify(artifact),
      format,
      [...catalogs].reverse(),
      runtime,
      () => '',
    ),
  ).toEqual(verifyPrintedLimitedPlayAdmission(JSON.stringify(artifact), format, catalogs, runtime, () => ''));
});

it('requires checked evidence bytes even when every structural claim is complete', () => {
  const controllers = ['local', 'engine'];
  const complete = {
    ...artifact,
    cards: artifact.cards.map((card) => ({
      ...card,
      review: 'reviewed',
      probeIds: controllers.map((controller) => `card-${controller}`),
    })),
    matchProbeIds: controllers.map((controller) => `match-${controller}`),
    probes: controllers.flatMap((controller) => [
      {
        id: `card-${controller}`,
        scope: 'card',
        controller,
        cardIds: artifact.cards.map((card) => card.id),
        decisionFamilies: ['ordinary-cast'],
        status: 'passed',
        assertions: ['Fixture only'],
      },
      {
        id: `match-${controller}`,
        scope: 'match',
        controller,
        cardIds: [],
        decisionFamilies: ['starting-player', 'mulligan', 'priority'],
        status: 'passed',
        assertions: ['Fixture only'],
      },
    ]),
  };
  // Synthetic receipts exercise verification, not actual Forge qualification.
  const receipts = new Map(
    complete.probes.map((result) => [
      `probes/${result.id}.json`,
      JSON.stringify({
        schemaVersion: 1,
        kind: 'printed-play-probe-receipt',
        subject: artifact.subject,
        result,
      }),
    ]),
  );
  const verified = {
    ...complete,
    probes: complete.probes.map((probe) => {
      const path = `probes/${probe.id}.json`;
      const bytes = receipts.get(path)!;
      return { ...probe, evidence: { path, sha256: createHash('sha256').update(bytes).digest('hex') } };
    }),
  };
  expect(
    verifyPrintedLimitedPlayAdmission(JSON.stringify(verified), format, catalogs, runtime, (path) =>
      receipts.get(path)!,
    ),
  ).toEqual({ admitted: true, reasons: [] });
  expect(() =>
    verifyPrintedLimitedPlayAdmission(JSON.stringify(verified), format, catalogs, runtime, () => 'altered'),
  ).toThrow(/evidence checksum mismatch/);
});
