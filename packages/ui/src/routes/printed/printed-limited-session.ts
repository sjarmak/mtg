/** Persist replay inputs, never hidden packs or a second copy of the card catalog. */
import { z } from 'zod';
import { resumePrintedLimitedDraft } from '@mtg/draft-export';
import type {
  PreparedPrintedLimitedFormat,
  PrintedLimitedDraftOptions,
  PrintedBoosterCopy,
  PrintedBoosterPayload,
  PhysicalCubeDraftChoice,
} from '@mtg/draft-export';
import { PrintedDraftTranscriptSchema } from '@mtg/printed-card';

const Name = z.string().trim().min(1);
const Count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const DeckEdit = z.strictObject({
  selectedPhysicalIds: z.array(Name),
  basics: z.strictObject({ Plains: Count, Island: Count, Swamp: Count, Mountain: Count, Forest: Count }),
});

export const PrintedLimitedSessionSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('draft'),
    transcript: PrintedDraftTranscriptSchema,
    deck: DeckEdit.optional(),
  }),
  z.strictObject({
    version: z.literal(1),
    mode: z.literal('sealed'),
    formatId: Name,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    seed: Name,
    deck: DeckEdit.optional(),
  }),
]);
export type PrintedLimitedSession = z.infer<typeof PrintedLimitedSessionSchema>;
export type PrintedDeckEdit = z.infer<typeof DeckEdit>;

/** This browser journey has one local drafter. Other seats remain engine-private. */
export const PRINTED_LOCAL_SEAT = 'seat-1';
export interface PrintedLocalDraftView {
  readonly observations: readonly PhysicalCubeDraftChoice<PrintedBoosterPayload>[];
  readonly choice: PhysicalCubeDraftChoice<PrintedBoosterPayload> | null;
  readonly complete: boolean;
}
export interface RestoredPrintedSession {
  readonly session: PrintedLimitedSession;
  readonly pool: readonly PrintedBoosterCopy[];
  readonly draft: PrintedLocalDraftView | null;
  readonly deck: PrintedDeckEdit | null;
}

function checkedDeck(
  deck: PrintedDeckEdit | undefined,
  pool: readonly PrintedBoosterCopy[],
): PrintedDeckEdit | null {
  if (deck === undefined) return null;
  const owned = new Set(pool.map((card) => card.physicalId));
  if (
    new Set(deck.selectedPhysicalIds).size !== deck.selectedPhysicalIds.length ||
    deck.selectedPhysicalIds.some((id) => !owned.has(id))
  ) {
    throw new Error('Saved printed deck contains duplicate or unowned physical copies.');
  }
  return deck;
}

/** Schema, identity, pick legality and ownership are checked before a Continue action is offered. */
export function restorePrintedSession(
  prepared: PreparedPrintedLimitedFormat,
  input: unknown,
  bot?: Pick<PrintedLimitedDraftOptions, 'score' | 'botPolicy'> &
    Partial<Pick<PrintedLimitedDraftOptions, 'choose'>>,
): RestoredPrintedSession {
  const session = PrintedLimitedSessionSchema.parse(input);
  if (session.mode === 'sealed') {
    if (session.formatId !== prepared.format.id || session.fingerprint !== prepared.fingerprint) {
      throw new Error('Saved printed sealed format fingerprint does not match the staged format.');
    }
    const pool = prepared.openSealedPool(session.seed).cards;
    return { session, pool, draft: null, deck: checkedDeck(session.deck, pool) };
  }
  const transcript = session.transcript;
  if (
    transcript.humanSeatIds.length !== 1 ||
    transcript.humanSeatIds[0] !== PRINTED_LOCAL_SEAT ||
    Object.keys(transcript.picks).some((seat) => seat !== PRINTED_LOCAL_SEAT)
  ) {
    throw new Error('This printed draft session must belong only to seat-1.');
  }
  if (bot === undefined) throw new Error('Restoring a printed draft requires its versioned bot policy.');
  const progress = resumePrintedLimitedDraft(prepared, transcript, bot);
  const seat = progress.seats.find((candidate) => candidate.seatId === PRINTED_LOCAL_SEAT);
  if (seat === undefined) throw new Error('Printed draft is missing its local seat.');
  const pool = seat.picks.map((pick) => pick.card);
  if (session.deck !== undefined && progress.result === null) {
    throw new Error('A saved printed deck requires a finished draft.');
  }
  return {
    session,
    pool,
    deck: checkedDeck(session.deck, pool),
    draft: {
      observations: progress.observations.filter((observation) => observation.seatId === PRINTED_LOCAL_SEAT),
      choice: progress.owed.find((choice) => choice.seatId === PRINTED_LOCAL_SEAT) ?? null,
      complete: progress.result !== null,
    },
  };
}
