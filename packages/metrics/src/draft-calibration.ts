/**
 * Automated native Draft evidence: deterministic packs -> eight bot seats ->
 * legal Limited decks -> kernel games -> physical-card observations.
 *
 * Draft is deliberately named at every boundary. This artifact contains no
 * Sealed pool and no human observation, so neither can be inferred later from
 * an unlabeled game count. Basic lands are the one Limited construction supply
 * outside a drafted pool; every other deck copy retains the pick instance that
 * put it in the pool.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import type { BoosterRecipe } from '@mtg/deckbuild';
import { buildDeck, buildFromSpells, spellCount } from '@mtg/deckbuild';
import type { Card, CardKind } from '@mtg/dsl';
import { canonicalJson, cardFingerprint, CardKindSchema, parseCard, RARITIES } from '@mtg/dsl';
import type { DraftPick, DraftResult } from '@mtg/draft-export';
import {
  buildLayouts,
  buildSheets,
  collationReport,
  draftedPool,
  formatCollationReport,
  runDraft,
} from '@mtg/draft-export';
import type { GameEvent } from '@mtg/kernel';
import { objectId } from '@mtg/kernel';
import type { MatchRun, MatchSpec } from '@mtg/sim';
import { greedySpec, SimGameLogSchema, withSimPool } from '@mtg/sim';
import { gameFingerprint } from './sample';
import { wilsonInterval } from './stats';

export const DRAFT_COLLATION_VERSION = 'native-draft-collation-v1';
export const DRAFT_CALIBRATION_ARTIFACT_VERSION = 'native-draft-calibration-v1';
export const DRAFT_CALIBRATION_PRODUCER = '@mtg/metrics/native-draft-calibration-v1';
export const DRAFT_CALIBRATION_SEATS = 8;
export const DEFAULT_DRAFT_CARD_FLOOR = 200;
export const DEFAULT_DRAFT_GAMES_PER_SEAT_ORDER = 1;
export const DEFAULT_DRAFT_PACKS_PER_SEAT = 3;
export const MAX_DRAFT_WORKERS = 64;
export const MAX_DRAFT_GAMES_PER_SEAT_ORDER = 100;
export const MAX_DRAFT_PACKS_PER_SEAT = 8;
export const MAX_DRAFT_PAIRINGS = 28;
export const MAX_DRAFT_CARD_FLOOR = MAX_DRAFT_PAIRINGS * 2 * MAX_DRAFT_GAMES_PER_SEAT_ORDER;
export const MAX_DRAFT_RECIPE_SLOT_COUNT = 20;
export const MAX_DRAFT_PACK_SIZE = 30;
export const MAX_DRAFT_SET_SIZE = 1_000;
export const MAX_DRAFT_SEED_LENGTH = 256;
export const MAX_DRAFT_PATH_LENGTH = 4_096;
const MAX_DRAFT_RECIPE_SLOTS = RARITIES.length;
const MAX_DRAFT_GAMES = MAX_DRAFT_PAIRINGS * 2 * MAX_DRAFT_GAMES_PER_SEAT_ORDER;
const MAX_DRAFT_DRAFTED_POOL_SIZE = MAX_DRAFT_PACKS_PER_SEAT * MAX_DRAFT_PACK_SIZE;
const MAX_DRAFT_GAME_SEED_LENGTH = MAX_DRAFT_SEED_LENGTH + 64;
const MAX_DRAFT_TRAJECTORY_LENGTH = 65_536;
const MAX_DRAFT_RAW_EVENTS_PER_GAME = 100_000;
const MAX_DRAFT_RELEVANT_EVENTS_PER_GAME = 20_000;

const digest = z.string().regex(/^[0-9a-f]{64}$/);
const nonnegative = z.number().int().min(0);
const positive = z.number().int().positive();
const rawEventIndex = nonnegative.max(MAX_DRAFT_RAW_EVENTS_PER_GAME - 1);
const seat = z
  .number()
  .int()
  .min(0)
  .max(DRAFT_CALIBRATION_SEATS - 1);

export const DraftCollationSchema = z
  .object({
    version: z.literal(DRAFT_COLLATION_VERSION),
    recipe: z
      .array(
        z
          .object({
            rarity: z.enum(RARITIES),
            count: positive.max(MAX_DRAFT_RECIPE_SLOT_COUNT),
            /**
             * Per-printing weights when one physical sheet supplies several
             * rarities — `@mtg/deckbuild`'s `BoosterRarityWeight`. Omitting it
             * was not a smaller recipe, it was a recipe that could not describe
             * the rare/mythic sheet at all: `boosterRecipeFor` returns
             * `SLICE_BOOSTER_WITH_RARE_MYTHIC` the moment a set prints one
             * mythic, and this `.strict()` object rejected the whole collation
             * document for an unrecognized key.
             */
            rarityWeights: z
              .array(z.object({ rarity: z.enum(RARITIES), weight: positive }).strict())
              .min(1)
              .max(RARITIES.length)
              .readonly()
              .optional(),
          })
          .strict()
          .superRefine((slot, context) => {
            if (slot.rarityWeights === undefined) return;
            if (!slot.rarityWeights.some((entry) => entry.rarity === slot.rarity)) {
              context.addIssue({
                code: 'custom',
                path: ['rarityWeights'],
                message: `a weighted ${slot.rarity} slot must include its primary rarity`,
              });
            }
            if (new Set(slot.rarityWeights.map((entry) => entry.rarity)).size !== slot.rarityWeights.length) {
              context.addIssue({
                code: 'custom',
                path: ['rarityWeights'],
                message: 'a booster slot cannot weight one rarity twice',
              });
            }
          }),
      )
      .min(1, 'recipe needs at least one slot')
      .max(MAX_DRAFT_RECIPE_SLOTS),
  })
  .strict()
  .superRefine((collation, context) => {
    if (new Set(collation.recipe.map((slot) => slot.rarity)).size !== collation.recipe.length) {
      context.addIssue({ code: 'custom', path: ['recipe'], message: 'recipe rarities must be unique' });
    }
    const packSize = collation.recipe.reduce((sum, slot) => sum + slot.count, 0);
    if (packSize > MAX_DRAFT_PACK_SIZE) {
      context.addIssue({
        code: 'custom',
        path: ['recipe'],
        message: `recipe pack size must be at most ${String(MAX_DRAFT_PACK_SIZE)}`,
      });
    }
  });

export interface DraftCollation {
  readonly version: typeof DRAFT_COLLATION_VERSION;
  readonly recipe: BoosterRecipe;
}

const DraftPickEvidenceSchema = z
  .object({
    instanceId: z.string().min(1),
    cardId: z.string().min(1),
    cardName: z.string().min(1),
    seat,
    round: positive.max(MAX_DRAFT_PACKS_PER_SEAT),
    pickNumber: positive.max(MAX_DRAFT_PACK_SIZE),
    packSize: positive.max(MAX_DRAFT_PACK_SIZE),
    openedBy: seat,
  })
  .strict();

const DraftSeatEvidenceSchema = z
  .object({ seat, picks: z.array(DraftPickEvidenceSchema).max(MAX_DRAFT_DRAFTED_POOL_SIZE) })
  .strict();

const DeckCardEvidenceSchema = z
  .object({
    instanceId: z.string().min(1),
    cardId: z.string().min(1),
    cardName: z.string().min(1),
    deckPosition: nonnegative,
    cardKind: CardKindSchema,
    source: z.enum(['draftPick', 'basicLandSupply']),
    pickInstanceId: z.string().min(1).nullable(),
  })
  .strict();

const DraftDeckEvidenceSchema = z
  .object({
    seat,
    name: z.string().min(1),
    fingerprint: digest,
    draftedPoolCards: positive.max(MAX_DRAFT_DRAFTED_POOL_SIZE),
    cards: z.array(DeckCardEvidenceSchema).length(40),
  })
  .strict();

