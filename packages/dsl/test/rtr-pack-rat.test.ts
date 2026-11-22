/** RTR #73 as a source-copy activation over a subtype-counted CDA. */
import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, safeParseCard } from '@mtg/dsl';

export const PACK_RAT_INPUT = {
  kind: 'creature' as const,
  id: 'rtr-073-pack-rat',
  name: 'Pack Rat',
  rarity: 'rare' as const,
  set: { code: 'RTR', collectorNumber: 73 },
  colors: ['B' as const],
  manaCost: { generic: 1, B: 1 },
  power: 0,
  toughness: 0,
  subtypes: ['Rat'],
  characteristicPowerToughness: { kind: 'controlledSubtype' as const, subtype: 'Rat' },
  abilities: [
    {
      kind: 'activated' as const,
      cost: { mana: { generic: 2, B: 1 }, discard: 1 },
      effects: [{ kind: 'createTokenCopyOfSelf' as const }],
    },
  ],
};

describe('RTR Pack Rat DSL', () => {
  it('renders current Oracle exactly and keeps source-copy creation outside model output', () => {
    const card = parseCard(PACK_RAT_INPUT);
    expect(renderOracleText(card)).toBe(
      "Pack Rat's power and toughness are each equal to the number of Rats you control.\n{2}{B}, Discard a card: Create a token that's a copy of this creature.",
    );
    const ability = card.abilities[0];
    expect(ability?.kind).toBe('activated');
    expect(
      ModelEffectSchema.safeParse(ability?.kind === 'activated' ? ability.effects[0] : undefined).success,
    ).toBe(false);
  });

  it('refuses a missing subtype and an independently widened copy effect', () => {
    expect(
      safeParseCard({
        ...PACK_RAT_INPUT,
        characteristicPowerToughness: { kind: 'controlledSubtype', subtype: '' },
      }).ok,
    ).toBe(false);
    expect(
      safeParseCard({
        ...PACK_RAT_INPUT,
        abilities: [
          {
            ...PACK_RAT_INPUT.abilities[0],
            effects: [{ kind: 'createTokenCopyOfSelf', count: 2 }],
          },
        ],
      }).ok,
    ).toBe(false);
    expect(
      safeParseCard({
        ...PACK_RAT_INPUT,
        abilities: [
          {
            ...PACK_RAT_INPUT.abilities[0],
            cost: { mana: { generic: 1, B: 1 }, discard: 1 },
          },
        ],
      }).ok,
    ).toBe(false);
    expect(
      safeParseCard({
        kind: 'sorcery',
        id: 'illegal-source-copy-spell',
        name: 'Illegal Source Copy Spell',
        rarity: 'rare',
        set: { code: 'TST', collectorNumber: 1 },
        colors: ['B'],
        manaCost: { generic: 2, B: 1 },
        effects: [{ kind: 'createTokenCopyOfSelf' }],
      }).ok,
    ).toBe(false);
  });
});
