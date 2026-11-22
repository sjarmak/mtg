/** Forge parity for Brittle Effigy's source-exile activation cost. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('Brittle Effigy', () => {
  /**
   * Source: Card-Forge/forge at 0c9f64ae0d46290523d17e6e6b2cc76331743a9e,
   * `forge-gui/res/cardsfolder/b/brittle_effigy.txt`.
   */
  it('writes the attested Exile source cost without treating it as a sacrifice', () => {
    const card = parseCard({
      kind: 'artifact',
      id: 'm11-202',
      name: 'Brittle Effigy',
      rarity: 'rare',
      set: { code: 'M11', collectorNumber: 202 },
      manaCost: { generic: 1 },
      colors: [],
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 4 }, tapSelf: true, exileSelf: true },
          effects: [{ kind: 'exileTarget', target: { kind: 'targetCreature' } }],
        },
      ],
    });

    expect(mustTranspile(card)).toBe(
      [
        'Name:Brittle Effigy',
        'ManaCost:1',
        'Types:Artifact',
        'A:AB$ ChangeZone | Cost$ 4 T Exile<1/CARDNAME> | ValidTgts$ Creature | Origin$ Battlefield | Destination$ Exile | SpellDescription$ Exile target creature.',
        'Oracle:{4}, {T}, Exile Brittle Effigy: Exile target creature.',
        '',
      ].join('\n'),
    );
  });
});