const CardInstanceGameEvidenceSchema = z
  .object({
    instanceId: z.string().min(1),
    cardId: z.string().min(1),
    draftSeat: seat,
    gameSeat: z.union([z.literal(0), z.literal(1)]),
    drawn: z.boolean(),
    cast: z.boolean(),
    resolved: z.boolean(),
    drawEventIndexes: z.array(rawEventIndex).max(MAX_DRAFT_RELEVANT_EVENTS_PER_GAME),
    castEventIndexes: z.array(rawEventIndex).max(MAX_DRAFT_RELEVANT_EVENTS_PER_GAME),
    successfulResolutionEventIndexes: z.array(rawEventIndex).max(MAX_DRAFT_RELEVANT_EVENTS_PER_GAME),
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

const DraftGameEvidenceSchema = z
  .object({
    seed: z.string().min(1).max(MAX_DRAFT_GAME_SEED_LENGTH),
    pairing: z.tuple([seat, seat]),
    seatOrder: z.union([z.literal(0), z.literal(1)]),
    draftSeats: z.tuple([seat, seat]),
    startingPlayer: z.union([z.literal(0), z.literal(1)]),
    winnerDraftSeat: seat.nullable(),
    reason: z.enum(['lifeZero', 'emptyLibrary', 'concede', 'turnLimit']),
    turns: positive,
    decisions: nonnegative,
    trajectoryFingerprint: z.string().min(1).max(MAX_DRAFT_TRAJECTORY_LENGTH),
    replay: SimGameLogSchema,
    rawEventCount: positive.max(MAX_DRAFT_RAW_EVENTS_PER_GAME),
    relevantCardEventsFingerprint: digest,
    relevantCardEvents: z.array(IndexedRelevantCardEventSchema).max(MAX_DRAFT_RELEVANT_EVENTS_PER_GAME),
    cardEvents: z.array(CardInstanceGameEvidenceSchema).length(80),
  })
  .strict();

const DraftCardUncertaintySchema = z
  .object({
    state: z.enum(['underSampled', 'estimated']),
    sampleUnit: z.literal('decidedDistinctTrajectory'),
    floor: positive.max(MAX_DRAFT_CARD_FLOOR),
    games: nonnegative,
    distinctGames: nonnegative,
    distinctWins: nonnegative,
    decidedGames: nonnegative,
    symmetricGames: nonnegative,
    winRate: z.number().min(0).max(1).nullable(),
    interval95: z
      .object({ low: z.number().min(0).max(1), high: z.number().min(0).max(1) })
      .strict()
      .nullable(),
  })
  .strict();

const SetCardIdentitySchema = z
  .object({
    cardId: z.string().min(1),
    cardName: z.string().min(1),
    cardKind: CardKindSchema,
    printing: z.object({ code: z.string().min(1), collectorNumber: nonnegative }).strict(),
    fingerprint: digest,
  })
  .strict();

const DraftCardEvidenceSchema = z
  .object({
    cardId: z.string().min(1),
    cardName: z.string().min(1),
    inclusionCount: nonnegative,
    unusedCount: nonnegative,
    gamesIncluded: nonnegative,
    winsIncluded: nonnegative,
    gamesDrawn: nonnegative,
    winsWhenDrawn: nonnegative,
    gamesCast: nonnegative,
    winsWhenCast: nonnegative,
    gamesResolved: nonnegative,
    winsWhenResolved: nonnegative,
    uncertainty: DraftCardUncertaintySchema,
  })
  .strict();

export const DraftCalibrationArtifactSchema = z
  .object({
    version: z.literal(DRAFT_CALIBRATION_ARTIFACT_VERSION),
    producedBy: z.literal(DRAFT_CALIBRATION_PRODUCER),
    scope: z
      .object({
        format: z.literal('Draft'),
        automated: z.literal(true),
        humanEvidence: z.literal(false),
        sealedEvidence: z.literal(false),
      })
      .strict(),
    seed: z.string().min(1).max(MAX_DRAFT_SEED_LENGTH),
    set: z
      .object({
        code: z.string().min(1).max(MAX_DRAFT_PATH_LENGTH),
        cards: positive.max(MAX_DRAFT_SET_SIZE),
        fingerprint: digest,
        cardIdentities: z.array(SetCardIdentitySchema).max(MAX_DRAFT_SET_SIZE),
      })
      .strict(),
    collation: DraftCollationSchema,
    draft: z
      .object({
        packsPerSeat: positive.max(MAX_DRAFT_PACKS_PER_SEAT),
        seats: z.array(DraftSeatEvidenceSchema).length(DRAFT_CALIBRATION_SEATS),
      })
      .strict(),
    decks: z.array(DraftDeckEvidenceSchema).length(DRAFT_CALIBRATION_SEATS),
    games: z.array(DraftGameEvidenceSchema).max(MAX_DRAFT_GAMES),
    summary: z
      .object({
        games: nonnegative.max(MAX_DRAFT_GAMES),
        distinctGames: nonnegative.max(MAX_DRAFT_GAMES),
        pairings: positive.max(MAX_DRAFT_PAIRINGS),
        seatOrders: z.literal(2),
        gamesPerSeatOrder: positive.max(MAX_DRAFT_GAMES_PER_SEAT_ORDER),
        cardFloor: positive.max(MAX_DRAFT_CARD_FLOOR),
      })
      .strict(),
    cards: z.array(DraftCardEvidenceSchema).max(MAX_DRAFT_SET_SIZE),
  })
  .strict()
  .superRefine((artifact, context) => {
    const picks = artifact.draft.seats.flatMap((draftSeat) => draftSeat.picks);
    const pickByInstance = new Map(picks.map((pick) => [pick.instanceId, pick]));
    const identityByCard = new Map(
      artifact.set.cardIdentities.map((identity) => [identity.cardId, identity]),
    );
    if (
      artifact.set.cards !== artifact.set.cardIdentities.length ||
      artifact.set.cards !== artifact.cards.length ||
      identityByCard.size !== artifact.set.cardIdentities.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['set', 'cards'],
        message: 'set card count and unique card identities must agree with card evidence',
      });
    }
    if (setFingerprintFromIdentities(artifact.set.cardIdentities) !== artifact.set.fingerprint) {
      context.addIssue({
        code: 'custom',
        path: ['set', 'fingerprint'],
        message: 'set fingerprint disagrees with its card identities',
      });
    }
    if (artifact.set.cardIdentities.some((identity) => identity.printing.code !== artifact.set.code)) {
      context.addIssue({
        code: 'custom',
        path: ['set', 'cardIdentities'],
        message: 'set card identity printing codes must agree with the set code',
      });
    }
    if (pickByInstance.size !== picks.length) {
      context.addIssue({
        code: 'custom',
        path: ['draft', 'seats'],
        message: 'pick instance ids must be unique',
      });
    }
    const draftSeatIds = new Set<number>();
    const packSize = artifact.collation.recipe.reduce((sum, slot) => sum + slot.count, 0);
    const expectedPicksPerSeat = artifact.draft.packsPerSeat * packSize;
    for (const [draftSeatIndex, draftSeat] of artifact.draft.seats.entries()) {
      if (draftSeatIds.has(draftSeat.seat)) {
        context.addIssue({
          code: 'custom',
          path: ['draft', 'seats', draftSeatIndex, 'seat'],
          message: 'Draft seat ids must be unique',
        });
      }
      draftSeatIds.add(draftSeat.seat);
      if (draftSeat.picks.length !== expectedPicksPerSeat) {
        context.addIssue({
          code: 'custom',
          path: ['draft', 'seats', draftSeatIndex, 'picks'],
          message: 'Draft seat pick count disagrees with packs per seat and recipe pack size',
        });
      }
      for (const [pickIndex, pick] of draftSeat.picks.entries()) {
        const expectedRound = Math.floor(pickIndex / packSize) + 1;
        const expectedPickNumber = (pickIndex % packSize) + 1;
        const direction = expectedRound % 2 === 1 ? 1 : -1;
        const expectedOpenedBy =
          (draftSeat.seat - direction * (expectedPickNumber - 1) + DRAFT_CALIBRATION_SEATS * packSize) %
          DRAFT_CALIBRATION_SEATS;
        if (
          pick.instanceId !== canonicalPickInstanceId(draftSeat.seat, expectedRound, expectedPickNumber) ||
          pick.round !== expectedRound ||
          pick.round > artifact.draft.packsPerSeat ||
          pick.pickNumber !== expectedPickNumber ||
          pick.packSize !== packSize - expectedPickNumber + 1 ||
          pick.openedBy !== expectedOpenedBy
        ) {
          context.addIssue({
            code: 'custom',
            path: ['draft', 'seats', draftSeatIndex, 'picks', pickIndex],
            message:
              'pick transcript disagrees with canonical round, position, pack size, or pass chronology',
          });
        }
        if (pick.seat !== draftSeat.seat) {
          context.addIssue({
            code: 'custom',
            path: ['draft', 'seats', draftSeatIndex, 'picks', pickIndex, 'seat'],
            message: 'pick seat must agree with its containing Draft seat',
          });
        }
        const identity = identityByCard.get(pick.cardId);
        if (identity === undefined || identity.cardName !== pick.cardName) {
          context.addIssue({
            code: 'custom',
            path: ['draft', 'seats', draftSeatIndex, 'picks', pickIndex, 'cardId'],
            message: 'Draft pick identity disagrees with the set card identities',
          });
        }
      }
    }

    const deckBySeat = new Map(artifact.decks.map((deck) => [deck.seat, deck]));
    if (deckBySeat.size !== DRAFT_CALIBRATION_SEATS) {
      context.addIssue({ code: 'custom', path: ['decks'], message: 'deck seats must be unique' });
    }
    const allDeckInstances = new Set<string>();
    for (const [deckIndex, deck] of artifact.decks.entries()) {
      const deckPositions = new Set(deck.cards.map((card) => card.deckPosition));
      if (
        deckPositions.size !== deck.cards.length ||
        [...deckPositions].some((position) => position < 0 || position >= deck.cards.length)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['decks', deckIndex, 'cards'],
          message: 'deck positions must uniquely cover 0 through 39',
        });
      }
      const expectedFingerprint = deckFingerprint(deck.cards);
      if (deck.fingerprint !== expectedFingerprint) {
        context.addIssue({
          code: 'custom',
          path: ['decks', deckIndex, 'fingerprint'],
          message: 'deck fingerprint disagrees with its physical card identities',
        });
      }
      const seatPicks = artifact.draft.seats.find((draftSeat) => draftSeat.seat === deck.seat)?.picks;
      if (seatPicks === undefined || deck.draftedPoolCards !== seatPicks.length) {
        context.addIssue({
          code: 'custom',
          path: ['decks', deckIndex, 'draftedPoolCards'],
          message: 'deck drafted-pool count disagrees with its Draft seat',
        });
      }
      for (const [cardIndex, card] of deck.cards.entries()) {
        if (allDeckInstances.has(card.instanceId)) {
          context.addIssue({
            code: 'custom',
            path: ['decks', deckIndex, 'cards', cardIndex, 'instanceId'],
            message: 'deck instance ids must be unique',
          });
        }
        allDeckInstances.add(card.instanceId);
        const setIdentity = identityByCard.get(card.cardId);
        if (
          card.source === 'draftPick' &&
          (setIdentity === undefined ||
            setIdentity.cardName !== card.cardName ||
            setIdentity.cardKind !== card.cardKind)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['decks', deckIndex, 'cards', cardIndex, 'cardId'],
            message: 'deck card identity disagrees with the set card identities',
          });
        }
        if (card.source === 'draftPick') {
          const pick = pickByInstance.get(card.pickInstanceId ?? '');
          if (
            pick === undefined ||
            card.instanceId !== card.pickInstanceId ||
            pick.cardId !== card.cardId ||
            pick.cardName !== card.cardName ||
            pick.seat !== deck.seat
          ) {
            context.addIssue({
              code: 'custom',
              path: ['decks', deckIndex, 'cards', cardIndex],
              message: 'draft-pick deck card does not match a pick from this seat',
            });
          }
        } else {
          if (card.pickInstanceId !== null) {
            context.addIssue({
              code: 'custom',
              path: ['decks', deckIndex, 'cards', cardIndex, 'pickInstanceId'],
              message: 'basic-land supply cards cannot claim a draft pick',
            });
          }
          if (card.cardKind !== 'land') {
            context.addIssue({
              code: 'custom',
              path: ['decks', deckIndex, 'cards', cardIndex, 'cardKind'],
              message: 'basic-land supply cards must be lands',
            });
          }
        }
      }
    }

    if (artifact.summary.games !== artifact.games.length) {
      context.addIssue({
        code: 'custom',
        path: ['summary', 'games'],
        message: 'summary game count disagrees with games',
      });
    }
    const expectedGames = artifact.summary.pairings * 2 * artifact.summary.gamesPerSeatOrder;
    if (artifact.games.length !== expectedGames) {
      context.addIssue({
        code: 'custom',
        path: ['summary', 'games'],
        message: 'scheduled games must equal pairings times both seat orders times games per seat order',
      });
    }
    const distinct = new Set(artifact.games.map((game) => game.trajectoryFingerprint)).size;
    if (artifact.summary.distinctGames !== distinct) {
      context.addIssue({
        code: 'custom',
        path: ['summary', 'distinctGames'],
        message: 'distinct-game count disagrees with trajectory fingerprints',
      });
    }

    const gameSeeds = new Set<string>();
    const pairingOrders = new Map<string, [number, number]>();
    for (const [gameIndex, game] of artifact.games.entries()) {
      if (gameSeeds.has(game.seed)) {
        context.addIssue({
          code: 'custom',
          path: ['games', gameIndex, 'seed'],
          message: 'game seeds must be unique',
        });
      }
      gameSeeds.add(game.seed);
      const pairingKey = `${String(game.pairing[0])}/${String(game.pairing[1])}`;
      const orderCounts = pairingOrders.get(pairingKey) ?? [0, 0];
      orderCounts[game.seatOrder] += 1;
      pairingOrders.set(pairingKey, orderCounts);
      if (game.replay.extras.sim_game_seed !== game.seed || game.replay.metadata.draft_id !== game.seed) {
        context.addIssue({
          code: 'custom',
          path: ['games', gameIndex, 'replay'],
          message: 'replay seed disagrees with game',
        });
      }
      const expectedStartingPlayer = game.replay.metadata.on_play === 1 ? 0 : 1;
      if (
        game.startingPlayer !== expectedStartingPlayer ||
        game.reason !== game.replay.extras.sim_end_reason ||
        game.turns !== game.replay.metadata.num_turns ||
        game.decisions !== game.replay.extras.sim_decisions
      ) {
        context.addIssue({
          code: 'custom',
          path: ['games', gameIndex],
          message: 'game headline disagrees with its retained replay',
        });
      }
      if (game.trajectoryFingerprint !== gameFingerprint(game.replay)) {
        context.addIssue({
          code: 'custom',
          path: ['games', gameIndex, 'trajectoryFingerprint'],
          message: 'trajectory fingerprint disagrees with the replay',
        });
      }
      const runSeed = `${artifact.seed}/pair/${String(game.pairing[0])}-${String(game.pairing[1])}/seat-order/${String(game.seatOrder)}`;
      const expectedGameSeeds = Array.from(
        { length: artifact.summary.gamesPerSeatOrder },
        (_unused, index) => `${runSeed}/game/${String(index)}`,
      );
      const expectedGameIndex = expectedGameSeeds.indexOf(game.seed);
      if (expectedGameIndex < 0) {
        context.addIssue({
          code: 'custom',
          path: ['games', gameIndex, 'seed'],
          message: 'game seed disagrees with its pairing, seat order, or study seed',
        });
      } else if (game.startingPlayer !== expectedGameIndex % 2) {
        context.addIssue({
          code: 'custom',
          path: ['games', gameIndex, 'startingPlayer'],
          message: 'starting player disagrees with the alternating-play schedule',
        });
      }
      const expectedDraftSeats: readonly [number, number] =
        game.seatOrder === 0 ? game.pairing : [game.pairing[1], game.pairing[0]];
      if (
        game.pairing[0] >= game.pairing[1] ||
        game.draftSeats[0] !== expectedDraftSeats[0] ||
        game.draftSeats[1] !== expectedDraftSeats[1]
      ) {
        context.addIssue({
          code: 'custom',
          path: ['games', gameIndex, 'draftSeats'],
          message: 'draft seats disagree with the canonical pairing and seat order',
        });
      }
      const firstDeck = deckBySeat.get(game.draftSeats[0]);
      const secondDeck = deckBySeat.get(game.draftSeats[1]);
      if (
        firstDeck === undefined ||
        secondDeck === undefined ||
        game.replay.extras.sim_run_seed !== runSeed ||
        game.replay.extras.sim_game_index !== expectedGameIndex ||
        game.replay.extras.sim_user_deck !== firstDeck.name ||
        game.replay.extras.sim_oppo_deck !== secondDeck.name ||
        game.replay.extras.sim_user_bot !== `${firstDeck.name}-bot` ||
        game.replay.extras.sim_oppo_bot !== `${secondDeck.name}-bot` ||
        game.replay.metadata.expansion !== artifact.set.code ||
        game.replay.metadata.event_type !== 'DraftBotCalibration'
      ) {
        context.addIssue({
          code: 'custom',
          path: ['games', gameIndex, 'replay'],
          message: 'replay schedule metadata disagrees with the Draft study',
        });
      }
      const expectedWinner =
        game.replay.extras.sim_winner === null ? null : game.draftSeats[game.replay.extras.sim_winner];
      const expectedReplayWon = game.replay.extras.sim_winner === 0 ? 1 : 0;
      if (game.winnerDraftSeat !== expectedWinner || game.replay.metadata.won !== expectedReplayWon) {
        context.addIssue({
          code: 'custom',
          path: ['games', gameIndex, 'winnerDraftSeat'],
          message: 'winner disagrees with replay seat mapping or replay metadata',
        });
      }
      const expectedInstances = new Map<
        string,
        {
          readonly cardId: string;
          readonly cardKind: CardKind;
          readonly draftSeat: number;
          readonly gameSeat: 0 | 1;
          readonly oid: string;
        }
      >();
      const expectedOids = new Set<string>();
      let oidOffset = 0;
      for (const gameSeat of [0, 1] as const) {
        const draftSeat = game.draftSeats[gameSeat];
        const deck = deckBySeat.get(draftSeat);
        for (const card of deck?.cards ?? []) {
          const oid = objectId(oidOffset + card.deckPosition);
          expectedInstances.set(card.instanceId, {
            cardId: card.cardId,
            cardKind: card.cardKind,
            draftSeat,
            gameSeat,
            oid,
          });
          expectedOids.add(oid);
        }
        oidOffset += deck?.cards.length ?? 0;
      }
      if (
        eventEvidenceFingerprint(game.rawEventCount, game.relevantCardEvents) !==
        game.relevantCardEventsFingerprint
      ) {
        context.addIssue({
          code: 'custom',
          path: ['games', gameIndex, 'relevantCardEventsFingerprint'],
          message: 'relevant card-event fingerprint disagrees with its retained ledger',
        });
      }
      let previousRelevantEventIndex = -1;
      for (const [ledgerIndex, relevantEvent] of game.relevantCardEvents.entries()) {
        if (
          relevantEvent.index <= previousRelevantEventIndex ||
          relevantEvent.index >= game.rawEventCount ||
          !expectedOids.has(relevantEvent.oid)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['games', gameIndex, 'relevantCardEvents', ledgerIndex],
            message:
              'relevant card event must be ordered, inside the raw event stream, and reference a physical deck object',
          });
        }
        previousRelevantEventIndex = relevantEvent.index;
      }
      const observedInstances = new Set<string>();
      for (const [eventIndex, event] of game.cardEvents.entries()) {
        const expected = expectedInstances.get(event.instanceId);
        if (expected === undefined) {
          context.addIssue({
            code: 'custom',
            path: ['games', gameIndex, 'cardEvents', eventIndex, 'instanceId'],
            message: `card event references unknown deck instance ${event.instanceId}`,
          });
        } else if (
          event.cardId !== expected.cardId ||
          event.draftSeat !== expected.draftSeat ||
          event.gameSeat !== expected.gameSeat
        ) {
          context.addIssue({
            code: 'custom',
            path: ['games', gameIndex, 'cardEvents', eventIndex],
            message: 'card event identity disagrees with its physical deck instance',
          });
        }
        if (observedInstances.has(event.instanceId)) {
          context.addIssue({
            code: 'custom',
            path: ['games', gameIndex, 'cardEvents', eventIndex, 'instanceId'],
            message: 'a game can report each deck instance only once',
          });
        }
        observedInstances.add(event.instanceId);
        const expectedDrawIndexes =
          expected === undefined
            ? []
            : game.relevantCardEvents
                .filter((entry) => entry.type === 'cardDrawn' && entry.oid === expected.oid)
                .map((entry) => entry.index);
        const expectedCastIndexes =
          expected === undefined
            ? []
            : game.relevantCardEvents
                .filter((entry) => entry.type === 'spellCast' && entry.oid === expected.oid)
                .map((entry) => entry.index);
        const expectedResolutionIndexes =
          expected === undefined
            ? []
            : successfulResolutionLedgerIndexes(game.relevantCardEvents, expected.oid, expected.cardKind);
        if (
          !numberArraysEqual(event.drawEventIndexes, expectedDrawIndexes) ||
          !numberArraysEqual(event.castEventIndexes, expectedCastIndexes) ||
          !numberArraysEqual(event.successfulResolutionEventIndexes, expectedResolutionIndexes) ||
          event.drawn !== expectedDrawIndexes.length > 0 ||
          event.cast !== expectedCastIndexes.length > 0 ||
          event.resolved !== expectedResolutionIndexes.length > 0
        ) {
          context.addIssue({
            code: 'custom',
            path: ['games', gameIndex, 'cardEvents', eventIndex],
            message: 'card-event evidence disagrees with its retained event ledger',
          });
        }
      }
      if (observedInstances.size !== expectedInstances.size) {
        context.addIssue({
          code: 'custom',
          path: ['games', gameIndex, 'cardEvents'],
          message: 'card evidence must cover every physical deck instance',
        });
      }
    }

    if (pairingOrders.size !== artifact.summary.pairings) {
      context.addIssue({
        code: 'custom',
        path: ['summary', 'pairings'],
        message: 'summary pairing count disagrees with game pairings',
      });
    }
    for (const [pairing, counts] of pairingOrders) {
      if (
        counts[0] !== artifact.summary.gamesPerSeatOrder ||
        counts[1] !== artifact.summary.gamesPerSeatOrder
      ) {
        context.addIssue({
          code: 'custom',
          path: ['games'],
          message: `pairing ${pairing} must contain the declared number of games in both seat orders`,
        });
      }
    }

    const aggregateIds = new Set<string>();
    for (const [index, card] of artifact.cards.entries()) {
      if (aggregateIds.has(card.cardId)) {
        context.addIssue({
          code: 'custom',
          path: ['cards', index, 'cardId'],
          message: 'card aggregates need unique ids',
        });
      }
      aggregateIds.add(card.cardId);
      const identity = identityByCard.get(card.cardId);
      if (identity === undefined || identity.cardName !== card.cardName) {
        context.addIssue({
          code: 'custom',
          path: ['cards', index, 'cardId'],
          message: 'card evidence identity disagrees with the set identities',
        });
      }
    }

    try {
      const expectedCards = deriveCardEvidence(
        artifact.cards.map(({ cardId, cardName }) => ({ cardId, cardName })),
        artifact.draft.seats,
        artifact.decks,
        artifact.games,
        artifact.summary.cardFloor,
      );
      if (canonicalJson(expectedCards) !== canonicalJson(artifact.cards)) {
        context.addIssue({
          code: 'custom',
          path: ['cards'],
          message: 'card evidence disagrees with the Draft picks, decks, or games',
        });
      }
    } catch (error: unknown) {
      context.addIssue({
        code: 'custom',
        path: ['cards'],
        message: `card evidence cannot be reconciled: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

export type DraftCalibrationArtifact = z.infer<typeof DraftCalibrationArtifactSchema>;
export type DraftCalibrationGame = z.infer<typeof DraftGameEvidenceSchema>;
export type DraftCalibrationDeck = z.infer<typeof DraftDeckEvidenceSchema>;

export function parseDraftCollation(value: unknown, source = 'draft collation'): DraftCollation {
  const parsed = DraftCollationSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${source}: invalid Draft collation: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export function readDraftCalibrationArtifact(
  value: unknown,
  source = 'Draft calibration artifact',
): DraftCalibrationArtifact {
  const parsed = DraftCalibrationArtifactSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${source}: invalid Draft calibration artifact: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export interface DraftCalibrationOptions {
  readonly seed: string;
  readonly collation: DraftCollation;
  readonly workers?: number | undefined;
  readonly gamesPerSeatOrder?: number | undefined;
  readonly packsPerSeat?: number | undefined;
  readonly cardFloor?: number | undefined;
  /** Defaults to every unordered pair. Intended for bounded tests and diagnostics. */
  readonly pairings?: readonly (readonly [number, number])[] | undefined;
}

interface BuiltDraftDeck {
  readonly seat: number;
  readonly cards: readonly Card[];
  readonly evidence: DraftCalibrationDeck;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

type SetCardIdentity = z.infer<typeof SetCardIdentitySchema>;

function setCardIdentities(cards: readonly Card[]): SetCardIdentity[] {
  return [...cards]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((card) => ({
      cardId: card.id,
      cardName: card.name,
      cardKind: card.kind,
      printing: { ...card.set },
      fingerprint: cardFingerprint(card),
    }));
}

function setFingerprintFromIdentities(identities: readonly SetCardIdentity[]): string {
  return sha256([...identities].sort((left, right) => left.cardId.localeCompare(right.cardId)));
}

function deckFingerprint(cards: readonly z.infer<typeof DeckCardEvidenceSchema>[]): string {
  return sha256(cards);
}

function canonicalPickInstanceId(seatId: number, round: number, pickNumber: number): string {
  return `draft/seat/${String(seatId)}/round/${String(round)}/pick/${String(pickNumber)}`;
}

function pickInstanceId(pick: DraftPick): string {
  return canonicalPickInstanceId(pick.seat, pick.round, pick.pickNumber);
}

function pickEvidence(pick: DraftPick): z.infer<typeof DraftPickEvidenceSchema> {
  return {
    instanceId: pickInstanceId(pick),
    cardId: pick.card.id,
    cardName: pick.card.name,
    seat: pick.seat,
    round: pick.round,
    pickNumber: pick.pickNumber,
    packSize: pick.packSize,
    openedBy: pick.openedBy,
  };
}

function assertInput(cards: readonly Card[], options: DraftCalibrationOptions): void {
  if (cards.length === 0) throw new Error('Draft calibration needs a nonempty executable set');
  if (cards.length > MAX_DRAFT_SET_SIZE) {
    throw new Error(`Draft calibration set must contain at most ${String(MAX_DRAFT_SET_SIZE)} cards`);
  }
  if (options.seed.trim().length === 0) throw new Error('Draft calibration needs a nonempty seed');
  if (options.seed.length > MAX_DRAFT_SEED_LENGTH) {
    throw new Error(
      `Draft calibration seed must contain at most ${String(MAX_DRAFT_SEED_LENGTH)} characters`,
    );
  }
  const ids = new Set(cards.map((card) => card.id));
  if (ids.size !== cards.length) throw new Error('Draft calibration set cards cannot share an id');
  const codes = new Set(cards.map((card) => card.set.code));
  if (codes.size !== 1) throw new Error('Draft calibration set cards must share one set code');
  parseDraftCollation(options.collation);
  const report = collationReport(buildSheets(cards), buildLayouts(options.collation.recipe));
  const findings = formatCollationReport(report);
  if (findings.length > 0) {
    throw new Error(`Draft calibration collation is not total over this set: ${findings.join('; ')}`);
  }
}

function positiveOption(name: string, value: number, maximum: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got ${String(value)}`);
  }
  if (value > maximum) {
    throw new Error(`${name} must be at most ${String(maximum)}, got ${String(value)}`);
  }
  return value;
}

