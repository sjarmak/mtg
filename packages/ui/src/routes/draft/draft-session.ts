/**
 * The draft you were in the middle of, kept across a reload.
 *
 * `mtg-tewc.7`. the playtester's Draft specification asks for a New Draft action and
 * a resume when one is active, and until now the tab had neither: opening it
 * invented a seed and dealt pack 1 pick 1 on the spot, so there was no state
 * before a draft and no way back to the one you left. The URL already carries
 * the whole draft — `./params.ts` holds the seed and the pick log, and
 * `runHumanDraft` replays them — but a URL is only a resume for somebody who
 * kept it, and pressing Draft in the tab row does not.
 *
 * # A seed and a pick list, not a pack
 *
 * `../play/sealed-session.ts` stores a seed rather than a pool, because a pool
 * is a deterministic function of the set, the seed and the collation. A draft is
 * the same function plus the picks, which is the one part that is not derivable:
 * seven bots are, the passing is, the packs are. So what is written is the seed
 * and the ids the human chose, in order, and everything else is re-derived.
 *
 * # The first pack is the guard, and the refusal is exact
 *
 * A pick list names cards; a pack re-dealt from a different set at the same seed
 * holds different cards, and replaying the same ids against it either fails or —
 * worse — succeeds against cards nobody chose. So pack 1 pick 1's ids ride
 * along, and a resume that re-opens to a different pack is refused rather than
 * repaired. That is `sealed-session.ts`'s rule and `../deck/saved-decks.ts`'s
 * before it: a build silently reopened against the wrong cards is discovered by
 * losing a game with it.
 *
 * There is one session, not a list. A draft is the thing you are in the middle
 * of, and two at once is a draft manager rather than a resume.
 */
import { z } from 'zod';
import {
  DEFAULT_NATIVE_DRAFT_BOT_POLICY,
  DRAFTMANCER_SIMPLE_BOT_POLICY,
  DraftError,
  runHumanDraft,
} from '@mtg/draft-export';
import type { NativeDraftBotPolicy } from '@mtg/draft-export';
import type { PackCollation } from '@mtg/deckbuild';
import type { Card } from '@mtg/dsl';
import { readStored, writeStored } from '../deck/local-store';
import { MAX_HUMAN_PICKS } from './params';

/**
 * Bumped whenever the shape below changes. A session at another version fails
 * the schema and is dropped, which reads on screen as "no draft to continue" —
 * the honest outcome, and the one `SEALED_SESSION_VERSION` chose.
 */
export const DRAFT_SESSION_VERSION = 2;

/** Where it lives, beside the play surface's own session key. */
export const DRAFT_SESSION_KEY = 'mtg.draft.session';

const SessionSchema = z.object({
  version: z.literal(DRAFT_SESSION_VERSION),
  /** What dealt every pack, and what deals them again. */
  seed: z.string().min(1),
  /** The ids the person chose, in order. The one underivable part. */
  picks: z.array(z.string().min(1)).max(MAX_HUMAN_PICKS),
  /** Pack 1 pick 1, as ids: the guard, not the pack. */
  packIds: z.array(z.string().min(1)).min(1),
  botPolicy: z.enum([DEFAULT_NATIVE_DRAFT_BOT_POLICY, DRAFTMANCER_SIMPLE_BOT_POLICY]),
});

const LegacySessionSchema = z.object({
  version: z.literal(1),
  seed: z.string().min(1),
  picks: z.array(z.string().min(1)).max(MAX_HUMAN_PICKS),
  packIds: z.array(z.string().min(1)).min(1),
});

export type DraftSession = z.infer<typeof SessionSchema>;

