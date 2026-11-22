/** Forge parity for Hoarding Dragon's incarnation-linked exile. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { creature, mustTranspile } from './helpers';

describe('Hoarding Dragon', () => {
  it('uses Forge source-link capabilities rather than memory that survives zone changes', () => {
    const dragon = creature('Hoarding Dragon', {
      manaCost: { generic: 3, R: 2 },
      colors: ['R'],
      subtypes: ['Dragon'],
      keywords: ['flying'],
      power: 4,
      toughness: 4,
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [
            {
              kind: 'searchLibrary',
              filter: { cardTypes: ['artifact'] },
              destination: 'sourceLinkedExile',
            },
          ],
          optional: true,
        },
        {
          kind: 'triggered',
          condition: 'selfDies',
          effects: [{ kind: 'moveSourceLinkedExile', destination: 'hand' }],
          optional: true,
        },
      ],
    } as Partial<CardInput>);

    const script = mustTranspile(dragon);
    expect(script).toContain(
      'DB$ ChangeZone | Origin$ Library | Destination$ Exile | ChangeType$ Artifact | ChangeNum$ 1 | ShuffleNonMandatory$ True',
    );
    expect(script).not.toContain('RememberChanged$ True');
    expect(script).toContain('DB$ ChangeZone | Defined$ ExiledWith | Origin$ Exile | Destination$ Hand');
  });
});
