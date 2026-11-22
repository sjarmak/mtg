/**
 * Phantom Beast's source-bound target trigger, at the typed and printed seam.
 *
 * The condition is hand-authored only. A generated card cannot choose it until
 * the set generator intentionally learns this event family, while a reference
 * translation can name the exact M11 line today.
 */
import { describe, expect, it } from 'vitest';
import {
  AbilitySchema,
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  parseCard,
  renderOracleText,
  TRIGGER_CONDITIONS,
  TRIGGER_PRINT_TEMPLATES,
  validateCard,
} from '../src/index';

const TRIGGER = {
  kind: 'triggered',
  condition: 'selfBecomesTarget',
  effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfCreature' } }],
} as const;

const PHANTOM_BEAST = parseCard({
  kind: 'creature',
  id: 'm11-phantom-beast',
  name: 'Phantom Beast',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 69 },
  manaCost: { generic: 3, U: 1 },
  colors: ['U'],
  subtypes: ['Illusion', 'Beast'],
  power: 4,
  toughness: 5,
  abilities: [TRIGGER],
});

describe('when this creature becomes the target of a spell or ability', () => {
  it('is available to hand-authored cards and absent from the model vocabulary', () => {
    expect(TRIGGER_CONDITIONS).toContain('selfBecomesTarget');
    expect(MODEL_TRIGGER_CONDITIONS).not.toContain('selfBecomesTarget');
    expect(AbilitySchema.safeParse(TRIGGER).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(TRIGGER).success).toBe(false);
  });

  it('prints the exact M11 Oracle line', () => {
    expect(TRIGGER_PRINT_TEMPLATES.selfBecomesTarget).toBe(
      'When {name} becomes the target of a spell or ability,',
    );
    expect(validateCard(PHANTOM_BEAST)).toEqual([]);
    expect(renderOracleText(PHANTOM_BEAST)).toBe(
      'When Phantom Beast becomes the target of a spell or ability, sacrifice this creature.',
    );
  });
});
