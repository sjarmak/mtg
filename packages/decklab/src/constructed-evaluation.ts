import { canonicalJson } from '@mtg/dsl';
import { z } from 'zod';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const IdentifiedDeckSchema = z.object({ id: z.string().min(1), deckSha256: Sha256Schema }).strict();

export const ConstructedGameplayComparisonSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    engine: z
      .object({
        kind: z.enum(['native', 'forge']),
        version: z.string().min(1),
        buildSha256: Sha256Schema,
      })
      .strict(),
    gameplay: z.object({ policyId: z.string().min(1), configSha256: Sha256Schema }).strict(),
    match: z
      .object({
        kind: z.literal('independent-games'),
        sideboarding: z.literal('absent'),
        gamesPerPair: z.int().positive(),
      })
      .strict(),
    gauntlet: z
      .object({
        id: z.string().min(1),
        opponents: z
          .array(IdentifiedDeckSchema.extend({ share: z.number().positive().max(1) }).strict())
          .min(1),
      })
      .strict(),
    candidates: z.array(IdentifiedDeckSchema).min(2),
    games: z.array(
      z
        .object({
          id: z.string().min(1),
          seed: z.string().min(1),
          candidateId: z.string().min(1),
          opponentId: z.string().min(1),
          candidateSeat: z.union([z.literal(0), z.literal(1)]),
          result: z.enum(['win', 'loss', 'draw']),
        })
        .strict(),
    ),
  })
  .strict();

export type ConstructedGameplayComparison = z.infer<typeof ConstructedGameplayComparisonSchema>;

function uniqueIds(values: readonly { readonly id: string }[], label: string): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value.id)) throw new Error(`duplicate ${label} id ${value.id}`);
    ids.add(value.id);
  }
  return ids;
}

function requireUniqueDeterministicGameUnits(games: ConstructedGameplayComparison['games']): void {
  const units = new Set<string>();
  for (const game of games) {
    const unit = canonicalJson([game.candidateId, game.opponentId, game.seed, game.candidateSeat]);
    if (units.has(unit)) {
      throw new Error(`duplicate deterministic game schedule unit at game ${game.id}`);
    }
    units.add(unit);
  }
}

/** Validate both document shape and cross-record coverage before evidence is accepted. */
export function parseConstructedGameplayComparison(value: unknown): ConstructedGameplayComparison {
  const comparison = ConstructedGameplayComparisonSchema.parse(value);
  const candidateIds = uniqueIds(comparison.candidates, 'candidate');
  const opponentIds = uniqueIds(comparison.gauntlet.opponents, 'opponent');
  uniqueIds(comparison.games, 'game');
  const shareTotal = comparison.gauntlet.opponents.reduce((sum, opponent) => sum + opponent.share, 0);
  if (Math.abs(shareTotal - 1) > 1e-9) {
    throw new Error(`gauntlet shares must sum to 1; received ${String(shareTotal)}`);
  }

  for (const game of comparison.games) {
    if (!candidateIds.has(game.candidateId))
      throw new Error(`game ${game.id} names unknown candidate ${game.candidateId}`);
    if (!opponentIds.has(game.opponentId))
      throw new Error(`game ${game.id} names unknown opponent ${game.opponentId}`);
  }
  requireUniqueDeterministicGameUnits(comparison.games);
  for (const candidateId of candidateIds) {
    for (const opponentId of opponentIds) {
      const count = comparison.games.filter(
        (game) => game.candidateId === candidateId && game.opponentId === opponentId,
      ).length;
      if (count !== comparison.match.gamesPerPair) {
        throw new Error(
          `candidate ${candidateId} has ${String(count)} games against ${opponentId}; expected ${String(comparison.match.gamesPerPair)}`,
        );
      }
    }
  }
  const [baselineId] = candidateIds;
  if (baselineId === undefined) throw new Error('constructed comparison has no baseline candidate');
  for (const opponentId of opponentIds) {
    const scheduleOf = (candidateId: string): string[] =>
      comparison.games
        .filter((game) => game.candidateId === candidateId && game.opponentId === opponentId)
        .map((game) => `${game.seed}:${String(game.candidateSeat)}`)
        .toSorted();
    const baselineSchedule = scheduleOf(baselineId);
    for (const candidateId of candidateIds) {
      if (canonicalJson(scheduleOf(candidateId)) !== canonicalJson(baselineSchedule)) {
        throw new Error(
          `candidate ${candidateId} does not use the baseline seed and seat schedule against ${opponentId}`,
        );
      }
    }
  }
  return comparison;
}

export interface ConstructedCandidateSummary {
  readonly candidateId: string;
  readonly games: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly gameWinRate: number;
  /** Per-opponent game rates weighted by the gauntlet's declared shares. */
  readonly populationGameWinRate: number;
}

/** Summarize recorded game outcomes; no model judgment enters this comparison. */
export function summarizeConstructedGameplayComparison(
  value: unknown,
): readonly ConstructedCandidateSummary[] {
  const comparison = parseConstructedGameplayComparison(value);
  return comparison.candidates.map((candidate) => {
    const games = comparison.games.filter((game) => game.candidateId === candidate.id);
    const wins = games.filter((game) => game.result === 'win').length;
    const losses = games.filter((game) => game.result === 'loss').length;
    const draws = games.length - wins - losses;
    const populationGameWinRate = comparison.gauntlet.opponents.reduce((weighted, opponent) => {
      const paired = games.filter((game) => game.opponentId === opponent.id);
      const pairedWins = paired.filter((game) => game.result === 'win').length;
      const pairedDraws = paired.filter((game) => game.result === 'draw').length;
      return weighted + opponent.share * ((pairedWins + pairedDraws / 2) / paired.length);
    }, 0);
    return {
      candidateId: candidate.id,
      games: games.length,
      wins,
      losses,
      draws,
      gameWinRate: (wins + draws / 2) / games.length,
      populationGameWinRate,
    };
  });
}

export function serializedConstructedGameplayComparison(value: unknown): string {
  return canonicalJson(parseConstructedGameplayComparison(value));
}
