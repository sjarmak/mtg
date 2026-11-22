import { beforeAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  preparePrintedLimitedFormat,
  printedSourceFingerprint,
  runPrintedLimitedDraft,
} from '@mtg/draft-export';
import type { PreparedPrintedLimitedFormat } from '@mtg/draft-export';
import { prepareLimitedDeck, toDeckRef } from '@mtg/limited';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { PrintedDraftRatingsSchema } from '../../src/lab/printed-draft-ratings';
import { suggestPrintedDeck } from '../../src/routes/printed/deck-evaluation';
import { printedLimitedFacts } from '../../src/routes/printed/limited-facts';
import { preparePrintedMatch } from '../../src/routes/printed/printed-match';

let prepared: PreparedPrintedLimitedFormat;
let innistrad: PreparedPrintedLimitedFormat;
let innistradCatalog: PrintedCardCatalog;
const bot = { botPolicy: 'printed-limited-v1', score: () => 0 };
const basics = { Plains: 0, Island: 0, Swamp: 0, Mountain: 0, Forest: 17 };
beforeAll(async () => {
  const read = (name: string): unknown =>
    JSON.parse(readFileSync(`packages/data/data/akh-hou/${name}.json`, 'utf8'));
  prepared = await preparePrintedLimitedFormat(
    read('akh-hou-limited-format-v1'),
    ['akh', 'hou', 'mp2'].map((code) => read(`${code}-printed-catalog-v1`)),
    async (text) => createHash('sha256').update(text).digest('hex'),
  );
  const innistradRead = (name: string): unknown =>
    JSON.parse(readFileSync(`packages/data/data/isd/${name}.json`, 'utf8'));
  innistradCatalog = parsePrintedCardCatalog(innistradRead('isd-printed-catalog-v1'));
  innistrad = await preparePrintedLimitedFormat(
    innistradRead('isd-limited-format-v1'),
    [innistradCatalog],
    async (text) => createHash('sha256').update(text).digest('hex'),
  );
});

function sealed() {
  return {
    version: 1,
    mode: 'sealed',
    formatId: prepared.format.id,
    fingerprint: prepared.fingerprint,
    seed: 'match-pool',
    deck: {
      selectedPhysicalIds: prepared
        .openSealedPool('match-pool')
        .cards.slice(0, 23)
        .map((c) => c.physicalId),
      basics,
    },
  };
}

it('converts only the selected physical copies and basics to the neutral match contract', () => {
  const session = sealed();
  const before = JSON.stringify(session);
  const table = preparePrintedMatch(prepared, session, { seed: 'game-1', humanSeat: 1 }, bot);
  const pool = prepared.openSealedPool(session.seed).cards;
  const expected = toDeckRef(
    { ...prepareLimitedDeck(pool, (c) => printedLimitedFacts(c.payload.printing)), ...session.deck },
    'Your sealed deck',
  );
  expect(table).toMatchObject({
    content: { kind: 'printed', format: prepared.format.id },
    seed: 'game-1',
    maximumTurns: null,
    seats: [{ controller: 'engine' }, { controller: 'local', deck: expected }],
  });
  expect(table.seats[1].deck.cards.reduce((n, c) => n + c.count, 0)).toBe(40);
  expect(JSON.stringify(session)).toBe(before);
  const rematch = preparePrintedMatch(prepared, session, { seed: 'game-2', humanSeat: 0 }, bot);
  expect(rematch.seats[0].deck).toEqual(table.seats[1].deck);
  expect(rematch.seats[1].deck).toEqual(table.seats[0].deck);
  const opponentSeed = JSON.stringify(['printed-sealed-opponent/v1', prepared.fingerprint, session.seed]);
  const opponentPool = prepared.openSealedPool(opponentSeed).cards;
  expect(opponentPool).not.toEqual(pool);
  expect(table.seats[0].deck).toEqual(
    toDeckRef(
      suggestPrintedDeck(prepareLimitedDeck(opponentPool, (c) => printedLimitedFacts(c.payload.printing))),
      'Bot sealed deck',
    ),
  );
});

it('preserves repeated printings as multiple copies rather than a singleton deck', () => {
  const session = sealed();
  const pool = prepared.openSealedPool(session.seed).cards;
  const copy = pool.find(
    (c) =>
      pool.filter((p) => p.payload.printing.correctedName === c.payload.printing.correctedName).length > 1,
  )!;
  expect(copy).toBeDefined();
  const copies = pool.filter((c) => c.payload.printing.correctedName === copy.payload.printing.correctedName);
  const table = preparePrintedMatch(
    prepared,
    {
      ...session,
      deck: {
        selectedPhysicalIds: copies.map((c) => c.physicalId),
        basics: { ...basics, Forest: 40 - copies.length },
      },
    },
    { seed: 'duplicate-game', humanSeat: 0 },
    bot,
  );
  expect(table.seats[0].deck.cards.find((c) => c.name === copy.payload.printing.correctedName)?.count).toBe(
    copies.length,
  );
});

