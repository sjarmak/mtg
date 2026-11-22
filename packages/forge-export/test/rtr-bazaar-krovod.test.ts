/** Bazaar Krovod parity against installed Forge 0c9f64ae0d46290523d17e6e6b2cc76331743a9e. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const KROVOD = parseCard({
  kind: 'creature',
  id: 'rtr-7-bazaar-krovod-forge',
  name: 'Bazaar Krovod',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 7 },
  manaCost: { generic: 4, W: 1 },
  colors: ['W'],
  subtypes: ['Beast'],
  power: 2,
  toughness: 5,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfAttacks',
      printedSourceReference: 'thisCreature',
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: 0,
          toughness: 2,
          target: {
            kind: 'targetCreature',
            filter: { combat: 'attacking' },
            excludeSource: true,
          },
        },
        { kind: 'untapPermanent', target: { kind: 'thatCreature' } },
      ],
    },
  ],
});

describe('Bazaar Krovod Forge export', () => {
  it('matches the installed executable script and current Oracle', () => {
    expect(mustTranspile(KROVOD)).toBe(
      [
        'Name:Bazaar Krovod',
        'ManaCost:4 W',
        'Types:Creature Beast',
        'PT:2/5',
        'T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigPump | TriggerZones$ Battlefield | TriggerDescription$ Whenever CARDNAME attacks, another target attacking creature gets +0/+2 until end of turn. Untap that creature.',
        'SVar:TrigPump:DB$ Pump | ValidTgts$ Creature.attacking+Other | TgtPrompt$ Select another target attacking creature. | NumDef$ +2 | SubAbility$ DBUntap',
        'SVar:DBUntap:DB$ Untap | Defined$ Targeted',
        'Oracle:Whenever this creature attacks, another target attacking creature gets +0/+2 until end of turn. Untap that creature.',
        '',
      ].join('\n'),
    );
  });
});
