/** Forge's direct numeric controller-shield API. */
import { describe, expect, it } from 'vitest';
import { mustTranspile, spell } from './helpers';

describe('plain controller-shield Forge export', () => {
  it('writes the installed Security Blockade PreventDamage body', () => {
    const card = spell(
      'Fixed Shield',
      [
        {
          kind: 'preventNextDamageToYouAndRetaliate',
          amount: 1,
          target: { kind: 'noTarget' },
        },
      ],
      { kind: 'instant', manaCost: { W: 1 }, colors: ['W'] },
    );
    expect(mustTranspile(card)).toContain(
      'A:SP$ PreventDamage | Defined$ You | Amount$ 1 | SpellDescription$ Prevent the next 1 damage that would be dealt to you this turn.',
    );
  });
});
