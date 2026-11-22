/** RTR #77 as the retained untargeted each-player creature sacrifice. */
import { describe, expect, it } from 'vitest';
import { CardEffectSchema, ModelEffectSchema, parseCard, renderOracleText, validateCard } from '@mtg/dsl';

const SACRIFICE = {
  kind: 'sacrificePermanent' as const,
  players: 'eachPlayer' as const,
  target: { kind: 'noTarget' as const },
};

const CARD = parseCard({
  kind: 'creature',
  id: 'rtr-077',
  name: 'Slum Reaper',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 77 },
  manaCost: { generic: 3, B: 1 },
  colors: ['B'],
  subtypes: ['Horror'],
  power: 4,
  toughness: 2,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      printedSourceReference: 'thisCreature',
      effects: [SACRIFICE],
    },
  ],
});

describe('RTR Slum Reaper authoring', () => {
  it('renders the exact current Oracle paragraph', () => {
    expect(validateCard(CARD)).toEqual([]);
    expect(renderOracleText(CARD)).toBe(
      'When this creature enters, each player sacrifices a creature of their choice.',
    );
  });

  it('keeps the each-player sacrifice outside generator output', () => {
    expect(CardEffectSchema.safeParse(SACRIFICE).success).toBe(true);
    expect(ModelEffectSchema.safeParse(SACRIFICE).success).toBe(false);
  });
});
