/** Explicit, scoped acquisition through the existing rate-limited data client. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { InvalidInputError } from '../errors';
import type { HttpClient } from '../http/client';
import { PrintedSourceSetSchema } from './source-pin';
import { ScryfallCardSchema, type ScryfallCard } from '../scryfall/schemas';

const PageSchema = z.looseObject({
  object: z.literal('list'),
  data: z.array(ScryfallCardSchema).min(1),
  total_cards: z.number().int().positive(),
  has_more: z.boolean(),
  next_page: z.url().optional(),
});

function invalid(message: string): never {
  throw new InvalidInputError('printed set source', message);
}
function sha256(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}
async function text(client: HttpClient, url: string): Promise<string> {
  const { body } = await client.getStream(url);
  return new Response(body).text();
}

function checkPageUrl(value: string, query: string): void {
  const url = new URL(value);
  if (
    url.origin !== 'https://api.scryfall.com' ||
    url.pathname !== '/cards/search' ||
    url.username !== '' ||
    url.password !== '' ||
    url.searchParams.get('q') !== query
  ) {
    invalid(`unexpected pagination URL: ${value}`);
  }
}

async function fetchScryfallSearch(
  query: string,
  order: Readonly<Record<string, string>>,
  client: HttpClient,
  check: (card: ScryfallCard) => void,
) {
  const url = new URL('https://api.scryfall.com/cards/search');
  url.search = new URLSearchParams({
    q: query,
    unique: 'prints',
    include_extras: 'true',
    include_variations: 'true',
    ...order,
  }).toString();
  let next: string | undefined = url.href;
  let cards: ScryfallCard[] = [];
  let total: number | undefined;
  const visited = new Set<string>();
  const identities = new Set<string>();
  while (next !== undefined) {
    checkPageUrl(next, query);
    if (visited.has(next)) invalid('pagination cycle');
    visited.add(next);
    const page: z.infer<typeof PageSchema> = await client.getJson(next, PageSchema);
    if (total !== undefined && total !== page.total_cards) invalid('printing total changed between pages');
    total = page.total_cards;
    for (const card of page.data) {
      check(card);
      if (identities.has(card.id)) invalid(`duplicate printing: ${card.id}`);
      identities.add(card.id);
    }
    cards = [...cards, ...page.data];
    if (cards.length > total) invalid('printing total exceeded');
    if (page.has_more && page.next_page === undefined) invalid('missing next_page');
    next = page.has_more ? page.next_page : undefined;
  }
  if (cards.length !== total) invalid('incomplete printing total');
  const body = `${JSON.stringify(cards, null, 2)}\n`;
  return { url: url.href, sha256: sha256(body), body, cards };
}

/** Every English printing Scryfall lists for one set code, paged and checked; no MTGJSON. */
export async function fetchScryfallSetPrintings(code: string, client: HttpClient) {
  return fetchScryfallSearch(`set:${code.toLowerCase()} lang:en`, { order: 'set' }, client, (card) => {
    if (card.set !== code.toLowerCase() || card.lang !== 'en') invalid(`printing source drift: ${card.id}`);
  });
}

/**
 * Every English token printing Scryfall lists under one exact name, oldest
 * first, so a caller choosing one printing for a token script takes the
 * earliest that states the same token rather than the most recent reprint.
 * The name is quoted whole: `!"Elephant"` is the Elephant token and not
 * Elephant Guide.
 */
export async function fetchScryfallTokenPrintingsNamed(name: string, client: HttpClient) {
  const quoted = `!"${name.replaceAll('"', '')}"`;
  return fetchScryfallSearch(
    `${quoted} t:token lang:en`,
    { order: 'released', dir: 'asc' },
    client,
    (card) => {
      if (card.lang !== 'en') invalid(`token source drift: ${card.id}`);
    },
  );
}

/** Does not mutate the global Oracle store or the calibration reference corpus. */
export async function fetchPrintedSetSources(code: string, client: HttpClient) {
  if (!/^[A-Z0-9]{2,8}$/.test(code)) invalid(`invalid set code: ${code}`);
  const url = `https://mtgjson.com/api/v5/${code}.json`;
  const checksum = (await text(client, `${url}.sha256`)).trim();
  if (!/^[0-9a-f]{64}$/.test(checksum)) invalid('invalid publisher checksum');
  const body = await text(client, url);
  if (sha256(body) !== checksum) invalid(`MTGJSON checksum mismatch for ${code}`);
  const document = PrintedSourceSetSchema.parse(JSON.parse(body));
  if (document.data.code !== code) invalid(`MTGJSON source code mismatch for ${code}`);
  const scryfall = await fetchScryfallSetPrintings(code, client);
  return { code, mtgjson: { url, sha256: checksum, body, document }, scryfall };
}
