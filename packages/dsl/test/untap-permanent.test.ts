/**
 * `untapPermanent`: CR 701.20a, and the counterpart `tapPermanent` has never
 * had.
 *
 * `effects.ts` argues the shape — a kind rather than a rider on the tap,
 * because the two are different actions rather than one action and an adverb;
 * every permanent rather than every creature, because two of the three printed
 * lines that want it (Voltaic Key's artifact, M13's land) are not creatures at
 * all. This file covers the three surfaces at the DSL boundary: the schema, the
 * printed sentence, and the containment invariant that keeps the kind reachable
 * by a hand-authored card and unreachable from the generator. The kernel half,
 * proving a tapped permanent actually turns and an untapped one reports
 * nothing, is `@mtg/kernel`'s `untap-permanent.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput, Effect } from '@mtg/dsl';
import {
  ALL_EFFECT_KINDS,
  EFFECT_KINDS,
  legalTargetsFor,
  MODEL_EFFECT_KINDS,
  renderOracleText,
  UNPRICED_EFFECT_KINDS,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';

function instantInput(effects: readonly Effect[]): Record<string, unknown> {
  return {
    kind: 'instant',
    id: 'xmp-untap-probe',
    name: 'Second Wind Probe',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 31 },
    manaCost: { generic: 1, U: 1 },
    colors: ['U'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [...effects],
  };
}

/** `parseCard` throws on a violation, so a refusal is asserted off the record. */
function codesFor(input: Record<string, unknown>): readonly string[] {
  return validateCard(input as unknown as Card).map((found) => found.code);
}

function textOf(input: Record<string, unknown>): string {
  return renderOracleText(parseCard(input as CardInput));
}

describe('containment: hand-authored vocabulary the model cannot name', () => {
  it('reaches ALL_EFFECT_KINDS and UNPRICED_EFFECT_KINDS and neither priced list', () => {
    const priced: readonly string[] = EFFECT_KINDS;
    const chooseable: readonly string[] = MODEL_EFFECT_KINDS;
    expect(ALL_EFFECT_KINDS).toContain('untapPermanent');
    expect(UNPRICED_EFFECT_KINDS).toContain('untapPermanent');
    expect(priced).not.toContain('untapPermanent');
    expect(chooseable).not.toContain('untapPermanent');
  });

  /**
   * Position rather than tail. `preventAllDamageToTarget`'s own file asserted
   * `.at(-1)` and predicted in prose that a later lane appending correctly
   * would fail it; this is that lane, so the assertion it kept is the one that
   * survives another append — this kind lands after the sibling that was last,
   * and the tuple is still append-only.
   */
  it('lands after the member that was last when it arrived', () => {
    const kinds: readonly string[] = UNPRICED_EFFECT_KINDS;
    expect(kinds.indexOf('untapPermanent')).toBe(kinds.indexOf('preventAllDamageToTarget') + 1);
    // Not a tail assertion, for the reason the docblock gives: `mtg-2qyk`
    // appended `grantKeywordUntilEndOfTurn` behind this one within the hour.
    const all: readonly string[] = ALL_EFFECT_KINDS;
    expect(all.indexOf('untapPermanent')).toBe(
      all.length - UNPRICED_EFFECT_KINDS.length + kinds.indexOf('untapPermanent'),
    );
  });
});

describe('the printed sentence', () => {
  it('prints one verb and one target for the widest space', () => {
    expect(textOf(instantInput([{ kind: 'untapPermanent', target: { kind: 'targetPermanent' } }]))).toBe(
      'Untap target permanent.',
    );
  });

  it('prints the narrower English when the card names a creature it controls', () => {
    expect(
      textOf(instantInput([{ kind: 'untapPermanent', target: { kind: 'targetCreatureYouControl' } }])),
    ).toBe('Untap target creature you control.');
  });

  /**
   * Voltaic Key's line, which is the whole reason the space is every permanent:
   * the narrowing is a `TargetSpec.filter` over the wide kind rather than a
   * `targetArtifact` member `TARGET_KINDS` does not have.
   */
  it('prints the artifact reading through the filter rather than a second kind', () => {
    expect(
      textOf(
        instantInput([
          {
            kind: 'untapPermanent',
            target: { kind: 'targetPermanent', filter: { cardTypes: ['artifact'] } },
          },
        ]),
      ),
    ).toBe('Untap target artifact.');
  });
});

describe('the target rules', () => {
  it('names the three kinds whose English a printed card actually uses', () => {
    expect([...legalTargetsFor('untapPermanent')]).toEqual([
      'targetPermanent',
      'targetCreature',
      'targetCreatureYouControl',
    ]);
  });

  it('parses a card that names one of them', () => {
    expect(codesFor(instantInput([{ kind: 'untapPermanent', target: { kind: 'targetPermanent' } }]))).toEqual(
      [],
    );
  });

  it('refuses a target kind the effect does not legalize', () => {
    expect(codesFor(instantInput([{ kind: 'untapPermanent', target: { kind: 'targetPlayer' } }]))).toContain(
      'ILLEGAL_TARGET_FOR_EFFECT',
    );
  });
});
