/** Destructive Force's per-player land sacrifice and exact printed sentence. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Card, CardInput } from '../src/index';
import { canonicalJson, ModelEffectSchema, renderOracleText, validateCard } from '../src/index';
import { parseCard } from '../src/parse';

function destructiveForceInput(target: 'noTarget' | 'targetPlayer' = 'noTarget'): CardInput {
  return {
    kind: 'sorcery',
    id: 'm11-133',
    name: 'Destructive Force',
    rarity: 'rare',
    set: { code: 'M11', collectorNumber: 133 },
    manaCost: { generic: 5, R: 2 },
    colors: ['R'],
    effects: [
      {
        kind: 'sacrificePermanent',
        count: 5,
        filter: { cardTypes: ['land'] },
        players: 'eachPlayer',
        target: { kind: target },
      },
      {
        kind: 'dealDamage',
        amount: 5,
        target: { kind: 'noTarget' },
        scope: 'allPermanents',
        scopeFilter: { cardTypes: ['creature'] },
      },
    ],
  } as unknown as CardInput;
}

describe('Destructive Force', () => {
  it('parses, validates, and renders both exact Oracle instructions', () => {
    const card = parseCard(destructiveForceInput());
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'Each player sacrifices five lands of their choice. Destructive Force deals 5 damage to each creature.',
    );
  });

  it('keeps the widened sacrifice instruction outside the generator schema', () => {
    const modelSchema = canonicalJson(z.toJSONSchema(ModelEffectSchema, { io: 'output' }));
    expect(modelSchema).not.toContain('sacrificePermanent');
    expect(modelSchema).not.toContain('eachPlayer');
  });

  it('refuses a player sweep beside a live target', () => {
    const card = destructiveForceInput('targetPlayer') as unknown as Card;
    expect(validateCard(card)).toContainEqual(
      expect.objectContaining({
        code: 'ILLEGAL_EFFECT_SCOPE',
        path: 'effects[0].players',
      }),
    );
  });
});
