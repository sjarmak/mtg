/** Forge-native spellings for cards discarded as activation costs. */
import { describe, expect, it } from 'vitest';
import { creature, mustTranspile } from './helpers';

describe('discard activation costs', () => {
  it('writes both an unrestricted pitch and Fauna Shaman creature filter', () => {
    const rummager = creature('Rummager', {
      abilities: [
        {
          kind: 'activated',
          cost: { mana: {}, tapSelf: true, discard: 1 },
          effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
        },
      ],
    });
    const fauna = creature('Fauna Shaman', {
      colors: ['G'],
      manaCost: { generic: 1, G: 1 },
      abilities: [
        {
          kind: 'activated',
          cost: {
            mana: { G: 1 },
            tapSelf: true,
            discard: 1,
            discardFilter: { cardTypes: ['creature'] },
          },
          effects: [
            {
              kind: 'searchLibrary',
              count: 1,
              filter: { cardTypes: ['creature'] },
              destination: 'hand',
              reveal: true,
            },
          ],
        },
      ],
    });

    expect(mustTranspile(rummager)).toContain('Cost$ T Discard<1/Card>');
    expect(mustTranspile(fauna)).toContain('Cost$ G T Discard<1/Creature>');
  });
});
