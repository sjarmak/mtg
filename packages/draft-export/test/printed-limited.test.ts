import { describe, expect, it } from 'vitest';
import { serializedPrintedLimitedFormatContent } from '@mtg/printed-card';
import { preparePrintedLimitedFormat, runPrintedLimitedDraft, resumePrintedLimitedDraft } from '../src/index';
import { digest, printedFixture } from './printed-limited-fixture';

const score = () => 0;
const botPolicy = 'fixture-v1';

describe('source-qualified printed Limited recipes', () => {
  it('opens HOU/HOU/AKH and sealed 4 HOU + 2 AKH without aliasing identical printings', async () => {
    const fixture = await printedFixture();
    const prepared = await preparePrintedLimitedFormat(fixture.format, fixture.catalogs, digest);
    const packs = prepared.openDraftPacks('one');
    expect(packs.map((pack) => pack.cards[0]?.payload.sourceSetCode)).toEqual([
      'HOU',
      'HOU',
      'HOU',
      'HOU',
      'AKH',
      'AKH',
    ]);
    expect(new Set(packs.flatMap((p) => p.cards.map((c) => c.physicalId))).size).toBe(12);
    expect(packs[0]?.cards[1]?.payload).toMatchObject({ sourceSetCode: 'MP2', slot: { foil: true } });
    const sealed = prepared.openSealedPool('one');
    expect(sealed.boosters.map((pack) => pack[0]?.payload.sourceSetCode)).toEqual([
      'HOU',
      'HOU',
      'HOU',
      'HOU',
      'AKH',
      'AKH',
    ]);
    expect(new Set(sealed.cards.map((c) => c.physicalId)).size).toBe(12);
    expect(sealed.cards[0]?.physicalId).not.toBe(packs[0]?.cards[0]?.physicalId);
    expect(prepared.openDraftPacks('one')).toEqual(packs);
    expect(prepared.openSealedPool('one')).toEqual(sealed);
  });

  it('replays a fingerprint-bound human transcript without showing future packs to observations', async () => {
    const fixture = await printedFixture();
    const prepared = await preparePrintedLimitedFormat(fixture.format, fixture.catalogs, digest);
    const initial = runPrintedLimitedDraft(prepared, {
      seed: 'resume',
      score,
      botPolicy,
      humanSeatIds: ['seat-1'],
    });
    const first = initial.owed[0]!.cards[0]!;
    const transcript = {
      version: 1,
      formatId: fixture.format.id,
      fingerprint: prepared.fingerprint,
      seed: 'resume',
      humanSeatIds: ['seat-1'],
      picks: { 'seat-1': [first.physicalId] },
    };
    const resumed = resumePrintedLimitedDraft(prepared, transcript, { score, botPolicy });
    expect(resumed.observations).toHaveLength(2);
    expect(resumed.owed[0]?.pickNumber).toBe(2);
    expect(() =>
      resumePrintedLimitedDraft(
        prepared,
        { ...transcript, fingerprint: 'b'.repeat(64) },
        { score, botPolicy },
      ),
    ).toThrow(/fingerprint/);
    expect(() => resumePrintedLimitedDraft(prepared, transcript, { score, botPolicy: 'different' })).toThrow(
      /bot policy/,
    );
    const changed = { ...fixture.format, draft: { ...fixture.format.draft, rounds: ['AKH', 'HOU', 'HOU'] } };
    const revised = await preparePrintedLimitedFormat(
      {
        ...changed,
        contentSha256: await digest(serializedPrintedLimitedFormatContent(changed)),
      },
      fixture.catalogs,
      digest,
    );
    expect(revised.fingerprint).not.toBe(prepared.fingerprint);
    expect(() => resumePrintedLimitedDraft(revised, transcript, { score, botPolicy })).toThrow(/fingerprint/);
  });

  it('pins a new policy in a transcript while old transcripts retain the recipe policy', async () => {
    const fixture = await printedFixture();
    const prepared = await preparePrintedLimitedFormat(fixture.format, fixture.catalogs, digest);
    const transcript = {
      version: 1,
      formatId: fixture.format.id,
      fingerprint: prepared.fingerprint,
      seed: 'versioned',
      humanSeatIds: ['seat-1'],
      picks: { 'seat-1': [] },
      botPolicy: 'new-policy/v2',
    };
    const bot = { botPolicy: 'new-policy/v2', score };
    const progress = resumePrintedLimitedDraft(prepared, transcript, bot);
    expect(progress).toEqual(runPrintedLimitedDraft(prepared, { ...transcript, ...bot }));
    expect(() => resumePrintedLimitedDraft(prepared, transcript, { botPolicy, score })).toThrow(/bot policy/);
    const { botPolicy: _policy, ...old } = transcript;
    expect(() => resumePrintedLimitedDraft(prepared, old, { botPolicy, score })).not.toThrow();
    expect(() => resumePrintedLimitedDraft(prepared, old, bot)).toThrow(/bot policy/);
  });

  it('refuses stale source catalogs, raw content tampering and unresolved MP2', async () => {
    const fixture = await printedFixture();
    await expect(
      preparePrintedLimitedFormat({ ...fixture.format, name: 'tampered' }, fixture.catalogs, digest),
    ).rejects.toThrow(/checksum/);
    await expect(
      preparePrintedLimitedFormat(fixture.format, fixture.catalogs.slice(0, 2), digest),
    ).rejects.toThrow(/MP2/);
    await expect(
      preparePrintedLimitedFormat(
        fixture.format,
        fixture.catalogs.map((c) => ({ ...c, forgeVersion: 'tampered' })),
        digest,
      ),
    ).rejects.toThrow(/checksum/);
    await expect(
      preparePrintedLimitedFormat(fixture.format, [...fixture.catalogs, fixture.catalogs[0]], digest),
    ).rejects.toThrow(/duplicate/);
  });
});
