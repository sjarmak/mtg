import { describe, expect, it } from 'vitest';
import {
  parseConstructedGameplayComparison,
  serializedConstructedGameplayComparison,
  summarizeConstructedGameplayComparison,
} from '../src/constructed-evaluation';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

function comparison() {
  return {
    schemaVersion: 1 as const,
    id: 'modern-candidate-pair-1',
    engine: { kind: 'native' as const, version: 'kernel-1', buildSha256: SHA_A },
    gameplay: { policyId: 'native-search/v2', configSha256: SHA_B },
    match: { kind: 'independent-games' as const, sideboarding: 'absent' as const, gamesPerPair: 2 },
    gauntlet: {
      id: 'frozen-modern-field',
      opponents: [
        { id: 'energy', deckSha256: SHA_A, share: 0.7 },
        { id: 'combo', deckSha256: SHA_B, share: 0.3 },
      ],
    },
    candidates: [
      { id: 'baseline', deckSha256: SHA_A },
      { id: 'candidate', deckSha256: SHA_C },
    ],
    games: [
      {
        id: 'g1',
        seed: 's1',
        candidateId: 'baseline',
        opponentId: 'energy',
        candidateSeat: 0,
        result: 'loss' as const,
      },
      {
        id: 'g2',
        seed: 's2',
        candidateId: 'baseline',
        opponentId: 'energy',
        candidateSeat: 1,
        result: 'win' as const,
      },
      {
        id: 'g3',
        seed: 's3',
        candidateId: 'baseline',
        opponentId: 'combo',
        candidateSeat: 0,
        result: 'loss' as const,
      },
      {
        id: 'g4',
        seed: 's4',
        candidateId: 'baseline',
        opponentId: 'combo',
        candidateSeat: 1,
        result: 'draw' as const,
      },
      {
        id: 'g5',
        seed: 's1',
        candidateId: 'candidate',
        opponentId: 'energy',
        candidateSeat: 0,
        result: 'win' as const,
      },
      {
        id: 'g6',
        seed: 's2',
        candidateId: 'candidate',
        opponentId: 'energy',
        candidateSeat: 1,
        result: 'win' as const,
      },
      {
        id: 'g7',
        seed: 's3',
        candidateId: 'candidate',
        opponentId: 'combo',
        candidateSeat: 0,
        result: 'loss' as const,
      },
      {
        id: 'g8',
        seed: 's4',
        candidateId: 'candidate',
        opponentId: 'combo',
        candidateSeat: 1,
        result: 'win' as const,
      },
    ],
  };
}

describe('constructed gameplay comparison', () => {
  it('names the engine, gameplay policy, frozen gauntlet, decks, seeds, and seat schedule', () => {
    const parsed = parseConstructedGameplayComparison(comparison());
    expect(parsed.engine.kind).toBe('native');
    expect(parsed.gameplay.policyId).toBe('native-search/v2');
    expect(parsed.match).toEqual({
      kind: 'independent-games',
      sideboarding: 'absent',
      gamesPerPair: 2,
    });
    expect(parsed.gauntlet.id).toBe('frozen-modern-field');
    expect(parsed.games.map(({ seed, candidateSeat }) => ({ seed, candidateSeat }))).toEqual([
      { seed: 's1', candidateSeat: 0 },
      { seed: 's2', candidateSeat: 1 },
      { seed: 's3', candidateSeat: 0 },
      { seed: 's4', candidateSeat: 1 },
      { seed: 's1', candidateSeat: 0 },
      { seed: 's2', candidateSeat: 1 },
      { seed: 's3', candidateSeat: 0 },
      { seed: 's4', candidateSeat: 1 },
    ]);
  });

  it('compares candidates from recorded outcomes without calling a model judge', () => {
    expect(summarizeConstructedGameplayComparison(comparison())).toEqual([
      {
        candidateId: 'baseline',
        games: 4,
        wins: 1,
        losses: 2,
        draws: 1,
        gameWinRate: 0.375,
        populationGameWinRate: 0.425,
      },
      {
        candidateId: 'candidate',
        games: 4,
        wins: 3,
        losses: 1,
        draws: 0,
        gameWinRate: 0.75,
        populationGameWinRate: 0.85,
      },
    ]);
  });

  it('refuses unknown deck references and incomplete candidate-by-opponent coverage', () => {
    const unknown = comparison();
    unknown.games[0] = { ...unknown.games[0]!, opponentId: 'invented' };
    expect(() => parseConstructedGameplayComparison(unknown)).toThrow(/unknown opponent invented/);

    const incomplete = comparison();
    incomplete.games = incomplete.games.filter(
      (game) => !(game.candidateId === 'candidate' && game.opponentId === 'combo'),
    );
    expect(() => parseConstructedGameplayComparison(incomplete)).toThrow(/candidate.*combo/);
  });

  it('refuses a comparison that changes the held seed or seat schedule', () => {
    const shifted = comparison();
    shifted.games[4] = { ...shifted.games[4]!, seed: 'candidate-only-seed' };
    expect(() => parseConstructedGameplayComparison(shifted)).toThrow(/baseline seed and seat schedule/);
  });

  it('refuses repeated deterministic schedule units while accepting distinct seeds and seats', () => {
    expect(parseConstructedGameplayComparison(comparison()).games).toHaveLength(8);

    const repeated = comparison();
    repeated.games[1] = {
      ...repeated.games[1]!,
      seed: repeated.games[0]!.seed,
      candidateSeat: repeated.games[0]!.candidateSeat,
    };
    repeated.games[5] = {
      ...repeated.games[5]!,
      seed: repeated.games[4]!.seed,
      candidateSeat: repeated.games[4]!.candidateSeat,
    };

    expect(() => parseConstructedGameplayComparison(repeated)).toThrow(
      /duplicate deterministic game schedule unit/,
    );
  });

  it('serializes byte-identically regardless of object key insertion order', () => {
    const value = comparison();
    const reordered = { ...value, games: value.games, candidates: value.candidates };
    expect(serializedConstructedGameplayComparison(value)).toBe(
      serializedConstructedGameplayComparison(reordered),
    );
  });
});
