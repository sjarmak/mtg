#!/usr/bin/env -S npx tsx
/**
 * `@mtg/data` CLI.
 *
 *   tsx packages/data/src/cli.ts ingest --kind oracle_cards --kind rulings
 *   tsx packages/data/src/cli.ts vocab
 *   tsx packages/data/src/cli.ts stats
 *   tsx packages/data/src/cli.ts find "Lightning Bolt" --exact
 *   tsx packages/data/src/cli.ts card "Lightning Bolt"      # or an oracle id
 *   tsx packages/data/src/cli.ts colors WU --mode subset --limit 20
 *
 * Ctrl-C during an ingest aborts at the next batch boundary and leaves a
 * resumable checkpoint; re-running the same command continues from it.
 */
import { pathToFileURL } from 'node:url';
import { ATTRIBUTION, BULK_KINDS, DEFAULT_CACHE_DIR, DEFAULT_DB_PATH, type BulkKind } from './config';
import { InvalidInputError, describeError, errorPayload } from './errors';
import { ingestFromScryfall } from './ingest/ingest-scryfall';
import {
  CARD_CANDIDATE_LIMIT,
  findCardsByColorIdentity,
  findCardsByName,
  findCardsBySet,
  getPrintings,
  getRulings,
  resolveCardRef,
  storeStats,
  type CardRefResolution,
} from './query/queries';
import { listRejects, listRuns } from './store/runs';
import { closeStore, openStore, type DataStore } from './store/store';
import { ingestVocabulary, loadVocabulary, vocabularyStatus } from './vocabulary/ingest';
import { unknownKeywords } from './vocabulary/vocabulary';
import {
  flagBoolean,
  flagInteger,
  flagString,
  parseArgs,
  requirePositional,
  type CommandArgs,
} from './cli/args';
import { formatBytes, formatCardChoice, formatCardDetail, formatCardLine, formatRuling } from './cli/format';

const USAGE = `mtg-data — local Scryfall + MTGJSON store

Commands:
  ingest    [--kind <${BULK_KINDS.join('|')}>]... [--force] [--limit N] [--batch N] [--cache DIR]
  vocab     ingest MTGJSON CardTypes/Keywords/EnumValues
  stats     row counts, ingest provenance, vocabulary versions
  rejects   [--kind K] [--limit N]   records refused at the validation boundary
  find      <name> [--exact] [--limit N] [--source scryfall|lab]
  card      <oracle-id|name>
  set       <SET_CODE> [--limit N]
  colors    <WUBRG letters> [--mode exact|subset|includes] [--limit N]
  rulings   <oracle-id|name>
  check-vocab <keyword>...   cross-check keywords against the MTGJSON vocabulary

Global flags: --db <path> (default ${DEFAULT_DB_PATH}), --json

--json is machine-readable on both outcomes: success prints the result document
to stdout, failure prints {"error": {"name", "message"}} to stdout and exits
non-zero. The exit code is the authority, not the shape. The human-readable
message goes to stderr either way.`;

const GLOBAL_VALUED = ['db'] as const;
const GLOBAL_BOOLEAN = ['json'] as const;

function withStore<T>(args: CommandArgs, run: (store: DataStore) => T): T {
  const store = openStore(flagString(args, 'db', DEFAULT_DB_PATH));
  try {
    return run(store);
  } finally {
    closeStore(store);
  }
}

async function withStoreAsync<T>(args: CommandArgs, run: (store: DataStore) => Promise<T>): Promise<T> {
  const store = openStore(flagString(args, 'db', DEFAULT_DB_PATH));
  try {
    return await run(store);
  } finally {
    closeStore(store);
  }
}

function emit(args: CommandArgs, payload: unknown, lines: readonly string[]): void {
  if (flagBoolean(args, 'json')) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  for (const line of lines) console.log(line);
}

