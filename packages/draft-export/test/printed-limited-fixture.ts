import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  parsePrintedCardCatalog,
  parsePrintedLimitedFormat,
  serializedPrintedCardCatalogContent,
  serializedPrintedLimitedFormatContent,
} from '@mtg/printed-card';

const legacy: unknown = JSON.parse(
  readFileSync(new URL('../../data/data/legacy-cube-2021-card-catalog-v1.json', import.meta.url), 'utf8'),
);
const template = parsePrintedCardCatalog(legacy);
export const digest = async (text: string): Promise<string> =>
  createHash('sha256').update(text).digest('hex');
const hash = 'a'.repeat(64);

export async function printedFixture() {
  const catalogs = await Promise.all(
    ['AKH', 'HOU', 'MP2'].map(async (code) => {
      const card = template.cards[0]!;
      const catalog = parsePrintedCardCatalog({
        ...template,
        format: code,
        cards: [{ ...card, position: 1, physicalId: `${code}:0001:${card.scryfallId}` }],
      });
      return { ...catalog, contentSha256: await digest(serializedPrintedCardCatalogContent(catalog)) };
    }),
  );
  const sources = catalogs.map((catalog) => ({
    code: catalog.format,
    catalogFormat: catalog.format,
    catalogSha256: catalog.contentSha256,
    mtgjson: {
      url: `https://mtgjson.com/api/v5/${catalog.format}.json`,
      sha256: hash,
      version: 'fixture-v1',
    },
  }));
  const products = ['AKH', 'HOU'].map((code) => ({
    id: code,
    setCode: code,
    sourceSetCodes: [code, 'MP2'],
    collation: {
      sheets: [
        {
          name: 'common',
          weights: { [catalogs.find((c) => c.format === code)!.cards[0]!.physicalId]: 1 },
          foil: false,
        },
        { name: 'foil', weights: { [catalogs[2]!.cards[0]!.physicalId]: 1 }, foil: true },
      ],
      boosters: [{ contents: { common: 1, foil: 1 }, weight: 1 }],
    },
  }));
  const format = parsePrintedLimitedFormat({
    schemaVersion: 1,
    kind: 'printed-limited-format',
    id: 'akh-hou',
    name: 'AKH/HOU fixture',
    sources,
    products,
    draft: { seats: 2, rounds: ['HOU', 'HOU', 'AKH'], botPolicy: 'fixture-v1' },
    sealed: { boosters: ['HOU', 'HOU', 'HOU', 'HOU', 'AKH', 'AKH'] },
    basicLandPolicy: 'remove',
    contentSha256: hash,
  });
  return {
    catalogs,
    format: { ...format, contentSha256: await digest(serializedPrintedLimitedFormatContent(format)) },
  };
}
