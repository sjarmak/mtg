import { describe, expect, it } from 'vitest';
import type { LimitedCardFacts, PhysicalPoolCard } from '@mtg/limited';
import { prepareLimitedDeck, suggestLimitedDeckWithReport, validateLimitedDeck } from '@mtg/limited';

interface Fixture {
  readonly name: string;
  readonly facts: LimitedCardFacts;
}

function card(
  physicalId: string,
  score: number,
  overrides: Partial<LimitedCardFacts> = {},
): PhysicalPoolCard<Fixture> {
  const facts: LimitedCardFacts = {
    name: physicalId,
    colors: ['R'],
    manaValue: 5,
    type: 'noncreature-spell',
    score,
    roles: [],
    ...overrides,
  };
  return { physicalId, payload: { name: physicalId, facts } };
}

function factsFor(entry: PhysicalPoolCard<Fixture>): LimitedCardFacts {
  return entry.payload.facts;
}

const COHERENT_POOL: readonly PhysicalPoolCard<Fixture>[] = [
  card('expensive-1', 10),
  card('expensive-2', 9),
  card('expensive-3', 8),
  card('expensive-4', 7),
  card('early-creature-1', 4, { manaValue: 2, type: 'creature' }),
  card('early-creature-2', 3, { manaValue: 2, type: 'creature' }),
  card('early-interaction', 2, { manaValue: 2, roles: ['interaction'] }),
  card('creature-interaction', 1, { manaValue: 3, type: 'creature', roles: ['interaction'] }),
  card('green-bomb', 1_000, { colors: ['G'], manaValue: 4, type: 'creature' }),
];

const OPTIONS = {
  minimumDeckSize: 10,
  suggestedBasicLands: 4,
} as const;

describe('versioned Limited selection policies', () => {
  it('keeps score-ranked/v1 as the deterministic control', () => {
    const prepared = prepareLimitedDeck(COHERENT_POOL, factsFor, OPTIONS);
    const first = suggestLimitedDeckWithReport(prepared, { policy: 'score-ranked/v1' });
    const second = suggestLimitedDeckWithReport(prepared, { policy: 'score-ranked/v1' });

    expect(first.deck.selectedPhysicalIds).toEqual([
      'green-bomb',
      'expensive-1',
      'expensive-2',
      'expensive-3',
      'expensive-4',
      'early-creature-1',
    ]);
    expect(second).toEqual(first);
    expect(first.report).toMatchObject({ policy: 'score-ranked/v1', selectedCards: 6 });
  });

  it('selects lower-score cards that repair creature, interaction, and early-curve deficits', () => {
    const prepared = prepareLimitedDeck(COHERENT_POOL, factsFor, OPTIONS);
    const result = suggestLimitedDeckWithReport(prepared, {
      policy: 'deck-conditioned/v1',
      colors: ['R'],
      targets: { creatures: 3, interaction: 2, earlyPlays: 3 },
    });

    expect(result.deck.selectedPhysicalIds).toEqual([
      'expensive-1',
      'expensive-2',
      'early-creature-1',
      'early-creature-2',
      'early-interaction',
      'creature-interaction',
    ]);
    expect(result.deck.selectedPhysicalIds).not.toContain('green-bomb');
    expect(result.report).toMatchObject({
      policy: 'deck-conditioned/v1',
      colors: ['R'],
      selectedCards: 6,
      achieved: { creatures: 3, interaction: 2, earlyPlays: 4 },
      unmetTargets: [],
    });
    expect(validateLimitedDeck(result.deck).legal).toBe(true);
  });

  it('chooses colors automatically and keeps every selected spell castable by them', () => {
    const pool = [
      card('red-expensive-1', 10),
      card('red-expensive-2', 9),
      card('red-early-creature', 4, { manaValue: 2, type: 'creature' }),
      card('blue-creature-1', 6, { colors: ['U'], manaValue: 2, type: 'creature' }),
      card('blue-interaction', 5, {
        colors: ['U'],
        manaValue: 2,
        roles: ['interaction'],
      }),
      card('blue-creature-interaction', 3, {
        colors: ['U'],
        manaValue: 3,
        type: 'creature',
        roles: ['interaction'],
      }),
      card('white-bomb', 100, { colors: ['W'], manaValue: 4, type: 'creature' }),
    ];
    const prepared = prepareLimitedDeck(pool, factsFor, OPTIONS);
    const result = suggestLimitedDeckWithReport(prepared, {
      policy: 'deck-conditioned/v1',
      targets: { creatures: 3, interaction: 2, earlyPlays: 3 },
    });

    expect(result.report.colors).toEqual(['U', 'R']);
    for (const physicalId of result.deck.selectedPhysicalIds) {
      const selected = result.deck.pool.find((entry) => entry.physicalId === physicalId);
      expect(selected?.facts.colors.every((color) => result.report.colors.includes(color))).toBe(true);
    }
  });

  it('reports missing role evidence and targets that the pool cannot meet', () => {
    const pool = COHERENT_POOL.slice(0, 6).map((entry) => {
      const { roles: _roles, ...facts } = entry.payload.facts;
      return { ...entry, payload: { ...entry.payload, facts } };
    });
    const prepared = prepareLimitedDeck(pool, factsFor, OPTIONS);
    const result = suggestLimitedDeckWithReport(prepared, {
      policy: 'deck-conditioned/v1',
      colors: ['R'],
      targets: { creatures: 4, interaction: 2, earlyPlays: 4 },
    });

    expect(result.report.unknownRoleCards).toEqual(result.deck.selectedPhysicalIds);
    expect(result.report.unmetTargets).toEqual([
      { metric: 'creatures', target: 4, actual: 2 },
      { metric: 'interaction', target: 2, actual: 0 },
      { metric: 'earlyPlays', target: 4, actual: 2 },
    ]);
  });

  it('rejects invalid policy targets and color constraints explicitly', () => {
    const prepared = prepareLimitedDeck(COHERENT_POOL, factsFor, OPTIONS);
    expect(() =>
      suggestLimitedDeckWithReport(prepared, {
        policy: 'deck-conditioned/v1',
        colors: ['R', 'R'],
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-selection-policy' }));
    expect(() =>
      suggestLimitedDeckWithReport(prepared, {
        policy: 'deck-conditioned/v1',
        targets: { creatures: -1 },
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-selection-policy' }));
  });
});
