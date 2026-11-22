/** Installed-Forge parity for RTR #13, Knightly Valor. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const KNIGHTLY_VALOR = parseCard({
  kind: 'enchantment',
  id: 'rtr-013-knightly-valor-forge',
  name: 'Knightly Valor',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 13 },
  manaCost: { generic: 4, W: 1 },
  colors: ['W'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [
      { kind: 'statBonus', power: 2, toughness: 2 },
      { kind: 'grantKeyword', keyword: 'vigilance' },
    ],
  },
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      printedSourceReference: 'thisAura',
      effects: [
        {
          kind: 'createToken',
          count: 1,
          token: {
            name: 'Knight',
            power: 2,
            toughness: 2,
            colors: ['W'],
            subtypes: ['Knight'],
            keywords: ['vigilance'],
            printedKeywordReminder: 'vigilance',
          },
        },
      ],
    },
  ],
});

describe('Knightly Valor Forge export', () => {
  it('matches the installed attachment, continuous layer, and token trigger protocol', () => {
    const text = mustTranspile(KNIGHTLY_VALOR);
    expect(text).toContain('K:Enchant:Creature');
    expect(text).toContain('SVar:AttachAILogic:Pump');
    expect(text).toContain(
      'S:Mode$ Continuous | Affected$ Creature.EnchantedBy | AddPower$ 2 | AddToughness$ 2 | AddKeyword$ Vigilance | Description$ Enchanted creature gets +2/+2 and has vigilance.',
    );
    expect(text).toContain(
      "T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ Trig1Effect1 | TriggerDescription$ When this Aura enters, create a 2/2 white Knight creature token with vigilance. (Attacking doesn't cause it to tap.)",
    );
    expect(text).toContain(
      'SVar:Trig1Effect1:DB$ Token | TokenScript$ w_2_2_knight_vigilance | TokenOwner$ You',
    );
    expect(text).toContain('DeckHas:Ability$Token');
  });
});
