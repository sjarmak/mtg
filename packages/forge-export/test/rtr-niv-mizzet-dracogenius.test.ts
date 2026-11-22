/** Niv-Mizzet, Dracogenius against Forge's installed card script. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const NIV_MIZZET = parseCard({
  kind: 'creature',
  id: 'rtr-183-niv-mizzet-dracogenius',
  name: 'Niv-Mizzet, Dracogenius',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 183 },
  manaCost: { generic: 2, U: 2, R: 2 },
  colors: ['U', 'R'],
  supertypes: ['legendary'],
  subtypes: ['Dragon', 'Wizard'],
  power: 5,
  toughness: 5,
  keywords: ['flying'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDealsCombatDamageToPlayer',
      includesNoncombatDamage: true,
      printedSourceReference: 'cardNameBeforeComma',
      optional: true,
      effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
    },
    {
      kind: 'activated',
      printedSourceReference: 'cardNameBeforeComma',
      cost: { mana: { U: 1, R: 1 } },
      effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
    },
  ],
});

describe('Niv-Mizzet, Dracogenius in Forge', () => {
  it('exports the installed unfiltered DamageDone trigger and ordinary ping', () => {
    const script = mustTranspile(NIV_MIZZET);
    expect(script).toContain(
      'T:Mode$ DamageDone | ValidSource$ Card.Self | ValidTarget$ Player | TriggerZones$ Battlefield | Execute$ Trig1Effect1 | OptionalDecider$ You',
    );
    expect(script).toContain('A:AB$ DealDamage | Cost$ U R | ValidTgts$ Any | NumDmg$ 1');
    expect(script).not.toContain('CombatDamage$ True');
  });
});
