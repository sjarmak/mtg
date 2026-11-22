import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parsePrintedCardCatalog,
  parsePrintedLimitedFormat,
  serializedPrintedCardCatalogContent,
  serializedPrintedLimitedFormatContent,
} from '@mtg/printed-card';
import { PrintedSourceManifestSchema } from '../src/printed-card/source-pin';

const read = (file: string) => readFileSync(new URL(`../data/akh-hou/${file}`, import.meta.url), 'utf8');
const digest = (body: string) => createHash('sha256').update(body).digest('hex');
const catalogs = ['akh', 'hou', 'mp2'].map((code) =>
  parsePrintedCardCatalog(JSON.parse(read(`${code}-printed-catalog-v1.json`))),
);
const format = parsePrintedLimitedFormat(JSON.parse(read('akh-hou-limited-format-v1.json')));

describe('pinned AKH/HOU printed artifacts', () => {
  it('accounts for all 550 exact printings with source, script, and content fingerprints', () => {
    const provenance = read('akh-hou-printed-sources-v1.json');
    const manifest = PrintedSourceManifestSchema.parse(JSON.parse(provenance));
    expect(catalogs.map((catalog) => catalog.cards.length)).toEqual([287, 209, 54]);
    for (const [index, catalog] of catalogs.entries()) {
      expect(catalog.source.provenanceSha256).toBe(digest(provenance));
      expect(catalog.source.scryfallBulkSha256).toBe(manifest.sources[index]?.scryfall.sha256);
      expect(catalog.contentSha256).toBe(digest(serializedPrintedCardCatalogContent(catalog)));
      expect(new Set(catalog.cards.map((card) => card.scryfallId)).size).toBe(catalog.cards.length);
      expect(catalog.cards.every((card) => /^[a-f0-9]{64}$/.test(card.forgeScriptSha256))).toBe(true);
      expect(catalog.cards.every((card) => card.art.status === 'available')).toBe(true);
    }
    expect(
      catalogs[0]?.cards.find((card) => card.name === 'Dusk // Dawn')?.faces.map((face) => face.name),
    ).toEqual(['Dusk', 'Dawn']);
  });

  it('pins the individual Limited recipes and every auxiliary sheet identity', () => {
    expect(format.draft.rounds).toEqual(['hou-draft', 'hou-draft', 'akh-draft']);
    expect(format.sealed.boosters).toEqual([
      'hou-draft',
      'hou-draft',
      'hou-draft',
      'hou-draft',
      'akh-draft',
      'akh-draft',
    ]);
    expect(format.contentSha256).toBe(digest(serializedPrintedLimitedFormatContent(format)));
    expect(format.sources.map((source) => source.catalogSha256)).toEqual(
      catalogs.map((catalog) => catalog.contentSha256),
    );
    const identities = new Set(catalogs.flatMap((catalog) => catalog.cards.map((card) => card.physicalId)));
    for (const product of format.products) {
      expect(product.sourceSetCodes).toEqual([product.setCode, 'MP2']);
      expect(product.collation.sheets.find((sheet) => sheet.name === 'common')?.balanceColors).toBe(true);
      expect(
        product.collation.sheets.every((sheet) =>
          Object.keys(sheet.weights).every((id) => identities.has(id)),
        ),
      ).toBe(true);
      expect(
        product.collation.sheets.some(
          (sheet) => sheet.foil && Object.keys(sheet.weights).some((id) => id.startsWith('mp2-printed-v1:')),
        ),
      ).toBe(true);
    }
  });
});
