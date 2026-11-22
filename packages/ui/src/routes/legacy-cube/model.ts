/** Pure composition model for the official printed-card Legacy Cube journey. */
import type { EvaluationCard, PhysicalCubeDraftProgress, PhysicalCubeDraftResult } from '@mtg/draft-export';
import {
  evaluateStructuralPrintedCard,
  runPhysicalCubeDraft,
  structuralPrintedFacts,
  structuralPrintedPickValue,
  STRUCTURAL_PRINTED_EVALUATION_POLICY,
} from '@mtg/draft-export';
import type { SessionSpec } from '@mtg/engine';
import type { LimitedDeck, LimitedDeckReport, LimitedSelectionReport } from '@mtg/limited';
import {
  prepareLimitedDeck,
  suggestLimitedDeckWithReport,
  toDeckRef,
  validateLimitedDeck,
} from '@mtg/limited';
import type { PrintedCardCatalog, PrintedCardCatalogEntry } from '@mtg/printed-card';
import { parsePrintedCardCatalog, serializedPrintedCardCatalogContent } from '@mtg/printed-card';
import { z } from 'zod';
import { sha256Text } from '../analysis/calibration-read';

export const LEGACY_CUBE_HUMAN_SEAT = 'seat-1';
export const LEGACY_CUBE_OPPONENT_SEAT = 'seat-2';
export const LEGACY_CUBE_FORMAT = 'legacy-cube-2021-08';
export const LEGACY_CUBE_FORGE_READY_KIND = 'legacy-cube-forge-ready-pool';
export const LEGACY_CUBE_FORGE_READY_SCHEMA_VERSION = 1;
export const LEGACY_CUBE_OFFICIAL_POSITIONS = 600;
export const LEGACY_CUBE_DRAFT_STRUCTURE = { seats: 8, rounds: 3, packSize: 15 } as const;
export const LEGACY_CUBE_BOT_POLICY = STRUCTURAL_PRINTED_EVALUATION_POLICY;

export type LegacyCubePoolMode = 'full' | 'forge-ready';

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/u);
const ForgeReadyPoolSchema = z
  .object({
    schemaVersion: z.literal(LEGACY_CUBE_FORGE_READY_SCHEMA_VERSION),
    kind: z.literal(LEGACY_CUBE_FORGE_READY_KIND),
    format: z.string().min(1),
    forgeVersion: z.string().min(1),
    catalogContentSha256: Sha256,
    decisionLedgerContentSha256: Sha256,
    decisionLedgerFileSha256: Sha256,
    positions: z.array(z.number().int().positive()).min(1),
    cards: z.number().int().positive(),
    draft: z.object({
      seats: z.number().int().min(2).max(8),
      rounds: z.number().int().positive(),
      packSize: z.number().int().positive(),
    }),
    contentSha256: Sha256,
  })
  .strict();

export type LegacyCubeForgeReadyPool = z.infer<typeof ForgeReadyPoolSchema>;

export interface LegacyCubeDraftPool {
  readonly mode: LegacyCubePoolMode;
  readonly catalog: PrintedCardCatalog;
  readonly cards: readonly PrintedCardCatalogEntry[];
  readonly fingerprint: string;
  readonly draft: {
    readonly seats: number;
    readonly rounds: number;
    readonly packSize: number;
  };
}

function serializedForgeReadyPoolContent(pool: Omit<LegacyCubeForgeReadyPool, 'contentSha256'>): string {
  return JSON.stringify(pool);
}

