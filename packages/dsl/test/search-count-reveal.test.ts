/**
 * A search that names how many cards it takes, whether it shows them, and
 * whether they arrive tapped.
 *
 * `mtg-nhyv.5`. `searchLibrary` printed one card into one of two zones, which
 * is Rampant Growth and Diabolic Tutor and nothing else in a core set: Farseek
 * puts its land onto the battlefield *tapped*, Ranger's Path takes *two*, and
 * Sylvan Ranger *reveals* what it found. Ten identities in the M11/M13 ledger
 * were refused on those three words.
 *
 * **`battlefieldTapped` is a third destination rather than a `tapped` flag
 * beside the existing two.** A sibling boolean makes `{ destination: 'hand',
 * tapped: true }` a value that parses, validates and means nothing — a card
 * cannot put anything into a hand tapped — and the DSL's standing preference is
 * that an unrepresentable state should be unrepresentable rather than checked.
 * `GRAVEYARD_CHOICE_DESTINATIONS` settled the same question the same way one
 * effect over. The cost is that a reader asking "does this arrive tapped" reads
 * an enum member instead of a boolean, and that read happens in exactly one
 * place (`searchDestinationZone` in the kernel).
 *
 * **The count is the shared `Amount`.** Ranger's Path prints a numeral and
 * M13's mass-ramp sorcery prints "X, where X is the number of lands you
 * control", and the DSL already has one idiom for that pair — `ComputedAmount`, resolved by
 * `evaluateAmount` at the moment the effect applies. A second variable spelling
 * invented for searches would be a second thing to keep in agreement with the
 * first.
 *
 * **`reveal` is a flag on the search, not a `revealCard` primitive beside it.**
 * The cards are named while the resolution is still paused inside the search;
 * nothing outside it knows which cards those are, so a separate effect would
 * have no way to say what it was revealing.
 *
 * The generator cannot reach any of the three, which is the freeze every schema
 * change since the fill recordings were made has had to state: `searchLibrary`
 * is hand-authored vocabulary and appears in none of the three model-facing
 * unions, so the JSON Schema each fill batch is shown is byte-identical and
 * every recorded call still replays.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Card, CardFilter, CardInput, Effect } from '../src/index';
import { MAX_SEARCH_COUNT, SEARCH_DESTINATIONS, renderOracleText, validateCard } from '../src/index';
import { parseCard } from '../src/parse';
import {
  CardEffectSchema,
  EffectSchema,
  ModelEffectSchema,
  PartBearingModelEffectSchema,
  ZoneReachingModelEffectSchema,
} from '../src/effects';

function sorcery(name: string, effects: readonly Effect[]): Card {
  return parseCard({
    kind: 'sorcery',
    id: `xmp-search-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
    name,
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 4 },
    manaCost: { generic: 1, G: 1 },
    colors: ['G'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [...effects],
  } as CardInput);
}

const BASIC_LAND: CardFilter = { cardTypes: ['land'], supertypes: ['basic'] };

describe('a search destination that arrives tapped', () => {
  it('is a member of the destination enum, so an untappable destination cannot claim it', () => {
    expect([...SEARCH_DESTINATIONS]).toEqual(['hand', 'battlefield', 'battlefieldTapped']);
    expect(
      CardEffectSchema.safeParse({
        kind: 'searchLibrary',
        filter: BASIC_LAND,
        destination: 'handTapped',
      }).success,
    ).toBe(false);
  });

  it('prints Farseek’s line word for word', () => {
    const farseek = sorcery('Farseek', [
      {
        kind: 'searchLibrary',
        filter: { subtypes: ['Plains', 'Island', 'Swamp', 'Mountain'] },
        destination: 'battlefieldTapped',
      },
    ]);
    expect(validateCard(farseek)).toEqual([]);
    expect(renderOracleText(farseek)).toBe(
      'Search your library for a Plains, Island, Swamp, or Mountain card, put it onto the battlefield tapped, then shuffle.',
    );
  });
});

describe('a search that names a count', () => {
  it('takes a numeral inside the printed bound and refuses one outside it', () => {
    const search = (count: number): unknown =>
      CardEffectSchema.safeParse({
        kind: 'searchLibrary',
        filter: BASIC_LAND,
        count,
        destination: 'hand',
      }).success;
    expect(search(1)).toBe(true);
    expect(search(MAX_SEARCH_COUNT)).toBe(true);
    expect(search(0)).toBe(false);
    expect(search(MAX_SEARCH_COUNT + 1)).toBe(false);
    expect(search(1.5)).toBe(false);
  });

  it('takes the same computed amount every other counted effect takes', () => {
    expect(
      CardEffectSchema.safeParse({
        kind: 'searchLibrary',
        filter: BASIC_LAND,
        count: { kind: 'countMatching', filter: { cardTypes: ['land'] } },
        destination: 'battlefieldTapped',
      }).success,
    ).toBe(true);
    expect(
      CardEffectSchema.safeParse({
        kind: 'searchLibrary',
        filter: BASIC_LAND,
        count: { kind: 'countOfThings' },
        destination: 'hand',
      }).success,
    ).toBe(false);
  });

  /**
   * "Up to", because CR 701.19b lets any search find fewer cards than it names
   * and the kernel offers the take-nothing answer at every question. Both lines
   * below are their printed cards word for word.
   */
  it('prints the constant and the computed count as Magic prints them', () => {
    const path = sorcery("Ranger's Path", [
      {
        kind: 'searchLibrary',
        filter: { subtypes: ['Forest'] },
        count: 2,
        destination: 'battlefieldTapped',
      },
    ]);
    expect(validateCard(path)).toEqual([]);
    expect(renderOracleText(path)).toBe(
      'Search your library for up to two Forest cards, put them onto the battlefield tapped, then shuffle.',
    );

    // M13's mass-ramp sorcery, under a name of ours: what this asserts is the
    // rules text, and the printed name collides with a private-world term the
    // public-export boundary scans public source for.
    const massRamp = sorcery('Errand Without End', [
      {
        kind: 'searchLibrary',
        filter: BASIC_LAND,
        count: { kind: 'countMatching', filter: { cardTypes: ['land'] } },
        destination: 'battlefieldTapped',
      },
    ]);
    expect(validateCard(massRamp)).toEqual([]);
    expect(renderOracleText(massRamp)).toBe(
      'Search your library for up to X basic land cards, where X is the number of lands you control, put them onto the battlefield tapped, then shuffle.',
    );
  });

  it('leaves the one-card search reading as it always did', () => {
    const tutor = sorcery('Errand of Tutors', [{ kind: 'searchLibrary', filter: {}, destination: 'hand' }]);
    expect(renderOracleText(tutor)).toBe(
      'Search your library for a card, put it into your hand, then shuffle.',
    );
  });
});