it('uses the actual second draft seat for the opponent after the draft finishes', () => {
  const progress = runPrintedLimitedDraft(prepared, { ...bot, seed: 'completed-match-draft' });
  const seats = progress.result!.seats;
  const picks = seats[0]!.picks.map((pick) => pick.card.physicalId);
  const session = {
    mode: 'draft',
    transcript: {
      version: 1,
      formatId: prepared.format.id,
      fingerprint: prepared.fingerprint,
      seed: 'completed-match-draft',
      humanSeatIds: ['seat-1'],
      picks: { 'seat-1': picks },
    },
    deck: { selectedPhysicalIds: picks.slice(0, 23), basics },
  };
  const table = preparePrintedMatch(prepared, session, { seed: 'draft-game', humanSeat: 0 }, bot);
  const opponent = suggestPrintedDeck(
    prepareLimitedDeck(
      seats[1]!.picks.map((pick) => pick.card),
      (c) => printedLimitedFacts(c.payload.printing),
    ),
  );
  expect(table.seats[1].deck).toEqual(toDeckRef(opponent, 'Bot draft deck'));
  expect(table).not.toHaveProperty('packs');
  expect(table).not.toHaveProperty('observations');
  expect(() =>
    preparePrintedMatch(
      prepared,
      { ...session, transcript: { ...session.transcript, picks: { 'seat-1': [] } } },
      { seed: 'draft-game', humanSeat: 0 },
      bot,
    ),
  ).toThrow(/finished/);
});

it('uses staged rankings when constructing an unauthored sealed opponent', () => {
  const seed = 'ranked-match-pool';
  const opponentSeed = JSON.stringify(['printed-sealed-opponent/v1', innistrad.fingerprint, seed]);
  const opponentPool = innistrad.openSealedPool(opponentSeed).cards;
  const preparedOpponent = prepareLimitedDeck(opponentPool, (card) =>
    printedLimitedFacts(card.payload.printing),
  );
  const structural = suggestPrintedDeck(preparedOpponent);
  const promoted = opponentPool.find(
    (card) =>
      !structural.selectedPhysicalIds.includes(card.physicalId) &&
      !/\bLand\b/u.test(card.payload.printing.typeLine),
  )!;
  expect(promoted).toBeDefined();
  const ratings = PrintedDraftRatingsSchema.parse({
    schemaVersion: 1,
    kind: 'printed-draft-ratings',
    source: {
      kind: 'forge-limited-rankings',
      version: 'test',
      bridgeFingerprint: 'd'.repeat(64),
      fingerprint: 'e'.repeat(64),
    },
    catalogs: [
      {
        code: 'ISD',
        catalogSha256: innistradCatalog.contentSha256,
        cards: innistradCatalog.cards.map((card) => ({
          physicalId: card.physicalId,
          sourceFingerprint: printedSourceFingerprint(card),
          quality: card.physicalId === promoted.payload.printing.physicalId ? 5 : 0,
        })),
      },
    ],
  });
  const ranked = suggestPrintedDeck(preparedOpponent, ratings);
  expect(ranked.selectedPhysicalIds).toContain(promoted.physicalId);
  const humanPool = innistrad.openSealedPool(seed).cards;
  const session = {
    version: 1,
    mode: 'sealed' as const,
    formatId: innistrad.format.id,
    fingerprint: innistrad.fingerprint,
    seed,
    deck: {
      selectedPhysicalIds: humanPool.slice(0, 23).map((card) => card.physicalId),
      basics,
    },
  };
  const table = preparePrintedMatch(innistrad, session, { seed: 'ranked-game', humanSeat: 0 }, bot, ratings);
  expect(table.seats[1].deck).toEqual(toDeckRef(ranked, 'Bot sealed deck'));
});

it('refuses absent, short, foreign, and duplicated-copy saved decks', () => {
  const session = sealed();
  const options = { seed: 'game', humanSeat: 0 as const };
  const { deck: _deck, ...noDeck } = session;
  expect(() => preparePrintedMatch(prepared, noDeck, options, bot)).toThrow(/saved deck/);
  expect(() =>
    preparePrintedMatch(prepared, { ...session, fingerprint: '0'.repeat(64) }, options, bot),
  ).toThrow(/fingerprint/);
  for (const ids of [
    [],
    ['invented'],
    [session.deck.selectedPhysicalIds[0], session.deck.selectedPhysicalIds[0]],
  ]) {
    expect(() =>
      preparePrintedMatch(
        prepared,
        { ...session, deck: { ...session.deck, selectedPhysicalIds: ids } },
        options,
        bot,
      ),
    ).toThrow();
  }
});

it('refuses empty game seeds and invalid seat numbers at the match boundary', () => {
  expect(() => preparePrintedMatch(prepared, sealed(), { seed: ' ', humanSeat: 0 }, bot)).toThrow(/seed/);
  expect(() => preparePrintedMatch(prepared, sealed(), { seed: 'game', humanSeat: 2 as 0 }, bot)).toThrow(
    /seat/,
  );
});
