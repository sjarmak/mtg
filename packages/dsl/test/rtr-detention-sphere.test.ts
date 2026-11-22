/** Detention Sphere's closed target-and-same-name linked-exile bundle. */
import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, safeParseCard } from '../src/index';

export const DETENTION_SPHERE = {
  kind: 'enchantment',
  id: 'rtr-155-detention-sphere',
  name: 'Detention Sphere',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 155 },
  manaCost: { generic: 1, W: 1, U: 1 },
  colors: ['W', 'U'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      printedSourceReference: 'thisEnchantment',
      optional: true,
      effects: [
        {
          kind: 'exileTarget',
          target: { kind: 'targetPermanent', filter: { excludeCardTypes: ['land'] } },
          linkToSource: true,
          sameNameCohort: { excludedName: 'Detention Sphere' },
        },
      ],
    },
    {
      kind: 'triggered',
      condition: 'selfLeavesBattlefield',
      printedSourceReference: 'thisEnchantment',
      effects: [{ kind: 'moveSourceLinkedExile', destination: 'battlefieldUnderOwner', plural: true }],
    },
  ],
} as const;

describe('Detention Sphere DSL', () => {
  it('renders the exact current Oracle text and stays outside the model', () => {
    const card = parseCard(DETENTION_SPHERE);
    expect(renderOracleText(card)).toBe(
      'When this enchantment enters, you may exile target nonland permanent not named Detention Sphere and all other permanents with the same name as that permanent.\n' +
        "When this enchantment leaves the battlefield, return the exiled cards to the battlefield under their owner's control.",
    );
    expect(ModelEffectSchema.safeParse(DETENTION_SPHERE.abilities[0].effects[0]).success).toBe(false);
    expect(ModelEffectSchema.safeParse(DETENTION_SPHERE.abilities[1].effects[0]).success).toBe(false);
  });

  it.each([
    { optional: undefined },
    {
      effects: [
        {
          ...DETENTION_SPHERE.abilities[0].effects[0],
          sameNameCohort: { excludedName: 'Another Name' },
        },
      ],
    },
    {
      effects: [
        {
          ...DETENTION_SPHERE.abilities[0].effects[0],
          target: { kind: 'targetPermanent' },
        },
      ],
    },
  ])('refuses a widened enters bundle %#', (change) => {
    const result = safeParseCard({
      ...DETENTION_SPHERE,
      abilities: [{ ...DETENTION_SPHERE.abilities[0], ...change }, DETENTION_SPHERE.abilities[1]],
    });
    expect(result.ok).toBe(false);
  });

  it.each([{ plural: undefined }, { destination: 'hand' }])(
    'refuses a widened linked return %#',
    (change) => {
      const result = safeParseCard({
        ...DETENTION_SPHERE,
        abilities: [
          DETENTION_SPHERE.abilities[0],
          {
            ...DETENTION_SPHERE.abilities[1],
            effects: [{ ...DETENTION_SPHERE.abilities[1].effects[0], ...change }],
          },
        ],
      });
      expect(result.ok).toBe(false);
    },
  );
});
