import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('Condemn', () => {
  /**
   * Source: Card-Forge/forge at 7ba1a39343d6ea7e96e153d0fd7f532ad39863c4,
   * `forge-gui/res/cardsfolder/c/condemn.txt`.
   */
  it('writes Forge current attacking selector, linked controller, and LKI toughness SVar', () => {
    const card = parseCard({
      kind: 'instant',
      id: 'm11-011',
      name: 'Condemn',
      rarity: 'uncommon',
      set: { code: 'M11', collectorNumber: 11 },
      manaCost: { W: 1 },
      colors: ['W'],
      effects: [
        {
          kind: 'putOnLibrary',
          position: 'bottom',
          target: { kind: 'targetCreature', filter: { combat: 'attacking' } },
        },
        {
          kind: 'gainLife',
          amount: { kind: 'thatCreatureToughness' },
          target: { kind: 'thatCreaturesController' },
        },
      ],
    } as unknown as CardInput);

    expect(mustTranspile(card)).toBe(
      [
        'Name:Condemn',
        'ManaCost:W',
        'Types:Instant',
        "A:SP$ ChangeZone | ValidTgts$ Creature.attacking | Origin$ Battlefield | Destination$ Library | LibraryPosition$ -1 | SubAbility$ DBEffect1 | SpellDescription$ Put target attacking creature on the bottom of its owner's library. Its controller gains life equal to its toughness.",
        'SVar:DBEffect1:DB$ GainLife | Defined$ TargetedController | LifeAmount$ X',
        'SVar:X:Targeted$CardToughness',
        'DeckHas:Ability$LifeGain',
        "Oracle:Put target attacking creature on the bottom of its owner's library. Its controller gains life equal to its toughness.",
        '',
      ].join('\n'),
    );
  });
});
