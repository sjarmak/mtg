/** Sword of Vengeance's five independent modifications on one equip clause. */
import { describe, expect, it } from 'vitest';
import type { AttachModification, CardInput } from '@mtg/dsl';
import {
  ATTACH_MODIFICATION_LIMITS,
  ModelAbilitySchema,
  parseCard,
  renderOracleText,
  validateCard,
} from '@mtg/dsl';

const MODIFICATIONS: readonly AttachModification[] = [
  { kind: 'statBonus', power: 2, toughness: 0 },
  { kind: 'grantKeyword', keyword: 'firstStrike' },
  { kind: 'grantKeyword', keyword: 'vigilance' },
  { kind: 'grantKeyword', keyword: 'trample' },
  { kind: 'grantKeyword', keyword: 'haste' },
];

function sword(modifications: readonly AttachModification[] = MODIFICATIONS): CardInput {
  return {
    kind: 'artifact',
    id: 'm11-sword-of-vengeance',
    name: 'Sword of Vengeance',
    rarity: 'rare',
    set: { code: 'M11', collectorNumber: 216 },
    manaCost: { generic: 3 },
    subtypes: ['Equipment'],
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { generic: 3 } },
        attach: { modifications: [...modifications] },
        effects: [],
      },
    ],
  };
}

describe('Sword of Vengeance in the DSL', () => {
  it('retains and prints all five ordered modifications', () => {
    expect(ATTACH_MODIFICATION_LIMITS).toEqual({ min: 0, max: 5 });
    expect(validateCard(sword())).toEqual([]);
    const card = parseCard(sword());
    expect(renderOracleText(card)).toBe(
      'Equipped creature gets +2/+0 and has first strike, vigilance, trample, and haste.\nEquip {3}',
    );
    const ability = card.abilities[0];
    if (ability?.kind !== 'activated') throw new Error('Sword of Vengeance lost its equip ability');
    expect(ability.attach?.modifications).toEqual(MODIFICATIONS);
  });

  it('keeps five as the engine ceiling and still rejects duplicate grants', () => {
    const six = sword([...MODIFICATIONS, { kind: 'grantKeyword', keyword: 'flying' }]);
    expect(validateCard(six).map((violation) => violation.code)).toContain('SCHEMA_INVALID');

    const repeated = sword([
      { kind: 'statBonus', power: 2, toughness: 0 },
      { kind: 'grantKeyword', keyword: 'firstStrike' },
      { kind: 'grantKeyword', keyword: 'vigilance' },
      { kind: 'grantKeyword', keyword: 'trample' },
      { kind: 'grantKeyword', keyword: 'firstStrike' },
    ]);
    expect(validateCard(repeated)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DUPLICATE_MODIFICATION',
          path: 'abilities[0].attach.modifications[4]',
        }),
      ]),
    );
  });

  it('does not widen the model-facing one-modification equip clause', () => {
    expect(ModelAbilitySchema.safeParse(sword().abilities?.[0]).success).toBe(false);
  });
});
