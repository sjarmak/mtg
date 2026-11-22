/**
 * What one recorded game is, on disk, for whoever reads it later.
 *
 * The lab records every finished game under `data/gameplay/`, and the reader
 * is not the writer: the Analysis explorer scans the index, the Replay tab
 * opens one record, and neither may reach the engine that played it. So the
 * shape is a zod schema beside `./log-schema.ts`, importing that and nothing
 * else, and the "no engine re-run" walk in `../../../test/replay/record.test.ts`
 * covers this file the way it covers the rest of the route.
 *
 * A record has one head and one of two event arms. The head is what an index
 * needs to say which game this is without opening it: who sat, what they
 * played, which set and format, how it ended, and how much there is to read.
 * The arm is what happened. A kernel game is the event-log/9 rows the Replay
 * tab already draws, reproduced on the server from the seed and the choices
 * rather than trusted from the browser, so the arm is exactly one game of the
 * frame log. A Forge game has no reproduction and carries what the backend
 * showed instead: the observed transcript, one frame per submitted move,
 * which is the whole record such an engine can give (the engine package's
 * `determinism.ts` argues why the two are kept apart rather than flattened).
 *
 * Set identity is two halves because the lab plays two kinds of set. A DSL set
 * has a code and its card bytes hash; a printed set has a format id and the
 * hashes `@mtg/forge-export` states for it. A record fills the halves it has
 * and nulls the rest, so a scanner joining on a set never mistakes an absent
 * hash for a matching one.
 */
import { z } from 'zod';
import { EVENT_LOG_SCHEMA_VERSION, GameRecordSchema, ResultSchema, StepRecordSchema } from './log-schema';

export const GAMEPLAY_RECORD_SCHEMA = 'mtg-ui/gameplay-record/1';

export const GameplaySourceSchema = z.enum([
  'browser-kernel',
  'netplay-kernel',
  'netplay-forge',
  'gateway-forge',
]);

export const GameplayFormatSchema = z.enum(['constructed', 'draft', 'sealed', 'commander']);

const Sha = z.string().regex(/^[0-9a-f]{64}$/);

export const SetIdentitySchema = z.strictObject({
  setCode: z.string().min(1).nullable(),
  setSha256: Sha.nullable(),
  formatId: z.string().min(1).nullable(),
  formatSha256: Sha.nullable(),
  cardsSha256: Sha.nullable(),
});

export const GameplaySeatSchema = z.strictObject({
  kind: z.enum(['human', 'kernel-bot', 'forge-bot']),
  name: z.string().min(1),
  deck: z.strictObject({
    name: z.string(),
    size: z.int().positive(),
    cards: z.array(z.string()),
  }),
});

export const KernelResultSchema = ResultSchema;

export const ObservedResultSchema = z.strictObject({
  winner: z.union([z.literal(0), z.literal(1)]).nullable(),
  reason: z.string(),
  endedOnTurn: z.int().nonnegative(),
});

export const GameplayMeasurementSchema = z.strictObject({
  decisions: z.int().nonnegative(),
  turns: z.int().nonnegative(),
  eventBytes: z.int().nonnegative(),
});

export const EventLogEventsSchema = z.strictObject({
  kind: z.literal('event-log'),
  schema: z.literal(EVENT_LOG_SCHEMA_VERSION),
  game: GameRecordSchema,
  steps: z.array(StepRecordSchema).min(1),
});

export const TranscriptFrameSchema = z.strictObject({
  seq: z.int().nonnegative(),
  move: z.string().nullable(),
  view: z.record(z.string(), z.unknown()),
  events: z.array(z.record(z.string(), z.unknown())),
});

export const TranscriptEventsSchema = z.strictObject({
  kind: z.literal('transcript'),
  backend: z.string().min(1),
  localSeats: z.array(z.union([z.literal(0), z.literal(1)])),
  frames: z.array(TranscriptFrameSchema),
});

/** Everything an index row and a record share: the game without its events. */
export const GameplayHeadSchema = z.strictObject({
  id: z.string().min(1),
  at: z.string().datetime(),
  source: GameplaySourceSchema,
  format: GameplayFormatSchema,
  set: SetIdentitySchema,
  seats: z.tuple([GameplaySeatSchema, GameplaySeatSchema]),
  result: z.union([KernelResultSchema, ObservedResultSchema]),
  measurement: GameplayMeasurementSchema,
});

export const GameplayRecordSchema = GameplayHeadSchema.extend({
  schema: z.literal(GAMEPLAY_RECORD_SCHEMA),
  events: z.discriminatedUnion('kind', [EventLogEventsSchema, TranscriptEventsSchema]),
});

/** One line of `data/gameplay/index.jsonl`: the head, where the record is, and what its bytes hash to. */
export const GameplayIndexRowSchema = GameplayHeadSchema.extend({
  events: z.enum(['event-log', 'transcript']),
  path: z.string().regex(/^\d{8}\/[^/\\]+\.json$/),
  sha256: Sha,
  bytes: z.int().nonnegative(),
});

export type GameplaySource = z.infer<typeof GameplaySourceSchema>;
export type GameplayFormat = z.infer<typeof GameplayFormatSchema>;
export type SetIdentity = z.infer<typeof SetIdentitySchema>;
export type GameplaySeat = z.infer<typeof GameplaySeatSchema>;
export type ObservedResult = z.infer<typeof ObservedResultSchema>;
export type GameplayMeasurement = z.infer<typeof GameplayMeasurementSchema>;
export type GameplayHead = z.infer<typeof GameplayHeadSchema>;
export type GameplayRecord = z.infer<typeof GameplayRecordSchema>;
export type GameplayIndexRow = z.infer<typeof GameplayIndexRowSchema>;
