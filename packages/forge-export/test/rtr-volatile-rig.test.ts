/** Source-attested Forge parity for RTR Volatile Rig. */
import { parseCard, type CardInput } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

describe('Volatile Rig Forge export', () => {
  it('emits the installed Forge 2.0.14 card script exactly', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'rtr-236-volatile-rig-forge',
      name: 'Volatile Rig',
      rarity: 'rare',
      set: { code: 'RTR', collectorNumber: 236 },
      manaCost: { generic: 4 },
      colors: [],
      artifact: true,
      subtypes: ['Construct'],
      keywords: ['trample'],
      power: 4,
      toughness: 4,
      abilities: [
        { kind: 'static', scope: 'self', modification: { kind: 'attacksEachCombatIfAble' } },
        {
          kind: 'triggered',
          condition: 'selfIsDealtDamage',
          effects: [
            {
              kind: 'flipCoin',
              loseEffects: [{ kind: 'sacrificeSelf', target: { kind: 'selfCreature' } }],
            },
          ],
        },
        {
          kind: 'triggered',
          condition: 'selfDies',
          effects: [
            {
              kind: 'flipCoin',
              loseEffects: [
                {
                  kind: 'dealDamage',
                  amount: 4,
                  scope: 'allPermanents',
                  scopeFilter: { cardTypes: ['creature'] },
                  players: 'eachPlayer',
                  target: { kind: 'noTarget' },
                },
              ],
            },
          ],
        },
      ],
    } as CardInput);

    expect(mustTranspile(card)).toBe(
      [
        'Name:Volatile Rig',
        'ManaCost:4',
        'Types:Artifact Creature Construct',
        'PT:4/4',
        'K:Trample',
        'S:Mode$ MustAttack | ValidCreature$ Card.Self | Description$ CARDNAME attacks each combat if able.',
        'T:Mode$ DamageDoneOnce | Execute$ TrigFlipSac | ValidTarget$ Card.Self | TriggerZones$ Battlefield | TriggerDescription$ Whenever CARDNAME is dealt damage, flip a coin. If you lose the flip, sacrifice CARDNAME.',
        'SVar:TrigFlipSac:DB$ FlipCoin | LoseSubAbility$ DBSacrifice',
        'SVar:DBSacrifice:DB$ Sacrifice',
        'T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ TrigFlipDamage | TriggerDescription$ When CARDNAME dies, flip a coin. If you lose the flip, it deals 4 damage to each creature and each player.',
        'SVar:TrigFlipDamage:DB$ FlipCoin | LoseSubAbility$ DBDamage',
        'SVar:DBDamage:DB$ DamageAll | ValidCards$ Creature | ValidPlayers$ Player | NumDmg$ 4 | ValidDescription$ each creature and each player.',
        'Oracle:Trample\\nVolatile Rig attacks each combat if able.\\nWhenever Volatile Rig is dealt damage, flip a coin. If you lose the flip, sacrifice Volatile Rig.\\nWhen Volatile Rig dies, flip a coin. If you lose the flip, it deals 4 damage to each creature and each player.',
        '',
      ].join('\n'),
    );
  });
});
