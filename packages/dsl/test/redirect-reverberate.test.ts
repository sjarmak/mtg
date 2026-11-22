/** Redirect and Reverberate as hand-authored stack-spell operations. */
import { describe, expect, it } from 'vitest';
import {
  CardEffectSchema,
  colorsFromCost,
  mana,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  validateCard,
  type CardInput,
  type ManaCostInput,
} from '@mtg/dsl';

const CHANGE_TARGETS = { kind: 'changeSpellTargets' } as const;
const COPY_INSTANT_OR_SORCERY = {
  kind: 'copySpell',
  spellFilter: { cardTypes: ['instant', 'sorcery'] },
} as const;

function spell(
  name: string,
  collectorNumber: number,
  manaCostInput: ManaCostInput,
  effect: unknown,
): CardInput {
  const manaCost = mana(manaCostInput);
  return {
    kind: 'instant',
    id: `m11-${String(collectorNumber)}-${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`,
    name,
    rarity: 'rare',
    set: { code: 'M11', collectorNumber },
    manaCost,
    colors: colorsFromCost(manaCost),
    effects: [effect],
  } as CardInput;
}

describe('Redirect and Reverberate authoring', () => {
  it('parses and renders both current Oracle texts exactly', () => {
    const redirect = parseCard(spell('Redirect', 71, { U: 2 }, CHANGE_TARGETS));
    const reverberate = parseCard(spell('Reverberate', 155, { R: 2 }, COPY_INSTANT_OR_SORCERY));

    expect(validateCard(redirect)).toEqual([]);
    expect(validateCard(reverberate)).toEqual([]);
    expect(renderOracleText(redirect)).toBe('You may choose new targets for target spell.');
    expect(renderOracleText(reverberate)).toBe(
      'Copy target instant or sorcery spell. You may choose new targets for the copy.',
    );
  });

  it('prints an accepted target-changing spell filter in the same words the kernel enforces', () => {
    const filtered = parseCard(
      spell(
        'Redirect',
        902,
        { U: 2 },
        {
          kind: 'changeSpellTargets',
          spellFilter: { cardTypes: ['instant'] },
        },
      ),
    );

    expect(renderOracleText(filtered)).toBe('You may choose new targets for target instant spell.');
  });

  it('keeps both stack decisions outside the generator answer schema', () => {
    for (const effect of [CHANGE_TARGETS, COPY_INSTANT_OR_SORCERY]) {
      expect(CardEffectSchema.safeParse(effect).success).toBe(true);
      expect(ModelEffectSchema.safeParse(effect).success).toBe(false);
    }
  });

  it('refuses stack filters that cannot describe a spell', () => {
    expect(
      CardEffectSchema.safeParse({ kind: 'copySpell', spellFilter: { cardTypes: ['land'] } }).success,
    ).toBe(true);
    const invalid = spell(
      'Bad Copy',
      900,
      { U: 1 },
      {
        kind: 'copySpell',
        spellFilter: { cardTypes: ['land'] },
      },
    );
    const result = safeParseCard(invalid);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toContainEqual(
      expect.objectContaining({ code: 'ILLEGAL_TARGET_FILTER', path: 'effects[0].spellFilter.cardTypes' }),
    );
  });

  it('refuses copy filters that can reach permanent spells the kernel cannot copy yet', () => {
    for (const spellFilter of [undefined, { cardTypes: ['creature'] }] as const) {
      const effect = {
        kind: 'copySpell',
        ...(spellFilter === undefined ? {} : { spellFilter }),
      };
      const result = safeParseCard(spell('Unsupported Copy', 901, { U: 1 }, effect));
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.violations).toContainEqual(
        expect.objectContaining({ code: 'ILLEGAL_TARGET_FILTER', path: 'effects[0].spellFilter.cardTypes' }),
      );
    }
  });
});
