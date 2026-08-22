/**
 * `npm run analyze` — measure a set, and write down whether it is fair.
 *
 *   npm run analyze                       # the set `npm run play` would open
 *   npm run analyze -- out/XMP/set.json   # a named set
 *   npm run analyze -- --games 40 --label "rev 3" --id xmp-r3
 *
 * It resolves a set, builds one deck per color pair, plays the seeded round
 * robin, scores it with `@mtg/metrics`, and writes an analysis document into
 * `packages/ui/public/analysis.json` — where the lab's Analysis tab reads it.
 * Then it prints the answer. That is the whole loop the playtester asked for and
 * did not have: ask, read, change something, ask again.
 *
 * Documents accumulate by `id`. Running it twice with two ids leaves two runs
 * in the file, which is what the revision diff compares; running it twice with
 * one id replaces that run in place. The file is gitignored and recorded
 * rather than committed, for the same reason `replay.events.jsonl` is: it is
 * megabytes, and a committed one stops matching the engine the day the kernel
 * changes how a game plays.
 *
 * =====================================================================
 * THE DECISION: why this is a command and not an endpoint
 * =====================================================================
 *
 * `mtg-ulu7` asks for runs to be *scheduled from the analysis*, not only read
 * there. A browser page cannot spawn a simulation, so that needs one of three
 * things, and the choice is load-bearing rather than a detail.
 *
 * **(a) A local endpoint the lab posts to.** `@mtg/netplay` proves the shape
 * works in this repo — `node:http`, four routes, a `readSeatRequest`-style
 * `T | string` narrower at the boundary, a `randomUUID` capability per seat,
 * and `/wait?since=N` already implements revision-based long polling, which is
 * exactly the idiom an asynchronous job needs. Nothing would have to be
 * invented.
 *
 * **(b) A requested-run artifact the page writes, picked up by a CLI.** This
 * one does not survive contact: a page cannot write to disk either. Every
 * version of it is (a) with a file instead of a function — the page still has
 * to POST to something that can write, and that something is a listener with
 * all of (a)'s exposure and none of its ability to report progress. It is
 * named here because it reads plausible in a bead and is not an option.
 *
 * **(c) The analysis lives outside the browser.** This file. The run is a
 * command, its output is a document, and the page reads documents.
 *
 * **(c) is chosen, and (a) is deliberately deferred rather than rejected** —
 * `mtg-ulu7.3` holds its design. The argument is not that an endpoint is hard.
 * It is that the endpoint is the only piece with a security cost, the rest of
 * the epic does not need it, and building it first would put an unbounded
 * compute primitive on the machine before anything used it.
 *
 * ## What it costs to choose (c)
 *
 * A person who wants a fresh measurement types a command in a terminal instead
 * of pressing a button in the page. Concretely: the page can show that a
 * question needs data nobody has produced, and name the exact command that
 * would produce it, but it cannot start it and cannot show progress. For a
 * 55-85 second sweep that is a real cost and an honest one.
 *
 * ## What an attacker who reached a run endpoint could do
 *
 * This is written down now because the constraint is not obvious and the
 * obvious mitigation does not work.
 *
 * **Binding to 127.0.0.1 does not make a run endpoint unreachable here.**
 * `packages/ui/vite.config.ts` binds every interface (`host: true`,
 * `allowedHosts: ['.ts.net']`) and proxies `/api` straight to loopback, and a
 * Tailscale forwarder on this machine picks up dev ports. So the loopback bind
 * protects the endpoint from the open internet and from nobody else: anyone
 * who can reach the lab reaches the endpoint through Vite's own proxy. Loopback
 * is necessary and is not sufficient, and a design that stops there has
 * mistaken the bind for the boundary.
 *
 * Given that, an unguarded `POST /api/runs` would hand whoever can reach the
 * page:
 *
 *  1. **Unbounded compute.** One sweep is 10,035 games and 55-85 seconds of
 *     every core; `@mtg/sim`'s pool takes `availableParallelism()` outside a
 *     vitest worker. N concurrent requests take N times the whole machine.
 *     A loop is a trivial local denial of service against every other lane on
 *     the box.
 *  2. **Arbitrary file read.** A run request naming a *set path* is a path a
 *     server hands to `readFileSync`. `resolve-set.ts` quotes what it found
 *     when a file is not a set document, so the refusal is an oracle: the
 *     endpoint reads a file and reports on its contents. Any run endpoint must
 *     take an **id chosen from a server-side enumeration**, never a path.
 *  3. **Disk.** Documents accumulate; a request loop fills the volume.
 *
 * So the four constraints `mtg-ulu7.3` is filed with, none of them optional:
 * bind loopback *and* require the per-session capability token the way
 * `@mtg/netplay` does, since the proxy makes the bind insufficient on its own;
 * accept an id from an enumeration rather than a path; run at most one job at
 * a time and refuse the second with the running job's id; cap the games a
 * request may ask for. A scheduler a page can reach is an attack surface, and
 * it is the only part of this epic that is one.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import type { DeckList } from '@mtg/kernel';
import type { PreconFile } from '@mtg/deckbuild';
import { COLOR_PAIRS, buildDeckForPair, buildPrecon, colorPairKey } from '@mtg/deckbuild';
import { greedySpec, runRoundRobin } from '@mtg/sim';
import { formatFairness } from '@mtg/metrics';
import { deriveSkeletonLite } from '@mtg/design-data';
import { resolveSet } from './resolve-set';
import type { ResolvedSet } from './resolve-set';
import { flagshipOnly, SET_CANDIDATES } from './set-candidates';
import { buildAnalysisRun, skeletonTargets } from './analysis-run';
import type { AnalysisDocument } from './analysis-run';
import type { PreconAnalysisDeck, PreconSeatOrderRun } from './analysis-run';
import { choosePreconFile, preconCandidatesFor } from './stage-precons';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

/** Where the Analysis tab reads its documents from. Gitignored; recorded. */
export const ANALYSIS_FILENAME = 'analysis.json';

