/** Exact Forge 2.0.14 script mapping for M13 #226, Hellion Crucible. */
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';
import { describe, expect, it } from 'vitest';

describe('Hellion Crucible Forge export', () => {
  it('uses Forge PRESSURE and the shipped card cost/token spellings exactly', () => {
    const card = parseCard({
      kind: 'land',
      id: 'm13-hellion-crucible',
      name: 'Hellion Crucible',
      rarity: 'rare',
      set: { code: 'M13', collectorNumber: 226 },
      producesMana: ['C'],
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 1, R: 1 }, tapSelf: true },
          effects: [
            { kind: 'putCounters', counter: 'pressure', count: 1, target: { kind: 'selfPermanent' } },
          ],
        },
        {
          kind: 'activated',
          cost: {
            mana: { generic: 1, R: 1 },
            tapSelf: true,
            removeCounter: { counter: 'pressure', count: 2 },
            sacrificeSelf: true,
          },
          effects: [
            {
              kind: 'createToken',
              count: 1,
              token: {
                name: 'Hellion',
                power: 4,
                toughness: 4,
                colors: ['R'],
                subtypes: ['Hellion'],
                keywords: ['haste'],
              },
            },
          ],
        },
      ],
    });
    const result = transpileCard(card);
    expect(result.ok ? [] : result.rejections).toEqual([]);
    if (!result.ok) return;
    expect(result.script.text).toContain(
      'A:AB$ PutCounter | Cost$ 1 R T | CounterType$ PRESSURE | CounterNum$ 1 | SpellDescription$ Put a pressure counter on CARDNAME.',
    );
    expect(result.script.text).toContain(
      'A:AB$ Token | Cost$ 1 R T SubCounter<2/PRESSURE> Sac<1/CARDNAME> | TokenScript$ r_4_4_hellion_haste | TokenOwner$ You | SpellDescription$ Create a 4/4 red Hellion creature token with haste.',
    );
  });
});
