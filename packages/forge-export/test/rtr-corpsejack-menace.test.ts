/** Forge parity for Corpsejack Menace's AddCounter replacement. */
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';
import { describe, expect, it } from 'vitest';

const CARD = parseCard({
  kind: 'creature',
  id: 'rtr-152-corpsejack-menace',
  name: 'Corpsejack Menace',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 152 },
  manaCost: { generic: 2, B: 1, G: 1 },
  colors: ['B', 'G'],
  subtypes: ['Fungus'],
  power: 4,
  toughness: 4,
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'doublePlusOnePlusOneCountersOnCreaturesYouControl' },
    },
  ],
});

describe('Corpsejack Menace Forge parity', () => {
  it('emits the installed Forge replacement and SVar ordering exactly', () => {
    const result = transpileCard(CARD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.script.text.split('\n')).toEqual(
      expect.arrayContaining([
        'R:Event$ AddCounter | ActiveZones$ Battlefield | ValidCard$ Creature.YouCtrl+inZoneBattlefield | ValidCounterType$ P1P1 | ReplaceWith$ DoubleCounters | Description$ If one or more +1/+1 counters would be put on a creature you control, twice that many +1/+1 counters are put on it instead.',
        'SVar:DoubleCounters:DB$ ReplaceCounter | ValidCounterType$ P1P1 | Amount$ X',
        'SVar:X:ReplaceCount$CounterNum/Twice',
      ]),
    );
  });
});
