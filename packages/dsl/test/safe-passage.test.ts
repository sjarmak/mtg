/** Safe Passage's hand-authored controller-and-creature prevention scope. */
import { describe, expect, it } from 'vitest';
import {
  ALL_EFFECT_KINDS,
  legalTargetsFor,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  UNPRICED_EFFECT_KINDS,
} from '@mtg/dsl';

const EFFECT = { kind: 'preventAllDamageToYouAndCreaturesYouControl' as const };

const SAFE_PASSAGE = {
  kind: 'instant' as const,
  id: 'tst-safe-passage',
  name: 'Safe Passage',
  rarity: 'common' as const,
  set: { code: 'M11', collectorNumber: 26 },
  colors: ['W'] as const,
  manaCost: { generic: 2, W: 1 },
  effects: [EFFECT],
};

describe('Safe Passage authoring', () => {
  it('prints current Oracle without turning the protected group into targets', () => {
    const card = parseCard(SAFE_PASSAGE);
    expect(renderOracleText(card)).toBe(
      'Prevent all damage that would be dealt to you and creatures you control this turn.',
    );
    expect([...legalTargetsFor(EFFECT.kind)]).toEqual([]);
  });

  it('is reachable by hand but remains outside model output', () => {
    expect(ALL_EFFECT_KINDS).toContain(EFFECT.kind);
    expect(UNPRICED_EFFECT_KINDS).toContain(EFFECT.kind);
    expect(ModelEffectSchema.safeParse(EFFECT).success).toBe(false);
  });
});
