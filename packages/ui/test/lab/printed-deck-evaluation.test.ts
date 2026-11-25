import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { prepareLimitedDeck, validateLimitedDeck } from '@mtg/limited';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import type { PrintedCardCatalogEntry } from '@mtg/printed-card';
import { printedCardRolesOf, printedSourceFingerprint, validatePrintedCardRoles } from '@mtg/draft-export';
import type { PreparedPrintedLimitedFormat, PrintedBoosterCopy } from '@mtg/draft-export';
import { PrintedDraftRatingsSchema } from '../../src/lab/printed-draft-ratings';
import { printedLimitedFacts } from '../../src/routes/printed/limited-facts';
import { suggestPrintedDeck, suggestPrintedBasics } from '../../src/routes/printed/deck-evaluation';
import {
  PRINTED_BASELINE_BOT,
  PRINTED_EVALUATED_BOT,
  PRINTED_GENERAL_BOT,
  botForNewPrintedDraft,
  createPrintedReplayBot,
  printedBotCalibrationNote,
  printedBotLabel,
  printedBotForPolicy,
  roleAwarePrintedBot,
} from '../../src/routes/printed/draft-bot';

const cards = ['akh', 'hou', 'mp2'].flatMap(
  (code) =>
    (
      JSON.parse(readFileSync(`packages/data/data/akh-hou/${code}-printed-catalog-v1.json`, 'utf8')) as {
        cards: PrintedCardCatalogEntry[];
      }
    ).cards,
);
const copy = (name: string, id = name): PrintedBoosterCopy => ({
  physicalId: id,
  payload: {
    printing: cards.find((c) => c.correctedName === name)!,
    sourceSetCode: 'HOU',
    productId: 'fixture',
    slot: { sheet: 'common', foil: null },
  },
});
const prepare = (pool: PrintedBoosterCopy[]) =>
  prepareLimitedDeck(pool, (c) => printedLimitedFacts(c.payload.printing));

it('keeps printed construction coherent and preserves actual copy ownership', () => {
  const pool = [
    ...Array.from({ length: 13 }, (_, i) => copy('Gust Walker', `w${i}`)),
    ...Array.from({ length: 13 }, (_, i) => copy('Aerial Guide', `u${i}`)),
    copy('Dune Beetle'),
    copy('Granitic Titan'),
    copy('Giant Spider'),
  ];
  const original = prepare(pool);
  const deck = suggestPrintedDeck(original);
  expect(validateLimitedDeck(deck).legal).toBe(true);
  expect(deck.selectedPhysicalIds.every((id) => id.startsWith('w') || id.startsWith('u'))).toBe(true);
  expect(new Set(deck.selectedPhysicalIds).size).toBe(deck.selectedPhysicalIds.length);
  expect(original.selectedPhysicalIds).toEqual([]);
  expect(deck.basics.Swamp + deck.basics.Mountain + deck.basics.Forest).toBe(0);
});

it('suggests basics for the actual edited spell pips while preserving selections', () => {
  const pool = [
    ...Array.from({ length: 10 }, (_, i) => copy('Gideon of the Trials', `w${i}`)),
    ...Array.from({ length: 10 }, (_, i) => copy('Aerial Guide', `u${i}`)),
  ];
  const original = { ...prepare(pool), selectedPhysicalIds: pool.map((c) => c.physicalId) };
  const deck = suggestPrintedBasics(original);
  expect(deck.basics.Plains).toBeGreaterThan(deck.basics.Island);
  expect(deck.selectedPhysicalIds).toEqual(original.selectedPhysicalIds);
});

it('selects saved bot policy explicitly and rejects unavailable policies', () => {
  expect(printedBotForPolicy(undefined)).toBe(PRINTED_BASELINE_BOT);
  expect(printedBotForPolicy('printed-limited-v1')).toBe(PRINTED_BASELINE_BOT);
  expect(printedBotForPolicy(PRINTED_GENERAL_BOT.botPolicy)).toBe(PRINTED_GENERAL_BOT);
  expect(printedBotForPolicy(PRINTED_EVALUATED_BOT.botPolicy)).toBe(PRINTED_EVALUATED_BOT);
  expect(printedBotLabel(PRINTED_EVALUATED_BOT.botPolicy)).toBe('Deck-aware');
  expect(printedBotLabel(PRINTED_GENERAL_BOT.botPolicy)).toBe('General structural');
  expect(printedBotCalibrationNote(PRINTED_EVALUATED_BOT.botPolicy)).toBe(
    'use authored set evaluations with deck-aware picks',
  );
  expect(printedBotCalibrationNote(PRINTED_GENERAL_BOT.botPolicy)).toBe('are not format-calibrated');
  expect(printedBotLabel(undefined)).toBe('Baseline');
  expect(() => printedBotForPolicy('unavailable')).toThrow(/policy/);
});

