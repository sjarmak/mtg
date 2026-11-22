/** Exact hand-authored static landwalk grants for Master of the Pearl Trident. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import {
  ModelAbilitySchema,
  StaticModificationSchema,
  parseCard,
  renderOracleText,
  validateCard,
} from '@mtg/dsl';
import { ModelStaticModificationSchema } from '../src/ability-shape';

const ISLANDWALK = { kind: 'landwalk', landType: 'Island' } as const;

function master(grants: readonly unknown[] = [ISLANDWALK]): CardInput {
  return {
    kind: 'creature',
    id: 'm13-master-of-the-pearl-trident',
    name: 'Master of the Pearl Trident',
    rarity: 'rare',
    set: { code: 'M13', collectorNumber: 59 },
    manaCost: { U: 2 },
    colors: ['U'],
    subtypes: ['Merfolk'],
    power: 2,
    toughness: 2,
    abilities: [
      {
        kind: 'static',
        scope: 'otherCreaturesYouControl',
        subtype: 'Merfolk',
        modification: { kind: 'statBonus', power: 1, toughness: 1 },
      },
      {
        kind: 'static',
        scope: 'otherCreaturesYouControl',
        subtype: 'Merfolk',
        modification: { kind: 'grantKeywordAbilities', grants },
      },
    ],
  } as unknown as CardInput;
}

describe('Master of the Pearl Trident in the DSL', () => {
  it('retains a singleton parameterized Islandwalk grant and renders its exact meaning', () => {
    expect(validateCard(master())).toEqual([]);
    const card = parseCard(master());

    expect(card.abilities[1]).toEqual(
      expect.objectContaining({
        modification: { kind: 'grantKeywordAbilities', grants: [ISLANDWALK] },
      }),
    );
    expect(renderOracleText(card)).toBe(
      "Other Merfolk creatures you control get +1/+1.\nOther Merfolk creatures you control have islandwalk. (They can't be blocked as long as defending player controls an Island.)",
    );
  });

  it('keeps parameterless singleton grants on their canonical singular spelling', () => {
    expect(validateCard(master([{ kind: 'keyword', keyword: 'flying' }]))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DUPLICATE_MODIFICATION',
          path: 'abilities[1].modification.grants',
        }),
      ]),
    );
  });

  it('rejects malformed landwalk grants and duplicate payloads', () => {
    expect(validateCard(master([{ kind: 'landwalk' }])).map((entry) => entry.code)).toContain(
      'SCHEMA_INVALID',
    );
    expect(
      validateCard(master([{ kind: 'landwalk', landType: 'Desert' }])).map((entry) => entry.code),
    ).toContain('SCHEMA_INVALID');
    expect(validateCard(master([ISLANDWALK, ISLANDWALK]))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DUPLICATE_MODIFICATION',
          path: 'abilities[1].modification.grants[1]',
        }),
      ]),
    );
  });

  it('keeps the parameterized grant outside every model-facing schema', () => {
    const modification = { kind: 'grantKeywordAbilities', grants: [ISLANDWALK] };
    expect(StaticModificationSchema.safeParse(modification).success).toBe(true);
    expect(ModelStaticModificationSchema.safeParse(modification).success).toBe(false);
    expect(ModelAbilitySchema.safeParse(parseCard(master()).abilities[1]).success).toBe(false);
  });
});
