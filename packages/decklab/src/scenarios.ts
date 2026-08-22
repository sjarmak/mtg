/**
 * The requests both builders are measured on.
 *
 * Chosen to spread across the things that can go wrong rather than to flatter
 * the informed pipeline. Formats with very different card pools (modern,
 * pauper, standard, legacy, commander), constraints of every kind the criteria
 * support, and deliberately a couple of requests where the honest answer is
 * hard: a rotating format the model's training data may be stale on, and a
 * singleton format where the copy rule differs.
 *
 * Kept small on purpose. Each scenario costs two deck builds and a judgment,
 * so a sweep is minutes of model time; the deterministic measures are the ones
 * that need to be trustworthy, not numerous.
 *
 * No scenario states a land count. It used to: every one carried a constant, so
 * the eval measured the same frozen number six times over rather than the
 * pipeline's judgment, and burn's constant of 24 is what the blind judge named
 * when the informed deck lost that scenario worst. Deck size stays, because how
 * many cards a format's decks have is a fact and not a judgment.
 */
import type { Scenario } from './eval';

export const DEFAULT_SCENARIOS: readonly Scenario[] = [
  {
    id: 'modern-burn',
    criteria: {
      prompt: 'aggressive mono-red burn that wins by turn five',
      format: 'modern',
      colors: ['R'],
      archetype: 'aggro',
      size: 60,
    },
  },
  {
    id: 'pauper-lifegain-budget',
    criteria: {
      prompt: 'a budget pauper lifegain deck for kitchen-table games',
      format: 'pauper',
      colors: ['W', 'B'],
      themes: ['lifegain'],
      archetype: 'midrange',
      powerBand: 'casual',
      budget: { maxDeckUsd: 25 },
      size: 60,
    },
  },
  {
    id: 'standard-control',
    criteria: {
      // Standard rotates, so this is where a model working from memory is most
      // likely to reach for cards that have left the format.
      prompt: 'a controlling deck that wins late with card advantage',
      format: 'standard',
      colors: ['U', 'B'],
      archetype: 'control',
      size: 60,
    },
  },
  {
    id: 'legacy-cheap-spells',
    criteria: {
      prompt: 'a fast blue tempo deck built on one and two mana spells',
      format: 'legacy',
      colors: ['U'],
      archetype: 'tempo',
      maxManaValue: 2,
      size: 60,
    },
  },
  {
    id: 'commander-singleton',
    criteria: {
      // Singleton: the copy limit is one, which a generic builder routinely
      // forgets by writing "4x" out of habit.
      prompt: 'a green ramp commander deck that casts big creatures early',
      format: 'commander',
      colors: ['G'],
      archetype: 'ramp',
      size: 100,
    },
  },
  {
    id: 'modern-artifacts-cheap',
    criteria: {
      prompt: 'an artifact-themed deck where no single card is expensive',
      format: 'modern',
      colors: ['U', 'R'],
      themes: ['artifacts'],
      budget: { maxCardUsd: 3 },
      size: 60,
    },
  },
];
