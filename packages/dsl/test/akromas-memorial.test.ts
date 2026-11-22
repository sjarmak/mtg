/** Akroma's Memorial as one ordered, scoped layer-6 grant bundle. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { ModelAbilitySchema, parseCard, renderOracleText, validateCard } from '@mtg/dsl';
import { ModelStaticModificationSchema } from '../src/ability-shape';

const GRANTS = [
  { kind: 'keyword', keyword: 'flying' },
  { kind: 'keyword', keyword: 'firstStrike' },
  { kind: 'keyword', keyword: 'vigilance' },
  { kind: 'keyword', keyword: 'trample' },
  { kind: 'keyword', keyword: 'haste' },
  { kind: 'protection', quality: { kind: 'color', color: 'B' } },
  { kind: 'protection', quality: { kind: 'color', color: 'R' } },
] as const;

function memorial(grants: readonly unknown[] = GRANTS): CardInput {
  return {
    kind: 'artifact',
    id: 'm13-akromas-memorial',
    name: "Akroma's Memorial",
    rarity: 'mythic',
    set: { code: 'M13', collectorNumber: 200 },
    manaCost: { generic: 7 },
    supertypes: ['legendary'],
    abilities: [
      {
        kind: 'static',
        scope: 'creaturesYouControl',
        subtype: null,
        modification: { kind: 'grantKeywordAbilities', grants },
      },
    ],
  } as unknown as CardInput;
}

describe("Akroma's Memorial in the DSL", () => {
  it('retains all seven ordered grants and prints the exact Oracle sentence', () => {
    expect(validateCard(memorial())).toEqual([]);
    const card = parseCard(memorial());

    expect(renderOracleText(card)).toBe(
      'Creatures you control have flying, first strike, vigilance, trample, haste, and protection from black and from red.',
    );
    expect(card.abilities).toHaveLength(1);
    expect(card.abilities[0]).toEqual(
      expect.objectContaining({
        modification: { kind: 'grantKeywordAbilities', grants: GRANTS },
      }),
    );
  });

  it('rejects empty, singleton, oversized, duplicate, and malformed bundles', () => {
    expect(validateCard(memorial([])).map((violation) => violation.code)).toContain('SCHEMA_INVALID');
    expect(validateCard(memorial([GRANTS[0]]))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DUPLICATE_MODIFICATION',
          path: 'abilities[0].modification.grants',
        }),
      ]),
    );
    expect(
      validateCard(memorial([...GRANTS, { kind: 'keyword', keyword: 'lifelink' }])).map(
        (violation) => violation.code,
      ),
    ).toContain('SCHEMA_INVALID');

    expect(validateCard(memorial([...GRANTS.slice(0, 6), GRANTS[0]]))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DUPLICATE_MODIFICATION',
          path: 'abilities[0].modification.grants[6]',
        }),
      ]),
    );

    expect(
      validateCard(
        memorial([{ kind: 'protection', quality: { kind: 'subtype', subtype: 'dragon' } }, GRANTS[0]]),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'INVALID_SUBTYPE',
          path: 'abilities[0].modification.grants[0].quality.subtype',
        }),
      ]),
    );
  });

  it('keeps the bundle outside the model-facing static vocabulary', () => {
    expect(
      ModelStaticModificationSchema.safeParse({ kind: 'grantKeywordAbilities', grants: GRANTS }).success,
    ).toBe(false);
    expect(ModelAbilitySchema.safeParse(parseCard(memorial()).abilities[0]).success).toBe(false);
  });
});
