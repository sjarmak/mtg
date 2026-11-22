/** Source-attested Forge parity for RTR Viashino Racketeer. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const VIASHINO_RACKETEER = parseCard({
  kind: 'creature',
  id: 'rtr-112-viashino-racketeer-forge',
  name: 'Viashino Racketeer',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 112 },
  manaCost: { generic: 2, R: 1 },
  colors: ['R'],
  subtypes: ['Lizard', 'Rogue'],
  power: 2,
  toughness: 1,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      printedSourceReference: 'thisCreature',
      optional: true,
      effects: [
        { kind: 'discardCards', count: 1, target: { kind: 'noTarget' } },
        { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
      ],
    },
  ],
});

describe('Viashino Racketeer Forge export', () => {
  /**
   * Source: Card-Forge/forge revision 0c9f64ae0d46290523d17e6e6b2cc76331743a9e,
   * `forge-gui/res/cardsfolder/v/viashino_racketeer.txt`.
   */
  it('matches the installed costed-draw script exactly', () => {
    expect(mustTranspile(VIASHINO_RACKETEER)).toBe(
      [
        'Name:Viashino Racketeer',
        'ManaCost:2 R',
        'Types:Creature Lizard Rogue',
        'PT:2/1',
        'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDiscard | TriggerDescription$ When CARDNAME enters, you may discard a card. If you do, draw a card.',
        'SVar:TrigDiscard:AB$ Draw | Cost$ Discard<1/Card>',
        'DeckHas:Ability$Discard',
        'Oracle:When Viashino Racketeer enters, you may discard a card. If you do, draw a card.',
        '',
      ].join('\n'),
    );
  });
});
