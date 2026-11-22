/** RTR #49's closed linked-exile, matching-play, and extra-turn bundle. */
import { describe, expect, it } from 'vitest';
import { ModelAbilitySchema, parseCard, renderOracleText, safeParseCard, type CardInput } from '../src/index';

export const SEARCH_THE_CITY_INPUT = {
  kind: 'enchantment',
  id: 'rtr-49-search-the-city',
  name: 'Search the City',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 49 },
  manaCost: { generic: 4, U: 1 },
  colors: ['U'],
  subtypes: [],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [],
      searchTheCityProfile: 'exileTopFive',
    },
    {
      kind: 'triggered',
      condition: 'youCastSpell',
      optional: true,
      effects: [],
      searchTheCityProfile: 'matchingNameCompletion',
    },
  ],
} as const;

describe('Search the City authoring', () => {
  it('parses and renders current Oracle in its exact two-ability order', () => {
    const card = parseCard(SEARCH_THE_CITY_INPUT as unknown as CardInput);
    expect(renderOracleText(card)).toBe(
      'When this enchantment enters, exile the top five cards of your library.\n' +
        "Whenever you play a card with the same name as one of the exiled cards, you may put one of those cards with that name into its owner's hand. Then if there are no cards exiled with this enchantment, sacrifice it. If you do, take an extra turn after this one.",
    );
  });

  it('keeps both profiles outside model output', () => {
    for (const ability of SEARCH_THE_CITY_INPUT.abilities) {
      expect(ModelAbilitySchema.safeParse(ability).success).toBe(false);
    }
  });

  it('refuses either profile without its exact partner and envelope', () => {
    const missingPartner = safeParseCard({
      ...SEARCH_THE_CITY_INPUT,
      abilities: [SEARCH_THE_CITY_INPUT.abilities[0]],
    } as unknown as CardInput);
    expect(missingPartner.ok).toBe(false);

    const widened = structuredClone(SEARCH_THE_CITY_INPUT) as unknown as CardInput;
    const completion = widened.abilities?.[1];
    if (completion?.kind !== 'triggered') throw new Error('completion profile disappeared');
    delete completion.optional;
    const parsed = safeParseCard(widened);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('widened Search the City unexpectedly parsed');
    expect(parsed.violations).toContainEqual(
      expect.objectContaining({ code: 'SOURCE_LINKED_EXILE_INVALID', path: 'abilities' }),
    );
  });
});
