/** Installed-Forge parity for RTR #20, Security Blockade. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const SECURITY_BLOCKADE = parseCard({
  kind: 'enchantment',
  id: 'rtr-020-security-blockade-forge',
  name: 'Security Blockade',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 20 },
  manaCost: { generic: 2, W: 1 },
  colors: ['W'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'land',
    modifications: [
      {
        kind: 'grantActivatedAbility',
        ability: {
          kind: 'activated',
          cost: { mana: {}, tapSelf: true },
          effects: [
            {
              kind: 'preventNextDamageToYouAndRetaliate',
              amount: 1,
              target: { kind: 'noTarget' },
            },
          ],
        },
      },
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
          },
        },
      ],
    },
  ],
});

describe('Security Blockade Forge export', () => {
  it('matches the land grant, prevention body, and vigilant Knight trigger', () => {
    const text = mustTranspile(SECURITY_BLOCKADE);
    expect(text).toContain('K:Enchant:Land');
    expect(text).toContain(
      'S:Mode$ Continuous | Affected$ Card.EnchantedBy | AddAbility$ AuraGrant1 | Description$ Enchanted land has "{T}: Prevent the next 1 damage that would be dealt to you this turn."',
    );
    expect(text).toContain(
      'SVar:AuraGrant1:AB$ PreventDamage | Cost$ T | Defined$ You | Amount$ 1 | SpellDescription$ Prevent the next 1 damage that would be dealt to you this turn.',
    );
    expect(text).toContain(
      'SVar:Trig1Effect1:DB$ Token | TokenScript$ w_2_2_knight_vigilance | TokenOwner$ You',
    );
  });
});
