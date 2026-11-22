/** Source-attested Forge parity for RTR Nivix Guildmage. */
import { parseCard, type CardInput } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const CARD = parseCard({
  kind: 'creature',
  id: 'rtr-182-nivix-guildmage-forge',
  name: 'Nivix Guildmage',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 182 },
  manaCost: { U: 1, R: 1 },
  colors: ['U', 'R'],
  subtypes: ['Human', 'Wizard'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1, U: 1, R: 1 } },
      effects: [
        { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
        { kind: 'discardCards', count: 1, target: { kind: 'noTarget' } },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: { generic: 2, U: 1, R: 1 } },
      effects: [
        {
          kind: 'copySpell',
          spellFilter: { cardTypes: ['instant', 'sorcery'] },
          spellSelection: 'targetSpellYouControl',
        },
      ],
    },
  ],
} as CardInput);

describe('Nivix Guildmage Forge export', () => {
  it('matches the installed two-activation script exactly', () => {
    expect(mustTranspile(CARD)).toBe(
      [
        'Name:Nivix Guildmage',
        'ManaCost:U R',
        'Types:Creature Human Wizard',
        'PT:2/2',
        'A:AB$ Draw | Cost$ 1 U R | NumCards$ 1 | SpellDescription$ Draw a card, then discard a card. | SubAbility$ DBDiscard',
        'SVar:DBDiscard:DB$ Discard | Defined$ You | NumCards$ 1 | Mode$ TgtChoose',
        'A:AB$ CopySpellAbility | Cost$ 2 U R | ValidTgts$ Instant.YouCtrl,Sorcery.YouCtrl | TargetType$ Spell | AILogic$ Once | MayChooseTarget$ True | SpellDescription$ Copy target instant or sorcery spell you control. You may choose new targets for the copy.',
        'DeckHints:Type$Instant|Sorcery',
        'Oracle:{1}{U}{R}: Draw a card, then discard a card.\\n{2}{U}{R}: Copy target instant or sorcery spell you control. You may choose new targets for the copy.',
        '',
      ].join('\n'),
    );
  });
});
