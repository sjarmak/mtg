/** Exact hand-authored vocabulary and printed text for M11 Liliana's Caress. */
import { describe, expect, it } from 'vitest';
import type { CardInput, TargetKind, TriggerCondition } from '@mtg/dsl';
import {
  AbilitySchema,
  MODEL_TARGET_KINDS,
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  renderOracleText,
  TARGET_KINDS,
  TRIGGER_CONDITIONS,
  TRIGGER_PRINT_TEMPLATES,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';

const OPPONENT_DISCARDS_CARD = 'opponentDiscardsCard' as TriggerCondition;
const TRIGGERING_PLAYER = 'triggeringPlayer' as TargetKind;
const CARESS_TRIGGER = {
  kind: 'triggered',
  condition: OPPONENT_DISCARDS_CARD,
  effects: [{ kind: 'loseLife', amount: 2, target: { kind: TRIGGERING_PLAYER } }],
};

function input(): CardInput {
  return {
    kind: 'enchantment',
    id: 'm11-103-lilianas-caress',
    name: "Liliana's Caress",
    rarity: 'uncommon',
    set: { code: 'M11', collectorNumber: 103 },
    manaCost: { generic: 1, B: 1 },
    colors: ['B'],
    abilities: [CARESS_TRIGGER],
  } as CardInput;
}

describe("Liliana's Caress DSL", () => {
  it('keeps both event-referent vocabulary members out of the generator schema', () => {
    expect(TRIGGER_CONDITIONS).toContain(OPPONENT_DISCARDS_CARD);
    expect(MODEL_TRIGGER_CONDITIONS).not.toContain(OPPONENT_DISCARDS_CARD);
    expect(TARGET_KINDS).toContain(TRIGGERING_PLAYER);
    expect(MODEL_TARGET_KINDS).not.toContain(TRIGGERING_PLAYER);
  });

  it('is hand-authorable but outside the model schema', () => {
    expect(AbilitySchema.safeParse(CARESS_TRIGGER).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(CARESS_TRIGGER).success).toBe(false);
  });

  it('owns its printed condition and exact Oracle sentence', () => {
    expect(TRIGGER_PRINT_TEMPLATES[OPPONENT_DISCARDS_CARD]).toBe('Whenever an opponent discards a card,');
    const card = parseCard(input());
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe('Whenever an opponent discards a card, that player loses 2 life.');
  });

  it('rejects the retained player outside its matching trigger event', () => {
    const wrongTrigger = {
      ...input(),
      abilities: [{ ...CARESS_TRIGGER, condition: 'beginningOfYourUpkeep' }],
    } as unknown as CardInput;
    const spell = {
      kind: 'sorcery',
      id: 'illegal-triggering-player-spell',
      name: 'Illegal Triggering Player Spell',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { B: 1 },
      colors: ['B'],
      effects: [{ kind: 'loseLife', amount: 2, target: { kind: TRIGGERING_PLAYER } }],
    } as unknown as CardInput;

    expect(() => parseCard(wrongTrigger)).toThrow(/triggeringPlayer/u);
    expect(() => parseCard(spell)).toThrow(/triggeringPlayer/u);
  });

  it('rejects a matching trigger when its effect cannot act on a player', () => {
    const card = {
      ...input(),
      abilities: [
        {
          kind: 'triggered',
          condition: OPPONENT_DISCARDS_CARD,
          effects: [{ kind: 'destroyPermanent', target: { kind: TRIGGERING_PLAYER } }],
        },
      ],
    } as unknown as CardInput;

    expect(() => parseCard(card)).toThrow(/destroyPermanent cannot use "triggeringPlayer"/u);
  });
});
