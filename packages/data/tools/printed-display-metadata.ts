/** Emit display-only facts from verified local snapshots without rewriting catalogs. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parsePrintedCardCatalog, validatePrintedDisplayMetadata } from '@mtg/printed-card';
import { parsePrintedSourcePin } from '../src/printed-card/source-pin';

const { values } = parseArgs({
  options: { sources: { type: 'string' }, catalog: { type: 'string', multiple: true } },
  strict: true,
});
if (!values.sources || !values.catalog?.length) {
  throw new Error(
    'Usage: printed-display-metadata --sources <pin-directory> --catalog <catalog.json> [--catalog ...]',
  );
}
const root = values.sources;
const pin = parsePrintedSourcePin(readFileSync(join(root, 'sources.json'), 'utf8'), (file) =>
  readFileSync(join(root, file), 'utf8'),
);
const catalogs = values.catalog.map((file) =>
  parsePrintedCardCatalog(JSON.parse(readFileSync(file, 'utf8'))),
);
const metadata = validatePrintedDisplayMetadata(
  {
    schemaVersion: 1,
    catalogs: catalogs.map((catalog) => {
      const source = pin.sources.find(
        (row) => row.descriptor.scryfall.sha256 === catalog.source.scryfallBulkSha256,
      );
      if (!source) throw new Error(`Missing pinned source for ${catalog.format}`);
      const printings = new Map(source.cards.map((card) => [card.id, card]));
      return {
        catalogSha256: catalog.contentSha256,
        sourceSha256: source.descriptor.scryfall.sha256,
        rarities: Object.fromEntries(
          catalog.cards.map((card) => {
            const printing = printings.get(card.scryfallId);
            if (!printing || printing.oracle_id !== card.oracleId || printing.name !== card.name) {
              throw new Error(`Printing identity mismatch: ${card.physicalId}`);
            }
            return [card.physicalId, printing.rarity];
          }),
        ),
      };
    }),
  },
  catalogs,
);
process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
