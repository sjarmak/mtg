import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createBudgetGuard, resolveProvider, type LlmProvider } from '@mtg/llm';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import { format as prettierFormat, resolveConfig } from 'prettier';
import { z } from 'zod';
import {
  printedArchetypeListForPoolSchema,
  validatePrintedArchetypeList,
  type PrintedArchetypeList,
  type PrintedArchetypePoolCard,
} from '../src/printed-card/archetypes';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_ROOT = join(PACKAGE_ROOT, 'data');

const RegistrySchema = z.strictObject({
  schemaVersion: z.literal(1),
  formats: z.array(
    z
      .strictObject({
        id: z.string().min(1),
        availability: z.object({ draft: z.string() }).passthrough(),
        catalogs: z.array(
          z.strictObject({ code: z.string().min(1), name: z.string().min(1), file: z.string().min(1) }),
        ),
      })
      .passthrough(),
  ),
});

export interface RefreshPrintedArchetypesOptions {
  readonly formatId: string;
  readonly maxUsd: number;
}

export function parseRefreshPrintedArchetypesArgs(argv: readonly string[]): RefreshPrintedArchetypesOptions {
  const values = new Map<string, string>();
  const allowed = new Set(['--format', '--max-usd']);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || !allowed.has(flag)) throw new Error(`unknown flag ${flag ?? ''}`);
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    if (values.has(flag)) throw new Error(`${flag} may be given only once`);
    values.set(flag, value);
  }
  const formatId = values.get('--format');
  if (formatId === undefined || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(formatId)) {
    throw new Error('--format needs a printed format id');
  }
  const rawMaxUsd = values.get('--max-usd');
  if (rawMaxUsd === undefined) throw new Error('--max-usd is required');
  const maxUsd = Number(rawMaxUsd);
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error('--max-usd must be a positive number');
  return { formatId, maxUsd };
}

export async function generatePrintedArchetypes(
  formatId: string,
  setNames: readonly string[],
  cards: readonly PrintedArchetypePoolCard[],
  provider: LlmProvider,
): Promise<PrintedArchetypeList> {
  const schema = printedArchetypeListForPoolSchema(formatId, cards);
  const system = [
    'You identify the published draft archetypes for an official Magic: The Gathering draft format.',
    'Use the set design and published Limited archetypes, not an invented exhaustive color-pair grid.',
    'Return the number of archetypes the format actually published.',
    'Each archetype needs one representative signpost from the supplied physical card pool.',
    'For wedge, shard, faction, or typal formats, preserve those published identities.',
  ].join(' ');
  const prompt = JSON.stringify({
    formatId,
    sets: setNames,
    task: 'Name each published draft archetype, its colors, one exact signpost, and a one-sentence plan.',
    cards,
  });
  const { value } = await provider.complete({ system, prompt, schema });
  return validatePrintedArchetypeList(value, cards);
}

function loadFormat(formatId: string) {
  const registry = RegistrySchema.parse(
    JSON.parse(readFileSync(join(DATA_ROOT, 'printed-formats-v1.json'), 'utf8')),
  );
  const format = registry.formats.find((candidate) => candidate.id === formatId);
  if (format === undefined) throw new Error(`unknown printed format ${formatId}`);
  if (format.availability.draft !== 'available') throw new Error(`${formatId} is not draft-available`);
  const cards = format.catalogs.flatMap((catalog) =>
    parsePrintedCardCatalog(
      JSON.parse(readFileSync(join(DATA_ROOT, format.id, catalog.file), 'utf8')),
    ).cards.map((card) => ({ physicalId: card.physicalId, name: card.name })),
  );
  return { format, cards };
}

async function writeArtifact(path: string, value: PrintedArchetypeList): Promise<void> {
  const config = await resolveConfig(path);
  const bytes = await prettierFormat(JSON.stringify(value), { ...config, filepath: path });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, bytes, { encoding: 'utf8', flag: 'wx' });
  renameSync(temporary, path);
}

export async function main(argv: readonly string[]): Promise<void> {
  const options = parseRefreshPrintedArchetypesArgs(argv);
  const { format, cards } = loadFormat(options.formatId);
  const provider = resolveProvider({ budget: createBudgetGuard({ maxUsd: options.maxUsd }) });
  const list = await generatePrintedArchetypes(
    format.id,
    format.catalogs.map((catalog) => catalog.name),
    cards,
    provider,
  );
  const output = join(DATA_ROOT, format.id, 'archetypes-v1.json');
  await writeArtifact(output, list);
  process.stdout.write(`${output}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
