/**
 * The sealed pool you were in the middle of, kept across a reload.
 *
 * `mtg-tewc.5`. the playtester's Play specification asks for a Sealed section with
 * "Generate Sealed Pool plus an obvious way to resume an active pool", and
 * until now there was no such thing to resume: `./SealedGame.ts` opens the pool
 * in a lazy state initializer and nothing wrote it anywhere, so leaving the
 * page for the Cards tab and coming back threw away six packs and an hour of
 * cutting. A Resume control over state that does not survive a reload would be
 * a lie, so the state comes first.
 *
 * # A seed, not a pool
 *
 * What is stored is the seed, the two edits a person made to the build, and the
 * ids the pool dealt — not the cards. A pool is a deterministic function of the
 * set, the seed and the collation; that is the invariant the whole repository
 * is built on, and storing the cards would be storing a derivation of it. Six
 * boosters of full card objects is on the order of a hundred kilobytes in a
 * store that throws at its quota; the seed is forty characters.
 *
 * # The ids are the guard, and the refusal is exact
 *
 * The saved indices name positions in a pool, and a pool re-dealt from a
 * different set at the same seed is a different pool at the same positions. So
 * the ids the pool dealt ride along, and a resume that re-opens to a different
 * list is refused rather than repaired. That is the rule `../deck/saved-decks.ts`
 * already argues for a saved deck: a build silently reopened against the wrong
 * cards is discovered by losing a game with it.
 *
 * There is one session, not a list. A pool is the thing you are in the middle
 * of, and two of them at once is a deck manager rather than a resume.
 */
import { z } from 'zod';
import { COLORS } from '@mtg/dsl';
import type { Card, Color } from '@mtg/dsl';
import type { BasicLandCounts, PackCollation } from '@mtg/deckbuild';
import { readStored, writeStored } from '../deck/local-store';
import { openSealed } from './sealed';
import type { SealedBuild } from './sealed';

/**
 * Bumped whenever the shape below changes. A session at another version fails
 * the schema and is dropped, which reads on screen as "no pool to resume" — the
 * honest outcome, and the same one `SAVED_DECK_VERSION` chose.
 */
export const SEALED_SESSION_VERSION = 1;

/** Where it lives, in the namespace the play surface's other preferences use. */
export const SEALED_SESSION_KEY = 'mtg.play.sealed';

/**
 * The five counts, each optional, which is the shape `BasicLandCounts` is.
 *
 * Written out from `COLORS` rather than by hand so a sixth color would be a
 * type error here rather than a count silently dropped on the way to the store,
 * and asserted below to be assignable to the type it is standing in for.
 */
const BasicsSchema = z.object({
  W: z.number().int().nonnegative().optional(),
  U: z.number().int().nonnegative().optional(),
  B: z.number().int().nonnegative().optional(),
  R: z.number().int().nonnegative().optional(),
  G: z.number().int().nonnegative().optional(),
});

/** Fails to compile if `COLORS` grows a member this schema does not name. */
const BASICS_KEYS: Readonly<Record<Color, true>> = { W: true, U: true, B: true, R: true, G: true };
for (const color of COLORS) void BASICS_KEYS[color];

type BasicsRead = z.infer<typeof BasicsSchema>;

/**
 * The parsed counts as the type the builder takes.
 *
 * A conversion rather than a cast, because of `exactOptionalPropertyTypes`:
 * zod's `.optional()` yields `W?: number | undefined`, `BasicLandCounts` is
 * `W?: number`, and the difference is the one this rebuild erases — a key that
 * is present and holds `undefined` becomes a key that is absent.
 */
function toBasics(read: BasicsRead): BasicLandCounts {
  const counts: Partial<Record<Color, number>> = {};
  for (const color of COLORS) {
    const value = read[color];
    if (value !== undefined) counts[color] = value;
  }
  return counts;
}

