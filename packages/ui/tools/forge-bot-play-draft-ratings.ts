/**
 * Rung 3 (`docs/adr/0005-rating-provenance-ladder.md`) printed draft ratings:
 * our own measured Forge bot-play win rate, for a printed Limited format with
 * no rung-1 (17lands) or rung-2 (Forge's own `DraftRankCache`) data — today
 * `akh-hou` and `m15` (`mtg-w0xm8` follow-up, `mtg-ht4r7`).
 *
 * Drives full-pod drafts, builds one deck per seat, and pairs seats
 * sequentially (0v1, 2v3, ...) for two Forge games per pair, one per deck,
 * because `runForgeObservedPolicyGame`'s masking only reveals the candidate
 * seat's own hand (`forge-play-card-rating.ts`'s doc comment) and the
 * observed backend requires exactly one `local` (candidate) seat and one
 * `engine` seat (`policy-evidence.ts`'s `validateSeats`): a single game can
 * only ever measure one deck of the pair. The two games swap which deck is
 * `local` so each deck gets exactly one measured game; in each game the
 * other deck is played by Forge's own built-in bot, not the policy under
 * test. `forgeEpisodeWinRateRow`/`forgePlayCardRatings` (`@mtg/metrics`) turn the
 * resulting win/loss rows into per-card ratings; this file only produces the
 * rows and assembles the artifact.
 *
 * `tableFor`/`resultOf` mirror `forge-stage-deck-outcome.ts`'s same-named,
 * unexported functions (re-implemented here since they are private there).
 * Deliberately NOT reused: `StageStrengthCampaign`, the A/B baseline-vs-
 * candidate statistical framework every other campaign in this directory
 * drives through — this tool measures one arm's absolute win rate, not a
 * comparison, so a game that throws propagates instead of degrading to a
 * synthetic `engine-failure` episode.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { botEvidenceSha256, type JsonValue } from '@mtg/bot-evidence';
import {
  preparePrintedLimitedFormat,
  printedSourceFingerprint,
  runPrintedLimitedDraft,
  type PreparedPrintedLimitedFormat,
  type PrintedBoosterPayload,
} from '@mtg/draft-export';
import type { DeckRef, ObservedBackend, SeatId, SessionSpec } from '@mtg/engine';
import {
  compileInstalledForgeBridge,
  runForgeObservedPolicyGame,
  strongestForgeObservedPolicy,
  type ForgeGameplayEvidenceRequest,
  type ForgeObservedDecisionPolicy,
  type ForgeObservedGameReport,
  type ForgeObservedPolicyGameOptions,
} from '@mtg/forge-export';
import { prepareLimitedDeck, toDeckRef } from '@mtg/limited';
import {
  cardWinRatesWhenDrawnFromRows,
  DEFAULT_METRICS_CONFIG,
  forgeEpisodeWinRateRow,
  forgePlayCardRatings,
  type ForgeGameplayEvidence,
  type MetricsConfig,
  type WinRateGameRow,
} from '@mtg/metrics';
import { parsePrintedCardCatalog, parsePrintedFormat, type PrintedCardCatalog } from '@mtg/printed-card';
import {
  PrintedDraftRatingsSchema,
  printedDraftRatingsFingerprintInput,
  type PrintedDraftRatings,
} from '../src/lab/printed-draft-ratings';
import { suggestPrintedDeck } from '../src/routes/printed/deck-evaluation';
import { PRINTED_GENERAL_BOT } from '../src/routes/printed/draft-bot';
import { printedLimitedFacts } from '../src/routes/printed/limited-facts';
import { admitPrintedBackend } from './admitted-printed-backend';
import { appendDurably } from './durable-write';
import { discoverForgeHome } from './forge-home';
import { bundleInstalledForgeAdapter } from './installed-adapter-bundle';
import { loadPrintedAdmissionSource, parsePrintedFormatRegistry } from './printed-format-registry';

const DEFAULT_MAXIMUM_TURNS = 200;
const DEFAULT_MAXIMUM_DECISIONS = 5_000;

export type ForgeBotPlayGameRunner = (
  options: ForgeObservedPolicyGameOptions,
) => ReturnType<typeof runForgeObservedPolicyGame>;

/** Mirrors `forge-stage-deck-outcome.ts`'s private `tableFor` (unexported there). */
function tableFor(
  formatId: string,
  gameSeed: string,
  focalSeat: SeatId,
  focalDeck: DeckRef,
  opponentDeck: DeckRef,
  maximumTurns: number,
): SessionSpec {
  const focal = { name: 'Candidate deck', controller: 'local' as const, deck: structuredClone(focalDeck) };
  const opponent = {
    name: 'Paired deck',
    controller: 'engine' as const,
    deck: structuredClone(opponentDeck),
  };
  return {
    content: { kind: 'printed', format: formatId },
    seats: focalSeat === 0 ? [focal, opponent] : [opponent, focal],
    seed: gameSeed,
    maximumTurns,
  };
}

