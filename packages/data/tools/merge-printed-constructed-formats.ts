import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parsePrintedConstructedFormat } from '@mtg/printed-card';
import { mergePrintedConstructedFormats } from '../src/printed-card/merge-constructed-format';

const usage =
  'Usage: merge-printed-constructed-formats --format <path to printed-constructed-format.json> --format <path> [...] --id <merged format id> --name <merged format name> --out <new format.json>';
const { values } = parseArgs({
  options: {
    help: { type: 'boolean', short: 'h' },
    format: { type: 'string', multiple: true },
    id: { type: 'string' },
    name: { type: 'string' },
    out: { type: 'string' },
  },
  strict: true,
  allowPositionals: false,
});
if (values.help) {
  process.stdout.write(`${usage}\n`);
  process.exit(0);
}
const formatPaths = values.format ?? [];
if (formatPaths.length < 2 || !values.id || !values.name || !values.out) throw new Error(usage);

const formats = formatPaths.map((path) =>
  parsePrintedConstructedFormat(JSON.parse(readFileSync(path, 'utf8'))),
);
const merged = mergePrintedConstructedFormats(formats, { id: values.id, name: values.name });
writeFileSync(values.out, `${JSON.stringify(merged, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(
  `${JSON.stringify({ merged: values.out, sourceCodes: merged.sources.map((source) => source.code), deckIds: merged.decks.map((deck) => deck.id) })}\n`,
);
