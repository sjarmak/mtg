/** Installed Forge 2.0.14 parity for RTR #176 Korozda Guildmage. */
import { parseCard, type CardInput } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const CARD = parseCard({
  kind: 'creature',
  id: 'rtr-176-korozda-guildmage-forge',
  name: 'Korozda Guildmage',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 176 },
  manaCost: { B: 1, G: 1 },
  colors: ['B', 'G'],
  subtypes: ['Elf', 'Shaman'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1, B: 1, G: 1 } },
      effects: [
        { kind: 'pumpUntilEndOfTurn', power: 1, toughness: 1, target: { kind: 'targetCreature' } },
        {
          kind: 'grantKeywordUntilEndOfTurn',
          keyword: 'intimidate',
          target: { kind: 'thatCreature' },
        },
      ],
    },
    {
      kind: 'activated',
      cost: {
        mana: { generic: 2, B: 1, G: 1 },
        sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] }, nontoken: true },
      },
      effects: [
        {
          kind: 'createToken',
          count: { kind: 'paidSacrificeToughness' },
          token: {
            name: 'Saproling',
            power: 1,
            toughness: 1,
            colors: ['G'],
            subtypes: ['Saproling'],
            keywords: [],
          },
        },
      ],
    },
  ],
} as CardInput);

describe('RTR #176 Korozda Guildmage Forge export', () => {
  it('emits the installed 2.0.14 cost selectors and sacrificed-toughness SVar exactly', () => {
    expect(mustTranspile(CARD)).toBe(
      [
        'Name:Korozda Guildmage',
        'ManaCost:B G',
        'Types:Creature Elf Shaman',
        'PT:2/2',
        "A:AB$ Pump | Cost$ 1 B G | ValidTgts$ Creature | NumAtt$ +1 | NumDef$ +1 | KW$ Intimidate | SpellDescription$ Target creature gets +1/+1 and gains intimidate until end of turn. (It can't be blocked except by artifact creatures and/or creatures that share a color with it.)",
        "A:AB$ Token | Cost$ 2 B G Sac<1/Creature.!token/nontoken Creature> | TokenAmount$ X | TokenScript$ g_1_1_saproling | TokenOwner$ You | SpellDescription$ Create X 1/1 green Saproling creature tokens, where X is the sacrificed creature's toughness.",
        'SVar:X:Sacrificed$CardToughness',
        'DeckHas:Ability$Token',
        "Oracle:{1}{B}{G}: Target creature gets +1/+1 and gains intimidate until end of turn. (It can't be blocked except by artifact creatures and/or creatures that share a color with it.)\\n{2}{B}{G}, Sacrifice a nontoken creature: Create X 1/1 green Saproling creature tokens, where X is the sacrificed creature's toughness.",
        '',
      ].join('\n'),
    );
  });
});
