/** Installed-Forge parity for RTR #61, Dark Revenant. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const DARK_REVENANT = parseCard({
  kind: 'creature',
  id: 'rtr-061-dark-revenant-forge',
  name: 'Dark Revenant',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 61 },
  manaCost: { generic: 3, B: 1 },
  colors: ['B'],
  subtypes: ['Spirit'],
  keywords: ['flying'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDies',
      printedSourceReference: 'thisCreature',
      effects: [{ kind: 'putDepartedSourceOnTopOfOwnerLibrary' }],
    },
  ],
});

describe('Dark Revenant Forge export', () => {
  it('matches the installed trigger and LKI-copy library placement', () => {
    const text = mustTranspile(DARK_REVENANT);
    expect(text).toContain(
      "T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ TrigChange | TriggerDescription$ When CARDNAME dies, put it on top of its owner's library.",
    );
    expect(text).toContain(
      'SVar:TrigChange:DB$ ChangeZone | Defined$ TriggeredNewCardLKICopy | Origin$ Graveyard | Destination$ Library | LibraryPosition$ 0',
    );
  });
});
