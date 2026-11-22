import { describe, expect, it } from 'vitest';
import { CardEffectSchema, renderEffect } from '@mtg/dsl';

describe('bounded top-library decisions', () => {
  it('admits the three hand-authored capabilities without widening the model vocabulary', () => {
    const effects = [
      { kind: 'reorderTopLibrary', count: 5 },
      {
        kind: 'selectFromTopLibrary',
        count: 3,
        filter: { cardTypes: ['instant', 'sorcery'] },
        optional: true,
        reveal: true,
        destination: 'hand',
        rest: 'bottom',
      },
      { kind: 'separateTopLibraryIntoPiles', count: 5 },
    ] as const;

    for (const effect of effects) expect(CardEffectSchema.safeParse(effect).success).toBe(true);
  });

  it('prints exact Index wording', () => {
    expect(renderEffect({ kind: 'reorderTopLibrary', count: 5 }, 'Index')).toBe(
      'Look at the top five cards of your library, then put them back in any order.',
    );
  });
});
