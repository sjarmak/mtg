/** Authored DSL shape for Chandra Nalaar's variable loyalty and ultimate. */
import { describe, expect, it } from 'vitest';
import { ModelAbilitySchema, ModelEffectSchema, parseCard, renderOracleText, type CardInput } from '@mtg/dsl';

const CHANDRA_INPUT = {
  kind: 'planeswalker',
  id: 'm11-127-chandra-nalaar',
  name: 'Chandra Nalaar',
  rarity: 'mythic',
  set: { code: 'M11', collectorNumber: 127 },
  manaCost: { generic: 3, R: 2 },
  colors: ['R'],
  supertypes: ['legendary'],
  subtypes: ['Chandra'],
  startingLoyalty: 6,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: false, sacrificeSelf: false },
      loyaltyCost: 1,
      effects: [
        {
          kind: 'dealDamage',
          amount: 1,
          target: { kind: 'targetPlayerOrPlaneswalker' },
        },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: false, sacrificeSelf: false },
      loyaltyCost: { kind: 'removeChosenX' },
      effects: [
        {
          kind: 'dealDamage',
          amount: { kind: 'chosenX' },
          target: { kind: 'targetCreature' },
        },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: false, sacrificeSelf: false },
      loyaltyCost: -8,
      effects: [
        {
          kind: 'dealDamage',
          amount: 10,
          target: { kind: 'targetPlayerOrPlaneswalker' },
          scope: 'targetAndPermanentsItsPlayerControls',
          scopeFilter: { cardTypes: ['creature'] },
        },
      ],
    },
  ],
} as const satisfies CardInput;

describe('Chandra Nalaar authored DSL', () => {
  it('prints all three current Oracle abilities exactly', () => {
    const card = parseCard(CHANDRA_INPUT);
    expect(renderOracleText(card)).toBe(
      '[+1]: Chandra Nalaar deals 1 damage to target player or planeswalker.\n' +
        '[−X]: Chandra Nalaar deals X damage to target creature.\n' +
        "[−8]: Chandra Nalaar deals 10 damage to target player or planeswalker and each creature that player or that planeswalker's controller controls.",
    );
  });

  it('keeps both authored additions outside the model output schemas', () => {
    expect(ModelAbilitySchema.safeParse(CHANDRA_INPUT.abilities[1]).success).toBe(false);
    expect(ModelEffectSchema.safeParse(CHANDRA_INPUT.abilities[2].effects[0]).success).toBe(false);
  });
});
