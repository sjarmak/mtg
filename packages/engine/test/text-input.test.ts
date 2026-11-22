/** Backend-neutral free-text decisions and their opaque recorded move ids. */
import { describe, expect, it } from 'vitest';
import { textSubmission, textValueOf, type TextDecisionInput } from '@mtg/engine';

const INPUT: TextDecisionInput = {
  kind: 'text',
  id: 'probe-name',
  label: 'A name',
  minLength: 1,
  maxLength: 12,
  suggestions: ['Bolt'],
};

describe('a text decision input', () => {
  it('round-trips Unicode through an opaque JSON-safe move id', () => {
    const move = textSubmission(INPUT, 'Æther Vial');
    expect(typeof move).toBe('string');
    expect(textValueOf(INPUT, move)).toBe('Æther Vial');
    expect(JSON.parse(JSON.stringify(move))).toBe(move);
  });

  it('does not accept another input id or a value outside the stated bounds', () => {
    expect(textValueOf({ ...INPUT, id: 'other' }, textSubmission(INPUT, 'Bolt'))).toBeNull();
    expect(() => textSubmission(INPUT, '')).toThrow(/at least 1/);
    expect(() => textSubmission(INPUT, 'x'.repeat(13))).toThrow(/at most 12/);
  });

  it.each([
    [{ ...INPUT, id: '' }, /id cannot be empty/],
    [{ ...INPUT, label: '' }, /label cannot be empty/],
    [{ ...INPUT, minLength: -1 }, /minimum length/],
    [{ ...INPUT, minLength: 1.5 }, /minimum length/],
    [{ ...INPUT, maxLength: 0 }, /maximum length/],
    [{ ...INPUT, maxLength: Number.MAX_SAFE_INTEGER + 1 }, /maximum length/],
    [{ ...INPUT, suggestions: [''] }, /suggestion/],
    [{ ...INPUT, suggestions: ['x'.repeat(13)] }, /suggestion/],
  ] as const)('refuses a malformed descriptor %#', (input, message) => {
    expect(() => textSubmission(input, 'Bolt')).toThrow(message);
    expect(textValueOf(input, textSubmission(INPUT, 'Bolt'))).toBeNull();
  });
});
