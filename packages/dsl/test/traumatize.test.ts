/** Traumatize's target-relative library fraction and exact printed sentence. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Card, CardInput } from '../src/index';
import { AmountSchema, canonicalJson, ModelEffectSchema, renderOracleText, validateCard } from '../src/index';
import { parseCard } from '../src/parse';

const HALF_TARGET_LIBRARY = { kind: 'halfTargetLibraryRoundedDown' } as const;

function traumatizeInput(target: 'targetPlayer' | 'noTarget'): CardInput {
  return {
    kind: 'sorcery',
    id: 'm11-077',
    name: 'Traumatize',
    rarity: 'rare',
    set: { code: 'M11', collectorNumber: 77 },
    manaCost: { generic: 3, U: 2 },
    colors: ['U'],
    effects: [{ kind: 'millCards', count: HALF_TARGET_LIBRARY, target: { kind: target } }],
  } as unknown as CardInput;
}

describe('Traumatize', () => {
  it('parses, validates, and renders the exact Oracle sentence', () => {
    const card = parseCard(traumatizeInput('targetPlayer'));
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe('Target player mills half their library, rounded down.');
  });

  it('keeps the target-relative amount out of the generator schema', () => {
    expect(AmountSchema.parse(HALF_TARGET_LIBRARY)).toEqual(HALF_TARGET_LIBRARY);
    expect(canonicalJson(z.toJSONSchema(ModelEffectSchema, { io: 'output' }))).not.toContain(
      'halfTargetLibraryRoundedDown',
    );
  });

  it('refuses the amount when no player target supplies the library', () => {
    const card = traumatizeInput('noTarget') as unknown as Card;
    expect(validateCard(card)).toContainEqual(
      expect.objectContaining({
        code: 'ILLEGAL_TARGET_FOR_EFFECT',
        path: 'effects[0].count.kind',
        message: expect.stringContaining('player target'),
      }),
    );
  });
});
