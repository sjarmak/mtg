/** Cryptborn Horror's exact dynamic entry-counter value. */
import { describe, expect, it } from 'vitest';
import { parseCard, renderOracleText, validateCard, type CardInput } from '../src/index';

const INPUT = {
  kind: 'creature',
  id: 'rtr-212-cryptborn-horror',
  name: 'Cryptborn Horror',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 212 },
  manaCost: { generic: 1, hybrid: { 'B/R': 2 } },
  colors: ['B', 'R'],
  subtypes: ['Horror'],
  power: 0,
  toughness: 0,
  keywords: ['trample'],
  entryReplacement: {
    kind: 'entersWithCounters',
    counter: 'plusOnePlusOne',
    count: { kind: 'opponentsLifeLostThisTurn' },
  },
} satisfies CardInput;

describe('Cryptborn Horror DSL', () => {
  it('prints the current Oracle text in exact order', () => {
    const card = parseCard(INPUT);

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'Trample\nThis creature enters with X +1/+1 counters on it, where X is the total life lost by your opponents this turn.',
    );
  });

  it('accepts the turn-scoped value without pretending it is chosen X', () => {
    const card = parseCard(INPUT);
    if (card.kind !== 'creature') throw new Error('Cryptborn Horror must parse as a creature');

    expect(card.manaCost.hasX).toBe(false);
    expect(card.entryReplacement).toEqual(INPUT.entryReplacement);
  });
});
