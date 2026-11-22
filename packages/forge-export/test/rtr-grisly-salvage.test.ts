/** Installed-Forge parity for RTR #165, Grisly Salvage. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const CARD = parseCard({
  kind: 'instant',
  id: 'rtr-165-grisly-salvage-forge',
  name: 'Grisly Salvage',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 165 },
  manaCost: { B: 1, G: 1 },
  colors: ['B', 'G'],
  effects: [
    {
      kind: 'selectFromTopLibrary',
      count: 5,
      filter: { cardTypes: ['creature', 'land'] },
      optional: true,
      reveal: true,
      revealAll: true,
      grislySalvageProfile: true,
      destination: 'hand',
      rest: 'graveyard',
    },
  ],
});

describe('RTR #165 Grisly Salvage Forge export', () => {
  it('matches the installed Forge Dig protocol exactly', () => {
    expect(mustTranspile(CARD)).toContain(
      'A:SP$ Dig | DigNum$ 5 | Reveal$ True | ChangeNum$ 1 | ChangeValid$ Creature,Land | DestinationZone2$ Graveyard | Optional$ True | SpellDescription$ Reveal the top five cards of your library. You may put a creature or land card from among them into your hand. Put the rest into your graveyard.',
    );
  });
});
