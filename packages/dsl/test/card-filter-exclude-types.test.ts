/**
 * `CardFilter.excludeCardTypes`, and the hand-choice that needed it.
 *
 * Duress is the printed clause: "Target opponent reveals their hand. You choose
 * a noncreature, nonland card from it. That player discards that card." Written
 * as a bare `chooseDiscard` it validates clean and plays strictly stronger than
 * the printing, because nothing in the effect says which cards may be named and
 * the kernel therefore offers the whole hand. A clean validate that ships a
 * better card than the one on the page is worse than a refusal — a refusal is
 * visible in the census, and this was not.
 *
 * The field is `TargetFilter.excludeCardTypes` on the other filter, deliberately
 * to the letter: same name, same `CardKind` enum, same `.min(1)`, same
 * absent-means-unconstrained convention. The two schemas answer different
 * questions (`zone-filter.ts` argues that at length) and that is why this is a
 * second field rather than a shared one, but a reader who has learned the
 * negation once should not have to learn it again.
 *
 * The rendering claims are the half that nothing else checks. `filterAdjectives`
 * already prints `non${kind}` joined with commas for a target, which is exactly
 * the shape Duress prints, so the noun-phrase builders here quote it rather than
 * inventing a second spelling of the same English.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput, Effect } from '../src/index';
import { renderOracleText, validateCard } from '../src/index';
import { parseCard } from '../src/parse';
import { CardEffectSchema, CardFilterSchema, ModelEffectSchema } from '../src/effects';

function sorceryInput(name: string, effects: readonly Effect[]): CardInput {
  return {
    kind: 'sorcery',
    id: `tst-exclude-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 7 },
    manaCost: { B: 1 },
    colors: ['B'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [...effects],
  } as CardInput;
}

/**
 * The parsed card, for the assertions about what a *legal* card prints.
 *
 * `parseCard` runs the validator and throws on any violation, which is why the
 * two refusal cases below read `validateCard` on the raw input instead: a card
 * this lane's new check refuses cannot be parsed at all, and that is the check
 * working rather than a limitation of the helper.
 */
function sorcery(name: string, effects: readonly Effect[]): Card {
  return parseCard(sorceryInput(name, effects));
}

const DURESS_EFFECT: Effect = {
  kind: 'chooseDiscard',
  count: 1,
  target: { kind: 'targetOpponent' },
  filter: { excludeCardTypes: ['creature', 'land'] },
} as Effect;

describe('a card filter that excludes card types', () => {
  it('takes a non-empty list of card kinds and nothing else', () => {
    expect(CardFilterSchema.safeParse({ excludeCardTypes: ['creature'] }).success).toBe(true);
    expect(CardFilterSchema.safeParse({ excludeCardTypes: ['creature', 'land'] }).success).toBe(true);
    expect(CardFilterSchema.safeParse({ excludeCardTypes: [] }).success).toBe(false);
    expect(CardFilterSchema.safeParse({ excludeCardTypes: 'creature' }).success).toBe(false);
    expect(CardFilterSchema.safeParse({ excludeCardTypes: ['permanent'] }).success).toBe(false);
  });

  it('is reachable from every effect that already reads a card filter', () => {
    expect(CardEffectSchema.safeParse(DURESS_EFFECT).success).toBe(true);
    expect(
      CardEffectSchema.safeParse({
        kind: 'searchLibrary',
        filter: { excludeCardTypes: ['land'] },
        count: 1,
        reveal: true,
        destination: 'hand',
      }).success,
    ).toBe(true);
    expect(
      CardEffectSchema.safeParse({
        kind: 'chooseFromGraveyard',
        filter: { excludeCardTypes: ['land'] },
        whose: 'you',
        destination: 'hand',
      }).success,
    ).toBe(true);
  });

  it('stays out of the generator, so no recorded fixture key moves', () => {
    // `chooseDiscard` is unpriced and absent from `generatableEffects`, which is
    // the whole reason a filter could be added to it at no cost: the model-facing
    // schemas are hashed into the LLM fixture keys, and this field is not in one.
    expect(ModelEffectSchema.safeParse(DURESS_EFFECT).success).toBe(false);
  });

  it('prints Duress exactly as Magic 2011 printed it', () => {
    expect(renderOracleText(sorcery('Duress', [DURESS_EFFECT]))).toBe(
      'Target opponent reveals their hand. You choose a noncreature, nonland card from it. ' +
        'That player discards that card.',
    );
  });

  it('pluralizes the filtered noun the way an unfiltered one pluralizes', () => {
    expect(
      renderOracleText(
        sorcery('Distress the Hoard', [
          {
            kind: 'chooseDiscard',
            count: 2,
            target: { kind: 'targetOpponent' },
            filter: { excludeCardTypes: ['land'] },
          } as Effect,
        ]),
      ),
    ).toBe(
      'Target opponent reveals their hand. You choose two nonland cards from it. ' +
        'That player discards those cards.',
    );
  });

  it('leaves the unfiltered sentence byte for byte where it was', () => {
    // The filter is optional and its absence is not a new sentence. Coercion is
    // the card that already printed this line and it must not have moved.
    expect(
      renderOracleText(
        sorcery('Coercion', [
          { kind: 'chooseDiscard', count: 1, target: { kind: 'targetOpponent' } } as Effect,
        ]),
      ),
    ).toBe('Target opponent reveals their hand. You choose a card from it. That player discards that card.');
  });

  it('reads the exclusion into a search clause as an adjective on the noun', () => {
    expect(
      renderOracleText(
        sorcery('Rummage the Deep', [
          {
            kind: 'searchLibrary',
            filter: { excludeCardTypes: ['land'] },
            count: 1,
            reveal: true,
            destination: 'hand',
          } as Effect,
        ]),
      ),
    ).toContain('a nonland card');
  });

  it('validates Duress with no violations at all', () => {
    expect(validateCard(sorcery('Duress', [DURESS_EFFECT]))).toEqual([]);
  });

  it('refuses a filter that wants and excludes the same card type', () => {
    // The contradiction `TargetFilter` has always refused, now refused on this
    // filter too. Nothing can satisfy it, so a card printing it is a card whose
    // sentence describes the empty set while reading as though it selects.
    const found = validateCard(
      sorceryInput('Contradiction', [
        {
          kind: 'chooseDiscard',
          count: 1,
          target: { kind: 'targetOpponent' },
          filter: { cardTypes: ['creature'], excludeCardTypes: ['creature'] },
        } as Effect,
      ]),
    );
    expect(found).not.toEqual([]);
    expect(found.some((violation) => violation.message.includes('wanted and excluded'))).toBe(true);
  });

  it('refuses a list that names the same card type twice', () => {
    const found = validateCard(
      sorceryInput('Stutter', [
        {
          kind: 'chooseDiscard',
          count: 1,
          target: { kind: 'targetOpponent' },
          filter: { excludeCardTypes: ['land', 'land'] },
        } as Effect,
      ]),
    );
    expect(found.some((violation) => violation.message.includes('names the same value twice'))).toBe(true);
  });
});
