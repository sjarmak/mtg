/**
 * An in-memory card store, written through the ingest path that ships.
 *
 * `constructCube` is the entry point that touches SQL, and the unit tests must
 * not touch `data/store/mtg.sqlite`: it is 626 MB, gitignored and absent in CI.
 * So the rows go in as Scryfall objects through `@mtg/data`'s own schema,
 * mappers and writers, and come back out through `@mtg/decklab`'s real query.
 * Hand-rolled INSERTs would be a second definition of what a row looks like,
 * and the first thing it would stop catching is the day one of those columns
 * moves.
 */
import {
  createWriters,
  openStore,
  ScryfallCardSchema,
  toOracleCardRow,
  toPrintingRowInput,
  type DataStore,
} from '@mtg/data';
import type { CardSpec } from './fixture-cube';

export interface StoreCardSpec extends CardSpec {
  /**
   * Legality in the format under test. `false` puts the card in the store and
   * out of the pool, which is the difference between "you invented that card"
   * and "that one is not available here".
   */
  readonly legal?: boolean;
  readonly layout?: string;
}

/** A UUID-shaped id, which is what `ScryfallCardSchema` requires of both ids. */
function uuidFor(prefix: string, index: number): string {
  return `${prefix}000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

/**
 * The Scryfall object a spec stands for. The price lives under `prices.usd` on
 * the printing's raw JSON because that is where `selectUniverse` reads it from.
 */
function scryfallCard(spec: StoreCardSpec, index: number): Record<string, unknown> {
  return {
    object: 'card',
    id: uuidFor('0b', index),
    oracle_id: uuidFor('0a', index),
    name: spec.name,
    lang: 'en',
    layout: spec.layout ?? 'normal',
    cmc: spec.manaValue,
    type_line: spec.typeLine ?? 'Creature — Fixture',
    color_identity: [...spec.colorIdentity],
    colors: [...spec.colorIdentity],
    keywords: [],
    mana_cost: spec.manaCost,
    legalities: { modern: spec.legal === false ? 'banned' : 'legal', legacy: 'legal' },
    set: 'tst',
    set_name: 'Test',
    collector_number: String(index + 1),
    rarity: 'common',
    released_at: '2020-01-01',
    digital: false,
    prices: { usd: (spec.priceUsd ?? 1).toFixed(2) },
  };
}

export function fixtureStore(specs: readonly StoreCardSpec[]): DataStore {
  const store = openStore(':memory:', { now: () => '2026-01-01T00:00:00.000Z' });
  const writers = createWriters(store);

  specs.forEach((spec, index) => {
    const raw = scryfallCard(spec, index);
    const card = ScryfallCardSchema.parse(raw);
    const context = {
      source: 'scryfall',
      bulkUpdatedAt: null,
      ingestedAt: store.now(),
      rawJson: JSON.stringify(raw),
    } as const;
    writers.oracleCard.run(toOracleCardRow(card, context));
    writers.printing.run(toPrintingRowInput(card, context));
  });

  return store;
}
