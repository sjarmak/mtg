import { canonicalJson } from '@mtg/dsl';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const NonemptyString = z.string().trim().min(1);
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/u, 'expected a lowercase SHA-256 digest');

/** SHA-256 over the canonical JSON spelling used by every embedded payload. */
export function botEvidenceSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/** Hash a one-pass sequence with the exact canonical spelling of an array. */
export function botEvidenceArraySha256(values: Iterable<unknown>): string {
  const hash = createHash('sha256').update('[');
  let separator = '';
  for (const value of values) {
    const arrayElement = canonicalJson([value]).slice(1, -1);
    hash.update(separator).update(arrayElement);
    separator = ',';
  }
  return hash.update(']').digest('hex');
}

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

const RuntimeSchema = z.strictObject({
  kind: z.enum(['native', 'forge', 'analysis']),
  version: NonemptyString,
  buildSha256: Sha256,
});

const ProvenanceSchema = z.strictObject({
  formatId: NonemptyString,
  formatSha256: Sha256,
  cardsSha256: Sha256,
});

const FeatureSchema = z.strictObject({ schemaId: NonemptyString, schemaSha256: Sha256 });

const BehaviorSchema = z.strictObject({
  policyId: NonemptyString,
  configSha256: Sha256,
  config: JsonValueSchema,
  modelSha256: Sha256.nullable(),
  dataSha256: Sha256.nullable(),
});

const LineageSchema = z.strictObject({
  setId: NonemptyString.optional(),
  poolId: NonemptyString.optional(),
  draftId: NonemptyString.optional(),
  gameId: NonemptyString.optional(),
});

export const BotEvidenceSplitGroupSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('set'), id: NonemptyString }),
  z.strictObject({ kind: z.literal('pool'), id: NonemptyString }),
  z.strictObject({ kind: z.literal('draft'), id: NonemptyString }),
  z.strictObject({ kind: z.literal('game'), id: NonemptyString }),
]);

const CandidateSchema = z.strictObject({ id: NonemptyString, value: JsonValueSchema });

const CandidateSetSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('complete'), values: z.array(CandidateSchema).min(1) }),
  z.strictObject({
    status: z.literal('incomplete'),
    reason: NonemptyString,
    values: z.array(CandidateSchema),
  }),
  z.strictObject({
    status: z.literal('truncated'),
    reason: NonemptyString,
    values: z.array(CandidateSchema),
  }),
]);

const FailureStatus = z.enum(['incomplete', 'timeout', 'illegal-action', 'unsupported', 'engine-failure']);
const NonIllegalFailureStatus = z.enum(['incomplete', 'timeout', 'unsupported', 'engine-failure']);
const ChoiceSchema = z.union([
  z.strictObject({ status: z.literal('chosen'), candidateId: NonemptyString }),
  z.strictObject({
    status: z.literal('illegal-action'),
    error: NonemptyString,
    attempted: CandidateSchema,
  }),
  z.strictObject({ status: NonIllegalFailureStatus, error: NonemptyString }),
]);

const DecisionSchema = z
  .strictObject({
    sequence: z.number().int().nonnegative(),
    /** The digest is always kept; the value is retained only when a caller asked to keep it. */
    observation: z.strictObject({ sha256: Sha256, value: JsonValueSchema.optional() }),
    candidates: CandidateSetSchema,
    choice: ChoiceSchema,
  })
  .superRefine((decision, context) => {
    const ids = decision.candidates.values.map((candidate) => candidate.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'duplicate candidate identity' });
    }
    if (decision.choice.status === 'chosen' && !ids.includes(decision.choice.candidateId)) {
      context.addIssue({
        code: 'custom',
        path: ['choice', 'candidateId'],
        message: `chosen candidate ${decision.choice.candidateId} is missing from the candidate set`,
      });
    }
    if (
      decision.observation.value !== undefined &&
      botEvidenceSha256(decision.observation.value) !== decision.observation.sha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['observation', 'sha256'],
        message: 'observation SHA-256 does not match its canonical value',
      });
    }
  });

const OutcomeSchema = z.union([
  z.strictObject({ status: z.literal('completed'), value: JsonValueSchema }),
  z.strictObject({ status: FailureStatus, error: NonemptyString }),
]);

const EpisodeIdentitySchema = z
  .strictObject({
    id: NonemptyString,
    stage: z.enum(['gameplay', 'draft', 'deckbuilding']),
    seed: NonemptyString.nullable(),
    runtime: RuntimeSchema,
    subject: ProvenanceSchema,
    features: FeatureSchema,
    behavior: BehaviorSchema,
    lineage: LineageSchema,
    splitGroup: BotEvidenceSplitGroupSchema,
  })
  .superRefine((episode, context) => {
    const lineageId = {
      set: episode.lineage.setId,
      pool: episode.lineage.poolId,
      draft: episode.lineage.draftId,
      game: episode.lineage.gameId,
    }[episode.splitGroup.kind];
    if (lineageId !== episode.splitGroup.id) {
      context.addIssue({
        code: 'custom',
        path: ['splitGroup'],
        message: 'split group must name its matching lineage identity',
      });
    }
    if (botEvidenceSha256(episode.behavior.config) !== episode.behavior.configSha256) {
      context.addIssue({
        code: 'custom',
        path: ['behavior', 'configSha256'],
        message: 'behavior config SHA-256 does not match its canonical value',
      });
    }
  });

export const BotEvidenceEpisodeSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    episode: EpisodeIdentitySchema,
    decisions: z.array(DecisionSchema),
    outcome: OutcomeSchema,
  })
  .superRefine((artifact, context) => {
    const sequences = artifact.decisions.map((decision) => decision.sequence);
    if (new Set(sequences).size !== sequences.length) {
      context.addIssue({ code: 'custom', path: ['decisions'], message: 'duplicate decision sequence' });
    }
  });

export type BotEvidenceSplitGroup = z.infer<typeof BotEvidenceSplitGroupSchema>;
export type BotEvidenceEpisode = z.infer<typeof BotEvidenceEpisodeSchema>;

export function serializedBotEvidenceEpisode(episode: BotEvidenceEpisode): string {
  return `${canonicalJson(BotEvidenceEpisodeSchema.parse(episode))}\n`;
}

export interface BotEvidencePartitionOptions {
  readonly salt: string;
  readonly evaluationPermille: number;
}

export type BotEvidencePartition = 'training' | 'evaluation';

const FNV_OFFSET = 14_695_981_039_346_656_037n;
const FNV_PRIME = 1_099_511_628_211n;
const UINT64_MASK = 0xffff_ffff_ffff_ffffn;

function fnv1a64(text: string): bigint {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & UINT64_MASK;
  }
  return hash;
}

export function partitionBotEvidenceEpisode(
  artifact: BotEvidenceEpisode,
  options: BotEvidencePartitionOptions,
): BotEvidencePartition {
  const parsed = BotEvidenceEpisodeSchema.parse(artifact);
  const settings = z
    .strictObject({ salt: NonemptyString, evaluationPermille: z.number().int().min(1).max(999) })
    .parse(options);
  const group = parsed.episode.splitGroup;
  const bucket = Number(fnv1a64(`${settings.salt}\u0000${group.kind}\u0000${group.id}`) % 1_000n);
  return bucket < settings.evaluationPermille ? 'evaluation' : 'training';
}
