import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { preparePrintedLimitedFormat, runPrintedLimitedDraft, resumePrintedLimitedDraft } from '../src/index';
import type { PreparedPrintedLimitedFormat } from '../src/index';
import { digest } from './printed-limited-fixture';

const read = (file: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../data/data/akh-hou/${file}`, import.meta.url), 'utf8'));
let prepared: PreparedPrintedLimitedFormat;
beforeAll(async () => {
  prepared = await preparePrintedLimitedFormat(
    read('akh-hou-limited-format-v1.json'),
    ['akh', 'hou', 'mp2'].map((code) => read(`${code}-printed-catalog-v1.json`)),
    digest,
  );
});

describe('actual pinned AKH/HOU products through physical replay', () => {
  it('opens balanced 14-card draft and sealed packs with source-qualified copies', () => {
    const packs = prepared.openDraftPacks('actual-products');
    expect(packs).toHaveLength(24);
    expect(packs.map((pack) => pack.round)).toEqual([
      ...Array<number>(8).fill(1),
      ...Array<number>(8).fill(2),
      ...Array<number>(8).fill(3),
    ]);
    for (const pack of packs) {
      expect(pack.cards).toHaveLength(14);
      const commons = pack.cards.filter((card) => card.payload.slot.sheet === 'common');
      expect(commons.length).toBeGreaterThanOrEqual(9);
      expect(new Set(commons.flatMap((card) => card.payload.printing.colors))).toEqual(
        new Set(['W', 'U', 'B', 'R', 'G']),
      );
      expect(new Set(commons.map((card) => card.payload.printing.physicalId)).size).toBe(commons.length);
      for (const card of pack.cards) {
        expect(card.payload.productId).toBe(pack.round === 3 ? 'akh-draft' : 'hou-draft');
        expect(card.payload.printing.typeLine).not.toMatch(/^Basic /);
        expect(card.payload.sourceSetCode).toMatch(pack.round === 3 ? /^(AKH|MP2)$/ : /^(HOU|MP2)$/);
      }
    }
    expect(new Set(packs.flatMap((pack) => pack.cards.map((card) => card.physicalId))).size).toBe(336);
    expect(prepared.openDraftPacks('actual-products')).toEqual(packs);
    const sealed = prepared.openSealedPool('actual-products');
    expect(sealed.cards).toHaveLength(84);
    expect(sealed.boosters.map((pack) => pack[0]?.payload.productId)).toEqual([
      'hou-draft',
      'hou-draft',
      'hou-draft',
      'hou-draft',
      'akh-draft',
      'akh-draft',
    ]);
  });

  it('finishes seeded pods and resumes every human pick without changing the result', () => {
    // Deliberately mechanical test policy: proves replay, not draft-bot quality.
    const bot = { botPolicy: prepared.format.draft.botPolicy, score: () => 0 };
    for (const seed of ['akh-hou-pod-1', 'akh-hou-pod-2', 'akh-hou-pod-3']) {
      const automated = runPrintedLimitedDraft(prepared, { ...bot, seed });
      expect(automated.result?.seats.map((seat) => seat.picks.length)).toEqual(Array<number>(8).fill(42));
      expect(automated.result?.directions).toEqual([1, -1, 1]);
      let progress = runPrintedLimitedDraft(prepared, { ...bot, seed, humanSeatIds: ['seat-1'] });
      let picks: readonly string[] = [];
      while (progress.owed.length > 0) {
        const choice = progress.owed[0]!;
        picks = [...picks, choice.cards[0]!.physicalId];
        progress = resumePrintedLimitedDraft(
          prepared,
          {
            version: 1,
            formatId: prepared.format.id,
            fingerprint: prepared.fingerprint,
            seed,
            humanSeatIds: ['seat-1'],
            picks: { 'seat-1': picks },
          },
          bot,
        );
      }
      expect(progress.observations).toHaveLength(42);
      expect(progress.observations.every((observation) => observation.seatId === 'seat-1')).toBe(true);
      expect(progress.result).toEqual(automated.result);
    }
  });
});
