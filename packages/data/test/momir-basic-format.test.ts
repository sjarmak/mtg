import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parsePrintedCardCatalog,
  parsePrintedConstructedFormat,
  serializedPrintedCardCatalogContent,
  serializedPrintedConstructedFormatContent,
} from '@mtg/printed-card';
import { createHash } from 'node:crypto';

const root = join(process.cwd(), 'packages/data/data/momir-basic');
const format = parsePrintedConstructedFormat(
  JSON.parse(readFileSync(join(root, 'momir-basic-constructed-format-v1.json'), 'utf8')),
);
const catalog = parsePrintedCardCatalog(
  JSON.parse(readFileSync(join(root, 'm11-printed-catalog-v1.json'), 'utf8')),
);
const digest = (body: string): string => createHash('sha256').update(body).digest('hex');

describe('Momir Basic printed format', () => {
  it('binds a fixed five-basic deck to the exact M11 catalog', () => {
    expect(format.rules).toEqual({ variant: 'momir', startingLife: 24 });
    expect(format.decks).toHaveLength(1);
    expect(format.decks[0]?.commanders).toEqual([]);
    expect(format.decks[0]?.cards.map(({ name, count }) => [name, count])).toEqual([
      ['Plains', 12],
      ['Island', 12],
      ['Swamp', 12],
      ['Mountain', 12],
      ['Forest', 12],
    ]);
    expect(format.sources[0]?.catalogSha256).toBe(catalog.contentSha256);
    expect(digest(serializedPrintedConstructedFormatContent(format))).toBe(format.contentSha256);
    expect(digest(serializedPrintedCardCatalogContent(catalog))).toBe(catalog.contentSha256);
  });
});
