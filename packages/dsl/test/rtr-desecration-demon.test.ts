/** RTR #63 as one closed opponent-sacrifice combat trigger. */
import { describe, expect, it } from 'vitest';
import { ModelAbilitySchema, parseCard, renderOracleText, safeParseCard } from '@mtg/dsl';

const ABILITY = {
  kind: 'triggered' as const,
  condition: 'beginningOfEndStep' as const,
  optional: true as const,
  printedSourceReference: 'thisCreature' as const,
  opponentMaySacrificeCreatureThenTapAndCounterSelf: true as const,
  effects: [
    {
      kind: 'sacrificePermanent' as const,
      filter: { cardTypes: ['creature'] as const },
      target: { kind: 'triggeringPlayer' as const },
    },
    { kind: 'tapPermanent' as const, target: { kind: 'selfPermanent' as const } },
    {
      kind: 'putCounters' as const,
      counter: 'plusOnePlusOne' as const,
      count: 1,
      target: { kind: 'selfCreature' as const },
    },
  ],
};

const INPUT = {
  kind: 'creature' as const,
  id: 'rtr-063-desecration-demon',
  name: 'Desecration Demon',
  rarity: 'rare' as const,
  set: { code: 'RTR', collectorNumber: 63 },
  colors: ['B' as const],
  manaCost: { generic: 2, B: 2 },
  subtypes: ['Demon'],
  power: 6,
  toughness: 6,
  keywords: ['flying' as const],
  abilities: [ABILITY],
};

describe('RTR Desecration Demon DSL', () => {
  it('renders current Oracle exactly and remains outside model output', () => {
    const card = parseCard(INPUT);
    expect(renderOracleText(card)).toBe(
      'Flying\nAt the beginning of each combat, any opponent may sacrifice a creature of their choice. If a player does, tap this creature and put a +1/+1 counter on it.',
    );
    expect(ModelAbilitySchema.safeParse(card.abilities[0]).success).toBe(false);
  });

  it('refuses the three ordinary effects without the atomic contract', () => {
    const parsed = safeParseCard({
      ...INPUT,
      abilities: [{ ...ABILITY, opponentMaySacrificeCreatureThenTapAndCounterSelf: undefined }],
    });
    expect(parsed.ok).toBe(false);
  });
});