/**
 * Games per color-pair matchup.
 *
 * Forty-five matchups, so the default is 2,700 games — a few seconds, and
 * enough for the pair floors at 200 distinct games to be in reach for most
 * pairs. The balance gate's own pinned volume is 223, and `--games` reaches it
 * when somebody wants the gate's exact numbers rather than a working answer.
 */
const DEFAULT_GAMES = 60;
const DEFAULT_PRECON_GAMES = 60;
const DEFAULT_SEED = 'mtg-analysis/v0';

interface Args {
  readonly setPath: string | undefined;
  readonly games: number;
  readonly preconGames: number;
  readonly seed: string;
  readonly id: string | undefined;
  readonly label: string | undefined;
  readonly help: boolean;
}

const USAGE = `
npm run analyze -- [set.json] [options]

  --games <n>     games per color-pair matchup (default ${String(DEFAULT_GAMES)}, 45 matchups)
  --precon-games <n>  games per written-deck matchup (default ${String(DEFAULT_PRECON_GAMES)})
  --seed <s>      run seed (default ${DEFAULT_SEED})
  --id <s>        document id; the same id replaces, a new one accumulates
  --label <s>     how the run is named in the picker
  --help

Writes packages/ui/public/${ANALYSIS_FILENAME} and prints whether the set is fair.
`;

function fail(message: string): never {
  process.stderr.write(`\nnpm run analyze: ${message}\n\n`);
  process.exit(1);
}

/**
 * Argv in, `Args` out, with an unknown flag a hard error.
 *
 * The same refusal `@mtg/slice`'s parser makes and for its reason: a
 * misspelled flag that is silently ignored produces a run measured under
 * settings nobody chose, and the number it prints looks exactly like the right
 * one.
 */
