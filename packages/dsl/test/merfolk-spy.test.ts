/** Exact hand-authored vocabulary and printed text for M11 Merfolk Spy. */
import { describe, expect, it } from 'vitest';
import type { CardInput, TargetKind, TriggerCondition } from '@mtg/dsl';
import {
  AbilitySchema,
  ALL_EFFECT_KINDS,
  CardEffectSchema,
  MODEL_EFFECT_KINDS,
  MODEL_TARGET_KINDS,
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  ModelEffectSchema,
  renderOracleText,
  TARGET_KINDS,
  TRIGGERING_PLAYER_CONDITIONS,
  TRIGGER_CONDITIONS,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';

const DAMAGE_TO_PLAYER = 'selfDealsCombatDamageToPlayer' as TriggerCondition;
const TRIGGERING_PLAYER = 'triggeringPlayer' as TargetKind;
const RANDOM_REVEAL = {
  kind: 'revealRandomCardFromHand',
  target: { kind: TRIGGERING_PLAYER },
};
const SPY_TRIGGER = {
  kind: 'triggered',
  condition: DAMAGE_TO_PLAYER,
  effects: [RANDOM_REVEAL],
};

function input(): CardInput {
  return {
    kind: 'creature',
    id: 'm11-066-merfolk-spy',
    name: 'Merfolk Spy',
    rarity: 'common',
    set: { code: 'M11', collectorNumber: 66 },
    manaCost: { U: 1 },
    colors: ['U'],
    subtypes: ['Merfolk', 'Rogue'],
    power: 1,
    toughness: 1,
    keywordAbilities: [{ kind: 'landwalk', landType: 'Island' }],
    abilities: [SPY_TRIGGER],
  } as unknown as CardInput;
}

describe('Merfolk Spy DSL', () => {
  it('keeps the retained player and random reveal outside the generator schema', () => {
    expect(TRIGGER_CONDITIONS).toContain(DAMAGE_TO_PLAYER);
    expect(TRIGGERING_PLAYER_CONDITIONS).toContain(DAMAGE_TO_PLAYER);
    expect(MODEL_TRIGGER_CONDITIONS).not.toContain(DAMAGE_TO_PLAYER);
    expect(TARGET_KINDS).toContain(TRIGGERING_PLAYER);
    expect(MODEL_TARGET_KINDS).not.toContain(TRIGGERING_PLAYER);
    expect(ALL_EFFECT_KINDS).toContain('revealRandomCardFromHand');
    expect(MODEL_EFFECT_KINDS).not.toContain('revealRandomCardFromHand');
    expect(CardEffectSchema.safeParse(RANDOM_REVEAL).success).toBe(true);
    expect(ModelEffectSchema.safeParse(RANDOM_REVEAL).success).toBe(false);
  });

  it('is hand-authorable but outside the model ability schema', () => {
    expect(AbilitySchema.safeParse(SPY_TRIGGER).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(SPY_TRIGGER).success).toBe(false);
  });

  it('renders the exact current Oracle text', () => {
    const card = parseCard(input());
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'Islandwalk\nWhenever Merfolk Spy deals combat damage to a player, that player reveals a card at random from their hand.',
    );
  });

  it('rejects the retained player outside a trigger that supplies it', () => {
    const wrongTrigger = {
      ...input(),
      abilities: [{ ...SPY_TRIGGER, condition: 'beginningOfYourUpkeep' }],
    } as unknown as CardInput;
    const spell = {
      kind: 'sorcery',
      id: 'illegal-random-hand-reveal',
      name: 'Illegal Random Hand Reveal',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { U: 1 },
      colors: ['U'],
      effects: [RANDOM_REVEAL],
    } as unknown as CardInput;

    expect(() => parseCard(wrongTrigger)).toThrow(/triggeringPlayer/u);
    expect(() => parseCard(spell)).toThrow(/triggeringPlayer/u);
  });
});
