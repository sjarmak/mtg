/** Frost Titan's two exact triggered abilities at the authoring boundary. */
import { describe, expect, it } from 'vitest';
import {
  AbilitySchema,
  CardSchema,
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  parseCard,
  renderOracleText,
  TRIGGER_CONDITIONS,
  validateCard,
} from '../src/index';

const COUNTER_TRIGGER = {
  kind: 'triggered',
  condition: 'selfBecomesTargetByOpponent',
  effects: [],
  counterTriggeringSpellOrAbilityUnless: { cost: { generic: 2 } },
} as const;

const FROST_TITAN = parseCard({
  kind: 'creature',
  id: 'm11-frost-titan',
  name: 'Frost Titan',
  rarity: 'mythic',
  set: { code: 'M11', collectorNumber: 55 },
  manaCost: { generic: 4, U: 2 },
  colors: ['U'],
  subtypes: ['Giant'],
  power: 6,
  toughness: 6,
  abilities: [
    COUNTER_TRIGGER,
    {
      kind: 'triggered',
      condition: 'selfEntersOrAttacks',
      effects: [
        {
          kind: 'tapPermanent',
          target: { kind: 'targetPermanent' },
          doesNotUntap: true,
        },
      ],
    },
  ],
});

describe("Frost Titan's target toll", () => {
  it('is hand-authored engine vocabulary and remains outside the model schema', () => {
    expect(TRIGGER_CONDITIONS).toContain('selfBecomesTargetByOpponent');
    expect(MODEL_TRIGGER_CONDITIONS).not.toContain('selfBecomesTargetByOpponent');
    expect(AbilitySchema.safeParse(COUNTER_TRIGGER).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(COUNTER_TRIGGER).success).toBe(false);
  });

  it('prints both exact M11 Oracle abilities', () => {
    expect(validateCard(FROST_TITAN)).toEqual([]);
    expect(renderOracleText(FROST_TITAN)).toBe(
      'Whenever Frost Titan becomes the target of a spell or ability an opponent controls, counter that spell or ability unless its controller pays {2}.\n' +
        "Whenever Frost Titan enters or attacks, tap target permanent. It doesn't untap during its controller's next untap step.",
    );
  });

  it('refuses the clause on any other trigger condition or beside ordinary effects', () => {
    const wrongCondition = CardSchema.parse({
      ...FROST_TITAN,
      abilities: [{ ...COUNTER_TRIGGER, condition: 'selfEnters' }],
    });
    const mixedPayload = CardSchema.parse({
      ...FROST_TITAN,
      abilities: [
        {
          ...COUNTER_TRIGGER,
          effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
        },
      ],
    });
    expect(validateCard(wrongCondition).map((entry) => entry.code)).toContain('COUNTER_TRIGGER_INVALID');
    expect(validateCard(mixedPayload).map((entry) => entry.code)).toContain('COUNTER_TRIGGER_INVALID');
  });

  it('refuses empty ordinary triggers and free or variable tolls', () => {
    const cases = [
      { kind: 'triggered', condition: 'selfEnters', effects: [] },
      {
        ...COUNTER_TRIGGER,
        counterTriggeringSpellOrAbilityUnless: { cost: {} },
      },
      {
        ...COUNTER_TRIGGER,
        counterTriggeringSpellOrAbilityUnless: { cost: { hasX: true } },
      },
    ];
    for (const ability of cases) {
      const card = CardSchema.parse({ ...FROST_TITAN, abilities: [ability] });
      expect(validateCard(card).map((entry) => entry.code)).toContain('COUNTER_TRIGGER_INVALID');
    }
  });
});
