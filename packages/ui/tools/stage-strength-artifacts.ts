/** Durable, append-only artifacts for a preregistered stage-strength campaign. */
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
import { isDeepStrictEqual } from 'node:util';
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import { canonicalJson } from '@mtg/dsl';
import {
  StageStrengthCampaignPlanSchema,
  compareStageStrengthCampaign,
  compareStageStrengthTrialSummaries,
  summarizeStageStrengthTrial,
  validateStageStrengthTrial,
  type StageStrengthCampaignPlan,
  type StageStrengthCampaignRun,
  type StageStrengthComparison,
  type StageStrengthTrial,
  type StageStrengthTrialSummary,
} from '@mtg/metrics';
import { fsyncDirectory, writeDurably } from './durable-write';

export interface StageStrengthCampaignArtifacts {
  readonly checkpoint: (trial: StageStrengthTrial) => void;
  readonly complete: (run: StageStrengthCampaignRun) => void;
  readonly abort: () => void;
}

function document(value: unknown): string {
  return `${JSON.stringify(JSON.parse(canonicalJson(value)), null, 2)}\n`;
}

function expectedKeys(plan: ReturnType<typeof StageStrengthCampaignPlanSchema.parse>): readonly string[] {
  return plan.schedule.flatMap((row) =>
    (['baseline', 'candidate'] as const).map((arm) => `${row.unitId}\u0000${arm}`),
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

/** Finalize complete append-only stage evidence without retaining full episodes. */
export async function finalizeStageStrengthCampaignArtifacts(
  outputDirectory: string,
): Promise<StageStrengthComparison> {
  const output = resolve(outputDirectory);
  const plan = StageStrengthCampaignPlanSchema.parse(
    JSON.parse(readFileSync(join(output, 'plan.json'), 'utf8')),
  );
  const keys = expectedKeys(plan);
  const trialsPath = join(output, 'trials.jsonl');
  let summaries: readonly StageStrengthTrialSummary[] = [];
  let locations: readonly TrialLocation[] = [];
  let offset = 0;
  const lines = createInterface({
    input: createReadStream(trialsPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    const parsed = JSON.parse(line) as StageStrengthTrial;
    const summary = summarizeStageStrengthTrial(plan, parsed);
    const expected = keys[summaries.length];
    if (summary.key !== expected) {
      throw new Error(`Expected stage-strength checkpoint ${expected?.replace('\u0000', ':') ?? 'none'}.`);
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
      `Stage-strength campaign requires ${String(keys.length)} persisted trials before completion.`,
    );
  }
  const comparison = compareStageStrengthTrialSummaries(
    plan,
    summaries,
    hashCanonicalEvidence(trialsPath, locations),
  );
  writeDurably(join(output, 'comparison.json'), document(comparison));
  return comparison;
}

/** Persist the frozen plan before work and fsync every validated ordered trial. */
export function openStageStrengthCampaignArtifacts(
  outputDirectory: string,
  input: StageStrengthCampaignPlan,
  runtimeManifest: unknown,
): StageStrengthCampaignArtifacts {
  const plan = StageStrengthCampaignPlanSchema.parse(input);
  const output = resolve(outputDirectory);
  mkdirSync(output);
  writeDurably(join(output, 'plan.json'), document(plan));
  writeDurably(join(output, 'runtime.json'), document(runtimeManifest));
  const trialsDescriptor = openSync(join(output, 'trials.jsonl'), 'wx');
  fsyncSync(trialsDescriptor);
  fsyncDirectory(output);
  const keys = expectedKeys(plan);
  let hashes: readonly string[] = [];
  let closed = false;

  const assertOpen = (): void => {
    if (closed) throw new Error('Stage-strength campaign artifact recorder is closed.');
  };
  const close = (): void => {
    if (closed) return;
    closeSync(trialsDescriptor);
    closed = true;
  };

  return {
    checkpoint: (inputTrial) => {
      assertOpen();
      const expected = keys[hashes.length];
      const received = `${inputTrial.unitId}\u0000${inputTrial.arm}`;
      if (received !== expected) {
        throw new Error(`Expected stage-strength checkpoint ${expected?.replace('\u0000', ':') ?? 'none'}.`);
      }
      const trial = validateStageStrengthTrial(plan, inputTrial);
      writeSync(trialsDescriptor, `${canonicalJson(trial)}\n`);
      fsyncSync(trialsDescriptor);
      hashes = [...hashes, botEvidenceSha256(trial)];
    },
    complete: (run) => {
      assertOpen();
      if (hashes.length !== keys.length || run.trials.length !== keys.length) {
        throw new Error(
          `Stage-strength campaign requires ${String(keys.length)} persisted trials before completion.`,
        );
      }
      const trials = run.trials.map((trial) => validateStageStrengthTrial(plan, trial));
      if (!isDeepStrictEqual(trials.map(botEvidenceSha256), hashes)) {
        throw new Error('Stage-strength completion trials differ from persisted checkpoints.');
      }
      const comparison = compareStageStrengthCampaign(plan, trials);
      if (!isDeepStrictEqual(run.comparison, comparison)) {
        throw new Error('Stage-strength comparison differs from the preregistered campaign result.');
      }
      writeDurably(join(output, 'comparison.json'), document(comparison));
      close();
    },
    abort: close,
  };
}
