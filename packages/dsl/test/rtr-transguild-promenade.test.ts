/** Transguild Promenade's exact, hand-authored entry toll. */
import { describe, expect, it } from 'vitest';
import {
  AbilitySchema,
  CardSchema,
  ModelAbilitySchema,
  parseCard,
  renderOracleText,
  validateCard,
} from '../src/index';

const TOLL = {
  kind: 'triggered',
  condition: 'selfEnters',
  effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfPermanent' } }],
  sacrificeSelfUnlessControllerPays: { cost: { generic: 1 } },
} as const;

const PROMENADE = parseCard({
  kind: 'land',
  id: 'rtr-transguild-promenade',
  name: 'Transguild Promenade',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 249 },
  producesMana: ['W', 'U', 'B', 'R', 'G'],
  entryReplacement: { kind: 'entersTapped' },
  printedEntryReference: 'thisLand',
  abilities: [TOLL],
});

describe("Transguild Promenade's entry toll", () => {
  it('is exact engine vocabulary and remains outside the model schema', () => {
    expect(AbilitySchema.safeParse(TOLL).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(TOLL).success).toBe(false);
    expect(validateCard(PROMENADE)).toEqual([]);
    expect(renderOracleText(PROMENADE)).toBe(
      'This land enters tapped.\n' +
        'When this land enters, sacrifice it unless you pay {1}.\n' +
        '{T}: Add one mana of any color.',
    );
  });

  it('refuses every decomposition outside the one source-attested envelope', () => {
    const cases = [
      { ...TOLL, condition: 'selfDies' },
      { ...TOLL, effects: [] },
      {
        ...TOLL,
        effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
      },
      { ...TOLL, optional: true },
      { ...TOLL, sacrificeSelfUnlessControllerPays: { cost: {} } },
      { ...TOLL, sacrificeSelfUnlessControllerPays: { cost: { generic: 1, hasX: true } } },
    ];
    for (const ability of cases) {
      const card = CardSchema.parse({ ...PROMENADE, abilities: [ability] });
      expect(validateCard(card).map((entry) => entry.code)).toContain('TRIGGER_UNLESS_INVALID');
    }
    const artifact = CardSchema.parse({
      kind: 'artifact',
      id: 'tst-false-promenade',
      name: 'False Promenade',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: {},
      abilities: [TOLL],
    });
    expect(validateCard(artifact).map((entry) => entry.code)).toContain('TRIGGER_UNLESS_INVALID');
  });
});
