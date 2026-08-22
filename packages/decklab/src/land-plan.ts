/**
 * How many lands the deck runs — the one number in the mana base that is a
 * judgment rather than a calculation.
 *
 * The rest of the mana base is arithmetic and stays in `assemble.ts`: given a
 * count, apportioning it across colors is exact, and asking a model to do it
 * gets a plausible answer instead of a correct one. The count itself is the
 * other way round. It follows from the deck's curve, its archetype and how it
 * plans to win, all things the model is already reasoning about, and no formula
 * over those produces it — twenty-four lands is a convention, not a result.
 *
 * Freezing it as a constant is what this file exists to undo. The lab shipped a
 * default of 24 and a per-scenario constant in the eval, so a request for
 * "aggressive mono-red burn that wins by turn five" came back with 24 lands, and
 * the blind judge named exactly that as why the informed pipeline lost the
 * scenario it lost worst: the lands diluted the burn density the request asked
 * for. A number that decides the deck cannot sit where the model cannot reach.
 *
 * ## A stated count wins
 *
 * Someone who asks for 17 lands means it, so a stated count short-circuits this
 * entirely — no model call, no band, no argument.
 *
 * ## The band is a guard, not a decision
 *
 * A model answer is bounded to a share of the deck size. That bound is uniform
 * across every archetype and every format, so unlike a per-archetype table it
 * cannot tell burn what to run; it can only reject an answer no real deck would
 * play. It reaches the model through the JSON Schema in the output contract, and
 * an answer outside it is fed back by `@mtg/llm`'s retry loop with the exact
 * violation. An exhausted retry throws rather than falling back to a default,
 * because a silent default here is the bug this file is fixing.
 */
import { z } from 'zod';
import type { LlmProvider } from '@mtg/llm';
import { ResolvedCriteria } from './criteria';
import type { DeckCriteria } from './criteria';

/** Where the deck's land count came from. Printed in the report. */
export type LandCountSource = 'stated' | 'model';

export interface LandPlan {
  readonly count: number;
  readonly source: LandCountSource;
  /**
   * Why the deck runs that many, in the words of whoever decided: the model's
   * sentence, or — for a count the player stated — that they stated it.
   */
  readonly reason: string;
}

/**
 * The share of a deck that may be lands. Wide enough for every real deck —
 * a fifteen-land storm list and a forty-land commander deck both fit — and
 * narrow enough that a mis-typed answer is caught rather than built.
 */
const MIN_LAND_SHARE = 0.2;
const MAX_LAND_SHARE = 0.5;

/**
 * Longest reason accepted. The field is one sentence and it is concatenated
 * into the deck report and written to stdout, so an unbounded string is a
 * degenerate model response away from a report nobody can read.
 */
const MAX_REASON_LENGTH = 300;

/**
 * The answer shape, bounded for this deck size. Built per request rather than
 * once, so the bound the model is shown is the bound for the deck it is being
 * asked about: a hundred-card deck and a forty-card one are not the same
 * question.
 */
export function landPlanSchema(size: number) {
  return z.object({
    landCount: z
      .int()
      .min(Math.floor(size * MIN_LAND_SHARE))
      .max(Math.floor(size * MAX_LAND_SHARE))
      .describe(`how many of the ${size} cards are lands`),
    reason: z
      .string()
      .min(1)
      .max(MAX_REASON_LENGTH)
      .describe('one sentence on why this deck wants that many'),
  });
}

export type LandPlanAnswer = z.infer<ReturnType<typeof landPlanSchema>>;

const SYSTEM = [
  'You are a Magic: the Gathering deck builder deciding how many lands a deck runs.',
  'You decide the count and nothing else: not which lands, and not how they split',
  'between colours. The split is computed exactly from the pip demand of the cards,',
  'and the nonbasic lands are chosen in a later step.',
].join(' ');

/**
 * The deck's land count, from the player if they said, from the model if not.
 */
export async function planLandCount(provider: LlmProvider, criteria: DeckCriteria): Promise<LandPlan> {
  const stated = criteria.landCount;
  if (stated !== undefined) {
    return { count: stated, source: 'stated', reason: 'as the player stated' };
  }

  const { value } = await provider.complete({
    system: SYSTEM,
    prompt: buildPrompt(criteria),
    schema: landPlanSchema(criteria.size),
  });

  return { count: value.landCount, source: 'model', reason: value.reason };
}

