import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const URBAN_BURGEONING = parseCard({
  kind: 'enchantment',
  id: 'rtr-138-urban-burgeoning-forge',
  name: 'Urban Burgeoning',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 138 },
  manaCost: { G: 1 },
  colors: ['G'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'land',
    modifications: [],
    untapsDuringEachOtherPlayersUntapStep: true,
  },
});

describe('Urban Burgeoning Forge export', () => {
  it('matches the installed continuous grant and UntapOtherPlayer ability', () => {
    expect(mustTranspile(URBAN_BURGEONING)).toContain(
      [
        'K:Enchant:Land',
        'SVar:AttachAILogic:Pump',
        'S:Mode$ Continuous | Affected$ Card.EnchantedBy | AddStaticAbility$ BurgeoningUntap | Description$ Enchanted land has "Untap this land during each other player\'s untap step."',
        "SVar:BurgeoningUntap:Mode$ UntapOtherPlayer | ValidCard$ Card.Self | Description$ Untap this land during each other player's untap step.",
      ].join('\n'),
    );
  });
});
