import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCardScript } from '@mtg/forge-export';

const CLONE = parseCard({
  kind: 'creature',
  id: 'm11-clone',
  name: 'Clone',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 49 },
  manaCost: { generic: 3, U: 1 },
  colors: ['U'],
  subtypes: ['Shapeshifter'],
  power: 0,
  toughness: 0,
  entryReplacement: { kind: 'entersAsCopyOfCreature' },
});

describe('Clone at the Forge parity boundary (mtg-nhyv.125)', () => {
  it('emits Forge current-script exact entry-copy machinery', () => {
    const result = transpileCardScript(CLONE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.lines).toContain('K:ETBReplacement:Copy:DBCopy:Optional');
    expect(result.value.lines).toContain(
      'SVar:DBCopy:DB$ Clone | Choices$ Creature.Other | SpellDescription$ You may have CARDNAME enter as a copy of any creature on the battlefield.',
    );
  });
});
