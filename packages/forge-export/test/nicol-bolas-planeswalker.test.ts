/** Forge-master parity for M13 Nicol Bolas and its linked ultimate seat. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const BOLAS = parseCard({
  kind: 'planeswalker',
  id: 'm13-199-nicol-bolas-planeswalker-forge',
  name: 'Nicol Bolas, Planeswalker',
  rarity: 'mythic',
  set: { code: 'M13', collectorNumber: 199 },
  colors: ['U', 'B', 'R'],
  manaCost: { generic: 4, U: 1, B: 2, R: 1 },
  supertypes: ['legendary'],
  subtypes: ['Bolas'],
  startingLoyalty: 5,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: 3,
      effects: [
        {
          kind: 'destroyPermanent',
          target: { kind: 'targetPermanent', filter: { excludeCardTypes: ['creature'] } },
        },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -2,
      effects: [{ kind: 'gainControl', target: { kind: 'targetCreature' } }],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -9,
      effects: [
        { kind: 'dealDamage', amount: 7, target: { kind: 'targetPlayerOrPlaneswalker' } },
        {
          kind: 'discardCards',
          count: 7,
          target: { kind: 'thatPlayerOrPlaneswalkerController' },
        },
        {
          kind: 'sacrificePermanent',
          count: 7,
          filter: {},
          target: { kind: 'thatPlayerOrPlaneswalkerController' },
        },
      ],
    },
  ],
} as unknown as CardInput);

describe('Nicol Bolas, Planeswalker Forge parity', () => {
  it("preserves Forge master's TargetedOrController chain under current Oracle wording", () => {
    expect(mustTranspile(BOLAS).trimEnd().split('\n')).toStrictEqual([
      'Name:Nicol Bolas, Planeswalker',
      'ManaCost:4 U B B R',
      'Types:Legendary Planeswalker Bolas',
      'Loyalty:5',
      'A:AB$ Destroy | Cost$ AddCounter<3/LOYALTY> | ValidTgts$ Permanent.nonCreature | Planeswalker$ True | SpellDescription$ Destroy target noncreature permanent.',
      'A:AB$ GainControl | Cost$ SubCounter<2/LOYALTY> | ValidTgts$ Creature | Planeswalker$ True | SpellDescription$ Gain control of target creature.',
      "A:AB$ DealDamage | Cost$ SubCounter<9/LOYALTY> | ValidTgts$ Player,Planeswalker | TgtPrompt$ Select target player or planeswalker | NumDmg$ 7 | Planeswalker$ True | Ultimate$ True | SubAbility$ Act3Effect2 | SpellDescription$ CARDNAME deals 7 damage to target player or planeswalker. That player or that planeswalker's controller discards seven cards, then sacrifices seven permanents of their choice.",
      'SVar:Act3Effect2:DB$ Discard | Defined$ TargetedOrController | NumCards$ 7 | Mode$ TgtChoose | SubAbility$ Act3Effect3',
      'SVar:Act3Effect3:DB$ Sacrifice | Defined$ TargetedOrController | SacValid$ Permanent | Amount$ 7',
      // Ours, not Forge master's: `nicol_bolas_planeswalker.txt` carries no
      // `DeckHas`, and this transpiler emits the hint its effect table implies
      // for every card kind (`mtg-9xz4`). The chain above is the parity claim.
      'DeckHas:Ability$Sacrifice',
      "Oracle:[+3]: Destroy target noncreature permanent.\\n[-2]: Gain control of target creature.\\n[-9]: Nicol Bolas deals 7 damage to target player or planeswalker. That player or that planeswalker's controller discards seven cards, then sacrifices seven permanents of their choice.",
    ]);
  });
});
