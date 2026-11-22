/**
 * `mtg-h76gz.2`: the offline Jev labeler study.
 *
 *   tsx packages/draft-export/tools/jev-label/cli.ts label --set <set.json> \
 *     --seed-prefix <text> --out out/jev-h76gz2/labels.jsonl \
 *     --env-file <path to a dotenv file that sets the provider key> \
 *     [--collation <draft collation json>] \
 *     [--provider gateway|direct] \
 *     [--decisions 900] [--repeats 100] [--gap-ms 5000] [--max-requests 1050] \
 *     [--max-usd <dollars>]
 *
 *   tsx packages/draft-export/tools/jev-label/cli.ts score --set <set.json> \
 *     --records out/jev-h76gz2/labels.jsonl --strength <draft campaign.json> \
 *     [--min-appearances 5]
 *
 * `label` is the one command that calls Jev. It is resumable (rerun the
 * same command and it skips every decision already recorded), it stops at the
 * first rate limit or gateway charge rather than retrying past either, unless
 * `--max-usd` states a ceiling (no default, no environment variable: there must
 * be no way to spend by forgetting a flag), in which case it spends up to that
 * ceiling across the whole record, resumes included. The direct provider
 * reserves twice the published maximum request cost before each call because
 * its response reports tokens but no charge. It prints counts only: the key is
 * never written to the record, a log or stdout.
 * `score` reads the record and a `calibrate:draft-campaign` artifact and calls
 * nothing.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { RARITIES, parseCardsDocumentJson } from '@mtg/dsl';
import type { BoosterRecipe } from '@mtg/deckbuild';
import { rateCards } from '../../src/index';
import { studyDecisions } from './decisions';
import type { LabelDecision } from './decisions';
import { GATEWAY_KEY_VARIABLE, readApiKey } from './gateway-key';
import { createJevClient, createJevDirectClient, JEV_DIRECT_KEY_VARIABLE } from './jev-client';
import { answersOf, appendRecord, readRecords, spendOf } from './record';
import { doneKey, JEV_DIRECT_REQUEST_UPPER_BOUND_USD, runPlan, workPlan } from './runner';
import { formatReport } from './report';
import {
  DEFAULT_MIN_APPEARANCES,
  agreement,
  cardLevel,
  disagreement,
  primaryViews,
  stability,
} from './score';

/** The floor for a gap this tool will accept: a burst of five calls 0.4 s apart is what tripped the limit. */
const MIN_GAP_MS = 1000;

/** What a test substitutes; a run from the command line leaves all of it unset. */
export interface CliDeps {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly write?: (text: string) => void;
}

function parseFlags(argv: readonly string[]): ReadonlyMap<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || !flag.startsWith('--')) throw new Error(`unexpected argument ${String(flag)}`);
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flags.has(flag)) throw new Error(`${flag} was given twice`);
    flags.set(flag, value);
  }
  return flags;
}

function required(flags: ReadonlyMap<string, string>, flag: string): string {
  const value = flags.get(flag);
  if (value === undefined || value === '') throw new Error(`${flag} is required`);
  return value;
}

