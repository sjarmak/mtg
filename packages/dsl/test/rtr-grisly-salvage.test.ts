/** Exact bounded top-library bundle for RTR #165, Grisly Salvage. */
import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, safeParseCard } from '@mtg/dsl';

const INPUT = {
  kind: 'instant',
  id: 'rtr-165-grisly-salvage',
  name: 'Grisly Salvage',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 165 },
  manaCost: { B: 1, G: 1 },
  colors: ['B', 'G'],
  effects: [
    {
      kind: 'selectFromTopLibrary',
      count: 5,
      filter: { cardTypes: ['creature', 'land'] },
      optional: true,
      reveal: true,
      revealAll: true,
      grislySalvageProfile: true,
      destination: 'hand',
      rest: 'graveyard',
    },
  ],
} as const;

describe('RTR #165 Grisly Salvage DSL', () => {
  it('parses and renders current Oracle exactly while staying outside the model', () => {
    const card = parseCard(INPUT);
    expect(renderOracleText(card)).toBe(
      'Reveal the top five cards of your library. You may put a creature or land card from among them into your hand. Put the rest into your graveyard.',
    );
    expect(ModelEffectSchema.safeParse(INPUT.effects[0]).success).toBe(false);
  });

  it('admits the source-attested bundle without independently widening its parameters', () => {
    for (const effect of [
      { ...INPUT.effects[0], count: 4 },
      { ...INPUT.effects[0], filter: { cardTypes: ['creature'] } },
      { ...INPUT.effects[0], rest: 'bottom' },
      { ...INPUT.effects[0], revealAll: undefined },
      { ...INPUT.effects[0], grislySalvageProfile: undefined },
    ]) {
      const result = safeParseCard({ ...INPUT, effects: [effect] });
      expect(result.ok).toBe(false);
    }
  });
});
