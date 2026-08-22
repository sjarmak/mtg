/**
 * Automated Sealed evidence: independent six-pack pools -> deterministic
 * 40-card builds -> both seat orders -> kernel games -> physical-card ledgers.
 *
 * This is a secondary, automated format oracle. It carries no Draft pick and
 * no human observation, and card win-rate fields are explicitly associations,
 * never causal strength estimates.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import type { BoosterRecipe, BoosterSlot, ColorPair, DeckBuildResult, Shortfall } from '@mtg/deckbuild';
import { boosterSlotRarityWeights, buildDeck, openSealedPool } from '@mtg/deckbuild';
import type { BasicLandType, Card, CardKind, ManaColor, Rarity } from '@mtg/dsl';
import {
  basicLand,
  BASIC_LAND_COLOR,
  BASIC_LAND_TYPES,
  BasicLandTypeSchema,
  canonicalJson,
  cardFingerprint,
  CardSchema,
  CardKindSchema,
  COLORS,
  ManaColorSchema,
  parseCard,
  RARITIES,
} from '@mtg/dsl';
import type { GameEvent } from '@mtg/kernel';
import { objectId } from '@mtg/kernel';
import type { MatchRun, MatchSpec } from '@mtg/sim';
import { greedySpec, SimGameLogSchema, withSimPool } from '@mtg/sim';
import { DRAFT_COLLATION_VERSION, DraftCollationSchema } from './draft-calibration';
import { gameFingerprint } from './sample';
import { wilsonInterval } from './stats';

export const SEALED_CALIBRATION_ARTIFACT_VERSION = 'native-sealed-calibration-v2';
export const SEALED_CALIBRATION_PRODUCER = '@mtg/metrics/native-sealed-calibration-v2';
export const SEALED_COLLATION_VERSION = 'sealed-collation-adapter-v1';
export const SEALED_BOOSTERS_PER_POOL = 6;
export const DEFAULT_SEALED_POOL_PAIRS = 8;
export const DEFAULT_SEALED_GAMES_PER_SEAT_ORDER = 2;
export const DEFAULT_SEALED_CARD_FLOOR = 30;
export const DEFAULT_SEALED_GAME_FLOOR = 30;
export const MAX_SEALED_WORKERS = 64;
export const MAX_SEALED_POOL_PAIRS = 32;
export const MAX_SEALED_GAMES_PER_SEAT_ORDER = 50;
export const MAX_SEALED_GAMES = MAX_SEALED_POOL_PAIRS * 2 * MAX_SEALED_GAMES_PER_SEAT_ORDER;
export const MAX_SEALED_CARD_FLOOR = MAX_SEALED_GAMES * 2;
export const MAX_SEALED_GAME_FLOOR = MAX_SEALED_GAMES;
export const MAX_SEALED_SET_SIZE = 1_000;
export const MAX_SEALED_PACK_SIZE = 30;
export const MAX_SEALED_PATH_LENGTH = 4_096;
export const MAX_SEALED_SEED_LENGTH = 256;
export const MAX_SEALED_SET_BYTES = 8 * 1024 * 1024;
export const MAX_SEALED_COLLATION_BYTES = 64 * 1024;
const MAX_SEALED_RAW_EVENTS_PER_GAME = 100_000;
const MAX_SEALED_RELEVANT_EVENTS_PER_GAME = 20_000;
const MAX_SEALED_OPENED_CARDS = SEALED_BOOSTERS_PER_POOL * MAX_SEALED_PACK_SIZE;
const MAX_SEALED_POOLS = MAX_SEALED_POOL_PAIRS * 2;
const MAX_SEALED_GAME_SEED_LENGTH = MAX_SEALED_SEED_LENGTH + 80;
const MAX_TRAJECTORY_LENGTH = 65_536;

const digest = z.string().regex(/^[0-9a-f]{64}$/);
const nonnegative = z.number().int().min(0);
const positive = z.number().int().positive();
const gameSeat = z.union([z.literal(0), z.literal(1)]);
const sealedSeat = gameSeat;
const color = z.enum(COLORS);
const rarity = z.enum(RARITIES);
const rawEventIndex = nonnegative.max(MAX_SEALED_RAW_EVENTS_PER_GAME - 1);

export interface SealedCollationInput {
  readonly version: typeof DRAFT_COLLATION_VERSION;
  readonly recipe: BoosterRecipe;
}

/**
 * The rarities one recipe slot's sheet can supply.
 *
 * A fixed slot supplies its own rarity and nothing else; a source-weighted slot
 * supplies every rarity it weights. `@mtg/deckbuild` opens packs off exactly
 * this set, so every check here that reads a slot's rarity has to read it too,
 * or a set that prints mythics fails checks its packs pass.
 */
function slotRarities(slot: BoosterSlot): ReadonlySet<Rarity> {
  return new Set(boosterSlotRarityWeights(slot).map((entry) => entry.rarity));
}

const SetCardIdentitySchema = z
  .object({
    cardId: z.string().min(1),
    cardName: z.string().min(1),
    cardKind: CardKindSchema,
    basicLandType: BasicLandTypeSchema.nullable(),
    producesMana: z.array(ManaColorSchema).max(6),
    rarity,
    printing: z.object({ code: z.string().min(1), collectorNumber: nonnegative }).strict(),
    fingerprint: digest,
  })
  .strict();

const OpenedCardEvidenceSchema = z
  .object({
    instanceId: z.string().min(1),
    cardId: z.string().min(1),
    cardName: z.string().min(1),
    cardKind: CardKindSchema,
    basicLandType: BasicLandTypeSchema.nullable(),
    producesMana: z.array(ManaColorSchema).max(6),
    rarity,
    packPosition: nonnegative.max(MAX_SEALED_PACK_SIZE - 1),
    printing: z.object({ code: z.string().min(1), collectorNumber: nonnegative }).strict(),
    fingerprint: digest,
  })
  .strict();

const BoosterEvidenceSchema = z
  .object({
    index: nonnegative.max(SEALED_BOOSTERS_PER_POOL - 1),
    cards: z.array(OpenedCardEvidenceSchema).min(1).max(MAX_SEALED_PACK_SIZE),
  })
  .strict();

const PoolEvidenceSchema = z
  .object({
    poolIndex: nonnegative.max(MAX_SEALED_POOL_PAIRS - 1),
    sealedSeat,
    seed: z.string().min(1).max(MAX_SEALED_GAME_SEED_LENGTH),
    collationFingerprint: digest,
    fingerprint: digest,
    openedCards: positive.max(MAX_SEALED_OPENED_CARDS),
    boosters: z.array(BoosterEvidenceSchema).length(SEALED_BOOSTERS_PER_POOL),
  })
  .strict();

const ShortfallSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('spellSlots'), target: positive, achieved: nonnegative, missing: positive })
    .strict(),
  z
    .object({
      kind: z.literal('curveSlot'),
      bucket: z.union([
        z.literal(0),
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
        z.literal(5),
        z.literal(6),
      ]),
      target: positive,
      achieved: nonnegative,
      missing: positive,
    })
    .strict(),
  z
    .object({ kind: z.literal('creatureFloor'), target: positive, achieved: nonnegative, missing: positive })
    .strict(),
  z
    .object({
      kind: z.literal('colorSources'),
      color,
      target: positive,
      achieved: nonnegative,
      missing: positive,
    })
    .strict(),
]);

const ManaReportEvidenceSchema = z
  .object({
    color,
    pipCount: positive,
    sources: nonnegative,
    earliestCastability: z.number().min(0).max(1),
    heaviestCastability: z.number().min(0).max(1),
    meetsCastabilityTarget: z.boolean(),
  })
  .strict();

const DeckCardEvidenceSchema = z
  .object({
    instanceId: z.string().min(1),
    cardId: z.string().min(1),
    cardName: z.string().min(1),
    cardKind: CardKindSchema,
    basicLandType: BasicLandTypeSchema.nullable(),
    producesMana: z.array(ManaColorSchema).max(6),
    rarity,
    printing: z.object({ code: z.string().min(1), collectorNumber: nonnegative }).strict(),
    fingerprint: digest,
    deckPosition: nonnegative.max(39),
    source: z.enum(['opened', 'basicLandSupply']),
    openedInstanceId: z.string().min(1).nullable(),
  })
  .strict();

const DeckEvidenceSchema = z
  .object({
    poolIndex: nonnegative.max(MAX_SEALED_POOL_PAIRS - 1),
    sealedSeat,
    poolSeed: z.string().min(1).max(MAX_SEALED_GAME_SEED_LENGTH),
    name: z.string().min(1),
    fingerprint: digest,
    poolCards: positive.max(MAX_SEALED_OPENED_CARDS),
    spells: z.literal(23),
    lands: z.literal(17),
    legal40: z.literal(true),
    shapeComplete: z.boolean(),
    manaConsistent: z.boolean(),
    colorPair: z.tuple([color, color]),
    creatureCount: nonnegative.max(23),
    removalCount: nonnegative.max(23),
    shortfalls: z.array(ShortfallSchema).max(32),
    manaReports: z.array(ManaReportEvidenceSchema).max(COLORS.length),
    cards: z.array(DeckCardEvidenceSchema).length(40),
  })
  .strict();

const IndexedRelevantCardEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      index: rawEventIndex,
      type: z.enum(['cardDrawn', 'spellCast', 'resolutionBegan', 'spellFizzled', 'permanentEntered']),
      oid: z.string().min(1),
    })
    .strict(),
  z
    .object({
      index: rawEventIndex,
      type: z.literal('zoneChanged'),
      oid: z.string().min(1),
      from: z.string().min(1),
      to: z.string().min(1),
    })
    .strict(),
]);

const CardInstanceGameEvidenceSchema = z
  .object({
    instanceId: z.string().min(1),
    cardId: z.string().min(1),
    poolIndex: nonnegative.max(MAX_SEALED_POOL_PAIRS - 1),
    sealedSeat,
    gameSeat,
    drawn: z.boolean(),
    cast: z.boolean(),
    resolved: z.boolean(),
    drawEventIndexes: z.array(rawEventIndex).max(MAX_SEALED_RELEVANT_EVENTS_PER_GAME),
    castEventIndexes: z.array(rawEventIndex).max(MAX_SEALED_RELEVANT_EVENTS_PER_GAME),
    successfulResolutionEventIndexes: z.array(rawEventIndex).max(MAX_SEALED_RELEVANT_EVENTS_PER_GAME),
  })
  .strict();

