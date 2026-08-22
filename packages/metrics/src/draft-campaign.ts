/**
 * Deterministic multi-pod Draft evidence.
 *
 * Every pod is retained as a complete native-Draft artifact and is parsed at
 * the campaign boundary, so the aggregate never turns a digest or a stale
 * headline into evidence. Card estimates are observational drawn-vs-not-drawn
 * associations within the same pod, focal deck, opponent deck, and play/draw
 * role. They are useful balance leads, not causal estimates of isolated card
 * power.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import type { Card } from '@mtg/dsl';
import { canonicalJson, parseCard } from '@mtg/dsl';
import {
  DEFAULT_DRAFT_CARD_FLOOR,
  DEFAULT_DRAFT_GAMES_PER_SEAT_ORDER,
  DEFAULT_DRAFT_PACKS_PER_SEAT,
  DRAFT_CALIBRATION_ARTIFACT_VERSION,
  DRAFT_CALIBRATION_PRODUCER,
  DRAFT_CALIBRATION_SEATS,
  DraftCalibrationArtifactSchema,
  DraftCollationSchema,
  MAX_DRAFT_CARD_FLOOR,
  MAX_DRAFT_GAMES_PER_SEAT_ORDER,
  MAX_DRAFT_PACKS_PER_SEAT,
  MAX_DRAFT_PAIRINGS,
  MAX_DRAFT_PATH_LENGTH,
  MAX_DRAFT_SEED_LENGTH,
  MAX_DRAFT_SET_SIZE,
  MAX_DRAFT_WORKERS,
  readDraftCalibrationArtifact,
  runDraftCalibration,
} from './draft-calibration';
import type { DraftCalibrationArtifact, DraftCalibrationOptions, DraftCollation } from './draft-calibration';

export const DRAFT_CALIBRATION_CAMPAIGN_VERSION = 'native-draft-calibration-campaign-v1';
export const DRAFT_CALIBRATION_CAMPAIGN_PRODUCER = '@mtg/metrics/native-draft-calibration-campaign-v1';
export const DEFAULT_DRAFT_CAMPAIGN_PODS = 3;
export const MAX_DRAFT_CAMPAIGN_PODS = 16;
export const MAX_DRAFT_CAMPAIGN_SEED_LENGTH = MAX_DRAFT_SEED_LENGTH - '/pod/15'.length;
export const MAX_DRAFT_CAMPAIGN_STRENGTH_FLOOR = 400_000;
export const DEFAULT_DRAFT_CAMPAIGN_STRENGTH_FLOOR = {
  minimumContrastingStrata: 4,
  minimumDrawnGames: 50,
  minimumNotDrawnGames: 50,
} as const;

const MAX_CAMPAIGN_COUNT = 1_000_000;
const MAX_CAMPAIGN_INPUT_BYTES = 16 * 1024 * 1024;
const MAX_ASSOCIATION_SAMPLES = MAX_CAMPAIGN_COUNT;
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const nonnegative = z.number().int().min(0).max(MAX_CAMPAIGN_COUNT);
const positive = z.number().int().positive();

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function boundedPositive(name: string, value: number, maximum: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got ${String(value)}`);
  }
  if (value > maximum) {
    throw new Error(`${name} must be at most ${String(maximum)}, got ${String(value)}`);
  }
  return value;
}

function campaignPodCount(name: string, value: number): number {
  const pods = boundedPositive(name, value, MAX_DRAFT_CAMPAIGN_PODS);
  if (pods < 2) throw new Error(`${name} must be at least 2, got ${String(value)}`);
  return pods;
}

export const DraftCampaignStrengthFloorSchema = z
  .object({
    minimumContrastingStrata: positive.max(MAX_DRAFT_CAMPAIGN_STRENGTH_FLOOR),
    minimumDrawnGames: positive.max(MAX_DRAFT_CAMPAIGN_STRENGTH_FLOOR),
    minimumNotDrawnGames: positive.max(MAX_DRAFT_CAMPAIGN_STRENGTH_FLOOR),
  })
  .strict();

export type DraftCampaignStrengthFloor = z.infer<typeof DraftCampaignStrengthFloorSchema>;

function checkedStrengthFloor(input: DraftCampaignStrengthFloor): DraftCampaignStrengthFloor {
  return {
    minimumContrastingStrata: boundedPositive(
      'minimum contrasting strata',
      input.minimumContrastingStrata,
      MAX_DRAFT_CAMPAIGN_STRENGTH_FLOOR,
    ),
    minimumDrawnGames: boundedPositive(
      'minimum drawn games',
      input.minimumDrawnGames,
      MAX_DRAFT_CAMPAIGN_STRENGTH_FLOOR,
    ),
    minimumNotDrawnGames: boundedPositive(
      'minimum not-drawn games',
      input.minimumNotDrawnGames,
      MAX_DRAFT_CAMPAIGN_STRENGTH_FLOOR,
    ),
  };
}

const DraftAssociationSampleSchema = z
  .object({
    stratum: z
      .string()
      .min(1)
      .max(MAX_DRAFT_SEED_LENGTH + 128),
    trajectory: z.string().min(1).max(65_536),
    drawn: z.boolean(),
    won: z.boolean(),
    symmetric: z.boolean(),
  })
  .strict();

export type DraftAssociationSample = z.infer<typeof DraftAssociationSampleSchema>;

const DraftCardStrengthSchema = z
  .object({
    estimator: z.literal('stratified-within-deck-opponent-play-draw-association-v1'),
    claim: z.literal('observationalAssociationNotCausalCardPower'),
    intervalMethod: z.literal('fixedEffectBeta11SmoothedNormal95'),
    state: z.enum(['underSampled', 'estimated']),
    reason: z
      .enum([
        'notOpened',
        'notIncluded',
        'noContrastingStrata',
        'belowContrastingStrataFloor',
        'belowDrawnGameFloor',
        'belowNotDrawnGameFloor',
      ])
      .nullable(),
    sampleUnit: z.literal('distinctDecidedGameWithinPodDeckOpponentPlayDrawStratum'),
    floor: DraftCampaignStrengthFloorSchema,
    contrastingStrata: nonnegative,
    contrastingDrawnGames: nonnegative,
    contrastingNotDrawnGames: nonnegative,
    decidedDrawnGames: nonnegative,
    decidedNotDrawnGames: nonnegative,
    duplicateTrajectoriesExcluded: nonnegative,
    conflictingTrajectoriesExcluded: nonnegative,
    symmetricGamesExcluded: nonnegative,
    effectiveWeight: z.number().min(0).max(MAX_CAMPAIGN_COUNT),
    estimate: z.number().min(-1).max(1).nullable(),
    standardError: z.number().min(0).max(2).nullable(),
    interval95: z
      .object({ low: z.number().min(-1).max(1), high: z.number().min(-1).max(1) })
      .strict()
      .nullable(),
  })
  .strict();

export type DraftCardStrength = z.infer<typeof DraftCardStrengthSchema>;

interface AssociationRecord {
  readonly drawn: boolean;
  readonly won: boolean;
}

interface ContrastingStratum {
  readonly drawnGames: number;
  readonly drawnWins: number;
  readonly notDrawnGames: number;
  readonly notDrawnWins: number;
}

function underSampledAssociation(
  floor: DraftCampaignStrengthFloor,
  reason: Exclude<DraftCardStrength['reason'], null>,
  counts: Omit<
    DraftCardStrength,
    | 'estimator'
    | 'claim'
    | 'intervalMethod'
    | 'state'
    | 'reason'
    | 'sampleUnit'
    | 'floor'
    | 'estimate'
    | 'standardError'
    | 'interval95'
  >,
): DraftCardStrength {
  return {
    estimator: 'stratified-within-deck-opponent-play-draw-association-v1',
    claim: 'observationalAssociationNotCausalCardPower',
    intervalMethod: 'fixedEffectBeta11SmoothedNormal95',
    state: 'underSampled',
    reason,
    sampleUnit: 'distinctDecidedGameWithinPodDeckOpponentPlayDrawStratum',
    floor,
    ...counts,
    estimate: null,
    standardError: null,
    interval95: null,
  };
}

/**
 * A fixed-effect association over strata which hold pod, focal deck, opponent
 * deck, and play/draw role constant. Beta(1,1) smoothing prevents a one-game
 * 1-0 stratum from claiming zero variance. Symmetric card-present games are
 * excluded so a single game cannot provide two opposed observations for the
 * same card.
 */
