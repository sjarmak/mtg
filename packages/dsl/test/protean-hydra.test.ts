/** Protean Hydra's exact, hand-authored rules envelope. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '../src/index';
import {
  AbilitySchema,
  CardEffectSchema,
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  TRIGGER_CONDITIONS,
  validateCard,
} from '../src/index';

const PREVENT_DAMAGE = {
  kind: 'static',
  scope: 'self',
  subtype: null,
  modification: {
    kind: 'preventDamageToSelfAndRemoveCounters',
    counter: 'plusOnePlusOne',
  },
} as const;

const DELAYED_GROWTH = {
  kind: 'triggered',
  condition: 'selfPlusOnePlusOneCounterRemoved',
  effects: [
    {
      kind: 'putCounters',
      counter: 'plusOnePlusOne',
      count: 2,
      target: { kind: 'selfPermanent' },
      timing: 'nextEndStep',
    },
  ],
} as const;

function input(overrides: Partial<CardInput> = {}): CardInput {
  return {
    kind: 'creature',
    id: 'm11-194-protean-hydra',
    name: 'Protean Hydra',
    rarity: 'rare',
    set: { code: 'M11', collectorNumber: 194 },
    manaCost: { hasX: true, G: 1 },
    colors: ['G'],
    subtypes: ['Hydra'],
    power: 0,
    toughness: 0,
    entryReplacement: {
      kind: 'entersWithCounters',
      counter: 'plusOnePlusOne',
      count: { kind: 'chosenX' },
    },
    abilities: [PREVENT_DAMAGE, DELAYED_GROWTH],
    ...overrides,
  } as CardInput;
}

describe('Protean Hydra DSL', () => {
  it('prints the exact M11 rules text from reusable structured machinery', () => {
    const card = parseCard(input());
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'Protean Hydra enters with X +1/+1 counters on it.\n' +
        'If damage would be dealt to Protean Hydra, prevent that damage and remove that many +1/+1 counters from it.\n' +
        'Whenever a +1/+1 counter is removed from Protean Hydra, put two +1/+1 counters on it at the beginning of the next end step.',
    );
  });

  it('keeps every new rule outside the generator-facing schemas', () => {
    expect(TRIGGER_CONDITIONS).toContain('selfPlusOnePlusOneCounterRemoved');
    expect(MODEL_TRIGGER_CONDITIONS).not.toContain('selfPlusOnePlusOneCounterRemoved');
    expect(AbilitySchema.safeParse(PREVENT_DAMAGE).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(PREVENT_DAMAGE).success).toBe(false);
    expect(CardEffectSchema.safeParse(DELAYED_GROWTH.effects[0]).success).toBe(true);
    expect(ModelEffectSchema.safeParse(DELAYED_GROWTH.effects[0]).success).toBe(false);
  });

  it('refuses an entry X with no X in the printed casting cost', () => {
    expect(() => parseCard(input({ manaCost: { generic: 1, G: 1 } }))).toThrow(
      /chosen-X entry count is legal only on a permanent whose mana cost contains X/u,
    );
  });

  it('refuses the self-only prevention replacement on a group scope', () => {
    expect(() =>
      parseCard(
        input({
          abilities: [
            { ...PREVENT_DAMAGE, scope: 'creaturesYouControl' },
            { ...DELAYED_GROWTH, effects: [...DELAYED_GROWTH.effects] },
          ],
        }),
      ),
    ).toThrow(/REPLACEMENT_MODIFICATION_ILLEGAL_ON_SCOPE/u);
  });

  it('refuses delayed counter timing on anything except the source permanent', () => {
    const spell = {
      kind: 'sorcery',
      id: 'tst-delayed-counter-target',
      name: 'Delayed Counter Target',
      rarity: 'uncommon',
      set: { code: 'TST', collectorNumber: 2 },
      manaCost: { generic: 1, G: 1 },
      colors: ['G'],
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 2,
          target: { kind: 'targetCreature' },
          timing: 'nextEndStep',
        },
      ],
    } as unknown as CardInput;
    expect(() => parseCard(spell)).toThrow(/DELAYED_COUNTER_PLACEMENT_INVALID/u);
  });

  it('refuses delayed source placement on a spell with no battlefield source incarnation', () => {
    const spell = {
      kind: 'sorcery',
      id: 'tst-delayed-counter-spell-source',
      name: 'Delayed Counter Spell Source',
      rarity: 'uncommon',
      set: { code: 'TST', collectorNumber: 3 },
      manaCost: { generic: 1, G: 1 },
      colors: ['G'],
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 2,
          target: { kind: 'selfPermanent' },
          timing: 'nextEndStep',
        },
      ],
    } as unknown as CardInput;
    expect(() => parseCard(spell)).toThrow(/ILLEGAL_TARGET_FOR_EFFECT/u);
  });
});
