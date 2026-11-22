/** Exercises evidence IO with synthetic receipts, not Magic compatibility. */
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { verifyPrintedSupportReport } from '../src/node/support-report';

const subject = {
  formatId: 'akh-hou',
  formatSha256: 'a'.repeat(64),
  catalogs: { AKH: 'b'.repeat(64) },
  forgeVersion: '2.0.14',
  forgeJarSha256: 'c'.repeat(64),
  scriptArchiveSha256: 'd'.repeat(64),
  resourcesSha256: 'e'.repeat(64),
  bridgeSha256: 'f'.repeat(64),
  adapterSha256: '1'.repeat(64),
  protocolVersion: 1,
};
const result = {
  id: 'cycle',
  scope: 'card',
  controller: 'local',
  cardIds: ['card-a'],
  decisionFamilies: ['cycling'],
  status: 'passed',
  assertions: ['One exact card drawn.'],
};
const receipt = JSON.stringify({ schemaVersion: 1, kind: 'printed-play-probe-receipt', subject, result });
const hash = (body: string) => createHash('sha256').update(body).digest('hex');
const artifact = {
  schemaVersion: 1,
  kind: 'printed-play-admission',
  subject,
  cards: [
    { id: 'card-a', review: 'pending', decisionFamilies: ['cycling'], probeIds: ['cycle'], note: 'Partial.' },
  ],
  matchProbeIds: [],
  probes: [{ ...result, evidence: { path: 'receipts/cycle.json', sha256: hash(receipt) } }],
};

describe('verified printed support report', () => {
  it('verifies receipt bytes but still refuses incomplete card and match support', () => {
    const read = vi.fn(() => receipt);
    const report = verifyPrintedSupportReport(JSON.stringify(artifact), subject, ['card-a', 'card-b'], read);
    expect(read).toHaveBeenCalledExactlyOnceWith('receipts/cycle.json');
    expect(report.evidenceVerification).toBe('verified');
    expect(report.admitted).toBe(false);
    expect(report.cards[0]?.claimedPassedFamilies.local).toEqual(['cycling']);
    expect(report.cards[0]?.review).toBe('pending');
    expect(report.cards[1]?.review).toBe('missing');
  });
  it('rejects corrupted evidence rather than emitting a report', () => {
    expect(() =>
      verifyPrintedSupportReport(JSON.stringify(artifact), subject, ['card-a'], () => '{}'),
    ).toThrow('checksum mismatch');
  });
  it('rejects mismatched receipt claims even when its checksum matches', () => {
    const wrong = JSON.stringify({
      schemaVersion: 1,
      kind: 'printed-play-probe-receipt',
      subject: { ...subject, protocolVersion: 2 },
      result,
    });
    const changed = {
      ...artifact,
      probes: [{ ...result, evidence: { path: 'receipts/cycle.json', sha256: hash(wrong) } }],
    };
    expect(() =>
      verifyPrintedSupportReport(JSON.stringify(changed), subject, ['card-a'], () => wrong),
    ).toThrow('receipt mismatch');
  });
  it('refuses stale subjects and foreign cards before evidence IO', () => {
    const read = vi.fn(() => receipt);
    expect(() =>
      verifyPrintedSupportReport(
        JSON.stringify(artifact),
        { ...subject, protocolVersion: 2 },
        ['card-a'],
        read,
      ),
    ).toThrow('subject-mismatch');
    expect(() => verifyPrintedSupportReport(JSON.stringify(artifact), subject, ['card-b'], read)).toThrow(
      'foreign-card',
    );
    expect(read).not.toHaveBeenCalled();
  });
});