const GameEvidenceSchema = z
  .object({
    seed: z.string().min(1).max(MAX_SEALED_GAME_SEED_LENGTH),
    poolIndex: nonnegative.max(MAX_SEALED_POOL_PAIRS - 1),
    seatOrder: gameSeat,
    gameIndex: nonnegative.max(MAX_SEALED_GAMES_PER_SEAT_ORDER - 1),
    sealedSeats: z.tuple([sealedSeat, sealedSeat]),
    startingPlayer: gameSeat,
    winnerSealedSeat: sealedSeat.nullable(),
    reason: z.enum(['lifeZero', 'emptyLibrary', 'concede', 'turnLimit']),
    turns: positive,
    decisions: nonnegative,
    trajectoryFingerprint: z.string().min(1).max(MAX_TRAJECTORY_LENGTH),
    replay: SimGameLogSchema,
    rawEventCount: positive.max(MAX_SEALED_RAW_EVENTS_PER_GAME),
    relevantCardEventsFingerprint: digest,
    relevantCardEvents: z.array(IndexedRelevantCardEventSchema).max(MAX_SEALED_RELEVANT_EVENTS_PER_GAME),
    cardEvents: z.array(CardInstanceGameEvidenceSchema).length(80),
  })
  .strict();

const AssociationSchema = z
  .object({
    state: z.enum(['underSampled', 'estimated']),
    claim: z.literal('association-not-causal'),
    sampleUnit: z.literal('decidedDistinctTrajectory'),
    floor: positive.max(MAX_SEALED_CARD_FLOOR),
    games: nonnegative,
    decidedGames: nonnegative,
    distinctGames: nonnegative,
    distinctWins: nonnegative,
    symmetricGames: nonnegative,
    winRate: z.number().min(0).max(1).nullable(),
    interval95: z
      .object({ low: z.number().min(0).max(1), high: z.number().min(0).max(1) })
      .strict()
      .nullable(),
  })
  .strict();

const CardEvidenceSchema = z
  .object({
    cardId: z.string().min(1),
    cardName: z.string().min(1),
    openedCount: nonnegative,
    includedCount: nonnegative,
    unusedCount: nonnegative,
    gamesIncluded: nonnegative,
    winsIncluded: nonnegative,
    gamesDrawn: nonnegative,
    winsWhenDrawn: nonnegative,
    gamesCast: nonnegative,
    winsWhenCast: nonnegative,
    gamesResolved: nonnegative,
    winsWhenResolved: nonnegative,
    association: AssociationSchema,
  })
  .strict();

const PoolViabilitySchema = z
  .object({
    pools: positive.max(MAX_SEALED_POOLS),
    legalDecks: nonnegative.max(MAX_SEALED_POOLS),
    legalRate: z.number().min(0).max(1),
    shapeCompleteDecks: nonnegative.max(MAX_SEALED_POOLS),
    shapeCompleteRate: z.number().min(0).max(1),
    shortfalls: z
      .object({
        spellSlots: nonnegative,
        curveSlot: nonnegative,
        creatureFloor: nonnegative,
        colorSources: nonnegative,
      })
      .strict(),
  })
  .strict();

const ManaConsistencySchema = z
  .object({
    decks: positive.max(MAX_SEALED_POOLS),
    consistentDecks: nonnegative.max(MAX_SEALED_POOLS),
    consistentRate: z.number().min(0).max(1),
    colorRequirements: nonnegative,
    requirementsMeetingTarget: nonnegative,
    requirementRate: z.number().min(0).max(1).nullable(),
    meanEarliestCastability: z.number().min(0).max(1).nullable(),
    meanHeaviestCastability: z.number().min(0).max(1).nullable(),
    selectedColorPairs: z
      .array(z.object({ pair: z.tuple([color, color]), decks: positive.max(MAX_SEALED_POOLS) }).strict())
      .max(10),
  })
  .strict();

const GameShapeSchema = z
  .object({
    state: z.enum(['underSampled', 'estimated']),
    sampleUnit: z.literal('decidedDistinctTrajectory'),
    floor: positive.max(MAX_SEALED_GAME_FLOOR),
    games: nonnegative.max(MAX_SEALED_GAMES),
    decidedGames: nonnegative.max(MAX_SEALED_GAMES),
    draws: nonnegative.max(MAX_SEALED_GAMES),
    distinctGames: nonnegative.max(MAX_SEALED_GAMES),
    distinctDecidedGames: nonnegative.max(MAX_SEALED_GAMES),
    meanTurns: z.number().min(0),
    turnVariancePopulation: z.number().min(0),
    onPlayDecided: nonnegative.max(MAX_SEALED_GAMES),
    onPlayWins: nonnegative.max(MAX_SEALED_GAMES),
    onPlayWinRate: z.number().min(0).max(1).nullable(),
    interval95: z
      .object({ low: z.number().min(0).max(1), high: z.number().min(0).max(1) })
      .strict()
      .nullable(),
  })
  .strict();

export const SealedCalibrationArtifactSchema = z
  .object({
    version: z.literal(SEALED_CALIBRATION_ARTIFACT_VERSION),
    producedBy: z.literal(SEALED_CALIBRATION_PRODUCER),
    scope: z
      .object({
        format: z.literal('Sealed'),
        automated: z.literal(true),
        humanEvidence: z.literal(false),
        draftEvidence: z.literal(false),
        interpretation: z.literal('association-not-causal'),
      })
      .strict(),
    seed: z.string().min(1).max(MAX_SEALED_SEED_LENGTH),
    set: z
      .object({
        code: z.string().min(1).max(32),
        cards: positive.max(MAX_SEALED_SET_SIZE),
        fingerprint: digest,
        sourceCards: z.array(CardSchema).min(1).max(MAX_SEALED_SET_SIZE),
        cardIdentities: z.array(SetCardIdentitySchema).min(1).max(MAX_SEALED_SET_SIZE),
      })
      .strict(),
    collation: z
      .object({
        version: z.literal(SEALED_COLLATION_VERSION),
        sourceVersion: z.literal(DRAFT_COLLATION_VERSION),
        fingerprint: digest,
        recipe: DraftCollationSchema.shape.recipe,
      })
      .strict(),
    campaign: z
      .object({
        poolPairs: positive.min(2).max(MAX_SEALED_POOL_PAIRS),
        boostersPerPool: z.literal(SEALED_BOOSTERS_PER_POOL),
        gamesPerSeatOrder: positive.min(2).max(MAX_SEALED_GAMES_PER_SEAT_ORDER),
        cardFloor: positive.max(MAX_SEALED_CARD_FLOOR),
        gameFloor: positive.max(MAX_SEALED_GAME_FLOOR),
      })
      .strict(),
    pools: z.array(PoolEvidenceSchema).min(4).max(MAX_SEALED_POOLS),
    decks: z.array(DeckEvidenceSchema).min(4).max(MAX_SEALED_POOLS),
    games: z.array(GameEvidenceSchema).min(1).max(MAX_SEALED_GAMES),
    summary: z
      .object({
        poolViability: PoolViabilitySchema,
        manaConsistency: ManaConsistencySchema,
        gameShape: GameShapeSchema,
      })
      .strict(),
    cards: z.array(CardEvidenceSchema).min(1).max(MAX_SEALED_SET_SIZE),
  })
  .strict()
  .superRefine((artifact, context) => validateArtifact(artifact, context));

export type SealedCalibrationArtifact = z.infer<typeof SealedCalibrationArtifactSchema>;
export type SealedCalibrationGame = z.infer<typeof GameEvidenceSchema>;
export type SealedCalibrationDeck = z.infer<typeof DeckEvidenceSchema>;
type PoolEvidence = z.infer<typeof PoolEvidenceSchema>;
type DeckEvidence = z.infer<typeof DeckEvidenceSchema>;
type IndexedRelevantCardEvent = z.infer<typeof IndexedRelevantCardEventSchema>;
type SetCardIdentity = z.infer<typeof SetCardIdentitySchema>;

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function setCardIdentities(cards: readonly Card[]): SetCardIdentity[] {
  return [...cards]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((card) => ({
      cardId: card.id,
      cardName: card.name,
      cardKind: card.kind,
      basicLandType: card.kind === 'land' ? (card.basicLandType ?? null) : null,
      producesMana: card.kind === 'land' ? [...card.producesMana] : [],
      rarity: card.rarity,
      printing: { ...card.set },
      fingerprint: cardFingerprint(card),
    }));
}

function setFingerprint(identities: readonly SetCardIdentity[]): string {
  return sha256([...identities].sort((left, right) => left.cardId.localeCompare(right.cardId)));
}

function collationFingerprint(sourceVersion: typeof DRAFT_COLLATION_VERSION, recipe: BoosterRecipe): string {
  return sha256({ sourceVersion, recipe });
}

function openedInstanceId(poolIndex: number, seatId: 0 | 1, pack: number, position: number): string {
  return `sealed/pool/${String(poolIndex)}/seat/${String(seatId)}/pack/${String(pack)}/card/${String(position)}`;
}

function deckName(poolIndex: number, seatId: 0 | 1): string {
  return `sealed-pool-${String(poolIndex)}-seat-${String(seatId)}`;
}

function poolSeed(seed: string, poolIndex: number, seatId: 0 | 1): string {
  return `${seed}/pool/${String(poolIndex)}/seat/${String(seatId)}`;
}

function runSeed(seed: string, poolIndex: number, seatOrder: 0 | 1): string {
  return `${seed}/pool/${String(poolIndex)}/seat-order/${String(seatOrder)}`;
}

function poolFingerprint(pool: PoolEvidence): string {
  return sha256({
    poolIndex: pool.poolIndex,
    sealedSeat: pool.sealedSeat,
    seed: pool.seed,
    collationFingerprint: pool.collationFingerprint,
    boosters: pool.boosters,
  });
}

function deckFingerprint(cards: readonly z.infer<typeof DeckCardEvidenceSchema>[]): string {
  return sha256(cards);
}

