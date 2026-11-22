/** Source-attested Forge spellings for Triskelion's two counter clauses. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

describe('Triskelion counter script', () => {
  it('writes etbCounter and SubCounter exactly as Forge does upstream', () => {
    const card = parseCard({
      kind: 'creature',
      artifact: true,
      id: 'tst-triskelion',
      name: 'Triskelion',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 218 },
      colors: [],
      manaCost: { generic: 6 },
      power: 1,
      toughness: 1,
      entryReplacement: { kind: 'entersWithCounters', counter: 'plusOnePlusOne', count: 3 },
      abilities: [
        {
          kind: 'activated',
          cost: { mana: {}, removeCounter: { counter: 'plusOnePlusOne', count: 1 } },
          effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
        },
      ],
    });
    const result = transpileCard(card);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.text).toContain('K:etbCounter:P1P1:3');
    expect(result.script.text).toContain('Cost$ SubCounter<1/P1P1>');
  });
});
