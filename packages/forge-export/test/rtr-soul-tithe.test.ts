/** Installed-Forge parity for RTR #23, Soul Tithe. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const SOUL_TITHE = parseCard({
  kind: 'enchantment',
  id: 'rtr-22-soul-tithe-forge',
  name: 'Soul Tithe',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 23 },
  manaCost: { generic: 1, W: 1 },
  colors: ['W'],
  subtypes: ['Aura'],
  aura: { enchant: 'nonlandPermanent', modifications: [] },
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfEachPlayersUpkeep',
      triggeringPlayerIsEnchantedCreatureController: true,
      sacrificeEnchantedPermanentUnlessControllerPaysManaValue: true,
      effects: [],
    },
  ],
});

describe('Soul Tithe Forge export', () => {
  it('matches the entire installed Forge script', () => {
    expect(mustTranspile(SOUL_TITHE)).toBe(
      `${[
        'Name:Soul Tithe',
        'ManaCost:1 W',
        'Types:Enchantment Aura',
        'K:Enchant:Permanent.nonLand:nonland permanent',
        'SVar:AttachAITgts:Card.cmcGE2',
        'SVar:AttachAILogic:Curse',
        "T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ Player.EnchantedController | TriggerZones$ Battlefield | Execute$ TrigSac | TriggerDescription$ At the beginning of the upkeep of enchanted permanent's controller, that player sacrifices it unless they pay {X}, where X is its mana value.",
        'SVar:TrigSac:DB$ SacrificeAll | Defined$ Enchanted | UnlessCost$ X | UnlessPayer$ EnchantedController',
        'SVar:X:Enchanted$CardManaCost',
        "Oracle:Enchant nonland permanent\\nAt the beginning of the upkeep of enchanted permanent's controller, that player sacrifices it unless they pay {X}, where X is its mana value.",
      ].join('\n')}\n`,
    );
  });
});
