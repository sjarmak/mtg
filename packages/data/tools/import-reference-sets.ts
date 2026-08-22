#!/usr/bin/env -S npx tsx
/** Materialize all pinned MTGJSON reference sets as one normalized artifact. */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { format } from 'prettier';
import {
  REFERENCE_CORPUS_PATH,
  REFERENCE_SET_SOURCES,
  buildReferenceCorpus,
  describeError,
  fetchReferenceSetSources,
  writeReferenceCorpus,
  type ReferenceSourceBytes,
} from '../src/index';
import { flagString, parseArgs } from '../src/cli/args';

const DEFAULT_REFERENCE_CACHE = 'data/cache/mtgjson/reference-sets/5.3.0+20260814';

async function sourcesFromDirectory(path: string): Promise<ReferenceSourceBytes[]> {
  return Promise.all(
    REFERENCE_SET_SOURCES.map(async (source) => ({
      source,
      bytes: await readFile(`${path}/${source.code}.json`),
    })),
  );
}

export async function runImportReferenceSets(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv, {
    valued: ['cache', 'input', 'output'],
    boolean: [],
  });
  const input = args.flags['input'];
  const sources =
    typeof input === 'string'
      ? await sourcesFromDirectory(input)
      : await fetchReferenceSetSources(REFERENCE_SET_SOURCES, {
          cacheDir: flagString(args, 'cache', DEFAULT_REFERENCE_CACHE),
        });
  const corpus = buildReferenceCorpus(sources);
  const output = flagString(args, 'output', REFERENCE_CORPUS_PATH);
  await writeReferenceCorpus(output, corpus, {
    format: (json) => format(json, { parser: 'json', printWidth: 110 }),
  });

  console.log(`MTGJSON ${corpus.source.version} (${corpus.source.builtDate})`);
  for (const set of corpus.sets) {
    console.log(
      `${set.code}: ${set.mainSetSize} main positions, ${set.cards.length} card-face records, ` +
        `${set.tokens.length} tokens, ${Object.keys(set.draftBooster.sheets).length} draft sheets`,
    );
  }
  console.log(`wrote ${output}`);
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(invoked).href) {
  runImportReferenceSets(process.argv.slice(2)).catch((error: unknown) => {
    console.error(describeError(error));
    process.exitCode = 1;
  });
}
