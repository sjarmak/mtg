/** Forge-master parity for M13 Chandra, the Firebrand. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const CHANDRA = parseCard({
  kind: 'planeswalker',
  id: 'm13-123-chandra-the-firebrand-forge',
  name: 'Chandra, the Firebrand',
  rarity: 'mythic',
  set: { code: 'M13', collectorNumber: 123 },
  colors: ['R'],
  manaCost: { generic: 3, R: 1 },
  supertypes: ['legendary'],
  subtypes: ['Chandra'],
  startingLoyalty: 3,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: 1,
      effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -2,
      effects: [{ kind: 'copyNextInstantOrSorceryThisTurn' }],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -6,
      effects: [
        {
          kind: 'dealDamage',
          amount: 6,
          target: { kind: 'anyTarget', count: 6 },
          division: { kind: 'each' },
        },
      ],
    },
  ],
} as unknown as CardInput);

describe('Chandra, the Firebrand Forge parity', () => {
  it('emits the upstream delayed trigger and six-target envelope', () => {
    expect(mustTranspile(CHANDRA).trimEnd().split('\n')).toStrictEqual([
      'Name:Chandra, the Firebrand',
      'ManaCost:3 R',
      'Types:Legendary Planeswalker Chandra',
      'Loyalty:3',
      'A:AB$ DealDamage | Cost$ AddCounter<1/LOYALTY> | ValidTgts$ Any | NumDmg$ 1 | Planeswalker$ True | SpellDescription$ CARDNAME deals 1 damage to any target.',
      'A:AB$ DelayedTrigger | Cost$ SubCounter<2/LOYALTY> | AILogic$ SpellCopy | Mode$ SpellCast | ValidCard$ Instant,Sorcery | ValidActivatingPlayer$ You | ThisTurn$ True | Execute$ EffTrigCopy | Planeswalker$ True | SpellDescription$ When you next cast an instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy.',
      'SVar:EffTrigCopy:DB$ CopySpellAbility | Defined$ TriggeredSpellAbility | MayChooseTarget$ True',
      'A:AB$ DealDamage | Cost$ SubCounter<6/LOYALTY> | ValidTgts$ Any | NumDmg$ 6 | TargetMin$ 0 | TargetMax$ 6 | Planeswalker$ True | Ultimate$ True | SpellDescription$ CARDNAME deals 6 damage to each of up to six targets.',
      'Oracle:[+1]: Chandra deals 1 damage to any target.\\n[-2]: When you next cast an instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy.\\n[-6]: Chandra deals 6 damage to each of up to six targets.',
    ]);
  });
});
