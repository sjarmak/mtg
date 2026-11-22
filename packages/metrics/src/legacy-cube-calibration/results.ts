import { createHash } from 'node:crypto';
import { mean } from '../stats';
import { calibrationSeed } from './draft';
import type { CalibrationSplit, DraftPolicy } from './draft';
import type { CalibrationDeck } from './deck';

export function scheduleCalibrationGames(
  root: string,
  split: CalibrationSplit,
  pod: number,
  candidates: readonly { readonly policy: DraftPolicy; readonly deck: CalibrationDeck }[],
  opponents: readonly CalibrationDeck[],
  gamesPerOrder: number,
) {
  if (!Number.isSafeInteger(gamesPerOrder) || gamesPerOrder < 1 || gamesPerOrder > 100)
    throw new Error('Invalid game count');
  if (new Set(candidates.map((c) => c.policy)).size !== candidates.length)
    throw new Error('Duplicate policy');
  const base = calibrationSeed(root, split, 'game', pod);
  return candidates.flatMap((candidate) =>
    opponents.flatMap((opponent, opponentIndex) =>
      Array.from({ length: gamesPerOrder }, (_, game) =>
        ([0, 1] as const).map((candidateSeat) => {
          const seed = createHash('sha256')
            .update(JSON.stringify([base, opponentIndex, game]))
            .digest('hex');
          return {
            id: `${split}/${String(pod)}/${candidate.policy}/${String(opponentIndex)}/${String(game)}/${String(candidateSeat)}`,
            pod,
            policy: candidate.policy,
            seed,
            candidateSeat,
            decks:
              candidateSeat === 0
                ? ([candidate.deck, opponent] as const)
                : ([opponent, candidate.deck] as const),
          };
        }),
      ).flat(),
    ),
  );
}
export type ScheduledCalibrationGame = ReturnType<typeof scheduleCalibrationGames>[number];

export interface CalibrationGameResult {
  readonly id: string;
  readonly policy: string;
  readonly pod: number;
  readonly eligible: boolean;
  readonly outcome: 'win' | 'loss' | 'draw' | 'incomplete';
}

/** Hoeffding bound over independent pod means, not correlated games within a pod. */
function podInterval(values: readonly number[]) {
  const center = mean(values);
  if (values.length < 2 || center === null) return null;
  const radius = Math.sqrt(Math.log(40) / (2 * values.length));
  return { low: Math.max(0, center - radius), high: Math.min(1, center + radius) };
}

export function summarizeCalibrationGames(rows: readonly CalibrationGameResult[]) {
  if (new Set(rows.map((r) => r.id)).size !== rows.length) throw new Error('Duplicate game result');
  return [...new Set(rows.map((r) => r.policy))].map((policy) => {
    const selected = rows.filter((r) => r.policy === policy);
    const eligible = selected.filter((r) => r.eligible && r.outcome !== 'incomplete');
    const wins = eligible.filter((r) => r.outcome === 'win').length;
    const losses = eligible.filter((r) => r.outcome === 'loss').length;
    const draws = eligible.filter((r) => r.outcome === 'draw').length;
    const podScores = [...new Set(eligible.map((r) => r.pod))].map((pod) => {
      const games = eligible.filter((r) => r.pod === pod);
      return (
        games.reduce((n, r) => n + (r.outcome === 'win' ? 1 : r.outcome === 'draw' ? 0.5 : 0), 0) /
        games.length
      );
    });
    return {
      policy,
      wins,
      losses,
      draws,
      excluded: selected.filter((r) => !r.eligible).length,
      incomplete: selected.filter((r) => r.outcome === 'incomplete').length,
      pods: podScores.length,
      winRate: eligible.length ? wins / eligible.length : null,
      meanPodMatchPoints: mean(podScores),
      interval: podInterval(podScores),
      intervalMethod: '95% Hoeffding bound on independent pod match-point means; not human win probability',
    };
  });
}
