/** Stage immutable source bundles, then atomically replace the small discovery index. */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  headToHeadForDecks,
  parsePrintedFormat,
  parsePrintedPresentationCatalog,
  PrintedPlayAdmissionSchema,
  winRatesForDecks,
} from '@mtg/printed-card';
import type { CommanderHeadToHeadResults, PrintedDeckWinRates, PrintedFormat } from '@mtg/printed-card';
import { loadPrintedConstructedFormat } from '../src/lab/printed-constructed-format';
import {
  loadPrintedFormat,
  PrintedFormatIndexSchema,
  PRINTED_FORMAT_INDEX_URL,
} from '../src/lab/printed-format';
import type { PrintedFormatIndex } from '../src/lab/printed-format';
import type { PrintedDraftRatings } from '../src/lab/printed-draft-ratings';
import { PrintedCardRolesSchema } from '@mtg/draft-export';
import { formatReleaseDate } from './printed-release-dates';
import type { ReleaseDateLookup } from './printed-release-dates';

export interface PrintedFormatSource {
  readonly id: string;
  readonly directory: string;
  readonly admissionDirectory?: string;
  readonly formatFile: string;
  readonly constructedFormatFile?: string;
  readonly displayMetadataFile?: string;
  readonly tokenPrintingsFile?: string;
  readonly presentationCatalog?: 'momir-oldest-creatures';
  readonly availability: PrintedFormatIndex['formats'][number]['availability'];
  readonly catalogs: readonly { readonly code: string; readonly file: string; readonly name?: string }[];
}

/** The roles file a printed Limited format may carry in its own data directory. */
export const PRINTED_CARD_ROLES_FILE = 'card-roles-v1.json';

export interface PrintedStagingOptions {
  readonly releaseDateOf: ReleaseDateLookup;
  readonly draftRatings?: ReadonlyMap<string, PrintedDraftRatings>;
  readonly deckWinRates?: PrintedDeckWinRates;
  readonly headToHead?: CommanderHeadToHeadResults;
}

