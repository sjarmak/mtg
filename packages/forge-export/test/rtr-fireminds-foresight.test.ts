/** Source-attested Forge parity for RTR #162, Firemind's Foresight. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const CARD = parseCard({
  kind: 'instant',
  id: 'rtr-162-fireminds-foresight-forge',
  name: "Firemind's Foresight",
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 162 },
  manaCost: { generic: 5, U: 1, R: 1 },
  colors: ['U', 'R'],
  effects: [
    {
      kind: 'searchLibrary',
      filterQuotas: [3, 2, 1].map((manaValue) => ({
        filter: { cardTypes: ['instant'] as const, manaValue },
        count: 1,
      })),
      destination: 'hand',
      reveal: true,
    },
  ],
});

describe("Firemind's Foresight Forge export", () => {
  it('matches the installed three-stage ChangeZone script exactly', () => {
    expect(mustTranspile(CARD)).toBe(
      [
        "Name:Firemind's Foresight",
        'ManaCost:5 U R',
        'Types:Instant',
        'A:SP$ ChangeZone | ChangeType$ Instant.cmcEQ3 | ChangeNum$ 1 | Origin$ Library | Destination$ Hand | NoShuffle$ True | SubAbility$ FindCMC2 | StackDescription$ Search your library for an instant card with mana value 3, reveal it, and put it into your hand. | SpellDescription$ Search your library for an instant card with mana value 3, reveal it, and put it into your hand. Then repeat this process for instant cards with mana values 2 and 1. Then shuffle.',
        'SVar:FindCMC2:DB$ ChangeZone | ChangeType$ Instant.cmcEQ2 | ChangeNum$ 1 | Origin$ Library | Destination$ Hand | NoShuffle$ True | SubAbility$ FindCMC1 | StackDescription$ Then repeat this process for instant cards with mana value 2 and 1.',
        'SVar:FindCMC1:DB$ ChangeZone | ChangeType$ Instant.cmcEQ1 | ChangeNum$ 1 | Origin$ Library | Destination$ Hand | Shuffle$ True | StackDescription$ Then shuffle.',
        'DeckHints:Type$Instant',
        'Oracle:Search your library for an instant card with mana value 3, reveal it, and put it into your hand. Then repeat this process for instant cards with mana values 2 and 1. Then shuffle.',
        '',
      ].join('\n'),
    );
  });
});