function parseKinds(args: CommandArgs): BulkKind[] {
  const requested = args.repeated['kind'] ?? [];
  if (requested.length === 0) return ['oracle_cards', 'rulings'];
  return requested.map((kind) => {
    if (!(BULK_KINDS as readonly string[]).includes(kind)) {
      throw new Error(`unknown bulk kind "${kind}" (expected one of ${BULK_KINDS.join(', ')})`);
    }
    return kind as BulkKind;
  });
}

async function commandIngest(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv, {
    valued: [...GLOBAL_VALUED, 'limit', 'batch', 'cache'],
    boolean: [...GLOBAL_BOOLEAN, 'force'],
    repeated: ['kind'],
  });
  const kinds = parseKinds(args);
  const controller = new AbortController();
  const onSignal = (): void => {
    process.stderr.write('\ninterrupt received — finishing current batch, checkpoint will be kept\n');
    controller.abort();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const maxRecords = flagInteger(args, 'limit');
  const batchSize = flagInteger(args, 'batch');
  let lastDownloadReport = 0;
  const outcomes = await withStoreAsync(args, (store) =>
    ingestFromScryfall(store, {
      kinds,
      cacheDir: flagString(args, 'cache', DEFAULT_CACHE_DIR),
      force: flagBoolean(args, 'force'),
      signal: controller.signal,
      ...(maxRecords === undefined ? {} : { maxRecords }),
      ...(batchSize === undefined ? {} : { batchSize }),
      onDownloadProgress: (progress) => {
        const now = Date.now();
        if (now - lastDownloadReport < 1_000) return;
        lastDownloadReport = now;
        const total = progress.bytesExpected === null ? '?' : formatBytes(progress.bytesExpected);
        process.stderr.write(`  ${progress.kind}: ${formatBytes(progress.bytesDownloaded)} / ${total}\r`);
      },
      onProgress: (progress) => {
        process.stderr.write(
          `  ${progress.kind}: ${progress.linesRead} lines, ${progress.rowsWritten} rows, ` +
            `${progress.rowsRejected} rejected\r`,
        );
      },
    }),
  );
  process.stderr.write('\n');
  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);

  emit(
    args,
    outcomes,
    outcomes.map(
      (outcome) =>
        `${outcome.kind}: ${outcome.status} — ${outcome.rowsWritten} rows, ` +
        `${outcome.rowsRejected} rejected, upstream ${outcome.bulkUpdatedAt}` +
        `${outcome.reusedCache ? ' (cache reused)' : ` (${formatBytes(outcome.downloadedBytes)} downloaded)`}`,
    ),
  );
}

async function commandVocab(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv, { valued: [...GLOBAL_VALUED], boolean: [...GLOBAL_BOOLEAN] });
  const results = await withStoreAsync(args, (store) => ingestVocabulary(store));
  emit(
    args,
    results,
    results.map((result) => `${result.kind}: ${result.version} (${formatBytes(result.bytes)})`),
  );
}

function commandStats(argv: readonly string[]): void {
  const args = parseArgs(argv, { valued: [...GLOBAL_VALUED], boolean: [...GLOBAL_BOOLEAN] });
  withStore(args, (store) => {
    const stats = storeStats(store);
    const runs = listRuns(store);
    const vocabulary = vocabularyStatus(store);
    const lines = [
      `oracle cards : ${stats.oracleCards} (${stats.labCards} lab)`,
      `printings    : ${stats.printings} across ${stats.sets} sets`,
      `rulings      : ${stats.rulings}`,
      `rejected     : ${stats.rejects} logged`,
      '',
      'ingest runs:',
      ...runs.map(
        (run) =>
          `  ${run.bulkKind}: ${run.status}, ${run.rowsWritten} rows, upstream ${run.bulkUpdatedAt}, ` +
          `line ${run.linesDone}`,
      ),
      '',
      'vocabulary:',
      ...vocabulary.map((entry) => `  ${entry.kind}: ${entry.version} (${entry.ingestedAt})`),
      '',
      ...ATTRIBUTION,
    ];
    emit(args, { stats, runs, vocabulary, attribution: ATTRIBUTION }, lines);
  });
}

