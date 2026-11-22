/** Forge's source-proven multi-destination search chain for Cultivate. */
import { describe, expect, it } from 'vitest';
import { mustTranspile, spell } from './helpers';

describe('Cultivate', () => {
  it('remembers both found lands, assigns one tapped and the rest to hand, then clears the memory', () => {
    const cultivate = spell(
      'Cultivate',
      [
        {
          kind: 'searchLibrary',
          filter: { cardTypes: ['land'], supertypes: ['basic'] },
          count: 2,
          reveal: true,
          destination: { kind: 'oneAndRest', one: 'battlefieldTapped', rest: 'hand' },
        },
      ],
      { kind: 'sorcery', manaCost: { generic: 2, G: 1 }, colors: ['G'] },
    );

    const script = mustTranspile(cultivate);
    expect(script).toContain(
      'A:SP$ ChangeZone | Origin$ Library | Destination$ Library | ChangeType$ Land.Basic | ChangeNum$ 2 | RememberChanged$ True | Reveal$ True | Shuffle$ False | SubAbility$ DBEffect1',
    );
    expect(script).toContain(
      'SVar:DBEffect1:DB$ ChangeZone | Origin$ Library | Destination$ Battlefield | ChangeType$ Land.IsRemembered | ChangeNum$ 1 | Mandatory$ True | NoLooking$ True | Tapped$ True | Shuffle$ False | SubAbility$ DBEffect2',
    );
    expect(script).toContain(
      'SVar:DBEffect2:DB$ ChangeZone | Origin$ Library | Destination$ Hand | ChangeType$ Land.IsRemembered | Mandatory$ True | NoLooking$ True | SubAbility$ DBEffect3',
    );
    expect(script).toContain('SVar:DBEffect3:DB$ Cleanup | ClearRemembered$ True');
  });
});