export function parseArgs(argv: readonly string[]): Args {
  let setPath: string | undefined;
  let games = DEFAULT_GAMES;
  let preconGames = DEFAULT_PRECON_GAMES;
  let seed = DEFAULT_SEED;
  let id: string | undefined;
  let label: string | undefined;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (!token.startsWith('--')) {
      if (setPath !== undefined) throw new Error(`two sets named: ${setPath} and ${token}`);
      setPath = token;
      continue;
    }
    if (token === '--help') {
      help = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${token} needs a value`);
    index += 1;
    switch (token) {
      case '--games': {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`--games wants a positive integer`);
        games = parsed;
        break;
      }
      case '--precon-games': {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new Error(`--precon-games wants a positive integer`);
        }
        preconGames = parsed;
        break;
      }
      case '--seed':
        seed = value;
        break;
      case '--id':
        id = value;
        break;
      case '--label':
        label = value;
        break;
      default:
        throw new Error(`unknown flag ${token}`);
    }
  }
  return { setPath, games, preconGames, seed, id, label, help };
}

function poolOf(set: ResolvedSet): readonly Card[] {
  const parsed: unknown = JSON.parse(set.json);
  const { cards } = parsed as { cards: readonly unknown[] };
  return cards.map((card) => parseCard(card));
}

function setRefOf(set: ResolvedSet): { readonly code: string; readonly name: string } {
  const parsed: unknown = JSON.parse(set.json);
  const raw = parsed as { set?: { code?: unknown; name?: unknown } };
  const code = typeof raw.set?.code === 'string' ? raw.set.code : 'SET';
  const name = typeof raw.set?.name === 'string' ? raw.set.name : set.path;
  return { code, name };
}

function decksFor(pool: readonly Card[]): readonly DeckList[] {
  return COLOR_PAIRS.map((pair) => ({
    name: colorPairKey(pair),
    cards: buildDeckForPair(pool, pair).deck,
  }));
}

function contentHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function preconDecksFor(file: PreconFile, pool: readonly Card[]): readonly PreconAnalysisDeck[] {
  const ids = new Set<string>();
  const names = new Set<string>();
  return file.decks.map((deck) => {
    if (ids.has(deck.id)) throw new Error(`precon file repeats deck id ${deck.id}`);
    if (names.has(deck.name)) throw new Error(`precon file repeats deck name ${deck.name}`);
    ids.add(deck.id);
    names.add(deck.name);
    return {
      id: deck.id,
      name: deck.name,
      plan: deck.plan,
      payoff: deck.payoff,
      contentHash: contentHash(deck),
      cards: buildPrecon(deck, pool).deck,
    };
  });
}

/**
 * The documents already on disk, minus the one being replaced.
 *
 * A file that cannot be read is a hard stop rather than an overwrite: the run
 * that produced it cost a minute of somebody's machine, and silently replacing
 * a file the reader tripped over is how that minute disappears.
 */
export function mergeDocuments(
  existing: readonly AnalysisDocument[],
  fresh: AnalysisDocument,
): readonly AnalysisDocument[] {
  return [...existing.filter((document) => document.id !== fresh.id), fresh];
}

function readExisting(path: string): readonly AnalysisDocument[] {
  if (!existsSync(path)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause: unknown) {
    fail(
      `${path} is not valid JSON (${cause instanceof Error ? cause.message : String(cause)}). Delete it to start over.`,
    );
  }
  const { runs } = parsed as { runs?: unknown };
  if (!Array.isArray(runs)) fail(`${path} has no "runs" array. Delete it to start over.`);
  return runs as readonly AnalysisDocument[];
}

async function main(argv: readonly string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (cause: unknown) {
    fail(cause instanceof Error ? cause.message : String(cause));
  }
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  // The same resolution `npm run play` uses, for the reason the usage line
  // above gives: this reports on the set the lab opens, so it has to find the
  // set the lab finds. Without the filter it resolved `out/XMP/set.json` — a run
  // of the flagship brief that predates a counter rename and that the DSL now
  // rejects outright, so `npm run analyze` failed on a set `npm run play` had
  // already learned to skip. A named path is exempt, as it is there: the filter
  // narrows the search, never an answer the caller supplied.
  const candidates = args.setPath === undefined ? flagshipOnly(SET_CANDIDATES) : SET_CANDIDATES;
  const resolved = resolveSet(candidates, args.setPath, { cwd: REPO_ROOT });
  if (!resolved.ok) fail(resolved.message);

  const pool = poolOf(resolved);
  const setRef = setRefOf(resolved);
  const decks = decksFor(pool);
  process.stdout.write(
    `analyzing ${setRef.code} (${String(resolved.cardCount)} cards) from ${resolved.path}\n` +
      `${String(decks.length)} decks, ${String((decks.length * (decks.length - 1)) / 2)} matchups x ${String(args.games)} games, seed ${args.seed}\n`,
  );

  const started = Date.now();
  const run = await runRoundRobin(decks, {
    runSeed: args.seed,
    gamesPerMatchup: args.games,
    collectLogs: true,
    botFor: (deck: DeckList) => greedySpec(`greedy:${deck.name}`),
  });
  const preconSearch = choosePreconFile(
    preconCandidatesFor(resolved.path, REPO_ROOT),
    pool.map((card) => card.id),
  );
  let precons:
    | {
        readonly decks: readonly PreconAnalysisDeck[];
        readonly seatRuns: readonly PreconSeatOrderRun[];
      }
    | undefined;
  if (preconSearch.chosen !== null) {
    if (preconSearch.chosen.file.setCode !== setRef.code) {
      fail(
        `${preconSearch.chosen.candidate.path} says set ${preconSearch.chosen.file.setCode}, not ${setRef.code}`,
      );
    }
    const written = preconDecksFor(preconSearch.chosen.file, pool);
    if (written.length < 2)
      fail(`${preconSearch.chosen.candidate.path} needs at least two decks for a matchup`);
    process.stdout.write(
      `precons: ${String(written.length)} decks, ${String((written.length * (written.length - 1)) / 2)} matchups x ${String(args.preconGames)} games x 2 seat orders\n`,
    );
    const orders: readonly (readonly PreconAnalysisDeck[])[] = [written, [...written].reverse()];
    const seatRuns: PreconSeatOrderRun[] = [];
    for (const [index, ordered] of orders.entries()) {
      const runSeed = `${args.seed}/precons/seat-${String(index)}`;
      const preconRun = await runRoundRobin(ordered, {
        runSeed,
        gamesPerMatchup: args.preconGames,
        collectLogs: false,
        botFor: (deck: DeckList) => greedySpec(`greedy:${deck.name}`),
      });
      seatRuns.push({ decks: ordered, run: preconRun, runSeed });
    }
    precons = { decks: written, seatRuns };
  }
  const elapsed = (Date.now() - started) / 1000;

  const id = args.id ?? `${setRef.code.toLowerCase()}-${args.seed.replace(/[^a-z0-9]+/gi, '-')}`;
  const label = args.label ?? `${setRef.code} — ${String(run.games)} games`;
  const document = buildAnalysisRun({
    id,
    label,
    seed: args.seed,
    set: setRef,
    producedBy: `npm run analyze -- ${resolved.path} --games ${String(args.games)} --seed ${args.seed}`,
    pool,
    decks,
    logs: run.logs,
    targets: skeletonTargets(deriveSkeletonLite()),
    healthLabel:
      `${String(decks.length)} color pairs, ${String(run.matchups)} matchups x ${String(run.gamesPerMatchup)} games, ` +
      `greedy v0 bots on ${setRef.name}, decks built by @mtg/deckbuild`,
    ...(precons === undefined ? {} : { precons }),
  });

  const publicDir = join(UI_ROOT, 'public');
  const path = join(publicDir, ANALYSIS_FILENAME);
  const runs = mergeDocuments(readExisting(path), document);
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(path, `${JSON.stringify({ runs }, null, 2)}\n`, 'utf8');

  // Printed from the document rather than recomputed, so the terminal and the
  // page cannot disagree. The three fields the block drops are on the health
  // block beside it, which is the whole reason it drops them.
  process.stdout.write(
    `\n${String(run.games)} games in ${elapsed.toFixed(1)}s (${run.gamesPerSecond.toFixed(0)} games/s)\n\n` +
      formatFairness({
        label: document.health.label,
        games: document.health.games,
        distinctGames: document.health.distinctGames,
        ...document.fairness,
      }) +
      `\nwrote ${path} (${String(runs.length)} run${runs.length === 1 ? '' : 's'}); open it with \`npm run play\` and the Analysis tab\n`,
  );
  // 1 when the set is not fair, so a script can tell it from a set that is or
  // from a run that could not say. `unjudged` is not a failure of the set.
  return document.fairness.verdict === 'unfair' ? 1 : 0;
}

process.exitCode = await main(process.argv.slice(2));