/** Parse a staged admission projection and bind every position back to this exact catalog. */
export async function readLegacyCubeForgeReadyPool(
  input: unknown,
  catalog: PrintedCardCatalog,
): Promise<LegacyCubeForgeReadyPool> {
  const pool = ForgeReadyPoolSchema.parse(input);
  const { contentSha256, ...content } = pool;
  const actual = await sha256Text(serializedForgeReadyPoolContent(content));
  if (actual !== contentSha256) {
    throw new Error(`Legacy Cube Forge-ready pool checksum drift: expected ${contentSha256}, got ${actual}`);
  }
  if (pool.catalogContentSha256 !== catalog.contentSha256 || pool.format !== catalog.format) {
    throw new Error('Legacy Cube Forge-ready pool belongs to another catalog');
  }
  if (pool.forgeVersion !== catalog.forgeVersion) {
    throw new Error('Legacy Cube Forge-ready pool belongs to another Forge version');
  }
  if (pool.cards !== pool.positions.length) {
    throw new Error('Legacy Cube Forge-ready pool card count does not match its positions');
  }
  if (catalog.cards.length !== LEGACY_CUBE_OFFICIAL_POSITIONS || pool.cards !== catalog.cards.length) {
    throw new Error(
      `Legacy Cube Forge-ready pool must contain the complete ${String(LEGACY_CUBE_OFFICIAL_POSITIONS)}-position catalog, got ${String(pool.cards)}`,
    );
  }
  if (
    pool.draft.seats !== LEGACY_CUBE_DRAFT_STRUCTURE.seats ||
    pool.draft.rounds !== LEGACY_CUBE_DRAFT_STRUCTURE.rounds ||
    pool.draft.packSize !== LEGACY_CUBE_DRAFT_STRUCTURE.packSize
  ) {
    throw new Error('Legacy Cube Forge-ready pool must use the official 8-seat, 3-round, 15-card structure');
  }
  const positions = [...pool.positions].sort((left, right) => left - right);
  if (
    new Set(positions).size !== positions.length ||
    positions.some((position, index) => position !== pool.positions[index])
  ) {
    throw new Error('Legacy Cube Forge-ready pool positions must be unique and sorted');
  }
  for (const position of positions) {
    if (catalog.cards[position - 1]?.position !== position) {
      throw new Error(`Legacy Cube Forge-ready position ${String(position)} is outside this catalog`);
    }
  }
  const capacity = pool.draft.seats * pool.draft.rounds * pool.draft.packSize;
  if (capacity > pool.cards) {
    throw new Error(
      `Legacy Cube Forge-ready draft needs ${String(capacity)} cards, but its pool holds ${String(pool.cards)}`,
    );
  }
  return pool;
}

/** One explicit draft source, either all 600 positions or the pinned admission projection. */
export function legacyCubeDraftPool(
  catalog: PrintedCardCatalog,
  mode: LegacyCubePoolMode,
  forgeReady?: LegacyCubeForgeReadyPool,
): LegacyCubeDraftPool {
  if (mode === 'full') {
    return {
      mode,
      catalog,
      cards: catalog.cards,
      fingerprint: catalog.contentSha256,
      draft: LEGACY_CUBE_DRAFT_STRUCTURE,
    };
  }
  if (forgeReady === undefined) throw new Error('the Forge-ready Legacy Cube pool is not staged');
  const positions = new Set(forgeReady.positions);
  return {
    mode,
    catalog,
    cards: catalog.cards.filter((card) => positions.has(card.position)),
    fingerprint: forgeReady.contentSha256,
    draft: forgeReady.draft,
  };
}

function normalizedPool(catalogOrPool: PrintedCardCatalog | LegacyCubeDraftPool): LegacyCubeDraftPool {
  return 'mode' in catalogOrPool ? catalogOrPool : legacyCubeDraftPool(catalogOrPool, 'full');
}

interface LegacyCubeScoreCache {
  readonly cards: WeakMap<PrintedCardCatalogEntry, EvaluationCard>;
  readonly values: Map<string, number>;
}

// Sessions sharing a mounted catalog may reuse this deterministic memo; weak keys release the catalog.
const scoreCaches = new WeakMap<PrintedCardCatalog, LegacyCubeScoreCache>();

function scoreCache(catalogOrPool: PrintedCardCatalog | LegacyCubeDraftPool): LegacyCubeScoreCache {
  const catalog = 'mode' in catalogOrPool ? catalogOrPool.catalog : catalogOrPool;
  const existing = scoreCaches.get(catalog);
  if (existing !== undefined) return existing;
  const created = {
    cards: new WeakMap<PrintedCardCatalogEntry, EvaluationCard>(),
    values: new Map<string, number>(),
  };
  scoreCaches.set(catalog, created);
  return created;
}

function structuralEvaluation(cache: LegacyCubeScoreCache, card: PrintedCardCatalogEntry): EvaluationCard {
  const existing = cache.cards.get(card);
  if (existing !== undefined) return existing;
  const created = evaluateStructuralPrintedCard(card, card.physicalId);
  cache.cards.set(card, created);
  return created;
}

/** The exact production score used by every automated Cube draft seat. */
export function legacyCubeBotPickValue(
  catalogOrPool: PrintedCardCatalog | LegacyCubeDraftPool,
  card: PrintedCardCatalogEntry,
  picked: readonly PrintedCardCatalogEntry[],
): number {
  const cache = scoreCache(catalogOrPool);
  const key = JSON.stringify([card.physicalId, picked.map((copy) => copy.physicalId)]);
  const existing = cache.values.get(key);
  if (existing !== undefined) return existing;
  const value = structuralPrintedPickValue(
    structuralEvaluation(cache, card),
    picked.map((copy) => structuralEvaluation(cache, copy)),
  );
  if (cache.values.size >= 8192) cache.values.clear();
  cache.values.set(key, value);
  return value;
}

