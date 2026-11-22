/**
 * Measures a generated set against the capabilities its format states, and
 * writes the block the Analysis tab renders.
 *
 * ```
 * npx tsx packages/cube/tools/analysis-claims.ts \
 *   --set out/XMP/set.json --criteria data/formats/xmp.json --out out/claims.json
 * npm run analyze -- out/XMP/set.json --claims out/claims.json
 * ```
 *
 * It exists as a file-writing tool rather than as a call inside `npm run
 * analyze` because of the workspace arrow: this package reaches `@mtg/decklab`
 * and therefore `better-sqlite3`, and `@mtg/ui` is bundled for a browser. The
 * block crosses the boundary as JSON, and both ends validate it.
 *
 * It buys nothing. The one judgment a model owns here is which cards serve which
 * archetype, and this tool takes that as a `--tags` file it is handed. Without
 * one every archetype claim comes back unmeasured naming the missing half, which
 * is what a CI run with no key produces and is a verdict rather than an error.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SetFileSchema } from '@mtg/setgen';
import { analysisClaimsBlock } from '../src/analysis-block';
import { DEFAULT_AVAILABILITY_DRAFTS, DEFAULT_AVAILABILITY_SEED } from '../src/availability';
import { CubeCriteriaSchema } from '../src/criteria';
import type { CubeCriteriaInput } from '../src/criteria';
import { claimsForSet } from '../src/set-claims';

const USAGE = `
npx tsx packages/cube/tools/analysis-claims.ts --set <set.json> --criteria <criteria.json> --out <file>

  --set <path>        a @mtg/setgen set file: the list the claims are about
  --criteria <path>   the format's stated capabilities, as cube criteria JSON.
                      A dial this file omits produces no claim: the schema's
                      default is not something the designer asked for.
  --tags <path>       card id to the archetype names it serves, as JSON. The
                      model's half; without it archetype claims are unmeasured.
  --out <path>        where to write the block
  --drafts <n>        drafts to seat when tags are supplied (default ${String(DEFAULT_AVAILABILITY_DRAFTS)})
  --draft-seed <s>    seed for those drafts (default ${DEFAULT_AVAILABILITY_SEED})
  --no-draft          measure the list without drafting it
`;

export interface ClaimsArgs {
  readonly setPath: string;
  readonly criteriaPath: string;
  readonly outPath: string;
  readonly tagsPath: string | undefined;
  readonly drafts: number;
  readonly draftSeed: string;
  readonly draft: boolean;
}

/** Argv in, `ClaimsArgs` out. An unknown flag is an error, never a shrug. */
export function parseClaimsArgs(argv: readonly string[]): ClaimsArgs {
  let setPath: string | undefined;
  let criteriaPath: string | undefined;
  let outPath: string | undefined;
  let tagsPath: string | undefined;
  let drafts = DEFAULT_AVAILABILITY_DRAFTS;
  let draftSeed = DEFAULT_AVAILABILITY_SEED;
  let draft = true;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (token === '--no-draft') {
      draft = false;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${token} needs a value`);
    index += 1;
    switch (token) {
      case '--set':
        setPath = value;
        break;
      case '--criteria':
        criteriaPath = value;
        break;
      case '--tags':
        tagsPath = value;
        break;
      case '--out':
        outPath = value;
        break;
      case '--drafts': {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1) throw new Error('--drafts wants a positive integer');
        drafts = parsed;
        break;
      }
      case '--draft-seed':
        draftSeed = value;
        break;
      default:
        throw new Error(`unknown flag ${token}`);
    }
  }
  if (setPath === undefined) throw new Error('--set is required');
  if (criteriaPath === undefined) throw new Error('--criteria is required');
  // Required and never defaulted, for the reason `npm run reference:reduced`
  // requires its `--out`: writing an artifact somewhere no flag named is how a
  // stale one gets read later.
  if (outPath === undefined) throw new Error('--out is required');
  return { setPath, criteriaPath, outPath, tagsPath, drafts, draftSeed, draft };
}

/** Card id to archetype names, validated rather than cast. */
export function readTags(text: string, path: string): ReadonlyMap<string, readonly string[]> {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${path}: expected an object of card id to archetype names`);
  }
  return new Map(
    Object.entries(raw as Record<string, unknown>).map(([id, names]) => {
      if (!Array.isArray(names) || names.some((name) => typeof name !== 'string')) {
        throw new Error(`${path}: ${id} must map to an array of archetype names`);
      }
      return [id, names as readonly string[]];
    }),
  );
}

export function buildClaimsFile(args: ClaimsArgs): { readonly json: string; readonly ok: boolean } {
  const set = SetFileSchema.parse(JSON.parse(readFileSync(args.setPath, 'utf8')));
  const stated = JSON.parse(readFileSync(args.criteriaPath, 'utf8')) as CubeCriteriaInput;
  // Parsed for its errors, not for its result: `claimsForSet` parses again, and
  // a criteria file that will not validate should say so before anything runs.
  CubeCriteriaSchema.parse(stated);
  const tagging =
    args.tagsPath === undefined ? null : readTags(readFileSync(args.tagsPath, 'utf8'), args.tagsPath);

  const { claims } = claimsForSet({
    set: { code: set.set.code, name: set.set.name, cards: set.cards },
    stated,
    tagging,
    draft: args.draft ? { drafts: args.drafts, seed: args.draftSeed } : undefined,
  });
  return { json: `${JSON.stringify(analysisClaimsBlock(claims), null, 2)}\n`, ok: claims.ok };
}

function main(argv: readonly string[]): number {
  let args: ClaimsArgs;
  try {
    args = parseClaimsArgs(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  const built = buildClaimsFile(args);
  mkdirSync(dirname(args.outPath), { recursive: true });
  writeFileSync(args.outPath, built.json, 'utf8');
  process.stdout.write(
    `${args.outPath}: ${built.ok ? 'nothing stated was missed' : 'something stated was missed'}\n`,
  );
  return built.ok ? 0 : 1;
}

if (process.argv[1]?.endsWith('analysis-claims.ts') === true) {
  process.exitCode = main(process.argv.slice(2));
}
