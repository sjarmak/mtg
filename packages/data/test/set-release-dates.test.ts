import { describe, expect, it } from 'vitest';
import { readSetReleaseDates } from '../src/printed-card/set-release-dates';
import { memoryStore } from './helpers';

function printing(scryfallId: string, setCode: string, releasedAt: string | null): Record<string, unknown> {
  return {
    scryfall_id: scryfallId,
    oracle_id: `oracle-${scryfallId}`,
    source: 'scryfall',
    set_code: setCode,
    collector_number: '1',
    rarity: 'common',
    released_at: releasedAt,
    lang: 'en',
    raw_json: '{}',
    ingested_at: '2026-08-09T12:00:00.000Z',
  };
}

describe('set release dates read off the printings', () => {
  it('answers the earliest dated printing per set, in upper case, and null for a set it has not got', () => {
    const store = memoryStore();
    const insert = store.db.prepare(
      `INSERT INTO printing (scryfall_id, oracle_id, source, set_code, collector_number, rarity, released_at, lang, raw_json, ingested_at)
       VALUES (@scryfall_id, @oracle_id, @source, @set_code, @collector_number, @rarity, @released_at, @lang, @raw_json, @ingested_at)`,
    );
    insert.run(printing('a', 'AKH', '2017-04-28'));
    insert.run(printing('b', 'AKH', '2017-05-01'));
    insert.run(printing('c', 'HOU', null));
    insert.run(printing('d', 'HOU', '2017-07-14'));
    insert.run(printing('e', 'XLN', null));

    expect(readSetReleaseDates(store.db, ['akh', 'HOU', 'XLN', 'MP2'])).toEqual({
      schemaVersion: 1,
      releaseDates: { AKH: '2017-04-28', HOU: '2017-07-14', XLN: null, MP2: null },
    });
  });
});
