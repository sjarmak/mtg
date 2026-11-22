/**
 * Forge precon deck files to one constructed-format recipe.
 *
 * A precon is a deck Forge already ships; the recipe states it as names, set
 * codes and counts and nothing else, so `buildPrintedFormat` resolves every
 * line against pinned catalogs the way it resolves a booster sheet. The deck
 * id is the file's own name with Forge's `[SET] [year]` suffix dropped and
 * slugified, so `Token Triumph [SCD] [2022]` is `token-triumph`.
 */
import type { PrintedConstructedFormatRecipe } from './format-build';
import type { ForgeDeckEntry, ForgeDeckFile } from './forge-deck-file';

export interface PreconRecipeOptions {
  readonly id: string;
  readonly name: string;
  readonly rules: PrintedConstructedFormatRecipe['rules'];
}

const SUFFIX = /(?:\s*\[[^\]]*\])+\s*$/u;

export function preconDeckId(deckName: string): string {
  const slug = deckName
    .replace(SUFFIX, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (slug.length === 0) throw new Error(`Precon deck name slugifies to nothing: ${deckName}`);
  return slug;
}

function slot(entry: ForgeDeckEntry) {
  return { name: entry.name, ...(entry.setCode === undefined ? {} : { setCode: entry.setCode }) };
}

export function preconRecipe(
  decks: readonly ForgeDeckFile[],
  options: PreconRecipeOptions,
): PrintedConstructedFormatRecipe {
  if (decks.length === 0) throw new Error('No precon deck files to write a recipe from');
  const sourceCodes: string[] = [];
  for (const deck of decks) {
    if (deck.sideboard.length > 0) {
      throw new Error(`Precon ${deck.name} carries a sideboard, and a constructed recipe has no sideboard`);
    }
    for (const entry of [...deck.commanders, ...deck.main]) {
      if (entry.setCode !== undefined && !sourceCodes.includes(entry.setCode))
        sourceCodes.push(entry.setCode);
    }
  }
  if (sourceCodes.length === 0) throw new Error('No precon line names a set, so there is nothing to pin');
  return {
    schemaVersion: 1,
    kind: 'constructed',
    id: options.id,
    name: options.name,
    sourceCodes,
    rules: options.rules,
    decks: decks.map((deck) => ({
      id: preconDeckId(deck.name),
      name: deck.name.replace(SUFFIX, '').trim(),
      commanders: deck.commanders.map(slot),
      cards: deck.main.map((entry) => ({ ...slot(entry), count: entry.count })),
    })),
  };
}
