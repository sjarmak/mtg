/**
 * The cube draft you were in the middle of, kept across a tab press.
 *
 * `mtg-bc2.154.4.30`. The Draft tab's cube row argued there was no
 * Continue to draw here, because a cube draft's whole transcript is already in
 * the hash and a second control would offer back the page you are standing on.
 * That is true of a reload and false of the tab row: pressing Draft navigates
 * through `../../app/router.ts`'s `goTo` with `params: {}`, which drops `cube`,
 * `seed` and `picks` together, and up to forty-five picks go with them. The hash
 * is the resume for a reload; this file is the resume for a tab press.
 *
 * # The guard is the catalog's own hash
 *
 * `../draft/draft-session.ts` stores pack 1 pick 1's ids because a set re-dealt
 * at the same seed can hold different cards and it has no cheaper way to notice.
 * The cube has one. `PrintedCardCatalog.contentSha256` covers the format, the
 * source, the Forge version and every card in order, and `./model.ts`'s
 * `readLegacyCubeCatalog` verifies it before a single card is dealt, so a
 * catalog that moved underneath is one string comparison rather than a re-dealt
 * pack.
 *
 * That guard is a better error rather than a rescue from a silent one. A
 * `physicalId` binds the format, the position and the Scryfall id together, so a
 * re-staged catalog holding different cards at the same positions names them
 * with different ids and `@mtg/draft-export`'s `takeLoggedPick` throws instead of
 * replaying onto cards nobody chose. What the hash buys is the difference
 * between that thrown error on the drafting screen and a stated refusal on the
 * chooser, one press earlier.
 *
 * # Checked before it is drawn, and no further
 *
 * `../DraftRoute.ts`'s `useDraftOffer` says outright that a Continue which fails
 * after somebody presses it is the control this repository refuses to draw. This
 * one is held to that: the stored hash matches the catalog this page has already
 * verified, and the transcript decodes against it.
 *
 * It deliberately stops there and never calls `runLegacyCubeDraft`, which deals
 * 24 packs to eight seats -- `./resume-offer.ts`'s caller runs unmemoized on
 * every render of the cube's chooser. That is why the note counts against the format's own
 * `PHYSICAL_CUBE_DEFAULT_ROUNDS * PHYSICAL_CUBE_DEFAULT_PACK_SIZE` rather than
 * against a total it would have to deal a draft to learn.
 */
import { z } from 'zod';
import type { CanonicalBasicName, LimitedDeck } from '@mtg/limited';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { readStored, writeStored } from '../deck/local-store';
import type { LegacyCubeDraftPool } from './model';
import { decodeLegacyCubePicks, legacyCubeDraftPool, runLegacyCubeDraft } from './model';

/**
 * Bumped whenever the shape below changes. Versions 2 and 3 remain readable so
 * their draft transcripts are not discarded; only version 4 can carry an exact
 * edited deck.
 */
export const LEGACY_CUBE_SESSION_VERSION = 4;

/** Where it lives, beside the generated draft's own session key. */
export const LEGACY_CUBE_SESSION_KEY = 'mtg.legacy-cube.session';

/** The last match launched from a completed draft, separate from the draft transcript. */
export const LEGACY_CUBE_MATCH_KEY = 'mtg.legacy-cube.match';

const LegacyCubeMatchSchema = z
  .object({
    version: z.literal(1),
    catalog: z.string().min(1),
    mode: z.enum(['full', 'forge-ready']),
    pool: z.string().min(1),
    draftSeed: z.string().min(1),
    picks: z.string().min(1),
    matchSeed: z.string().min(1),
  })
  .strict();

const SessionBase = z.object({
  /** The catalog's content hash: what makes this transcript readable at all. */
  catalog: z.string().min(1),
  /** Which physical-card population was shuffled. */
  mode: z.enum(['full', 'forge-ready']),
  /** Catalog hash for full, admission-projection hash for Forge-ready. */
  pool: z.string().min(1),
  /** What dealt every pack, and what deals them again. */
  seed: z.string().min(1),
  /**
   * The transcript in the hash's own compact form, exactly as the route encoded
   * it. A seeded draft with no picks yet is not written and not offered back:
   * there is nothing to continue that New does not deal, which is the line
   * `../draft/draft-session.ts` draws too.
   */
  picks: z.string().min(1),
});