export function stratifiedDraftAssociation(
  input: readonly DraftAssociationSample[],
  floorInput: DraftCampaignStrengthFloor,
): DraftCardStrength {
  const parsedSamples = z.array(DraftAssociationSampleSchema).max(MAX_ASSOCIATION_SAMPLES).parse(input);
  const floor = checkedStrengthFloor(floorInput);
  const byStratum = new Map<string, Map<string, AssociationRecord>>();
  const conflicted = new Map<string, Set<string>>();
  let duplicateTrajectoriesExcluded = 0;
  let conflictingTrajectoriesExcluded = 0;
  let symmetricGamesExcluded = 0;

  for (const sample of parsedSamples) {
    if (sample.symmetric) {
      symmetricGamesExcluded += 1;
      continue;
    }
    const stratum = byStratum.get(sample.stratum) ?? new Map<string, AssociationRecord>();
    byStratum.set(sample.stratum, stratum);
    const rejected = conflicted.get(sample.stratum) ?? new Set<string>();
    conflicted.set(sample.stratum, rejected);
    if (rejected.has(sample.trajectory)) {
      conflictingTrajectoriesExcluded += 1;
      continue;
    }
    const existing = stratum.get(sample.trajectory);
    if (existing === undefined) {
      stratum.set(sample.trajectory, { drawn: sample.drawn, won: sample.won });
    } else if (existing.drawn === sample.drawn && existing.won === sample.won) {
      duplicateTrajectoriesExcluded += 1;
    } else {
      stratum.delete(sample.trajectory);
      rejected.add(sample.trajectory);
      conflictingTrajectoriesExcluded += 2;
    }
  }

  let decidedDrawnGames = 0;
  let decidedNotDrawnGames = 0;
  const contrasting: ContrastingStratum[] = [];
  for (const records of byStratum.values()) {
    const values = [...records.values()];
    const drawn = values.filter((sample) => sample.drawn);
    const notDrawn = values.filter((sample) => !sample.drawn);
    decidedDrawnGames += drawn.length;
    decidedNotDrawnGames += notDrawn.length;
    if (drawn.length > 0 && notDrawn.length > 0) {
      contrasting.push({
        drawnGames: drawn.length,
        drawnWins: drawn.filter((sample) => sample.won).length,
        notDrawnGames: notDrawn.length,
        notDrawnWins: notDrawn.filter((sample) => sample.won).length,
      });
    }
  }

  const contrastingDrawnGames = contrasting.reduce((sum, stratum) => sum + stratum.drawnGames, 0);
  const contrastingNotDrawnGames = contrasting.reduce((sum, stratum) => sum + stratum.notDrawnGames, 0);
  const common = {
    contrastingStrata: contrasting.length,
    contrastingDrawnGames,
    contrastingNotDrawnGames,
    decidedDrawnGames,
    decidedNotDrawnGames,
    duplicateTrajectoriesExcluded,
    conflictingTrajectoriesExcluded,
    symmetricGamesExcluded,
    effectiveWeight: contrasting.reduce(
      (sum, stratum) =>
        sum + (stratum.drawnGames * stratum.notDrawnGames) / (stratum.drawnGames + stratum.notDrawnGames),
      0,
    ),
  };
  if (contrasting.length === 0) return underSampledAssociation(floor, 'noContrastingStrata', common);
  if (contrasting.length < floor.minimumContrastingStrata) {
    return underSampledAssociation(floor, 'belowContrastingStrataFloor', common);
  }
  if (contrastingDrawnGames < floor.minimumDrawnGames) {
    return underSampledAssociation(floor, 'belowDrawnGameFloor', common);
  }
  if (contrastingNotDrawnGames < floor.minimumNotDrawnGames) {
    return underSampledAssociation(floor, 'belowNotDrawnGameFloor', common);
  }

  let weightedEffect = 0;
  let weightedVariance = 0;
  for (const stratum of contrasting) {
    const weight =
      (stratum.drawnGames * stratum.notDrawnGames) / (stratum.drawnGames + stratum.notDrawnGames);
    const drawnRate = (stratum.drawnWins + 1) / (stratum.drawnGames + 2);
    const notDrawnRate = (stratum.notDrawnWins + 1) / (stratum.notDrawnGames + 2);
    const variance =
      (drawnRate * (1 - drawnRate)) / (stratum.drawnGames + 3) +
      (notDrawnRate * (1 - notDrawnRate)) / (stratum.notDrawnGames + 3);
    weightedEffect += weight * (drawnRate - notDrawnRate);
    weightedVariance += weight * weight * variance;
  }
  const estimate = weightedEffect / common.effectiveWeight;
  const standardError = Math.sqrt(weightedVariance) / common.effectiveWeight;
  return {
    estimator: 'stratified-within-deck-opponent-play-draw-association-v1',
    claim: 'observationalAssociationNotCausalCardPower',
    intervalMethod: 'fixedEffectBeta11SmoothedNormal95',
    state: 'estimated',
    reason: null,
    sampleUnit: 'distinctDecidedGameWithinPodDeckOpponentPlayDrawStratum',
    floor,
    ...common,
    estimate,
    standardError,
    interval95: {
      low: Math.max(-1, estimate - 1.96 * standardError),
      high: Math.min(1, estimate + 1.96 * standardError),
    },
  };
}

