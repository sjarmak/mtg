import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const RAKDOS_CHARM = parseCard({
  kind: 'instant',
  id: 'rtr-184-rakdos-charm-forge',
  name: 'Rakdos Charm',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 184 },
  manaCost: { B: 1, R: 1 },
  colors: ['B', 'R'],
  effects: [],
  modes: [
    { effects: [{ kind: 'exileGraveyard', target: { kind: 'targetPlayer' } }] },
    {
      effects: [
        {
          kind: 'destroyPermanent',
          target: { kind: 'targetPermanent', filter: { cardTypes: ['artifact'] } },
        },
      ],
    },
    {
      effects: [
        {
          kind: 'dealDamage',
          amount: 1,
          target: { kind: 'noTarget' },
          scope: 'allPermanents',
          scopeFilter: { cardTypes: ['creature'] },
          eachScopedPermanentDealsToItsController: true,
        },
      ],
    },
  ],
} as unknown as CardInput);

describe('RTR #184 Rakdos Charm Forge export', () => {
  it('exports the installed Forge RepeatEach damage-source protocol exactly', () => {
    expect(mustTranspile(RAKDOS_CHARM)).toBe(
      [
        'Name:Rakdos Charm',
        'ManaCost:B R',
        'Types:Instant',
        'A:SP$ Charm | Choices$ Mode1,Mode2,Mode3',
        "SVar:Mode1:DB$ ChangeZoneAll | Origin$ Graveyard | Destination$ Exile | ValidTgts$ Player | ChangeType$ Card | IsCurse$ True | SpellDescription$ Exile target player's graveyard.",
        'SVar:Mode2:DB$ Destroy | ValidTgts$ Artifact | SpellDescription$ Destroy target artifact.',
        'SVar:Mode3:DB$ RepeatEach | RepeatCards$ Creature | RepeatSubAbility$ DBDamage | DamageMap$ True | SpellDescription$ Each creature deals 1 damage to its controller.',
        'SVar:DBDamage:DB$ DealDamage | Defined$ RememberedController | DamageSource$ Remembered | NumDmg$ 1',
        "Oracle:Choose one —\\n• Exile target player's graveyard.\\n• Destroy target artifact.\\n• Each creature deals 1 damage to its controller.",
        '',
      ].join('\n'),
    );
  });
});