const SessionSchema = z.object({
  version: z.literal(SEALED_SESSION_VERSION),
  /** What dealt the pool, and what re-deals it. */
  seed: z.string().min(1),
  /** Whether the printing's own sheets dealt it, or the rarity recipe did. */
  collated: z.boolean(),
  /** The ids the pool dealt, in order: the guard, not the pool. */
  poolIds: z.array(z.string().min(1)).min(1),
  /** Pool indices the builder has included, ascending. */
  chosen: z.array(z.number().int().nonnegative()),
  /** The basics the person counted out, or null while the computed base stands. */
  basics: BasicsSchema.nullable(),
});

export type SealedSession = z.infer<typeof SessionSchema>;

/** What a stored pool can say about itself before anything is re-dealt. */
export interface SealedSessionSummary {
  readonly seed: string;
  readonly poolSize: number;
  readonly chosenCount: number;
}

export function sessionSummary(session: SealedSession): SealedSessionSummary {
  return { seed: session.seed, poolSize: session.poolIds.length, chosenCount: session.chosen.length };
}

/** The stored session, or null when there is none, none readable, or none at this version. */
export function readSealedSession(): SealedSession | null {
  const raw = readStored(SEALED_SESSION_KEY);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const read = SessionSchema.safeParse(parsed);
  return read.success ? read.data : null;
}

/**
 * Writes the build as the one session in progress.
 *
 * False means it is not kept and Resume will not offer it after a reload. The
 * caller decides what to say about that; `./SealedGame.ts` says it once, over
 * the builder, rather than on every keystroke.
 */
export function writeSealedSession(build: SealedBuild, seed: string, collated: boolean): boolean {
  const session: SealedSession = {
    version: SEALED_SESSION_VERSION,
    seed,
    collated,
    poolIds: build.pool.map((card) => card.id),
    chosen: [...build.chosen],
    basics: build.basics,
  };
  return writeStored(SEALED_SESSION_KEY, JSON.stringify(session));
}

/**
 * Forgets the session, by writing an empty value: `../deck/local-store.ts`
 * exposes `getItem` and `setItem` and nothing else, deliberately, and an empty
 * string fails the parse above exactly as a missing key does.
 *
 * Called when a pool is deliberately replaced by a new one.
 */
export function clearSealedSession(): boolean {
  return writeStored(SEALED_SESSION_KEY, '');
}

/** Why a stored session could not be reopened against the set on this page. */
export type SealedResumeProblem =
  /** The stored pool was dealt by the printing's sheets and this page has none, or the reverse. */
  | { readonly kind: 'collation' }
  /** The same seed against this set deals a different pool: the set moved underneath. */
  | { readonly kind: 'set-changed'; readonly expected: number; readonly found: number };

export type SealedResume =
  | { readonly ok: true; readonly build: SealedBuild; readonly seed: string }
  | { readonly ok: false; readonly problem: SealedResumeProblem };

/**
 * Re-deals the stored pool from the set on this page and puts the build back on
 * it.
 *
 * The comparison is the whole function. Everything else — the indices, the
 * basics — is applied only once the re-dealt pool is the pool that was stored,
 * card for card and position for position.
 */
export function resumeSealed(
  session: SealedSession,
  set: readonly Card[],
  collation: PackCollation | null,
): SealedResume {
  if (session.collated !== (collation !== null)) return { ok: false, problem: { kind: 'collation' } };
  const opened = openSealed(set, session.seed, collation === null ? {} : { collation });
  const ids = opened.pool.map((card) => card.id);
  const same = ids.length === session.poolIds.length && ids.every((id, at) => id === session.poolIds[at]);
  if (!same) {
    return {
      ok: false,
      problem: { kind: 'set-changed', expected: session.poolIds.length, found: ids.length },
    };
  }
  const chosen = session.chosen.filter((index) => index < opened.pool.length).sort((a, b) => a - b);
  const basics = session.basics === null ? null : toBasics(session.basics);
  return { ok: true, seed: session.seed, build: { ...opened, chosen, basics } };
}