const CampaignCardEvidenceSchema = z
  .object({
    cardId: z.string().min(1),
    cardName: z.string().min(1),
    podsOpened: nonnegative,
    podsIncluded: nonnegative,
    openedCopies: nonnegative,
    draftedCopies: nonnegative,
    includedCopies: nonnegative,
    unusedCopies: nonnegative,
    gamesIncluded: nonnegative,
    winsIncluded: nonnegative,
    gamesNotDrawn: nonnegative,
    winsWhenNotDrawn: nonnegative,
    gamesDrawn: nonnegative,
    winsWhenDrawn: nonnegative,
    gamesCast: nonnegative,
    winsWhenCast: nonnegative,
    gamesResolved: nonnegative,
    winsWhenResolved: nonnegative,
    strength: DraftCardStrengthSchema,
  })
  .strict();

const CampaignPodSchema = z
  .object({
    pod: z
      .number()
      .int()
      .min(0)
      .max(MAX_DRAFT_CAMPAIGN_PODS - 1),
    fingerprint: digest,
    artifact: DraftCalibrationArtifactSchema,
  })
  .strict();

const CampaignStudySchema = z
  .object({
    fingerprint: digest,
    setFingerprint: digest,
    collationFingerprint: digest,
    childArtifactVersion: z.literal(DRAFT_CALIBRATION_ARTIFACT_VERSION),
    childProducer: z.literal(DRAFT_CALIBRATION_PRODUCER),
    packsPerSeat: positive.max(MAX_DRAFT_PACKS_PER_SEAT),
    pairings: z
      .array(
        z.tuple([
          z
            .number()
            .int()
            .min(0)
            .max(DRAFT_CALIBRATION_SEATS - 1),
          z
            .number()
            .int()
            .min(0)
            .max(DRAFT_CALIBRATION_SEATS - 1),
        ]),
      )
      .min(1)
      .max(MAX_DRAFT_PAIRINGS),
    seatOrders: z.literal(2),
    gamesPerSeatOrder: positive.max(MAX_DRAFT_GAMES_PER_SEAT_ORDER),
    childCardFloor: positive.max(MAX_DRAFT_CARD_FLOOR),
    strengthFloor: DraftCampaignStrengthFloorSchema,
  })
  .strict();

