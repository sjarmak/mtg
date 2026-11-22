import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { matchRulesRefusals } from '@mtg/engine';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import type { PrintedConstructedFormat } from '@mtg/printed-card';
import { checkPrintedConstructedBundle } from '../../src/lab/printed-constructed-format';
import { preconDeckRef, preparePreconMatch } from '../../src/routes/printed/precon-match';

let format: PrintedConstructedFormat;
beforeAll(async () => {
  const read = (name: string): unknown =>
    JSON.parse(readFileSync(`packages/data/data/scd/${name}.json`, 'utf8'));
  format = (
    await checkPrintedConstructedBundle(
      read('scd-constructed-format-v1'),
      [parsePrintedCardCatalog(read('scd-printed-catalog-v1'))],
      async (text) => createHash('sha256').update(text).digest('hex'),
    )
  ).format;
});

const deck = (id: string) => format.decks.find((entry) => entry.id === id)!;

it('seats two shipped precons on a Commander table the contract accepts', () => {
  const table = preparePreconMatch(
    format,
    { human: deck('chaos-incarnate'), opponent: deck('first-flight') },
    { seed: 'scd/match/test', humanSeat: 0 },
  );
  expect(matchRulesRefusals(table)).toEqual([]);
  expect(table.content).toEqual({ kind: 'printed', format: 'scd' });
  expect(table.rules).toEqual({ variant: 'commander', startingLife: 40 });
  expect(table.seed).toBe('scd/match/test');
  expect(table.seats.map((seat) => [seat.name, seat.controller, seat.deck.name])).toEqual([
    ['You', 'local', 'Chaos Incarnate'],
    ['Forge bot', 'engine', 'First Flight'],
  ]);
  expect(table.seats[0].deck.commanders).toEqual([{ name: 'Kardur, Doomscourge', count: 1 }]);
  expect(table.seats[1].deck.commanders).toEqual([{ name: 'Isperia, Supreme Judge', count: 1 }]);
  const counted = (cards: readonly { count: number }[]) => cards.reduce((sum, slot) => sum + slot.count, 0);
  expect(counted(table.seats[0].deck.cards)).toBe(99);
  expect(table.seats[1].deck.cards.every((slot) => 'name' in slot && !('physicalId' in slot))).toBe(true);
});

it('seats the human second when asked, and refuses an empty seed or a foreign deck', () => {
  const table = preparePreconMatch(
    format,
    { human: deck('grave-danger'), opponent: deck('token-triumph') },
    { seed: 'scd/match/second', humanSeat: 1 },
  );
  expect(table.seats.map((seat) => seat.controller)).toEqual(['engine', 'local']);
  expect(() =>
    preparePreconMatch(
      format,
      { human: deck('grave-danger'), opponent: deck('token-triumph') },
      { seed: '  ', humanSeat: 0 },
    ),
  ).toThrow('seed must not be empty');
  const foreign = { ...deck('grave-danger'), id: 'not-shipped' };
  expect(() =>
    preparePreconMatch(
      format,
      { human: foreign, opponent: deck('token-triumph') },
      { seed: 'scd/match/foreign', humanSeat: 0 },
    ),
  ).toThrow("Deck not-shipped is not one of Starter Commander Decks 2022's decks.");
});

it('refuses a deck that names no commander, through the contract rather than its own rule', () => {
  const headless = { ...deck('draconic-destruction'), commanders: [] };
  expect(preconDeckRef(headless).commanders).toBeUndefined();
  expect(() =>
    preparePreconMatch(
      format,
      { human: headless, opponent: deck('token-triumph') },
      { seed: 'scd/match/headless', humanSeat: 0 },
    ),
  ).toThrow('names no commander');
});
