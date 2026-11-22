/** Ice Cage's hand-authored Aura lock and attached-host target trigger. */
import { describe, expect, it } from 'vitest';
import {
  AbilitySchema,
  AuraSchema,
  HAND_AUTHORED_TARGETS,
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  ModelAuraSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  TRIGGER_CONDITIONS,
} from '@mtg/dsl';

const ATTACHED_HOST_TARGETED = 'enchantedCreatureBecomesTarget';

const ICE_CAGE = {
  kind: 'enchantment',
  id: 'm11-ice-cage',
  name: 'Ice Cage',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 57 },
  manaCost: { generic: 1, U: 1 },
  colors: ['U'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [{ kind: 'cantAttack' }, { kind: 'cantBlock' }, { kind: 'cantActivateAbilities' }],
  },
  abilities: [
    {
      kind: 'triggered',
      condition: ATTACHED_HOST_TARGETED,
      effects: [{ kind: 'destroyPermanent', target: { kind: 'selfPermanent' } }],
    },
  ],
} as const;

describe('Ice Cage DSL vocabulary', () => {
  it('keeps the third Aura modification and target trigger hand-authored', () => {
    expect(AuraSchema.safeParse(ICE_CAGE.aura).success).toBe(true);
    expect(ModelAuraSchema.safeParse(ICE_CAGE.aura).success).toBe(false);
    expect(
      AuraSchema.safeParse({
        ...ICE_CAGE.aura,
        modifications: [...ICE_CAGE.aura.modifications, { kind: 'cantBeBlocked' }],
      }).success,
    ).toBe(false);

    expect(TRIGGER_CONDITIONS as readonly string[]).toContain(ATTACHED_HOST_TARGETED);
    expect(MODEL_TRIGGER_CONDITIONS as readonly string[]).not.toContain(ATTACHED_HOST_TARGETED);
    expect(HAND_AUTHORED_TARGETS.destroyPermanent).toContain('selfPermanent');
    expect(AbilitySchema.safeParse(ICE_CAGE.abilities[0]).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(ICE_CAGE.abilities[0]).success).toBe(false);
  });

  it('parses and renders current Oracle text exactly', () => {
    expect(renderOracleText(parseCard(ICE_CAGE))).toBe(
      'Enchant creature\n' +
        "Enchanted creature can't attack or block, and its activated abilities can't be activated.\n" +
        'When enchanted creature becomes the target of a spell or ability, destroy this Aura.',
    );
  });

  it('refuses an attached-host trigger on a non-Aura', () => {
    const result = safeParseCard({
      ...ICE_CAGE,
      id: 'tst-frozen-field',
      name: 'Frozen Field',
      subtypes: [],
      aura: undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.map(({ code }) => code)).toContain('ABILITY_ILLEGAL_ON_CARD_TYPE');
    }
  });
});