function commandRejects(argv: readonly string[]): void {
  const args = parseArgs(argv, { valued: [...GLOBAL_VALUED, 'kind', 'limit'], boolean: [...GLOBAL_BOOLEAN] });
  withStore(args, (store) => {
    const kind = flagString(args, 'kind', 'oracle_cards') as BulkKind;
    const rejects = listRejects(store, kind, flagInteger(args, 'limit') ?? 20);
    emit(
      args,
      rejects,
      rejects.map((reject) => `line ${reject.lineNumber}: ${reject.reason}`),
    );
  });
}

function commandFind(argv: readonly string[]): void {
  const args = parseArgs(argv, {
    valued: [...GLOBAL_VALUED, 'limit', 'source'],
    boolean: [...GLOBAL_BOOLEAN, 'exact'],
  });
  const name = requirePositional(args, 0, 'card name');
  const limit = flagInteger(args, 'limit');
  withStore(args, (store) => {
    const source = args.flags['source'];
    const cards = findCardsByName(store, name, {
      exact: flagBoolean(args, 'exact'),
      ...(limit === undefined ? {} : { limit }),
      ...(source === 'lab' || source === 'scryfall' ? { source } : {}),
    });
    emit(args, cards, cards.map(formatCardLine));
  });
}

/** Turns a reference that did not land on exactly one card into a message that names the way out. */
function unresolvedRef(
  ref: string,
  resolution: Exclude<CardRefResolution, { kind: 'card' }>,
): InvalidInputError {
  if (resolution.kind === 'none') {
    return new InvalidInputError(
      'card reference',
      `no card matches "${ref}" — try \`find "${ref}"\` to search`,
    );
  }
  const count = resolution.truncated
    ? `more than ${CARD_CANDIDATE_LIMIT}`
    : String(resolution.candidates.length);
  return new InvalidInputError(
    'card reference',
    [
      `"${ref}" matches ${count} cards — pass one of these oracle ids, or search with \`find\`:`,
      ...resolution.candidates.map(formatCardChoice),
    ].join('\n'),
  );
}

function commandCard(argv: readonly string[]): void {
  const args = parseArgs(argv, { valued: [...GLOBAL_VALUED], boolean: [...GLOBAL_BOOLEAN] });
  const ref = requirePositional(args, 0, 'oracle id or card name');
  withStore(args, (store) => {
    const resolution = resolveCardRef(store, ref);
    if (resolution.kind !== 'card') throw unresolvedRef(ref, resolution);
    const card = resolution.card;
    const printings = getPrintings(store, card.oracleId);
    emit(args, { card, printings }, [formatCardDetail(card, printings)]);
  });
}

function commandSet(argv: readonly string[]): void {
  const args = parseArgs(argv, { valued: [...GLOBAL_VALUED, 'limit'], boolean: [...GLOBAL_BOOLEAN] });
  const code = requirePositional(args, 0, 'set code');
  const limit = flagInteger(args, 'limit');
  withStore(args, (store) => {
    const cards = findCardsBySet(store, code, { ...(limit === undefined ? {} : { limit }) });
    emit(args, cards, cards.map(formatCardLine));
  });
}

function commandColors(argv: readonly string[]): void {
  const args = parseArgs(argv, { valued: [...GLOBAL_VALUED, 'limit', 'mode'], boolean: [...GLOBAL_BOOLEAN] });
  const colors = requirePositional(args, 0, 'color letters');
  const mode = flagString(args, 'mode', 'exact');
  if (mode !== 'exact' && mode !== 'subset' && mode !== 'includes') {
    throw new Error(`--mode must be exact, subset or includes (got "${mode}")`);
  }
  const limit = flagInteger(args, 'limit');
  withStore(args, (store) => {
    const cards = findCardsByColorIdentity(store, colors, {
      mode,
      ...(limit === undefined ? {} : { limit }),
    });
    emit(args, cards, cards.map(formatCardLine));
  });
}

