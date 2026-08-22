/**
 * "Artifact creature": a printed card type made of two words, and the field
 * that says it.
 *
 * `mtg-nhyv.2`. `TargetFilter.cardTypes` is evaluated with `anyOf` — the kernel
 * reads it in `matchesFilter` the same way an anthem's `ObjectFilter` is read —
 * so `['artifact', 'creature']` is Magic's "artifact or creature", which is
 * what Demolish and Acidic Slime need and is the opposite of what Steel
 * Overseer needs. Nothing in the schema could express the conjunction, so "each
 * artifact creature you control" was written as "each artifact you control" and
 * a Copper Idol took a counter the printed card would not give it.
 *
 * **A second field rather than a new meaning for the old one.** Redefining
 * `cardTypes` as a conjunction would silently rewrite every card already using
 * it: `packages/dsl/test/filtered-object-target.test.ts` pins Demolish at
 * `['artifact', 'land']` printing "artifact or land" and Acidic Slime at three
 * types printing "artifact, enchantment, or land", and under a conjunction both
 * become slots no permanent can ever fill. The union is load-bearing and
 * printed; the conjunction is a different question about the same dimension,
 * and Magic asks both.
 *
 * `allCardTypes` is named after the `ObjectFilter` field it compiles to, which
 * is the standing rule for this schema, and the kernel's own docblock already
 * describes exactly this asymmetry one field over: `keywords` requires *all* of
 * its values where every other list requires *any*, because "creatures with
 * flying and vigilance" and "creatures that are green or white" are both
 * common. Card types are the second dimension Magic asks both ways.
 *
 * `min(2)`: a one-element conjunction is a second spelling of a one-element
 * union, and one card must have one encoding for `checkDuplicateEffects` to
 * compare two effects at all.
 *
 * The generator cannot reach this field, which is the freeze every schema
 * change since the recordings were made has had to state: `ModelEffectSchema`
 * carries no `filter`, no `spellFilter` and no `scopeFilter`, so the JSON
 * Schema every fill batch is shown is byte-identical and every recorded call
 * still replays.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AbilityInput, Card, CardInput, Effect } from '../src/index';
import { renderOracleText, validateCard } from '../src/index';
import { parseCard } from '../src/parse';
import { TargetFilterSchema, targetFilterIsEmpty } from '../src/targets';
import {
  ModelEffectSchema,
  PartBearingModelEffectSchema,
  ZoneReachingModelEffectSchema,
} from '../src/effects';

function instantInput(effects: readonly Effect[]): Record<string, unknown> {
  return {
    kind: 'instant',
    id: 'xmp-conjunctive-probe',
    name: 'Sundering Light',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 2 },
    manaCost: { generic: 1, R: 1 },
    colors: ['R'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [...effects],
  };
}

function card(effects: readonly Effect[]): Card {
  return parseCard(instantInput(effects) as CardInput);
}

/** `parseCard` throws on a violation, so a refusal is asserted off the record. */
function codes(effects: readonly Effect[]): readonly string[] {
  return validateCard(instantInput(effects) as unknown as Card).map((found) => found.code);
}

const OVERSEER: AbilityInput = {
  kind: 'activated',
  cost: { mana: {}, tapSelf: true },
  effects: [
    {
      kind: 'putCounters',
      counter: 'plusOnePlusOne',
      count: 1,
      scope: 'permanentsYouControl',
      scopeFilter: { allCardTypes: ['artifact', 'creature'] },
      target: { kind: 'noTarget' },
    },
  ],
};

function overseerCard(): Card {
  return parseCard({
    kind: 'creature',
    id: 'xmp-conjunctive-overseer',
    name: 'Forge Overseer',
    rarity: 'rare',
    set: { code: 'XMP', collectorNumber: 3 },
    manaCost: { generic: 2 },
    colors: [],
    supertypes: [],
    subtypes: ['Construct'],
    keywords: [],
    artifact: true,
    power: 1,
    toughness: 1,
    abilities: [OVERSEER],
  } as CardInput);
}

