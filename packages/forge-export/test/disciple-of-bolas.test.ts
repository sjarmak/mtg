/** Source-attested Forge parity for M13 Disciple of Bolas. */
import { parseCard, type CardInput } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const DISCIPLE = parseCard({
  kind: 'creature',
  id: 'm13-088-disciple-of-bolas-forge',
  name: 'Disciple of Bolas',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 88 },
  manaCost: { generic: 3, B: 1 },
  colors: ['B'],
  subtypes: ['Human', 'Wizard'],
  power: 2,
  toughness: 1,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [
        {
          kind: 'sacrificePermanent',
          filter: { cardTypes: ['creature'] },
          excludeSource: true,
          target: { kind: 'noTarget' },
        },
        {
          kind: 'gainLife',
          amount: { kind: 'sacrificedPermanentPowerThisResolution' },
          target: { kind: 'noTarget' },
        },
        {
          kind: 'drawCards',
          count: { kind: 'sacrificedPermanentPowerThisResolution' },
          target: { kind: 'noTarget' },
        },
      ],
    },
  ],
} as unknown as CardInput);

describe('Disciple of Bolas Forge export', () => {
  it('matches the official sacrifice, remembered-LKI, linked-effects, and cleanup protocol', () => {
    expect(mustTranspile(DISCIPLE)).toBe(
      [
        'Name:Disciple of Bolas',
        'ManaCost:3 B',
        'Types:Creature Human Wizard',
        'PT:2/1',
        "T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ Trig1Effect1 | TriggerDescription$ When CARDNAME enters the battlefield, sacrifice another creature. You gain X life and draw X cards, where X is that creature's power.",
        'SVar:Trig1Effect1:DB$ Sacrifice | SacValid$ Creature.Other | RememberSacrificed$ True | SubAbility$ Trig1Effect2',
        'SVar:Trig1Effect2:DB$ GainLife | Defined$ You | LifeAmount$ X | SubAbility$ Trig1Effect3',
        'SVar:Trig1Effect3:DB$ Draw | Defined$ You | NumCards$ X | SubAbility$ Trig1Effect4',
        'SVar:Trig1Effect4:DB$ Cleanup | ClearRemembered$ True',
        'SVar:X:RememberedLKI$CardPower',
        'DeckHas:Ability$Sacrifice|LifeGain',
        "Oracle:When Disciple of Bolas enters the battlefield, sacrifice another creature. You gain X life and draw X cards, where X is that creature's power.",
        '',
      ].join('\n'),
    );
  });
});
