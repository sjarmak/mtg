/** Exact hand-authored vocabulary and Oracle text for RTR Ash Zealot. */
import { describe, expect, it } from 'vitest';
import {
  AbilitySchema,
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  TRIGGERING_PLAYER_CONDITIONS,
  TRIGGER_CONDITIONS,
  parseCard,
  renderOracleText,
  safeParseCard,
  validateCard,
} from '@mtg/dsl';

const GRAVEYARD_CAST = 'youCastSpell' as const;
const ASH_TRIGGER = {
  kind: 'triggered' as const,
  condition: GRAVEYARD_CAST,
  castFromGraveyardByAnyPlayer: true as const,
  printedSourceReference: 'thisCreature' as const,
  effects: [
    {
      kind: 'dealDamage' as const,
      amount: 3,
      target: { kind: 'triggeringPlayer' as const },
    },
  ],
};

const ASH_ZEALOT = parseCard({
  kind: 'creature',
  id: 'rtr-086-ash-zealot',
  name: 'Ash Zealot',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 86 },
  manaCost: { R: 2 },
  colors: ['R'],
  subtypes: ['Human', 'Warrior'],
  keywords: ['firstStrike', 'haste'],
  keywordLineGroups: [['firstStrike', 'haste']],
  power: 2,
  toughness: 2,
  abilities: [ASH_TRIGGER],
});

describe('Ash Zealot in the DSL', () => {
  it('parses and renders the exact current Oracle text in printed order', () => {
    expect(validateCard(ASH_ZEALOT)).toEqual([]);
    expect(renderOracleText(ASH_ZEALOT)).toBe(
      'First strike, haste\nWhenever a player casts a spell from a graveyard, this creature deals 3 damage to that player.',
    );
  });

  it('retains the caster while keeping the trigger outside model output', () => {
    expect(TRIGGER_CONDITIONS).toContain(GRAVEYARD_CAST);
    expect(TRIGGERING_PLAYER_CONDITIONS).toContain(GRAVEYARD_CAST);
    expect(MODEL_TRIGGER_CONDITIONS).not.toContain(GRAVEYARD_CAST);
    expect(AbilitySchema.safeParse(ASH_TRIGGER).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(ASH_TRIGGER).success).toBe(false);
  });

  it('keeps origin, player scope, and caster retention in one indivisible bundle', () => {
    expect(
      AbilitySchema.safeParse({
        ...ASH_TRIGGER,
        condition: 'selfEnters',
      }).success,
    ).toBe(false);
    expect(
      AbilitySchema.safeParse({
        ...ASH_TRIGGER,
        spellIsMulticolored: true,
      }).success,
    ).toBe(false);
    const { castFromGraveyardByAnyPlayer: _bundle, ...ordinaryCastTrigger } = ASH_TRIGGER;
    expect(
      safeParseCard({
        ...ASH_ZEALOT,
        abilities: [ordinaryCastTrigger],
      }).ok,
    ).toBe(false);
  });
});
