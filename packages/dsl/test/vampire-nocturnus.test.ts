/** Vampire Nocturnus's public top card and one mixed-layer conditional bundle. */
import { describe, expect, it } from 'vitest';
import { ModelAbilitySchema, parseCard, renderOracleText } from '@mtg/dsl';

const REVEAL = {
  kind: 'staticPlayerRule' as const,
  players: 'controller' as const,
  rule: 'playWithTopLibraryRevealed' as const,
};

const NIGHT = {
  kind: 'staticBundle' as const,
  scope: 'otherCreaturesYouControl' as const,
  subtype: 'Vampire',
  includeSelf: true as const,
  enabledWhile: { kind: 'controllerTopLibraryHasColor' as const, color: 'B' as const },
  modifications: [
    { kind: 'statBonus' as const, power: 2, toughness: 1 },
    { kind: 'grantKeyword' as const, keyword: 'flying' as const },
  ],
};

export const VAMPIRE_NOCTURNUS = {
  kind: 'creature' as const,
  id: 'm13-113-vampire-nocturnus',
  name: 'Vampire Nocturnus',
  rarity: 'mythic' as const,
  set: { code: 'M13', collectorNumber: 113 },
  colors: ['B'] as const,
  manaCost: { generic: 1, B: 3 },
  power: 3,
  toughness: 3,
  subtypes: ['Vampire'],
  keywords: [],
  abilities: [REVEAL, NIGHT],
};

describe('Vampire Nocturnus authoring', () => {
  it('renders the exact current Oracle text from two reusable static capabilities', () => {
    expect(renderOracleText(parseCard(VAMPIRE_NOCTURNUS))).toBe(
      [
        'Play with the top card of your library revealed.',
        'As long as the top card of your library is black, this creature and other Vampire creatures you control get +2/+1 and have flying.',
      ].join('\n'),
    );
  });

  it('keeps both engine-only static abilities outside generator output', () => {
    expect(ModelAbilitySchema.safeParse(REVEAL).success).toBe(false);
    expect(ModelAbilitySchema.safeParse(NIGHT).success).toBe(false);
  });
});
