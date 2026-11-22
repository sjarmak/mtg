import { describe, expect, it } from 'vitest';
import { evaluatePrintedPlayAdmission } from '../src/play-admission';

const subject = {
  formatId: 'akh-hou',
  formatSha256: 'a'.repeat(64),
  catalogs: { AKH: 'b'.repeat(64), HOU: 'c'.repeat(64) },
  forgeVersion: '2.0.14',
  forgeJarSha256: 'd'.repeat(64),
  scriptArchiveSha256: 'e'.repeat(64),
  resourcesSha256: '4'.repeat(64),
  bridgeSha256: 'f'.repeat(64),
  adapterSha256: '1'.repeat(64),
  protocolVersion: 1,
};
const card = {
  id: 'hou-printed-v1:1',
  review: 'reviewed',
  decisionFamilies: ['priority'],
  probeIds: ['human', 'bot'],
  note: 'Reviewed complete script and generated objects.',
};
const probe = (id: string, controller: 'local' | 'engine') => ({
  id,
  controller,
  scope: 'card',
  cardIds: [card.id],
  decisionFamilies: ['priority'],
  status: 'passed',
  assertions: ['The activated ability resolved and changed the battlefield.'],
  evidence: { path: `probes/${id}.json`, sha256: '2'.repeat(64) },
});
const evidence = () => ({
  schemaVersion: 1,
  kind: 'printed-play-admission',
  subject,
  cards: [card],
  matchProbeIds: ['match-human', 'match-bot'],
  probes: [
    probe('human', 'local'),
    probe('bot', 'engine'),
    {
      ...probe('match-human', 'local'),
      scope: 'match',
      decisionFamilies: ['starting-player', 'mulligan', 'priority'],
    },
    {
      ...probe('match-bot', 'engine'),
      scope: 'match',
      decisionFamilies: ['starting-player', 'mulligan', 'priority'],
    },
  ],
});

describe('printed play admission evidence', () => {
  it('rejects older subjects that omit the resource identity', () => {
    const oldSubject = Object.fromEntries(
      Object.entries(subject).filter(([key]) => key !== 'resourcesSha256'),
    );
    expect(() =>
      evaluatePrintedPlayAdmission({ ...evidence(), subject: oldSubject }, subject, [card.id]),
    ).toThrow();
  });
  it('admits only a fully accounted-for subject with human and bot evidence', () => {
    expect(evaluatePrintedPlayAdmission(evidence(), subject, [card.id])).toEqual({
      admitted: true,
      reasons: [],
    });
  });
  it('retains an explicit Momir global-creature policy', () => {
    expect(
      evaluatePrintedPlayAdmission(
        { ...evidence(), generatedObjectPolicy: 'forge-momir-global-creatures' },
        subject,
        [card.id],
      ),
    ).toEqual({ admitted: true, reasons: [] });
  });
  it.each([
    'formatId',
    'formatSha256',
    'forgeVersion',
    'forgeJarSha256',
    'scriptArchiveSha256',
    'resourcesSha256',
    'bridgeSha256',
    'adapterSha256',
    'protocolVersion',
    'catalogs',
  ] as const)('refuses stale %s', (key) => {
    const changed = {
      ...subject,
      [key]:
        key === 'protocolVersion'
          ? 2
          : key === 'catalogs'
            ? { ...subject.catalogs, MP2: '3'.repeat(64) }
            : key.endsWith('Sha256')
              ? '3'.repeat(64)
              : 'changed',
    };
    expect(evaluatePrintedPlayAdmission(evidence(), changed, [card.id])).toMatchObject({
      admitted: false,
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: 'subject-mismatch', subjectField: key }),
      ]),
    });
  });
  it('refuses catalog additions and evidence for foreign cards', () => {
    expect(evaluatePrintedPlayAdmission(evidence(), subject, ['new-card']).reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing-card', cardId: 'new-card' }),
        expect.objectContaining({ code: 'foreign-card', cardId: card.id }),
      ]),
    );
  });
  it.each(['pending', 'excluded'])('does not admit %s reviews', (review) => {
    expect(
      evaluatePrintedPlayAdmission({ ...evidence(), cards: [{ ...card, review }] }, subject, [card.id])
        .admitted,
    ).toBe(false);
  });
  it.each(['failed', 'not-run'])('does not count %s probes', (status) => {
    const data = evidence();
    expect(
      evaluatePrintedPlayAdmission({ ...data, probes: data.probes.map((p) => ({ ...p, status })) }, subject, [
        card.id,
      ]).admitted,
    ).toBe(false);
  });
  it('requires evidence for each decision family under each controller', () => {
    const data = {
      ...evidence(),
      cards: [{ ...card, decisionFamilies: ['priority', 'zone-card-selection'] }],
    };
    const result = evaluatePrintedPlayAdmission(data, subject, [card.id]);
    expect(result.admitted).toBe(false);
    expect(result.reasons.filter((reason) => reason.code === 'unproven-family')).toHaveLength(2);
  });
  it('requires independent match probes for both controllers', () => {
    expect(
      evaluatePrintedPlayAdmission({ ...evidence(), matchProbeIds: ['match-human'] }, subject, [card.id])
        .reasons,
    ).toContainEqual(expect.objectContaining({ code: 'unproven-match', controller: 'engine' }));
  });
  it('rejects missing probe references, duplicate cards, duplicate probes and empty proof', () => {
    for (const data of [
      { ...evidence(), cards: [{ ...card, probeIds: ['absent'] }] },
      { ...evidence(), cards: [card, card] },
      { ...evidence(), probes: [probe('human', 'local'), probe('human', 'local')] },
      { ...evidence(), probes: [{ ...probe('human', 'local'), evidence: null }, probe('bot', 'engine')] },
      { ...evidence(), cards: [] },
    ])
      expect(() => evaluatePrintedPlayAdmission(data, subject, [card.id])).toThrow();
  });
});
