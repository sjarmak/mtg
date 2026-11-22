import { BotEvidenceEpisodeSchema } from '@mtg/bot-evidence';
import {
  compareStageStrengthCampaign,
  type StageStrengthCampaignPlan,
  type StageStrengthComparison,
  type StageStrengthTrial,
} from '@mtg/metrics';
import { z } from 'zod';
import { CONSTRUCTED_FORMAT_CONTRACT } from './constructed-policy';

const DeckEntrySchema = z
  .object({
    id: z.string().min(1),
    count: z.number().int().positive(),
  })
  .passthrough();

const BasicLandCountsSchema = z.strictObject({
  W: z.number().int().nonnegative(),
  U: z.number().int().nonnegative(),
  B: z.number().int().nonnegative(),
  R: z.number().int().nonnegative(),
  G: z.number().int().nonnegative(),
});

const CompletedConstructedOutcomeSchema = z
  .object({
    construction: z
      .object({
        format: z
          .object({
            id: z.literal(CONSTRUCTED_FORMAT_CONTRACT),
            deckSize: z.literal(60),
            copyLimit: z.number().int().positive(),
          })
          .passthrough(),
      })
      .passthrough(),
    deck: z
      .object({
        totalCards: z.literal(60),
        spells: z.array(DeckEntrySchema),
        lands: z.array(DeckEntrySchema),
        basics: BasicLandCountsSchema,
      })
      .passthrough(),
    shortBy: z.literal(0),
  })
  .passthrough();

function validateCompletedDeck(trial: StageStrengthTrial): void {
  const episode = BotEvidenceEpisodeSchema.parse(trial.episode);
  if (episode.outcome.status !== 'completed') return;

  const parsed = CompletedConstructedOutcomeSchema.safeParse(episode.outcome.value);
  if (!parsed.success) {
    throw new Error(`constructed trial ${trial.unitId}/${trial.arm} must retain a legal 60-card deck`);
  }
  const outcome = parsed.data;
  const entries = [...outcome.deck.spells, ...outcome.deck.lands];
  const cardIds = [...new Set(entries.map((entry) => entry.id))];
  const overLimit = cardIds.find(
    (id) =>
      entries.filter((entry) => entry.id === id).reduce((sum, entry) => sum + entry.count, 0) >
      outcome.construction.format.copyLimit,
  );
  if (overLimit !== undefined) {
    throw new Error(`constructed trial ${trial.unitId}/${trial.arm} exceeds its copy limit for ${overLimit}`);
  }
  const retainedCards =
    entries.reduce((sum, entry) => sum + entry.count, 0) +
    Object.values(outcome.deck.basics).reduce((sum, count) => sum + count, 0);
  if (retainedCards !== outcome.deck.totalCards) {
    throw new Error(`constructed trial ${trial.unitId}/${trial.arm} has an inconsistent 60-card deck`);
  }
}

/** Validate constructed legality, then derive promotion only from retained downstream games. */
export function compareConstructedPromotion(
  plan: StageStrengthCampaignPlan,
  trials: readonly StageStrengthTrial[],
): StageStrengthComparison {
  if (plan.stage !== 'constructed-construction') {
    throw new Error('constructed promotion requires the constructed-construction stage');
  }
  if (plan.evidenceStage !== 'deckbuilding') {
    throw new Error('constructed promotion requires deckbuilding evidence');
  }
  for (const trial of trials) validateCompletedDeck(trial);
  return compareStageStrengthCampaign(plan, trials);
}
