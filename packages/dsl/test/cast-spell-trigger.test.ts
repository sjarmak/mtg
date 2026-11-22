/**
 * `youCastSpell` and `youCastInstantOrSorcery`: CR 601.2i's "whenever you
 * cast a spell" trigger, printed, and its instant-or-sorcery-filtered
 * sibling.
 *
 * The kernel's half is `packages/kernel/test/cast-spell.test.ts`; this file
 * is what the card says. `drawCards` is the payoff rather than `gainLife`
 * here for the same reason `gain-life-trigger.test.ts` gives: neither
 * condition risks a self-referential loop the way `youGainLife` does, but the
 * card printed below is meant to read like a spells-matter payoff a real set
 * would print, and drawing off your own casts is the more familiar one.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput, Color, TriggerCondition } from '@mtg/dsl';
import {
  AbilitySchema,
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  renderOracleText,
  safeParseCard,
  TRIGGER_CONDITIONS,
  TRIGGER_PRINT_TEMPLATES,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';

function castTrigger(condition: TriggerCondition): Record<string, unknown> {
  return {
    kind: 'triggered',
    condition,
    effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
  };
}

function creatureInput(condition: TriggerCondition): Record<string, unknown> {
  return {
    kind: 'creature',
    id: 'tst-spell-warden',
    name: 'Spell Warden',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 3 },
    manaCost: { generic: 1, U: 1 },
    colors: ['U'],
    subtypes: ['Wizard'],
    supertypes: [],
    keywords: [],
    abilities: [castTrigger(condition)],
    power: 1,
    toughness: 2,
  };
}

function filteredCreatureInput(
  spellColors: readonly Color[],
  condition: TriggerCondition = 'youCastSpell',
): Record<string, unknown> {
  return {
    ...creatureInput(condition),
    abilities: [filteredAbility(spellColors, condition)],
  };
}

function filteredAbility(
  spellColors: readonly Color[],
  condition: TriggerCondition = 'youCastSpell',
): Record<string, unknown> {
  return { ...castTrigger(condition), spellColors };
}

describe.each([
  {
    condition: 'youCastSpell' as const,
    printed: 'Whenever you cast a spell,',
    oracle: 'Whenever you cast a spell, draw a card.',
  },
  {
    condition: 'youCastInstantOrSorcery' as const,
    printed: 'Whenever you cast an instant or sorcery spell,',
    oracle: 'Whenever you cast an instant or sorcery spell, draw a card.',
  },
])('$condition', ({ condition, printed, oracle }) => {
  it('is a condition the engine knows and the generator may not choose', () => {
    expect(TRIGGER_CONDITIONS).toContain(condition);
    const chooseable: readonly TriggerCondition[] = MODEL_TRIGGER_CONDITIONS;
    expect(chooseable).not.toContain(condition);
  });

  it('is expressible by hand and unreachable from the generator', () => {
    const ability = castTrigger(condition);
    expect(AbilitySchema.safeParse(ability).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(ability).success).toBe(false);
  });

  it('carries a printed template of its own', () => {
    expect(TRIGGER_PRINT_TEMPLATES[condition]).toBe(printed);
  });

  it('prints the whole clause on a real card', () => {
    const card = parseCard(creatureInput(condition) as CardInput);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(oracle);
  });
});

describe('a color-filtered spell-cast trigger', () => {
  it('is exact in the hand-authored DSL and remains outside the model envelope', () => {
    const input = filteredCreatureInput(['W', 'U', 'B', 'R']);
    const card = parseCard(input as CardInput);

    expect(validateCard(card)).toEqual([]);
    expect(card.abilities[0]).toMatchObject({
      kind: 'triggered',
      condition: 'youCastSpell',
      spellColors: ['W', 'U', 'B', 'R'],
    });
    expect(renderOracleText(card)).toBe(
      "Whenever you cast a spell that's white, blue, black, or red, draw a card.",
    );
    expect(ModelAbilitySchema.safeParse(filteredAbility(['W', 'U', 'B', 'R'])).success).toBe(false);
  });

  it.each([
    { label: 'an empty filter', colors: [] },
    { label: 'a duplicate color', colors: ['W', 'W'] },
    { label: 'colors outside WUBRG order', colors: ['U', 'W'] },
  ])('rejects $label', ({ colors }) => {
    expect(AbilitySchema.safeParse(filteredAbility(colors as readonly Color[])).success).toBe(false);
  });

  it('rejects the filter on a trigger condition that does not describe your cast spell', () => {
    expect(AbilitySchema.safeParse(filteredAbility(['W'], 'youCastInstantOrSorcery')).success).toBe(false);
    const result = safeParseCard(filteredCreatureInput(['W'], 'youCastInstantOrSorcery'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        code: 'SCHEMA_INVALID',
        path: 'abilities[0].spellColors',
      }),
    );
  });
});

describe('a multicolored spell-cast trigger', () => {
  const ability = {
    ...castTrigger('youCastSpell'),
    spellIsMulticolored: true,
  };

  it('is exact in the hand-authored DSL and remains outside the model envelope', () => {
    const input = { ...creatureInput('youCastSpell'), abilities: [ability] };
    const card = parseCard(input as CardInput);

    expect(validateCard(card)).toEqual([]);
    expect(card.abilities[0]).toMatchObject({
      kind: 'triggered',
      condition: 'youCastSpell',
      spellIsMulticolored: true,
    });
    expect(renderOracleText(card)).toBe('Whenever you cast a multicolored spell, draw a card.');
    expect(ModelAbilitySchema.safeParse(ability).success).toBe(false);
  });

  it('rejects the refinement outside the unfiltered cast event', () => {
    const invalid = {
      ...castTrigger('youCastInstantOrSorcery'),
      spellIsMulticolored: true,
    };
    expect(AbilitySchema.safeParse(invalid).success).toBe(false);
    const result = safeParseCard({
      ...creatureInput('youCastInstantOrSorcery'),
      abilities: [invalid],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toContainEqual(
      expect.objectContaining({ code: 'SCHEMA_INVALID', path: 'abilities[0].spellIsMulticolored' }),
    );
  });

  it('rejects two competing cast-event refinements', () => {
    expect(AbilitySchema.safeParse({ ...ability, spellColors: ['W', 'U'] }).success).toBe(false);
  });

  it('sequences a self pump and source-bound untap with the pinned modern wording', () => {
    const card = parseCard({
      ...creatureInput('youCastInstantOrSorcery'),
      id: 'rtr-211',
      name: 'Blistercoil Weird',
      manaCost: { hybrid: { 'U/R': 1 } },
      colors: ['U', 'R'],
      subtypes: ['Weird'],
      power: 1,
      toughness: 1,
      abilities: [
        {
          kind: 'triggered',
          condition: 'youCastInstantOrSorcery',
          effects: [
            {
              kind: 'pumpUntilEndOfTurn',
              power: 1,
              toughness: 1,
              target: { kind: 'selfCreature' },
            },
            { kind: 'untapPermanent', target: { kind: 'selfCreature' } },
          ],
        },
      ],
    } as CardInput);

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'Whenever you cast an instant or sorcery spell, this creature gets +1/+1 until end of turn. Untap it.',
    );
  });
});