const CampaignShapeSchema = z
  .object({
    version: z.literal(DRAFT_CALIBRATION_CAMPAIGN_VERSION),
    producedBy: z.literal(DRAFT_CALIBRATION_CAMPAIGN_PRODUCER),
    scope: z
      .object({
        format: z.literal('Draft'),
        automated: z.literal(true),
        humanEvidence: z.literal(false),
        sealedEvidence: z.literal(false),
        claim: z.literal('observationalAssociationNotCausalCardPower'),
      })
      .strict(),
    seed: z.string().min(1).max(MAX_DRAFT_CAMPAIGN_SEED_LENGTH),
    set: z
      .object({
        code: z.string().min(1).max(MAX_DRAFT_PATH_LENGTH),
        cards: positive.max(MAX_DRAFT_SET_SIZE),
        fingerprint: digest,
      })
      .strict(),
    collation: DraftCollationSchema,
    collationFingerprint: digest,
    study: CampaignStudySchema,
    pods: z.array(CampaignPodSchema).min(2).max(MAX_DRAFT_CAMPAIGN_PODS),
    summary: z
      .object({
        pods: positive.max(MAX_DRAFT_CAMPAIGN_PODS),
        games: nonnegative,
        decidedGames: nonnegative,
        distinctTrajectories: nonnegative,
        openedCards: nonnegative.max(MAX_DRAFT_SET_SIZE),
        includedCards: nonnegative.max(MAX_DRAFT_SET_SIZE),
        estimatedCards: nonnegative.max(MAX_DRAFT_SET_SIZE),
        underSampledCards: nonnegative.max(MAX_DRAFT_SET_SIZE),
      })
      .strict(),
    cards: z.array(CampaignCardEvidenceSchema).max(MAX_DRAFT_SET_SIZE),
  })
  .strict();

export type DraftCalibrationCampaign = z.infer<typeof CampaignShapeSchema>;

function childPairings(child: DraftCalibrationArtifact): readonly (readonly [number, number])[] {
  const pairs = new Map<string, readonly [number, number]>();
  for (const game of child.games) pairs.set(game.pairing.join('/'), game.pairing);
  return [...pairs.values()].sort((left, right) => left[0] - right[0] || left[1] - right[1]);
}

interface CampaignCardTally {
  readonly cardId: string;
  readonly cardName: string;
  podsOpened: number;
  podsIncluded: number;
  openedCopies: number;
  includedCopies: number;
  unusedCopies: number;
  gamesIncluded: number;
  winsIncluded: number;
  gamesDrawn: number;
  winsWhenDrawn: number;
  gamesCast: number;
  winsWhenCast: number;
  gamesResolved: number;
  winsWhenResolved: number;
  readonly samples: DraftAssociationSample[];
}

function ensureSameStudy(children: readonly DraftCalibrationArtifact[]): {
  readonly set: DraftCalibrationArtifact['set'];
  readonly collation: DraftCollation;
  readonly pairings: readonly (readonly [number, number])[];
  readonly packsPerSeat: number;
  readonly gamesPerSeatOrder: number;
  readonly childCardFloor: number;
} {
  const first = children[0];
  if (first === undefined) throw new Error('Draft campaign needs at least two child pods');
  const pairings = childPairings(first);
  for (const [index, child] of children.entries()) {
    if (
      child.set.fingerprint !== first.set.fingerprint ||
      child.set.code !== first.set.code ||
      child.set.cards !== first.set.cards ||
      canonicalJson(child.set.cardIdentities) !== canonicalJson(first.set.cardIdentities)
    ) {
      throw new Error(`Draft campaign child ${String(index)} belongs to a mixed set`);
    }
    if (canonicalJson(child.collation) !== canonicalJson(first.collation)) {
      throw new Error(`Draft campaign child ${String(index)} uses mixed collation`);
    }
    if (
      child.draft.packsPerSeat !== first.draft.packsPerSeat ||
      child.summary.gamesPerSeatOrder !== first.summary.gamesPerSeatOrder ||
      child.summary.cardFloor !== first.summary.cardFloor ||
      canonicalJson(childPairings(child)) !== canonicalJson(pairings)
    ) {
      throw new Error(`Draft campaign child ${String(index)} uses a mixed study design`);
    }
  }
  return {
    set: first.set,
    collation: first.collation,
    pairings,
    packsPerSeat: first.draft.packsPerSeat,
    gamesPerSeatOrder: first.summary.gamesPerSeatOrder,
    childCardFloor: first.summary.cardFloor,
  };
}

