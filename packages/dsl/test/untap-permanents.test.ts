/** Rewind's non-targeted, bounded battlefield choice. */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import {
  ALL_EFFECT_KINDS,
  EFFECT_KINDS,
  MODEL_EFFECT_KINDS,
  renderOracleText,
  UNPRICED_EFFECT_KINDS,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';

function rewindInput(upTo: number = 4, filter: unknown = { cardTypes: ['land'] }): Record<string, unknown> {
  return {
    kind: 'instant',
    id: 'm13-65',
    name: 'Rewind',
    rarity: 'uncommon',
    set: { code: 'M13', collectorNumber: 65 },
    manaCost: { generic: 2, U: 2 },
    colors: ['U'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [{ kind: 'counterSpell' }, { kind: 'untapPermanents', upTo, filter }],
  };
}

function codesFor(input: Record<string, unknown>): readonly string[] {
  return validateCard(input as unknown as Card).map((violation) => violation.code);
}

describe('untapPermanents', () => {
  it('parses and renders Rewind without turning the lands into targets', () => {
    const card = parseCard(rewindInput() as CardInput);

    expect(renderOracleText(card)).toBe('Counter target spell. Untap up to four lands.');
    expect(card.effects).toEqual([
      { kind: 'counterSpell' },
      { kind: 'untapPermanents', upTo: 4, filter: { cardTypes: ['land'] } },
    ]);
  });

  it('is hand-authored and unpriced while remaining part of the executable effect union', () => {
    const priced: readonly string[] = EFFECT_KINDS;
    const model: readonly string[] = MODEL_EFFECT_KINDS;

    expect(ALL_EFFECT_KINDS).toContain('untapPermanents');
    expect(UNPRICED_EFFECT_KINDS).toContain('untapPermanents');
    expect(priced).not.toContain('untapPermanents');
    expect(model).not.toContain('untapPermanents');
  });

  it('requires one through four choices and an explicit permanent filter', () => {
    expect(codesFor(rewindInput(0))).not.toEqual([]);
    expect(codesFor(rewindInput(5))).not.toEqual([]);
    expect(codesFor(rewindInput(4, null))).not.toEqual([]);
  });
});
