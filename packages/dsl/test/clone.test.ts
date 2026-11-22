import { describe, expect, it } from 'vitest';
import { parseCard, printedEntryReplacement, renderOracleText } from '@mtg/dsl';

const CLONE = {
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
} as const;

describe('Clone entry replacement (mtg-nhyv.125)', () => {
  it('parses the hand-authored copy-as-entry clause and prints current Oracle text', () => {
    const card = parseCard(CLONE);

    expect(printedEntryReplacement(card)).toEqual({ kind: 'entersAsCopyOfCreature' });
    expect(renderOracleText(card)).toBe(
      'You may have this creature enter as a copy of any creature on the battlefield.',
    );
  });
});
