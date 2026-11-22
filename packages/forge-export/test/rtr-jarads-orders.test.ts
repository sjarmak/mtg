/** Forge's installed remembered-card chain for Jarad's Orders. */
import { describe, expect, it } from 'vitest';
import { mustTranspile, spell } from './helpers';

describe("Jarad's Orders", () => {
  it('matches the installed two-creature, hand-and-graveyard ChangeZone chain', () => {
    const card = spell(
      "Jarad's Orders",
      [
        {
          kind: 'searchLibrary',
          filter: { cardTypes: ['creature'] },
          count: 2,
          reveal: true,
          destination: {
            kind: 'oneToHandRestToGraveyard',
            one: 'hand',
          },
        },
      ],
      { kind: 'sorcery', manaCost: { generic: 2, B: 1, G: 1 }, colors: ['B', 'G'] },
    );

    const script = mustTranspile(card);
    expect(script).toContain(
      'A:SP$ ChangeZone | Origin$ Library | Destination$ Library | ChangeType$ Creature | ChangeNum$ 2 | RememberChanged$ True | Reveal$ True | Shuffle$ False | SubAbility$ DBEffect1',
    );
    expect(script).toContain(
      'SVar:DBEffect1:DB$ ChangeZone | Origin$ Library | Destination$ Hand | ChangeType$ Creature.IsRemembered | ChangeNum$ 1 | Mandatory$ True | NoLooking$ True | Shuffle$ False | SubAbility$ DBEffect2',
    );
    expect(script).toContain(
      'SVar:DBEffect2:DB$ ChangeZone | Origin$ Library | Destination$ Graveyard | ChangeType$ Creature.IsRemembered | Mandatory$ True | NoLooking$ True | SubAbility$ DBEffect3',
    );
    expect(script).toContain('SVar:DBEffect3:DB$ Cleanup | ClearRemembered$ True');
  });
});
