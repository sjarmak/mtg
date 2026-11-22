/** Source-attested Forge parity for M13 Ajani, Caller of the Pride. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('Ajani, Caller of the Pride Forge export', () => {
  it('emits the pinned Forge 2.0.14 optional target, keyword bundle, and life-count rows', () => {
    const card = parseCard({
      kind: 'planeswalker',
      id: 'm13-1-ajani-caller-of-the-pride-forge',
      name: 'Ajani, Caller of the Pride',
      rarity: 'mythic',
      set: { code: 'M13', collectorNumber: 1 },
      manaCost: { generic: 1, W: 2 },
      colors: ['W'],
      supertypes: ['legendary'],
      subtypes: ['Ajani'],
      startingLoyalty: 4,
      abilities: [
        {
          kind: 'activated',
          cost: { mana: {} },
          loyaltyCost: 1,
          effects: [
            {
              kind: 'putCounters',
              counter: 'plusOnePlusOne',
              count: 1,
              target: { kind: 'targetCreature', count: 1 },
            },
          ],
        },
        {
          kind: 'activated',
          cost: { mana: {} },
          loyaltyCost: -3,
          effects: [
            {
              kind: 'grantKeywordUntilEndOfTurn',
              keyword: 'flying',
              additionalKeywords: ['doubleStrike'],
              target: { kind: 'targetCreature' },
            },
          ],
        },
        {
          kind: 'activated',
          cost: { mana: {} },
          loyaltyCost: -8,
          effects: [
            {
              kind: 'createToken',
              count: { kind: 'controllerLifeTotal' },
              token: {
                name: 'Cat',
                power: 2,
                toughness: 2,
                colors: ['W'],
                subtypes: ['Cat'],
                keywords: [],
              },
            },
          ],
        },
      ],
    } satisfies CardInput);

    expect(mustTranspile(card)).toBe(
      [
        'Name:Ajani, Caller of the Pride',
        'ManaCost:1 W W',
        'Types:Legendary Planeswalker Ajani',
        'Loyalty:4',
        'A:AB$ PutCounter | Cost$ AddCounter<1/LOYALTY> | ValidTgts$ Creature | TargetMin$ 0 | TargetMax$ 1 | CounterType$ P1P1 | CounterNum$ 1 | Planeswalker$ True | SpellDescription$ Put a +1/+1 counter on up to one target creature.',
        'A:AB$ Pump | Cost$ SubCounter<3/LOYALTY> | ValidTgts$ Creature | KW$ Flying & Double Strike | Planeswalker$ True | SpellDescription$ Target creature gains flying and double strike until end of turn.',
        'A:AB$ Token | Cost$ SubCounter<8/LOYALTY> | TokenAmount$ X | TokenScript$ w_2_2_cat | TokenOwner$ You | Planeswalker$ True | Ultimate$ True | SpellDescription$ Create X 2/2 white Cat creature tokens, where X is your life total.',
        'SVar:X:Count$YourLifeTotal',
        // Ours, not the pinned script's: no M13 walker carries `DeckHas`, and
        // this transpiler emits the hint its effect table implies for every
        // card kind (`mtg-9xz4`). The rows above are the parity claim.
        'DeckHas:Ability$Token',
        'Oracle:[+1]: Put a +1/+1 counter on up to one target creature.\\n[-3]: Target creature gains flying and double strike until end of turn.\\n[-8]: Create X 2/2 white Cat creature tokens, where X is your life total.',
        '',
      ].join('\n'),
    );
  });
});
