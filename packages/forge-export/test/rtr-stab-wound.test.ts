/** Installed-Forge parity for RTR #78, Stab Wound. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const STAB_WOUND = parseCard({
  kind: 'enchantment',
  id: 'rtr-078-stab-wound-forge',
  name: 'Stab Wound',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 78 },
  manaCost: { generic: 2, B: 1 },
  colors: ['B'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [{ kind: 'statBonus', power: -2, toughness: -2 }],
    printedModificationsBeforeAbilities: true,
  },
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfEachPlayersUpkeep',
      triggeringPlayerIsEnchantedCreatureController: true,
      effects: [{ kind: 'loseLife', amount: 2, target: { kind: 'triggeringPlayer' } }],
    },
  ],
});

describe('Stab Wound Forge export', () => {
  it('matches the entire installed Forge script', () => {
    expect(mustTranspile(STAB_WOUND)).toBe(
      `${[
        'Name:Stab Wound',
        'ManaCost:2 B',
        'Types:Enchantment Aura',
        'K:Enchant:Creature',
        'SVar:AttachAILogic:Curse',
        'S:Mode$ Continuous | Affected$ Creature.EnchantedBy | AddPower$ -2 | AddToughness$ -2 | Description$ Enchanted creature gets -2/-2.',
        "T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ Player.EnchantedController | TriggerZones$ Battlefield | Execute$ Trig1Effect1 | TriggerDescription$ At the beginning of the upkeep of enchanted creature's controller, that player loses 2 life.",
        'SVar:Trig1Effect1:DB$ LoseLife | Defined$ TriggeredPlayer | LifeAmount$ 2',
        "Oracle:Enchant creature\\nEnchanted creature gets -2/-2.\\nAt the beginning of the upkeep of enchanted creature's controller, that player loses 2 life.",
      ].join('\n')}\n`,
    );
  });
});
