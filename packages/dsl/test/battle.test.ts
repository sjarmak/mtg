import { describe, expect, it } from 'vitest';
import {
  CARD_KINDS,
  parseCard,
  renderOracleText,
  safeParseCard,
  transformedBackFaceOf,
  validateCard,
} from '@mtg/dsl';

const BASE = {
  kind: 'battle' as const,
  id: 'tst-open-front',
  name: 'Open Front',
  rarity: 'uncommon' as const,
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { generic: 2, R: 1 },
  colors: ['R'] as const,
  defense: 4,
};

describe('battle cards', () => {
  it('parses a first-class non-Siege Battle with printed defense', () => {
    const card = parseCard(BASE);
    expect(card.kind).toBe('battle');
    if (card.kind !== 'battle') throw new Error('expected battle');
    expect(card.defense).toBe(4);
    expect(card.subtypes).toEqual([]);
    expect(renderOracleText(card)).toBe('');
    expect(CARD_KINDS).toContain('battle');
  });

  it('rejects invalid printed defense at the strict schema boundary', () => {
    expect(safeParseCard({ ...BASE, defense: 0 }).ok).toBe(false);
    expect(safeParseCard({ ...BASE, defense: 2.5 }).ok).toBe(false);
  });

  it('retains a typed Siege back face and materializes it as a zero-mana spell', () => {
    const front = parseCard({
      kind: 'battle',
      id: 'tst-invasion',
      name: 'Invasion of Tests',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 8 },
      manaCost: { generic: 3, R: 1 },
      colors: ['R'],
      subtypes: ['Siege'],
      defense: 4,
      backFace: {
        kind: 'creature',
        name: 'Test Victor',
        colors: ['R'],
        subtypes: ['Warrior'],
        keywords: ['haste'],
        power: 4,
        toughness: 4,
      },
    });
    expect(front.kind).toBe('battle');
    if (front.kind !== 'battle') return;
    const back = transformedBackFaceOf(front);
    expect(back).toEqual(
      expect.objectContaining({
        kind: 'creature',
        id: front.id,
        name: 'Test Victor',
        manaCost: { generic: 0, W: 0, U: 0, B: 0, R: 0, G: 0, hasX: false },
        power: 4,
        toughness: 4,
      }),
    );
  });

  it('requires Siege and transforming back-face state to occur together', () => {
    const base = {
      kind: 'battle',
      id: 'tst-mismatched-front',
      name: 'Mismatched Front',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 10 },
      manaCost: { generic: 3 },
      colors: [],
      defense: 3,
    } as const;
    expect(validateCard({ ...base, subtypes: ['Siege'] })).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'BATTLE_INVALID', path: 'backFace' })]),
    );
    expect(
      validateCard({
        ...base,
        backFace: { kind: 'creature', name: 'Unbound Back', power: 3, toughness: 3 },
      }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'BATTLE_INVALID', path: 'subtypes' })]),
    );
  });
});
