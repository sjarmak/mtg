/**
 * A candidate policy's win rate against a reference policy, seats alternated.
 *
 * This is the cheap gate in front of a promotion campaign, not a replacement
 * for one: it is unpaired, it states no confidence bound, and it plays one
 * fixture format. What it buys is the answer to the only question worth asking
 * before spending a campaign -- can this candidate win a game at all. The model
 * that motivated it won none of eighty while the campaign it was queued for
 * costs minutes per unit (mtg-bw8z.2).
 *
 * Seats alternate by game index so the starting-player advantage falls on both
 * policies equally, and every game is seeded by its own position, so a reading
 * reproduces.
 */
import { actionKey, type PlayerAgent } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG } from './config';
import { playSimGame } from './driver';
import { FIXTURE_DECK_GW, FIXTURE_DECK_RW, FIXTURE_DECK_UB, FIXTURE_FORMAT_POOL } from './fixtures';
import { decideGreedy } from './greedy-bot';

const DECKS = [FIXTURE_DECK_RW, FIXTURE_DECK_GW, FIXTURE_DECK_UB] as const;

export interface HeadToHeadOptions {
  /** Built per game, because an agent may carry per-game state. */
  readonly candidate: (name: string, gameSeed: string) => PlayerAgent;
  readonly reference: (name: string, gameSeed: string) => PlayerAgent;
  readonly games: number;
  readonly runSeed: string;
  /** Omniscient rollout is retained only as a labeled diagnostic ceiling. */
  readonly rolloutWorld?: 'fair' | 'privileged';
}

export interface HeadToHeadReport {
  readonly games: number;
  readonly candidateWins: number;
  readonly referenceWins: number;
  readonly draws: number;
  /** Draws count as neither win, so the three shares need not sum to one. */
  readonly candidateWinRate: number;
  readonly candidateDepartures: number;
  readonly candidateDeparturesPerGame: number;
}

export function playHeadToHead(options: HeadToHeadOptions): HeadToHeadReport {
  if (!Number.isInteger(options.games) || options.games < 1) {
    throw new Error('head to head requires a positive integer number of games');
  }
  if (options.runSeed.length === 0) throw new Error('head to head requires a non-empty run seed');

  let candidateWins = 0;
  let referenceWins = 0;
  let draws = 0;
  let candidateDepartures = 0;
  for (let index = 0; index < options.games; index += 1) {
    const gameId = `${options.runSeed}:${String(index)}`;
    const first = DECKS[index % DECKS.length]!;
    const second = DECKS[(index + 1 + Math.floor(index / DECKS.length)) % DECKS.length]!;
    const candidateSeat = index % 2;
    const candidate = options.candidate('candidate', gameId);
    const measuredCandidate: PlayerAgent = {
      name: candidate.name,
      decide(view) {
        const chosen = candidate.decide(view);
        if (actionKey(chosen) !== actionKey(decideGreedy(view, DEFAULT_GREEDY_CONFIG))) {
          candidateDepartures += 1;
        }
        return chosen;
      },
    };
    const seat = (player: number): PlayerAgent =>
      player === candidateSeat ? measuredCandidate : options.reference('reference', gameId);
    let winner: number | null;
    try {
      winner = playSimGame({
        index,
        seed: gameId,
        decks: [first, second],
        rolloutPool: FIXTURE_FORMAT_POOL,
        rolloutWorld: options.rolloutWorld ?? 'fair',
        startingPlayer: index % 2 === 0 ? 0 : 1,
        agents: [seat(0), seat(1)],
      }).winner;
    } catch (error) {
      // A failed game is evidence about the candidate, not a game to drop: a
      // silently skipped crash reads as a draw and flatters whichever policy
      // caused it.
      throw new Error(`head-to-head game ${gameId} failed`, { cause: error });
    }
    if (winner === null) draws += 1;
    else if (winner === candidateSeat) candidateWins += 1;
    else referenceWins += 1;
  }
  return {
    games: options.games,
    candidateWins,
    referenceWins,
    draws,
    candidateWinRate: candidateWins / options.games,
    candidateDepartures,
    candidateDeparturesPerGame: candidateDepartures / options.games,
  };
}