function integer(
  flags: ReadonlyMap<string, string>,
  flag: string,
  fallback: number,
  minimum: number,
): number {
  const raw = flags.get(flag);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${flag} must be an integer of at least ${String(minimum)}, received ${String(raw)}`);
  }
  return value;
}

/** A positive dollar amount, or undefined when the flag is absent; there is no default. */
function ceilingUsd(flags: ReadonlyMap<string, string>): number | undefined {
  const raw = flags.get('--max-usd');
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`--max-usd must be a positive number of dollars, received ${raw}`);
  }
  return value;
}

type LabelProvider = 'gateway' | 'direct';

function labelProvider(flags: ReadonlyMap<string, string>): LabelProvider {
  const value = flags.get('--provider') ?? 'gateway';
  if (value !== 'gateway' && value !== 'direct') {
    throw new Error(`--provider must be gateway or direct, received ${value}`);
  }
  return value;
}

function assertKnown(flags: ReadonlyMap<string, string>, known: readonly string[]): void {
  for (const flag of flags.keys()) {
    if (!known.includes(flag)) throw new Error(`unknown argument ${flag}`);
  }
}

const CollationFileSchema = z.object({
  recipe: z
    .array(
      z.object({
        rarity: z.enum(RARITIES),
        count: z.number().int().positive(),
        rarityWeights: z
          .array(z.object({ rarity: z.enum(RARITIES), weight: z.number().positive() }))
          .min(1)
          .optional(),
      }),
    )
    .min(1),
});

/** The booster recipe out of a draft collation file, the document `calibrate:draft-campaign` reads. */
function readRecipe(path: string): BoosterRecipe {
  return CollationFileSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).recipe;
}

/**
 * A record is resumed by decision key, so a record taken under a different plan
 * (another set, seed prefix or collation) would be skipped as done while
 * answering a different question. Refuse that instead of trusting the key.
 */
function assertRecordMatchesPlan(
  decisions: readonly LabelDecision[],
  answers: ReturnType<typeof answersOf>,
): void {
  const packs = new Map(decisions.map((decision) => [decision.key, decision.pack.map((card) => card.id)]));
  for (const answer of answers) {
    const expected = packs.get(answer.key);
    if (expected !== undefined && expected.join('\n') !== answer.packIds.join('\n')) {
      throw new Error(
        `${answer.key} was recorded with a different pack than this plan deals; the record belongs to another run`,
      );
    }
  }
}

async function label(argv: readonly string[], deps: CliDeps): Promise<number> {
  const flags = parseFlags(argv);
  assertKnown(flags, [
    '--set',
    '--seed-prefix',
    '--out',
    '--env-file',
    '--decisions',
    '--repeats',
    '--gap-ms',
    '--max-requests',
    '--collation',
    '--max-usd',
    '--provider',
  ]);
  const out = required(flags, '--out');
  const decisions = integer(flags, '--decisions', 900, 1);
  const repeats = integer(flags, '--repeats', 100, 0);
  const gapMs = integer(flags, '--gap-ms', 5000, MIN_GAP_MS);
  const maxRequests = integer(flags, '--max-requests', decisions + repeats + 50, 1);
  const maxUsd = ceilingUsd(flags);
  const provider = labelProvider(flags);
  if (provider === 'direct' && maxUsd === undefined) {
    throw new Error('direct provider requires --max-usd; without it the labeler permits zero spend');
  }

  const cards = parseCardsDocumentJson(readFileSync(required(flags, '--set'), 'utf8'));
  const collation = flags.get('--collation');
  const studied = studyDecisions(cards, {
    seedPrefix: required(flags, '--seed-prefix'),
    count: decisions,
    ...(collation === undefined ? {} : { recipe: readRecipe(collation) }),
  });
  const plan = workPlan(studied, repeats);
  const records = readRecords(out);
  const held = answersOf(records);
  assertRecordMatchesPlan(studied, held);
  const statedSpend = spendOf(held);
  const priorStopSpend = Math.max(
    0,
    ...records.flatMap((record) =>
      record.kind === 'stop' && record.spentUsd !== undefined ? [record.spentUsd] : [],
    ),
  );
  const spend =
    provider === 'direct'
      ? {
          totalUsd: Math.max(
            priorStopSpend,
            statedSpend.totalUsd + statedSpend.unknown * JEV_DIRECT_REQUEST_UPPER_BOUND_USD,
          ),
          peakUsd: JEV_DIRECT_REQUEST_UPPER_BOUND_USD,
          unknown: 0,
        }
      : statedSpend;
  if (maxUsd !== undefined) {
    // Refused before the key is read or any call is made: a resume must not get a fresh allowance.
    if (spend.unknown > 0) {
      throw new Error(
        `${out} holds ${String(spend.unknown)} answers with no stated charge, so its spend cannot be counted against --max-usd`,
      );
    }
    if (spend.totalUsd >= maxUsd) {
      throw new Error(
        `${out} has already spent $${spend.totalUsd.toFixed(4)}, which meets or exceeds --max-usd ${String(maxUsd)}; nothing was called`,
      );
    }
  }
  const done = new Set(held.map((record) => doneKey(record.key, record.repeat)));
  const write = deps.write ?? ((text: string) => process.stdout.write(text));
  const env = deps.env ?? process.env;
  const envFile = flags.get('--env-file');
  const apiKeyVariable = provider === 'direct' ? JEV_DIRECT_KEY_VARIABLE : GATEWAY_KEY_VARIABLE;
  const clientFactory = provider === 'direct' ? createJevDirectClient : createJevClient;
  const client = clientFactory({
    apiKey: readApiKey(env, envFile, apiKeyVariable),
    ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
  });

  write(
    `plan: ${String(plan.length)} calls (${String(decisions)} labels, ${String(repeats)} repeats), ` +
      `${String(done.size)} already recorded, ${String(gapMs)} ms apart, at most ${String(maxRequests)} requests, ` +
      (maxUsd === undefined
        ? 'no spend allowed'
        : provider === 'direct'
          ? `spend ceiling $${maxUsd.toFixed(2)} ($${spend.totalUsd.toFixed(4)} upper-bound estimate already reserved)`
          : `spend ceiling $${maxUsd.toFixed(2)} ($${spend.totalUsd.toFixed(4)} already spent)`) +
      '\n',
  );
  const report = await runPlan(plan, {
    client,
    gapMs,
    maxRequests,
    done,
    ...(maxUsd === undefined ? {} : { maxUsd, priorSpendUsd: spend.totalUsd, priorPeakUsd: spend.peakUsd }),
    ...(provider === 'direct' ? { requestUpperBoundUsd: JEV_DIRECT_REQUEST_UPPER_BOUND_USD } : {}),
    onAnswer: (record) => appendRecord(out, record),
    onProgress: (message) => write(`${message}\n`),
    ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });
  appendRecord(out, { kind: 'stop', at: new Date().toISOString(), ...report.stop });
  write(
    `stopped: ${report.stop.reason} after ${String(report.stop.requests)} requests, ` +
      `${String(report.stop.recorded)} recorded, ${String(report.skipped)} already held` +
      (maxUsd === undefined
        ? ''
        : provider === 'direct'
          ? `, $${(report.stop.spentUsd ?? 0).toFixed(4)} upper-bound estimate in all`
          : `, $${(report.stop.spentUsd ?? 0).toFixed(4)} spent in all`) +
      `\n${report.stop.detail}\n`,
  );
  // Reaching the ceiling is the run finishing as instructed, not a failure.
  return report.stop.reason === 'done' || report.stop.reason === 'budget' ? 0 : 1;
}

const CampaignSchema = z.object({
  cards: z.array(
    z.object({
      cardId: z.string(),
      strength: z.object({ state: z.enum(['underSampled', 'estimated']), estimate: z.number().nullable() }),
    }),
  ),
});

function score(argv: readonly string[], deps: CliDeps): number {
  const flags = parseFlags(argv);
  assertKnown(flags, ['--set', '--records', '--strength', '--min-appearances']);
  const cards = parseCardsDocumentJson(readFileSync(required(flags, '--set'), 'utf8'));
  const answers = answersOf(readRecords(required(flags, '--records')));
  const campaign = CampaignSchema.parse(JSON.parse(readFileSync(required(flags, '--strength'), 'utf8')));
  const minAppearances = integer(flags, '--min-appearances', DEFAULT_MIN_APPEARANCES, 1);

  const strengths = new Map(
    campaign.cards.flatMap((entry) =>
      entry.strength.state === 'estimated' && entry.strength.estimate !== null
        ? [[entry.cardId, entry.strength.estimate] as const]
        : [],
    ),
  );
  const ratings = rateCards(cards);
  const benchmarks = ratings.map((entry) => ({
    cardId: entry.card.id,
    strength: strengths.get(entry.card.id) ?? null,
    rating: entry.rating,
  }));
  const views = primaryViews(answers);
  (deps.write ?? ((text: string) => process.stdout.write(text)))(
    formatReport({
      agreement: agreement(views),
      stability: stability(answers),
      cardLevel: cardLevel(views, benchmarks, minAppearances),
      disagreement: disagreement(views, strengths),
    }),
  );
  return 0;
}

export async function main(argv: readonly string[], deps: CliDeps = {}): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'label') return label(rest, deps);
  if (command === 'score') return score(rest, deps);
  throw new Error('usage: cli.ts label|score [flags]; see the header of this file');
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`jev-label failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 2;
    },
  );
}