function buildPresentationBody(source: PrintedFormatSource): string | undefined {
  if (source.presentationCatalog === undefined) return undefined;
  const repositoryRoot = join(source.directory, '..', '..', '..', '..');
  const temporary = mkdtempSync(join(tmpdir(), 'mtg-momir-presentation-'));
  const output = join(temporary, 'catalog.json');
  try {
    execFileSync(
      join(repositoryRoot, 'node_modules', '.bin', 'tsx'),
      [
        join(repositoryRoot, 'packages', 'data', 'tools', 'build-momir-presentation.ts'),
        '--database',
        join(repositoryRoot, 'data', 'store', 'mtg.sqlite'),
        '--out',
        output,
      ],
      { stdio: 'inherit' },
    );
    const body = readFileSync(output, 'utf8');
    parsePrintedPresentationCatalog(JSON.parse(body));
    return body;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function immutableWrite(path: string, body: string): void {
  try {
    writeFileSync(path, body, { flag: 'wx' });
  } catch (cause: unknown) {
    if (!(cause instanceof Error && 'code' in cause && cause.code === 'EEXIST')) throw cause;
    if (readFileSync(path, 'utf8') !== body) throw new Error(`Staged immutable bundle differs: ${path}`);
  }
}

/**
 * What the set is to the format: a `product` is a set whose packs a product
 * opens, or in a constructed format a set one of the decks draws a card from;
 * a `supplement` rides inside another set's packs and no product opens it
 * (`mtg-cz6kp`, the Invocations).
 */
function catalogRole(format: PrintedFormat, code: string): 'product' | 'supplement' {
  if (format.kind === 'printed-limited-format') {
    return format.products.some((product) => product.setCode === code) ? 'product' : 'supplement';
  }
  const catalogFormat = format.sources.find((source) => source.code === code)?.catalogFormat;
  return format.decks.some((deck) =>
    [...deck.commanders, ...deck.cards].some((slot) => slot.physicalId.startsWith(`${catalogFormat ?? ''}:`)),
  )
    ? 'product'
    : 'supplement';
}

async function prepareSource(
  source: PrintedFormatSource,
  releaseDateOf: ReleaseDateLookup,
  draftRatings?: PrintedDraftRatings,
  deckWinRates?: PrintedDeckWinRates,
  headToHead?: CommanderHeadToHeadResults,
) {
  const formatBody = readFileSync(join(source.directory, source.formatFile), 'utf8');
  const format = parsePrintedFormat(JSON.parse(formatBody));
  const prefix = `formats/${format.id}/${format.contentSha256}`;
  const constructedBody =
    source.constructedFormatFile === undefined
      ? undefined
      : readFileSync(join(source.directory, source.constructedFormatFile), 'utf8');
  if (constructedBody !== undefined && format.kind !== 'printed-limited-format') {
    throw new Error(`Printed format ${format.id} cannot attach decks to a constructed format`);
  }
  if (constructedBody !== undefined && source.admissionDirectory === undefined) {
    throw new Error(`Printed format ${format.id} constructed decks require its play admission`);
  }
  const admission =
    constructedBody === undefined
      ? undefined
      : PrintedPlayAdmissionSchema.parse(
          JSON.parse(readFileSync(join(source.admissionDirectory!, 'admission.json'), 'utf8')),
        );
  if (
    admission !== undefined &&
    (admission.subject.formatId !== format.id ||
      admission.subject.formatSha256 !== format.contentSha256 ||
      !format.sources.every((entry) => admission.subject.catalogs[entry.code] === entry.catalogSha256) ||
      Object.keys(admission.subject.catalogs).length !== format.sources.length)
  ) {
    throw new Error(`Printed format ${format.id} constructed decks do not match its play admission`);
  }
  const constructedAdmissionBody =
    admission === undefined
      ? undefined
      : `${JSON.stringify(
          {
            schemaVersion: 1,
            formatId: format.id,
            cards: admission.cards.filter((card) => card.review === 'reviewed').map((card) => card.id),
          },
          null,
          2,
        )}\n`;
  const constructedFormatUrl =
    constructedBody === undefined ? undefined : `${prefix}/${source.constructedFormatFile!}`;
  const constructedAdmissionUrl =
    constructedAdmissionBody === undefined
      ? undefined
      : `${prefix}/constructed-admission-${createHash('sha256').update(constructedAdmissionBody).digest('hex')}.json`;
  const displayBody =
    source.displayMetadataFile === undefined
      ? undefined
      : readFileSync(join(source.directory, source.displayMetadataFile), 'utf8');
  const displayMetadataUrl =
    displayBody === undefined
      ? undefined
      : `formats/${format.id}/display-${createHash('sha256').update(displayBody).digest('hex')}.json`;
  const tokenBody =
    source.tokenPrintingsFile === undefined
      ? undefined
      : readFileSync(join(source.directory, source.tokenPrintingsFile), 'utf8');
  const tokenPrintingsUrl =
    tokenBody === undefined
      ? undefined
      : `formats/${format.id}/tokens-${createHash('sha256').update(tokenBody).digest('hex')}.json`;
  const presentationBody = buildPresentationBody(source);
  const presentationCatalogUrl =
    presentationBody === undefined
      ? undefined
      : `formats/${format.id}/presentation-${createHash('sha256').update(presentationBody).digest('hex')}.json`;
  const draftRatingsBody =
    draftRatings === undefined ? undefined : `${JSON.stringify(draftRatings, null, 2)}\n`;
  const draftRatingsUrl =
    draftRatingsBody === undefined
      ? undefined
      : `formats/${format.id}/draft-ratings-${createHash('sha256').update(draftRatingsBody).digest('hex')}.json`;
  // #305: model-labeled card roles live beside the format's own data, never in its admission.
  const cardRolesPath = join(source.directory, PRINTED_CARD_ROLES_FILE);
  const cardRolesBody =
    format.kind === 'printed-limited-format' && existsSync(cardRolesPath)
      ? `${JSON.stringify(PrintedCardRolesSchema.parse(JSON.parse(readFileSync(cardRolesPath, 'utf8'))), null, 2)}\n`
      : undefined;
  const cardRolesUrl =
    cardRolesBody === undefined
      ? undefined
      : `formats/${format.id}/card-roles-${createHash('sha256').update(cardRolesBody).digest('hex')}.json`;
  const formatWinRates =
    deckWinRates === undefined ||
    format.kind === 'printed-limited-format' ||
    format.rules.variant !== 'commander'
      ? undefined
      : winRatesForDecks(deckWinRates, format.decks);
  const deckWinRatesBody =
    formatWinRates === undefined ? undefined : `${JSON.stringify(formatWinRates, null, 2)}\n`;
  const deckWinRatesUrl =
    deckWinRatesBody === undefined
      ? undefined
      : `formats/${format.id}/deck-win-rates-${createHash('sha256').update(deckWinRatesBody).digest('hex')}.json`;
  const formatHeadToHead =
    headToHead === undefined ||
    format.kind === 'printed-limited-format' ||
    format.rules.variant !== 'commander'
      ? undefined
      : headToHeadForDecks(headToHead, format.decks);
  const headToHeadBody =
    formatHeadToHead === undefined ? undefined : `${JSON.stringify(formatHeadToHead, null, 2)}\n`;
  const headToHeadUrl =
    headToHeadBody === undefined
      ? undefined
      : `formats/${format.id}/head-to-head-${createHash('sha256').update(headToHeadBody).digest('hex')}.json`;
  const catalogs = source.catalogs.map((catalog) => ({
    code: catalog.code,
    ...(catalog.name === undefined ? {} : { name: catalog.name }),
    url: `${prefix}/${catalog.file}`,
    role: catalogRole(format, catalog.code),
  }));
  const releaseDate = formatReleaseDate(
    catalogs.filter((catalog) => catalog.role === 'product').map((catalog) => catalog.code),
    releaseDateOf,
  );
  const row = {
    id: format.id,
    name: format.name,
    kind: format.kind === 'printed-limited-format' ? ('limited' as const) : ('constructed' as const),
    ...(format.kind === 'printed-limited-format' ? {} : { variant: format.rules.variant }),
    availability: source.availability,
    ...(releaseDate === undefined ? {} : { releaseDate }),
    formatUrl: `${prefix}/${source.formatFile}`,
    ...(constructedFormatUrl === undefined ? {} : { constructedFormatUrl }),
    ...(constructedAdmissionUrl === undefined ? {} : { constructedAdmissionUrl }),
    ...(displayMetadataUrl === undefined ? {} : { displayMetadataUrl }),
    ...(tokenPrintingsUrl === undefined ? {} : { tokenPrintingsUrl }),
    ...(presentationCatalogUrl === undefined ? {} : { presentationCatalogUrl }),
    ...(draftRatingsUrl === undefined ? {} : { draftRatingsUrl }),
    ...(cardRolesUrl === undefined ? {} : { cardRolesUrl }),
    ...(deckWinRatesUrl === undefined ? {} : { deckWinRatesUrl }),
    ...(headToHeadUrl === undefined ? {} : { headToHeadUrl }),
    catalogs,
  };
  // Validate paths before using catalog filenames. Source arguments are local launcher inputs.
  PrintedFormatIndexSchema.parse({ schemaVersion: 2, formats: [row] });
  const files = [
    ...(draftRatingsBody === undefined ? [] : [{ url: row.draftRatingsUrl!, body: draftRatingsBody }]),
    ...(cardRolesBody === undefined ? [] : [{ url: row.cardRolesUrl!, body: cardRolesBody }]),
    ...(deckWinRatesBody === undefined ? [] : [{ url: row.deckWinRatesUrl!, body: deckWinRatesBody }]),
    ...(headToHeadBody === undefined ? [] : [{ url: row.headToHeadUrl!, body: headToHeadBody }]),
    ...(displayMetadataUrl === undefined ? [] : [{ url: displayMetadataUrl, body: displayBody! }]),
    ...(tokenPrintingsUrl === undefined ? [] : [{ url: tokenPrintingsUrl, body: tokenBody! }]),
    ...(presentationCatalogUrl === undefined
      ? []
      : [{ url: presentationCatalogUrl, body: presentationBody! }]),
    { url: row.formatUrl, body: formatBody },
    ...(constructedBody === undefined ? [] : [{ url: constructedFormatUrl!, body: constructedBody }]),
    ...(constructedAdmissionBody === undefined
      ? []
      : [{ url: constructedAdmissionUrl!, body: constructedAdmissionBody }]),
    ...source.catalogs.map((catalog) => ({
      url: `${prefix}/${catalog.file}`,
      body: readFileSync(join(source.directory, catalog.file), 'utf8'),
    })),
  ];
  const read = async (url: string): Promise<unknown> => {
    const file = files.find((entry) => entry.url === url);
    if (file === undefined) throw new Error(`Printed staging missing resource ${url}`);
    return JSON.parse(file.body) as unknown;
  };
  if (row.kind === 'limited') {
    await loadPrintedFormat(row, read);
    if (row.constructedFormatUrl !== undefined) await loadPrintedConstructedFormat(row, read);
  } else {
    await loadPrintedConstructedFormat(row, read);
  }
  return { row, files };
}

/** No index is published until every source validates. Existing sessions retain their old bundle URLs. */
export async function stagePrintedFormats(
  sources: readonly PrintedFormatSource[],
  publicRoot: string,
  options: PrintedStagingOptions,
): Promise<PrintedFormatIndex> {
  const prepared = await Promise.all(
    sources.map((source) =>
      prepareSource(
        source,
        options.releaseDateOf,
        options.draftRatings?.get(formatId(source)),
        options.deckWinRates,
        options.headToHead,
      ),
    ),
  );
  const index = PrintedFormatIndexSchema.parse({
    schemaVersion: 2,
    formats: prepared.map((source) => source.row),
  });
  for (const file of prepared.flatMap((source) => source.files)) {
    const path = join(publicRoot, file.url);
    mkdirSync(dirname(path), { recursive: true });
    immutableWrite(path, file.body);
  }
  writeIndex(publicRoot, index);
  return index;
}

function writeIndex(publicRoot: string, index: PrintedFormatIndex): void {
  const target = join(publicRoot, PRINTED_FORMAT_INDEX_URL);
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(index, null, 2)}\n`, { flag: 'wx' });
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/**
 * Turn Play off, in the staged index, for every format the backend withheld.
 *
 * The registry says Play is supported when an admission is installed; only the
 * backend's verdict over the runtime that actually started says whether that
 * admission still holds (a rebuilt bridge, an edited adapter, no Forge). A
 * format it withheld keeps browse, draft and sealed, and its Play control
 * shows the backend's sentence instead of a button that fails on press (#16).
 * Rewritten atomically, like the first write; the bundles it names are untouched.
 */
export function withholdPrintedPlay(
  publicRoot: string,
  index: PrintedFormatIndex,
  withheld: readonly { readonly formatId: string; readonly reason: string }[],
): PrintedFormatIndex {
  if (withheld.length === 0) return index;
  const reasons = new Map(withheld.map((entry) => [entry.formatId, entry.reason]));
  const next = PrintedFormatIndexSchema.parse({
    ...index,
    formats: index.formats.map((row) => {
      const reason = reasons.get(row.id);
      return reason === undefined
        ? row
        : { ...row, availability: { ...row.availability, play: { status: 'unavailable', reason } } };
    }),
  });
  writeIndex(publicRoot, next);
  return next;
}

function formatId(source: PrintedFormatSource): string {
  return parsePrintedFormat(JSON.parse(readFileSync(join(source.directory, source.formatFile), 'utf8'))).id;
}
