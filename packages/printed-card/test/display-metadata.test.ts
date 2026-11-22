import { expect, it } from 'vitest';
import { validatePrintedDisplayMetadata } from '../src/display-metadata';
import { parsePrintedCardCatalog } from '../src/artifact';
import akh from '../../data/data/akh-hou/akh-printed-catalog-v1.json';
import hou from '../../data/data/akh-hou/hou-printed-catalog-v1.json';
import mp2 from '../../data/data/akh-hou/mp2-printed-catalog-v1.json';
import actual from '../../data/data/akh-hou/akh-hou-display-metadata-v1.json';

const catalog = parsePrintedCardCatalog(akh);
const metadata = {
  schemaVersion: 1,
  catalogs: [
    {
      catalogSha256: catalog.contentSha256,
      sourceSha256: catalog.source.scryfallBulkSha256,
      rarities: Object.fromEntries(catalog.cards.map((card) => [card.physicalId, 'common'])),
    },
  ],
};
it('requires exact catalog/source identity and complete physical printing coverage', () => {
  expect(validatePrintedDisplayMetadata(metadata, [catalog])).toEqual(metadata);
  expect(() =>
    validatePrintedDisplayMetadata(metadata, [{ ...catalog, contentSha256: '0'.repeat(64) }]),
  ).toThrow();
  expect(() =>
    validatePrintedDisplayMetadata(
      { ...metadata, catalogs: [{ ...metadata.catalogs[0], sourceSha256: '0'.repeat(64) }] },
      [catalog],
    ),
  ).toThrow();
  expect(() =>
    validatePrintedDisplayMetadata({ ...metadata, catalogs: [{ ...metadata.catalogs[0], rarities: {} }] }, [
      catalog,
    ]),
  ).toThrow();
  expect(() =>
    validatePrintedDisplayMetadata(
      {
        ...metadata,
        catalogs: [
          { ...metadata.catalogs[0], rarities: { ...metadata.catalogs[0]!.rarities, fake: 'rare' } },
        ],
      },
      [catalog],
    ),
  ).toThrow();
});
it('rejects invented rarity values', () => {
  expect(() =>
    validatePrintedDisplayMetadata(
      {
        ...metadata,
        catalogs: [
          {
            ...metadata.catalogs[0],
            rarities: { ...metadata.catalogs[0]!.rarities, [catalog.cards[0]!.physicalId]: 'bomb' },
          },
        ],
      },
      [catalog],
    ),
  ).toThrow();
});
it('accounts for all 550 pinned printings including off-booster cards and Invocations', () => {
  const catalogs = [akh, hou, mp2].map(parsePrintedCardCatalog);
  const display = validatePrintedDisplayMetadata(actual, catalogs);
  expect(display.catalogs.flatMap((row) => Object.keys(row.rarities))).toHaveLength(550);
  const rarity = (name: string) => {
    const card = catalogs.flatMap((row) => row.cards).find((card) => card.name === name)!;
    return display.catalogs
      .flatMap((row) => Object.entries(row.rarities))
      .find(([id]) => id === card.physicalId)?.[1];
  };
  expect(rarity('Angel of Sanctions')).toBe('mythic');
  expect(rarity('Dusk // Dawn')).toBe('rare');
});
