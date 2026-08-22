/**
 * The step-10 life vocabulary at the DSL boundary: what it prints, what the
 * validator refuses, and what the generator still cannot say.
 *
 * The kernel half is `@mtg/kernel`'s `life-and-prevention.test.ts`. This file is
 * the other three surfaces the lane touched — the printed sentence, the two
 * scope rules a CR 614 replacement needs that a CR 613 static does not, and the
 * containment invariant, which is the one a reviewer should read first: five new
 * members reached `ALL_EFFECT_KINDS` and `STATIC_MODIFICATION_KINDS`, and none of
 * them reached the model. A set whose model can print "double all damage" prints
 * a broken format, and the assertion below is what makes that a compile-adjacent
 * fact rather than a promise.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput, Effect, StaticModification } from '@mtg/dsl';
import {
  ALL_EFFECT_KINDS,
  classifyStaticModification,
  EFFECT_KINDS,
  isLayeredStaticModification,
  legalTargetsFor,
  MODEL_EFFECT_KINDS,
  renderOracleText,
  STATIC_MODIFICATION_KINDS,
  UNPRICED_EFFECT_KINDS,
  validateCard,
} from '../src/index';
import { ModelStaticModificationSchema } from '../src/ability-shape';
import { parseCard } from '../src/parse';

function sorceryInput(effects: readonly Effect[]): Record<string, unknown> {
  return {
    kind: 'sorcery',
    id: 'xmp-life-spell-probe',
    name: 'Drain the Well',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 11 },
    manaCost: { generic: 1, B: 1 },
    colors: ['B'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [...effects],
  };
}

function enchantmentInput(
  scope: string,
  modification: StaticModification,
  subtype: string | null = null,
): Record<string, unknown> {
  return {
    kind: 'enchantment',
    id: 'xmp-life-static-probe',
    name: 'Kiln of Wrath',
    rarity: 'rare',
    set: { code: 'XMP', collectorNumber: 12 },
    manaCost: { generic: 2, R: 1 },
    colors: ['R'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [{ kind: 'static', scope, subtype, modification }],
    effects: [],
  };
}

/** `parseCard` throws on a violation, so a refusal is asserted off the record. */
function codesFor(input: Record<string, unknown>): readonly string[] {
  return validateCard(input as unknown as Card).map((found) => found.code);
}

function textOf(input: Record<string, unknown>): string {
  return renderOracleText(parseCard(input as CardInput));
}

describe('containment: the life vocabulary the engine runs and the model cannot name', () => {
  it('appends all five members and admits none of them to the model', () => {
    const priced: readonly string[] = EFFECT_KINDS;
    const chooseable: readonly string[] = MODEL_EFFECT_KINDS;
    for (const kind of ['loseLife', 'setLife', 'preventCombatDamage'] as const) {
      expect(ALL_EFFECT_KINDS).toContain(kind);
      expect(UNPRICED_EFFECT_KINDS).toContain(kind);
      expect(priced).not.toContain(kind);
      expect(chooseable).not.toContain(kind);
    }
    for (const kind of ['doubleDamage', 'doubleLifeGain'] as const) {
      expect(STATIC_MODIFICATION_KINDS).toContain(kind);
      // Read off the schema the model is actually shown rather than off a
      // parallel tuple, because the schema is what `@mtg/setgen` hashes.
      expect(ModelStaticModificationSchema.safeParse({ kind }).success).toBe(false);
    }
    expect(ModelStaticModificationSchema.options.map((option) => option.shape.kind.value)).toEqual([
      'statBonus',
      'grantKeyword',
    ]);
  });

  /**
   * Appended rather than inserted, which is what leaves the recorded fixtures
   * keyed against the same bytes: `z.enum` emits its members in tuple order and
   * `@mtg/setgen` hashes the JSON Schema it shows the model.
   *
   * The life block is pinned at the index it landed on rather than at the tail
   * of the tuple, and the difference is the whole point: a tail assertion says
   * "nothing has been appended since", which is not the invariant and fails
   * the first time a later lane appends its own kind correctly
   * (`chooseFromGraveyard` did). Pinning the index says "this block did not
   * move", which is the sentence the fixtures depend on.
   */
  it('leaves the prefix of the priced tuple exactly where it was', () => {
    expect([...ALL_EFFECT_KINDS].slice(0, EFFECT_KINDS.length)).toEqual([...EFFECT_KINDS]);
    // Neither tuple's tail is where this claim lives any more: `mtg-t3ik`
    // appended six combat-restriction kinds after the two static ones and the
    // graveyard lane appended a fourteenth unpriced kind after these three,
    // both honestly and both outside this lane. What the assertion owes
    // mtg-vobp is that each run stayed contiguous and in order wherever it
    // landed, so each one is located rather than assumed to be last.
    const loseLifeIndex = [...UNPRICED_EFFECT_KINDS].indexOf('loseLife');
    expect([...UNPRICED_EFFECT_KINDS].slice(loseLifeIndex, loseLifeIndex + 3)).toEqual([
      'loseLife',
      'setLife',
      'preventCombatDamage',
    ]);
    const doubleDamageIndex = [...STATIC_MODIFICATION_KINDS].indexOf('doubleDamage');
    expect([...STATIC_MODIFICATION_KINDS].slice(doubleDamageIndex, doubleDamageIndex + 2)).toEqual([
      'doubleDamage',
      'doubleLifeGain',
    ]);
  });
});

