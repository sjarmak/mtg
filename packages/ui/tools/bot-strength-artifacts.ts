/** Durable, append-only artifacts for a pre-registered bot-strength campaign. */
import { createHash } from 'node:crypto';
import {
  closeSync,
  createReadStream,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  writeSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import { canonicalJson } from '@mtg/dsl';
import {
  BotStrengthCampaignPlanSchema,
  compareBotStrengthTrialSummaries,
  summarizeBotStrengthTrial,
  type BotStrengthCampaignPlan,
  type BotStrengthCampaignRun,
  type BotStrengthComparison,
  type BotStrengthTrial,
  type BotStrengthTrialSummary,
} from '@mtg/metrics';
import { writeDurably } from './durable-write';

export interface BotStrengthCampaignArtifacts {
  readonly checkpoint: (trial: BotStrengthTrial) => void;
  readonly complete: (run: BotStrengthCampaignRun) => void;
  readonly abort: () => void;
}

function document(value: unknown): string {
  return `${JSON.stringify(JSON.parse(canonicalJson(value)), null, 2)}\n`;
}

function trialKey(trial: Pick<BotStrengthTrial, 'unitId' | 'focalSeat' | 'arm'>): string {
  return `${trial.unitId}\u0000${String(trial.focalSeat)}\u0000${trial.arm}`;
}

function expectedKeys(plan: ReturnType<typeof BotStrengthCampaignPlanSchema.parse>): readonly string[] {
  return plan.schedule.flatMap((row) =>
    (['baseline', 'candidate'] as const).map((arm) =>
      trialKey({ unitId: row.unitId, focalSeat: row.focalSeat, arm }),
    ),
  );
}

interface TrialLocation {
  readonly key: string;
  readonly offset: number;
  readonly length: number;
}

function hashCanonicalEvidence(path: string, locations: readonly TrialLocation[]): string {
  const evidence = createHash('sha256').update('[');
  const descriptor = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (const [index, location] of [...locations]
      .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
      .entries()) {
      evidence.update(index === 0 ? '' : ',').update(`{"key":${canonicalJson(location.key)},"trial":`);
      let remaining = location.length;
      let position = location.offset;
      while (remaining > 0) {
        const requested = Math.min(buffer.length, remaining);
        const bytesRead = readSync(descriptor, buffer, 0, requested, position);
        if (bytesRead === 0) throw new Error(`Trial ${location.key} ended before its recorded length.`);
        evidence.update(buffer.subarray(0, bytesRead));
        remaining -= bytesRead;
        position += bytesRead;
      }
      evidence.update('}');
    }
  } finally {
    closeSync(descriptor);
  }
  return evidence.update(']').digest('hex');
}

/** Finalize a complete append-only campaign without retaining full episodes. */
export async function finalizeBotStrengthCampaignArtifacts(
  outputDirectory: string,
): Promise<BotStrengthComparison> {
  const output = resolve(outputDirectory);
  const plan = BotStrengthCampaignPlanSchema.parse(
    JSON.parse(readFileSync(join(output, 'plan.json'), 'utf8')),
  );
  const keys = expectedKeys(plan);
  const trialsPath = join(output, 'trials.jsonl');
  let summaries: readonly BotStrengthTrialSummary[] = [];
  let locations: readonly TrialLocation[] = [];
  let offset = 0;
  const lines = createInterface({
    input: createReadStream(trialsPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    const parsed = JSON.parse(line) as BotStrengthTrial;
    const summary = summarizeBotStrengthTrial(plan, parsed);
    const expected = keys[summaries.length];
    if (summary.key !== expected) {
      throw new Error(`Expected bot-strength checkpoint ${expected ?? 'none'}.`);
    }
    const canonicalTrial = canonicalJson(parsed);
    if (canonicalTrial !== line) throw new Error(`Trial ${summary.key} is not canonical JSON.`);
    const length = Buffer.byteLength(line);
    locations = [...locations, { key: summary.key, offset, length }];
    offset += length + 1;
    summaries = [...summaries, summary];
  }
  if (summaries.length !== keys.length) {
    throw new Error(
      `Bot-strength campaign requires ${String(keys.length)} persisted trials before completion.`,
    );
  }
  const comparison = compareBotStrengthTrialSummaries(
    plan,
    summaries,
    hashCanonicalEvidence(trialsPath, locations),
  );
  writeDurably(join(output, 'comparison.json'), document(comparison));
  return comparison;
}

/**
 * Refuse an existing output directory, persist the complete plan before play,
 * and sync each validated trial so interruption leaves honest partial evidence.
 */
export function openBotStrengthCampaignArtifacts(
  outputDirectory: string,
  input: BotStrengthCampaignPlan,
  runtimeManifest: unknown,
): BotStrengthCampaignArtifacts {
  const plan = BotStrengthCampaignPlanSchema.parse(input);
  const planBody = document(plan);
  const runtimeBody = document(runtimeManifest);
  const output = resolve(outputDirectory);
  mkdirSync(output);
  writeDurably(join(output, 'plan.json'), planBody);
  writeDurably(join(output, 'runtime.json'), runtimeBody);
  const trialsPath = join(output, 'trials.jsonl');
  const trialsDescriptor = openSync(trialsPath, 'wx');
  const expectedTrials = plan.schedule.length * 2;
  let checkpoints = 0;
  let closed = false;

  const assertOpen = (): void => {
    if (closed) throw new Error('Bot-strength campaign artifact recorder is closed.');
  };
  const close = (): void => {
    if (closed) return;
    closeSync(trialsDescriptor);
    closed = true;
  };

  return {
    checkpoint: (trial) => {
      assertOpen();
      writeSync(trialsDescriptor, `${canonicalJson(trial)}\n`);
      fsyncSync(trialsDescriptor);
      checkpoints += 1;
    },
    complete: (run) => {
      assertOpen();
      if (checkpoints !== expectedTrials || run.trials.length !== expectedTrials) {
        throw new Error(
          `Bot-strength campaign requires ${String(expectedTrials)} persisted trials before completion.`,
        );
      }
      if (run.comparison.planSha256 !== botEvidenceSha256(plan)) {
        throw new Error('Bot-strength comparison does not belong to the pre-registered plan.');
      }
      writeDurably(join(output, 'comparison.json'), document(run.comparison));
      close();
    },
    abort: close,
  };
}