const LegacyCubeDraftSourceSchema = z
  .object({
    /** The verified physical-card population, in canonical catalog order. */
    positions: z.array(z.number().int().positive()).min(1),
    draft: z.object({
      seats: z.number().int().min(2).max(8),
      rounds: z.number().int().positive(),
      packSize: z.number().int().positive(),
    }),
  })
  .strict();

const StoredLegacyCubeDeckSchema = z
  .object({
    selectedPhysicalIds: z.array(z.string().min(1)),
    basics: z
      .object({
        Plains: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        Island: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        Swamp: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        Mountain: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        Forest: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      })
      .strict(),
  })
  .strict();

type StoredLegacyCubeDeck = z.infer<typeof StoredLegacyCubeDeckSchema>;

const SessionSchema = z.discriminatedUnion('version', [
  SessionBase.extend({ version: z.literal(2) }).strict(),
  SessionBase.extend({
    version: z.literal(3),
    /** Enough verified source identity to replay a finished draft after a safe pool expansion. */
    source: LegacyCubeDraftSourceSchema,
  }).strict(),
  SessionBase.extend({
    version: z.literal(LEGACY_CUBE_SESSION_VERSION),
    /** Enough verified source identity to replay a finished draft after a safe pool expansion. */
    source: LegacyCubeDraftSourceSchema,
    /** Parsed separately so a corrupt edit cannot make the draft transcript unreadable. */
    deck: z.unknown().optional(),
  }).strict(),
]);

export type LegacyCubeSession = z.infer<typeof SessionSchema>;

