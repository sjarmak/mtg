/**
 * "Enters tapped" on something that is not a land (mtg-hgmz).
 *
 * `entryReplacement` was a `LandCardSchema` field, so the standard way to
 * price a two-mana rock — Coldsteel Heart's whole cost-balancing clause —
 * could not be printed. Counted over the 38,623-card store, the phrase
 * "enters (the battlefield) tapped" is printed on 592 lands, 61 noncreature
 * artifacts and 54 creatures as a self-replacement, so the field travels to
 * artifacts and creatures.
 *
 * It does not travel to enchantments: zero of the 38,623 print it on
 * themselves. The four enchantment-typed hits are two modal Aura//Land fronts
 * whose *land* back enters tapped, and two (Ashling's Prerogative, Echoing
 * Assault) whose text is about some other permanent entering tapped, which is
 * a static replacement over other objects rather than this field.
 *
 * `entersTappedUnlessControlsLandSubtype` stays land-only for the same kind of
 * counted reason: all 80 cards printing "enters tapped unless you control a
 * <basic land type>" are lands.
 */
import { describe, expect, it } from 'vitest';
import { parseCard, printedEntryReplacement, renderOracleText, safeParseCard, validateCard } from '@mtg/dsl';

const SET = { code: 'TST', collectorNumber: 12 } as const;

function rock(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'artifact',
    id: 'tst-coldsteel-heart',
    name: 'Coldsteel Heart',
    rarity: 'uncommon',
    set: SET,
    manaCost: { generic: 2 },
    entryReplacement: { kind: 'entersTapped' },
    abilities: [
      {
        kind: 'activated',
        cost: { mana: {}, tapSelf: true },
        effects: [{ kind: 'addMana', produces: ['U'], amount: 1 }],
      },
    ],
    ...overrides,
  };
}

describe('a nonland permanent that enters tapped (mtg-hgmz)', () => {
  it('accepts the entry replacement on a noncreature artifact', () => {
    expect(validateCard(rock())).toEqual([]);
    const card = parseCard(rock());
    expect(printedEntryReplacement(card)).toEqual({ kind: 'entersTapped' });
  });

  it('prints the entry sentence above the mana ability', () => {
    expect(renderOracleText(parseCard(rock()))).toBe('Coldsteel Heart enters tapped.\n{T}: Add {U}.');
  });

  it('accepts it on a creature and prints it under the keyword line', () => {
    const skaab = parseCard({
      kind: 'creature',
      id: 'tst-headless-skaab',
      name: 'Headless Skaab',
      rarity: 'uncommon',
      set: { code: 'TST', collectorNumber: 13 },
      manaCost: { U: 1, generic: 2 },
      colors: ['U'],
      keywords: ['flying'],
      power: 4,
      toughness: 5,
      entryReplacement: { kind: 'entersTapped' },
    });
    expect(renderOracleText(skaab)).toBe('Flying\nHeadless Skaab enters tapped.');
  });

  it('refuses the land-shaped condition on a nonland', () => {
    // `entersTappedUnlessControlsLandSubtype` is not a member of the schema a
    // nonland permanent carries, so a discriminated union with one member
    // rejects it outright rather than stripping it into a card whose printed
    // face and whose kernel behavior would disagree.
    const parsed = safeParseCard(
      rock({ entryReplacement: { kind: 'entersTappedUnlessControlsLandSubtype', landTypes: ['Island'] } }),
    );
    expect(parsed.ok).toBe(false);
  });

  it('does not give an enchantment the field', () => {
    const blanket = {
      kind: 'enchantment',
      id: 'tst-blanket',
      name: 'Test Blanket',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 14 },
      manaCost: { W: 1, generic: 1 },
      colors: ['W'],
    };
    // `EnchantmentCardSchema` declares no `entryReplacement`, and since
    // `mtg-nhyv.69` an undeclared key is refused by name rather than dropped:
    // the card that would have printed nothing about entering tapped while the
    // author believed otherwise never parses at all.
    const withField = safeParseCard({ ...blanket, entryReplacement: { kind: 'entersTapped' } });
    expect(withField.ok).toBe(false);
    if (withField.ok) return;
    expect(withField.violations.map((found) => found.message)).toContainEqual(
      expect.stringContaining('"entryReplacement"'),
    );

    // The same enchantment without the key is a legal card that prints nothing.
    const parsed = parseCard(blanket);
    expect(printedEntryReplacement(parsed)).toBeUndefined();
    expect(renderOracleText(parsed)).toBe('');
  });
});
