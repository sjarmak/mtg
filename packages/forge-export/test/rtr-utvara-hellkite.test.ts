/** Installed Forge 2.0.14 parity for RTR Utvara Hellkite. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const CARD = parseCard({
  kind: 'creature',
  id: 'rtr-110-utvara-hellkite-forge',
  name: 'Utvara Hellkite',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 110 },
  manaCost: { generic: 6, R: 2 },
  colors: ['R'],
  subtypes: ['Dragon'],
  keywords: ['flying'],
  power: 6,
  toughness: 6,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfAttacks',
      attackingCreatureSubtype: 'Dragon',
      effects: [
        {
          kind: 'createToken',
          count: 1,
          token: {
            name: 'Dragon',
            power: 6,
            toughness: 6,
            colors: ['R'],
            subtypes: ['Dragon'],
            keywords: ['flying'],
          },
        },
      ],
    },
  ],
});

describe('RTR #110 Utvara Hellkite Forge export', () => {
  const script = mustTranspile(CARD);

  it('matches the installed controlled-Dragon attack trigger and token script', () => {
    expect(script).toContain(
      'T:Mode$ Attacks | ValidCard$ Dragon.YouCtrl | Execute$ TrigToken | TriggerZones$ Battlefield | TriggerDescription$ Whenever a Dragon you control attacks, create a 6/6 red Dragon creature token with flying.',
    );
    expect(script).toContain('SVar:TrigToken:DB$ Token | TokenScript$ r_6_6_dragon_flying | TokenOwner$ You');
    expect(script).toContain('DeckHas:Ability$Token');
  });

  it('does not export the bundle as a reflexive source attack', () => {
    expect(script).not.toContain('ValidCard$ Card.Self');
  });
});
