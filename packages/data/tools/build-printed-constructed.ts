import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parsePrintedCardCatalog, parsePrintedLimitedFormat } from '@mtg/printed-card';
import { parsePrintedArchetypeList } from '../src/printed-card/archetypes';
import {
  buildPrintedConstructedCandidate,
  finalizePrintedConstructedFormat,
  forgeCompletionResults,
  type PrintedConstructedArtifactInput,
} from '../src/printed-card/constructed-pipeline';

const { values } = parseArgs({
  options: {
    format: { type: 'string' },
    artifacts: { type: 'string' },
    receipt: { type: 'string' },
    out: { type: 'string' },
    candidate: { type: 'boolean', default: false },
  },
  strict: true,
  allowPositionals: false,
});

if (!values.format || !values.artifacts || !values.out) {
  throw new Error(
    'usage: build-printed-constructed --format <id> --artifacts <directory> --out <file> (--candidate | --receipt <file>)',
  );
}
if (values.candidate === (values.receipt !== undefined)) {
  throw new Error('choose exactly one of --candidate or --receipt');
}
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(values.format)) throw new Error('invalid format id');

const dataRoot = resolve('packages/data/data');
const registry = JSON.parse(readFileSync(join(dataRoot, 'printed-formats-v1.json'), 'utf8')) as {
  readonly formats: readonly {
    readonly id: string;
    readonly formatFile: string;
    readonly admissionDirectory?: string;
    readonly catalogs: readonly { readonly code: string; readonly file: string }[];
  }[];
};
const registered = registry.formats.find((format) => format.id === values.format);
if (registered === undefined) throw new Error(`printed format ${values.format} is not registered`);
if (registered.admissionDirectory === undefined) throw new Error(`${values.format} has no Forge admission`);
const directory = join(dataRoot, registered.id);
const limited = parsePrintedLimitedFormat(
  JSON.parse(readFileSync(join(directory, registered.formatFile), 'utf8')),
);
const catalogs = registered.catalogs.map((source) => ({
  code: source.code,
  cards: parsePrintedCardCatalog(JSON.parse(readFileSync(join(directory, source.file), 'utf8'))).cards,
}));
const archetypes = parsePrintedArchetypeList(
  JSON.parse(readFileSync(join(directory, 'archetypes-v1.json'), 'utf8')),
);
const admission = JSON.parse(
  readFileSync(join(directory, registered.admissionDirectory, 'admission.json'), 'utf8'),
) as { readonly cards?: readonly { readonly id?: unknown; readonly review?: unknown }[] };
const admittedPhysicalIds = new Set(
  (admission.cards ?? []).flatMap((card) =>
    typeof card.id === 'string' && card.review === 'reviewed' ? [card.id] : [],
  ),
);
const artifactRoot = resolve(values.artifacts);
const artifacts: PrintedConstructedArtifactInput[] = archetypes.archetypes.map((archetype) => {
  try {
    return {
      archetypeId: archetype.id,
      status: 'loaded',
      value: JSON.parse(readFileSync(join(artifactRoot, `${archetype.id}.json`), 'utf8')),
    };
  } catch (error) {
    return {
      archetypeId: archetype.id,
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
});
const candidate = buildPrintedConstructedCandidate({
  id: limited.id,
  name: limited.name,
  sources: limited.sources,
  archetypes,
  catalogs,
  admittedPhysicalIds,
  artifacts,
});
for (const result of candidate.results) process.stderr.write(`${JSON.stringify(result)}\n`);
if (candidate.format === null) throw new Error('no deck passed structural validation');

const format = values.candidate
  ? candidate.format
  : finalizePrintedConstructedFormat(
      candidate,
      forgeCompletionResults(candidate.format, JSON.parse(readFileSync(resolve(values.receipt!), 'utf8'))),
    );
const output = resolve(values.out);
if (dirname(output) === output) throw new Error('output must name a file');
writeFileSync(output, `${JSON.stringify(format, null, 2)}\n`);
process.stdout.write(`${output}\n`);