function selectedPoolIndices(pool: readonly Card[]): readonly number[] {
  const automatic = buildDeck(pool);
  const selected = automatic.picks.map((pick) => pick.poolIndex);
  const used = new Set(selected);
  for (const [index, card] of pool.entries()) {
    if (selected.length >= spellCount(automatic.config)) break;
    if (card.kind !== 'land' && !used.has(index)) {
      selected.push(index);
      used.add(index);
    }
  }
  if (selected.length !== spellCount(automatic.config)) {
    throw new Error(
      `drafted pool has only ${String(selected.length)} drafted spells; ` +
        `${String(spellCount(automatic.config))} are required for a legal 40-card deck`,
    );
  }
  return selected;
}

function buildDraftDeck(result: DraftResult, draftSeat: number): BuiltDraftDeck {
  const seatResult = result.seats[draftSeat];
  if (seatResult === undefined) throw new Error(`Draft calibration has no seat ${String(draftSeat)}`);
  const pool = draftedPool(seatResult);
  const selected = selectedPoolIndices(pool);
  const spells = selected.map((index) => pool[index] as Card);
  const built = buildFromSpells(spells, pool);
  if (!built.complete || built.deck.length !== 40) {
    throw new Error(`Draft calibration seat ${String(draftSeat)} did not build a legal 40-card deck`);
  }

  const usedPoolIndices = new Set(selected);
  const evidence: z.infer<typeof DeckCardEvidenceSchema>[] = [];
  for (const [deckPosition, poolIndex] of selected.entries()) {
    const pick = seatResult.picks[poolIndex];
    if (pick === undefined)
      throw new Error(`Draft calibration seat ${String(draftSeat)} lost pool index ${String(poolIndex)}`);
    evidence.push({
      instanceId: pickInstanceId(pick),
      cardId: pick.card.id,
      cardName: pick.card.name,
      deckPosition,
      cardKind: pick.card.kind,
      source: 'draftPick',
      pickInstanceId: pickInstanceId(pick),
    });
  }

  for (const [landOffset, land] of built.lands.entries()) {
    const poolIndex = pool.findIndex(
      (candidate, index) =>
        !usedPoolIndices.has(index) && candidate.kind === 'land' && candidate.id === land.id,
    );
    if (poolIndex >= 0) {
      usedPoolIndices.add(poolIndex);
      const pick = seatResult.picks[poolIndex];
      if (pick === undefined) throw new Error('Draft calibration lost a drafted basic-land pick');
      evidence.push({
        instanceId: pickInstanceId(pick),
        cardId: land.id,
        cardName: land.name,
        deckPosition: spells.length + landOffset,
        cardKind: land.kind,
        source: 'draftPick',
        pickInstanceId: pickInstanceId(pick),
      });
    } else {
      evidence.push({
        instanceId: `deck/seat/${String(draftSeat)}/basic/${String(landOffset)}`,
        cardId: land.id,
        cardName: land.name,
        deckPosition: spells.length + landOffset,
        cardKind: land.kind,
        source: 'basicLandSupply',
        pickInstanceId: null,
      });
    }
  }

  const name = `draft-seat-${String(draftSeat)}`;
  return {
    seat: draftSeat,
    cards: built.deck,
    evidence: {
      seat: draftSeat,
      name,
      fingerprint: deckFingerprint(evidence),
      draftedPoolCards: pool.length,
      cards: evidence,
    },
  };
}

