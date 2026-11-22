import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createHttpClient } from '../src/http/client';
import { fetchPrintedSetSources, fetchScryfallTokenPrintingsNamed } from '../src/printed-card/source-fetch';
import { FIXTURES } from './helpers';

const card = { ...JSON.parse(readFileSync(FIXTURES.oracleCards, 'utf8').split('\n')[0]!), set: 'akh' };
const mtgjson = JSON.stringify({
  meta: { date: '2026-09-11', version: '5.3.0' },
  data: {
    code: 'AKH',
    name: 'Amonkhet',
    baseSetSize: 1,
    totalSetSize: 1,
    releaseDate: '2017-04-28',
    type: 'expansion',
    cards: [{ uuid: card.id, name: card.name, number: '1', rarity: 'common', setCode: 'AKH' }],
  },
});
const hash = createHash('sha256').update(mtgjson).digest('hex');
const page = (data: unknown[], total = data.length, next?: string) =>
  JSON.stringify({
    object: 'list',
    data,
    total_cards: total,
    has_more: next !== undefined,
    ...(next === undefined ? {} : { next_page: next }),
  });

function clientFor(responses: string[], requests: string[] = []) {
  let index = 0;
  return createHttpClient({
    limiter: { acquire: async () => {}, penalize: () => {} },
    maxRetries: 0,
    fetchImpl: (async (url) => {
      requests.push(String(url));
      const response = responses[index++];
      if (response === undefined) throw new Error('unexpected request');
      return new Response(response);
    }) as typeof fetch,
  });
}

describe('scoped printed set source acquisition', () => {
  it('pins publisher-verified MTGJSON bytes and all exact Scryfall printings across pages', async () => {
    const next = 'https://api.scryfall.com/cards/search?q=set%3Aakh+lang%3Aen&page=2';
    const other = { ...card, id: '00000000-0000-0000-0000-000000000002' };
    const requests: string[] = [];
    const result = await fetchPrintedSetSources(
      'AKH',
      clientFor([hash, mtgjson, page([card], 2, next), page([other], 2)], requests),
    );
    expect(result.mtgjson.sha256).toBe(hash);
    expect(result.mtgjson.body).toBe(mtgjson);
    expect(result.scryfall.cards.map((entry) => entry.id)).toEqual([card.id, other.id]);
    expect(result.scryfall.cards[0]?.oracle_id).toBe(result.scryfall.cards[1]?.oracle_id);
    expect(result.scryfall.sha256).toBe(createHash('sha256').update(result.scryfall.body).digest('hex'));
    expect(requests).toHaveLength(4);
    expect(result.mtgjson.document.data.booster).toEqual({});
  });

  it('rejects checksum and source identity drift before fetching card metadata', async () => {
    await expect(fetchPrintedSetSources('AKH', clientFor(['0'.repeat(64), mtgjson]))).rejects.toThrow(
      /checksum/,
    );
    await expect(fetchPrintedSetSources('HOU', clientFor([hash, mtgjson]))).rejects.toThrow(/source code/);
    await expect(fetchPrintedSetSources('../akh', clientFor([]))).rejects.toThrow(/set code/);
  });

  it.each([
    [page([card], 1, 'https://example.com/private'), /pagination URL/],
    [page([{ ...card, set: 'hou' }]), /printing source/],
    [page([card, card]), /duplicate printing/],
    [page([card], 2), /total/],
    [JSON.stringify({ object: 'list', data: [card], total_cards: 2, has_more: true }), /next_page/],
  ])('refuses invalid or incomplete card pages', async (body, error) => {
    await expect(fetchPrintedSetSources('AKH', clientFor([hash, mtgjson, body as string]))).rejects.toThrow(
      error as RegExp,
    );
  });
});

describe('named token printing search', () => {
  it('asks Scryfall for the oldest printing first, so the earliest reprint is the one taken', async () => {
    const requests: string[] = [];
    await fetchScryfallTokenPrintingsNamed('Elephant', clientFor([page([card])], requests));
    const url = new URL(requests[0]!);
    expect(url.searchParams.get('q')).toBe('!"Elephant" t:token lang:en');
    expect(url.searchParams.get('order')).toBe('released');
    expect(url.searchParams.get('dir')).toBe('asc');
  });
});