function canonicalBasicSupply(
  pool: PoolEvidence,
  setCode: string,
  type: BasicLandType,
): {
  readonly cardId: string;
  readonly cardName: string;
  readonly cardKind: 'land';
  readonly basicLandType: BasicLandType;
  readonly producesMana: readonly ManaColor[];
  readonly rarity: Rarity;
  readonly printing: { readonly code: string; readonly collectorNumber: number };
  readonly fingerprint: string;
} {
  const printed = pool.boosters
    .flatMap((booster) => booster.cards)
    .find((card) => card.cardKind === 'land' && card.basicLandType === type);
  if (printed !== undefined) {
    return {
      cardId: printed.cardId,
      cardName: printed.cardName,
      cardKind: 'land',
      basicLandType: type,
      producesMana: [BASIC_LAND_COLOR[type]],
      rarity: printed.rarity,
      printing: { ...printed.printing },
      fingerprint: printed.fingerprint,
    };
  }
  const collectorNumber = BASIC_LAND_TYPES.indexOf(type) + 1;
  const synthesized = basicLand(type, setCode, collectorNumber);
  return {
    cardId: synthesized.id,
    cardName: synthesized.name,
    cardKind: 'land',
    basicLandType: type,
    producesMana: [BASIC_LAND_COLOR[type]],
    rarity: synthesized.rarity,
    printing: { ...synthesized.set },
    fingerprint: cardFingerprint(synthesized),
  };
}

function eventEvidenceFingerprint(
  rawEventCount: number,
  relevantCardEvents: readonly IndexedRelevantCardEvent[],
): string {
  return sha256({ rawEventCount, relevantCardEvents });
}

function issue(context: z.RefinementCtx, path: PropertyKey[], message: string): void {
  context.addIssue({ code: 'custom', path, message });
}

function numberArraysEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function successfulResolutionLedgerIndexes(
  events: readonly IndexedRelevantCardEvent[],
  oid: string,
  kind: CardKind,
): number[] {
  if (kind === 'land') return [];
  const matching = events.filter((event) => event.oid === oid);
  const began = matching.filter((event) => event.type === 'resolutionBegan');
  return began.flatMap((begin, attemptIndex) => {
    const nextBegin = began[attemptIndex + 1]?.index ?? Number.POSITIVE_INFINITY;
    const attempt = matching.filter((event) => event.index > begin.index && event.index < nextBegin);
    if (attempt.some((event) => event.type === 'spellFizzled')) return [];
    if (kind === 'instant' || kind === 'sorcery') return [begin.index];
    const changed = attempt.some(
      (event) => event.type === 'zoneChanged' && event.from === 'stack' && event.to === 'battlefield',
    );
    const entered = attempt.some((event) => event.type === 'permanentEntered');
    return changed && entered ? [begin.index] : [];
  });
}

function expectedInstanceMap(decks: readonly [DeckEvidence, DeckEvidence]): ReadonlyMap<
  string,
  {
    readonly cardId: string;
    readonly cardKind: CardKind;
    readonly poolIndex: number;
    readonly sealedSeat: 0 | 1;
    readonly gameSeat: 0 | 1;
    readonly oid: string;
  }
> {
  const expected = new Map<
    string,
    { cardId: string; cardKind: CardKind; poolIndex: number; sealedSeat: 0 | 1; gameSeat: 0 | 1; oid: string }
  >();
  let offset = 0;
  for (const seatId of [0, 1] as const) {
    const deck = decks[seatId];
    for (const card of deck.cards) {
      expected.set(card.instanceId, {
        cardId: card.cardId,
        cardKind: card.cardKind,
        poolIndex: deck.poolIndex,
        sealedSeat: deck.sealedSeat,
        gameSeat: seatId,
        oid: objectId(offset + card.deckPosition),
      });
    }
    offset += deck.cards.length;
  }
  return expected;
}

function validateSetAndCollation(artifact: SealedCalibrationArtifact, context: z.RefinementCtx): void {
  const identities = artifact.set.cardIdentities;
  const expectedIdentities = setCardIdentities(artifact.set.sourceCards);
  const byId = new Map(identities.map((identity) => [identity.cardId, identity]));
  if (
    artifact.set.cards !== identities.length ||
    artifact.set.cards !== artifact.set.sourceCards.length ||
    artifact.set.cards !== artifact.cards.length ||
    byId.size !== identities.length
  ) {
    issue(context, ['set', 'cards'], 'set count, unique identities, and card evidence must agree');
  }
  if (setFingerprint(identities) !== artifact.set.fingerprint) {
    issue(context, ['set', 'fingerprint'], 'set fingerprint disagrees with retained identities');
  }
  if (canonicalJson(expectedIdentities) !== canonicalJson(identities)) {
    issue(context, ['set', 'cardIdentities'], 'set identities disagree with retained executable cards');
  }
  if (identities.some((identity) => identity.printing.code !== artifact.set.code)) {
    issue(context, ['set', 'cardIdentities'], 'set identities mix printing codes');
  }
  if (
    identities.some(
      (identity, index) => index > 0 && identity.cardId <= (identities[index - 1]?.cardId ?? ''),
    )
  ) {
    issue(context, ['set', 'cardIdentities'], 'set identities must be uniquely sorted by card id');
  }
  const expectedCollation = collationFingerprint(artifact.collation.sourceVersion, artifact.collation.recipe);
  if (artifact.collation.fingerprint !== expectedCollation) {
    issue(context, ['collation', 'fingerprint'], 'collation fingerprint disagrees with its recipe');
  }
}

