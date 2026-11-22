/** Izzet Staticaster's exact atomic same-name damage activation. */
import { describe, expect, it } from 'vitest';
import {
  AbilitySchema,
  CardSchema,
  ModelAbilitySchema,
  parseCard,
  renderOracleText,
  validateCard,
} from '../src/index';

const SAME_NAME_DAMAGE = {
  kind: 'activated',
  cost: { mana: {}, tapSelf: true },
  printedSourceReference: 'thisCreature',
  effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'targetCreature' } }],
  damageTargetAndCreaturesWithSameName: true,
} as const;

const STATICASTER = parseCard({
  kind: 'creature',
  id: 'rtr-173-izzet-staticaster',
  name: 'Izzet Staticaster',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 173 },
  manaCost: { generic: 1, U: 1, R: 1 },
  colors: ['U', 'R'],
  subtypes: ['Human', 'Wizard'],
  power: 0,
  toughness: 3,
  keywords: ['haste'],
  keywordAbilities: [{ kind: 'flash' }],
  abilities: [SAME_NAME_DAMAGE],
});

describe("Izzet Staticaster's damage bundle", () => {
  it('is exact engine vocabulary and remains outside the model schema', () => {
    expect(AbilitySchema.safeParse(SAME_NAME_DAMAGE).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(SAME_NAME_DAMAGE).success).toBe(false);
    expect(validateCard(STATICASTER)).toEqual([]);
    expect(renderOracleText(STATICASTER)).toBe(
      'Flash\nHaste\n{T}: This creature deals 1 damage to target creature and each other creature with the same name as that creature.',
    );
  });

  it('refuses decomposition outside the source-attested creature envelope', () => {
    const cases = [
      { ...SAME_NAME_DAMAGE, cost: { mana: {} } },
      {
        ...SAME_NAME_DAMAGE,
        modes: [{ effects: SAME_NAME_DAMAGE.effects }, { effects: SAME_NAME_DAMAGE.effects }],
      },
      { ...SAME_NAME_DAMAGE, effects: [] },
      {
        ...SAME_NAME_DAMAGE,
        effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'targetCreature' } }],
      },
      {
        ...SAME_NAME_DAMAGE,
        effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
      },
    ];
    for (const ability of cases) {
      const card = CardSchema.parse({ ...STATICASTER, abilities: [ability] });
      expect(validateCard(card).map((entry) => entry.code)).toContain('DAMAGE_TARGET_AND_SAME_NAME_INVALID');
    }

    const artifact = CardSchema.parse({
      kind: 'artifact',
      id: 'tst-false-staticaster',
      name: 'False Staticaster',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: {},
      abilities: [SAME_NAME_DAMAGE],
    });
    expect(validateCard(artifact).map((entry) => entry.code)).toContain(
      'DAMAGE_TARGET_AND_SAME_NAME_INVALID',
    );
  });
});