/** The stored draft, or null when there is none, none readable, or none at this version. */
export function readDraftSession(): DraftSession | null {
  const raw = readStored(DRAFT_SESSION_KEY);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const read = SessionSchema.safeParse(parsed);
  if (read.success) return read.data;
  const legacy = LegacySessionSchema.safeParse(parsed);
  if (!legacy.success) return null;
  return {
    version: DRAFT_SESSION_VERSION,
    seed: legacy.data.seed,
    picks: legacy.data.picks,
    packIds: legacy.data.packIds,
    botPolicy: DRAFTMANCER_SIMPLE_BOT_POLICY,
  };
}

/**
 * Writes the draft as the one in progress.
 *
 * False means it is not kept and Continue will not offer it after a reload. The
 * caller decides what to say about that; the draft tab says nothing, because the
 * pick that was just made is on screen and in the URL either way.
 */
export function writeDraftSession(
  seed: string,
  picks: readonly string[],
  packIds: readonly string[],
  botPolicy: NativeDraftBotPolicy = DEFAULT_NATIVE_DRAFT_BOT_POLICY,
): boolean {
  const session: DraftSession = {
    version: DRAFT_SESSION_VERSION,
    seed,
    picks: [...picks],
    packIds: [...packIds],
    botPolicy,
  };
  return writeStored(DRAFT_SESSION_KEY, JSON.stringify(session));
}

/** Forgets the session, the way `clearSealedSession` does and for the same reason. */
export function clearDraftSession(): boolean {
  return writeStored(DRAFT_SESSION_KEY, '');
}

/** Why a stored draft could not be reopened against the set on this page. */
export type DraftResumeProblem =
  /** The same seed against this set opens a different pack: the set moved underneath. */
  | { readonly kind: 'set-changed' }
  /** The pack is the pack, but replaying the picks against it does not work. */
  | { readonly kind: 'transcript'; readonly message: string };

export type DraftResume =
  | {
      readonly ok: true;
      readonly seed: string;
      readonly picks: readonly string[];
      readonly botPolicy: NativeDraftBotPolicy;
      /** How many picks the whole draft is, so the offer can say where it stopped. */
      readonly totalPicks: number;
    }
  | { readonly ok: false; readonly problem: DraftResumeProblem };

/**
 * Re-deals the stored draft from the set on this page and replays the picks.
 *
 * The comparison is the whole function, exactly as it is in `resumeSealed`: the
 * picks are applied only once the re-dealt pack is the pack that was stored,
 * card for card and position for position.
 */
export function resumeDraft(
  session: DraftSession,
  set: readonly Card[],
  /**
   * The printing's sheets, when the staged document carries them. A stored
   * draft was dealt with whatever this page deals with now, so a set that
   * gained or lost its collation reads here as `set-changed`, which is what it
   * is: the same seed opens a different pack.
   */
  collation?: PackCollation,
): DraftResume {
  const deal = collation === undefined ? {} : { collation };
  let fresh;
  try {
    fresh = runHumanDraft(set, { ...deal, seed: session.seed, botPolicy: session.botPolicy });
  } catch {
    return { ok: false, problem: { kind: 'set-changed' } };
  }
  const opened = fresh.nextPick?.cards.map((card) => card.id) ?? [];
  const same =
    opened.length === session.packIds.length && opened.every((id, at) => id === session.packIds[at]);
  if (!same) return { ok: false, problem: { kind: 'set-changed' } };
  // The whole draft's length, from the pack that was just opened: eight seats
  // pass the same packs, so every round is one pick per card in a pack.
  const totalPicks = opened.length * fresh.rounds;
  if (session.picks.length === 0) {
    return { ok: true, seed: session.seed, picks: [], botPolicy: session.botPolicy, totalPicks };
  }
  try {
    runHumanDraft(set, {
      ...deal,
      seed: session.seed,
      picks: session.picks,
      botPolicy: session.botPolicy,
    });
  } catch (cause: unknown) {
    const message = cause instanceof DraftError ? cause.message : String(cause);
    return { ok: false, problem: { kind: 'transcript', message } };
  }
  return {
    ok: true,
    seed: session.seed,
    picks: session.picks,
    botPolicy: session.botPolicy,
    totalPicks,
  };
}
