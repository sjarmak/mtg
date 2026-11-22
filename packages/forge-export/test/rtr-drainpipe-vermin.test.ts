/** Source-attested Forge parity for RTR Drainpipe Vermin. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const VERMIN = parseCard({
  kind: 'creature',
  id: 'rtr-066-drainpipe-vermin-forge',
  name: 'Drainpipe Vermin',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 66 },
  manaCost: { B: 1 },
  colors: ['B'],
  subtypes: ['Rat'],
  power: 1,
  toughness: 1,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDies',
      printedSourceReference: 'thisCreature',
      optional: true,
      optionalControllerPayment: { cost: { B: 1 } },
      effects: [{ kind: 'discardCards', count: 1, target: { kind: 'targetPlayer' } }],
    },
  ],
});

describe('Drainpipe Vermin Forge export', () => {
  it('matches the installed optional costed discard script', () => {
    expect(mustTranspile(VERMIN)).toBe(
      [
        'Name:Drainpipe Vermin',
        'ManaCost:B',
        'Types:Creature Rat',
        'PT:1/1',
        'T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | OptionalDecider$ You | Execute$ TrigDiscard | TriggerDescription$ When CARDNAME dies, you may pay {B}. If you do, target player discards a card.',
        'SVar:TrigDiscard:AB$ Discard | Cost$ B | ValidTgts$ Player | NumCards$ 1 | Mode$ TgtChoose | SpellDescription$ Target player discards a card.',
        'Oracle:When this creature dies, you may pay {B}. If you do, target player discards a card.',
        '',
      ].join('\n'),
    );
  });
});
