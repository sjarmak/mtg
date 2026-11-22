/** Necrotic Plague's granted upkeep trigger and attachment-relative death trigger. */
import { describe, expect, it } from 'vitest';
import {
  ALL_EFFECT_KINDS,
  AuraSchema,
  CardEffectSchema,
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  ModelAuraSchema,
  ModelEffectSchema,
  TRIGGER_CONDITIONS,
  UNPRICED_EFFECT_KINDS,
  parseCard,
  renderOracleText,
  safeParseCard,
} from '@mtg/dsl';

export const NECROTIC_PLAGUE = {
  kind: 'enchantment',
  id: 'm11-necrotic-plague',
  name: 'Necrotic Plague',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 107 },
  manaCost: { generic: 2, B: 2 },
  colors: ['B'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [
      {
        kind: 'grantTriggeredAbility',
        ability: {
          kind: 'triggered',
          condition: 'beginningOfYourUpkeep',
          effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfCreature' } }],
        },
      },
    ],
  },
  abilities: [
    {
      kind: 'triggered',
      condition: 'enchantedCreatureDies',
      targetChooser: 'triggeringPlayer',
      effects: [
        {
          kind: 'returnSourceAuraAttached',
          target: { kind: 'targetCreatureYouDontControl' },
        },
      ],
    },
  ],
} as const;

describe('Necrotic Plague DSL vocabulary', () => {
  it('parses and renders current Oracle text exactly', () => {
    const card = parseCard(NECROTIC_PLAGUE);
    expect(renderOracleText(card)).toBe(
      'Enchant creature\n' +
        'Enchanted creature has "At the beginning of your upkeep, sacrifice this creature."\n' +
        "When enchanted creature dies, its controller chooses target creature one of their opponents controls. Return this card from its owner's graveyard to the battlefield attached to that creature.",
    );
  });

  it('keeps every new word hand-authored while preserving model containment', () => {
    const card = parseCard(NECROTIC_PLAGUE);
    if (card.kind !== 'enchantment') throw new Error('Necrotic Plague must remain an enchantment');
    const deathTrigger = card.abilities[0];
    if (deathTrigger?.kind !== 'triggered') throw new Error('Necrotic Plague lost its death trigger');
    expect(AuraSchema.safeParse(card.aura).success).toBe(true);
    expect(ModelAuraSchema.safeParse(card.aura).success).toBe(false);
    expect(ModelAbilitySchema.safeParse(deathTrigger).success).toBe(false);
    expect(TRIGGER_CONDITIONS).toContain('enchantedCreatureDies');
    expect(MODEL_TRIGGER_CONDITIONS as readonly string[]).not.toContain('enchantedCreatureDies');
    expect(CardEffectSchema.safeParse(deathTrigger.effects[0]).success).toBe(true);
    expect(ModelEffectSchema.safeParse(deathTrigger.effects[0]).success).toBe(false);
    expect(ALL_EFFECT_KINDS).toContain('returnSourceAuraAttached');
    expect(UNPRICED_EFFECT_KINDS).toContain('returnSourceAuraAttached');
  });

  it('refuses a granted trigger outside an Aura and the death watch outside a creature Aura', () => {
    const blanket = safeParseCard({
      ...NECROTIC_PLAGUE,
      id: 'tst-necrotic-blanket',
      name: 'Necrotic Blanket',
      subtypes: [],
      aura: undefined,
    });
    expect(blanket.ok).toBe(false);
    if (!blanket.ok) {
      expect(blanket.violations.map(({ code }) => code)).toContain('ABILITY_ILLEGAL_ON_CARD_TYPE');
    }
  });
});
