/**
 * Opt-in acquisition of a format's token printings: Scryfall's token set,
 * bound to Forge's token scripts. Writes one file and refuses an existing one.
 *
 *   npx tsx packages/data/tools/fetch-token-printings.ts --sets TSCD \
 *     --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 \
 *     --out packages/data/data/scd/scd-token-printings-v1.json
 *
 * A cube has no token set of its own, so `--catalog` derives the sheet from
 * what its card scripts create: every `TokenScript$` reference is looked up
 * by its printed name, the oldest Scryfall token printing stating the same
 * token (by that name, or by a stated alias in `token-printings.ts`) is chosen,
 * and the token sets those printings come from are fetched whole so each
 * carries a recorded source, exactly as a set sheet does.
 *
 *   npx tsx packages/data/tools/fetch-token-printings.ts \
 *     --catalog packages/data/data/legacy-cube-2021-card-catalog-v1.json \
 *     --forge-scripts tools/forge/dist/res/cardsfolder/cardsfolder.zip \
 *     --forge-tokenscripts tools/forge/dist/res/tokenscripts --forge-version 2.0.14 \
 *     --out packages/data/data/legacy-cube-2021-token-printings-v1.json
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { parsePrintedTokenPrintings } from '@mtg/printed-card';
import type { PrintedTokenPrinting } from '@mtg/printed-card';
import { HttpError } from '../src/errors';
import { createHttpClient } from '../src/http/client';
import type { HttpClient } from '../src/http/client';
import { formatJsonArtifact } from '../src/printed-card/format-build-files';
import { readForgeScriptArchive } from '../src/printed-card/forge-install';
import {
  fetchScryfallPrinting,
  fetchScryfallSetPrintings,
  fetchScryfallTokenPrintingsNamed,
} from '../src/printed-card/source-fetch';
import { catalogTokenScriptReferences } from '../src/printed-card/token-references';
import {
  aliasSaysToken,
  bindTokenPrintings,
  parseForgeTokenScript,
  scriptSaysToken,
  statedAliasesFor,
} from '../src/printed-card/token-printings';
import type { ForgeTokenScript } from '../src/printed-card/token-printings';
import type { ScryfallCard } from '../src/scryfall/schemas';

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    sets: { type: 'string' },
    catalog: { type: 'string', multiple: true },
    'forge-scripts': { type: 'string' },
    'forge-tokenscripts': { type: 'string' },
    'forge-version': { type: 'string' },
  },
  strict: true,
  allowPositionals: false,
});
const scriptsRoot = values['forge-tokenscripts'];
const forgeVersion = values['forge-version'];
const USAGE =
  'Usage: fetch-token-printings (--sets TSCD[,TAKH] | --catalog <catalog.json> [--catalog ...] --forge-scripts <cardsfolder.zip>) --forge-tokenscripts <dir> --forge-version <version> --out <new-file>';
if (
  values.out === undefined ||
  scriptsRoot === undefined ||
  forgeVersion === undefined ||
  (values.sets === undefined) === (values.catalog === undefined) ||
  (values.catalog !== undefined) !== (values['forge-scripts'] !== undefined)
) {
  throw new Error(USAGE);
}

const scripts: ForgeTokenScript[] = [];
for (const file of readdirSync(resolve(scriptsRoot))
  .filter((name) => name.endsWith('.txt'))
  .sort()) {
  const script = parseForgeTokenScript(file, readFileSync(join(resolve(scriptsRoot), file), 'utf8'));
  if (script !== undefined) scripts.push(script);
}
const client = createHttpClient({
  fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(60_000) }),
});

interface SourceSet {
  readonly code: string;
  readonly sourceUrl: string;
  readonly sourceSha256: string;
  readonly fetchedAt: string;
}

async function fetchSet(
  code: string,
  http: HttpClient,
): Promise<{ readonly set: SourceSet; readonly tokens: readonly PrintedTokenPrinting[] }> {
  const source = await fetchScryfallSetPrintings(code, http);
  const bound = bindTokenPrintings(code, source.cards, scripts);
  process.stdout.write(
    `${code}: ${String(bound.tokens.length)} of ${String(source.cards.length)} printings bound\n`,
  );
  for (const row of bound.omitted) {
    process.stdout.write(`  left out ${code} ${row.collectorNumber} ${row.name}: ${row.reason}\n`);
  }
  return {
    set: { code, sourceUrl: source.url, sourceSha256: source.sha256, fetchedAt: new Date().toISOString() },
    tokens: bound.tokens,
  };
}

const CatalogScripts = z.looseObject({
  cards: z.array(z.looseObject({ forgeScript: z.string().min(1) })).min(1),
});

/** Whether Scryfall lists no printing at all under the name, which it answers with a 404. */
function isNoResult(cause: unknown): boolean {
  return cause instanceof HttpError && cause.status === 404;
}