function commandRulings(argv: readonly string[]): void {
  const args = parseArgs(argv, { valued: [...GLOBAL_VALUED, 'limit'], boolean: [...GLOBAL_BOOLEAN] });
  const ref = requirePositional(args, 0, 'oracle id or card name');
  withStore(args, (store) => {
    const resolution = resolveCardRef(store, ref);
    if (resolution.kind === 'ambiguous') throw unresolvedRef(ref, resolution);
    // Rulings ingest independently of cards, so an oracle id whose card row was
    // never ingested still has rulings and must stay queryable.
    const rulings = getRulings(store, resolution.kind === 'card' ? resolution.card.oracleId : ref);
    if (resolution.kind === 'none' && rulings.length === 0) throw unresolvedRef(ref, resolution);
    emit(args, rulings, rulings.map(formatRuling));
  });
}

function commandCheckVocab(argv: readonly string[]): void {
  const args = parseArgs(argv, { valued: [...GLOBAL_VALUED], boolean: [...GLOBAL_BOOLEAN] });
  const keywords = args.positionals;
  if (keywords.length === 0) throw new Error('check-vocab needs at least one keyword to check');
  withStore(args, (store) => {
    const vocabulary = loadVocabulary(store);
    if (vocabulary === null) {
      throw new Error('no MTGJSON vocabulary in the store — run `vocab` first');
    }
    const unknown = unknownKeywords(vocabulary, keywords);
    emit(args, { version: vocabulary.version, checked: keywords, unknown }, [
      `MTGJSON ${vocabulary.version}: ${keywords.length - unknown.length}/${keywords.length} recognized`,
      ...(unknown.length === 0 ? ['all recognized'] : [`unknown: ${unknown.join(', ')}`]),
    ]);
  });
}

/**
 * Puts a machine-readable failure on stdout when the caller asked for JSON, so one
 * channel answers both outcomes. stderr keeps the human line either way: `--json`
 * adds a channel rather than moving one. The flag is read from raw argv, not from
 * parsed flags, because parsing is itself one of the failure paths this covers.
 */
function emitJsonError(argv: readonly string[], error: unknown): void {
  if (!argv.includes('--json')) return;
  console.log(JSON.stringify({ error: errorPayload(error) }, null, 2));
}

export async function main(argv: readonly string[]): Promise<number> {
  const command = argv[0];
  const rest = argv.slice(1);
  try {
    switch (command) {
      case 'ingest':
        await commandIngest(rest);
        return 0;
      case 'vocab':
        await commandVocab(rest);
        return 0;
      case 'stats':
        commandStats(rest);
        return 0;
      case 'rejects':
        commandRejects(rest);
        return 0;
      case 'find':
        commandFind(rest);
        return 0;
      case 'card':
        commandCard(rest);
        return 0;
      case 'set':
        commandSet(rest);
        return 0;
      case 'colors':
        commandColors(rest);
        return 0;
      case 'rulings':
        commandRulings(rest);
        return 0;
      case 'check-vocab':
        commandCheckVocab(rest);
        return 0;
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        console.log(USAGE);
        return 0;
      default:
        // The usage block belongs on stderr, not inside a machine-readable message.
        emitJsonError(argv, new InvalidInputError('command', `unknown command "${command}"`));
        console.error(`unknown command "${command}"\n\n${USAGE}`);
        return 2;
    }
  } catch (error) {
    emitJsonError(argv, error);
    console.error(describeError(error));
    return 1;
  }
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  // `mtg-data rulings <id> | head -3` closes stdout early; without this the
  // process dies on an unhandled EPIPE instead of exiting quietly.
  process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(0);
    throw error;
  });
  process.exitCode = await main(process.argv.slice(2));
}
