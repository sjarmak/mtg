/**
 * Which keyword abilities a noncreature permanent may carry (`mtg-rji`).
 *
 * `checkKeywords` used to split this question by card type: a creature could
 * carry any of the five kinds in `KEYWORD_ABILITY_KINDS` and nothing else could
 * carry any of them. That is the right answer for three of the five and the
 * wrong answer for two. Indestructible is a static ability of any permanent
 * (CR 702.12a — "a permanent with indestructible can't be destroyed"), and so
 * is hexproof (CR 702.11b — "a permanent with hexproof can't be the target of
 * spells or abilities your opponents control"). Neither rule says creature, and
 * this kernel never read one: `destroyPermanent` short-circuits on
 * `hasKeywordAbility(state, oid, 'indestructible')` with no type check above
 * it, and `canBeTargetedBy` reads hexproof off the object's characteristics the
 * same way. So the validator was refusing a clause the engine already
 * enforced, and The Trisigil — `{3}`, Legendary Artifact, indestructible —
 * could not be written down.
 *
 * Defender and landwalk stay creature-only, because their rules are about
 * attacking and blocking (CR 702.3b, CR 702.13b) and a permanent that does
 * neither has nowhere to put them. Protection stays creature-only here as a
 * scope decision rather than a rules one: CR 702.16 is not creature-only, and
 * neither is this kernel's implementation, but widening it is not this bead.
 *
 * The type line is the other half of the same claim: CR 205.1a makes the
 * permanent types artifact, creature, enchantment, land, and planeswalker, and
 * instants and sorceries are not among them — nothing that never reaches the
 * battlefield can be indestructible or hexproof, so those two stay refused
 * there.
 */
import { renderOracleText, parseCard, validateCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const TRISIGIL = {
  kind: 'artifact',
  id: 'xmp-trisigil',
  name: 'The Trisigil',
  rarity: 'mythic',
  set: { code: 'XMP', collectorNumber: 1 },
  manaCost: { generic: 3 },
  supertypes: ['legendary'],
  keywordAbilities: [{ kind: 'indestructible' }],
} as const;

const WARDED_GLADE = {
  kind: 'land',
  id: 'xmp-warded-glade',
  name: 'Warded Glade',
  rarity: 'rare',
  set: { code: 'XMP', collectorNumber: 2 },
  keywordAbilities: [{ kind: 'hexproof' }],
  producesMana: ['G'],
} as const;

describe('keyword abilities on noncreature permanents', () => {
  it('accepts an indestructible legendary artifact', () => {
    expect(validateCard(TRISIGIL)).toEqual([]);
  });

  it('accepts hexproof on every permanent type', () => {
    expect(validateCard(WARDED_GLADE)).toEqual([]);
    expect(
      validateCard({
        kind: 'enchantment',
        id: 'xmp-hexproof-enchantment',
        name: 'Sheltering Charm',
        rarity: 'rare',
        set: { code: 'XMP', collectorNumber: 3 },
        manaCost: { generic: 1, W: 1 },
        colors: ['W'],
        keywordAbilities: [{ kind: 'hexproof' }, { kind: 'indestructible' }],
      }),
    ).toEqual([]);
    expect(
      validateCard({
        kind: 'planeswalker',
        id: 'xmp-hexproof-walker',
        name: 'Sheltered Scholar',
        rarity: 'mythic',
        set: { code: 'XMP', collectorNumber: 4 },
        manaCost: { generic: 2, U: 1 },
        colors: ['U'],
        supertypes: ['legendary'],
        subtypes: ['Scholar'],
        startingLoyalty: 3,
        // A loyalty ability is an activated ability carrying a signed
        // `loyaltyCost`, not a card field of its own — `CardSchema` declares no
        // `loyaltyAbilities`, and until `mtg-nhyv.69` such a key was dropped
        // instead of named, so this walker used to be validated with no
        // abilities on it at all.
        abilities: [
          {
            kind: 'activated',
            loyaltyCost: 1,
            cost: { mana: {} },
            effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
          },
        ],
        keywordAbilities: [{ kind: 'hexproof' }],
      }),
    ).toEqual([]);
  });

  it('still refuses the combat-shaped kinds on a noncreature, and names which one', () => {
    const found = validateCard({
      kind: 'artifact',
      id: 'xmp-illegal-rock',
      name: 'Illegal Rock',
      rarity: 'common',
      set: { code: 'XMP', collectorNumber: 5 },
      manaCost: { generic: 2 },
      keywordAbilities: [{ kind: 'defender' }, { kind: 'landwalk', landType: 'Swamp' }],
    });
    expect(found.map((entry) => entry.code)).toEqual([
      'KEYWORD_ILLEGAL_ON_CARD_TYPE',
      'KEYWORD_ILLEGAL_ON_CARD_TYPE',
    ]);
    expect(found[0]?.path).toBe('keywordAbilities[0]');
    expect(found[0]?.message).toContain('defender');
    expect(found[0]?.message).toContain('artifact');
    expect(found[1]?.path).toBe('keywordAbilities[1]');
    expect(found[1]?.message).toContain('landwalk');
  });

  it('refuses protection on a noncreature, which is scope and not a rule', () => {
    expect(
      validateCard({
        kind: 'enchantment',
        id: 'xmp-illegal-protection',
        name: 'Illegal Charm',
        rarity: 'common',
        set: { code: 'XMP', collectorNumber: 6 },
        manaCost: { W: 1 },
        colors: ['W'],
        keywordAbilities: [{ kind: 'protection', quality: { kind: 'color', color: 'B' } }],
      }),
    ).toContainEqual(
      expect.objectContaining({ code: 'KEYWORD_ILLEGAL_ON_CARD_TYPE', path: 'keywordAbilities[0]' }),
    );
  });

  it('refuses indestructible and hexproof on a card that is not a permanent at all', () => {
    for (const kind of ['instant', 'sorcery'] as const) {
      const found = validateCard({
        kind,
        id: `xmp-illegal-${kind}`,
        name: `Illegal ${kind}`,
        rarity: 'common',
        set: { code: 'XMP', collectorNumber: 7 },
        manaCost: { generic: 1 },
        effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
        keywordAbilities: [{ kind: 'indestructible' }, { kind: 'hexproof' }],
      });
      expect(found.map((entry) => entry.code)).toEqual([
        'KEYWORD_ILLEGAL_ON_CARD_TYPE',
        'KEYWORD_ILLEGAL_ON_CARD_TYPE',
      ]);
      expect(found[0]?.message).toContain('indestructible');
    }
  });

  it('prints the ability line on the noncreature permanents that may now carry it', () => {
    expect(renderOracleText(parseCard(TRISIGIL))).toContain('Indestructible');
    expect(renderOracleText(parseCard(WARDED_GLADE))).toContain('Hexproof');
  });
});
