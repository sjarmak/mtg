import { describe, expect, it } from 'vitest';
import { canonicalJson, ModelEffectSchema, parseCard, renderOracleText, validateCard } from '../src/index';
import { z } from 'zod';

const BLOOD_TITHE = parseCard({
  kind: 'sorcery',
  id: 'm11-blood-tithe',
  name: 'Blood Tithe',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 84 },
  manaCost: { generic: 3, B: 1 },
  colors: ['B'],
  effects: [
    { kind: 'loseLife', amount: 3, players: 'eachOpponent', target: { kind: 'noTarget' } },
    { kind: 'gainLife', amount: { kind: 'lifeLostThisResolution' }, target: { kind: 'noTarget' } },
  ],
});

describe('Blood Tithe', () => {
  it('parses and prints the exact M11 card', () => {
    expect(validateCard(BLOOD_TITHE)).toEqual([]);
    expect(renderOracleText(BLOOD_TITHE)).toBe(
      'Each opponent loses 3 life. You gain life equal to the life lost this way.',
    );
  });

  it('keeps the resolution-linked amount outside the generator vocabulary', () => {
    const modelSchema = canonicalJson(z.toJSONSchema(ModelEffectSchema, { io: 'output' }));
    expect(modelSchema).not.toContain('lifeLostThisResolution');
  });
});