function allPairings(): readonly (readonly [number, number])[] {
  const out: [number, number][] = [];
  for (let first = 0; first < DRAFT_CALIBRATION_SEATS; first += 1) {
    for (let second = first + 1; second < DRAFT_CALIBRATION_SEATS; second += 1) out.push([first, second]);
  }
  return out;
}

function resolvePairings(
  input: readonly (readonly [number, number])[] | undefined,
): readonly (readonly [number, number])[] {
  const pairings = input ?? allPairings();
  if (pairings.length === 0) throw new Error('Draft calibration needs at least one deck pairing');
  if (pairings.length > MAX_DRAFT_PAIRINGS) {
    throw new Error(`Draft calibration pairings must contain at most ${String(MAX_DRAFT_PAIRINGS)} entries`);
  }
  const seen = new Set<string>();
  return pairings.map(([first, second], index) => {
    if (
      !Number.isInteger(first) ||
      !Number.isInteger(second) ||
      first < 0 ||
      first >= DRAFT_CALIBRATION_SEATS ||
      second < 0 ||
      second >= DRAFT_CALIBRATION_SEATS ||
      first === second
    ) {
      throw new Error(
        `Draft calibration pairing ${String(index)} must name two different seats from 0 through 7`,
      );
    }
    const ordered: readonly [number, number] = first < second ? [first, second] : [second, first];
    const key = ordered.join('/');
    if (seen.has(key)) throw new Error(`Draft calibration pairing ${key} is duplicated`);
    seen.add(key);
    return ordered;
  });
}

