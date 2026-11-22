/** Engine-only marker semantics for Hellion Crucible's pressure counters. */
import { describe, expect, it } from 'vitest';
import {
  COUNTER_DECLARATIONS,
  COUNTER_KINDS,
  counterGrantedKeywords,
  CounterKindSchema,
  counterReminderText,
  counterStatBonus,
  MODEL_COUNTER_KINDS,
  ModelCounterKindSchema,
} from '../src/index';

describe('pressure counters', () => {
  it('declares one zero-modification marker outside the model vocabulary', () => {
    expect(COUNTER_KINDS.filter((kind) => kind === 'pressure')).toEqual(['pressure']);
    expect(COUNTER_DECLARATIONS.pressure).toEqual({ printName: 'pressure', modifications: [] });
    expect(CounterKindSchema.parse('pressure')).toBe('pressure');
    expect(MODEL_COUNTER_KINDS).not.toContain('pressure');
    expect(ModelCounterKindSchema.safeParse('pressure').success).toBe(false);
    expect(counterStatBonus('pressure')).toEqual({ power: 0, toughness: 0 });
    expect(counterGrantedKeywords('pressure')).toEqual([]);
    expect(counterReminderText('pressure')).toBeNull();
  });
});