it('selects authored evaluation only for authenticated pinned catalogs', () => {
  const format = JSON.parse(
    readFileSync('packages/data/data/akh-hou/akh-hou-limited-format-v1.json', 'utf8'),
  ) as PreparedPrintedLimitedFormat['format'];
  expect(botForNewPrintedDraft({ format })).toBe(PRINTED_EVALUATED_BOT);
  expect(botForNewPrintedDraft({ format: { ...format, sources: [] } })).toBe(PRINTED_GENERAL_BOT);
});

it('uses an isolated general observed-pool bot for a held-out catalog', () => {
  const heldOut = {
    format: { sources: [{ catalogSha256: 'f'.repeat(64) }] },
  } as PreparedPrintedLimitedFormat;
  expect(botForNewPrintedDraft(heldOut)).toBe(PRINTED_GENERAL_BOT);
  const replay = createPrintedReplayBot(PRINTED_GENERAL_BOT.botPolicy);
  const input = {
    card: copy('Gust Walker'),
    seatId: 'seat-2',
    picked: [copy('Aerial Guide')],
    round: 1,
    pickNumber: 2,
    packSize: 14,
    openedBy: 'seat-1',
  };
  expect(replay).not.toBe(PRINTED_GENERAL_BOT);
  expect(replay.score(input)).toBe(PRINTED_GENERAL_BOT.score(input));
  const alternate = {
    ...input,
    card: {
      ...input.card,
      payload: {
        ...input.card.payload,
        printing: {
          ...input.card.payload.printing,
          manaValue: 20,
          faces: input.card.payload.printing.faces.map((face) => ({ ...face })),
        },
      },
    },
  };
  expect(replay.score(alternate)).not.toBe(replay.score(input));
});

it('prepares one observed pool once while comparing every offered candidate', () => {
  const replay = createPrintedReplayBot(PRINTED_EVALUATED_BOT.botPolicy);
  let reads = 0;
  const picked = new Proxy([copy('Aerial Guide')], {
    get(target, property, receiver) {
      if (property === '0') reads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  const score = (card: PrintedBoosterCopy) =>
    replay.score({
      card,
      seatId: 'seat-2',
      picked,
      round: 1,
      pickNumber: 2,
      packSize: 14,
      openedBy: 'seat-1',
    });

  score(copy('Gust Walker', 'candidate-1'));
  score(copy('Dune Beetle', 'candidate-2'));

  expect(reads).toBe(1);
});

it('uses deck-conditioned construction for cards outside the authored table', () => {
  const heldOut = (name: string, color: 'W' | 'U' | 'B' | 'R' | 'G', manaValue: number, id: string) => {
    const original = cards[0]!;
    const printing: PrintedCardCatalogEntry = {
      ...original,
      correctedName: name,
      physicalId: `held-out:${id}`,
      colors: [color],
      manaValue,
      manaCost: `{${String(Math.max(0, manaValue - 1))}}{${color}}`,
      faces: [
        {
          ...original.faces[0]!,
          name,
          colors: [color],
          manaCost: `{${String(Math.max(0, manaValue - 1))}}{${color}}`,
        },
      ],
    };
    return {
      physicalId: id,
      payload: {
        printing,
        sourceSetCode: 'NEW',
        productId: 'fixture',
        slot: { sheet: 'common', foil: null },
      },
    } satisfies PrintedBoosterCopy;
  };
  const pool = [
    ...Array.from({ length: 12 }, (_, i) => heldOut(`Red ${String(i)}`, 'R', 5, `r${String(i)}`)),
    ...Array.from({ length: 12 }, (_, i) => heldOut(`Blue ${String(i)}`, 'U', 5, `u${String(i)}`)),
    heldOut('Green lure', 'G', 3, 'g'),
    heldOut('Black lure', 'B', 3, 'b'),
    heldOut('White lure', 'W', 3, 'w'),
  ];
  const deck = suggestPrintedDeck(prepare(pool));
  expect(deck.selectedPhysicalIds).toHaveLength(23);
  expect(deck.selectedPhysicalIds.every((id) => id.startsWith('r') || id.startsWith('u'))).toBe(true);
});

it('uses staged set rankings when constructing an unauthored printed pool', () => {
  const original = cards[0]!;
  const heldOut = (index: number, manaValue: number): PrintedBoosterCopy => {
    const name = index === 24 ? 'Ranked bomb' : `Curve card ${String(index)}`;
    const printing: PrintedCardCatalogEntry = {
      ...original,
      correctedName: name,
      physicalId: `held-out:ranked:${String(index)}`,
      colors: ['R'],
      manaValue,
      manaCost: `{${String(Math.max(0, manaValue - 1))}}{R}`,
      faces: [
        {
          ...original.faces[0]!,
          name,
          colors: ['R'],
          manaCost: `{${String(Math.max(0, manaValue - 1))}}{R}`,
        },
      ],
    };
    return {
      physicalId: `copy-${String(index)}`,
      payload: {
        printing,
        sourceSetCode: 'NEW',
        productId: 'fixture',
        slot: { sheet: 'common', foil: null },
      },
    };
  };
  const pool = [...Array.from({ length: 24 }, (_, index) => heldOut(index, 3)), heldOut(24, 8)];
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
        code: 'NEW',
        catalogSha256: 'f'.repeat(64),
        cards: pool.map(({ payload: { printing } }) => ({
          physicalId: printing.physicalId,
          sourceFingerprint: printedSourceFingerprint(printing),
          quality: printing.correctedName === 'Ranked bomb' ? 5 : 0,
        })),
      },
    ],
  });
  const structural = suggestPrintedDeck(prepare(pool));
  const ranked = suggestPrintedDeck(prepare(pool), ratings);

  expect(structural.selectedPhysicalIds).not.toContain('copy-24');
  expect(ranked.selectedPhysicalIds).toContain('copy-24');
  expect(validateLimitedDeck(ranked).legal).toBe(true);
});

