import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CardEffectSchema,
  ModelEffectSchema,
  ModelAbilitySchema,
  parseCard,
  renderOracleText,
  validateCard,
  type CardInput,
} from '../src/index';

function spell(
  kind: 'instant' | 'sorcery',
  name: string,
  collectorNumber: number,
  effect: unknown,
): CardInput {
  return {
    kind,
    id: `m13-${String(collectorNumber)}-${name.toLowerCase().replaceAll(/[^a-z]+/g, '-')}`,
    name,
    rarity: 'rare',
    set: { code: 'M13', collectorNumber },
    manaCost: name === 'Magmaquake' ? { R: 2, hasX: true } : { generic: 3, R: 2 },
    colors: ['R'],
    supertypes: [],
    subtypes: [],
    keywords: [],
    abilities: [],
    effects: [effect],
  } as unknown as CardInput;
}

const MAGMAQUAKE = {
  kind: 'dealDamage',
  amount: { kind: 'chosenX' },
  target: { kind: 'noTarget' },
  scope: 'allPermanents',
  scopeFilter: { cardTypes: ['creature'], excludeKeywords: ['flying'] },
  additionalScopeFilter: { cardTypes: ['planeswalker'] },
} as const;

const CHANDRAS_FURY = {
  kind: 'dealDamage',
  amount: 4,
  scopeAmount: 1,
  target: { kind: 'targetPlayerOrPlaneswalker' },
  scope: 'targetAndPermanentsItsPlayerControls',
  scopeFilter: { cardTypes: ['creature'] },
} as const;

const THUNDERMAW_EFFECT = {
  kind: 'dealDamage',
  amount: 1,
  target: { kind: 'noTarget' },
  scope: 'permanentsOpponentsControl',
  scopeFilter: { cardTypes: ['creature'], keywords: ['flying'] },
  tapScopeGroup: true,
} as const;

const THUNDERMAW = {
  kind: 'creature',
  id: 'm13-150-thundermaw-hellkite',
  name: 'Thundermaw Hellkite',
  rarity: 'mythic',
  set: { code: 'M13', collectorNumber: 150 },
  manaCost: { generic: 3, R: 2 },
  colors: ['R'],
  supertypes: [],
  subtypes: ['Dragon'],
  power: 5,
  toughness: 5,
  keywords: ['flying', 'haste'],
  effects: [],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [THUNDERMAW_EFFECT],
    },
  ],
} as unknown as CardInput;

function codes(input: CardInput): readonly string[] {
  return validateCard(input as Parameters<typeof validateCard>[0]).map((violation) => violation.code);
}

describe('M13 damage cohort DSL', () => {
  it('prints the three exact Oracle texts', () => {
    const magmaquake = parseCard(spell('instant', 'Magmaquake', 140, MAGMAQUAKE));
    const fury = parseCard(spell('instant', "Chandra's Fury", 124, CHANDRAS_FURY));
    const thundermaw = parseCard(THUNDERMAW);

    expect(validateCard(magmaquake)).toEqual([]);
    expect(validateCard(fury)).toEqual([]);
    expect(validateCard(thundermaw)).toEqual([]);
    expect(renderOracleText(magmaquake)).toBe(
      'Magmaquake deals X damage to each creature without flying and each planeswalker.',
    );
    expect(renderOracleText(fury)).toBe(
      "Chandra's Fury deals 4 damage to target player or planeswalker and 1 damage to each creature that player or that planeswalker's controller controls.",
    );
    expect(renderOracleText(thundermaw)).toBe(
      'Flying, haste\nWhen Thundermaw Hellkite enters the battlefield, it deals 1 damage to each creature with flying your opponents control. Tap those creatures.',
    );
  });

  it('refuses negative keywords on target and stack filters', () => {
    expect(
      codes(
        spell('sorcery', 'Bad Target', 1, {
          kind: 'dealDamage',
          amount: 1,
          target: { kind: 'targetCreature', filter: { excludeKeywords: ['flying'] } },
        }),
      ),
    ).toContain('ILLEGAL_TARGET_FILTER');
    expect(
      codes(
        spell('sorcery', 'Bad Stack', 2, {
          kind: 'counterSpell',
          spellFilter: { excludeKeywords: ['flying'] },
        }),
      ),
    ).toContain('ILLEGAL_TARGET_FILTER');
  });

  it('refuses empty, duplicate, and contradictory negative keyword lists', () => {
    expect(
      CardEffectSchema.safeParse({
        ...MAGMAQUAKE,
        scopeFilter: { cardTypes: ['creature'], excludeKeywords: [] },
      }).success,
    ).toBe(false);
    expect(
      codes(
        spell('sorcery', 'Duplicate', 3, {
          ...MAGMAQUAKE,
          scopeFilter: { cardTypes: ['creature'], excludeKeywords: ['flying', 'flying'] },
        }),
      ),
    ).toContain('ILLEGAL_TARGET_FILTER');
    expect(
      codes(
        spell('sorcery', 'Contradiction', 4, {
          ...MAGMAQUAKE,
          scopeFilter: { cardTypes: ['creature'], keywords: ['flying'], excludeKeywords: ['flying'] },
        }),
      ),
    ).toContain('ILLEGAL_TARGET_FILTER');
  });

  it('confines the three cohort riders to their reviewed deal-damage shapes', () => {
    const illegal: readonly unknown[] = [
      { ...MAGMAQUAKE, scope: 'permanentsYouControl' },
      { ...MAGMAQUAKE, additionalScopeFilter: undefined },
      { ...CHANDRAS_FURY, scope: 'allPermanents' },
      { ...CHANDRAS_FURY, scopeAmount: undefined },
      { ...THUNDERMAW_EFFECT, scopeFilter: { cardTypes: ['planeswalker'] } },
      {
        kind: 'destroyPermanent',
        target: { kind: 'noTarget' },
        scope: 'allPermanents',
        scopeFilter: { cardTypes: ['creature'] },
        additionalScopeFilter: { cardTypes: ['planeswalker'] },
      },
    ];
    for (const [index, effect] of illegal.entries()) {
      expect(codes(spell('sorcery', `Illegal ${String(index)}`, 10 + index, effect))).not.toEqual([]);
    }
  });

  it('keeps every new field outside the generator schemas', () => {
    const modelEffectJson = JSON.stringify(z.toJSONSchema(ModelEffectSchema));
    const modelAbilityJson = JSON.stringify(z.toJSONSchema(ModelAbilitySchema));
    for (const field of ['excludeKeywords', 'additionalScopeFilter', 'scopeAmount', 'tapScopeGroup']) {
      expect(modelEffectJson).not.toContain(field);
      expect(modelAbilityJson).not.toContain(field);
    }
  });
});
