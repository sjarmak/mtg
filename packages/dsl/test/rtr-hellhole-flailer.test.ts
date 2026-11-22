/** Exact RTR activation-LKI authoring without exposing it to model output. */
import { ModelEffectSchema, parseCard, renderOracleText, type CardInput } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const NAME = 'Hellhole Flailer';
const DAMAGE = {
  kind: 'dealDamage' as const,
  amount: { kind: 'paidSacrificePower' as const },
  target: { kind: 'targetPlayerOrPlaneswalker' as const },
};

const HELLHOLE = {
  kind: 'creature' as const,
  id: 'rtr-167-hellhole-flailer',
  name: NAME,
  rarity: 'uncommon' as const,
  set: { code: 'RTR', collectorNumber: 167 },
  manaCost: { generic: 1, B: 1, R: 1 },
  colors: ['B', 'R'],
  subtypes: ['Ogre', 'Warrior'],
  power: 3,
  toughness: 2,
  keywordAbilities: [{ kind: 'unleash' as const }],
  abilities: [
    {
      kind: 'activated' as const,
      cost: { mana: { generic: 2, B: 1, R: 1 }, sacrificeSelf: true },
      effects: [DAMAGE],
    },
  ],
};

describe('the RTR source-sacrifice activation', () => {
  it('renders the exact current Oracle text from reusable data', () => {
    expect(renderOracleText(parseCard(HELLHOLE as CardInput))).toBe(
      'Unleash\n{2}{B}{R}, Sacrifice this creature: It deals damage equal to its power to target player or planeswalker.',
    );
  });

  it('requires exactly one permanent sacrifice when an activation reads paid power', () => {
    expect(() =>
      parseCard({
        ...HELLHOLE,
        abilities: [{ ...HELLHOLE.abilities[0], cost: { mana: { generic: 2 } } }],
      } as CardInput),
    ).toThrow(/paid-sacrifice-power|exactly one permanent/iu);
    expect(() =>
      parseCard({
        ...HELLHOLE,
        abilities: [
          {
            ...HELLHOLE.abilities[0],
            cost: {
              mana: { generic: 2 },
              sacrificeSelf: true,
              sacrificeOther: { count: 1, subtype: 'Goblin' },
            },
          },
        ],
      } as CardInput),
    ).toThrow(/paid-sacrifice-power|exactly one permanent/iu);
  });

  it('keeps the activation-only amount outside the model effect schema', () => {
    expect(ModelEffectSchema.safeParse(DAMAGE).success).toBe(false);
  });
});
