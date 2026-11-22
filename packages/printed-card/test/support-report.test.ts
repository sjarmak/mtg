import { describe, expect, it } from 'vitest';
import { buildPrintedSupportReport } from '../src/support-report';

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
const probe = {
  id: 'cycle',
  scope: 'card',
  controller: 'local',
  cardIds: ['card-a'],
  decisionFamilies: ['cycling'],
  status: 'passed',
  assertions: ['Source discarded; one card drawn.'],
  evidence: { path: 'probes/cycle.json', sha256: '2'.repeat(64) },
};
const artifact = {
  schemaVersion: 1,
  kind: 'printed-play-admission',
  subject,
  matchProbeIds: [],
  probes: [probe],
  cards: [
    {
      id: 'card-a',
      review: 'pending',
      decisionFamilies: ['cycling', 'counterspell'],
      probeIds: ['cycle'],
      note: 'Cycling is measured; complete card review is pending.',
    },
  ],
};

describe('printed support report (structural claims, not evidence IO)', () => {
  it('accounts for every required printing without treating partial probes as full review', () => {
    const ids = ['card-a', ...Array.from({ length: 549 }, (_, i) => `printing-${i}`)];
    const report = buildPrintedSupportReport(artifact, subject, ids);
    expect(report.cards).toHaveLength(550);
    expect(new Set(report.cards.map((card) => card.physicalId)).size).toBe(550);
    expect(report.cards[0]).toMatchObject({
      physicalId: 'card-a',
      review: 'pending',
      declaredFamilies: ['counterspell', 'cycling'],
      claimedPassedFamilies: { local: ['cycling'], engine: [] },
      gaps: expect.arrayContaining([
        { code: 'unreviewed-card', cardId: 'card-a' },
        { code: 'unproven-family', cardId: 'card-a', controller: 'engine', family: 'cycling' },
      ]),
    });
    expect(report.cards[1]).toMatchObject({
      review: 'missing',
      declaredFamilies: [],
      claimedPassedFamilies: { local: [], engine: [] },
      gaps: [{ code: 'missing-card', cardId: 'printing-0' }],
    });
    expect(report.admitted).toBe(false);
    expect(report.matchGaps).toHaveLength(6);
    expect(report.evidenceVerification).toBe('not-performed');
  });

  it('is deterministic across population, review and family order without mutating inputs', () => {
    const before = JSON.stringify(artifact);
    const reversed = {
      ...artifact,
      cards: artifact.cards.map((card) => ({
        ...card,
        decisionFamilies: [...card.decisionFamilies].reverse(),
      })),
    };
    expect(buildPrintedSupportReport(reversed, subject, ['card-b', 'card-a'])).toEqual(
      buildPrintedSupportReport(artifact, subject, ['card-a', 'card-b']),
    );
    expect(JSON.stringify(artifact)).toBe(before);
  });

  it.each(['failed', 'not-run'])('does not count %s probes', (status) => {
    const report = buildPrintedSupportReport({ ...artifact, probes: [{ ...probe, status }] }, subject, [
      'card-a',
    ]);
    expect(report.cards[0]?.claimedPassedFamilies.local).toEqual([]);
  });

  it('does not count an unlinked probe or a match probe as card evidence', () => {
    for (const changed of [
      { ...artifact, cards: [{ ...artifact.cards[0], probeIds: [] }] },
      { ...artifact, probes: [{ ...probe, scope: 'match' }] },
    ])
      expect(
        buildPrintedSupportReport(changed, subject, ['card-a']).cards[0]?.claimedPassedFamilies.local,
      ).toEqual([]);
  });

  it.each(['reviewed', 'excluded'])('preserves %s status without auto-admitting', (review) => {
    const report = buildPrintedSupportReport(
      { ...artifact, cards: [{ ...artifact.cards[0], review }] },
      subject,
      ['card-a'],
    );
    expect(report.cards[0]?.review).toBe(review);
    expect(report.admitted).toBe(false);
  });

  it('refuses stale or foreign evidence and malformed populations', () => {
    expect(() => buildPrintedSupportReport(artifact, { ...subject, protocolVersion: 2 }, ['card-a'])).toThrow(
      'subject-mismatch',
    );
    expect(() => buildPrintedSupportReport(artifact, subject, ['foreign'])).toThrow('foreign-card');
    expect(() => buildPrintedSupportReport(artifact, subject, ['card-a', 'card-a'])).toThrow();
    expect(() => buildPrintedSupportReport(artifact, subject, [])).toThrow();
  });
});