/** Mirrors `forge-stage-deck-outcome.ts`'s private `resultOf` (unexported there). */
function resultOf(report: ForgeObservedGameReport, focalSeat: SeatId): 'win' | 'loss' | 'draw' | null {
  if (report.evidence.outcome.status !== 'completed') return null;
  const value = report.evidence.outcome.value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Completed Forge game has no structured winner');
  }
  const winner = (value as Readonly<Record<string, JsonValue>>)['winner'];
  if (winner === null) return 'draw';
  if (winner !== 0 && winner !== 1) throw new Error('Completed Forge game has an invalid winner');
  return winner === focalSeat ? 'win' : 'loss';
}

/**
 * `forgeEpisodeWinRateRow` reads a narrower shape than `BotEvidenceEpisode`
 * carries: the schema keeps `observation.value` optional (a caller may choose
 * not to retain it), while the win-rate reducer requires it to tell "empty
 * hand" from "value not kept." A decision with no retained value is treated
 * as an empty hand rather than dropped, matching `handNamesAt`'s tolerance
 * for any non-record `JsonValue`.
 */
function gameplayEvidence(evidence: ForgeObservedGameReport['evidence']): ForgeGameplayEvidence {
  return {
    episode: { id: evidence.episode.id },
    decisions: evidence.decisions.map((decision) => ({
      observation: { value: decision.observation.value ?? null },
    })),
  };
}

function subjectIdentity(prepared: PreparedPrintedLimitedFormat) {
  return {
    formatId: prepared.format.id,
    formatSha256: prepared.format.contentSha256,
    cardsSha256: botEvidenceSha256({
      catalogs: prepared.format.sources.map(({ code, catalogSha256 }) => ({ code, catalogSha256 })),
    }),
  };
}

export interface LoadedPrintedLimitedFormat {
  readonly prepared: PreparedPrintedLimitedFormat;
  readonly catalogs: readonly { readonly code: string; readonly catalog: PrintedCardCatalog }[];
}

function sha256Text(text: string): Promise<string> {
  return Promise.resolve(createHash('sha256').update(text).digest('hex'));
}

function formatSourceCodes(formatJson: unknown, formatId: string): readonly string[] {
  const sources = (formatJson as { readonly sources?: unknown } | null)?.sources;
  if (!Array.isArray(sources)) throw new Error(`${formatId}: format has no sources array`);
  return sources.map((source: unknown, index: number) => {
    const code = (source as { readonly code?: unknown } | null)?.code;
    if (typeof code !== 'string' || code.length === 0) {
      throw new Error(`${formatId}: source[${String(index)}] has no code`);
    }
    return code;
  });
}

/**
 * Loads a printed Limited format and its source catalogs directly from
 * `packages/data/data/<formatId>/`, by the on-disk naming convention every
 * printed format there follows: `<formatId>-limited-format-v1.json`, and per
 * source, `<code lowercased>-printed-catalog-v1.json`.
 */
export async function loadPrintedLimitedFormat(
  repoRoot: string,
  formatId: string,
): Promise<LoadedPrintedLimitedFormat> {
  const directory = join(repoRoot, 'packages/data/data', formatId);
  const formatJson = JSON.parse(
    readFileSync(join(directory, `${formatId}-limited-format-v1.json`), 'utf8'),
  ) as unknown;
  const catalogs = formatSourceCodes(formatJson, formatId).map((code) => ({
    code,
    catalog: parsePrintedCardCatalog(
      JSON.parse(readFileSync(join(directory, `${code.toLowerCase()}-printed-catalog-v1.json`), 'utf8')),
    ),
  }));
  const prepared = await preparePrintedLimitedFormat(
    formatJson,
    catalogs.map(({ catalog }) => catalog),
    sha256Text,
  );
  return { prepared, catalogs };
}

