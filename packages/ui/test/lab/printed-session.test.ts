import { beforeAll, expect, it } from 'vitest';
import { preparePrintedLimitedFormat, runPrintedLimitedDraft } from '@mtg/draft-export';
import type { PreparedPrintedLimitedFormat } from '@mtg/draft-export';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { restorePrintedSession } from '../../src/routes/printed/printed-limited-session';

let prepared: PreparedPrintedLimitedFormat;
const bot = { botPolicy: 'printed-limited-v1', score: () => 0 };
beforeAll(async () => {
  const read = (file: string): unknown =>
    JSON.parse(readFileSync(`packages/data/data/akh-hou/${file}`, 'utf8'));
  prepared = await preparePrintedLimitedFormat(
    read('akh-hou-limited-format-v1.json'),
    ['akh', 'hou', 'mp2'].map((code) => read(`${code}-printed-catalog-v1.json`)),
    async (text) => createHash('sha256').update(text).digest('hex'),
  );
});
const basics = { Plains: 0, Island: 0, Swamp: 0, Mountain: 0, Forest: 0 };
function sealed() {
  return {
    version: 1,
    mode: 'sealed',
    formatId: prepared.format.id,
    fingerprint: prepared.fingerprint,
    seed: 'session',
  };
}
function draft(picks: readonly string[] = []) {
  return {
    mode: 'draft',
    transcript: {
      version: 1,
      formatId: prepared.format.id,
      fingerprint: prepared.fingerprint,
      seed: 'session',
      humanSeatIds: ['seat-1'],
      picks: { 'seat-1': picks },
    },
  };
}

it('restores sealed copies without collapsing repeated printings', () => {
  const pool = prepared.openSealedPool('session').cards;
  const repeated = pool.find(
    (card) =>
      pool.filter((other) => other.payload.printing.physicalId === card.payload.printing.physicalId).length >
      1,
  )!;
  const copies = pool.filter(
    (card) => card.payload.printing.physicalId === repeated.payload.printing.physicalId,
  );
  expect(copies.length).toBeGreaterThan(1);
  const selectedPhysicalIds = copies.slice(0, 2).map((card) => card.physicalId);
  const restored = restorePrintedSession(
    prepared,
    { ...sealed(), deck: { selectedPhysicalIds, basics } },
    bot,
  );
  expect(restored.pool).toEqual(pool);
  expect(restored.deck?.selectedPhysicalIds).toEqual(selectedPhysicalIds);
  expect(restored.draft).toBeNull();
});

it('replays every pick and exposes only the local observation view', () => {
  let picks: readonly string[] = [];
  let restored = restorePrintedSession(prepared, draft(), bot);
  while (restored.draft?.choice !== null && restored.draft?.choice !== undefined) {
    picks = [...picks, restored.draft.choice.cards[0]!.physicalId];
    restored = restorePrintedSession(prepared, JSON.parse(JSON.stringify(draft(picks))), bot);
    expect(restored.pool.map((card) => card.physicalId)).toEqual(picks);
    expect(restored.draft?.observations.every((observation) => observation.seatId === 'seat-1')).toBe(true);
    expect(restored.draft).not.toHaveProperty('packs');
    expect(restored.draft).not.toHaveProperty('seats');
    expect(restored.draft).not.toHaveProperty('undealt');
  }
  expect(restored.draft?.complete).toBe(true);
  expect(picks).toHaveLength(42);
  const automated = runPrintedLimitedDraft(prepared, { ...bot, seed: 'session' });
  expect(restored.pool).toEqual(automated.result!.seats[0]!.picks.map((pick) => pick.card));
  const deck = { selectedPhysicalIds: picks.slice(0, 23), basics: { ...basics, Forest: 17 } };
  expect(restorePrintedSession(prepared, { ...draft(picks), deck }, bot).deck).toEqual(deck);
});

it('rejects foreign fingerprints and format identities before opening sealed packs', () => {
  expect(() => restorePrintedSession(prepared, { ...sealed(), fingerprint: 'a'.repeat(64) }, bot)).toThrow(
    /fingerprint/,
  );
  expect(() => restorePrintedSession(prepared, { ...sealed(), formatId: 'another' }, bot)).toThrow(/format/);
});

it('rejects another seat, invented picks, and unavailable cards', () => {
  const session = draft();
  expect(() =>
    restorePrintedSession(
      prepared,
      { ...session, transcript: { ...session.transcript, humanSeatIds: ['seat-2'] } },
      bot,
    ),
  ).toThrow(/seat-1/);
  expect(() => restorePrintedSession(prepared, draft(['invented']), bot)).toThrow();
  const initial = runPrintedLimitedDraft(prepared, { ...bot, seed: 'session', humanSeatIds: ['seat-1'] });
  const hidden = initial.packs.at(-1)!.cards[0]!.physicalId;
  expect(() => restorePrintedSession(prepared, draft([hidden]), bot)).toThrow();
});

it('rejects invalid edits and cannot use a printing id in place of a physical copy', () => {
  const copy = prepared.openSealedPool('session').cards[0]!;
  for (const selectedPhysicalIds of [
    [copy.physicalId, copy.physicalId],
    [copy.payload.printing.physicalId],
  ]) {
    expect(() =>
      restorePrintedSession(prepared, { ...sealed(), deck: { selectedPhysicalIds, basics } }, bot),
    ).toThrow(/deck/);
  }
  expect(() =>
    restorePrintedSession(
      prepared,
      { ...sealed(), deck: { selectedPhysicalIds: [], basics: { ...basics, Forest: -1 } } },
      bot,
    ),
  ).toThrow();
});

it('refuses deck edits before a draft finishes and malformed sessions', () => {
  expect(() =>
    restorePrintedSession(prepared, { ...draft(), deck: { selectedPhysicalIds: [], basics } }, bot),
  ).toThrow(/finished/);
  expect(() => restorePrintedSession(prepared, { ...sealed(), version: 2 }, bot)).toThrow();
});
