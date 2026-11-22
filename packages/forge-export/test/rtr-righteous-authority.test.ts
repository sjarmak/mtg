/** Installed-Forge parity for RTR #189, Righteous Authority. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const RIGHTEOUS_AUTHORITY_INPUT = {
  kind: 'enchantment',
  id: 'rtr-189-righteous-authority-forge',
  name: 'Righteous Authority',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 189 },
  manaCost: { generic: 3, W: 1, U: 1 },
  colors: ['W', 'U'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [],
    enchantedControllerHandSizeBonus: true,
    printedModificationsBeforeAbilities: true,
  },
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfEachPlayersUpkeep',
      triggeringPlayerIsEnchantedCreatureController: true,
      enchantedControllerDrawStepAdditionalDraw: true,
      effects: [{ kind: 'drawCards', count: 1, target: { kind: 'triggeringPlayer' } }],
    },
  ],
} as const;

describe('Righteous Authority Forge export', () => {
  it('matches the entire installed Forge script', () => {
    expect(mustTranspile(parseCard(RIGHTEOUS_AUTHORITY_INPUT))).toBe(
      `${[
        'Name:Righteous Authority',
        'ManaCost:3 W U',
        'Types:Enchantment Aura',
        'K:Enchant:Creature',
        'SVar:AttachAILogic:Pump',
        "S:Mode$ Continuous | Affected$ Creature.EnchantedBy | AddPower$ X | AddToughness$ X | Description$ Enchanted creature gets +1/+1 for each card in its controller's hand.",
        'SVar:X:Count$ValidHand Card.OwnedBy EnchantedController',
        "T:Mode$ Phase | Phase$ Draw | ValidPlayer$ Player.EnchantedController | TriggerZones$ Battlefield | Execute$ Trig1Effect1 | TriggerDescription$ At the beginning of the draw step of enchanted creature's controller, that player draws an additional card.",
        'SVar:Trig1Effect1:DB$ Draw | Defined$ TriggeredPlayer',
        "Oracle:Enchant creature\\nEnchanted creature gets +1/+1 for each card in its controller's hand.\\nAt the beginning of the draw step of enchanted creature's controller, that player draws an additional card.",
      ].join('\n')}\n`,
    );
  });
});
