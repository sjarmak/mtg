/**
 * Card builders for the transpiler tests.
 *
 * Every fixture goes through `parseCard`, so a test card that stops being a
 * legal DSL card fails loudly instead of exercising the transpiler on input
 * the generator could never produce.
 */
import type { Card, CardInput, EffectInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

let collectorNumber = 0;

function nextCollectorNumber(): number {
  collectorNumber += 1;
  return collectorNumber;
}

export function slugId(name: string): string {
  return `tst-${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;
}

/** An instant carrying the given effects. */
export function spell(
  name: string,
  effects: readonly EffectInput[],
  overrides: Partial<CardInput> = {},
): Card {
  return parseCard({
    kind: 'instant',
    id: slugId(name),
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: nextCollectorNumber() },
    manaCost: { generic: 1, R: 1 },
    colors: ['R'],
    effects: [...effects],
    ...overrides,
  } as CardInput);
}

/** A vanilla-or-keyworded creature. */
export function creature(name: string, overrides: Partial<CardInput> = {}): Card {
  return parseCard({
    kind: 'creature',
    id: slugId(name),
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: nextCollectorNumber() },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
    power: 2,
    toughness: 2,
    ...overrides,
  } as CardInput);
}

/** Transpiles a card and returns its script text, or throws with the reasons. */
export function mustTranspile(card: Card): string {
  const result = transpileCard(card);
  if (!result.ok) throw new Error(`unexpected rejection: ${JSON.stringify(result.rejections)}`);
  return result.script.text;
}
