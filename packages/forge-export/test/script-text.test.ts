import { describe, expect, it } from 'vitest';

import { renderNamedSubAbilityChain } from '../src/script-text';

describe('named Forge sub-ability chains', () => {
  it('links each rendered body to the next name and leaves the tail unlinked', () => {
    expect(
      renderNamedSubAbilityChain([
        { name: 'DBDraw', rendered: 'DB$ Draw | NumCards$ 3' },
        { name: 'DBSac', rendered: 'DB$ Sacrifice | Defined$ Self' },
      ]),
    ).toEqual([
      'SVar:DBDraw:DB$ Draw | NumCards$ 3 | SubAbility$ DBSac',
      'SVar:DBSac:DB$ Sacrifice | Defined$ Self',
    ]);
  });

  it('renders an empty chain as no supporting lines', () => {
    expect(renderNamedSubAbilityChain([])).toEqual([]);
  });
});
