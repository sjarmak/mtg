/** Source-pinned Forge parity for M13 Fog Bank. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

describe('M13 Fog Bank Forge parity', () => {
  it("matches Forge's shipped keyword line exactly", () => {
    const card = parseCard({
      kind: 'creature',
      id: 'm13-052-fog-bank',
      name: 'Fog Bank',
      rarity: 'uncommon',
      set: { code: 'M13', collectorNumber: 52 },
      colors: ['U'],
      manaCost: { generic: 1, U: 1 },
      power: 0,
      toughness: 2,
      subtypes: ['Wall'],
      keywords: ['flying'],
      keywordAbilities: [{ kind: 'defender' }],
      abilities: [
        {
          kind: 'static',
          scope: 'self',
          subtype: null,
          modification: { kind: 'preventCombatDamage' },
        },
      ],
    });
    const result = transpileCard(card);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.rejections.map((entry) => entry.message).join('\n'));
    expect(result.script.text.split('\n').filter((line) => line.startsWith('K:'))).toEqual([
      'K:Defender',
      'K:Flying',
      'K:Prevent all combat damage that would be dealt to and dealt by CARDNAME.',
    ]);
  });
});
