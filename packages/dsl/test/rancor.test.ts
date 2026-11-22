/** Rancor's exact source-departure return contract. */
import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, safeParseCard, type CardInput } from '@mtg/dsl';

const RETURN = { kind: 'returnDepartedSourceToOwnerHand' } as const;

function rancor(condition = 'selfPutIntoGraveyardFromBattlefield'): CardInput {
  return {
    kind: 'enchantment',
    id: 'm13-185-rancor',
    name: 'Rancor',
    rarity: 'uncommon',
    set: { code: 'M13', collectorNumber: 185 },
    manaCost: { G: 1 },
    colors: ['G'],
    subtypes: ['Aura'],
    aura: {
      enchant: 'creature',
      modifications: [
        { kind: 'statBonus', power: 2, toughness: 0 },
        { kind: 'grantKeyword', keyword: 'trample' },
      ],
    },
    abilities: [{ kind: 'triggered', condition, effects: [RETURN] }],
  } as CardInput;
}

describe('Rancor authoring', () => {
  it('parses and prints the exact battlefield-to-graveyard return trigger', () => {
    expect(renderOracleText(parseCard(rancor()))).toBe(
      'Enchant creature\nEnchanted creature gets +2/+0 and has trample.\n' +
        "When Rancor is put into a graveyard from the battlefield, return Rancor to its owner's hand.",
    );
  });

  it('keeps exact departed-source movement outside the model contract', () => {
    expect(ModelEffectSchema.safeParse(RETURN).success).toBe(false);
  });

  it('refuses the effect under a trigger that does not retain a graveyard incarnation', () => {
    const parsed = safeParseCard(rancor('selfLeavesBattlefield'));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.violations.map((entry) => [entry.code, entry.path])).toContainEqual([
      'ABILITY_ILLEGAL_ON_CARD_TYPE',
      'abilities[0].effects[0]',
    ]);
  });
});
