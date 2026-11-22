import { describe, expect, it } from 'vitest';
import { ALL_EFFECT_KINDS, EFFECT_CAPABILITIES } from '../src/index';

describe('the effect capability extension contract', () => {
  it('classifies every engine primitive exactly once', () => {
    expect(Object.keys(EFFECT_CAPABILITIES).sort()).toStrictEqual([...ALL_EFFECT_KINDS].sort());
  });

  it('states both policies that downstream packages read', () => {
    for (const kind of ALL_EFFECT_KINDS) {
      expect(EFFECT_CAPABILITIES[kind].harmfulness, `${kind} harmfulness`).toBeTypeOf('string');
      expect(EFFECT_CAPABILITIES[kind].targetScoring, `${kind} target scoring`).toBeTypeOf('string');
    }
  });

  it('does not collapse a graveyard card return into battlefield bounce', () => {
    expect(EFFECT_CAPABILITIES.returnToHand.targetScoring).toBe('returnToHand');
    expect(EFFECT_CAPABILITIES.putOnLibrary.targetScoring).toBe('bounce');
  });
});