/** A printing's release date; one Scryfall gives none sorts last rather than first. */
function releasedAt(card: ScryfallCard): string {
  return card.released_at ?? '9999-12-31';
}

/**
 * The oldest printing stating each referenced token script, keyed by
 * Scryfall id, and the token sets they are printed in. A script whose printed
 * name Scryfall lists no token for, or lists only in a set that is not a token
 * set, is reported and left out: the board then draws its pending frame.
 */
async function chooseCubePrintings(
  references: readonly string[],
  http: HttpClient,
): Promise<{ readonly chosen: ReadonlySet<string>; readonly codes: readonly string[] }> {
  const chosen = new Set<string>();
  const codes = new Set<string>();
  for (const reference of references) {
    const script = scripts.find((candidate) => candidate.file === `${reference}.txt`);
    if (script === undefined) {
      process.stdout.write(`  left out ${reference}: no Forge token script\n`);
      continue;
    }
    const printedName = script.name.replace(/ Token$/u, '');
    let cards: readonly ScryfallCard[];
    try {
      cards = (await fetchScryfallTokenPrintingsNamed(printedName, http)).cards;
    } catch (cause: unknown) {
      if (!isNoResult(cause)) throw cause;
      cards = [];
    }
    // A stated alias names a printing the name lookup cannot find (TMBS 1's "Germ" for
    // "Phyrexian Germ Token"), so it competes on release date with what the lookup found.
    const aliased: ScryfallCard[] = [];
    for (const alias of statedAliasesFor(script)) {
      const found = (await fetchScryfallPrinting(alias.setCode, alias.collectorNumber, http)).cards;
      aliased.push(...found.filter((card) => aliasSaysToken(alias.setCode, card, script)));
    }
    const printing = [...aliased, ...cards.filter((card) => scriptSaysToken(card, script))]
      .filter((card) => card.layout === 'token' && /^t[a-z0-9]+$/u.test(card.set))
      .sort((left, right) => releasedAt(left).localeCompare(releasedAt(right)))[0];
    if (printing === undefined) {
      process.stdout.write(
        `  left out ${reference} (${script.name}): no Scryfall token printing states it\n`,
      );
      continue;
    }
    chosen.add(printing.id);
    codes.add(printing.set.toUpperCase());
    process.stdout.write(
      `${reference}: ${printing.set.toUpperCase()} ${printing.collector_number} ${printing.name}\n`,
    );
  }
  return { chosen, codes: [...codes].sort() };
}

const sets: SourceSet[] = [];
const tokens: PrintedTokenPrinting[] = [];
if (values.sets !== undefined) {
  const codes = values.sets.split(',');
  if (
    codes.length === 0 ||
    new Set(codes).size !== codes.length ||
    codes.some((code) => !/^T[A-Z0-9]{2,7}$/.test(code))
  ) {
    throw new Error('--sets must contain unique uppercase token set codes beginning with T');
  }
  for (const code of codes) {
    const fetched = await fetchSet(code, client);
    sets.push(fetched.set);
    tokens.push(...fetched.tokens);
  }
} else {
  // A multi-set format (Dark Ascension / Innistrad) makes tokens from every catalog it plays.
  const catalogs = values.catalog!.map((file) =>
    CatalogScripts.parse(JSON.parse(readFileSync(file, 'utf8'))),
  );
  const references = catalogTokenScriptReferences(
    catalogs.flatMap((catalog) => catalog.cards.map((card) => card.forgeScript)),
    readForgeScriptArchive(resolve(values['forge-scripts']!)),
  );
  process.stdout.write(`${String(references.length)} token scripts referenced by the catalog\n`);
  const { chosen, codes } = await chooseCubePrintings(references, client);
  for (const code of codes) {
    const fetched = await fetchSet(code, client);
    sets.push(fetched.set);
    tokens.push(...fetched.tokens.filter((token) => chosen.has(token.scryfallId)));
  }
}
const file = parsePrintedTokenPrintings({
  schemaVersion: 1,
  sets,
  engine: { name: 'forge', version: forgeVersion },
  tokens,
});
writeFileSync(resolve(values.out), await formatJsonArtifact(file, values.out), { flag: 'wx' });
process.stdout.write(`wrote ${values.out}: ${String(tokens.length)} token printings\n`);
