/**
 * `#305`: label every printing of a printed format with Limited card roles.
 *
 *   tsx packages/draft-export/tools/printed-roles/label.ts --format <id> --out <file> \
 *     --max-calls <n> [--record]
 *
 * `--max-calls` bounds live calls only; replayed recordings are free.
 *
 * A model reads each card's Oracle text through `@mtg/llm` and answers which of
 * `CARD_ROLES` it fills; this file owns the batching, the schema the answer
 * must satisfy and the assembly into a `printed-card-roles` file, and makes no
 * judgment about any card itself (ZFC). Every call goes through the fixture
 * transport over `FIXTURE_DIR`: a rerun reads what was recorded and spends
 * nothing, `--record` lets a missing answer go to the live backend and
 * records it, and without either a missing answer is an
 * error rather than a silent live call. `--out` and `--max-calls` have no
 * default, so no run writes anywhere or calls anything by omission.
 *
 * Batches are formed per catalog in source order over that catalog's distinct
 * printings, never across catalogs, so a block-mate catalog staged in two
 * format directories (ISD in `isd/` and `dka/`) asks byte-identical questions
 * and its second format is labeled from the first one's recordings.
 */
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  createBudgetGuard,
  FixtureMissingError,
  resolveProvider,
  toJsonSchema,
  type CompletionRequest,
  type CompletionResult,
} from '@mtg/llm';
import {
  parsePrintedCardCatalog,
  type PrintedCardCatalog,
  type PrintedCardCatalogEntry,
} from '@mtg/printed-card';
import {
  CARD_ROLES,
  printedSourceFingerprint,
  validatePrintedCardRoles,
  type CardRole,
  type PrintedCardRoles,
} from '../../src/index';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const DATA_ROOT = join(REPO_ROOT, 'packages/data/data');
export const FIXTURE_DIR = join(REPO_ROOT, 'packages/draft-export/fixtures/llm-card-roles');
export const BATCH_SIZE = 25;

/** Prompt text: rewording any of it re-keys every recorded fixture behind it. */
export const ROLE_SYSTEM_PROMPT = [
  'You classify Magic: The Gathering cards for a Limited (draft and sealed) deck evaluator.',
  'For each card, list every role it fills from this vocabulary, or none:',
  '"interaction": the card can remove, neutralize or answer an opposing creature, other permanent or spell.',
  'This includes destroying, exiling, dealing damage to or shrinking a target creature or the opposing creatures,',
  'fight and bite effects, returning an opposing permanent to hand, countering a spell, stealing a permanent,',
  'and Auras or effects that stop a creature attacking and blocking. Narrow or conditional answers still count.',
  'Damage only to players, graveyard exile, pump spells and combat tricks that only grant bonuses do not count.',
  '"draw": the card gains card advantage by drawing more cards than it costs, or by returning cards from a',
  'graveyard to hand. Cycling, and drawing that requires discarding as many cards, do not count.',
  '"fixing": the card produces or fetches mana of more than one color, such as dual lands, mana creatures',
  'or artifacts that add any color, and spells that search for basic lands.',
  'Judge from the rules text given. Answer for every card, using its id.',
].join(' ');

export interface RoleQuestion {
  readonly id: number;
  readonly name: string;
  readonly manaCost: string | null;
  readonly typeLine: string;
  readonly text: string | null;
  readonly faces?: readonly {
    name: string;
    manaCost: string | null;
    typeLine: string;
    text: string | null;
  }[];
}

export function roleQuestion(card: PrintedCardCatalogEntry, id: number): RoleQuestion {
  const base = { id, name: card.correctedName, manaCost: card.manaCost, typeLine: card.typeLine };
  if (card.faces.length === 1) return { ...base, text: card.oracleText ?? card.faces[0]!.oracleText };
  return {
    ...base,
    text: card.oracleText,
    faces: card.faces.map((face) => ({
      name: face.name,
      manaCost: face.manaCost,
      typeLine: face.typeLine,
      text: face.oracleText,
    })),
  };
}

const RoleAnswerSchema = z.strictObject({
  cards: z.array(z.strictObject({ id: z.number().int().positive(), roles: z.array(z.enum(CARD_ROLES)) })),
});

/** The answer must name each asked id exactly once; a retry is the provider's job. */
export function roleAnswerSchema(count: number) {
  return RoleAnswerSchema.superRefine((answer, context) => {
    const ids = answer.cards.map((card) => card.id).sort((left, right) => left - right);
    if (ids.length !== count || ids.some((id, index) => id !== index + 1))
      context.addIssue({
        code: 'custom',
        path: ['cards'],
        message: `answer each id 1..${count} exactly once`,
      });
  });
}

function canonicalRoles(roles: readonly CardRole[]): CardRole[] {
  return CARD_ROLES.filter((role) => roles.includes(role));
}

