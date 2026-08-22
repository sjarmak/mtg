/**
 * The page's half of the write endpoint, and every answer it will accept.
 *
 * The server refuses a bad request loudly and says which refusal it was; this
 * is the side that reads the refusal back and gives it to the page as a
 * sentence rather than a status code. A write that did not land has to be
 * visible, because the whole value of the grid is that somebody's picks are on
 * disk when they put the tablet down.
 *
 * Every response is checked structurally before it is believed, for the reason
 * every other reader in this package states: this one crossed a network.
 */
import { z } from 'zod';

const AcceptedSchema = z.object({ ok: z.literal(true) });
const RefusedSchema = z.object({ ok: z.literal(false), reason: z.string().min(1) });

/**
 * The four causes the picker offers, mirroring `CAUSES` in
 * `@mtg/art/curation-endpoint`. Duplicated rather than imported: this page
 * does not otherwise depend on the art pipeline (the workspace's dependency graph
 * runs the other way, the art pipeline reads the card store and the DSL, not the
 * page), and every response this module reads has already crossed the same
 * network boundary every other type here is re-validated across. A slug added
 * on one side and not the other fails at `RegenerationRowSchema.parse` rather
 * than silently, which is the same tradeoff `ImageHashSchema` would make if
 * this page re-declared it.
 */
export const CAUSES = ['outer-border', 'mirrored-duplication', 'seam-in-art', 'wrong-subject'] as const;
export type Cause = (typeof CAUSES)[number];
const CauseSchema = z.enum(CAUSES);

/**
 * The note ceiling, mirroring `MAX_NOTE_CHARS` in the art pipeline's
 * `curation-endpoint.ts` for the same reason `CAUSES` above is mirrored: this
 * package cannot reach that one. The number is here so the page can count down
 * to the limit rather than let the browser discard keystrokes at it, which is
 * how two reference descriptions were cut off mid-sentence in the first
 * session. The writer refuses anything past it, so the two must agree, and
 * `curate.test.ts` parses a note built against this constant with the writer's
 * own schema to keep them agreeing.
 */
export const MAX_NOTE_CHARS = 4000;

/** One flagged card as the server holds it: the causes and note recorded for it. */
const RegenerationRowSchema = z.object({
  cardId: z.string().min(1),
  causes: z.array(CauseSchema),
  note: z.string().min(1).optional(),
});

export type RegenerationRow = z.infer<typeof RegenerationRowSchema>;

/** Card id to ordered digests, plus the cards somebody has asked to have redone. */
export const CurationStateSchema = z.object({
  ok: z.literal(true),
  preferences: z.record(z.string(), z.array(z.string())),
  regenerations: z.array(RegenerationRowSchema),
});

export type RemoteCurationState = z.infer<typeof CurationStateSchema>;

/** What the page shows after a write: nothing, or the reason it did not happen. */
export type WriteOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

async function post(path: string, body: unknown): Promise<WriteOutcome> {
  let response: Response | null = null;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (cause: unknown) {
    return { ok: false, reason: `could not reach the curation server (${describe(cause)})` };
  }
  const parsed: unknown = await response.json().catch(() => null);
  const refused = RefusedSchema.safeParse(parsed);
  if (refused.success) return { ok: false, reason: refused.data.reason };
  if (!AcceptedSchema.safeParse(parsed).success) {
    return {
      ok: false,
      reason: `the curation server answered ${String(response.status)} with a body this page does not recognize`,
    };
  }
  return { ok: true };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Records one card's order. An empty list removes the entry and paints the base. */
export function writePreference(cardId: string, hashes: readonly string[]): Promise<WriteOutcome> {
  return post('/curation-api/preference', { cardId, hashes });
}

/**
 * Records, or takes back, a request to make another picture of a card.
 *
 * `causes` and `note` are only meaningful when `requested` is true; a clear
 * (`requested: false`) sends an empty cause list because the server's schema
 * requires the field, but the server deletes the whole entry on that branch
 * regardless of what causes accompany it.
 */
export function writeRegeneration(
  cardId: string,
  requested: boolean,
  causes: readonly Cause[] = [],
  note?: string,
): Promise<WriteOutcome> {
  return post('/curation-api/regenerate', {
    cardId,
    requested,
    causes,
    ...(note === undefined ? {} : { note }),
  });
}

/** What is already on disk, so a reopened tab is not a blank slate. */
export async function readRemoteState(): Promise<RemoteCurationState | null> {
  const response = await fetch('/curation-api/state').catch(() => null);
  if (response === null || !response.ok) return null;
  const parsed = CurationStateSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}