describe('a search that reveals what it found', () => {
  it('prints the reveal between the search and the move, where the kernel performs it', () => {
    const ranger = sorcery('Errand in the Open', [
      { kind: 'searchLibrary', filter: BASIC_LAND, reveal: true, destination: 'hand' },
    ]);
    expect(validateCard(ranger)).toEqual([]);
    expect(renderOracleText(ranger)).toBe(
      'Search your library for a basic land card, reveal it, put it into your hand, then shuffle.',
    );
  });

  it('carries the plural pronoun into the reveal when the count is plural', () => {
    const both = sorcery('Errand in Twos', [
      {
        kind: 'searchLibrary',
        filter: { subtypes: ['Forest'] },
        count: 2,
        reveal: true,
        destination: 'battlefieldTapped',
      },
    ]);
    expect(renderOracleText(both)).toBe(
      'Search your library for up to two Forest cards, reveal them, put them onto the battlefield tapped, then shuffle.',
    );
  });

  it('says nothing at all when the card does not print the word', () => {
    const quiet = sorcery('Errand Unseen', [
      { kind: 'searchLibrary', filter: BASIC_LAND, reveal: false, destination: 'hand' },
    ]);
    expect(renderOracleText(quiet)).not.toContain('reveal');
  });
});

describe('the fixture-key freeze', () => {
  /**
   * `EffectSchema` rides along with the three model-facing unions because it is
   * the list `@mtg/setgen` reads to decide how many effects a slot may ask for:
   * a member appearing there is a member the generator can be asked to print.
   * `searchLibrary` is hand-authored vocabulary and belongs to `CardEffectSchema`
   * alone, which is why widening it moves no recorded fixture key.
   */
  it('keeps all three words out of every schema the generator is shown', () => {
    for (const schema of [
      EffectSchema,
      ModelEffectSchema,
      PartBearingModelEffectSchema,
      ZoneReachingModelEffectSchema,
    ] as const) {
      const json = JSON.stringify(z.toJSONSchema(schema as unknown as z.ZodType, { io: 'input' }));
      expect(json).not.toContain('searchLibrary');
      expect(json).not.toContain('destination');
      expect(json).not.toContain('battlefieldTapped');
      expect(json).not.toContain('reveal');
    }
  });
});
