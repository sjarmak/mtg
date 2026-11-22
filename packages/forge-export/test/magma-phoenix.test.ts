/** Forge parity for M11 Magma Phoenix's combined damage sweep and recursion. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

const MAGMA_PHOENIX = parseCard({
  kind: 'creature',
  id: 'm11-150',
  name: 'Magma Phoenix',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 150 },
  colors: ['R'],
  manaCost: { generic: 3, R: 2 },
  subtypes: ['Phoenix'],
  keywords: ['flying'],
  power: 3,
  toughness: 3,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDies',
      effects: [
        {
          kind: 'dealDamage',
          amount: 3,
          scope: 'allPermanents',
          scopeFilter: { cardTypes: ['creature'] },
          players: 'eachPlayer',
          target: { kind: 'noTarget' },
        },
      ],
    },
    {
      kind: 'activated',
      activationZone: 'graveyard',
      cost: { mana: { generic: 3, R: 2 } },
      effects: [{ kind: 'returnSourceFromGraveyard', destination: 'hand' }],
    },
  ],
});

describe('Magma Phoenix Forge script', () => {
  it('matches Forge master without splitting player damage from creature damage', () => {
    const result = transpileCard(MAGMA_PHOENIX);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.text).toContain(
      'A:AB$ ChangeZone | Cost$ 3 R R | Origin$ Graveyard | Destination$ Hand | ActivationZone$ Graveyard | SpellDescription$ Return CARDNAME from your graveyard to your hand.',
    );
    expect(result.script.text).toContain(
      'T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ Trig1Effect1 | TriggerDescription$ When CARDNAME dies, it deals 3 damage to each creature and each player.',
    );
    expect(result.script.text).toContain(
      'SVar:Trig1Effect1:DB$ DamageAll | ValidCards$ Creature | ValidPlayers$ Player | NumDmg$ 3',
    );
  });
});