interface ScheduledRun {
  readonly pairing: readonly [number, number];
  readonly seatOrder: 0 | 1;
  readonly draftSeats: readonly [number, number];
  readonly spec: MatchSpec;
}

function schedule(
  seedValue: string,
  code: string,
  decks: readonly BuiltDraftDeck[],
  pairings: readonly (readonly [number, number])[],
  gamesPerSeatOrder: number,
): readonly ScheduledRun[] {
  return pairings.flatMap((pairing) =>
    ([0, 1] as const).map((seatOrder): ScheduledRun => {
      const draftSeats: readonly [number, number] = seatOrder === 0 ? pairing : [pairing[1], pairing[0]];
      const first = decks[draftSeats[0]];
      const second = decks[draftSeats[1]];
      if (first === undefined || second === undefined)
        throw new Error('Draft calibration schedule lost a deck');
      const runSeed = `${seedValue}/pair/${String(pairing[0])}-${String(pairing[1])}/seat-order/${String(seatOrder)}`;
      return {
        pairing,
        seatOrder,
        draftSeats,
        spec: {
          runSeed,
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
          eventType: 'DraftBotCalibration',
          gameTime: '',
        },
      };
    }),
  );
}

type IndexedRelevantCardEvent = z.infer<typeof IndexedRelevantCardEventSchema>;

function numberArraysEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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

/**
 * Return only resolution attempts which the event stream proves completed.
 * A fizzle is emitted after resolution begins, while permanent spells also
 * need both their stack-to-battlefield move and entry event.
 */
export function successfulResolutionEventIndexes(
  events: readonly GameEvent[],
  oid: string,
  kind: CardKind,
): number[] {
  return successfulResolutionLedgerIndexes(
    events.flatMap((event, index) => {
      const relevant = indexedRelevantCardEvent(event, index);
      return relevant === null ? [] : [relevant];
    }),
    oid,
    kind,
  );
}

function relevantCardEventLedger(
  events: readonly GameEvent[],
  orderedDecks: readonly [BuiltDraftDeck, BuiltDraftDeck],
): IndexedRelevantCardEvent[] {
  const physicalOids = new Set<string>();
  let offset = 0;
  for (const deck of orderedDecks) {
    for (const card of deck.evidence.cards) physicalOids.add(objectId(offset + card.deckPosition));
    offset += deck.cards.length;
  }
  return events.flatMap((event, index) => {
    const relevant = indexedRelevantCardEvent(event, index);
    return relevant !== null && physicalOids.has(relevant.oid) ? [relevant] : [];
  });
}

function eventEvidenceFingerprint(
  rawEventCount: number,
  relevantCardEvents: readonly IndexedRelevantCardEvent[],
): string {
  return sha256({ rawEventCount, relevantCardEvents });
}

function physicalEvidence(
  events: readonly IndexedRelevantCardEvent[],
  orderedDecks: readonly [BuiltDraftDeck, BuiltDraftDeck],
): z.infer<typeof CardInstanceGameEvidenceSchema>[] {
  const records: z.infer<typeof CardInstanceGameEvidenceSchema>[] = [];
  let offset = 0;
  for (const gameSeat of [0, 1] as const) {
    const deck = orderedDecks[gameSeat];
    for (const card of deck.evidence.cards) {
      const oid = objectId(offset + card.deckPosition);
      const sourceCard = deck.cards[card.deckPosition];
      if (sourceCard === undefined) throw new Error(`Draft deck lost position ${String(card.deckPosition)}`);
      const drawEventIndexes = events
        .filter((event) => event.type === 'cardDrawn' && event.oid === oid)
        .map((event) => event.index);
      const castEventIndexes = events
        .filter((event) => event.type === 'spellCast' && event.oid === oid)
        .map((event) => event.index);
      const successfulResolutionEventIndexesValue = successfulResolutionLedgerIndexes(
        events,
        oid,
        sourceCard.kind,
      );
      records.push({
        instanceId: card.instanceId,
        cardId: card.cardId,
        draftSeat: deck.seat,
        gameSeat,
        drawn: drawEventIndexes.length > 0,
        cast: castEventIndexes.length > 0,
        resolved: successfulResolutionEventIndexesValue.length > 0,
        drawEventIndexes,
        castEventIndexes,
        successfulResolutionEventIndexes: successfulResolutionEventIndexesValue,
      });
    }
    offset += deck.cards.length;
  }
  return records;
}

function gameEvidence(
  scheduled: ScheduledRun,
  run: MatchRun,
  decks: readonly BuiltDraftDeck[],
): readonly DraftCalibrationGame[] {
  const first = decks[scheduled.draftSeats[0]];
  const second = decks[scheduled.draftSeats[1]];
  if (first === undefined || second === undefined) throw new Error('Draft game lost a deck');
  const orderedDecks: readonly [BuiltDraftDeck, BuiltDraftDeck] = [first, second];
  return run.outcomes.map((outcome, index) => {
    const replay = outcome.log;
    const events = outcome.events;
    if (replay === null) throw new Error(`Draft calibration game ${outcome.seed} returned no replay log`);
    if (events === null)
      throw new Error(`Draft calibration game ${outcome.seed} returned no kernel event log`);
    const expected = run.logs[index];
    if (expected !== replay) throw new Error(`Draft calibration game ${outcome.seed} log ordering drifted`);
    if (events.length > MAX_DRAFT_RAW_EVENTS_PER_GAME) {
      throw new Error(
        `Draft calibration game ${outcome.seed} emitted more than ${String(MAX_DRAFT_RAW_EVENTS_PER_GAME)} events`,
      );
    }
    const relevantCardEvents = relevantCardEventLedger(events, orderedDecks);
    if (relevantCardEvents.length > MAX_DRAFT_RELEVANT_EVENTS_PER_GAME) {
      throw new Error(
        `Draft calibration game ${outcome.seed} emitted more than ${String(MAX_DRAFT_RELEVANT_EVENTS_PER_GAME)} relevant card events`,
      );
    }
    return {
      seed: outcome.seed,
      pairing: [...scheduled.pairing],
      seatOrder: scheduled.seatOrder,
      draftSeats: [...scheduled.draftSeats],
      startingPlayer: outcome.startingPlayer,
      winnerDraftSeat: outcome.winner === null ? null : scheduled.draftSeats[outcome.winner],
      reason: outcome.reason,
      turns: outcome.turns,
      decisions: outcome.decisions,
      trajectoryFingerprint: gameFingerprint(replay),
      replay,
      rawEventCount: events.length,
      relevantCardEventsFingerprint: eventEvidenceFingerprint(events.length, relevantCardEvents),
      relevantCardEvents,
      cardEvents: physicalEvidence(relevantCardEvents, orderedDecks),
    };
  });
}

export interface DraftUncertaintySample {
  readonly trajectory: string;
  readonly won: boolean;
  readonly decided: boolean;
  readonly symmetric: boolean;
}