function deriveCampaign(
  children: readonly DraftCalibrationArtifact[],
  seedValue: string,
  floor: DraftCampaignStrengthFloor,
): DraftCalibrationCampaign {
  if (children.length < 2 || children.length > MAX_DRAFT_CAMPAIGN_PODS) {
    throw new Error(`Draft campaign pods must contain 2-${String(MAX_DRAFT_CAMPAIGN_PODS)} children`);
  }
  if (seedValue.trim().length === 0 || seedValue.length > MAX_DRAFT_CAMPAIGN_SEED_LENGTH) {
    throw new Error(
      `Draft campaign seed must contain 1-${String(MAX_DRAFT_CAMPAIGN_SEED_LENGTH)} characters`,
    );
  }
  const checkedFloor = checkedStrengthFloor(floor);
  const fingerprints = children.map((child) => sha256(child));
  if (new Set(fingerprints).size !== fingerprints.length) {
    throw new Error('Draft campaign child artifacts must be unique');
  }
  for (const [pod, child] of children.entries()) {
    const expectedSeed = `${seedValue}/pod/${String(pod)}`;
    if (child.seed !== expectedSeed) {
      throw new Error(`Draft campaign child ${String(pod)} seed must be ${expectedSeed}, got ${child.seed}`);
    }
  }
  const common = ensureSameStudy(children);
  const tallies = new Map<string, CampaignCardTally>();
  for (const identity of common.set.cardIdentities) {
    tallies.set(identity.cardId, {
      cardId: identity.cardId,
      cardName: identity.cardName,
      podsOpened: 0,
      podsIncluded: 0,
      openedCopies: 0,
      includedCopies: 0,
      unusedCopies: 0,
      gamesIncluded: 0,
      winsIncluded: 0,
      gamesDrawn: 0,
      winsWhenDrawn: 0,
      gamesCast: 0,
      winsWhenCast: 0,
      gamesResolved: 0,
      winsWhenResolved: 0,
      samples: [],
    });
  }

  for (const [pod, child] of children.entries()) {
    for (const card of child.cards) {
      const tally = tallies.get(card.cardId);
      if (tally === undefined) throw new Error(`Draft campaign lost set card ${card.cardId}`);
      const opened = card.inclusionCount + card.unusedCount;
      if (opened > 0) tally.podsOpened += 1;
      if (card.inclusionCount > 0) tally.podsIncluded += 1;
      tally.openedCopies += opened;
      tally.includedCopies += card.inclusionCount;
      tally.unusedCopies += card.unusedCount;
      tally.gamesIncluded += card.gamesIncluded;
      tally.winsIncluded += card.winsIncluded;
      tally.gamesDrawn += card.gamesDrawn;
      tally.winsWhenDrawn += card.winsWhenDrawn;
      tally.gamesCast += card.gamesCast;
      tally.winsWhenCast += card.winsWhenCast;
      tally.gamesResolved += card.gamesResolved;
      tally.winsWhenResolved += card.winsWhenResolved;
    }

    const instanceCard = new Map(
      child.decks.flatMap((deck) => deck.cards.map((card) => [card.instanceId, card] as const)),
    );
    const cardsBySeat = new Map(
      child.decks.map(
        (deck) =>
          [
            deck.seat,
            new Set(deck.cards.filter((card) => card.source === 'draftPick').map((card) => card.cardId)),
          ] as const,
      ),
    );
    for (const game of child.games) {
      if (game.winnerDraftSeat === null) continue;
      const drawn = new Set<string>();
      for (const event of game.cardEvents) {
        const card = instanceCard.get(event.instanceId);
        if (card?.source === 'draftPick' && event.drawn) {
          drawn.add(`${String(event.draftSeat)}\u0000${card.cardId}`);
        }
      }
      for (const gameSeat of [0, 1] as const) {
        const focalSeat = game.draftSeats[gameSeat];
        const opponentSeat = game.draftSeats[gameSeat === 0 ? 1 : 0];
        const focalCards = cardsBySeat.get(focalSeat);
        const opponentCards = cardsBySeat.get(opponentSeat);
        if (focalCards === undefined || opponentCards === undefined) {
          throw new Error('Draft campaign game lost a deck stratum');
        }
        for (const cardId of focalCards) {
          const tally = tallies.get(cardId);
          if (tally === undefined) throw new Error(`Draft campaign lost included card ${cardId}`);
          tally.samples.push({
            stratum:
              `pod/${String(pod)}/deck/${String(focalSeat)}/opponent/${String(opponentSeat)}` +
              `/on-play/${String(game.startingPlayer === gameSeat)}`,
            trajectory: game.trajectoryFingerprint,
            drawn: drawn.has(`${String(focalSeat)}\u0000${cardId}`),
            won: game.winnerDraftSeat === focalSeat,
            symmetric: opponentCards.has(cardId),
          });
        }
      }
    }
  }

  const cards = [...tallies.values()]
    .sort((left, right) => left.cardId.localeCompare(right.cardId))
    .map((tally) => {
      let strength = stratifiedDraftAssociation(tally.samples, checkedFloor);
      const strengthCounts = {
        contrastingStrata: strength.contrastingStrata,
        contrastingDrawnGames: strength.contrastingDrawnGames,
        contrastingNotDrawnGames: strength.contrastingNotDrawnGames,
        decidedDrawnGames: strength.decidedDrawnGames,
        decidedNotDrawnGames: strength.decidedNotDrawnGames,
        duplicateTrajectoriesExcluded: strength.duplicateTrajectoriesExcluded,
        conflictingTrajectoriesExcluded: strength.conflictingTrajectoriesExcluded,
        symmetricGamesExcluded: strength.symmetricGamesExcluded,
        effectiveWeight: strength.effectiveWeight,
      };
      if (tally.openedCopies === 0) {
        strength = underSampledAssociation(checkedFloor, 'notOpened', strengthCounts);
      } else if (tally.includedCopies === 0) {
        strength = underSampledAssociation(checkedFloor, 'notIncluded', strengthCounts);
      }
      return {
        cardId: tally.cardId,
        cardName: tally.cardName,
        podsOpened: tally.podsOpened,
        podsIncluded: tally.podsIncluded,
        openedCopies: tally.openedCopies,
        draftedCopies: tally.openedCopies,
        includedCopies: tally.includedCopies,
        unusedCopies: tally.unusedCopies,
        gamesIncluded: tally.gamesIncluded,
        winsIncluded: tally.winsIncluded,
        gamesNotDrawn: tally.gamesIncluded - tally.gamesDrawn,
        winsWhenNotDrawn: tally.winsIncluded - tally.winsWhenDrawn,
        gamesDrawn: tally.gamesDrawn,
        winsWhenDrawn: tally.winsWhenDrawn,
        gamesCast: tally.gamesCast,
        winsWhenCast: tally.winsWhenCast,
        gamesResolved: tally.gamesResolved,
        winsWhenResolved: tally.winsWhenResolved,
        strength,
      };
    });

  const collation = {
    version: common.collation.version,
    recipe: common.collation.recipe.map((slot) => ({ ...slot })),
  };
  const collationFingerprint = sha256(collation);
  const studyWithoutFingerprint = {
    setFingerprint: common.set.fingerprint,
    collationFingerprint,
    childArtifactVersion: DRAFT_CALIBRATION_ARTIFACT_VERSION,
    childProducer: DRAFT_CALIBRATION_PRODUCER,
    packsPerSeat: common.packsPerSeat,
    pairings: common.pairings.map((pairing) => [...pairing] as [number, number]),
    seatOrders: 2 as const,
    gamesPerSeatOrder: common.gamesPerSeatOrder,
    childCardFloor: common.childCardFloor,
    strengthFloor: checkedFloor,
  } as const;
  const games = children.flatMap((child) => child.games);
  return {
    version: DRAFT_CALIBRATION_CAMPAIGN_VERSION,
    producedBy: DRAFT_CALIBRATION_CAMPAIGN_PRODUCER,
    scope: {
      format: 'Draft',
      automated: true,
      humanEvidence: false,
      sealedEvidence: false,
      claim: 'observationalAssociationNotCausalCardPower',
    },
    seed: seedValue,
    set: {
      code: common.set.code,
      cards: common.set.cards,
      fingerprint: common.set.fingerprint,
    },
    collation,
    collationFingerprint,
    study: { fingerprint: sha256(studyWithoutFingerprint), ...studyWithoutFingerprint },
    pods: children.map((artifact, pod) => ({ pod, fingerprint: fingerprints[pod] as string, artifact })),
    summary: {
      pods: children.length,
      games: games.length,
      decidedGames: games.filter((game) => game.winnerDraftSeat !== null).length,
      distinctTrajectories: new Set(games.map((game) => game.trajectoryFingerprint)).size,
      openedCards: cards.filter((card) => card.openedCopies > 0).length,
      includedCards: cards.filter((card) => card.includedCopies > 0).length,
      estimatedCards: cards.filter((card) => card.strength.state === 'estimated').length,
      underSampledCards: cards.filter((card) => card.strength.state === 'underSampled').length,
    },
    cards,
  };
}

