/**
 * `CardFilter.maxManaValue`: CR 202.3's bound, printed as a trailing clause.
 *
 * The four list fields beside it are "any of these" and concatenate into a noun
 * phrase; a bound is not an adjective and never joins them. It arrived for the
 * printed Vessari's `-2` ("...with mana value 4 or less from your graveyard") and
 * the M11/M13 ledger wants it independently.
 *
 * This file covers the DSL boundary: the schema's bound, and the printed
 * sentence in the three shapes that differ — a typed filter, a bare filter with
 * no type word at all, and a filter with no bound, which must print exactly
 * what it printed before this field existed. The kernel half, that the bound
 * actually narrows a graveyard, is `@mtg/kernel`'s file of the same name.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput, Effect } from '@mtg/dsl';
import { CardFilterSchema, renderOracleText } from '../src/index';
import { parseCard } from '../src/parse';

function sorceryInput(effects: readonly Effect[]): Record<string, unknown> {
  return {
    kind: 'sorcery',
    id: 'xmp-bound-probe',
    name: 'Bounded Recall Probe',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 33 },
    manaCost: { generic: 2, B: 1 },
    colors: ['B'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [...effects],
  };
}

function textOf(input: Record<string, unknown>): string {
  return renderOracleText(parseCard(input as CardInput));
}

function recall(filter: Record<string, unknown>): Record<string, unknown> {
  return sorceryInput([
    { kind: 'chooseFromGraveyard', whose: 'you', filter, destination: 'hand' } as unknown as Effect,
  ]);
}

describe('the bound the schema accepts', () => {
  it('takes a whole number from zero up to sixteen', () => {
    expect(CardFilterSchema.safeParse({ maxManaValue: 0 }).success).toBe(true);
    expect(CardFilterSchema.safeParse({ maxManaValue: 16 }).success).toBe(true);
    expect(CardFilterSchema.safeParse({ maxManaValue: 17 }).success).toBe(false);
    expect(CardFilterSchema.safeParse({ maxManaValue: -1 }).success).toBe(false);
    expect(CardFilterSchema.safeParse({ maxManaValue: 2.5 }).success).toBe(false);
  });

  /**
   * Absent is not zero. A filter that left the field off used to find every
   * card and has to keep doing so, which `{}` being a legal Demonic Tutor
   * depends on.
   */
  it('is optional, and an empty filter is still a legal filter', () => {
    const parsed = CardFilterSchema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.maxManaValue).toBeUndefined();
  });
});

describe('the printed clause', () => {
  it('trails the noun phrase rather than joining it', () => {
    expect(textOf(recall({ cardTypes: ['creature'], maxManaValue: 3 }))).toBe(
      'Return a creature card with mana value 3 or less from your graveyard to your hand.',
    );
  });

  /**
   * The case an early return would have dropped: a bound with no type word is
   * the whole restriction, so "a card" cannot be answered before it is read.
   */
  it('survives a filter that names no type at all', () => {
    expect(textOf(recall({ maxManaValue: 2 }))).toBe(
      'Return a card with mana value 2 or less from your graveyard to your hand.',
    );
  });

  it('says nothing extra when the card printed no bound', () => {
    expect(textOf(recall({ cardTypes: ['creature'] }))).toBe(
      'Return a creature card from your graveyard to your hand.',
    );
  });

  it('prints a zero bound as a zero, which is a real clause and not an absence', () => {
    expect(textOf(recall({ maxManaValue: 0 }))).toBe(
      'Return a card with mana value 0 or less from your graveyard to your hand.',
    );
  });
});

describe('a card that prints it validates', () => {
  it('accepts the bounded graveyard return as a whole card', () => {
    const card: Card = parseCard(recall({ cardTypes: ['creature'], maxManaValue: 4 }) as CardInput);
    expect(card.effects[0]?.kind).toBe('chooseFromGraveyard');
  });
});
