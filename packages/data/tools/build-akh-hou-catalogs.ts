/** Build the pinned AKH/HOU catalogs and products; this does not grant play admission. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parsePrintedLimitedFormat, serializedPrintedLimitedFormatContent } from '@mtg/printed-card';
import { formatJsonArtifact } from '../src/printed-card/format-build-files';
import { parsePrintedSourcePin } from '../src/printed-card/source-pin';
import { buildPrintedSetCatalog } from '../src/printed-card/set-catalog';
import { buildPrintedBoosterProduct } from '../src/printed-card/booster-product';

const { values } = parseArgs({
  options: {
    sources: { type: 'string' },
    'forge-scripts': { type: 'string' },
    'forge-version': { type: 'string' },
    out: { type: 'string' },
  },
  strict: true,
  allowPositionals: false,
});
if (!values.sources || !values['forge-scripts'] || !values['forge-version'] || !values.out) {
  throw new Error(
    'Usage: build-akh-hou-catalogs --sources <pin-directory> --forge-scripts <cardsfolder.zip> --forge-version <version> --out <new-directory>',
  );
}
const sourceRoot = resolve(values.sources);
const manifestBody = readFileSync(join(sourceRoot, 'sources.json'), 'utf8');
const pin = parsePrintedSourcePin(manifestBody, (file) => readFileSync(join(sourceRoot, file), 'utf8'));
if (pin.sources.map((source) => source.descriptor.code).join(',') !== 'AKH,HOU,MP2') {
  throw new Error('AKH/HOU build requires AKH,HOU,MP2 sources in pinned order');
}
const archive = resolve(values['forge-scripts']);
const archiveSha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
const paths = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  .trim()
  .split('\n');
const provenanceArtifact = 'akh-hou-printed-sources-v1.json';
const built = pin.sources.map((source) => ({
  source,
  ...buildPrintedSetCatalog(source, pin, provenanceArtifact, {
    version: values['forge-version']!,
    scriptFor: (card) => {
      // Installed Forge's punctuation convention differs from generated-card naming.
      // The builder verifies the actual Name lines after this candidate lookup.
      const filename = `${card.name
        .toLowerCase()
        .replace(/-/g, ' ')
        .replace(/[^a-z0-9\s]/g, '')
        .trim()
        .replace(/\s+/g, '_')}.txt`;
      const matches = paths.filter((path) => path.endsWith(`/${filename}`));
      if (matches.length !== 1) return null;
      return {
        path: matches[0]!,
        bytes: execFileSync('unzip', ['-p', archive, matches[0]!], { maxBuffer: 1024 * 1024 }),
      };
    },
  }),
}));
const products = built
  .filter(({ source }) => source.descriptor.code !== 'MP2')
  .map(({ source }) =>
    buildPrintedBoosterProduct(
      `${source.descriptor.code.toLowerCase()}-draft`,
      source.descriptor.code,
      source.document.data.booster['draft'],
      built.map((entry) => ({
        code: entry.source.descriptor.code,
        uuidToPhysicalId: entry.uuidToPhysicalId,
      })),
    ),
  );
const unsealed = parsePrintedLimitedFormat({
  schemaVersion: 1,
  kind: 'printed-limited-format',
  id: 'akh-hou',
  name: 'Amonkhet / Hour of Devastation',
  sources: built.map(({ source, catalog }) => ({
    code: source.descriptor.code,
    catalogFormat: catalog.format,
    catalogSha256: catalog.contentSha256,
    mtgjson: {
      url: source.descriptor.mtgjson.url,
      sha256: source.descriptor.mtgjson.sha256,
      version: source.document.meta.version,
    },
  })),
  products,
  draft: { seats: 8, rounds: ['hou-draft', 'hou-draft', 'akh-draft'], botPolicy: 'printed-limited-v1' },
  sealed: { boosters: ['hou-draft', 'hou-draft', 'hou-draft', 'hou-draft', 'akh-draft', 'akh-draft'] },
  basicLandPolicy: 'remove',
  contentSha256: '0'.repeat(64),
});
const format = parsePrintedLimitedFormat({
  ...unsealed,
  contentSha256: createHash('sha256').update(serializedPrintedLimitedFormatContent(unsealed)).digest('hex'),
});
const out = resolve(values.out);
mkdirSync(out); // Refuse replacing an existing artifact run.
const write = async (file: string, value: unknown) =>
  writeFileSync(join(out, file), await formatJsonArtifact(value, file), { flag: 'wx' });
// Preserve provenance bytes verbatim: catalogs bind this file's raw checksum.
writeFileSync(join(out, provenanceArtifact), manifestBody, { flag: 'wx' });
for (const entry of built)
  await write(`${entry.source.descriptor.code.toLowerCase()}-printed-catalog-v1.json`, entry.catalog);
await write('akh-hou-limited-format-v1.json', format);
await write('build-evidence.json', {
  schemaVersion: 1,
  status: 'catalog-only-not-play-admitted',
  forgeVersion: values['forge-version'],
  archiveSha256,
  catalogs: built.map(({ source, catalog }) => ({
    code: source.descriptor.code,
    cards: catalog.cards.length,
    contentSha256: catalog.contentSha256,
  })),
  formatSha256: format.contentSha256,
});
process.stdout.write(
  `Built ${built.reduce((sum, entry) => sum + entry.catalog.cards.length, 0)} exact printings; format ${format.contentSha256}\n`,
);