/**
 * The one place a `ResolvedCriteria` is minted. It is deliberately absent from
 * `index.ts`, and so is the constructor it calls — the barrel exports the class
 * as a type only. A caller of `@mtg/decklab` can receive a `ResolvedCriteria`
 * from `buildInformedDeck`, name it, and read it, but has nothing on the public
 * surface to mint one with or to rebuild one from the parts of the one they
 * were given.
 *
 * A mint that stamped whatever it was handed would be ceremony, so the plan has
 * to belong to the criteria. A `stated` plan must carry the count the player
 * actually stated, which is what `planLandCount` short-circuits to. A `model`
 * plan can only exist where the player stated nothing, because a stated count
 * wins outright, and its count is held to the band the model's answer was held
 * to.
 */
export function resolveCriteria(stated: DeckCriteria, plan: LandPlan): ResolvedCriteria {
  switch (plan.source) {
    case 'stated':
      if (plan.count !== stated.landCount) {
        throw new Error(
          `the plan says the player stated ${plan.count} lands; the criteria state ${stated.landCount === undefined ? 'no count at all' : String(stated.landCount)}`,
        );
      }
      break;
    case 'model':
      checkModelPlan(stated, plan);
      break;
    default: {
      const never: never = plan.source;
      throw new Error(`unknown land count source: ${String(never)}`);
    }
  }

  return new ResolvedCriteria(stated, plan.count);
}

/**
 * Defense in depth at the seam. `planLandCount` already refuses to ask the model
 * when the player stated a count, and `@mtg/llm` already holds the answer to the
 * band; this is what makes a plan that arrived some other way fail here instead
 * of building a deck around a number no model was ever shown.
 */
function checkModelPlan(stated: DeckCriteria, plan: LandPlan): void {
  if (stated.landCount !== undefined) {
    throw new Error(
      `the plan says the model chose ${plan.count} lands, but the player stated ${stated.landCount} and a stated count wins`,
    );
  }

  const checked = landPlanSchema(stated.size).safeParse({ landCount: plan.count, reason: plan.reason });
  if (!checked.success) {
    throw new Error(
      `no model answer for a ${stated.size}-card deck could be this plan: ${checked.error.issues.map((issue) => issue.message).join('; ')}`,
    );
  }
}

/** The count and where it came from, as one line a reader can argue with. */
export function describeLandCount(plan: LandPlan): string {
  return plan.source === 'stated'
    ? `${plan.count} lands, ${plan.reason}.`
    : `${plan.count} lands, chosen for this deck: ${plan.reason}`;
}

function buildPrompt(criteria: DeckCriteria): string {
  const lines: string[] = [
    `The player asked for: ${criteria.prompt}`,
    '',
    `Format: ${criteria.format}. Deck size: ${criteria.size} cards.`,
  ];

  if (criteria.colors.length > 0) lines.push(`Colours: ${criteria.colors.join('')}.`);
  if (criteria.archetype !== undefined) lines.push(`Archetype: ${criteria.archetype}.`);
  if (criteria.themes.length > 0) lines.push(`Themes: ${criteria.themes.join(', ')}.`);
  if (criteria.powerBand !== undefined) lines.push(`Power level: ${criteria.powerBand}.`);
  if (criteria.maxManaValue !== undefined) {
    lines.push(`No card above mana value ${criteria.maxManaValue}.`);
  }

  lines.push(
    '',
    `How many of those ${criteria.size} cards should be lands?`,
    '',
    'The count follows from this deck: the curve it wants to play, its archetype, and how it',
    'plans to win. It is not a convention to be repeated from other decks in the format.',
    '',
    'Any nonbasic lands chosen later come out of this count, and every slot left over becomes',
    'a basic. You are not being asked for the split between colours: that is apportioned from',
    'the pip demand of the cards, whatever count you give.',
    '',
    'Answer with the count and one sentence on why this deck wants that many.',
  );

  return lines.join('\n');
}
