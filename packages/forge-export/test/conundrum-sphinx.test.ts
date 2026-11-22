/** Forge parity for Conundrum Sphinx's simultaneous name-and-reveal sequence. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('Conundrum Sphinx', () => {
  /**
   * Source: Card-Forge/forge at 0c9f64ae0d46290523d17e6e6b2cc76331743a9e,
   * `forge-gui/res/cardsfolder/c/conundrum_sphinx.txt`.
   */
  it('writes the attested name, repeated dig, and cleanup chain', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'm11-051',
      name: 'Conundrum Sphinx',
      rarity: 'rare',
      set: { code: 'M11', collectorNumber: 51 },
      manaCost: { generic: 2, W: 0, U: 2, B: 0, R: 0, G: 0 },
      colors: ['U'],
      subtypes: ['Sphinx'],
      keywords: ['flying'],
      power: 4,
      toughness: 4,
      effects: [],
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfAttacks',
          effects: [{ kind: 'eachPlayerNamesCardThenRevealsTop' }],
        },
      ],
    });

    expect(mustTranspile(card)).toBe(
      [
        'Name:Conundrum Sphinx',
        'ManaCost:2 U U',
        'Types:Creature Sphinx',
        'PT:4/4',
        'K:Flying',
        "T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ Trig1Effect1 | TriggerDescription$ Whenever CARDNAME attacks, each player chooses a card name. Then each player reveals the top card of their library. If the card a player revealed has the name they chose, that player puts it into their hand. If it doesn't, that player puts it on the bottom of their library.",
        'SVar:Trig1Effect1:DB$ NameCard | Defined$ Player | AILogic$ RandomInComputerDeck | SubAbility$ Trig1Effect1Hold',
        'SVar:Trig1Effect1Hold:DB$ RepeatEach | RepeatPlayers$ Player | RepeatSubAbility$ DBDig | SubAbility$ Trig1Effect1Hold2',
        'SVar:Trig1Effect1Hold2:DB$ Cleanup | ClearNamedCard$ True',
        'SVar:DBDig:DB$ Dig | DigNum$ 1 | Defined$ Player.IsRemembered | ChangeNum$ All | ChangeValid$ Card.NamedByRememberedPlayer | Reveal$ True',
        "Oracle:Flying\\nWhenever Conundrum Sphinx attacks, each player chooses a card name. Then each player reveals the top card of their library. If the card a player revealed has the name they chose, that player puts it into their hand. If it doesn't, that player puts it on the bottom of their library.",
        '',
      ].join('\n'),
    );
  });
});