describe('a conjunctive printed card type', () => {
  it('is a field of its own, and the union field keeps its meaning', () => {
    expect(TargetFilterSchema.parse({ allCardTypes: ['artifact', 'creature'] })).toEqual({
      allCardTypes: ['artifact', 'creature'],
    });
    expect(TargetFilterSchema.safeParse({ allCardTypes: ['artifact'] }).success).toBe(false);
    expect(targetFilterIsEmpty({ allCardTypes: ['artifact', 'creature'] })).toBe(false);
    expect(targetFilterIsEmpty({})).toBe(true);
  });

  it('prints Steel Overseer’s line in the distributive singular', () => {
    const overseer = overseerCard();
    expect(validateCard(overseer)).toEqual([]);
    expect(renderOracleText(overseer)).toBe(
      '{T}: Put a +1/+1 counter on each artifact creature you control.',
    );
  });

  it('pluralizes only the noun when the sweep takes the plural', () => {
    const cleansing = card([
      {
        kind: 'destroyPermanent',
        scope: 'allPermanents',
        scopeFilter: { allCardTypes: ['artifact', 'creature'] },
        target: { kind: 'noTarget' },
      },
    ]);
    expect(validateCard(cleansing)).toEqual([]);
    expect(renderOracleText(cleansing)).toBe('Destroy all artifact creatures.');
  });

  it('replaces the noun on a target slot, where the union prints a list', () => {
    const conjunction = card([
      {
        kind: 'destroyPermanent',
        target: { kind: 'targetPermanent', filter: { allCardTypes: ['artifact', 'creature'] } },
      },
    ]);
    expect(validateCard(conjunction)).toEqual([]);
    expect(renderOracleText(conjunction)).toBe('Destroy target artifact creature.');

    const union = card([
      {
        kind: 'destroyPermanent',
        target: { kind: 'targetPermanent', filter: { cardTypes: ['artifact', 'land'] } },
      },
    ]);
    expect(renderOracleText(union)).toBe('Destroy target artifact or land.');
  });

  /**
   * The stack side, where the type is an adjective in front of "spell" rather
   * than a replacement for it: Magic prints "counter target artifact creature
   * spell", keeping the noun because the object is a spell.
   */
  it('reads as an adjective on a spell filter', () => {
    const counter = card([
      {
        kind: 'counterSpell',
        spellFilter: { allCardTypes: ['artifact', 'creature'] },
      },
    ]);
    expect(validateCard(counter)).toEqual([]);
    expect(renderOracleText(counter)).toBe('Counter target artifact creature spell.');
  });

  it('carries the adjectives a union filter carries, in the same order', () => {
    const purged = card([
      {
        kind: 'exileTarget',
        target: {
          kind: 'targetPermanent',
          filter: { allCardTypes: ['artifact', 'creature'], colors: ['B'], excludeColors: ['R'] },
        },
      },
    ]);
    expect(validateCard(purged)).toEqual([]);
    expect(renderOracleText(purged)).toBe('Exile target nonred black artifact creature.');
  });

  /**
   * The refusals, and each one closes a card that reads narrow and plays as a
   * blank or as a second spelling of a card that already exists.
   */
  it('refuses the union and the conjunction in one filter', () => {
    expect(
      codes([
        {
          kind: 'destroyPermanent',
          target: {
            kind: 'targetPermanent',
            filter: { cardTypes: ['land'], allCardTypes: ['artifact', 'creature'] },
          },
        },
      ]),
    ).toEqual(['ILLEGAL_TARGET_FILTER']);
  });

  it('refuses a repeated member, and a member the excluded list also names', () => {
    expect(
      codes([
        {
          kind: 'destroyPermanent',
          target: {
            kind: 'targetPermanent',
            filter: { allCardTypes: ['artifact', 'artifact'] },
          },
        },
      ]),
    ).toEqual(['ILLEGAL_TARGET_FILTER']);

    expect(
      codes([
        {
          kind: 'destroyPermanent',
          target: {
            kind: 'targetPermanent',
            filter: { allCardTypes: ['artifact', 'creature'], excludeCardTypes: ['creature'] },
          },
        },
      ]),
    ).toEqual(['ILLEGAL_TARGET_FILTER']);
  });

  /**
   * CR 205.2a: an instant or a sorcery is never anything else. A conjunction
   * naming one beside a second type is a slot nothing can ever fill, which is
   * the same blank the wanted-and-excluded rule already refuses one field over.
   */
  it('refuses a conjunction that names an instant or a sorcery beside another type', () => {
    expect(
      codes([
        {
          kind: 'counterSpell',
          spellFilter: { allCardTypes: ['instant', 'creature'] },
        },
      ]),
    ).toEqual(['ILLEGAL_TARGET_FILTER']);

    expect(
      codes([
        {
          kind: 'counterSpell',
          spellFilter: { allCardTypes: ['instant', 'sorcery'] },
        },
      ]),
    ).toEqual(['ILLEGAL_TARGET_FILTER']);
  });

  /**
   * Two findings on one filter, and both are wanted: the only card types a
   * permanent never holds are the two an instant or a sorcery is, so a
   * conjunction reaching outside the battlefield trips CR 205.2a on the way
   * out. Asserting one code would have hidden whichever rule was checked
   * second.
   */
  it('refuses a card type the space it is read against never holds', () => {
    expect(
      codes([
        {
          kind: 'destroyPermanent',
          target: {
            kind: 'targetPermanent',
            filter: { allCardTypes: ['instant', 'creature'] },
          },
        },
      ]),
    ).toEqual(['ILLEGAL_TARGET_FILTER', 'ILLEGAL_TARGET_FILTER']);
  });

  /**
   * A damage sweep is satisfied by one damageable member, because the object it
   * reaches is *both* things: an artifact creature is a creature, and CR 120.3
   * lets damage reach it. The union field has to name only damageable types,
   * because any one of its members alone is enough to be chosen.
   */
  it('lets a damage sweep name a conjunction one of whose members takes damage', () => {
    const sweep = card([
      {
        kind: 'dealDamage',
        amount: 2,
        scope: 'allPermanents',
        scopeFilter: { allCardTypes: ['artifact', 'creature'] },
        target: { kind: 'noTarget' },
      },
    ]);
    expect(validateCard(sweep)).toEqual([]);
    expect(renderOracleText(sweep)).toBe('Sundering Light deals 2 damage to each artifact creature.');

    expect(
      codes([
        {
          kind: 'dealDamage',
          amount: 2,
          scope: 'allPermanents',
          scopeFilter: { allCardTypes: ['artifact', 'enchantment'] },
          target: { kind: 'noTarget' },
        },
      ]),
    ).toEqual(['ILLEGAL_EFFECT_SCOPE']);
  });

  /**
   * The fixture-key freeze. Every recorded generator call is keyed by
   * `sha256(system, prompt, schema)`, so a field that reached the model-facing
   * JSON Schema would strand all of them and force a paid re-record.
   */
  it('is unreachable from every schema the generator is shown', () => {
    for (const schema of [
      ModelEffectSchema,
      PartBearingModelEffectSchema,
      ZoneReachingModelEffectSchema,
    ] as const) {
      const json = JSON.stringify(z.toJSONSchema(schema as unknown as z.ZodType, { io: 'input' }));
      expect(json).not.toContain('allCardTypes');
      expect(json).not.toContain('cardTypes');
    }
  });
});
