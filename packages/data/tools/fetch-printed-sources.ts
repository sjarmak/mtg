/** Opt-in acquisition; emits scoped snapshots, never overwrites an existing run. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createHttpClient } from '../src/http/client';
import { fetchPrintedSetSources } from '../src/printed-card/source-fetch';

const { values } = parseArgs({
  options: { out: { type: 'string' }, sets: { type: 'string' } },
  strict: true,
  allowPositionals: false,
});
if (values.out === undefined || values.sets === undefined) {
  throw new Error('Usage: fetch-printed-sources --out <new-directory> --sets AKH,HOU,MP2');
}
const codes = values.sets.split(',');
if (
  codes.length === 0 ||
  new Set(codes).size !== codes.length ||
  codes.some((code) => !/^[A-Z0-9]{2,8}$/.test(code))
) {
  throw new Error('--sets must contain unique uppercase set codes');
}
const out = resolve(values.out);
await mkdir(out); // EEXIST intentionally refuses replacing an earlier pin.
const client = createHttpClient({
  fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(60_000) }),
});
const sources = [];
for (const code of codes) {
  const source = await fetchPrintedSetSources(code, client);
  const mtgjsonFile = `${code}-${source.mtgjson.sha256}.mtgjson.json`;
  const scryfallFile = `${code}-${source.scryfall.sha256}.scryfall.json`;
  await writeFile(join(out, mtgjsonFile), source.mtgjson.body, { flag: 'wx' });
  await writeFile(join(out, scryfallFile), source.scryfall.body, { flag: 'wx' });
  sources.push({
    code,
    mtgjson: {
      file: mtgjsonFile,
      url: source.mtgjson.url,
      sha256: source.mtgjson.sha256,
      meta: source.mtgjson.document.meta,
    },
    scryfall: {
      file: scryfallFile,
      url: source.scryfall.url,
      sha256: source.scryfall.sha256,
      cards: source.scryfall.cards.length,
    },
  });
  process.stdout.write(
    `${code}: ${source.mtgjson.document.data.cards.length} MTGJSON rows, ${source.scryfall.cards.length} exact Scryfall printings\n`,
  );
}
await writeFile(
  join(out, 'sources.json'),
  `${JSON.stringify({ schemaVersion: 1, fetchedAt: new Date().toISOString(), sources }, null, 2)}\n`,
  { flag: 'wx' },
);
