import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { verifyPrintedPlayAdmission } from '../src/printed-card/play-admission';

const sha256 = '1'.repeat(64);
const subject = {
  formatId: 'akh-hou',
  formatSha256: sha256,
  catalogs: { AKH: sha256 },
  forgeVersion: '2.0.14',
  forgeJarSha256: sha256,
  scriptArchiveSha256: sha256,
  resourcesSha256: sha256,
  bridgeSha256: sha256,
  adapterSha256: sha256,
  protocolVersion: 1,
};
const probe = {
  id: 'test-probe',
  scope: 'card',
  controller: 'local',
  cardIds: ['card'],
  decisionFamilies: ['priority'],
  status: 'passed',
  assertions: ['resolves'],
  evidence: { path: 'probes/result.json', sha256 },
};
const { evidence: _reference, ...result } = probe;
const receipt = { schemaVersion: 1, kind: 'printed-play-probe-receipt', subject, result };
const body = JSON.stringify(receipt);
const reference = {
  path: 'probes/result.json',
  sha256: createHash('sha256').update(body).digest('hex'),
};
const evidence = {
  schemaVersion: 1,
  kind: 'printed-play-admission',
  subject,
  cards: [
    {
      id: 'card',
      review: 'pending',
      decisionFamilies: ['priority'],
      probeIds: ['test-probe'],
      note: 'Remaining probes required.',
    },
  ],
  matchProbeIds: [],
  probes: [{ ...probe, evidence: reference }],
};

it('verifies referenced bytes before evaluating compatibility', () => {
  const read = vi.fn(() => body);
  const result = verifyPrintedPlayAdmission(JSON.stringify(evidence), subject, ['card'], read);
  expect(read).toHaveBeenCalledWith('probes/result.json');
  expect(result.admitted).toBe(false);
  expect(result.reasons).toContainEqual({ code: 'unreviewed-card', cardId: 'card' });
});
it.each([
  { ...receipt, subject: { ...subject, bridgeSha256: '2'.repeat(64) } },
  { ...receipt, result: { ...result, id: 'another-probe' } },
  { ...receipt, result: { ...result, scope: 'match' } },
  { ...receipt, result: { ...result, controller: 'engine' } },
  { ...receipt, result: { ...result, cardIds: ['another-card'] } },
  { ...receipt, result: { ...result, decisionFamilies: ['cycling'] } },
  { ...receipt, result: { ...result, status: 'failed' } },
  { ...receipt, result: { ...result, assertions: ['different assertion'] } },
  { assertionsPassed: true },
])('rejects hashed evidence that does not substantiate its manifest claim %#', (input) => {
  const bytes = JSON.stringify(input);
  const relabeled = {
    ...evidence,
    probes: [
      { ...probe, evidence: { ...reference, sha256: createHash('sha256').update(bytes).digest('hex') } },
    ],
  };
  expect(() => verifyPrintedPlayAdmission(JSON.stringify(relabeled), subject, ['card'], () => bytes)).toThrow(
    /evidence receipt/,
  );
});
it('accepts byte-array receipts and ignores object property order', () => {
  const bytes = Buffer.from(JSON.stringify({ result, subject, kind: receipt.kind, schemaVersion: 1 }));
  const artifact = {
    ...evidence,
    probes: [
      { ...probe, evidence: { ...reference, sha256: createHash('sha256').update(bytes).digest('hex') } },
    ],
  };
  expect(verifyPrintedPlayAdmission(JSON.stringify(artifact), subject, ['card'], () => bytes).admitted).toBe(
    false,
  );
});
it('rejects altered and missing evidence instead of trusting a passed label', () => {
  expect(() =>
    verifyPrintedPlayAdmission(JSON.stringify(evidence), subject, ['card'], () => 'altered'),
  ).toThrow(/evidence checksum mismatch/);
  expect(() =>
    verifyPrintedPlayAdmission(JSON.stringify(evidence), subject, ['card'], () => {
      throw new Error('missing evidence');
    }),
  ).toThrow(/missing evidence/);
});
it.each([
  '/etc/passwd',
  '../result.json',
  'probes/../../result.json',
  'https://example.com/result',
  'probes\\result.json',
])('rejects unsafe artifact path %s before IO', (path) => {
  const read = vi.fn(() => body);
  expect(() =>
    verifyPrintedPlayAdmission(
      JSON.stringify({ ...evidence, probes: [{ ...probe, evidence: { path, sha256 } }] }),
      subject,
      ['card'],
      read,
    ),
  ).toThrow();
  expect(read).not.toHaveBeenCalled();
});
it('does not read evidence for probes not yet run', () => {
  const read = vi.fn(() => body);
  expect(
    verifyPrintedPlayAdmission(
      JSON.stringify({ ...evidence, probes: [{ ...probe, status: 'not-run', evidence: null }] }),
      subject,
      ['card'],
      read,
    ).admitted,
  ).toBe(false);
  expect(read).not.toHaveBeenCalled();
});
