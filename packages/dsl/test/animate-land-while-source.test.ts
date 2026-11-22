/**
 * A source-linked land animation, first exercised by Awakener Druid (M11 163).
 *
 * This is one effect rather than three unrelated clauses. The type, color and
 * base-stat changes share one target and one duration in the printed rule; a
 * representation that split them could accidentally outlive only one layer or
 * ask for three different targets.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput, TargetSpec } from '@mtg/dsl';
import {
  ALL_EFFECT_KINDS,
  CardEffectSchema,
  EFFECT_KINDS,
  HAND_AUTHORED_TARGETS,
  ModelEffectSchema,
  UNPRICED_EFFECT_KINDS,
  legalTargetsFor,
  renderOracleText,
  validateCards,
} from '@mtg/dsl';
import { parseCard, safeParseCard } from '../src/parse';

const TARGET_FOREST = {
  kind: 'targetPermanent' as const,
  filter: { subtypes: ['Forest'] },
};

function animation(target: TargetSpec) {
  return {
    kind: 'animateLandWhileSourceOnBattlefield' as const,
    power: 4,
    toughness: 5,
    colors: ['G' as const],
    subtypes: ['Treefolk'],
    target,
  };
}

function awakenerInput(): CardInput {
  return {
    kind: 'creature',
    id: 'ref-awakener-druid',
    name: 'Awakener Druid',
    rarity: 'uncommon',
    set: { code: 'M11', collectorNumber: 163 },
    manaCost: { generic: 2, G: 1 },
    colors: ['G'],
    subtypes: ['Human', 'Druid'],
    power: 1,
    toughness: 1,
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfEnters',
        effects: [animation(TARGET_FOREST)],
      },
    ],
  };
}

describe('the source-linked land animation vocabulary', () => {
  it('is hand-authored engine vocabulary and remains outside the generator', () => {
    const effect = animation(TARGET_FOREST);
    expect(ALL_EFFECT_KINDS).toContain('animateLandWhileSourceOnBattlefield');
    expect([...UNPRICED_EFFECT_KINDS]).toContain('animateLandWhileSourceOnBattlefield');
    expect([...EFFECT_KINDS]).not.toContain('animateLandWhileSourceOnBattlefield');
    expect(CardEffectSchema.safeParse(effect).success).toBe(true);
    expect(ModelEffectSchema.safeParse(effect).success).toBe(false);
  });

  it('uses the existing permanent target space and no model-visible target', () => {
    expect(HAND_AUTHORED_TARGETS.animateLandWhileSourceOnBattlefield).toEqual(['targetPermanent']);
    expect(legalTargetsFor('animateLandWhileSourceOnBattlefield')).toEqual(['targetPermanent']);
  });

  it('refuses a target filter that does not guarantee the permanent is a land', () => {
    const input = awakenerInput();
    const invalid = safeParseCard({
      ...input,
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [animation({ kind: 'targetPermanent' })],
        },
      ],
    });

    expect(invalid.ok).toBe(false);
    if (invalid.ok) throw new Error('the unrestricted permanent target unexpectedly validated');
    expect(invalid.violations).toContainEqual(
      expect.objectContaining({
        code: 'ILLEGAL_TARGET_FILTER',
        path: 'abilities[0].effects[0].target.filter',
      }),
    );
  });

  it('refuses the source-bound primitive outside its one proven self-entry envelope', () => {
    const input = awakenerInput();
    const spell = {
      kind: 'sorcery',
      id: 'invalid-animation-spell',
      name: 'Invalid Animation Spell',
      rarity: 'common',
      set: input.set,
      manaCost: { generic: 3, G: 1 },
      colors: ['G'],
      effects: [animation(TARGET_FOREST)],
    };
    const deathTrigger = {
      ...input,
      id: 'invalid-animation-trigger',
      name: 'Invalid Animation Trigger',
      abilities: [{ kind: 'triggered', condition: 'selfDies', effects: [animation(TARGET_FOREST)] }],
    };
    const activation = {
      ...input,
      id: 'invalid-animation-activation',
      name: 'Invalid Animation Activation',
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 1 } },
          effects: [animation(TARGET_FOREST)],
        },
      ],
    };

    for (const [card, code] of [
      [spell, 'EFFECT_ILLEGAL_ON_CARD_TYPE'],
      [deathTrigger, 'ABILITY_ILLEGAL_ON_CARD_TYPE'],
      [activation, 'ABILITY_ILLEGAL_ON_CARD_TYPE'],
    ] as const) {
      const result = safeParseCard(card);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error(`${card.name} unexpectedly validated`);
      expect(result.violations.map((issue) => issue.code)).toContain(code);
    }
  });
});

describe('Awakener Druid', () => {
  it('validates and renders its current Oracle text exactly', () => {
    const card = parseCard(awakenerInput());
    expect(validateCards([card])).toEqual([]);
    expect(renderOracleText(card)).toBe(
      "When Awakener Druid enters, target Forest becomes a 4/5 green Treefolk creature for as long as Awakener Druid remains on the battlefield. It's still a land.",
    );
  });

  it('uses canonical color grammar for the wider reusable animation primitive', () => {
    const input = awakenerInput();
    const card = parseCard({
      ...input,
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [{ ...animation(TARGET_FOREST), colors: ['U', 'G'] }],
        },
      ],
    });

    expect(renderOracleText(card)).toContain('a 4/5 blue and green Treefolk creature');
  });
});