export interface ForgeBotPlayDraftRatingsCampaignOptions {
  readonly loaded: LoadedPrintedLimitedFormat;
  readonly backend: ObservedBackend;
  readonly policy: ForgeObservedDecisionPolicy;
  /** The Forge toolchain identity recorded on every game and on the artifact's `bridgeFingerprint`. */
  readonly runtimeVersion: string;
  readonly runtimeBuildSha256: string;
  /** Full pods drafted; each pod plays `floor(seats / 2) * 2` games. */
  readonly drafts: number;
  readonly seed: string;
  /** Append-only, resumable evidence. One durable record is written per finished game seed. */
  readonly evidencePath: string;
  readonly maximumTurns?: number;
  readonly maximumDecisions?: number;
  readonly config?: MetricsConfig;
}

interface ForgeBotPlayDraftRatingsEvidenceRecord {
  readonly gameSeed: string;
  readonly completed: boolean;
  readonly row: WinRateGameRow | null;
}

function evidenceRecord(input: unknown, lineNumber: number): ForgeBotPlayDraftRatingsEvidenceRecord {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error(`Bot-play rating evidence line ${String(lineNumber)} is not an object`);
  }
  const value = input as Record<string, unknown>;
  if (typeof value['gameSeed'] !== 'string' || value['gameSeed'].trim() === '') {
    throw new Error(`Bot-play rating evidence line ${String(lineNumber)} has no game seed`);
  }
  if (typeof value['completed'] !== 'boolean') {
    throw new Error(`Bot-play rating evidence line ${String(lineNumber)} has no completion flag`);
  }
  const row = value['row'];
  if (row !== null && !isWinRateGameRow(row)) {
    throw new Error(`Bot-play rating evidence line ${String(lineNumber)} has an invalid win-rate row`);
  }
  return { gameSeed: value['gameSeed'], completed: value['completed'], row };
}

function isWinRateGameRow(input: unknown): input is WinRateGameRow {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  if (typeof value['won'] !== 'boolean' || typeof value['fingerprint'] !== 'string') return false;
  const cards = value['cards'];
  if (typeof cards !== 'object' || cards === null || Array.isArray(cards)) return false;
  return Object.values(cards).every((counts) => {
    if (typeof counts !== 'object' || counts === null || Array.isArray(counts)) return false;
    const card = counts as Record<string, unknown>;
    return (
      Number.isInteger(card['opening_hand']) &&
      (card['opening_hand'] as number) >= 0 &&
      Number.isInteger(card['drawn']) &&
      (card['drawn'] as number) >= 0
    );
  });
}

function readEvidence(path: string): readonly ForgeBotPlayDraftRatingsEvidenceRecord[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  if (!text.endsWith('\n')) {
    lines.pop();
    const completeText = text.slice(0, text.lastIndexOf('\n') + 1);
    truncateSync(path, Buffer.byteLength(completeText));
  }
  const records = lines
    .filter((line) => line.trim() !== '')
    .map((line, index) => evidenceRecord(JSON.parse(line) as unknown, index + 1));
  const seeds = new Set(records.map((record) => record.gameSeed));
  if (seeds.size !== records.length) throw new Error('Bot-play rating evidence repeats a game seed');
  return records;
}

export interface ForgeBotPlayDraftRatingsCampaignResult {
  readonly artifact: PrintedDraftRatings;
  readonly gamesPlayed: number;
  readonly gamesCompleted: number;
}