export interface LegacyCubeDeckBuild {
  readonly deck: LimitedDeck<PrintedCardCatalogEntry>;
  readonly report: LimitedDeckReport;
  readonly selection: LimitedSelectionReport;
}

const JAVA_RANDOM_MULTIPLIER = 0x5deece66dn;
const JAVA_RANDOM_ADDEND = 0xbn;
const JAVA_RANDOM_MASK = (1n << 48n) - 1n;

function javaNextInt(state: { value: bigint }, bound: number): number {
  if (!Number.isSafeInteger(bound) || bound <= 0) throw new Error('Java random bound must be positive');
  for (;;) {
    state.value = (state.value * JAVA_RANDOM_MULTIPLIER + JAVA_RANDOM_ADDEND) & JAVA_RANDOM_MASK;
    const bits = Number(state.value >> 17n);
    if ((bound & (bound - 1)) === 0) return Number((BigInt(bound) * BigInt(bits)) >> 31n);
    const value = bits % bound;
    if (((bits - value + (bound - 1)) | 0) >= 0) return value;
  }
}

/**
 * Locate the seat Forge 2.0.14 will ask to choose the first player.
 *
 * Forge consumes its seeded Java random stream by shuffling both libraries.
 * Although Forge contains an AI mana-smoothing shuffle, the bridge's GameRules
 * leave allowCheatShuffle false and the pinned Default AI profile also leaves
 * CHEAT_WITH_MANA_ON_SHUFFLE false. Both controllers therefore consume exactly
 * one Collections.shuffle pass. The next binary draw chooses which seat
 * receives the opening choice. Keeping this version-pinned calculation in the
 * format adapter lets the ordinary SessionSpec keep its seed unchanged while
 * placing the local controller where that choice will be offered. An unfamiliar
 * Forge version fails explicitly.
 */
export async function legacyCubeForgeOpeningChoiceSeat(
  seed: string,
  forgeVersion: string,
  mainDeckSizes: readonly [number, number],
): Promise<0 | 1> {
  if (forgeVersion !== '2.0.14') {
    throw new Error(`Legacy Cube play-first routing is audited only for Forge 2.0.14, got ${forgeVersion}`);
  }
  if (mainDeckSizes.some((size) => size !== 40)) {
    throw new Error('Legacy Cube play-first routing needs two equal 40-card main-deck sizes');
  }
  const digest = await sha256Text(seed);
  const foldedSeed = BigInt(`0x${digest.slice(0, 16)}`);
  const state = { value: (foldedSeed ^ JAVA_RANDOM_MULTIPLIER) & JAVA_RANDOM_MASK };
  for (const size of mainDeckSizes) {
    // java.util.Collections.shuffle consumes nextInt(size), down through 2.
    for (let bound = size; bound > 1; bound -= 1) javaNextInt(state, bound);
  }
  return javaNextInt(state, 2) === 0 ? 0 : 1;
}

export type LegacyCubePickRead =
  { readonly ok: true; readonly picks: readonly string[] } | { readonly ok: false; readonly message: string };

/** Parse and verify the portable artifact before any cards can be dealt from it. */
export async function readLegacyCubeCatalog(input: unknown): Promise<PrintedCardCatalog> {
  const catalog = parsePrintedCardCatalog(input);
  const actual = await sha256Text(serializedPrintedCardCatalogContent(catalog));
  if (actual !== catalog.contentSha256) {
    throw new Error(`Legacy Cube catalog checksum drift: expected ${catalog.contentSha256}, got ${actual}`);
  }
  return catalog;
}

/** Reconstruct a draft from its seed and the human seat's physical-id transcript. */
export function runLegacyCubeDraft(
  catalogOrPool: PrintedCardCatalog | LegacyCubeDraftPool,
  seed: string,
  picks: readonly string[],
  humanSeatId: string = LEGACY_CUBE_HUMAN_SEAT,
): PhysicalCubeDraftProgress<PrintedCardCatalogEntry> {
  const pool = normalizedPool(catalogOrPool);
  const seatIds = Array.from({ length: pool.draft.seats }, (_unused, index) => `seat-${String(index + 1)}`);
  if (!seatIds.includes(humanSeatId)) throw new Error(`Legacy Cube draft has no ${humanSeatId}`);
  return runPhysicalCubeDraft(
    pool.cards.map((card) => ({ physicalId: card.physicalId, payload: card })),
    {
      seed,
      seatIds,
      rounds: pool.draft.rounds,
      packSize: pool.draft.packSize,
      humanSeatIds: [humanSeatId],
      picks: { [humanSeatId]: picks },
      score: ({ card, picked }) =>
        legacyCubeBotPickValue(
          catalogOrPool,
          card.payload,
          picked.map((copy) => copy.payload),
        ),
    },
  );
}

