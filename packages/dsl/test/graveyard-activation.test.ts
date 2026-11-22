/** Exact authored shape for abilities whose source card activates from a graveyard. */
import { describe, expect, it } from 'vitest';
import {
  ModelAbilitySchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  type CardInput,
} from '@mtg/dsl';

function skeleton(overrides: Record<string, unknown> = {}): CardInput {
  return {
    kind: 'creature',
    id: 'tst-reassembling-skeleton',
    name: 'Reassembling Skeleton',
    rarity: 'uncommon',
    set: { code: 'M11', collectorNumber: 112 },
    colors: ['B'],
    manaCost: { generic: 1, B: 1 },
    subtypes: ['Skeleton', 'Warrior'],
    power: 1,
    toughness: 1,
    abilities: [
      {
        kind: 'activated',
        activationZone: 'graveyard',
        cost: { mana: { generic: 1, B: 1 } },
        effects: [{ kind: 'returnSourceFromGraveyard', destination: 'battlefieldTapped' }],
        ...overrides,
      },
    ],
  } as CardInput;
}

describe('graveyard-native activated abilities', () => {
  it('renders Reassembling Skeleton from explicit zone and source-return declarations', () => {
    expect(renderOracleText(parseCard(skeleton()))).toBe(
      '{1}{B}: Return Reassembling Skeleton from your graveyard to the battlefield tapped.',
    );
  });

  it('keeps both declarations outside every generator-facing schema', () => {
    const ability = skeleton().abilities?.[0];
    if (ability === undefined) throw new Error('fixture lost its activation');
    expect(ModelAbilitySchema.safeParse(ability).success).toBe(false);
    expect(
      ModelEffectSchema.safeParse({
        kind: 'returnSourceFromGraveyard',
        destination: 'battlefieldTapped',
      }).success,
    ).toBe(false);
  });

  it('refuses battlefield activation and non-mana payments on the graveyard path', () => {
    const wrongZone = safeParseCard(skeleton({ activationZone: undefined }));
    expect(wrongZone.ok ? [] : wrongZone.violations.map((found) => [found.code, found.path])).toContainEqual([
      'ABILITY_ILLEGAL_ON_CARD_TYPE',
      'abilities[0].effects[0]',
    ]);

    const tapCost = safeParseCard(skeleton({ cost: { mana: { generic: 1, B: 1 }, tapSelf: true } }));
    expect(tapCost.ok ? [] : tapCost.violations.map((found) => [found.code, found.path])).toContainEqual([
      'ABILITY_COST_INVALID',
      'abilities[0].cost',
    ]);
  });
});
