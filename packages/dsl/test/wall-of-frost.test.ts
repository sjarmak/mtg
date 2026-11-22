/** Exact hand-authored vocabulary and printed text for M11 Wall of Frost. */
import { describe, expect, it } from 'vitest';
import type { CardInput, TriggerCondition } from '@mtg/dsl';
import {
  AbilitySchema,
  CardEffectSchema,
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  ModelEffectSchema,
  renderOracleText,
  TRIGGER_CONDITIONS,
  TRIGGER_PRINT_TEMPLATES,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';

const BLOCKS_CREATURE = 'selfBlocksCreature' as TriggerCondition;
const SKIP_UNTAP = {
  kind: 'skipNextUntap',
  target: { kind: 'triggeringCreature' },
};
const FROST_TRIGGER = {
  kind: 'triggered',
  condition: BLOCKS_CREATURE,
  effects: [SKIP_UNTAP],
};

function input(): CardInput {
  return {
    kind: 'creature',
    id: 'm11-079-wall-of-frost',
    name: 'Wall of Frost',
    rarity: 'uncommon',
    set: { code: 'M11', collectorNumber: 79 },
    manaCost: { generic: 1, U: 2 },
    colors: ['U'],
    subtypes: ['Wall'],
    power: 0,
    toughness: 7,
    keywords: [],
    keywordAbilities: [{ kind: 'defender' }],
    abilities: [FROST_TRIGGER],
  } as unknown as CardInput;
}

describe('Wall of Frost DSL', () => {
  it('keeps the block-pair condition and untap debt out of the generator schema', () => {
    expect(TRIGGER_CONDITIONS).toContain(BLOCKS_CREATURE);
    expect(MODEL_TRIGGER_CONDITIONS).not.toContain(BLOCKS_CREATURE);
    expect(CardEffectSchema.safeParse(SKIP_UNTAP).success).toBe(true);
    expect(ModelEffectSchema.safeParse(SKIP_UNTAP).success).toBe(false);
    expect(AbilitySchema.safeParse(FROST_TRIGGER).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(FROST_TRIGGER).success).toBe(false);
  });

  it('owns its printed condition and exact Oracle text', () => {
    expect(TRIGGER_PRINT_TEMPLATES[BLOCKS_CREATURE]).toBe('Whenever {name} blocks a creature,');
    const card = parseCard(input());
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      "Defender\nWhenever Wall of Frost blocks a creature, that creature doesn't untap during its controller's next untap step.",
    );
  });

  it('rejects the retained creature outside its matching block-pair trigger', () => {
    const wrongTrigger = {
      ...input(),
      abilities: [{ ...FROST_TRIGGER, condition: 'selfBlocks' }],
    } as unknown as CardInput;
    const spell = {
      kind: 'instant',
      id: 'illegal-triggered-untap-debt',
      name: 'Illegal Triggered Untap Debt',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { U: 1 },
      colors: ['U'],
      effects: [SKIP_UNTAP],
    } as unknown as CardInput;

    expect(() => parseCard(wrongTrigger)).toThrow(/triggeringCreature/u);
    expect(() => parseCard(spell)).toThrow(/triggeringCreature/u);
  });

  it('rejects a skip effect aimed at something that is not a permanent', () => {
    const card = {
      ...input(),
      abilities: [
        {
          ...FROST_TRIGGER,
          effects: [{ kind: 'skipNextUntap', target: { kind: 'targetPlayer' } }],
        },
      ],
    } as unknown as CardInput;

    expect(() => parseCard(card)).toThrow(/skipNextUntap cannot use "targetPlayer"/u);
  });

  it('does not let a retained creature bypass an effect own target contract', () => {
    const card = {
      ...input(),
      abilities: [
        {
          ...FROST_TRIGGER,
          effects: [{ kind: 'drawCards', count: 1, target: { kind: 'triggeringCreature' } }],
        },
      ],
    } as unknown as CardInput;

    expect(() => parseCard(card)).toThrow(/drawCards cannot use "triggeringCreature"/u);
  });
});