export function formatForgeBotPlayDraftRatingsSummary(artifact: PrintedDraftRatings): string {
  const cards = artifact.catalogs.flatMap((catalog) => catalog.cards);
  const rated = cards.filter((card) => card.quality !== null).length;
  const unratedGamesSeen = cards
    .filter((card) => card.quality === null)
    .map((card) => card.gamesSeen ?? 0)
    .sort((left, right) => left - right);
  if (unratedGamesSeen.length === 0) {
    return `${String(rated)}/${String(cards.length)} cards rated; unrated gamesSeen min/median/max n/a`;
  }
  const middle = Math.floor(unratedGamesSeen.length / 2);
  const median =
    unratedGamesSeen.length % 2 === 1
      ? unratedGamesSeen[middle]!
      : (unratedGamesSeen[middle - 1]! + unratedGamesSeen[middle]!) / 2;
  return (
    `${String(rated)}/${String(cards.length)} cards rated; unrated gamesSeen min/median/max ` +
    `${String(unratedGamesSeen[0])}/${String(median)}/${String(unratedGamesSeen.at(-1))}`
  );
}

export async function runForgeBotPlayDraftRatingsCampaign(
  options: ForgeBotPlayDraftRatingsCampaignOptions,
  runGame: ForgeBotPlayGameRunner = runForgeObservedPolicyGame,
): Promise<ForgeBotPlayDraftRatingsCampaignResult> {
  const { loaded, backend, policy, runtimeVersion, runtimeBuildSha256 } = options;
  const maximumTurns = options.maximumTurns ?? DEFAULT_MAXIMUM_TURNS;
  const maximumDecisions = options.maximumDecisions ?? DEFAULT_MAXIMUM_DECISIONS;
  const config = options.config ?? DEFAULT_METRICS_CONFIG;
  const subject = subjectIdentity(loaded.prepared);

  mkdirSync(dirname(options.evidencePath), { recursive: true });
  let evidence = readEvidence(options.evidencePath);
  const recordedSeeds = new Set(evidence.map((record) => record.gameSeed));

  for (let draftIndex = 0; draftIndex < options.drafts; draftIndex += 1) {
    const draftSeed = `${options.seed}/draft-${String(draftIndex)}`;
    const progress = runPrintedLimitedDraft(loaded.prepared, { seed: draftSeed, ...PRINTED_GENERAL_BOT });
    const result = progress.result;
    if (result === null) throw new Error(`${subject.formatId}: draft ${draftSeed} did not complete`);

    const decks = result.seats.map((seat) => {
      const pool = seat.picks.map(
        (pick) => pick.card as typeof pick.card & { readonly payload: PrintedBoosterPayload },
      );
      const initial = prepareLimitedDeck(pool, (card) => printedLimitedFacts(card.payload.printing));
      return toDeckRef(suggestPrintedDeck(initial), `${seat.seatId} (${draftSeed})`);
    });

    for (let pairIndex = 0; pairIndex + 1 < decks.length; pairIndex += 2) {
      const deckA = decks[pairIndex]!;
      const deckB = decks[pairIndex + 1]!;
      for (const candidateSeat of [0, 1] as const) {
        // The candidate seat must be the measured deck's seat (`validateSeats`
        // requires `local` at `candidateSeat`), so which deck is `focalDeck`
        // has to flip in step with `candidateSeat`, not stay fixed to deckA —
        // otherwise deckB's hand is never revealed and its cards never rated.
        const [focalDeck, opponentDeck] = candidateSeat === 0 ? [deckA, deckB] : [deckB, deckA];
        const gameSeed = `${draftSeed}/pair-${String(pairIndex)}/seat-${String(candidateSeat)}`;
        if (recordedSeeds.has(gameSeed)) continue;
        const evidenceRequest: ForgeGameplayEvidenceRequest = {
          id: `forge-bot-play-draft-ratings/${subject.formatId}/${gameSeed}`,
          runtime: { version: runtimeVersion, buildSha256: runtimeBuildSha256 },
          subject,
          modelSha256: null,
          dataSha256: null,
          lineage: { setId: subject.formatId, draftId: draftSeed, gameId: gameSeed },
          splitGroup: { kind: 'game', id: gameSeed },
        };
        const report = await runGame({
          backend,
          table: tableFor(subject.formatId, gameSeed, candidateSeat, focalDeck, opponentDeck, maximumTurns),
          candidateSeat,
          policy,
          evidence: evidenceRequest,
          maximumDecisions,
        });
        const outcome = resultOf(report, candidateSeat);
        const row =
          outcome === 'win' || outcome === 'loss'
            ? forgeEpisodeWinRateRow(gameplayEvidence(report.evidence), outcome === 'win')
            : null;
        const record: ForgeBotPlayDraftRatingsEvidenceRecord = {
          gameSeed,
          completed: report.evidence.outcome.status === 'completed',
          row,
        };
        appendDurably(options.evidencePath, `${JSON.stringify(record)}\n`);
        evidence = [...evidence, record];
        recordedSeeds.add(gameSeed);
      }
    }
  }

  const gamesPlayed = evidence.length;
  const gamesCompleted = evidence.filter((record) => record.completed).length;
  const rows = evidence.flatMap((record) => (record.row === null ? [] : [record.row]));

  if (gamesCompleted === 0) {
    throw new Error(
      `${subject.formatId}: 0 of ${String(gamesPlayed)} games completed; Forge refused, aborted, or timed ` +
        'out every game, so no card can be rated',
    );
  }

  const cardNames = loaded.catalogs.flatMap(({ catalog }) => catalog.cards.map((card) => card.correctedName));
  const ratings = forgePlayCardRatings(cardNames, rows, config);
  const qualityByName = new Map(ratings.map((rating) => [rating.cardName, rating.quality]));
  const gamesSeenByName = new Map(
    cardWinRatesWhenDrawnFromRows(rows, config).map((record) => [
      record.cardName,
      record.winRate.distinctSamples,
    ]),
  );

  const catalogs = loaded.catalogs.map(({ code, catalog }) => ({
    code,
    catalogSha256: catalog.contentSha256,
    cards: catalog.cards.map((card) => ({
      physicalId: card.physicalId,
      sourceFingerprint: printedSourceFingerprint(card),
      quality: qualityByName.get(card.correctedName) ?? null,
      gamesSeen: gamesSeenByName.get(card.correctedName) ?? 0,
    })),
  }));

  const ratingSource = {
    kind: 'forge-bot-play-win-rate' as const,
    version: runtimeVersion,
    bridgeFingerprint: runtimeBuildSha256,
  };
  const fingerprint = createHash('sha256')
    .update(printedDraftRatingsFingerprintInput(ratingSource, catalogs))
    .digest('hex');
  const artifact = PrintedDraftRatingsSchema.parse({
    schemaVersion: 1,
    kind: 'printed-draft-ratings',
    source: { ...ratingSource, fingerprint, gamesPlayed, gamesCompleted, cardFloor: config.floors.card },
    catalogs,
  });
  return { artifact, gamesPlayed, gamesCompleted };
}

