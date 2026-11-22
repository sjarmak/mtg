/** Forge parity for M13 #203, Door to Nothingness. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('Door to Nothingness', () => {
  /**
   * Source: Card-Forge/forge master,
   * `forge-gui/res/cardsfolder/d/door_to_nothingness.txt`.
   */
  it('writes the attested game-loss operation and exact activation cost', () => {
    const card = parseCard({
      kind: 'artifact',
      id: 'm13-203',
      name: 'Door to Nothingness',
      rarity: 'rare',
      set: { code: 'M13', collectorNumber: 203 },
      manaCost: { generic: 5 },
      colors: [],
      entryReplacement: { kind: 'entersTapped' },
      abilities: [
        {
          kind: 'activated',
          cost: {
            mana: { W: 2, U: 2, B: 2, R: 2, G: 2 },
            tapSelf: true,
            sacrificeSelf: true,
          },
          effects: [{ kind: 'loseGame', target: { kind: 'targetPlayer' } }],
        },
      ],
    } as unknown as CardInput);

    expect(mustTranspile(card)).toBe(
      [
        'Name:Door to Nothingness',
        'ManaCost:5',
        'Types:Artifact',
        'R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield | ReplacementResult$ Updated | ReplaceWith$ ETBTapped | Description$ CARDNAME enters tapped.',
        'SVar:ETBTapped:DB$ Tap | Defined$ Self | ETB$ True',
        'A:AB$ LosesGame | Cost$ W W U U B B R R G G T Sac<1/CARDNAME> | ValidTgts$ Player | SpellDescription$ Target player loses the game.',
        'Oracle:Door to Nothingness enters tapped.\\n{W}{W}{U}{U}{B}{B}{R}{R}{G}{G}, {T}, Sacrifice Door to Nothingness: Target player loses the game.',
        '',
      ].join('\n'),
    );
  });
});
