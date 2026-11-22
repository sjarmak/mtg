import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  evaluateStructuralPrintedCard,
  preparePrintedLimitedFormat,
  printedSourceFingerprint,
} from '@mtg/draft-export';
import type { PrintedCardCatalog, PrintedCardCatalogEntry } from '@mtg/printed-card';
import {
  evaluateRankedPrintedCard,
  printedDraftRatingsFingerprintInput,
  printedDraftRatingsPolicy,
  validatePrintedDraftRatings,
} from '../../src/lab/printed-draft-ratings';
import { botForNewPrintedDraft, createPrintedReplayBot } from '../../src/routes/printed/draft-bot';

const read = (name: string): unknown => JSON.parse(readFileSync(`packages/data/data/isd/${name}`, 'utf8'));

it('uses a complete authenticated strategic artifact for new and replayed printed drafts', async () => {
  const catalog = read('isd-printed-catalog-v1.json') as PrintedCardCatalog;
  const prepared = await preparePrintedLimitedFormat(
    read('isd-limited-format-v1.json'),
    [catalog],
    async (text) => createHash('sha256').update(text).digest('hex'),
  );
  const source = {
    kind: 'forge-limited-rankings' as const,
    version: '2.0.14',
    bridgeFingerprint: 'c'.repeat(64),
  };
  const catalogs = [
    {
      code: 'ISD',
      catalogSha256: catalog.contentSha256,
      cards: catalog.cards.map((card) => ({
        physicalId: card.physicalId,
        sourceFingerprint: printedSourceFingerprint(card),
        quality:
          card.correctedName === 'Olivia Voldaren'
            ? 4.96
            : card.correctedName === 'Reaper from the Abyss'
              ? 4.88
              : card.correctedName === 'Balefire Dragon'
                ? 4.82
                : card.correctedName === 'Civilized Scholar'
                  ? 3.67
                  : card.correctedName === 'Hamlet Captain'
                    ? 2.91
                    : card.correctedName === 'Armored Skaab'
                      ? 2.53
                      : 1,
      })),
    },
  ];
  const artifact = {
    schemaVersion: 1 as const,
    kind: 'printed-draft-ratings' as const,
    source: {
      ...source,
      fingerprint: createHash('sha256')
        .update(printedDraftRatingsFingerprintInput(source, catalogs))
        .digest('hex'),
    },
    catalogs,
  };
  const ratings = await validatePrintedDraftRatings(artifact, prepared, [{ code: 'ISD', catalog }]);
  const bot = botForNewPrintedDraft(prepared, ratings);
  expect(bot.botPolicy).toBe(printedDraftRatingsPolicy(ratings));
  const replay = createPrintedReplayBot(bot.botPolicy, ratings);
  const printing = (name: string): PrintedCardCatalogEntry =>
    catalog.cards.find((card) => card.correctedName === name)!;
  let nextCopy = 0;
  const copy = (name: string) => ({
    physicalId: `opened-copy-${String(nextCopy++)}:${printing(name).physicalId}`,
    payload: {
      printing: printing(name),
      sourceSetCode: 'ISD',
      productId: 'isd-draft',
      slot: { sheet: 'sfcRareMythic', foil: null },
    },
  });
  const input = {
    seatId: 'seat-2',
    picked: [],
    round: 1,
    pickNumber: 1,
    packSize: 15,
    openedBy: 'seat-1',
  };
  expect(replay.score({ ...input, card: copy('Olivia Voldaren') })).toBeGreaterThan(
    replay.score({ ...input, card: copy('Armored Skaab') }),
  );
  expect(replay.score({ ...input, card: copy('Reaper from the Abyss') })).toBeGreaterThan(
    replay.score({ ...input, card: copy('Hamlet Captain') }),
  );
  expect(
    replay.choose?.({
      ...input,
      cards: [copy('Civilized Scholar'), copy('Balefire Dragon')],
    }),
  ).toBe(1);
  expect(
    replay.choose?.({
      ...input,
      cards: [copy('Civilized Scholar'), copy('Hamlet Captain')],
    }),
  ).toBe(0);
  expect(
    replay.choose?.({
      ...input,
      picked: Array.from({ length: 8 }, () => copy('Hamlet Captain')),
      pickNumber: 9,
      packSize: 7,
      cards: [copy('Civilized Scholar'), copy('Hamlet Captain')],
    }),
  ).toBe(1);
});

