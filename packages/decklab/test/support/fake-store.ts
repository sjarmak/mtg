/**
 * An in-memory card store holding a handful of hand-written cards.
 *
 * The unit tests must not depend on `data/store/mtg.sqlite`: it is 626 MB,
 * gitignored, and absent in CI. Rows go in through the real schema and are read
 * back through the real queries, so the SQL under test is the SQL that ships.
 */
import { openStore, type DataStore } from '@mtg/data';

export interface FakeCard {
  readonly name: string;
  readonly manaCost: string | null;
  readonly manaValue: number;
  readonly typeLine: string;
  readonly oracleText?: string;
  readonly colorIdentity: string;
  readonly legalities?: Readonly<Record<string, string>>;
  readonly priceUsd?: number | null;
  readonly layout?: string;
  /** Scryfall's `produced_mana`, as it appears on the row. */
  readonly producedMana?: readonly string[];
  /**
   * Printings of this card, oldest first. Omitted gives one plain English
   * printing with no art, which is what every test that predates the deck
   * artifact expects.
   */
  readonly printings?: readonly FakePrinting[];
}

/** One row in `printing`, for the tests that care which one art comes from. */
export interface FakePrinting {
  readonly setCode: string;
  readonly releasedAt: string;
  readonly artist?: string;
  readonly lang?: string;
  readonly digital?: boolean;
  readonly imageUris?: Readonly<Record<string, string>>;
}

const ALL_LEGAL = { modern: 'legal', standard: 'legal', pauper: 'legal', commander: 'legal' };

const DEFAULT_PRINTING: FakePrinting = { setCode: 'TST', releasedAt: '2020-01-01' };

export function createFakeStore(cards: readonly FakeCard[]): DataStore {
  const store = openStore(':memory:');

  const insertCard = store.db.prepare(`
    INSERT INTO oracle_card (oracle_id, source, name, mana_cost, mana_value, type_line,
      oracle_text, power, toughness, loyalty, colors, color_identity, layout, keywords,
      legalities, reserved, raw_json, bulk_updated_at, ingested_at)
    VALUES (@oracle_id, 'scryfall', @name, @mana_cost, @mana_value, @type_line,
      @oracle_text, NULL, NULL, NULL, @colors, @color_identity, @layout, '[]',
      @legalities, 0, @raw_json, NULL, '2026-01-01')
  `);
  const insertPrinting = store.db.prepare(`
    INSERT INTO printing (scryfall_id, oracle_id, source, set_code, set_name, collector_number,
      rarity, artist, released_at, lang, digital, border_color, frame, image_uris, raw_json,
      bulk_updated_at, ingested_at)
    VALUES (@scryfall_id, @oracle_id, 'scryfall', @set_code, 'Test', '1', 'common', @artist,
      @released_at, @lang, @digital, NULL, NULL, @image_uris, @raw_json, NULL, '2026-01-01')
  `);

  cards.forEach((card, index) => {
    const oracleId = `oracle-${index}`;
    insertCard.run({
      oracle_id: oracleId,
      name: card.name,
      mana_cost: card.manaCost,
      mana_value: card.manaValue,
      type_line: card.typeLine,
      oracle_text: card.oracleText ?? null,
      colors: card.colorIdentity,
      color_identity: card.colorIdentity,
      layout: card.layout ?? 'normal',
      legalities: JSON.stringify(card.legalities ?? ALL_LEGAL),
      raw_json: JSON.stringify(
        card.producedMana === undefined ? {} : { produced_mana: [...card.producedMana] },
      ),
    });
    const price = card.priceUsd === undefined ? 1 : card.priceUsd;
    const printings = card.printings ?? [DEFAULT_PRINTING];
    printings.forEach((printing, order) => {
      insertPrinting.run({
        scryfall_id: `print-${index}-${order}`,
        oracle_id: oracleId,
        set_code: printing.setCode,
        artist: printing.artist ?? null,
        released_at: printing.releasedAt,
        lang: printing.lang ?? 'en',
        digital: printing.digital === true ? 1 : 0,
        image_uris: printing.imageUris === undefined ? null : JSON.stringify(printing.imageUris),
        raw_json: JSON.stringify({ prices: { usd: price === null ? null : price.toFixed(2) } }),
      });
    });
  });

  return store;
}

/**
 * Interchangeable one-mana red spells, numbered from one.
 *
 * A test of the repair loop needs a fresh legal card for every round it scripts,
 * and which card it is never matters — only that the round adds spells the deck
 * did not already have. Hand-writing ten of them would say nothing the count
 * does not.
 */
export function fillerSpells(count: number): readonly FakeCard[] {
  return Array.from({ length: count }, (_unused, index) => ({
    name: `Ember Bolt ${index + 1}`,
    manaCost: '{R}',
    manaValue: 1,
    typeLine: 'Instant',
    colorIdentity: 'R',
    priceUsd: 0.25,
  }));
}

/** A small, deliberately varied pool covering the filters under test. */
export const SAMPLE_CARDS: readonly FakeCard[] = [
  {
    name: 'Lightning Bolt',
    manaCost: '{R}',
    manaValue: 1,
    typeLine: 'Instant',
    oracleText: 'Lightning Bolt deals 3 damage to any target.',
    colorIdentity: 'R',
    priceUsd: 0.78,
  },
  {
    name: 'Monastery Swiftspear',
    manaCost: '{R}',
    manaValue: 1,
    typeLine: 'Creature — Human Monk',
    colorIdentity: 'R',
    priceUsd: 0.5,
  },
  {
    name: 'Boros Charm',
    manaCost: '{R}{W}',
    manaValue: 2,
    typeLine: 'Instant',
    colorIdentity: 'RW',
    priceUsd: 3.0,
  },
  {
    name: 'Counterspell',
    manaCost: '{U}{U}',
    manaValue: 2,
    typeLine: 'Instant',
    colorIdentity: 'U',
    priceUsd: 0.4,
  },
  {
    name: 'Force of Will',
    manaCost: '{3}{U}{U}',
    manaValue: 5,
    typeLine: 'Instant',
    colorIdentity: 'U',
    legalities: { modern: 'not_legal', legacy: 'legal' },
    priceUsd: 60,
  },
  {
    name: 'Relentless Rats',
    manaCost: '{2}{B}',
    manaValue: 3,
    typeLine: 'Creature — Rat',
    oracleText: 'A deck can have any number of cards named Relentless Rats.',
    colorIdentity: 'B',
    priceUsd: 0.3,
  },
  {
    name: 'Sacred Foundry',
    manaCost: null,
    manaValue: 0,
    typeLine: 'Land — Mountain Plains',
    colorIdentity: 'RW',
    producedMana: ['R', 'W'],
    priceUsd: 12,
  },
  {
    name: 'Mishra’s Factory',
    manaCost: null,
    manaValue: 0,
    typeLine: 'Land',
    oracleText: '{T}: Add {C}.',
    colorIdentity: '',
    producedMana: ['C'],
    priceUsd: 2,
  },
  {
    name: 'Mountain',
    manaCost: null,
    manaValue: 0,
    typeLine: 'Basic Land — Mountain',
    colorIdentity: 'R',
    producedMana: ['R'],
    priceUsd: 0.05,
  },
  {
    name: 'Goblin Token',
    manaCost: null,
    manaValue: 0,
    typeLine: 'Token Creature — Goblin',
    colorIdentity: 'R',
    layout: 'token',
    priceUsd: null,
  },
];
