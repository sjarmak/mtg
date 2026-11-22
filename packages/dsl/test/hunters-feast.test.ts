/** Exact hand-authored target cardinality and printed text for M11 Hunters' Feast. */
import { describe, expect, it } from 'vitest';
import type { CardInput, TargetSpec } from '@mtg/dsl';
import { ModelTargetSpecSchema, renderOracleText, TargetSpecSchema, validateCard } from '../src/index';
import { parseCard, safeParseCard } from '../src/parse';

const ANY_NUMBER_OF_PLAYERS = {
  kind: 'targetPlayer',
  anyNumber: true,
} as unknown as TargetSpec;

function input(): CardInput {
  return {
    kind: 'sorcery',
    id: 'm11-182-hunters-feast',
    name: "Hunters' Feast",
    rarity: 'common',
    set: { code: 'M11', collectorNumber: 182 },
    manaCost: { generic: 3, G: 1 },
    colors: ['G'],
    effects: [{ kind: 'gainLife', amount: 6, target: ANY_NUMBER_OF_PLAYERS }],
  } as unknown as CardInput;
}

describe("Hunters' Feast DSL", () => {
  it('keeps any-number cardinality hand-authored and outside the generator target schema', () => {
    expect(TargetSpecSchema.safeParse(ANY_NUMBER_OF_PLAYERS).success).toBe(true);
    expect(ModelTargetSpecSchema.safeParse(ANY_NUMBER_OF_PLAYERS).success).toBe(false);
  });

  it('prints the exact Oracle sentence', () => {
    const card = parseCard(input());
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe('Any number of target players each gain 6 life.');
  });

  it('rejects contradictory cardinality spellings', () => {
    expect(
      safeParseCard({
        ...input(),
        effects: [
          {
            kind: 'gainLife',
            amount: 6,
            target: { kind: 'targetPlayer', anyNumber: true, count: 2 },
          },
        ],
      } as unknown as CardInput).ok,
    ).toBe(false);
  });

  it('admits native plural effects on spells and activated abilities', () => {
    expect(
      safeParseCard({
        ...input(),
        effects: [
          {
            kind: 'drawCards',
            count: 1,
            target: { kind: 'targetPlayer', anyNumber: true },
          },
        ],
      } as unknown as CardInput).ok,
    ).toBe(true);

    expect(
      safeParseCard({
        kind: 'artifact',
        id: 'test-any-number-ability',
        name: 'Test Any Number Ability',
        rarity: 'common',
        set: { code: 'TST', collectorNumber: 1 },
        manaCost: { generic: 1 },
        colors: [],
        abilities: [
          {
            kind: 'activated',
            cost: { mana: { generic: 1 } },
            effects: [{ kind: 'gainLife', amount: 1, target: ANY_NUMBER_OF_PLAYERS }],
          },
        ],
      }).ok,
    ).toBe(true);
  });
});
