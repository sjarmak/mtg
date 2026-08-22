/**
 * `CardFilter.names`: an identity where the other fields carry a class.
 *
 * Squadron Hawk's "search your library for up to three cards named Squadron
 * Hawk" is the printed clause, and it is the one search clause no combination
 * of the fields already on a `CardFilter` says. A type, a subtype, a color and
 * a cost bound all describe a set a card belongs to; a name describes the card.
 *
 * The rendering claims are the load-bearing half here, because the kernel's
 * side of this field is proved next door (`@mtg/kernel`'s
 * `card-filter-names.test.ts`) and what a *reader* sees is otherwise checked by
 * nothing. A name is a trailing clause rather than an adjective — Magic prints
 * "a card named X", never "an X card" — and it goes in front of the mana-value
 * bound because that is the order the printed cards put them in.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput, Effect } from '../src/index';
import { renderOracleText, validateCard } from '../src/index';
import { parseCard } from '../src/parse';
import { CardEffectSchema, CardFilterSchema } from '../src/effects';

function sorcery(name: string, effects: readonly Effect[]): Card {
  return parseCard({
    kind: 'sorcery',
    id: `xmp-names-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
    name,
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 5 },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [...effects],
  } as CardInput);
}

describe('a card filter that names the card it wants', () => {
  it('takes a non-empty list of non-empty names and nothing else', () => {
    expect(CardFilterSchema.safeParse({ names: ['Flock Sentinel'] }).success).toBe(true);
    expect(CardFilterSchema.safeParse({ names: [] }).success).toBe(false);
    expect(CardFilterSchema.safeParse({ names: [''] }).success).toBe(false);
    expect(CardFilterSchema.safeParse({ names: 'Flock Sentinel' }).success).toBe(false);
  });

  it('is reachable from a search and from a graveyard choice alike', () => {
    expect(
      CardEffectSchema.safeParse({
        kind: 'searchLibrary',
        filter: { names: ['Flock Sentinel'] },
        count: 3,
        reveal: true,
        destination: 'hand',
      }).success,
    ).toBe(true);
    expect(
      CardEffectSchema.safeParse({
        kind: 'chooseFromGraveyard',
        whose: 'you',
        filter: { names: ['Flock Sentinel'] },
        destination: 'hand',
      }).success,
    ).toBe(true);
  });

  it('prints Squadron Hawk’s clause word for word', () => {
    const call = sorcery('Call the Flock', [
      {
        kind: 'searchLibrary',
        filter: { names: ['Flock Sentinel'] },
        count: 3,
        reveal: true,
        destination: 'hand',
      },
    ]);
    expect(validateCard(call)).toEqual([]);
    expect(renderOracleText(call)).toBe(
      'Search your library for up to three cards named Flock Sentinel, reveal them, put them into your hand, then shuffle.',
    );
  });

  it('keeps the name beside the noun and the mana bound behind it', () => {
    const bounded = sorcery('Call One Back', [
      {
        kind: 'chooseFromGraveyard',
        whose: 'you',
        filter: { cardTypes: ['creature'], names: ['Flock Sentinel'], maxManaValue: 3 },
        destination: 'hand',
      },
    ]);
    expect(validateCard(bounded)).toEqual([]);
    expect(renderOracleText(bounded)).toContain(
      'a creature card named Flock Sentinel with mana value 3 or less',
    );
  });

  it('spells a two-name list as Magic does, with or', () => {
    const either = sorcery('Call Either', [
      {
        kind: 'searchLibrary',
        filter: { names: ['Flock Sentinel', 'Fen Sentinel'] },
        destination: 'hand',
      },
    ]);
    expect(validateCard(either)).toEqual([]);
    expect(renderOracleText(either)).toBe(
      'Search your library for a card named Flock Sentinel or Fen Sentinel, put it into your hand, then shuffle.',
    );
  });
});
