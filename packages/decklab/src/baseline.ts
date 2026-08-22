/**
 * The generic-agent baseline: what you get by just asking a model for a deck.
 *
 * This is the control the informed lab is measured against, so it has to be a
 * fair representation of the obvious approach rather than a strawman. It gets
 * the same model, the same criteria, and a prompt that states them plainly. It
 * is asked for a complete deck, lands included, exactly as a person would ask a
 * chatbot.
 *
 * What it does **not** get is everything this package adds: no candidate
 * universe, so nothing checks that a card exists or is legal; no repair loop, so
 * a bad answer stands; no arithmetic, so the model picks its own land count and
 * mana base. Those omissions are the independent variable. If the informed
 * pipeline is not measurably better on legality, hallucination and budget, it is
 * not worth its complexity, and this file is what makes that falsifiable.
 */
import { z } from 'zod';
import type { LlmProvider } from '@mtg/llm';
import type { DeckCriteria } from './criteria';

const BaselineEntrySchema = z.object({
  name: z.string().min(1),
  count: z.int().min(1).max(100),
});

export const BaselineDeckSchema = z.object({
  cards: z.array(BaselineEntrySchema).min(1).describe('every card in the deck, lands included'),
  plan: z.string().min(1),
});

export type BaselineDeck = z.infer<typeof BaselineDeckSchema>;

const SYSTEM =
  'You are a Magic: the Gathering deck builder. Return a complete, legal decklist including lands.';

export interface BaselineEntry {
  readonly name: string;
  readonly count: number;
}

export interface BaselineResult {
  readonly entries: readonly BaselineEntry[];
  readonly plan: string;
}

/** Builds a deck the generic way: one prompt, one answer, no verification. */
export async function buildBaselineDeck(
  provider: LlmProvider,
  criteria: DeckCriteria,
): Promise<BaselineResult> {
  const { value } = await provider.complete({
    system: SYSTEM,
    prompt: buildPrompt(criteria),
    schema: BaselineDeckSchema,
  });
  return { entries: value.cards, plan: value.plan };
}

function buildPrompt(criteria: DeckCriteria): string {
  const lines: string[] = [
    criteria.prompt,
    '',
    `Format: ${criteria.format}.`,
    `Build a ${criteria.size}-card deck, including lands.`,
  ];

  if (criteria.colors.length > 0) lines.push(`Colours: ${criteria.colors.join('')}.`);
  if (criteria.archetype !== undefined) lines.push(`Archetype: ${criteria.archetype}.`);
  if (criteria.themes.length > 0) lines.push(`Themes: ${criteria.themes.join(', ')}.`);
  if (criteria.powerBand !== undefined) lines.push(`Power level: ${criteria.powerBand}.`);
  if (criteria.maxManaValue !== undefined) {
    lines.push(`No card above mana value ${criteria.maxManaValue}.`);
  }
  if (criteria.budget?.maxCardUsd !== undefined) {
    lines.push(`No card above $${criteria.budget.maxCardUsd}.`);
  }
  if (criteria.budget?.maxDeckUsd !== undefined) {
    lines.push(`The whole deck must cost under $${criteria.budget.maxDeckUsd}.`);
  }

  return lines.join('\n');
}
