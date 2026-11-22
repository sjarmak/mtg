import { describe, expect, it } from 'vitest';
import {
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  ModelEffectSchema,
  parseCard,
  renderCard,
  renderOracleText,
  safeParseCard,
  type CardInput,
} from '@mtg/dsl';

export const SERRA_AVATAR_INPUT = {
  kind: 'creature',
  id: 'm13-32-serra-avatar',
  name: 'Serra Avatar',
  rarity: 'mythic',
  set: { code: 'M13', collectorNumber: 32 },
  manaCost: { generic: 4, W: 3 },
  colors: ['W'],
  subtypes: ['Avatar'],
  power: 0,
  toughness: 0,
  characteristicPowerToughness: { kind: 'controllerLifeTotal' },
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfPutIntoGraveyardFromAnywhere',
      effects: [{ kind: 'shuffleSourceIntoOwnerLibrary' }],
    },
  ],
} as const satisfies CardInput;

describe('M13 Serra Avatar', () => {
  it('renders the exact pinned Oracle text and characteristic stars', () => {
    const card = parseCard(SERRA_AVATAR_INPUT);
    expect(renderOracleText(card)).toBe(
      "Serra Avatar's power and toughness are each equal to your life total.\n" +
        "When Serra Avatar is put into a graveyard from anywhere, shuffle it into its owner's library.",
    );
    expect(renderCard(card)).toMatch(/\*\/\*$/);
  });

  it('keeps both exact-only pieces outside the generator model', () => {
    const ability = SERRA_AVATAR_INPUT.abilities[0];
    expect(MODEL_TRIGGER_CONDITIONS).not.toContain(ability.condition);
    expect(ModelAbilitySchema.safeParse(ability).success).toBe(false);
    expect(ModelEffectSchema.safeParse(ability.effects[0]).success).toBe(false);
  });

  it('refuses the source effect outside its exact from-anywhere trigger', () => {
    const result = safeParseCard({
      ...SERRA_AVATAR_INPUT,
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfDies',
          effects: [{ kind: 'shuffleSourceIntoOwnerLibrary' }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Serra Avatar source movement escaped its retained trigger');
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'ABILITY_ILLEGAL_ON_CARD_TYPE',
          path: 'abilities[0].effects[0]',
        }),
      ]),
    );
  });
});