it('rejects stale and incomplete strategic artifacts', async () => {
  const catalog = read('isd-printed-catalog-v1.json') as PrintedCardCatalog;
  const prepared = await preparePrintedLimitedFormat(
    read('isd-limited-format-v1.json'),
    [catalog],
    async (text) => createHash('sha256').update(text).digest('hex'),
  );
  const source = {
    kind: 'forge-limited-rankings' as const,
    version: '2.0.14',
    bridgeFingerprint: 'd'.repeat(64),
  };
  const catalogs = [
    {
      code: 'ISD',
      catalogSha256: catalog.contentSha256,
      cards: catalog.cards.map((card) => ({
        physicalId: card.physicalId,
        sourceFingerprint: printedSourceFingerprint(card),
        quality: 1,
      })),
    },
  ];
  const base = {
    schemaVersion: 1 as const,
    kind: 'printed-draft-ratings' as const,
    source: {
      ...source,
      fingerprint: createHash('sha256')
        .update(printedDraftRatingsFingerprintInput(source, catalogs))
        .digest('hex'),
    },
    catalogs,
  };
  await expect(
    validatePrintedDraftRatings(
      { ...base, catalogs: [{ ...base.catalogs[0]!, cards: base.catalogs[0]!.cards.slice(1) }] },
      prepared,
      [{ code: 'ISD', catalog }],
    ),
  ).rejects.toThrow(/complete/);
  await expect(
    validatePrintedDraftRatings(
      {
        ...base,
        catalogs: [
          {
            ...base.catalogs[0]!,
            cards: [
              { ...base.catalogs[0]!.cards[0]!, sourceFingerprint: 0 },
              ...base.catalogs[0]!.cards.slice(1),
            ],
          },
        ],
      },
      prepared,
      [{ code: 'ISD', catalog }],
    ),
  ).rejects.toThrow(/stale/);
  await expect(
    validatePrintedDraftRatings(
      {
        ...base,
        catalogs: [
          {
            ...base.catalogs[0]!,
            cards: [{ ...base.catalogs[0]!.cards[0]!, quality: 5 }, ...base.catalogs[0]!.cards.slice(1)],
          },
        ],
      },
      prepared,
      [{ code: 'ISD', catalog }],
    ),
  ).rejects.toThrow(/fingerprint/);
});

it('falls back to the structural quality for a card Forge does not rank, without throwing', async () => {
  const catalog = read('isd-printed-catalog-v1.json') as PrintedCardCatalog;
  const card = catalog.cards.find((entry) => entry.correctedName === 'Olivia Voldaren')!;
  const source = {
    kind: 'forge-limited-rankings' as const,
    version: '2.0.14',
    bridgeFingerprint: 'e'.repeat(64),
  };
  const catalogs = [
    {
      code: 'ISD',
      catalogSha256: catalog.contentSha256,
      cards: [
        { physicalId: card.physicalId, sourceFingerprint: printedSourceFingerprint(card), quality: null },
      ],
    },
  ];
  const ratings = {
    schemaVersion: 1 as const,
    kind: 'printed-draft-ratings' as const,
    source: {
      ...source,
      fingerprint: createHash('sha256')
        .update(printedDraftRatingsFingerprintInput(source, catalogs))
        .digest('hex'),
    },
    catalogs,
  };
  const structural = evaluateStructuralPrintedCard(card, card.physicalId);
  expect(() => evaluateRankedPrintedCard(ratings, card, card.physicalId)).not.toThrow();
  expect(evaluateRankedPrintedCard(ratings, card, card.physicalId)).toEqual(structural);
});