function validatePoolsAndDecks(artifact: SealedCalibrationArtifact, context: z.RefinementCtx): void {
  const expectedPools = artifact.campaign.poolPairs * 2;
  if (artifact.pools.length !== expectedPools || artifact.decks.length !== expectedPools) {
    issue(context, ['pools'], 'campaign is truncated: every pool pair needs two pools and two decks');
  }
  const identityById = new Map(artifact.set.cardIdentities.map((identity) => [identity.cardId, identity]));
  const poolByKey = new Map<string, PoolEvidence>();
  const openedByInstance = new Map<string, z.infer<typeof OpenedCardEvidenceSchema>>();
  const packSize = artifact.collation.recipe.reduce((sum, slot) => sum + slot.count, 0);
  for (const [poolOffset, pool] of artifact.pools.entries()) {
    const key = `${String(pool.poolIndex)}/${String(pool.sealedSeat)}`;
    if (poolByKey.has(key)) issue(context, ['pools', poolOffset], 'pool identity is duplicated');
    poolByKey.set(key, pool);
    if (poolOffset !== pool.poolIndex * 2 + pool.sealedSeat) {
      issue(context, ['pools', poolOffset], 'pools must retain canonical pool/seat order');
    }
    if (
      pool.seed !== poolSeed(artifact.seed, pool.poolIndex, pool.sealedSeat) ||
      pool.collationFingerprint !== artifact.collation.fingerprint
    ) {
      issue(context, ['pools', poolOffset], 'pool seed or collation disagrees with the campaign');
    }
    if (pool.openedCards !== SEALED_BOOSTERS_PER_POOL * packSize) {
      issue(
        context,
        ['pools', poolOffset, 'openedCards'],
        'pool size disagrees with six packs and the recipe',
      );
    }
    for (const [boosterOffset, booster] of pool.boosters.entries()) {
      if (booster.index !== boosterOffset || booster.cards.length !== packSize) {
        issue(context, ['pools', poolOffset, 'boosters', boosterOffset], 'booster order or size is corrupt');
      }
      if (new Set(booster.cards.map((card) => card.cardId)).size !== booster.cards.length) {
        issue(context, ['pools', poolOffset, 'boosters', boosterOffset], 'one booster repeats a card');
      }
      for (const slot of artifact.collation.recipe) {
        // Every rarity the slot's sheet can supply, not just its primary one. A
        // rare/mythic slot deals one card off a shared sheet, so counting only
        // the printed word "rare" calls every pack that rolled the mythic
        // corrupt.
        const supplied = slotRarities(slot);
        if (booster.cards.filter((card) => supplied.has(card.rarity)).length !== slot.count) {
          issue(
            context,
            ['pools', poolOffset, 'boosters', boosterOffset],
            'booster rarity counts disagree with collation',
          );
        }
      }
      for (const [cardOffset, card] of booster.cards.entries()) {
        const identity = identityById.get(card.cardId);
        if (
          card.instanceId !== openedInstanceId(pool.poolIndex, pool.sealedSeat, boosterOffset, cardOffset) ||
          card.packPosition !== cardOffset ||
          identity === undefined ||
          identity.cardName !== card.cardName ||
          identity.cardKind !== card.cardKind ||
          identity.basicLandType !== card.basicLandType ||
          canonicalJson(identity.producesMana) !== canonicalJson(card.producesMana) ||
          identity.rarity !== card.rarity ||
          identity.fingerprint !== card.fingerprint ||
          identity.printing.code !== card.printing.code ||
          identity.printing.collectorNumber !== card.printing.collectorNumber
        ) {
          issue(
            context,
            ['pools', poolOffset, 'boosters', boosterOffset, 'cards', cardOffset],
            'opened card identity disagrees with its set or position',
          );
        }
        if (openedByInstance.has(card.instanceId)) {
          issue(
            context,
            ['pools', poolOffset, 'boosters', boosterOffset, 'cards', cardOffset],
            'opened instance id is duplicated',
          );
        }
        openedByInstance.set(card.instanceId, card);
      }
    }
    if (pool.fingerprint !== poolFingerprint(pool)) {
      issue(context, ['pools', poolOffset, 'fingerprint'], 'pool fingerprint disagrees with its packs');
    }
  }
  for (let poolIndex = 0; poolIndex < artifact.campaign.poolPairs; poolIndex += 1) {
    for (const seatId of [0, 1] as const) {
      if (!poolByKey.has(`${String(poolIndex)}/${String(seatId)}`)) {
        issue(context, ['pools'], `campaign is missing pool ${String(poolIndex)} seat ${String(seatId)}`);
      }
    }
  }

  const deckByKey = new Map<string, DeckEvidence>();
  const usedOpened = new Set<string>();
  const deckInstances = new Set<string>();
  for (const [deckOffset, deck] of artifact.decks.entries()) {
    const key = `${String(deck.poolIndex)}/${String(deck.sealedSeat)}`;
    if (deckByKey.has(key)) issue(context, ['decks', deckOffset], 'deck identity is duplicated');
    deckByKey.set(key, deck);
    if (deckOffset !== deck.poolIndex * 2 + deck.sealedSeat) {
      issue(context, ['decks', deckOffset], 'decks must retain canonical pool/seat order');
    }
    const pool = poolByKey.get(key);
    if (
      pool === undefined ||
      deck.poolSeed !== pool.seed ||
      deck.poolCards !== pool.openedCards ||
      deck.name !== deckName(deck.poolIndex, deck.sealedSeat)
    ) {
      issue(context, ['decks', deckOffset], 'deck provenance disagrees with its pool');
    }
    if (deck.shapeComplete !== (deck.shortfalls.length === 0)) {
      issue(context, ['decks', deckOffset, 'shapeComplete'], 'deck shape status disagrees with shortfalls');
    }
    for (const [shortfallOffset, shortfall] of deck.shortfalls.entries()) {
      if (
        shortfall.achieved >= shortfall.target ||
        shortfall.target - shortfall.achieved !== shortfall.missing
      ) {
        issue(
          context,
          ['decks', deckOffset, 'shortfalls', shortfallOffset],
          'shortfall arithmetic is corrupt',
        );
      }
    }
    if (deck.manaConsistent !== deck.manaReports.every((report) => report.meetsCastabilityTarget)) {
      issue(context, ['decks', deckOffset, 'manaConsistent'], 'mana status disagrees with retained reports');
    }
    const reportColors = new Set(deck.manaReports.map((report) => report.color));
    if (reportColors.size !== deck.manaReports.length) {
      issue(context, ['decks', deckOffset, 'manaReports'], 'mana reports repeat a color');
    }
    if (deck.colorPair[0] === deck.colorPair[1]) {
      issue(context, ['decks', deckOffset, 'colorPair'], 'deck color pair must name two colors');
    }
    if (deck.cards.filter((card) => card.cardKind === 'land').length !== deck.lands) {
      issue(context, ['decks', deckOffset, 'lands'], 'deck land count disagrees with physical cards');
    }
    for (const [cardOffset, card] of deck.cards.entries()) {
      if (card.deckPosition !== cardOffset || deckInstances.has(card.instanceId)) {
        issue(
          context,
          ['decks', deckOffset, 'cards', cardOffset],
          'deck position or instance id is duplicated',
        );
      }
      deckInstances.add(card.instanceId);
      if (card.source === 'opened') {
        const opened =
          card.openedInstanceId === null ? undefined : openedByInstance.get(card.openedInstanceId);
        if (
          opened === undefined ||
          usedOpened.has(opened.instanceId) ||
          opened.cardId !== card.cardId ||
          opened.cardName !== card.cardName ||
          opened.cardKind !== card.cardKind ||
          opened.basicLandType !== card.basicLandType ||
          canonicalJson(opened.producesMana) !== canonicalJson(card.producesMana) ||
          opened.rarity !== card.rarity ||
          opened.printing.code !== card.printing.code ||
          opened.printing.collectorNumber !== card.printing.collectorNumber ||
          opened.fingerprint !== card.fingerprint ||
          !opened.instanceId.startsWith(
            `sealed/pool/${String(deck.poolIndex)}/seat/${String(deck.sealedSeat)}/`,
          )
        ) {
          issue(
            context,
            ['decks', deckOffset, 'cards', cardOffset],
            'opened deck card is absent, reused, or from another pool',
          );
        }
        if (opened !== undefined) usedOpened.add(opened.instanceId);
        if (card.instanceId !== card.openedInstanceId) {
          issue(
            context,
            ['decks', deckOffset, 'cards', cardOffset, 'instanceId'],
            'opened deck instance must retain its pool identity',
          );
        }
      } else {
        const supplied =
          pool === undefined || card.basicLandType === null
            ? undefined
            : canonicalBasicSupply(pool, artifact.set.code, card.basicLandType);
        if (
          card.openedInstanceId !== null ||
          card.cardKind !== 'land' ||
          card.basicLandType === null ||
          supplied === undefined ||
          supplied.cardId !== card.cardId ||
          supplied.cardName !== card.cardName ||
          supplied.cardKind !== card.cardKind ||
          supplied.basicLandType !== card.basicLandType ||
          canonicalJson(supplied.producesMana) !== canonicalJson(card.producesMana) ||
          supplied.rarity !== card.rarity ||
          supplied.printing.code !== card.printing.code ||
          supplied.printing.collectorNumber !== card.printing.collectorNumber ||
          supplied.fingerprint !== card.fingerprint ||
          card.instanceId !==
            `sealed/pool/${String(deck.poolIndex)}/seat/${String(deck.sealedSeat)}/basic/${String(cardOffset)}`
        ) {
          issue(
            context,
            ['decks', deckOffset, 'cards', cardOffset],
            'basic-land supply provenance is corrupt',
          );
        }
      }
      if ((card.cardKind === 'land') !== card.producesMana.length > 0) {
        issue(
          context,
          ['decks', deckOffset, 'cards', cardOffset],
          'deck mana source disagrees with card kind',
        );
      }
    }
    const landSources = new Map(COLORS.map((colorValue) => [colorValue, 0]));
    for (const land of deck.cards.filter((card) => card.cardKind === 'land')) {
      for (const landColor of land.producesMana) {
        if (landColor === 'C') continue;
        landSources.set(landColor, (landSources.get(landColor) ?? 0) + 1);
      }
    }
    for (const colorValue of COLORS) {
      const retainedSources = deck.manaReports.find((report) => report.color === colorValue)?.sources ?? 0;
      if (retainedSources !== landSources.get(colorValue)) {
        issue(
          context,
          ['decks', deckOffset, 'manaReports'],
          'mana report sources disagree with the physical land multiset',
        );
      }
    }
    for (const [shortfallOffset, shortfall] of deck.shortfalls.entries()) {
      if (shortfall.kind !== 'colorSources') continue;
      const retainedSources = deck.manaReports.find((report) => report.color === shortfall.color)?.sources;
      if (retainedSources === undefined || retainedSources !== shortfall.achieved) {
        issue(
          context,
          ['decks', deckOffset, 'shortfalls', shortfallOffset],
          'color-source shortfall disagrees with retained mana sources',
        );
      }
    }
    if (deck.fingerprint !== deckFingerprint(deck.cards)) {
      issue(context, ['decks', deckOffset, 'fingerprint'], 'deck fingerprint disagrees with physical cards');
    }
  }
  for (let poolIndex = 0; poolIndex < artifact.campaign.poolPairs; poolIndex += 1) {
    for (const seatId of [0, 1] as const) {
      try {
        const seedValue = poolSeed(artifact.seed, poolIndex, seatId);
        const opened = openSealedPool(artifact.set.sourceCards, {
          seed: seedValue,
          boosters: SEALED_BOOSTERS_PER_POOL,
          recipe: artifact.collation.recipe,
        });
        const expectedPool = openedEvidence(
          poolIndex,
          seatId,
          seedValue,
          artifact.collation.fingerprint,
          opened.boosters,
        );
        const actualPool = poolByKey.get(`${String(poolIndex)}/${String(seatId)}`);
        if (actualPool === undefined || canonicalJson(expectedPool) !== canonicalJson(actualPool)) {
          issue(
            context,
            ['pools', poolIndex * 2 + seatId],
            'retained pool disagrees with the executable set, seed, and collation',
          );
        }
        const expectedDeck = buildSealedDeck(expectedPool, opened.cards, buildDeck(opened.cards)).evidence;
        const actualDeck = deckByKey.get(`${String(poolIndex)}/${String(seatId)}`);
        if (actualDeck === undefined || canonicalJson(expectedDeck) !== canonicalJson(actualDeck)) {
          issue(
            context,
            ['decks', poolIndex * 2 + seatId],
            'retained deck disagrees with the deterministic build of its exact pool',
          );
        }
      } catch (error: unknown) {
        issue(
          context,
          ['decks', poolIndex * 2 + seatId],
          `pool or deck cannot be rebuilt: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

function validateGames(artifact: SealedCalibrationArtifact, context: z.RefinementCtx): void {
  const expectedGameCount = artifact.campaign.poolPairs * 2 * artifact.campaign.gamesPerSeatOrder;
  if (artifact.games.length !== expectedGameCount) {
    issue(context, ['games'], 'game schedule is truncated');
  }
  const deckByKey = new Map(
    artifact.decks.map((deck) => [`${String(deck.poolIndex)}/${String(deck.sealedSeat)}`, deck]),
  );
  const scheduleKeys = new Set<string>();
  const gameSeeds = new Set<string>();
  for (const [gameOffset, game] of artifact.games.entries()) {
    const scheduleKey = `${String(game.poolIndex)}/${String(game.seatOrder)}/${String(game.gameIndex)}`;
    if (scheduleKeys.has(scheduleKey) || gameSeeds.has(game.seed)) {
      issue(context, ['games', gameOffset], 'game schedule or seed is duplicated');
    }
    scheduleKeys.add(scheduleKey);
    gameSeeds.add(game.seed);
    const expectedOffset =
      (game.poolIndex * 2 + game.seatOrder) * artifact.campaign.gamesPerSeatOrder + game.gameIndex;
    if (gameOffset !== expectedOffset) {
      issue(context, ['games', gameOffset], 'games must retain canonical schedule order');
    }
    const expectedSeats: readonly [0 | 1, 0 | 1] = game.seatOrder === 0 ? [0, 1] : [1, 0];
    const expectedRunSeed = runSeed(artifact.seed, game.poolIndex, game.seatOrder);
    const expectedSeed = `${expectedRunSeed}/game/${String(game.gameIndex)}`;
    const first = deckByKey.get(`${String(game.poolIndex)}/${String(expectedSeats[0])}`);
    const second = deckByKey.get(`${String(game.poolIndex)}/${String(expectedSeats[1])}`);
    if (
      game.seed !== expectedSeed ||
      game.sealedSeats[0] !== expectedSeats[0] ||
      game.sealedSeats[1] !== expectedSeats[1] ||
      game.startingPlayer !== game.gameIndex % 2
    ) {
      issue(context, ['games', gameOffset], 'game seed, seat order, or alternating start is corrupt');
    }
    if (
      first === undefined ||
      second === undefined ||
      game.replay.extras.sim_run_seed !== expectedRunSeed ||
      game.replay.extras.sim_game_seed !== game.seed ||
      game.replay.extras.sim_game_index !== game.gameIndex ||
      game.replay.extras.sim_user_deck !== first.name ||
      game.replay.extras.sim_oppo_deck !== second.name ||
      game.replay.extras.sim_user_bot !== `${first.name}-bot` ||
      game.replay.extras.sim_oppo_bot !== `${second.name}-bot` ||
      game.replay.metadata.expansion !== artifact.set.code ||
      game.replay.metadata.event_type !== 'SealedBotCalibration' ||
      game.replay.metadata.draft_id !== game.seed
    ) {
      issue(context, ['games', gameOffset, 'replay'], 'replay metadata disagrees with the Sealed schedule');
    }
    const expectedStartingPlayer = game.replay.metadata.on_play === 1 ? 0 : 1;
    const expectedWinner =
      game.replay.extras.sim_winner === null ? null : game.sealedSeats[game.replay.extras.sim_winner];
    if (
      game.startingPlayer !== expectedStartingPlayer ||
      game.winnerSealedSeat !== expectedWinner ||
      game.reason !== game.replay.extras.sim_end_reason ||
      game.turns !== game.replay.metadata.num_turns ||
      game.decisions !== game.replay.extras.sim_decisions ||
      game.replay.metadata.won !== (game.replay.extras.sim_winner === 0 ? 1 : 0) ||
      game.trajectoryFingerprint !== gameFingerprint(game.replay)
    ) {
      issue(context, ['games', gameOffset], 'game headline or trajectory disagrees with replay');
    }
    if (first === undefined || second === undefined) continue;
    const expectedInstances = expectedInstanceMap([first, second]);
    const expectedOids = new Set([...expectedInstances.values()].map((entry) => entry.oid));
    if (
      eventEvidenceFingerprint(game.rawEventCount, game.relevantCardEvents) !==
      game.relevantCardEventsFingerprint
    ) {
      issue(
        context,
        ['games', gameOffset, 'relevantCardEventsFingerprint'],
        'event ledger fingerprint is corrupt',
      );
    }
    let priorIndex = -1;
    for (const [ledgerOffset, event] of game.relevantCardEvents.entries()) {
      if (event.index <= priorIndex || event.index >= game.rawEventCount || !expectedOids.has(event.oid)) {
        issue(
          context,
          ['games', gameOffset, 'relevantCardEvents', ledgerOffset],
          'event ledger index or object is corrupt',
        );
      }
      priorIndex = event.index;
    }
    const observed = new Set<string>();
    for (const [cardOffset, event] of game.cardEvents.entries()) {
      const expected = expectedInstances.get(event.instanceId);
      if (
        expected === undefined ||
        event.cardId !== expected.cardId ||
        event.poolIndex !== expected.poolIndex ||
        event.sealedSeat !== expected.sealedSeat ||
        event.gameSeat !== expected.gameSeat ||
        observed.has(event.instanceId)
      ) {
        issue(
          context,
          ['games', gameOffset, 'cardEvents', cardOffset],
          'card event identity is unknown or duplicated',
        );
      }
      observed.add(event.instanceId);
      if (expected === undefined) continue;
      const draws = game.relevantCardEvents
        .filter((candidate) => candidate.type === 'cardDrawn' && candidate.oid === expected.oid)
        .map((candidate) => candidate.index);
      const casts = game.relevantCardEvents
        .filter((candidate) => candidate.type === 'spellCast' && candidate.oid === expected.oid)
        .map((candidate) => candidate.index);
      const resolutions = successfulResolutionLedgerIndexes(
        game.relevantCardEvents,
        expected.oid,
        expected.cardKind,
      );
      if (
        event.drawn !== draws.length > 0 ||
        event.cast !== casts.length > 0 ||
        event.resolved !== resolutions.length > 0 ||
        !numberArraysEqual(event.drawEventIndexes, draws) ||
        !numberArraysEqual(event.castEventIndexes, casts) ||
        !numberArraysEqual(event.successfulResolutionEventIndexes, resolutions)
      ) {
        issue(
          context,
          ['games', gameOffset, 'cardEvents', cardOffset],
          'card event flags disagree with retained ledger',
        );
      }
    }
    if (observed.size !== expectedInstances.size) {
      issue(context, ['games', gameOffset, 'cardEvents'], 'game is missing a physical deck instance');
    }
  }
  for (let poolIndex = 0; poolIndex < artifact.campaign.poolPairs; poolIndex += 1) {
    for (const seatOrder of [0, 1] as const) {
      for (let gameIndex = 0; gameIndex < artifact.campaign.gamesPerSeatOrder; gameIndex += 1) {
        if (!scheduleKeys.has(`${String(poolIndex)}/${String(seatOrder)}/${String(gameIndex)}`)) {
          issue(context, ['games'], 'game schedule has a missing cell');
        }
      }
    }
  }
}

function validateArtifact(artifact: SealedCalibrationArtifact, context: z.RefinementCtx): void {
  validateSetAndCollation(artifact, context);
  validatePoolsAndDecks(artifact, context);
  validateGames(artifact, context);
  try {
    const expectedSummary = deriveSummary(artifact.decks, artifact.games, artifact.campaign.gameFloor);
    if (canonicalJson(expectedSummary) !== canonicalJson(artifact.summary)) {
      issue(context, ['summary'], 'summary disagrees with retained decks or games');
    }
    const expectedCards = deriveCardEvidence(
      artifact.set.cardIdentities.map(({ cardId, cardName }) => ({ cardId, cardName })),
      artifact.pools,
      artifact.decks,
      artifact.games,
      artifact.campaign.cardFloor,
    );
    if (canonicalJson(expectedCards) !== canonicalJson(artifact.cards)) {
      issue(context, ['cards'], 'card evidence disagrees with pools, decks, or games');
    }
  } catch (error: unknown) {
    issue(
      context,
      ['summary'],
      `retained evidence cannot be recomputed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function readSealedCalibrationArtifact(
  value: unknown,
  source = 'Sealed calibration artifact',
): SealedCalibrationArtifact {
  const parsed = SealedCalibrationArtifactSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${source}: invalid Sealed calibration artifact: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export interface SealedCalibrationOptions {
  readonly seed: string;
  readonly collation: SealedCollationInput;
  readonly workers?: number | undefined;
  readonly poolPairs?: number | undefined;
  readonly gamesPerSeatOrder?: number | undefined;
  readonly cardFloor?: number | undefined;
  readonly gameFloor?: number | undefined;
}

function positiveOption(name: string, value: number, maximum: number, minimum = 1): number {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer of at least ${String(minimum)}, got ${String(value)}`);
  }
  if (value > maximum) throw new Error(`${name} must be at most ${String(maximum)}, got ${String(value)}`);
  return value;
}

function assertInput(cards: readonly Card[], options: SealedCalibrationOptions): void {
  if (cards.length === 0) throw new Error('Sealed calibration needs a nonempty executable set');
  if (cards.length > MAX_SEALED_SET_SIZE) {
    throw new Error(`Sealed calibration set must contain at most ${String(MAX_SEALED_SET_SIZE)} cards`);
  }
  if (options.seed.trim().length === 0) throw new Error('Sealed calibration needs a nonempty seed');
  if (options.seed.length > MAX_SEALED_SEED_LENGTH) {
    throw new Error(
      `Sealed calibration seed must contain at most ${String(MAX_SEALED_SEED_LENGTH)} characters`,
    );
  }
  if (new Set(cards.map((card) => card.id)).size !== cards.length) {
    throw new Error('Sealed calibration set cards cannot share an id');
  }
  if (new Set(cards.map((card) => card.set.code)).size !== 1) {
    throw new Error('Sealed calibration set cards must share one set code');
  }
  const parsed = DraftCollationSchema.safeParse(options.collation);
  if (!parsed.success) {
    throw new Error(`invalid Sealed collation input: ${z.prettifyError(parsed.error)}`);
  }
  const counts = new Map<Rarity, number>();
  for (const card of cards) counts.set(card.rarity, (counts.get(card.rarity) ?? 0) + 1);
  for (const slot of options.collation.recipe) {
    const supplied = [...slotRarities(slot)];
    const available = supplied.reduce((sum, cardRarity) => sum + (counts.get(cardRarity) ?? 0), 0);
    if (available < slot.count) {
      throw new Error(
        `Sealed collation needs ${String(slot.count)} ${supplied.join('/')} cards per pack but set has ${String(available)}`,
      );
    }
  }
  const collatedRarities = new Set(options.collation.recipe.flatMap((slot) => [...slotRarities(slot)]));
  const uncollated = [...new Set(cards.map((card) => card.rarity))].filter(
    (cardRarity) => !collatedRarities.has(cardRarity),
  );
  if (uncollated.length > 0) {
    throw new Error(`Sealed collation is not total over set rarities: ${uncollated.join(', ')}`);
  }
}

function openedEvidence(
  poolIndex: number,
  seatId: 0 | 1,
  seedValue: string,
  collationDigest: string,
  boosters: readonly (readonly Card[])[],
): PoolEvidence {
  const evidence: PoolEvidence = {
    poolIndex,
    sealedSeat: seatId,
    seed: seedValue,
    collationFingerprint: collationDigest,
    fingerprint: '0'.repeat(64),
    openedCards: boosters.reduce((sum, booster) => sum + booster.length, 0),
    boosters: boosters.map((booster, pack) => ({
      index: pack,
      cards: booster.map((card, position) => ({
        instanceId: openedInstanceId(poolIndex, seatId, pack, position),
        cardId: card.id,
        cardName: card.name,
        cardKind: card.kind,
        basicLandType: card.kind === 'land' ? (card.basicLandType ?? null) : null,
        producesMana: card.kind === 'land' ? [...card.producesMana] : [],
        rarity: card.rarity,
        packPosition: position,
        printing: { ...card.set },
        fingerprint: cardFingerprint(card),
      })),
    })),
  };
  return { ...evidence, fingerprint: poolFingerprint(evidence) };
}

interface BuiltSealedDeck {
  readonly cards: readonly Card[];
  readonly evidence: DeckEvidence;
}

function buildSealedDeck(
  pool: PoolEvidence,
  cards: readonly Card[],
  built: DeckBuildResult,
): BuiltSealedDeck {
  if (built.deck.length !== 40 || built.spells.length !== 23 || built.lands.length !== 17) {
    throw new Error(
      `Sealed pool ${String(pool.poolIndex)} seat ${String(pool.sealedSeat)} did not build a legal 40-card deck`,
    );
  }
  const opened = pool.boosters.flatMap((booster) => booster.cards);
  const usedPoolIndices = new Set<number>();
  const evidence: z.infer<typeof DeckCardEvidenceSchema>[] = [];
  for (const [position, pick] of built.picks.entries()) {
    const physical = opened[pick.poolIndex];
    if (physical === undefined || usedPoolIndices.has(pick.poolIndex)) {
      throw new Error('Sealed deck lost or reused an opened spell');
    }
    usedPoolIndices.add(pick.poolIndex);
    evidence.push({
      instanceId: physical.instanceId,
      cardId: pick.card.id,
      cardName: pick.card.name,
      cardKind: pick.card.kind,
      basicLandType: pick.card.kind === 'land' ? (pick.card.basicLandType ?? null) : null,
      producesMana: pick.card.kind === 'land' ? [...pick.card.producesMana] : [],
      rarity: pick.card.rarity,
      printing: { ...pick.card.set },
      fingerprint: cardFingerprint(pick.card),
      deckPosition: position,
      source: 'opened',
      openedInstanceId: physical.instanceId,
    });
  }
  for (const [landOffset, land] of built.lands.entries()) {
    if (land.kind !== 'land') throw new Error('Sealed deck mana base returned a nonland');
    const poolIndex = cards.findIndex(
      (candidate, index) =>
        !usedPoolIndices.has(index) && candidate.kind === 'land' && candidate.id === land.id,
    );
    const position = built.spells.length + landOffset;
    if (poolIndex >= 0) {
      usedPoolIndices.add(poolIndex);
      const physical = opened[poolIndex];
      if (physical === undefined) throw new Error('Sealed deck lost an opened land');
      evidence.push({
        instanceId: physical.instanceId,
        cardId: land.id,
        cardName: land.name,
        cardKind: land.kind,
        basicLandType: land.basicLandType ?? null,
        producesMana: [...land.producesMana],
        rarity: land.rarity,
        printing: { ...land.set },
        fingerprint: cardFingerprint(land),
        deckPosition: position,
        source: 'opened',
        openedInstanceId: physical.instanceId,
      });
    } else {
      if (land.basicLandType === undefined) {
        throw new Error('Sealed deck cannot synthesize a nonbasic land that was not opened');
      }
      evidence.push({
        instanceId: `sealed/pool/${String(pool.poolIndex)}/seat/${String(pool.sealedSeat)}/basic/${String(position)}`,
        cardId: land.id,
        cardName: land.name,
        cardKind: land.kind,
        basicLandType: land.basicLandType,
        producesMana: [...land.producesMana],
        rarity: land.rarity,
        printing: { ...land.set },
        fingerprint: cardFingerprint(land),
        deckPosition: position,
        source: 'basicLandSupply',
        openedInstanceId: null,
      });
    }
  }
  const manaReports = built.manaBase.reports.map((report) => ({
    color: report.color,
    pipCount: report.pipCount,
    sources: report.sources,
    earliestCastability: report.earliestCastability,
    heaviestCastability: report.heaviestCastability,
    meetsCastabilityTarget: report.meetsCastabilityTarget,
  }));
  const result: DeckEvidence = {
    poolIndex: pool.poolIndex,
    sealedSeat: pool.sealedSeat,
    poolSeed: pool.seed,
    name: deckName(pool.poolIndex, pool.sealedSeat),
    fingerprint: deckFingerprint(evidence),
    poolCards: pool.openedCards,
    spells: 23,
    lands: 17,
    legal40: true,
    shapeComplete: built.complete,
    manaConsistent: manaReports.every((report) => report.meetsCastabilityTarget),
    colorPair: [...built.colorPair] as [ColorPair[0], ColorPair[1]],
    creatureCount: built.creatureCount,
    removalCount: built.removalCount,
    shortfalls: built.shortfalls.map((shortfall) => ({ ...shortfall })) as Shortfall[],
    manaReports,
    cards: evidence,
  };
  return { cards: built.deck, evidence: result };
}

interface ScheduledRun {
  readonly poolIndex: number;
  readonly seatOrder: 0 | 1;
  readonly sealedSeats: readonly [0 | 1, 0 | 1];
  readonly decks: readonly [BuiltSealedDeck, BuiltSealedDeck];
  readonly spec: MatchSpec;
}

function schedule(
  seed: string,
  code: string,
  decks: readonly BuiltSealedDeck[],
  poolPairs: number,
  gamesPerSeatOrder: number,
): readonly ScheduledRun[] {
  const byKey = new Map(
    decks.map((deck) => [`${String(deck.evidence.poolIndex)}/${String(deck.evidence.sealedSeat)}`, deck]),
  );
  return Array.from({ length: poolPairs }, (_unused, poolIndex) => poolIndex).flatMap((poolIndex) =>
    ([0, 1] as const).map((seatOrder): ScheduledRun => {
      const sealedSeats: readonly [0 | 1, 0 | 1] = seatOrder === 0 ? [0, 1] : [1, 0];
      const first = byKey.get(`${String(poolIndex)}/${String(sealedSeats[0])}`);
      const second = byKey.get(`${String(poolIndex)}/${String(sealedSeats[1])}`);
      if (first === undefined || second === undefined) throw new Error('Sealed schedule lost a deck');
      const seedValue = runSeed(seed, poolIndex, seatOrder);
      return {
        poolIndex,
        seatOrder,
        sealedSeats,
        decks: [first, second],
        spec: {
          runSeed: seedValue,
          games: gamesPerSeatOrder,
          decks: [
            { name: first.evidence.name, cards: first.cards },
            { name: second.evidence.name, cards: second.cards },
          ],
          bots: [greedySpec(`${first.evidence.name}-bot`), greedySpec(`${second.evidence.name}-bot`)],
          alternatePlayFirst: true,
          collectLogs: true,
          collectEvents: true,
          expansion: code,
          eventType: 'SealedBotCalibration',
          gameTime: '',
        },
      };
    }),
  );
}

function indexedRelevantCardEvent(event: GameEvent, index: number): IndexedRelevantCardEvent | null {
  switch (event.type) {
    case 'cardDrawn':
    case 'spellCast':
    case 'resolutionBegan':
    case 'spellFizzled':
    case 'permanentEntered':
      return { index, type: event.type, oid: event.oid };
    case 'zoneChanged':
      return { index, type: event.type, oid: event.oid, from: event.from, to: event.to };
    default:
      return null;
  }
}

function relevantCardEventLedger(
  events: readonly GameEvent[],
  decks: readonly [BuiltSealedDeck, BuiltSealedDeck],
): IndexedRelevantCardEvent[] {
  const oids = new Set<string>();
  let offset = 0;
  for (const deck of decks) {
    for (const card of deck.evidence.cards) oids.add(objectId(offset + card.deckPosition));
    offset += deck.cards.length;
  }
  return events.flatMap((event, index) => {
    const relevant = indexedRelevantCardEvent(event, index);
    return relevant !== null && oids.has(relevant.oid) ? [relevant] : [];
  });
}

function physicalEvidence(
  events: readonly IndexedRelevantCardEvent[],
  decks: readonly [BuiltSealedDeck, BuiltSealedDeck],
): z.infer<typeof CardInstanceGameEvidenceSchema>[] {
  const records: z.infer<typeof CardInstanceGameEvidenceSchema>[] = [];
  let offset = 0;
  for (const seatId of [0, 1] as const) {
    const deck = decks[seatId];
    for (const card of deck.evidence.cards) {
      const oid = objectId(offset + card.deckPosition);
      const draws = events
        .filter((event) => event.type === 'cardDrawn' && event.oid === oid)
        .map((event) => event.index);
      const casts = events
        .filter((event) => event.type === 'spellCast' && event.oid === oid)
        .map((event) => event.index);
      const resolutions = successfulResolutionLedgerIndexes(events, oid, card.cardKind);
      records.push({
        instanceId: card.instanceId,
        cardId: card.cardId,
        poolIndex: deck.evidence.poolIndex,
        sealedSeat: deck.evidence.sealedSeat,
        gameSeat: seatId,
        drawn: draws.length > 0,
        cast: casts.length > 0,
        resolved: resolutions.length > 0,
        drawEventIndexes: draws,
        castEventIndexes: casts,
        successfulResolutionEventIndexes: resolutions,
      });
    }
    offset += deck.cards.length;
  }
  return records;
}

function gameEvidence(scheduled: ScheduledRun, run: MatchRun): readonly SealedCalibrationGame[] {
  return run.outcomes.map((outcome, gameIndex) => {
    const replay = outcome.log;
    const events = outcome.events;
    if (replay === null || events === null) {
      throw new Error(`Sealed calibration game ${outcome.seed} omitted replay or event evidence`);
    }
    if (run.logs[gameIndex] !== replay) throw new Error('Sealed replay ordering drifted');
    if (events.length > MAX_SEALED_RAW_EVENTS_PER_GAME) {
      throw new Error(`Sealed game ${outcome.seed} exceeded the raw-event bound`);
    }
    const relevantCardEvents = relevantCardEventLedger(events, scheduled.decks);
    if (relevantCardEvents.length > MAX_SEALED_RELEVANT_EVENTS_PER_GAME) {
      throw new Error(`Sealed game ${outcome.seed} exceeded the relevant-event bound`);
    }
    return {
      seed: outcome.seed,
      poolIndex: scheduled.poolIndex,
      seatOrder: scheduled.seatOrder,
      gameIndex,
      sealedSeats: [...scheduled.sealedSeats],
      startingPlayer: outcome.startingPlayer,
      winnerSealedSeat: outcome.winner === null ? null : scheduled.sealedSeats[outcome.winner],
      reason: outcome.reason,
      turns: outcome.turns,
      decisions: outcome.decisions,
      trajectoryFingerprint: gameFingerprint(replay),
      replay,
      rawEventCount: events.length,
      relevantCardEventsFingerprint: eventEvidenceFingerprint(events.length, relevantCardEvents),
      relevantCardEvents,
      cardEvents: physicalEvidence(relevantCardEvents, scheduled.decks),
    };
  });
}

interface AssociationSample {
  readonly trajectory: string;
  readonly won: boolean;
  readonly decided: boolean;
  readonly symmetric: boolean;
}

function association(
  samples: readonly AssociationSample[],
  floor: number,
): z.infer<typeof AssociationSchema> {
  const symmetric = new Set(samples.filter((sample) => sample.symmetric).map((sample) => sample.trajectory));
  const outcomes = new Map<string, boolean>();
  for (const sample of samples.filter((candidate) => candidate.decided && !candidate.symmetric)) {
    const prior = outcomes.get(sample.trajectory);
    if (prior !== undefined && prior !== sample.won) {
      throw new Error(`trajectory ${sample.trajectory} has conflicting card outcomes`);
    }
    outcomes.set(sample.trajectory, sample.won);
  }
  const wins = [...outcomes.values()].filter(Boolean).length;
  const underSampled = outcomes.size < floor;
  return {
    state: underSampled ? 'underSampled' : 'estimated',
    claim: 'association-not-causal',
    sampleUnit: 'decidedDistinctTrajectory',
    floor,
    games: samples.length,
    decidedGames: samples.filter((sample) => sample.decided && !sample.symmetric).length,
    distinctGames: outcomes.size,
    distinctWins: wins,
    symmetricGames: symmetric.size,
    winRate: underSampled ? null : wins / outcomes.size,
    interval95: underSampled ? null : wilsonInterval(wins, outcomes.size),
  };
}

interface CardDescriptor {
  readonly cardId: string;
  readonly cardName: string;
}

interface CardObservation {
  readonly cardId: string;
  readonly sealedSeat: 0 | 1;
  drawn: boolean;
  cast: boolean;
  resolved: boolean;
}

function deriveCardEvidence(
  cards: readonly CardDescriptor[],
  pools: readonly PoolEvidence[],
  decks: readonly DeckEvidence[],
  games: readonly SealedCalibrationGame[],
  floor: number,
): z.infer<typeof CardEvidenceSchema>[] {
  const tallies = new Map(
    cards.map((card) => [
      card.cardId,
      {
        card,
        openedCount: 0,
        includedCount: 0,
        gamesIncluded: 0,
        winsIncluded: 0,
        gamesDrawn: 0,
        winsWhenDrawn: 0,
        gamesCast: 0,
        winsWhenCast: 0,
        gamesResolved: 0,
        winsWhenResolved: 0,
        samples: [] as AssociationSample[],
      },
    ]),
  );
  for (const card of pools.flatMap((pool) => pool.boosters.flatMap((booster) => booster.cards))) {
    const tally = tallies.get(card.cardId);
    if (tally === undefined) throw new Error(`opened card ${card.cardId} is absent from source set`);
    tally.openedCount += 1;
  }
  for (const card of decks
    .flatMap((deck) => deck.cards)
    .filter((candidate) => candidate.source === 'opened')) {
    const tally = tallies.get(card.cardId);
    if (tally === undefined) throw new Error(`included card ${card.cardId} is absent from source set`);
    tally.includedCount += 1;
  }
  const cardByInstance = new Map(
    decks.flatMap((deck) => deck.cards.map((card) => [card.instanceId, card] as const)),
  );
  for (const game of games) {
    const observations = new Map<string, CardObservation>();
    for (const event of game.cardEvents) {
      const card = cardByInstance.get(event.instanceId);
      if (card?.source !== 'opened') continue;
      const key = `${String(event.sealedSeat)}\u0000${card.cardId}`;
      const observation = observations.get(key) ?? {
        cardId: card.cardId,
        sealedSeat: event.sealedSeat,
        drawn: false,
        cast: false,
        resolved: false,
      };
      observation.drawn ||= event.drawn;
      observation.cast ||= event.cast;
      observation.resolved ||= event.resolved;
      observations.set(key, observation);
    }
    const byCard = new Map<string, CardObservation[]>();
    for (const observation of observations.values()) {
      const group = byCard.get(observation.cardId) ?? [];
      group.push(observation);
      byCard.set(observation.cardId, group);
    }
    for (const cardObservations of byCard.values()) {
      const symmetric = cardObservations.length > 1;
      for (const observation of cardObservations) {
        const tally = tallies.get(observation.cardId);
        if (tally === undefined) continue;
        const won = game.winnerSealedSeat === observation.sealedSeat;
        const decided = game.winnerSealedSeat !== null;
        tally.gamesIncluded += 1;
        if (won) tally.winsIncluded += 1;
        if (observation.drawn) {
          tally.gamesDrawn += 1;
          if (won) tally.winsWhenDrawn += 1;
        }
        if (observation.cast) {
          tally.gamesCast += 1;
          if (won) tally.winsWhenCast += 1;
        }
        if (observation.resolved) {
          tally.gamesResolved += 1;
          if (won) tally.winsWhenResolved += 1;
        }
        tally.samples.push({ trajectory: game.trajectoryFingerprint, won, decided, symmetric });
      }
    }
  }
  return [...tallies.values()]
    .sort((left, right) => left.card.cardId.localeCompare(right.card.cardId))
    .map((tally) => ({
      cardId: tally.card.cardId,
      cardName: tally.card.cardName,
      openedCount: tally.openedCount,
      includedCount: tally.includedCount,
      unusedCount: tally.openedCount - tally.includedCount,
      gamesIncluded: tally.gamesIncluded,
      winsIncluded: tally.winsIncluded,
      gamesDrawn: tally.gamesDrawn,
      winsWhenDrawn: tally.winsWhenDrawn,
      gamesCast: tally.gamesCast,
      winsWhenCast: tally.winsWhenCast,
      gamesResolved: tally.gamesResolved,
      winsWhenResolved: tally.winsWhenResolved,
      association: association(tally.samples, floor),
    }));
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function deriveSummary(
  decks: readonly DeckEvidence[],
  games: readonly SealedCalibrationGame[],
  gameFloor: number,
): SealedCalibrationArtifact['summary'] {
  const shortfalls = { spellSlots: 0, curveSlot: 0, creatureFloor: 0, colorSources: 0 };
  for (const shortfall of decks.flatMap((deck) => deck.shortfalls)) shortfalls[shortfall.kind] += 1;
  const reports = decks.flatMap((deck) => deck.manaReports);
  const consistentDecks = decks.filter((deck) => deck.manaConsistent).length;
  const pairCounts = new Map<string, { pair: [ColorPair[0], ColorPair[1]]; decks: number }>();
  for (const deck of decks) {
    const key = deck.colorPair.join('');
    const count = pairCounts.get(key) ?? { pair: [...deck.colorPair], decks: 0 };
    count.decks += 1;
    pairCounts.set(key, count);
  }
  const turns = games.map((game) => game.turns);
  const meanTurns = average(turns) ?? 0;
  const variance = average(turns.map((turn) => (turn - meanTurns) ** 2)) ?? 0;
  const decided = games.filter((game) => game.winnerSealedSeat !== null);
  const distinctDecided = new Map<string, boolean>();
  for (const game of decided) {
    const winnerGameSeat = game.sealedSeats.findIndex((seatId) => seatId === game.winnerSealedSeat);
    const onPlayWon = winnerGameSeat === game.startingPlayer;
    const prior = distinctDecided.get(game.trajectoryFingerprint);
    if (prior !== undefined && prior !== onPlayWon) {
      throw new Error(`trajectory ${game.trajectoryFingerprint} has conflicting on-play outcomes`);
    }
    distinctDecided.set(game.trajectoryFingerprint, onPlayWon);
  }
  const onPlayWins = [...distinctDecided.values()].filter(Boolean).length;
  const underSampled = distinctDecided.size < gameFloor;
  return {
    poolViability: {
      pools: decks.length,
      legalDecks: decks.filter((deck) => deck.legal40).length,
      legalRate: decks.filter((deck) => deck.legal40).length / decks.length,
      shapeCompleteDecks: decks.filter((deck) => deck.shapeComplete).length,
      shapeCompleteRate: decks.filter((deck) => deck.shapeComplete).length / decks.length,
      shortfalls,
    },
    manaConsistency: {
      decks: decks.length,
      consistentDecks,
      consistentRate: consistentDecks / decks.length,
      colorRequirements: reports.length,
      requirementsMeetingTarget: reports.filter((report) => report.meetsCastabilityTarget).length,
      requirementRate:
        reports.length === 0
          ? null
          : reports.filter((report) => report.meetsCastabilityTarget).length / reports.length,
      meanEarliestCastability: average(reports.map((report) => report.earliestCastability)),
      meanHeaviestCastability: average(reports.map((report) => report.heaviestCastability)),
      selectedColorPairs: [...pairCounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, count]) => count),
    },
    gameShape: {
      state: underSampled ? 'underSampled' : 'estimated',
      sampleUnit: 'decidedDistinctTrajectory',
      floor: gameFloor,
      games: games.length,
      decidedGames: decided.length,
      draws: games.length - decided.length,
      distinctGames: new Set(games.map((game) => game.trajectoryFingerprint)).size,
      distinctDecidedGames: distinctDecided.size,
      meanTurns,
      turnVariancePopulation: variance,
      onPlayDecided: distinctDecided.size,
      onPlayWins,
      onPlayWinRate: underSampled ? null : onPlayWins / distinctDecided.size,
      interval95: underSampled ? null : wilsonInterval(onPlayWins, distinctDecided.size),
    },
  };
}

export async function runSealedCalibration(
  cards: readonly Card[],
  options: SealedCalibrationOptions,
): Promise<SealedCalibrationArtifact> {
  assertInput(cards, options);
  const poolPairs = positiveOption(
    'pool pairs',
    options.poolPairs ?? DEFAULT_SEALED_POOL_PAIRS,
    MAX_SEALED_POOL_PAIRS,
    2,
  );
  const gamesPerSeatOrder = positiveOption(
    'games per seat order',
    options.gamesPerSeatOrder ?? DEFAULT_SEALED_GAMES_PER_SEAT_ORDER,
    MAX_SEALED_GAMES_PER_SEAT_ORDER,
    2,
  );
  const cardFloor = positiveOption(
    'card floor',
    options.cardFloor ?? DEFAULT_SEALED_CARD_FLOOR,
    MAX_SEALED_CARD_FLOOR,
  );
  const gameFloor = positiveOption(
    'game floor',
    options.gameFloor ?? DEFAULT_SEALED_GAME_FLOOR,
    MAX_SEALED_GAME_FLOOR,
  );
  if (options.workers !== undefined) positiveOption('workers', options.workers, MAX_SEALED_WORKERS);
  const code = cards[0]?.set.code;
  if (code === undefined) throw new Error('Sealed calibration set has no code');
  const collationDigest = collationFingerprint(options.collation.version, options.collation.recipe);
  const pools: PoolEvidence[] = [];
  const builtDecks: BuiltSealedDeck[] = [];
  for (let poolIndex = 0; poolIndex < poolPairs; poolIndex += 1) {
    for (const seatId of [0, 1] as const) {
      const seedValue = poolSeed(options.seed, poolIndex, seatId);
      const opened = openSealedPool(cards, {
        seed: seedValue,
        boosters: SEALED_BOOSTERS_PER_POOL,
        recipe: options.collation.recipe,
      });
      const pool = openedEvidence(poolIndex, seatId, seedValue, collationDigest, opened.boosters);
      pools.push(pool);
      builtDecks.push(buildSealedDeck(pool, opened.cards, buildDeck(opened.cards)));
    }
  }
  const scheduled = schedule(options.seed, code, builtDecks, poolPairs, gamesPerSeatOrder);
  const runs = await withSimPool(
    { ...(options.workers === undefined ? {} : { workers: options.workers }) },
    (pool) => pool.runMatches(scheduled.map((entry) => entry.spec)),
  );
  if (runs.length !== scheduled.length) throw new Error('Sealed simulation dropped a scheduled run');
  const games = scheduled.flatMap((entry, index) => {
    const run = runs[index];
    if (run === undefined) throw new Error(`Sealed simulation dropped run ${String(index)}`);
    return gameEvidence(entry, run);
  });
  const identities = setCardIdentities(cards);
  const decks = builtDecks.map((deck) => deck.evidence);
  const artifact: SealedCalibrationArtifact = {
    version: SEALED_CALIBRATION_ARTIFACT_VERSION,
    producedBy: SEALED_CALIBRATION_PRODUCER,
    scope: {
      format: 'Sealed',
      automated: true,
      humanEvidence: false,
      draftEvidence: false,
      interpretation: 'association-not-causal',
    },
    seed: options.seed,
    set: {
      code,
      cards: cards.length,
      fingerprint: setFingerprint(identities),
      sourceCards: cards.map((card) => structuredClone(card)),
      cardIdentities: identities,
    },
    collation: {
      version: SEALED_COLLATION_VERSION,
      sourceVersion: options.collation.version,
      fingerprint: collationDigest,
      recipe: options.collation.recipe.map((slot) => ({ ...slot })),
    },
    campaign: {
      poolPairs,
      boostersPerPool: SEALED_BOOSTERS_PER_POOL,
      gamesPerSeatOrder,
      cardFloor,
      gameFloor,
    },
    pools,
    decks,
    games,
    summary: deriveSummary(decks, games, gameFloor),
    cards: deriveCardEvidence(
      identities.map(({ cardId, cardName }) => ({ cardId, cardName })),
      pools,
      decks,
      games,
      cardFloor,
    ),
  };
  return readSealedCalibrationArtifact(artifact, 'generated Sealed calibration artifact');
}

export interface SealedCalibrationCliArgs {
  readonly setPath: string;
  readonly collationPath: string;
  readonly seed: string;
  readonly outputPath: string;
  readonly workers?: number | undefined;
  readonly poolPairs: number;
  readonly gamesPerSeatOrder: number;
  readonly cardFloor: number;
  readonly gameFloor: number;
}

function integerArgument(flag: string, value: string | undefined, maximum: number, minimum = 1): number {
  if (value === undefined) throw new Error(`${flag} needs a value`);
  return positiveOption(flag, Number(value), maximum, minimum);
}

function comparablePath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    try {
      return join(realpathSync(dirname(absolute)), basename(absolute));
    } catch {
      return absolute;
    }
  }
}

export function parseSealedCalibrationArgs(args: readonly string[]): SealedCalibrationCliArgs {
  const known = new Set([
    '--set',
    '--collation',
    '--seed',
    '--out',
    '--workers',
    '--pool-pairs',
    '--games-per-seat-order',
    '--card-floor',
    '--game-floor',
  ]);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (flag === undefined || !known.has(flag)) throw new Error(`unknown argument ${String(flag)}`);
    const value = args[index + 1];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (values.has(flag)) throw new Error(`${flag} was supplied more than once`);
    values.set(flag, value);
  }
  const required = (flag: string, maximum: number): string => {
    const value = values.get(flag);
    if (value === undefined || value.length === 0) throw new Error(`Sealed calibration CLI requires ${flag}`);
    if (value.length > maximum) throw new Error(`${flag} must contain at most ${String(maximum)} characters`);
    return value;
  };
  const setPath = required('--set', MAX_SEALED_PATH_LENGTH);
  const collationPath = required('--collation', MAX_SEALED_PATH_LENGTH);
  const seed = required('--seed', MAX_SEALED_SEED_LENGTH);
  const outputPath = required('--out', MAX_SEALED_PATH_LENGTH);
  if (comparablePath(outputPath) === comparablePath(setPath)) {
    throw new Error('--out must differ from --set so calibration cannot overwrite its input');
  }
  if (comparablePath(outputPath) === comparablePath(collationPath)) {
    throw new Error('--out must differ from --collation so calibration cannot overwrite its input');
  }
  const workers = values.has('--workers')
    ? integerArgument('--workers', values.get('--workers'), MAX_SEALED_WORKERS)
    : undefined;
  return {
    setPath,
    collationPath,
    seed,
    outputPath,
    ...(workers === undefined ? {} : { workers }),
    poolPairs: values.has('--pool-pairs')
      ? integerArgument('--pool-pairs', values.get('--pool-pairs'), MAX_SEALED_POOL_PAIRS, 2)
      : DEFAULT_SEALED_POOL_PAIRS,
    gamesPerSeatOrder: values.has('--games-per-seat-order')
      ? integerArgument(
          '--games-per-seat-order',
          values.get('--games-per-seat-order'),
          MAX_SEALED_GAMES_PER_SEAT_ORDER,
          2,
        )
      : DEFAULT_SEALED_GAMES_PER_SEAT_ORDER,
    cardFloor: values.has('--card-floor')
      ? integerArgument('--card-floor', values.get('--card-floor'), MAX_SEALED_CARD_FLOOR)
      : DEFAULT_SEALED_CARD_FLOOR,
    gameFloor: values.has('--game-floor')
      ? integerArgument('--game-floor', values.get('--game-floor'), MAX_SEALED_GAME_FLOOR)
      : DEFAULT_SEALED_GAME_FLOOR,
  };
}

function readJson(path: string, label: string, byteLimit: number): unknown {
  let descriptor: number | undefined;
  try {
    if (!statSync(path).isFile()) throw new Error('input is not a regular file');
    descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
    const status = fstatSync(descriptor);
    if (!status.isFile()) throw new Error('input is not a regular file');
    if (status.size > byteLimit) {
      throw new Error(`byte limit is ${String(byteLimit)}, but the input is ${String(status.size)} bytes`);
    }
    const buffer = Buffer.allocUnsafe(byteLimit + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = readSync(descriptor, buffer, bytesRead, buffer.length - bytesRead, null);
      if (count === 0) break;
      bytesRead += count;
    }
    if (bytesRead > byteLimit) {
      throw new Error(`byte limit is ${String(byteLimit)}, but the input grew while it was read`);
    }
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')) as unknown;
  } catch (error: unknown) {
    throw new Error(
      `${label} ${path} could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function readExecutableSet(path: string): readonly Card[] {
  const raw = (readJson(path, 'executable set', MAX_SEALED_SET_BYTES) as { cards?: unknown }).cards;
  if (!Array.isArray(raw)) throw new Error(`executable set ${path} needs a cards array`);
  if (raw.length > MAX_SEALED_SET_SIZE) {
    throw new Error(`executable set ${path} must contain at most ${String(MAX_SEALED_SET_SIZE)} cards`);
  }
  return raw.map((card, index) => {
    try {
      return parseCard(card);
    } catch (error: unknown) {
      throw new Error(
        `executable set ${path} card ${String(index)} is invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

function readCollation(path: string): SealedCollationInput {
  const parsed = DraftCollationSchema.safeParse(
    readJson(path, 'Sealed collation', MAX_SEALED_COLLATION_BYTES),
  );
  if (!parsed.success) {
    throw new Error(`Sealed collation ${path} is invalid: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export function writeSealedCalibrationArtifactAtomic(
  outputPath: string,
  artifact: SealedCalibrationArtifact,
): void {
  if (outputPath.length === 0 || outputPath.length > MAX_SEALED_PATH_LENGTH) {
    throw new Error(
      `Sealed artifact output path must contain 1-${String(MAX_SEALED_PATH_LENGTH)} characters`,
    );
  }
  const checked = readSealedCalibrationArtifact(artifact, 'Sealed artifact output');
  const temporaryPath = join(
    dirname(outputPath),
    `.${basename(outputPath)}.${String(process.pid)}.${randomUUID()}.tmp`,
  );
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(checked, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporaryPath, outputPath);
  } catch (error: unknown) {
    try {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    } catch {
      // Preserve the original write failure; the temporary path is named in it.
    }
    throw new Error(
      `atomic Sealed artifact write to ${outputPath} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function runSealedCalibrationCli(args: readonly string[]): Promise<void> {
  const parsed = parseSealedCalibrationArgs(args);
  const artifact = await runSealedCalibration(readExecutableSet(parsed.setPath), {
    seed: parsed.seed,
    collation: readCollation(parsed.collationPath),
    poolPairs: parsed.poolPairs,
    gamesPerSeatOrder: parsed.gamesPerSeatOrder,
    cardFloor: parsed.cardFloor,
    gameFloor: parsed.gameFloor,
    ...(parsed.workers === undefined ? {} : { workers: parsed.workers }),
  });
  writeSealedCalibrationArtifactAtomic(parsed.outputPath, artifact);
}