interface CliOptions {
  readonly formatId: string;
  readonly outPath: string;
  readonly evidencePath: string;
  readonly drafts: number;
  readonly seed: string;
  readonly maximumTurns: number;
  readonly maximumDecisions: number;
}

const CLI_USAGE =
  'usage: tsx packages/ui/tools/forge-bot-play-draft-ratings.ts --format <akh-hou|m15> --out <path> ' +
  '--evidence <path> ' +
  '[--drafts <n>] [--seed <text>] [--maximum-turns <n>] [--maximum-decisions <n>]';

function parseCliOptions(args: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === undefined || !flag.startsWith('--') || value === undefined) throw new Error(CLI_USAGE);
    values.set(flag.slice(2), value);
  }
  const formatId = values.get('format');
  const out = values.get('out');
  const evidence = values.get('evidence');
  if (
    formatId === undefined ||
    formatId.trim() === '' ||
    out === undefined ||
    out.trim() === '' ||
    evidence === undefined ||
    evidence.trim() === ''
  ) {
    throw new Error(CLI_USAGE);
  }
  const positiveInteger = (key: string, fallback: number): number => {
    const raw = values.get(key);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) throw new Error(`--${key} must be a positive integer`);
    return value;
  };
  return {
    formatId,
    outPath: resolve(out),
    evidencePath: resolve(evidence),
    drafts: positiveInteger('drafts', 1),
    seed: values.get('seed') ?? `forge-bot-play-draft-ratings/${formatId}`,
    maximumTurns: positiveInteger('maximum-turns', DEFAULT_MAXIMUM_TURNS),
    maximumDecisions: positiveInteger('maximum-decisions', DEFAULT_MAXIMUM_DECISIONS),
  };
}