/** Compact URL form: source positions in base 36, bound back to physical ids by the catalog. */
export function encodeLegacyCubePicks(catalog: PrintedCardCatalog, picks: readonly string[]): string {
  const positions = new Map(catalog.cards.map((card) => [card.physicalId, card.position]));
  return picks
    .map((physicalId) => {
      const position = positions.get(physicalId);
      if (position === undefined) throw new Error(`Legacy Cube pick ${physicalId} is outside the catalog`);
      return position.toString(36);
    })
    .join('.');
}

export function decodeLegacyCubePicks(
  catalogOrPool: PrintedCardCatalog | LegacyCubeDraftPool,
  encoded: string | undefined,
): LegacyCubePickRead {
  const pool = normalizedPool(catalogOrPool);
  const catalog = pool.catalog;
  if (encoded === undefined || encoded.length === 0) return { ok: true, picks: [] };
  const picks: string[] = [];
  const seen = new Set<string>();
  for (const token of encoded.split('.')) {
    if (!/^[0-9a-z]+$/u.test(token)) {
      return { ok: false, message: `Legacy Cube pick token ${JSON.stringify(token)} is malformed` };
    }
    const position = Number.parseInt(token, 36);
    const card = catalog.cards[position - 1];
    if (!Number.isSafeInteger(position) || position <= 0 || card === undefined) {
      return { ok: false, message: `Legacy Cube position ${JSON.stringify(token)} is outside this catalog` };
    }
    if (seen.has(card.physicalId)) {
      return { ok: false, message: `Legacy Cube position ${String(position)} is picked more than once` };
    }
    if (!pool.cards.includes(card)) {
      return {
        ok: false,
        message: `Legacy Cube position ${String(position)} is outside the ${pool.mode} pool`,
      };
    }
    seen.add(card.physicalId);
    picks.push(card.physicalId);
  }
  return { ok: true, picks };
}

/** Deterministically suggest a legal deck for one seat's 45 physical picks. */
export function buildLegacyCubeDeck(
  draft: PhysicalCubeDraftResult<PrintedCardCatalogEntry>,
  seatId: string,
): LegacyCubeDeckBuild {
  const seat = draft.seats.find((candidate) => candidate.seatId === seatId);
  if (seat === undefined) throw new Error(`Legacy Cube draft has no ${seatId}`);
  return buildLegacyCubePoolDeck(seat.picks.map((pick) => pick.card));
}

/** Run the production Cube builder directly on one fixed 45-card pool. */
export function buildLegacyCubePoolDeck(
  pool: readonly { readonly physicalId: string; readonly payload: PrintedCardCatalogEntry }[],
): LegacyCubeDeckBuild {
  const prepared = prepareLimitedDeck(pool, (card) => structuralPrintedFacts(card.payload));
  const selection = suggestLimitedDeckWithReport(prepared, { policy: 'deck-conditioned/v1' });
  return { deck: selection.deck, report: validateLimitedDeck(selection.deck), selection: selection.report };
}

/** Apply the same strongest-play construction policy to manual Cube builder suggestions. */
export function suggestLegacyCubeDeck(
  deck: LimitedDeck<PrintedCardCatalogEntry>,
): LimitedDeck<PrintedCardCatalogEntry> {
  return suggestLimitedDeckWithReport(deck, { policy: 'deck-conditioned/v1' }).deck;
}

/** The only point where physical picks become backend-neutral named/count decks. */
export function legacyCubeSessionSpec(
  catalog: PrintedCardCatalog,
  human: LimitedDeck<PrintedCardCatalogEntry>,
  opponent: LimitedDeck<PrintedCardCatalogEntry>,
  seed: string,
  humanSeat: 0 | 1 = 0,
): SessionSpec {
  const humanSpec = { name: 'You', controller: 'local' as const, deck: toDeckRef(human, 'Your draft deck') };
  const opponentSpec = {
    name: 'Forge bot',
    controller: 'engine' as const,
    deck: toDeckRef(opponent, 'Bot draft deck'),
  };
  return {
    content: { kind: 'printed', format: catalog.format },
    seats: humanSeat === 0 ? [humanSpec, opponentSpec] : [opponentSpec, humanSpec],
    seed,
    maximumTurns: null,
  };
}
