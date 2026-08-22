/**
 * A preconstructed deck: a list somebody wrote down, resolved against a set.
 *
 * `buildDeck` answers "what is the best deck in this pool" and `buildFromSpells`
 * answers "I have picked these cards, now give me a legal deck". This is the
 * layer over the second one that a *written* list needs: a precon arrives as
 * card ids and counts in a file rather than as `Card` objects in memory, and
 * everything between those two forms is where a deck list quietly goes wrong.
 *
 * Three things it therefore refuses rather than absorbs. An id the set does not
 * print is named and the build stops, because a 59-card deck that silently
 * dropped the payoff is worse than no deck. A count that is not a positive
 * integer is named. And the file carries no `targetCurve`: the curve of a fixed
 * list is a *measurement* of that list, not a constraint on it, so it is
 * computed from the resolved spells and handed to `resolveConfig` — which
 * otherwise throws, since its default histogram describes a 40-card Limited
 * deck and a precon is 60 cards with 24 lands.
 *
 * This file names no set and no card. The list is the argument.
 */
import type { Card, Color } from '@mtg/dsl';
import { cardManaValue, COLORS } from '@mtg/dsl';
import { z } from 'zod';
import type { CurveBucket, CurveHistogram } from './curve-bucket';
import { curveBucket, emptyCurveHistogram } from './curve-bucket';
import type { DeckBuildConfigInput } from './config';
import type { ManualDeck } from './build-manual';
import { buildFromSpells } from './build-manual';
import type { BasicLandCounts } from './mana-base';

export const PRECON_FORMAT_VERSION = 1;

const CountedCardSchema = z.object({
  id: z.string().min(1),
  count: z.int().min(1).max(60),
});

export const PreconDeckSchema = z.object({
  /** Slug, unique within the file. What a launcher would name on a command line. */
  id: z.string().min(1),
  name: z.string().min(1),
  /** One sentence: what the deck is trying to do. */
  plan: z.string().min(1),
  /** The card the deck is built to cast or attach. Must appear in `spells`. */
  payoff: z.string().min(1),
  spells: z.array(CountedCardSchema).min(1),
  /** Basics by color, taken exactly as written. */
  basics: z
    .object({ W: z.int().min(0), U: z.int().min(0), B: z.int().min(0), R: z.int().min(0), G: z.int().min(0) })
    .partial(),
  deckSize: z.int().min(1),
});

export const PreconFileSchema = z.object({
  formatVersion: z.literal(PRECON_FORMAT_VERSION),
  /** The set the ids belong to, so a file pointed at the wrong set says so. */
  setCode: z.string().min(1),
  decks: z.array(PreconDeckSchema).min(1),
});

export type PreconDeck = z.infer<typeof PreconDeckSchema>;
export type PreconFile = z.infer<typeof PreconFileSchema>;

export class PreconError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreconError';
  }
}

export function parsePreconFile(input: unknown): PreconFile {
  const parsed = PreconFileSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first === undefined ? 'the file' : first.path.join('.');
    const why = first === undefined ? 'it does not match the precon schema' : first.message;
    throw new PreconError(`precon file is not valid at ${where}: ${why}`);
  }
  return parsed.data;
}

export function preconDeck(file: PreconFile, deckId: string): PreconDeck {
  const deck = file.decks.find((candidate) => candidate.id === deckId);
  if (deck === undefined) {
    const known = file.decks.map((candidate) => candidate.id).join(', ');
    throw new PreconError(`no deck "${deckId}" in this precon file; it holds ${known}`);
  }
  return deck;
}

/** The written list as cards, in list order, one entry per copy. */
export function resolvePreconSpells(deck: PreconDeck, set: readonly Card[]): readonly Card[] {
  const byId = new Map(set.map((card) => [card.id, card]));
  const missing = deck.spells.filter((entry) => !byId.has(entry.id)).map((entry) => entry.id);
  if (missing.length > 0) {
    throw new PreconError(
      `${deck.name} names ${String(missing.length)} card(s) the set does not print: ${missing.join(', ')}`,
    );
  }
  if (!deck.spells.some((entry) => entry.id === deck.payoff)) {
    throw new PreconError(`${deck.name} names ${deck.payoff} as its payoff but does not play it`);
  }
  return deck.spells.flatMap((entry) => {
    const card = byId.get(entry.id);
    if (card === undefined) throw new PreconError(`unreachable: ${entry.id}`);
    return Array.from({ length: entry.count }, () => card);
  });
}

/** The mana-value histogram of a fixed list, which is the curve it has. */
export function curveOf(spells: readonly Card[]): CurveHistogram {
  const histogram: Record<CurveBucket, number> = emptyCurveHistogram();
  for (const card of spells) histogram[curveBucket(cardManaValue(card))] += 1;
  return histogram;
}

/**
 * The basics a list counted out, with the colors it left unmentioned left out.
 *
 * Rebuilt rather than passed through because `exactOptionalPropertyTypes` draws
 * a line between "no Swamps" and "an unknown number of Swamps", and a schema's
 * `.partial()` produces the second. `buildChosenManaBase` wants the first.
 */
function statedBasics(deck: PreconDeck): BasicLandCounts {
  const counts: Partial<Record<Color, number>> = {};
  for (const color of COLORS) {
    const count = deck.basics[color];
    if (count !== undefined) counts[color] = count;
  }
  return counts;
}

/**
 * Builds one written deck against a set.
 *
 * `pool` is where the basic lands are found; the spells come from the list and
 * nothing is added to them. The land count is the basics the list states, which
 * is what makes `spellTarget` a statement about the deck somebody is actually
 * building.
 */
export function buildPrecon(deck: PreconDeck, set: readonly Card[], pool: readonly Card[] = set): ManualDeck {
  const spells = resolvePreconSpells(deck, set);
  const basics = statedBasics(deck);
  const landCount = COLORS.reduce((sum, color) => sum + (basics[color] ?? 0), 0);
  const config: DeckBuildConfigInput = {
    deckSize: deck.deckSize,
    landCount,
    targetCurve: curveOf(spells),
    minCreatures: 0,
  };
  return buildFromSpells(spells, pool, config, basics);
}
