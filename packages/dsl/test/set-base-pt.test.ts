/**
 * `setBasePtUntilEndOfTurn`: the DSL half of CR 613.4b (`mtg-nhyv.72`).
 *
 * Diminish (M11) is the card the kind exists for, and the reason it could not
 * be spelled before is worth stating once here rather than being inferred from
 * the schema. "Target creature has base power and toughness 1/1 until end of
 * turn" is a *set*, applied in layer 7b; `pumpUntilEndOfTurn` is a *delta*,
 * applied in layer 7c. On a 5/5 the two can be made to agree by writing
 * `-4/-4`, and on every other creature they disagree, so the pump spelling is
 * not Diminish — it is a different card that happens to produce the same board
 * on one body.
 *
 * The kernel half, including what a +1/+1 counter and a `statBonusPer` static
 * do on top of the set and what board a layer-7c spelling would have produced
 * instead, is `packages/kernel/test/base-pt-layer.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import {
  ALL_EFFECT_KINDS,
  CardEffectSchema,
  EFFECT_KINDS,
  HAND_AUTHORED_TARGETS,
  LEGAL_TARGETS,
  ModelEffectSchema,
  UNPRICED_EFFECT_KINDS,
  legalTargetsFor,
  renderOracleText,
  safeParseCard,
  validateCards,
} from '@mtg/dsl';
import { parseCard } from '../src/parse';

/** `{U}` Instant. `Target creature has base power and toughness 1/1 until end of turn.` */
function diminishInput(): CardInput {
  return {
    kind: 'instant',
    id: 'ref-diminish',
    name: 'Diminish',
    rarity: 'common',
    set: { code: 'REF', collectorNumber: 52 },
    manaCost: { U: 1 },
    colors: ['U'],
    effects: [
      { kind: 'setBasePtUntilEndOfTurn', power: 1, toughness: 1, target: { kind: 'targetCreature' } },
    ],
  } as CardInput;
}

describe('the effect kind', () => {
  it('is unpriced: no slot may ask a model for it and no color pie prices it', () => {
    expect(ALL_EFFECT_KINDS).toContain('setBasePtUntilEndOfTurn');
    expect([...UNPRICED_EFFECT_KINDS]).toContain('setBasePtUntilEndOfTurn');
    expect([...EFFECT_KINDS]).not.toContain('setBasePtUntilEndOfTurn');
  });

  it("is on a card's union and off the model's", () => {
    const effect = {
      kind: 'setBasePtUntilEndOfTurn',
      power: 1,
      toughness: 1,
      target: { kind: 'targetCreature' },
    };
    expect(CardEffectSchema.safeParse(effect).success).toBe(true);
    expect(ModelEffectSchema.safeParse(effect).success).toBe(false);
  });

  it('names a creature and nothing else, hand-authored', () => {
    expect(LEGAL_TARGETS.setBasePtUntilEndOfTurn).toEqual([]);
    expect(HAND_AUTHORED_TARGETS['setBasePtUntilEndOfTurn']).toEqual(['targetCreature']);
    expect(legalTargetsFor('setBasePtUntilEndOfTurn')).toEqual(['targetCreature']);
  });

  /**
   * Two plain integers rather than the `Amount` union a pump's halves carry. A
   * base power and toughness that counts something is a characteristic-defining
   * ability (CR 604.3, layer 7a), which is a different record, so the schema
   * refuses the shape rather than compiling it into the wrong layer.
   */
  it('refuses a counted magnitude, which would be layer 7a and a different record', () => {
    const counted = {
      kind: 'setBasePtUntilEndOfTurn',
      power: { kind: 'countMatching', filter: { cardTypes: ['creature'] } },
      toughness: 1,
      target: { kind: 'targetCreature' },
    };
    expect(CardEffectSchema.safeParse(counted).success).toBe(false);
  });
});

describe('Diminish', () => {
  it('validates as a whole card and prints its printed line, word for word', () => {
    const card = parseCard(diminishInput());
    expect(validateCards([card])).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'Target creature has base power and toughness 1/1 until end of turn.',
    );
  });

  /**
   * The sentence a `pumpUntilEndOfTurn` would print in its place, side by side,
   * because the difference between the two cards is visible on the face and a
   * reader who cannot tell them apart there cannot tell them apart on the stack
   * either.
   */
  it('does not print the sentence the nearest pump would print', () => {
    const asPump = parseCard({
      ...diminishInput(),
      id: 'ref-not-diminish',
      name: 'Not Diminish',
      effects: [{ kind: 'pumpUntilEndOfTurn', power: -4, toughness: -4, target: { kind: 'targetCreature' } }],
    } as CardInput);
    expect(renderOracleText(asPump)).toBe('Target creature gets -4/-4 until end of turn.');
  });
});

describe('the numbers it may print', () => {
  function withStats(power: number, toughness: number): ReturnType<typeof safeParseCard> {
    return safeParseCard({
      ...diminishInput(),
      id: 'ref-diminish-variant',
      name: 'Diminish Variant',
      effects: [{ kind: 'setBasePtUntilEndOfTurn', power, toughness, target: { kind: 'targetCreature' } }],
    });
  }

  it('accepts a base power of zero, which is a real printed line', () => {
    expect(withStats(0, 1).ok).toBe(true);
  });

  /**
   * A base toughness of 0 is a destroy spell written the long way round: the
   * creature dies to a state-based action the instant the effect applies. The
   * floor keeps the one behavior at the one spelling, `destroyPermanent`.
   */
  it('refuses a base toughness of zero', () => {
    const result = withStats(1, 0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map((found) => found.code)).toContain('EFFECT_PARAM_OUT_OF_RANGE');
    expect(result.violations.map((found) => found.message).join(' ')).toContain('base toughness');
  });

  it('refuses a base power the card face has no room for', () => {
    const result = withStats(13, 13);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map((found) => found.message).join(' ')).toContain('base power');
  });
});
