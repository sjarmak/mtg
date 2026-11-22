/** Exact hand-authored vocabulary and printed text for M11 Wild Evocation. */
import { describe, expect, it } from 'vitest';
import type { CardInput, TargetKind, TriggerCondition } from '@mtg/dsl';
import {
  AbilitySchema,
  ALL_EFFECT_KINDS,
  CardEffectSchema,
  MODEL_EFFECT_KINDS,
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  ModelEffectSchema,
  renderOracleText,
  TRIGGERING_PLAYER_CONDITIONS,
  TRIGGER_CONDITIONS,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';

const EACH_UPKEEP = 'beginningOfEachPlayersUpkeep' as TriggerCondition;
const TRIGGERING_PLAYER = 'triggeringPlayer' as TargetKind;
const RANDOM_PLAY = {
  kind: 'playRandomHandCardWithoutPayingManaCost',
  target: { kind: TRIGGERING_PLAYER },
};
const EVOCATION_TRIGGER = {
  kind: 'triggered',
  condition: EACH_UPKEEP,
  effects: [RANDOM_PLAY],
};

function input(): CardInput {
  return {
    kind: 'enchantment',
    id: 'm11-160-wild-evocation',
    name: 'Wild Evocation',
    rarity: 'rare',
    set: { code: 'M11', collectorNumber: 160 },
    manaCost: { generic: 5, R: 1 },
    colors: ['R'],
    abilities: [EVOCATION_TRIGGER],
  } as unknown as CardInput;
}

describe('Wild Evocation DSL', () => {
  it('keeps each-player upkeep and random free play outside the generator schema', () => {
    expect(TRIGGER_CONDITIONS).toContain(EACH_UPKEEP);
    expect(TRIGGERING_PLAYER_CONDITIONS).toContain(EACH_UPKEEP);
    expect(MODEL_TRIGGER_CONDITIONS).not.toContain(EACH_UPKEEP);
    expect(ALL_EFFECT_KINDS).toContain('playRandomHandCardWithoutPayingManaCost');
    expect(MODEL_EFFECT_KINDS).not.toContain('playRandomHandCardWithoutPayingManaCost');
    expect(CardEffectSchema.safeParse(RANDOM_PLAY).success).toBe(true);
    expect(ModelEffectSchema.safeParse(RANDOM_PLAY).success).toBe(false);
  });

  it('is hand-authorable but outside the model ability schema', () => {
    expect(AbilitySchema.safeParse(EVOCATION_TRIGGER).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(EVOCATION_TRIGGER).success).toBe(false);
  });

  it('renders the exact current Oracle text', () => {
    const card = parseCard(input());
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      "At the beginning of each player's upkeep, that player reveals a card at random from their hand. If it's a land card, the player puts it onto the battlefield. Otherwise, the player casts it without paying its mana cost if able.",
    );
  });
});