/** The stored draft, or null when there is none or its supported schema cannot read it. */
export function readLegacyCubeSession(): LegacyCubeSession | null {
  const raw = readStored(LEGACY_CUBE_SESSION_KEY);
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

/** The last exact match seed owned by this completed draft, or null for any foreign record. */
export function readLegacyCubeMatchSeed(
  pool: LegacyCubeDraftPool,
  draftSeed: string,
  picks: string,
): string | null {
  const raw = readStored(LEGACY_CUBE_MATCH_KEY);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const read = LegacyCubeMatchSchema.safeParse(parsed);
  if (
    !read.success ||
    read.data.catalog !== pool.catalog.contentSha256 ||
    read.data.mode !== pool.mode ||
    read.data.pool !== pool.fingerprint ||
    read.data.draftSeed !== draftSeed ||
    read.data.picks !== picks
  ) {
    return null;
  }
  return read.data.matchSeed;
}

/** Persist one replayable match without changing the draft seed, picks, pool, or deck. */
export function writeLegacyCubeMatchSeed(
  pool: LegacyCubeDraftPool,
  draftSeed: string,
  picks: string,
  matchSeed: string,
): boolean {
  return writeStored(
    LEGACY_CUBE_MATCH_KEY,
    JSON.stringify({
      version: 1,
      catalog: pool.catalog.contentSha256,
      mode: pool.mode,
      pool: pool.fingerprint,
      draftSeed,
      picks,
      matchSeed,
    }),
  );
}

/**
 * Writes the cube draft as the one in progress.
 *
 * False means it is not kept and Continue will not offer it after a tab press.
 * The route says nothing about that, for `writeDraftSession`'s reason: the pick
 * just made is on screen and in the link either way.
 */
export function writeLegacyCubeSession<Payload>(
  catalogOrPool: PrintedCardCatalog | LegacyCubeDraftPool,
  seed: string,
  picks: string,
  deck?: LimitedDeck<Payload>,
): boolean {
  const pool = 'mode' in catalogOrPool ? catalogOrPool : legacyCubeDraftPool(catalogOrPool, 'full');
  const session: LegacyCubeSession = {
    version: LEGACY_CUBE_SESSION_VERSION,
    catalog: pool.catalog.contentSha256,
    mode: pool.mode,
    pool: pool.fingerprint,
    seed,
    picks,
    source: {
      positions: pool.cards.map((card) => card.position),
      draft: pool.draft,
    },
    ...(deck === undefined
      ? {}
      : {
          deck: {
            selectedPhysicalIds: [...deck.selectedPhysicalIds],
            basics: { ...deck.basics },
          } satisfies StoredLegacyCubeDeck,
        }),
  };
  return writeStored(LEGACY_CUBE_SESSION_KEY, JSON.stringify(session));
}

/** Restore the two editable fields onto the verified pool that owns them. */
export function restoreLegacyCubeDeck<Payload>(
  session: LegacyCubeSession,
  pool: LegacyCubeDraftPool,
  seed: string,
  picks: string,
  prepared: LimitedDeck<Payload>,
): LimitedDeck<Payload> | null {
  if (
    session.version !== LEGACY_CUBE_SESSION_VERSION ||
    session.catalog !== pool.catalog.contentSha256 ||
    session.mode !== pool.mode ||
    session.pool !== pool.fingerprint ||
    session.seed !== seed ||
    session.picks !== picks
  ) {
    return null;
  }
  const read = StoredLegacyCubeDeckSchema.safeParse(session.deck);
  if (!read.success) return null;
  const known = new Set(prepared.pool.map((card) => card.physicalId));
  const selected = read.data.selectedPhysicalIds;
  if (new Set(selected).size !== selected.length || selected.some((physicalId) => !known.has(physicalId))) {
    return null;
  }
  return {
    ...prepared,
    selectedPhysicalIds: [...selected],
    basics: { ...read.data.basics } as Readonly<Record<CanonicalBasicName, number>>,
  };
}

/** Forgets the session, the way `clearDraftSession` does and for the same reason. */
export function clearLegacyCubeSession(): boolean {
  const session = writeStored(LEGACY_CUBE_SESSION_KEY, '');
  const match = writeStored(LEGACY_CUBE_MATCH_KEY, '');
  return session && match;
}

/** A stored cube draft this catalog can reopen, or one it cannot. */
export type LegacyCubeResume =
  | {
      readonly ok: true;
      readonly seed: string;
      /** The transcript, still encoded: what the link this offer writes carries. */
      readonly picks: string;
      /** How far in it stopped, so the offer can say so without dealing a draft. */
      readonly picksMade: number;
      readonly mode: LegacyCubeDraftPool['mode'];
    }
  | { readonly ok: false };

/** Checks a stored draft against the staged catalog, without dealing anything. */
export function resumeLegacyCube(
  session: LegacyCubeSession,
  catalogOrPool: PrintedCardCatalog | LegacyCubeDraftPool,
): LegacyCubeResume {
  const pool = 'mode' in catalogOrPool ? catalogOrPool : legacyCubeDraftPool(catalogOrPool, 'full');
  if (
    session.catalog !== pool.catalog.contentSha256 ||
    session.mode !== pool.mode ||
    session.pool !== pool.fingerprint
  ) {
    return { ok: false };
  }
  const read = decodeLegacyCubePicks(pool, session.picks);
  if (!read.ok) return { ok: false };
  return {
    ok: true,
    seed: session.seed,
    picks: session.picks,
    picksMade: read.picks.length,
    mode: pool.mode,
  };
}

/**
 * Rebuild the exact source of a completed draft after an admission projection expands.
 *
 * In-progress drafts stay bound to the projection that dealt them. A completed
 * transcript may cross a projection change only when every historical source
 * position is still admitted by the current projection; the backend performs
 * its own content support check again when the resulting decks are opened.
 */
export function restoreCompletedLegacyCubePool(
  session: LegacyCubeSession,
  current: LegacyCubeDraftPool,
  seed: string,
  picks: string,
): LegacyCubeDraftPool | null {
  if (
    session.version === 2 ||
    session.catalog !== current.catalog.contentSha256 ||
    session.mode !== current.mode ||
    session.seed !== seed ||
    session.picks !== picks ||
    session.pool === current.fingerprint
  ) {
    return null;
  }

  const positions = session.source.positions;
  const sorted = [...positions].sort((left, right) => left - right);
  if (
    new Set(positions).size !== positions.length ||
    positions.some((position, index) => position !== sorted[index])
  ) {
    return null;
  }
  const currentPositions = new Set(current.cards.map((card) => card.position));
  if (positions.some((position) => !currentPositions.has(position))) return null;
  const cards: PrintedCardCatalog['cards'][number][] = [];
  for (const position of positions) {
    const card = current.catalog.cards[position - 1];
    if (card?.position !== position) return null;
    cards.push(card);
  }
  const source: LegacyCubeDraftPool = {
    mode: session.mode,
    catalog: current.catalog,
    cards,
    fingerprint: session.pool,
    draft: session.source.draft,
  };
  if (source.draft.seats * source.draft.rounds * source.draft.packSize > source.cards.length) {
    return null;
  }
  const decoded = decodeLegacyCubePicks(source, picks);
  if (!decoded.ok || decoded.picks.length !== source.draft.rounds * source.draft.packSize) return null;
  try {
    return runLegacyCubeDraft(source, seed, decoded.picks).result === null ? null : source;
  } catch {
    return null;
  }
}
