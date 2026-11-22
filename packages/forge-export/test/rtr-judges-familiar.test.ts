/** Judge's Familiar parity against installed Forge 0c9f64ae0d46290523d17e6e6b2cc76331743a9e. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const FAMILIAR = parseCard({
  kind: 'creature',
  id: 'rtr-218-judges-familiar-forge',
  name: "Judge's Familiar",
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 218 },
  manaCost: { hybrid: { 'W/U': 1 } },
  colors: ['W', 'U'],
  subtypes: ['Bird'],
  power: 1,
  toughness: 1,
  keywords: ['flying'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, sacrificeSelf: true },
      printedSourceReference: 'thisCreature',
      effects: [{ kind: 'counterSpell', spellFilter: { cardTypes: ['instant', 'sorcery'] } }],
      counterTargetSpellUnless: { cost: { generic: 1 } },
    },
  ],
});

describe("Judge's Familiar Forge export", () => {
  it('matches the installed executable script and current Oracle', () => {
    expect(mustTranspile(FAMILIAR)).toBe(
      [
        "Name:Judge's Familiar",
        'ManaCost:WU',
        'Types:Creature Bird',
        'PT:1/1',
        'K:Flying',
        'A:AB$ Counter | Cost$ Sac<1/CARDNAME> | TargetType$ Spell | ValidTgts$ Instant,Sorcery | TgtPrompt$ Select target instant or sorcery spell | UnlessCost$ 1 | SpellDescription$ Counter target instant or sorcery spell unless its controller pays {1}.',
        'Oracle:Flying\\nSacrifice this creature: Counter target instant or sorcery spell unless its controller pays {1}.',
        '',
      ].join('\n'),
    );
  });
});
