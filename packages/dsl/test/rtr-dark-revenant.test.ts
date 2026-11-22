/** Exact authoring contract for RTR #61, Dark Revenant. */
import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, safeParseCard, type CardInput } from '@mtg/dsl';

const RETURN = { kind: 'putDepartedSourceOnTopOfOwnerLibrary' } as const;

function darkRevenant(condition = 'selfDies'): CardInput {
  return {
    kind: 'creature',
    id: 'rtr-061-dark-revenant',
    name: 'Dark Revenant',
    rarity: 'uncommon',
    set: { code: 'RTR', collectorNumber: 61 },
    manaCost: { generic: 3, B: 1 },
    colors: ['B'],
    subtypes: ['Spirit'],
    keywords: ['flying'],
    power: 2,
    toughness: 2,
    abilities: [{ kind: 'triggered', condition, printedSourceReference: 'thisCreature', effects: [RETURN] }],
  } as CardInput;
}

describe('Dark Revenant authoring', () => {
  it('parses and prints the exact current Oracle text', () => {
    expect(renderOracleText(parseCard(darkRevenant()))).toBe(
      "Flying\nWhen this creature dies, put it on top of its owner's library.",
    );
  });

  it('keeps exact departed-source movement outside the generator contract', () => {
    expect(ModelEffectSchema.safeParse(RETURN).success).toBe(false);
  });

  it('requires the graveyard-incarnation trigger that supplies its referent', () => {
    const parsed = safeParseCard(darkRevenant('selfLeavesBattlefield'));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.violations.map((entry) => [entry.code, entry.path])).toContainEqual([
      'ABILITY_ILLEGAL_ON_CARD_TYPE',
      'abilities[0].effects[0]',
    ]);
  });
});