export const DraftCalibrationCampaignSchema = CampaignShapeSchema.superRefine((campaign, context) => {
  try {
    const expected = deriveCampaign(
      campaign.pods.map((pod) => pod.artifact),
      campaign.seed,
      campaign.study.strengthFloor,
    );
    if (canonicalJson(expected) !== canonicalJson(campaign)) {
      context.addIssue({
        code: 'custom',
        path: [],
        message: 'campaign evidence disagrees with its retained child artifacts',
      });
    }
  } catch (error: unknown) {
    context.addIssue({
      code: 'custom',
      path: ['pods'],
      message: `campaign children cannot be reconciled: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

export function readDraftCalibrationCampaign(
  value: unknown,
  source = 'Draft calibration campaign',
): DraftCalibrationCampaign {
  const parsed = DraftCalibrationCampaignSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${source}: invalid Draft calibration campaign: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export interface AggregateDraftCalibrationCampaignOptions {
  readonly seed: string;
  readonly strengthFloor?: DraftCampaignStrengthFloor | undefined;
}

export function aggregateDraftCalibrationCampaign(
  input: readonly unknown[],
  options: AggregateDraftCalibrationCampaignOptions,
): DraftCalibrationCampaign {
  if (input.length < 2 || input.length > MAX_DRAFT_CAMPAIGN_PODS) {
    throw new Error(`Draft campaign pods must contain 2-${String(MAX_DRAFT_CAMPAIGN_PODS)} children`);
  }
  const children = input.map((child, pod) =>
    readDraftCalibrationArtifact(child, `Draft campaign child ${String(pod)}`),
  );
  const floor = checkedStrengthFloor(options.strengthFloor ?? DEFAULT_DRAFT_CAMPAIGN_STRENGTH_FLOOR);
  return readDraftCalibrationCampaign(
    deriveCampaign(children, options.seed, floor),
    'generated Draft calibration campaign',
  );
}

export interface DraftCalibrationCampaignOptions extends Omit<DraftCalibrationOptions, 'seed' | 'cardFloor'> {
  readonly seed: string;
  readonly pods?: number | undefined;
  readonly childCardFloor?: number | undefined;
  readonly strengthFloor?: DraftCampaignStrengthFloor | undefined;
}

export async function runDraftCalibrationCampaign(
  cards: readonly Card[],
  options: DraftCalibrationCampaignOptions,
): Promise<DraftCalibrationCampaign> {
  const pods = campaignPodCount('pods', options.pods ?? DEFAULT_DRAFT_CAMPAIGN_PODS);
  if (options.seed.trim().length === 0 || options.seed.length > MAX_DRAFT_CAMPAIGN_SEED_LENGTH) {
    throw new Error(
      `Draft campaign seed must contain 1-${String(MAX_DRAFT_CAMPAIGN_SEED_LENGTH)} characters`,
    );
  }
  const childCardFloor = boundedPositive(
    'child card floor',
    options.childCardFloor ?? DEFAULT_DRAFT_CARD_FLOOR,
    MAX_DRAFT_CARD_FLOOR,
  );
  const floor = checkedStrengthFloor(options.strengthFloor ?? DEFAULT_DRAFT_CAMPAIGN_STRENGTH_FLOOR);
  const children: DraftCalibrationArtifact[] = [];
  for (let pod = 0; pod < pods; pod += 1) {
    children.push(
      await runDraftCalibration(cards, {
        seed: `${options.seed}/pod/${String(pod)}`,
        collation: options.collation,
        cardFloor: childCardFloor,
        ...(options.workers === undefined ? {} : { workers: options.workers }),
        ...(options.gamesPerSeatOrder === undefined ? {} : { gamesPerSeatOrder: options.gamesPerSeatOrder }),
        ...(options.packsPerSeat === undefined ? {} : { packsPerSeat: options.packsPerSeat }),
        ...(options.pairings === undefined ? {} : { pairings: options.pairings }),
      }),
    );
  }
  return aggregateDraftCalibrationCampaign(children, { seed: options.seed, strengthFloor: floor });
}

export interface DraftCalibrationCampaignCliArgs {
  readonly setPath: string;
  readonly collationPath: string;
  readonly seed: string;
  readonly outputPath: string;
  readonly pods: number;
  readonly workers?: number | undefined;
  readonly gamesPerSeatOrder: number;
  readonly packsPerSeat: number;
  readonly childCardFloor: number;
  readonly strengthFloor: DraftCampaignStrengthFloor;
}

function integerArgument(flag: string, value: string | undefined, maximum: number): number {
  if (value === undefined) throw new Error(`${flag} needs a value`);
  return boundedPositive(flag, Number(value), maximum);
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

export function parseDraftCalibrationCampaignArgs(args: readonly string[]): DraftCalibrationCampaignCliArgs {
  const values = new Map<string, string>();
  const known = new Set([
    '--set',
    '--collation',
    '--seed',
    '--out',
    '--pods',
    '--workers',
    '--games-per-seat-order',
    '--packs-per-seat',
    '--child-card-floor',
    '--minimum-contrasting-strata',
    '--minimum-drawn-games',
    '--minimum-not-drawn-games',
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
    if (value === undefined || value.length === 0) throw new Error(`Draft campaign CLI requires ${flag}`);
    if (value.length > maximum) {
      throw new Error(`${flag} must contain at most ${String(maximum)} characters`);
    }
    return value;
  };
  const setPath = required('--set', MAX_DRAFT_PATH_LENGTH);
  const collationPath = required('--collation', MAX_DRAFT_PATH_LENGTH);
  const seedValue = required('--seed', MAX_DRAFT_CAMPAIGN_SEED_LENGTH);
  const outputPath = required('--out', MAX_DRAFT_PATH_LENGTH);
  if (comparablePath(outputPath) === comparablePath(setPath)) {
    throw new Error('--out must differ from --set so the campaign cannot overwrite its input');
  }
  if (comparablePath(outputPath) === comparablePath(collationPath)) {
    throw new Error('--out must differ from --collation so the campaign cannot overwrite its input');
  }
  const workers = values.has('--workers')
    ? integerArgument('--workers', values.get('--workers'), MAX_DRAFT_WORKERS)
    : undefined;
  return {
    setPath,
    collationPath,
    seed: seedValue,
    outputPath,
    pods: campaignPodCount(
      '--pods',
      values.has('--pods')
        ? integerArgument('--pods', values.get('--pods'), MAX_DRAFT_CAMPAIGN_PODS)
        : DEFAULT_DRAFT_CAMPAIGN_PODS,
    ),
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
    childCardFloor: values.has('--child-card-floor')
      ? integerArgument('--child-card-floor', values.get('--child-card-floor'), MAX_DRAFT_CARD_FLOOR)
      : DEFAULT_DRAFT_CARD_FLOOR,
    strengthFloor: {
      minimumContrastingStrata: values.has('--minimum-contrasting-strata')
        ? integerArgument(
            '--minimum-contrasting-strata',
            values.get('--minimum-contrasting-strata'),
            MAX_DRAFT_CAMPAIGN_STRENGTH_FLOOR,
          )
        : DEFAULT_DRAFT_CAMPAIGN_STRENGTH_FLOOR.minimumContrastingStrata,
      minimumDrawnGames: values.has('--minimum-drawn-games')
        ? integerArgument(
            '--minimum-drawn-games',
            values.get('--minimum-drawn-games'),
            MAX_DRAFT_CAMPAIGN_STRENGTH_FLOOR,
          )
        : DEFAULT_DRAFT_CAMPAIGN_STRENGTH_FLOOR.minimumDrawnGames,
      minimumNotDrawnGames: values.has('--minimum-not-drawn-games')
        ? integerArgument(
            '--minimum-not-drawn-games',
            values.get('--minimum-not-drawn-games'),
            MAX_DRAFT_CAMPAIGN_STRENGTH_FLOOR,
          )
        : DEFAULT_DRAFT_CAMPAIGN_STRENGTH_FLOOR.minimumNotDrawnGames,
    },
  };
}

function readJson(path: string, label: string): unknown {
  let size: number;
  try {
    size = statSync(path).size;
  } catch (error: unknown) {
    throw new Error(
      `${label} ${path} could not be inspected: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (size > MAX_CAMPAIGN_INPUT_BYTES) {
    throw new Error(`${label} ${path} exceeds the ${String(MAX_CAMPAIGN_INPUT_BYTES)} byte input bound`);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error: unknown) {
    throw new Error(
      `${label} ${path} could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`,
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
        `executable set ${path} card ${String(index)} is invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

export function writeDraftCalibrationCampaignAtomic(
  outputPath: string,
  campaign: DraftCalibrationCampaign,
): void {
  if (outputPath.length === 0 || outputPath.length > MAX_DRAFT_PATH_LENGTH) {
    throw new Error(`Draft campaign output path must contain 1-${String(MAX_DRAFT_PATH_LENGTH)} characters`);
  }
  const checked = readDraftCalibrationCampaign(campaign, 'Draft campaign output');
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
      `atomic Draft campaign write to ${outputPath} failed: ${error instanceof Error ? error.message : String(error)}${cleanupMessage}`,
    );
  }
}

export async function runDraftCalibrationCampaignCli(args: readonly string[]): Promise<void> {
  const parsed = parseDraftCalibrationCampaignArgs(args);
  const cards = readExecutableSet(parsed.setPath);
  const collationResult = DraftCollationSchema.safeParse(readJson(parsed.collationPath, 'Draft collation'));
  if (!collationResult.success) {
    throw new Error(
      `${parsed.collationPath}: invalid Draft collation: ${z.prettifyError(collationResult.error)}`,
    );
  }
  const campaign = await runDraftCalibrationCampaign(cards, {
    seed: parsed.seed,
    collation: collationResult.data,
    pods: parsed.pods,
    gamesPerSeatOrder: parsed.gamesPerSeatOrder,
    packsPerSeat: parsed.packsPerSeat,
    childCardFloor: parsed.childCardFloor,
    strengthFloor: parsed.strengthFloor,
    ...(parsed.workers === undefined ? {} : { workers: parsed.workers }),
  });
  writeDraftCalibrationCampaignAtomic(parsed.outputPath, campaign);
}