export type DraftCardUncertainty = z.infer<typeof DraftCardUncertaintySchema>;

/**
 * Estimate strength from independent decided trajectories. Games where both
 * decks contain the card remain in physical-use counts, but are excluded from
 * the strength estimate because treating their two sides as independent would
 * create a false sample-size gain.
 */
export function clusteredDraftUncertainty(
  samples: readonly DraftUncertaintySample[],
  floor: number,
  sideExposures: number,
): DraftCardUncertainty {
  positiveOption('card floor', floor, MAX_DRAFT_CARD_FLOOR);
  if (!Number.isInteger(sideExposures) || sideExposures < 0 || sideExposures !== samples.length) {
    throw new Error('card uncertainty games must equal its physical side exposures');
  }
  const symmetric = new Set(samples.filter((sample) => sample.symmetric).map((sample) => sample.trajectory));
  const decided = samples.filter((sample) => sample.decided && !sample.symmetric);
  const outcomes = new Map<string, boolean>();
  for (const sample of decided) {
    const existing = outcomes.get(sample.trajectory);
    if (existing !== undefined && existing !== sample.won) {
      throw new Error(`trajectory ${sample.trajectory} has conflicting card outcomes`);
    }
    outcomes.set(sample.trajectory, sample.won);
  }
  const distinctWins = [...outcomes.values()].filter(Boolean).length;
  const distinctGames = outcomes.size;
  const underSampled = distinctGames < floor;
  return {
    state: underSampled ? 'underSampled' : 'estimated',
    sampleUnit: 'decidedDistinctTrajectory',
    floor,
    games: sideExposures,
    decidedGames: decided.length,
    distinctGames,
    distinctWins,
    symmetricGames: symmetric.size,
    winRate: underSampled ? null : distinctWins / distinctGames,
    interval95: underSampled ? null : wilsonInterval(distinctWins, distinctGames),
  };
}

interface CardDescriptor {
  readonly cardId: string;
  readonly cardName: string;
}

interface MutableCardTally {
  readonly card: CardDescriptor;
  inclusionCount: number;
  unusedCount: number;
  gamesIncluded: number;
  winsIncluded: number;
  gamesDrawn: number;
  winsWhenDrawn: number;
  gamesCast: number;
  winsWhenCast: number;
  gamesResolved: number;
  winsWhenResolved: number;
  readonly uncertaintySamples: DraftUncertaintySample[];
}

interface CardGameObservation {
  readonly cardId: string;
  readonly draftSeat: number;
  readonly gameSeat: 0 | 1;
  drawn: boolean;
  cast: boolean;
  resolved: boolean;
}

function deriveCardEvidence(
  cards: readonly CardDescriptor[],
  draftSeats: readonly z.infer<typeof DraftSeatEvidenceSchema>[],
  decks: readonly DraftCalibrationDeck[],
  games: readonly DraftCalibrationGame[],
  floor: number,
): z.infer<typeof DraftCardEvidenceSchema>[] {
  const tallies = new Map<string, MutableCardTally>();
  for (const card of cards) {
    tallies.set(card.cardId, {
      card,
      inclusionCount: 0,
      unusedCount: 0,
      gamesIncluded: 0,
      winsIncluded: 0,
      gamesDrawn: 0,
      winsWhenDrawn: 0,
      gamesCast: 0,
      winsWhenCast: 0,
      gamesResolved: 0,
      winsWhenResolved: 0,
      uncertaintySamples: [],
    });
  }

  const included = new Set(
    decks.flatMap((deck) =>
      deck.cards.filter((card) => card.source === 'draftPick').map((card) => card.instanceId),
    ),
  );
  for (const pick of draftSeats.flatMap((draftSeat) => draftSeat.picks)) {
    const tally = tallies.get(pick.cardId);
    if (tally === undefined) throw new Error(`Draft pick ${pick.cardId} is absent from its source set`);
    if (included.has(pick.instanceId)) tally.inclusionCount += 1;
    else tally.unusedCount += 1;
  }

  const cardByInstance = new Map(
    decks.flatMap((deck) => deck.cards.map((card) => [card.instanceId, card] as const)),
  );
  for (const game of games) {
    const observations = new Map<string, CardGameObservation>();
    for (const event of game.cardEvents) {
      const instance = cardByInstance.get(event.instanceId);
      if (instance === undefined || instance.source !== 'draftPick') continue;
      const key = `${String(event.draftSeat)}\u0000${instance.cardId}`;
      const observation = observations.get(key) ?? {
        cardId: instance.cardId,
        draftSeat: event.draftSeat,
        gameSeat: event.gameSeat,
        drawn: false,
        cast: false,
        resolved: false,
      };
      observation.drawn ||= event.drawn;
      observation.cast ||= event.cast;
      observation.resolved ||= event.resolved;
      observations.set(key, observation);
    }
    const observationsByCard = new Map<string, CardGameObservation[]>();
    for (const observation of observations.values()) {
      const group = observationsByCard.get(observation.cardId) ?? [];
      group.push(observation);
      observationsByCard.set(observation.cardId, group);
    }
    for (const cardObservations of observationsByCard.values()) {
      const symmetric = cardObservations.length > 1;
      for (const observation of cardObservations) {
        const tally = tallies.get(observation.cardId);
        if (tally === undefined) continue;
        const won = game.winnerDraftSeat === observation.draftSeat;
        const decided = game.winnerDraftSeat !== null;
        tally.gamesIncluded += 1;
        tally.uncertaintySamples.push({
          trajectory: game.trajectoryFingerprint,
          won,
          decided,
          symmetric,
        });
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
      }
    }
  }

  return [...tallies.values()]
    .sort((left, right) => left.card.cardId.localeCompare(right.card.cardId))
    .map((tally) => ({
      cardId: tally.card.cardId,
      cardName: tally.card.cardName,
      inclusionCount: tally.inclusionCount,
      unusedCount: tally.unusedCount,
      gamesIncluded: tally.gamesIncluded,
      winsIncluded: tally.winsIncluded,
      gamesDrawn: tally.gamesDrawn,
      winsWhenDrawn: tally.winsWhenDrawn,
      gamesCast: tally.gamesCast,
      winsWhenCast: tally.winsWhenCast,
      gamesResolved: tally.gamesResolved,
      winsWhenResolved: tally.winsWhenResolved,
      uncertainty: clusteredDraftUncertainty(tally.uncertaintySamples, floor, tally.gamesIncluded),
    }));
}