describe('the printed sentence', () => {
  it('prints a drain as the targeted line the kernel actually runs', () => {
    // Not "Each opponent loses 2 life", which is the line `mtg-vobp` scoped and
    // the line this kernel does not run: `targetOpponent` is CR 115.1 targeting,
    // so the card says what the rules do rather than what the bead said.
    expect(textOf(sorceryInput([{ kind: 'loseLife', amount: 2, target: { kind: 'targetOpponent' } }]))).toBe(
      'Target opponent loses 2 life.',
    );
    expect(textOf(sorceryInput([{ kind: 'loseLife', amount: 3, target: { kind: 'targetPlayer' } }]))).toBe(
      'Target player loses 3 life.',
    );
    expect(textOf(sorceryInput([{ kind: 'loseLife', amount: 1, target: { kind: 'noTarget' } }]))).toBe(
      'You lose 1 life.',
    );
  });

  it('prints a life total set and a Fog', () => {
    expect(textOf(sorceryInput([{ kind: 'setLife', amount: 10 }]))).toBe('Your life total becomes 10.');
    expect(textOf(sorceryInput([{ kind: 'preventCombatDamage' }]))).toBe(
      'Prevent all combat damage that would be dealt this turn.',
    );
  });

  /**
   * Furnace of Rath and Rhox Faithmender, spelled the way the printings spell
   * them. A replacement reads "if ... would ... instead", and a static reads
   * "creatures you control get +1/+1": the renderer has to reach a different
   * sentence builder for the two, and `isLayeredStaticModification` is what
   * routes it there.
   */
  it('prints a replacement as a replacement, not as a modification clause', () => {
    expect(textOf(enchantmentInput('self', { kind: 'doubleDamage' }))).toBe(
      'If a source would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.',
    );
    expect(textOf(enchantmentInput('self', { kind: 'doubleLifeGain' }))).toBe(
      'If you would gain life, you gain twice that much life instead.',
    );
  });
});

describe('the scope rules a CR 614 replacement needs', () => {
  it('sorts the two doublers out of the layered half', () => {
    expect(classifyStaticModification({ kind: 'doubleDamage' })).toBe('replacement');
    expect(classifyStaticModification({ kind: 'doubleLifeGain' })).toBe('replacement');
    expect(classifyStaticModification({ kind: 'statBonus', power: 1, toughness: 1 })).toBe('layered');
    expect(isLayeredStaticModification({ kind: 'doubleDamage' })).toBe(false);
    expect(isLayeredStaticModification({ kind: 'grantKeyword', keyword: 'flying' })).toBe(true);
  });

  /**
   * The rule that had to be relaxed, and the reason it is worth a test: the
   * existing scope check refuses `self` on anything that is not a creature,
   * because a creature's own body is what a `self` static usually modifies.
   * Furnace of Rath is an enchantment, and refusing it would have refused the
   * one printed card this lane exists for.
   */
  it('accepts a replacement on an enchantment, which the creature-only rule would have refused', () => {
    expect(codesFor(enchantmentInput('self', { kind: 'doubleDamage' }))).toEqual([]);
    expect(codesFor(enchantmentInput('self', { kind: 'doubleLifeGain' }))).toEqual([]);
  });

  it('refuses a replacement that claims a set of permanents', () => {
    expect(codesFor(enchantmentInput('creaturesYouControl', { kind: 'doubleDamage' }))).toContain(
      'REPLACEMENT_MODIFICATION_ILLEGAL_ON_SCOPE',
    );
    expect(codesFor(enchantmentInput('otherCreaturesYouControl', { kind: 'doubleLifeGain' }))).toContain(
      'REPLACEMENT_MODIFICATION_ILLEGAL_ON_SCOPE',
    );
  });
});

describe('the target rules', () => {
  it('gives a drain three player-shaped slots, a back-reference, and the other two none', () => {
    // `thatPlayer` is the fourth because Sign in Blood (M11 #117, M13 #110)
    // drains the player it just made draw, and reading the slot the draw chose
    // is the only way to say "that player" — a second `targetPlayer` would let
    // the two halves land on different seats.
    expect([...legalTargetsFor('loseLife')]).toEqual([
      'noTarget',
      'targetPlayer',
      'targetOpponent',
      'thatPlayer',
    ]);
    expect([...legalTargetsFor('setLife')]).toEqual([]);
    expect([...legalTargetsFor('preventCombatDamage')]).toEqual([]);
  });

  it('holds both life amounts to the same range a life gain is held to', () => {
    expect(
      codesFor(sorceryInput([{ kind: 'loseLife', amount: 21, target: { kind: 'noTarget' } }])),
    ).toContain('EFFECT_PARAM_OUT_OF_RANGE');
    expect(codesFor(sorceryInput([{ kind: 'setLife', amount: 0 }]))).toContain('EFFECT_PARAM_OUT_OF_RANGE');
    expect(codesFor(sorceryInput([{ kind: 'setLife', amount: 20 }]))).toEqual([]);
  });
});
