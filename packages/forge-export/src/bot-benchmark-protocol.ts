import { delimiter } from 'node:path';
import { z } from 'zod';

export const BOT_REPORT_PREFIX = '@@MTG_FORGE_BOT_JSON@@';
const ChallengeSchema = z
  .strictObject({
    id: z.string().min(1),
    variant: z.string().min(1),
    status: z.enum(['passed', 'failed', 'unproven']),
    evidence: z.array(z.string()).max(10000),
    scriptedChoices: z.literal(false),
  })
  .refine(
    (c) => c.status !== 'passed' || c.evidence.some((s) => s.trim()),
    'A pass requires observed evidence',
  );
const ReportSchema = z.strictObject({
  protocolVersion: z.literal(2),
  forgeVersion: z.string().min(1),
  botFingerprint: z.enum(['Default/hybrid-simulation', 'Default/full-simulation']),
  seed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  games: z
    .array(
      z.strictObject({
        index: z.number().int().nonnegative(),
        winner: z.enum(['Alpha', 'Beta']).nullable(),
        turns: z.number().int().nonnegative(),
        outcome: z.string(),
        log: z.array(z.string()).max(10000),
      }),
    )
    .max(1),
  challenges: z.array(ChallengeSchema).max(1),
});
export type BotBenchmarkReport = z.infer<typeof ReportSchema>;
export function parseBotBenchmarkReport(text: string): BotBenchmarkReport {
  return ReportSchema.parse(JSON.parse(text) as unknown);
}

const RunSchema = z
  .strictObject({
    deckA: z.string().min(1),
    deckB: z.string().min(1),
    seed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    timeoutMs: z.number().int().min(1000).max(600000).default(120000),
    aiMode: z.enum(['hybrid', 'full']).default('hybrid'),
    interaction: z
      .enum([
        'fundamentals',
        'reanimate',
        'cheat-threat',
        'spells-density',
        'graveyard-value',
        'tokens-wide',
        'opposition-tokens',
        'equipment',
        'creature-toolbox',
        'land-recursion',
        'upheaval-mana',
        'blink-etb',
        'natural-order',
        'green-suns-zenith',
        'twin-combo',
        'kiki-combo',
        'sacrifice-loop',
        'mana-ramp',
        'artifact-engine',
      ])
      .optional(),
    probeVariant: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
      .optional(),
  })
  .refine(
    (r) => r.interaction === undefined || r.aiMode === 'hybrid',
    'Probes require the same hybrid AI as the benchmark',
  )
  .refine(
    (r) => r.probeVariant === undefined || r.interaction !== undefined,
    'A probe variant requires an interaction',
  );
export type BotRunInput = z.input<typeof RunSchema>;
export type BotRun = z.output<typeof RunSchema>;
export function validateBotRun(input: BotRunInput): BotRun {
  return RunSchema.parse(input);
}

export function parseRequestedBotReport(stdout: string, run: BotRun): BotBenchmarkReport {
  const lines = stdout.split(/\r?\n/u).filter((line) => line.startsWith(BOT_REPORT_PREFIX));
  if (lines.length !== 1) throw new Error('Expected exactly one Forge report');
  const report = parseBotBenchmarkReport(lines[0]!.slice(BOT_REPORT_PREFIX.length));
  if (report.seed !== run.seed || report.botFingerprint !== `Default/${run.aiMode}-simulation`)
    throw new Error('Forge report provenance mismatch');
  const shapeMatches =
    run.interaction === undefined
      ? report.games.length === 1 && report.challenges.length === 0
      : report.games.length === 0 &&
        report.challenges.length === 1 &&
        report.challenges[0]?.id === run.interaction &&
        report.challenges[0]?.variant === (run.probeVariant ?? 'default');
  if (!shapeMatches) throw new Error('Forge report does not match request');
  if (report.games.some((g) => g.outcome.startsWith('ERROR:') || g.outcome === 'no outcome'))
    throw new Error('Forge game failed');
  return report;
}
export function botCommandArgs(jar: string, classes: string, run: BotRun): string[] {
  return [
    '-Xmx2048m',
    '-Dio.netty.tryReflectionSetAccessible=true',
    '-Dfile.encoding=UTF-8',
    '-cp',
    `${jar}${delimiter}${classes}`,
    'ForgeBotBenchmark',
    run.deckA,
    run.deckB,
    String(run.seed),
    '1',
    '5000',
    run.interaction === undefined ? run.aiMode : `probe-${run.interaction}:${run.probeVariant ?? 'default'}`,
  ];
}