/** Distinct printings of one catalog in source order, keyed by source fingerprint. */
function distinctPrintings(catalog: PrintedCardCatalog): readonly PrintedCardCatalogEntry[] {
  const seen = new Set<number>();
  return catalog.cards.filter((card) => {
    const key = printedSourceFingerprint(card);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** One completion; the CLI replays a recording first and records only what is missing. */
export type Complete = <T>(request: CompletionRequest<T>) => Promise<CompletionResult<T>>;

export async function labelCatalog(
  catalog: PrintedCardCatalog,
  complete: Complete,
  models: Set<string>,
): Promise<ReadonlyMap<number, readonly CardRole[]>> {
  const labels = new Map<number, readonly CardRole[]>();
  const printings = distinctPrintings(catalog);
  for (let start = 0; start < printings.length; start += BATCH_SIZE) {
    const batch = printings.slice(start, start + BATCH_SIZE);
    const { value, meta } = await complete({
      system: ROLE_SYSTEM_PROMPT,
      prompt: JSON.stringify({ cards: batch.map((card, index) => roleQuestion(card, index + 1)) }),
      schema: roleAnswerSchema(batch.length),
    });
    models.add(meta.model);
    for (const answer of value.cards)
      labels.set(printedSourceFingerprint(batch[answer.id - 1]!), canonicalRoles(answer.roles));
  }
  return labels;
}

export function rolePromptSha256(): string {
  const schema = toJsonSchema(RoleAnswerSchema);
  return createHash('sha256')
    .update(JSON.stringify([ROLE_SYSTEM_PROMPT, schema]))
    .digest('hex');
}

export async function labelFormat(
  formatId: string,
  catalogs: readonly { readonly code: string; readonly catalog: PrintedCardCatalog }[],
  complete: Complete,
): Promise<PrintedCardRoles> {
  const labeled = [];
  const models = new Set<string>();
  for (const { code, catalog } of catalogs) {
    const labels = await labelCatalog(catalog, complete, models);
    labeled.push({
      code,
      catalogSha256: catalog.contentSha256,
      cards: catalog.cards.map((card) => {
        const roles = labels.get(printedSourceFingerprint(card));
        if (roles === undefined) throw new Error(`${card.correctedName} was not labeled`);
        return {
          physicalId: card.physicalId,
          sourceFingerprint: printedSourceFingerprint(card),
          roles: [...roles],
        };
      }),
    });
  }
  if (models.size !== 1) throw new Error(`labels came from ${models.size} models: ${[...models].join(', ')}`);
  return validatePrintedCardRoles(
    {
      schemaVersion: 1,
      kind: 'printed-card-roles',
      formatId,
      source: {
        kind: 'model-oracle-reading',
        model: [...models][0]!,
        promptSha256: rolePromptSha256(),
        vocabulary: [...CARD_ROLES],
      },
      catalogs: labeled,
    },
    catalogs,
  );
}

const RegistrySchema = z.object({
  formats: z.array(
    z.object({
      id: z.string(),
      formatFile: z.string(),
      catalogs: z.array(z.object({ code: z.string(), file: z.string() })),
    }),
  ),
});

export function loadFormatCatalogs(formatId: string) {
  const registry = RegistrySchema.parse(
    JSON.parse(readFileSync(join(DATA_ROOT, 'printed-formats-v1.json'), 'utf8')),
  );
  const format = registry.formats.find((candidate) => candidate.id === formatId);
  if (format === undefined) throw new Error(`unknown printed format ${formatId}`);
  return format.catalogs.map(({ code, file }) => ({
    code,
    catalog: parsePrintedCardCatalog(JSON.parse(readFileSync(join(DATA_ROOT, formatId, file), 'utf8'))),
  }));
}

export interface LabelArgs {
  readonly formatId: string;
  readonly out: string;
  readonly maxCalls: number;
  readonly record: boolean;
}

export function parseLabelArgs(argv: readonly string[]): LabelArgs {
  const values = new Map<string, string>();
  let record = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (flag === '--record') {
      record = true;
      continue;
    }
    if (!['--format', '--out', '--max-calls'].includes(flag)) throw new Error(`unknown flag ${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    if (values.has(flag)) throw new Error(`${flag} may be given only once`);
    values.set(flag, value);
    index += 1;
  }
  const formatId = values.get('--format');
  if (formatId === undefined || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(formatId))
    throw new Error('--format needs a printed format id');
  const out = values.get('--out');
  if (out === undefined) throw new Error('--out is required');
  const maxCalls = Number(values.get('--max-calls'));
  if (!Number.isInteger(maxCalls) || maxCalls <= 0) throw new Error('--max-calls needs a positive integer');
  return { formatId, out, maxCalls, record };
}

export async function main(argv: readonly string[]): Promise<void> {
  const args = parseLabelArgs(argv);
  const catalogs = loadFormatCatalogs(args.formatId);
  const budget = createBudgetGuard({ maxCalls: args.maxCalls });
  const replay = resolveProvider({ provider: 'fixture', fixture: { dir: FIXTURE_DIR, record: false } });
  const recorder = args.record
    ? resolveProvider({ provider: 'fixture', budget, fixture: { dir: FIXTURE_DIR, record: true } })
    : undefined;
  const complete: Complete = async (request) => {
    try {
      return await replay.complete(request);
    } catch (error: unknown) {
      if (!(error instanceof FixtureMissingError) || recorder === undefined) throw error;
      return recorder.complete(request);
    }
  };
  const roles = await labelFormat(args.formatId, catalogs, complete);
  const temporary = `${args.out}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(roles, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  renameSync(temporary, args.out);
  const counts = new Map<string, number>();
  for (const card of roles.catalogs.flatMap((catalog) => catalog.cards))
    for (const role of card.roles) counts.set(role, (counts.get(role) ?? 0) + 1);
  process.stdout.write(
    `${args.out} (${budget.snapshot().calls} live calls) ${JSON.stringify(Object.fromEntries(counts))}\n`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
