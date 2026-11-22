/** Forge parity for Cryptborn Horror's dynamic ETB counter count. */
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';
import { describe, expect, it } from 'vitest';

const CARD = parseCard({
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
});

describe('Cryptborn Horror Forge parity', () => {
  it('emits the installed etbCounter and life-loss SVar in source order', () => {
    const result = transpileCard(CARD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.script.text.split('\n')).toEqual(
      expect.arrayContaining([
        'K:etbCounter:P1P1:X:no Condition:CARDNAME enters with X +1/+1 counters on it, where X is the total life lost by your opponents this turn.',
        'SVar:X:Count$LifeOppsLostThisTurn',
        'SVar:NeedsToPlayVar:X GE3',
      ]),
    );
  });
});