export async function runDraftCalibration(
  cards: readonly Card[],
  options: DraftCalibrationOptions,
): Promise<DraftCalibrationArtifact> {
  const gamesPerSeatOrder = positiveOption(
    'games per seat order',
    options.gamesPerSeatOrder ?? DEFAULT_DRAFT_GAMES_PER_SEAT_ORDER,
    MAX_DRAFT_GAMES_PER_SEAT_ORDER,
  );
  const packsPerSeat = positiveOption(
    'packs per seat',
    options.packsPerSeat ?? DEFAULT_DRAFT_PACKS_PER_SEAT,
    MAX_DRAFT_PACKS_PER_SEAT,
  );
  const cardFloor = positiveOption(
    'card floor',
    options.cardFloor ?? DEFAULT_DRAFT_CARD_FLOOR,
    MAX_DRAFT_CARD_FLOOR,
  );
  if (options.workers !== undefined) positiveOption('workers', options.workers, MAX_DRAFT_WORKERS);
  const pairings = resolvePairings(options.pairings);
  assertInput(cards, options);
  const code = cards[0]?.set.code;
  if (code === undefined) throw new Error('Draft calibration set has no code');

  const draft = runDraft(cards, {
    seed: `${options.seed}/draft`,
    seats: DRAFT_CALIBRATION_SEATS,
    packs: packsPerSeat,
    recipe: options.collation.recipe as BoosterRecipe,
  });
  const decks = draft.seats.map((draftSeat) => {
    try {
      return buildDraftDeck(draft, draftSeat.seat);
    } catch (error: unknown) {
      throw new Error(
        `Draft calibration seat ${String(draftSeat.seat)}: ${String(error instanceof Error ? error.message : error)}`,
      );
    }
  });
  const scheduled = schedule(options.seed, code, decks, pairings, gamesPerSeatOrder);
  const runs = await withSimPool(
    { ...(options.workers === undefined ? {} : { workers: options.workers }) },
    (pool) => pool.runMatches(scheduled.map((entry) => entry.spec)),
  );
  if (runs.length !== scheduled.length)
    throw new Error('Draft calibration simulation dropped a scheduled run');
  const games = scheduled.flatMap((entry, index) => {
    const run = runs[index];
    if (run === undefined) throw new Error(`Draft calibration simulation dropped run ${String(index)}`);
    return gameEvidence(entry, run, decks);
  });

  const identities = setCardIdentities(cards);
  const draftSeats = draft.seats.map((draftSeat) => ({
    seat: draftSeat.seat,
    picks: draftSeat.picks.map(pickEvidence),
  }));
  const deckEvidence = decks.map((deck) => deck.evidence);
  const artifact: DraftCalibrationArtifact = {
    version: DRAFT_CALIBRATION_ARTIFACT_VERSION,
    producedBy: DRAFT_CALIBRATION_PRODUCER,
    scope: { format: 'Draft', automated: true, humanEvidence: false, sealedEvidence: false },
    seed: options.seed,
    set: {
      code,
      cards: cards.length,
      fingerprint: setFingerprintFromIdentities(identities),
      cardIdentities: identities,
    },
    collation: {
      version: DRAFT_COLLATION_VERSION,
      recipe: options.collation.recipe.map((slot) => ({ ...slot })),
    },
    draft: {
      packsPerSeat,
      seats: draftSeats,
    },
    decks: deckEvidence,
    games,
    summary: {
      games: games.length,
      distinctGames: new Set(games.map((game) => game.trajectoryFingerprint)).size,
      pairings: pairings.length,
      seatOrders: 2,
      gamesPerSeatOrder,
      cardFloor,
    },
    cards: deriveCardEvidence(
      cards.map((card) => ({ cardId: card.id, cardName: card.name })),
      draftSeats,
      deckEvidence,
      games,
      cardFloor,
    ),
  };
  return readDraftCalibrationArtifact(artifact, 'generated Draft calibration artifact');
}

export interface DraftCalibrationCliArgs {
  readonly setPath: string;
  readonly collationPath: string;
  readonly seed: string;
  readonly outputPath: string;
  readonly workers?: number | undefined;
  readonly gamesPerSeatOrder: number;
  readonly packsPerSeat: number;
  readonly cardFloor: number;
}

function integerArgument(flag: string, value: string | undefined, maximum: number): number {
  if (value === undefined) throw new Error(`${flag} needs a value`);
  const parsed = Number(value);
  return positiveOption(flag, parsed, maximum);
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

export function parseDraftCalibrationArgs(args: readonly string[]): DraftCalibrationCliArgs {
  const values = new Map<string, string>();
  const known = new Set([
    '--set',
    '--collation',
    '--seed',
    '--out',
    '--workers',
    '--games-per-seat-order',
    '--packs-per-seat',
    '--card-floor',
  ]);
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
    if (value === undefined || value.length === 0) throw new Error(`Draft calibration CLI requires ${flag}`);
    if (value.length > maximum) {
      throw new Error(`${flag} must contain at most ${String(maximum)} characters`);
    }
    return value;
  };
  const workers = values.has('--workers')
    ? integerArgument('--workers', values.get('--workers'), MAX_DRAFT_WORKERS)
    : undefined;
  const setPath = required('--set', MAX_DRAFT_PATH_LENGTH);
  const collationPath = required('--collation', MAX_DRAFT_PATH_LENGTH);
  const seedValue = required('--seed', MAX_DRAFT_SEED_LENGTH);
  const outputPath = required('--out', MAX_DRAFT_PATH_LENGTH);
  if (comparablePath(outputPath) === comparablePath(setPath)) {
    throw new Error('--out must differ from --set so calibration cannot overwrite its input');
  }
  if (comparablePath(outputPath) === comparablePath(collationPath)) {
    throw new Error('--out must differ from --collation so calibration cannot overwrite its input');
  }
  return {
    setPath,
    collationPath,
    seed: seedValue,
    outputPath,
    ...(workers === undefined ? {} : { workers }),
    gamesPerSeatOrder: values.has('--games-per-seat-order')
      ? integerArgument(
          '--games-per-seat-order',
          values.get('--games-per-seat-order'),
          MAX_DRAFT_GAMES_PER_SEAT_ORDER,
        )
      : DEFAULT_DRAFT_GAMES_PER_SEAT_ORDER,
    packsPerSeat: values.has('--packs-per-seat')
      ? integerArgument('--packs-per-seat', values.get('--packs-per-seat'), MAX_DRAFT_PACKS_PER_SEAT)
      : DEFAULT_DRAFT_PACKS_PER_SEAT,
    cardFloor: values.has('--card-floor')
      ? integerArgument('--card-floor', values.get('--card-floor'), MAX_DRAFT_CARD_FLOOR)
      : DEFAULT_DRAFT_CARD_FLOOR,
  };
}

function readJson(path: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error: unknown) {
    throw new Error(
      `${label} ${path} could not be read as JSON: ${String(error instanceof Error ? error.message : error)}`,
    );
  }
}

function readExecutableSet(path: string): readonly Card[] {
  const value = readJson(path, 'executable set');
  const rawCards = (value as { cards?: unknown }).cards;
  if (!Array.isArray(rawCards)) throw new Error(`executable set ${path} needs a cards array`);
  if (rawCards.length > MAX_DRAFT_SET_SIZE) {
    throw new Error(`executable set ${path} must contain at most ${String(MAX_DRAFT_SET_SIZE)} cards`);
  }
  return rawCards.map((card, index) => {
    try {
      return parseCard(card);
    } catch (error: unknown) {
      throw new Error(
        `executable set ${path} card ${String(index)} is invalid: ${String(error instanceof Error ? error.message : error)}`,
      );
    }
  });
}

export function writeDraftCalibrationArtifactAtomic(
  outputPath: string,
  artifact: DraftCalibrationArtifact,
): void {
  if (outputPath.length === 0 || outputPath.length > MAX_DRAFT_PATH_LENGTH) {
    throw new Error(`Draft artifact output path must contain 1-${String(MAX_DRAFT_PATH_LENGTH)} characters`);
  }
  const checked = readDraftCalibrationArtifact(artifact, 'Draft artifact output');
  const temporaryPath = join(
    dirname(outputPath),
    `.${basename(outputPath)}.${String(process.pid)}.${randomUUID()}.tmp`,
  );
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(checked, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    renameSync(temporaryPath, outputPath);
  } catch (error: unknown) {
    let cleanupFailure: unknown;
    try {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    } catch (cleanupError: unknown) {
      cleanupFailure = cleanupError;
    }
    const cleanupMessage =
      cleanupFailure === undefined
        ? ''
        : `; temporary cleanup failed for ${temporaryPath}: ${cleanupFailure instanceof Error ? cleanupFailure.message : String(cleanupFailure)}`;
    throw new Error(
      `atomic Draft artifact write to ${outputPath} failed: ${error instanceof Error ? error.message : String(error)}${cleanupMessage}`,
    );
  }
}

export async function runDraftCalibrationCli(args: readonly string[]): Promise<void> {
  const parsed = parseDraftCalibrationArgs(args);
  const cards = readExecutableSet(parsed.setPath);
  const collation = parseDraftCollation(
    readJson(parsed.collationPath, 'Draft collation'),
    parsed.collationPath,
  );
  const artifact = await runDraftCalibration(cards, {
    seed: parsed.seed,
    collation,
    gamesPerSeatOrder: parsed.gamesPerSeatOrder,
    packsPerSeat: parsed.packsPerSeat,
    cardFloor: parsed.cardFloor,
    ...(parsed.workers === undefined ? {} : { workers: parsed.workers }),
  });
  writeDraftCalibrationArtifactAtomic(parsed.outputPath, artifact);
}
