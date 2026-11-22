/** Offline driver: only the observed projection crosses into the advisor. */
import { createHash } from 'node:crypto';
import {
  evaluateDraft,
  LEGACY_CUBE_ADVISOR_MODEL,
  runPhysicalCubeDraft,
  validateAdvisorMetadata,
  DEFAULT_ADVISOR_WEIGHTS,
  parseAdvisorWeights,
} from '@mtg/draft-export';
import type { AdvisorCard, AdvisorWeights, ObservedDraft, Reason } from '@mtg/draft-export';
import type { PrintedCardCatalog } from '@mtg/printed-card';

export type CalibrationSplit = 'tuning' | 'holdout';
export type DraftPolicy = 'power' | 'current' | 'flexible' | 'pivot' | `pin:${string}`;
export const CALIBRATION_VERSION = 'legacy-cube-bot-calibration/v1';
export const DRAFT_BOT_VERSION = 'printed-curve/v1';
const HUMAN = 'seat-1';
export const CALIBRATION_SEATS = Array.from({ length: 8 }, (_, i) => `seat-${String(i + 1)}`);

export function calibrationSeed(
  root: string,
  split: CalibrationSplit,
  stage: 'draft' | 'game',
  index: number,
): string {
  if (
    !root.trim() ||
    root.length > 256 ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    !['tuning', 'holdout'].includes(split) ||
    !['draft', 'game'].includes(stage)
  ) {
    throw new Error('Invalid calibration seed coordinates');
  }
  return createHash('sha256')
    .update(JSON.stringify([CALIBRATION_VERSION, root, split, stage, index]))
    .digest('hex');
}

/** Matches the existing printed-cube opponents; no advisor scores in this baseline. */
export function baselineCardScore(card: AdvisorCard): number {
  const type = card.faces?.[0]?.typeLine ?? card.typeLine;
  return (
    Math.max(0, 8 - Math.abs(card.manaValue - 3)) * 10 +
    (type.includes('Creature') ? 8 : type.includes('Land') ? 5 : 0)
  );
}

export interface CalibrationPick {
  readonly round: number;
  readonly pickNumber: number;
  readonly chosen: string;
  readonly seen: readonly string[];
  readonly requested: DraftPolicy;
  readonly used: string;
  readonly reasons: readonly Reason[];
}

export function draftCalibrationPool(
  catalog: PrintedCardCatalog,
  seed: string,
  policy: DraftPolicy,
  inputWeights: AdvisorWeights = DEFAULT_ADVISOR_WEIGHTS,
) {
  const weights = parseAdvisorWeights(inputWeights);
  const model = { ...LEGACY_CUBE_ADVISOR_MODEL, weights };
  const errors = validateAdvisorMetadata(catalog).errors;
  if (errors.length) throw new Error(`Stale advisor metadata: ${errors.join('; ')}`);
  const pinned = policy.startsWith('pin:') ? policy.slice(4) : null;
  if (pinned !== null && !LEGACY_CUBE_ADVISOR_MODEL.archetypes.some((a) => a.id === pinned)) {
    throw new Error(`Unknown archetype ${pinned}`);
  }
  if (pinned === null && !['power', 'current', 'flexible', 'pivot'].includes(policy))
    throw new Error('Unknown draft policy');
  const cards = catalog.cards.map((payload) => ({ physicalId: payload.physicalId, payload }));
  let picks: readonly string[] = [];
  let trace: readonly CalibrationPick[] = [];
  for (let index = 0; index <= 45; index += 1) {
    const draft = runPhysicalCubeDraft(cards, {
      seed,
      seatIds: CALIBRATION_SEATS,
      humanSeatIds: [HUMAN],
      picks: { [HUMAN]: picks },
      score: ({ card }) => baselineCardScore(card.payload),
    });
    const observed: ObservedDraft = {
      seats: 8,
      rounds: 3,
      packSize: 15,
      picks,
      observations: draft.observations
        .filter((o) => o.seatId === HUMAN)
        .map((o) => ({ round: o.round, pickNumber: o.pickNumber, cards: o.cards.map((c) => c.payload) })),
    };
    const advice = evaluateDraft(observed, model, pinned);
    if (draft.result !== null) {
      const pool = picks.map((id) => {
        const card = catalog.cards.find((c) => c.physicalId === id);
        if (!card) throw new Error(`Unknown drafted card ${id}`);
        return card;
      });
      return {
        weights,
        seed,
        policy,
        pool,
        trace,
        archetypes: advice.archetypes,
        opponentPools: draft.result.seats
          .filter((s) => s.seatId !== HUMAN)
          .map((s) => ({ seatId: s.seatId, pool: s.picks.map((p) => p.card.payload) })),
      };
    }
    const pack = advice.memory.current;
    if (!pack) throw new Error('Draft stopped without an observed pack');
    const recommendation =
      advice.recommendations.find((r) => r.mode === (pinned ? 'explore' : policy)) ??
      advice.recommendations.find((r) => r.mode === 'flexible');
    const choice =
      policy === 'power'
        ? [...pack.cards].sort((a, b) => baselineCardScore(b) - baselineCardScore(a))[0]
        : recommendation?.card;
    if (!choice) throw new Error('No legal calibration pick');
    trace = [
      ...trace,
      {
        round: pack.round,
        pickNumber: pack.pickNumber,
        chosen: choice.physicalId,
        seen: pack.cards.map((c) => c.physicalId),
        requested: policy,
        used: policy === 'power' ? 'power' : recommendation!.mode,
        reasons:
          policy === 'power'
            ? [
                {
                  code: 'baseline',
                  text: 'Fixed curve baseline, independent of the advisor.',
                  cards: [choice.physicalId],
                  polarity: 'neutral',
                },
              ]
            : recommendation!.reasons,
      },
    ];
    picks = [...picks, choice.physicalId];
  }
  throw new Error('Draft exceeded its 45-pick bound');
}
