import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('RTR #196 Skymark Roc Forge parity', () => {
  it('uses the installed defending-player and toughness selector', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'rtr-196-skymark-roc-forge',
      name: 'Skymark Roc',
      rarity: 'uncommon',
      set: { code: 'RTR', collectorNumber: 196 },
      manaCost: { generic: 2, W: 1, U: 1 },
      colors: ['W', 'U'],
      subtypes: ['Bird'],
      power: 3,
      toughness: 3,
      keywords: ['flying'],
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfAttacks',
          printedSourceReference: 'thisCreature',
          optional: true,
          effects: [
            {
              kind: 'returnToHand',
              target: {
                kind: 'targetCreatureDefendingPlayerControls',
                restriction: { kind: 'maxToughness', toughness: 2 },
              },
            },
          ],
        },
      ],
    });

    const script = mustTranspile(card);
    expect(script).toContain(
      'T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ Trig1Effect1 | OptionalDecider$ You |',
    );
    expect(script).toContain(
      'SVar:Trig1Effect1:DB$ ChangeZone | ValidTgts$ Creature.toughnessLE2+ControlledBy TriggeredDefendingPlayer | Origin$ Battlefield | Destination$ Hand',
    );
    expect(script).not.toContain('Creature.DefenderCtrl');
  });
});