it('layers labeled card roles on the structural bot only under a policy that names them', () => {
  const isd = parsePrintedCardCatalog(
    JSON.parse(readFileSync('packages/data/data/isd/isd-printed-catalog-v1.json', 'utf8')),
  );
  const roles = validatePrintedCardRoles(
    JSON.parse(readFileSync('packages/data/data/isd/card-roles-v1.json', 'utf8')),
    [{ code: 'ISD', catalog: isd }],
  );
  const bot = roleAwarePrintedBot(roles);
  expect(bot.botPolicy.startsWith(`${PRINTED_GENERAL_BOT.botPolicy}+roles/`)).toBe(true);
  expect(printedBotForPolicy(bot.botPolicy, undefined, roles).botPolicy).toBe(bot.botPolicy);
  expect(() => printedBotForPolicy(bot.botPolicy)).toThrow(/unavailable/u);
  expect(createPrintedReplayBot(bot.botPolicy, undefined, roles).botPolicy).toBe(bot.botPolicy);
  expect(printedBotLabel(bot.botPolicy)).toBe('General structural with card roles');

  const isdCopy = (printing: PrintedCardCatalogEntry, physicalId: string): PrintedBoosterCopy => ({
    physicalId,
    payload: { printing, sourceSetCode: 'ISD', productId: 'fixture', slot: { sheet: 'common', foil: null } },
  });
  const roleless = isd.cards.filter(
    (card) => printedCardRolesOf(roles, card).length === 0 && /\bCreature\b/u.test(card.typeLine),
  );
  const answer = isd.cards.find(
    (card) =>
      printedCardRolesOf(roles, card).includes('interaction') &&
      !/\b(?:Creature|Land)\b/u.test(card.typeLine),
  )!;
  const picked = roleless.slice(0, 10).map((card, index) => isdCopy(card, `picked-${index}`));
  type ScoreInput = Parameters<typeof bot.score>[0];
  const gain = (card: PrintedCardCatalogEntry): number => {
    const input = { card: isdCopy(card, 'offered'), picked } as unknown as ScoreInput;
    return bot.score(input) - PRINTED_GENERAL_BOT.score(input);
  };
  expect(gain(answer)).toBeGreaterThan(0);
  expect(gain(roleless[20]!)).toBe(0);
});