/**
 * A drafted Limited deck is never inside `AUDITED_FORGE_CARDS` (the fixed,
 * hand-curated slice `installedForgeBackend` checks decks against), so this
 * campaign — like every other printed campaign — admits the format's whole
 * card list through `admitPrintedBackend` first (`isd-limited-draft-campaign.ts`,
 * `forge-bot-strength-pilot.ts` are the same pattern). Without that admission
 * every drafted game came back `unsupported` and the CLI wrote an all-null
 * artifact while exiting 0.
 */
async function runForgeBotPlayDraftRatingsCli(repoRoot: string, argv: readonly string[]): Promise<void> {
  const options = parseCliOptions(argv);
  const loaded = await loadPrintedLimitedFormat(repoRoot, options.formatId);

  const forgeHome = discoverForgeHome(repoRoot);
  if (forgeHome === undefined) throw new Error('Pinned Forge distribution was not found.');
  const registry = parsePrintedFormatRegistry(
    repoRoot,
    JSON.parse(readFileSync(join(repoRoot, 'packages/data/data/printed-formats-v1.json'), 'utf8')),
  );
  const source = registry.find(
    (candidate) =>
      parsePrintedFormat(JSON.parse(readFileSync(join(candidate.directory, candidate.formatFile), 'utf8')))
        .id === options.formatId,
  );
  if (source === undefined) throw new Error(`Printed registry has no ${options.formatId} format.`);
  const admissionSource = loadPrintedAdmissionSource(source);
  if (admissionSource === undefined) throw new Error(`${options.formatId} has no installed play admission.`);

  const scratchParent = join(repoRoot, 'out/tmp');
  mkdirSync(scratchParent, { recursive: true });
  const scratch = mkdtempSync(join(scratchParent, 'forge-bot-play-draft-ratings-'));
  let compiled: ReturnType<typeof compileInstalledForgeBridge> = null;
  let backend: ObservedBackend | null = null;
  try {
    compiled = compileInstalledForgeBridge({ forgeHome, outputParent: scratch });
    if (compiled === null) throw new Error('Pinned Forge bridge could not be compiled.');
    const adapterBundlePath = await bundleInstalledForgeAdapter(repoRoot, join(scratch, 'adapter'));
    const snapshots = join(scratch, 'snapshots');
    mkdirSync(snapshots);
    const admitted = await admitPrintedBackend({
      ...admissionSource,
      runtime: {
        forgeHome,
        bridge: { kind: 'compiled', path: compiled.classDirectory },
        adapterBundlePath,
      },
      outputParent: snapshots,
    });
    if (!admitted.admitted) {
      process.stderr.write(
        `${options.formatId}: Forge play admission refused: ${JSON.stringify(admitted.reasons)}\n`,
      );
      process.exitCode = 1;
      return;
    }
    backend = admitted.backend;

    const { artifact, gamesPlayed, gamesCompleted } = await runForgeBotPlayDraftRatingsCampaign({
      loaded,
      backend: admitted.backend,
      policy: strongestForgeObservedPolicy,
      runtimeVersion: admitted.subject.forgeVersion,
      runtimeBuildSha256: admitted.subject.bridgeSha256,
      drafts: options.drafts,
      seed: options.seed,
      evidencePath: options.evidencePath,
      maximumTurns: options.maximumTurns,
      maximumDecisions: options.maximumDecisions,
    });
    mkdirSync(dirname(options.outPath), { recursive: true });
    writeFileSync(options.outPath, `${JSON.stringify(artifact, null, 2)}\n`);
    process.stdout.write(
      `${options.formatId}: ${String(gamesCompleted)}/${String(gamesPlayed)} games completed across ` +
        `${String(options.drafts)} draft(s), wrote ${options.outPath}\n` +
        `${options.formatId}: ${formatForgeBotPlayDraftRatingsSummary(artifact)}\n`,
    );
  } finally {
    try {
      await backend?.shutdown?.();
    } finally {
      compiled?.dispose();
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}

const invoked =
  process.argv[1] === undefined ? false : resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  await runForgeBotPlayDraftRatingsCli(repoRoot, process.argv.slice(2));
}
