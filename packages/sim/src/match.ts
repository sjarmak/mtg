/**
 * A match specification: everything needed to reproduce a run from a seed.
 *
 * Kept in its own module because both the runner and the worker import it, and
 * the worker must not pull in `node:worker_threads` transitively through the
 * runner.
 *
 * Every field is plain data. That is a hard requirement, not a style choice:
 * the whole spec is `structuredClone`d into each worker.
 */
import type { Card } from '@mtg/dsl';
import type { DeckList } from '@mtg/kernel';
import type { BotSpec } from './bots';
import type { EnumerationCaps, GameBudget } from './driver';
import { DEFAULT_BOARD_CAP } from './driver';

export interface MatchSpec {
  /** Every random draw in the run derives from this. */
  readonly runSeed: string;
  readonly games: number;
  /** Seat 0 plays `decks[0]` in every game; only the play/draw seat alternates. */
  readonly decks: readonly [DeckList, DeckList];
  readonly bots: readonly [BotSpec, BotSpec];
  /** Public format distribution used by rollout policies for hidden-state sampling. */
  readonly rolloutPool?: readonly Card[] | undefined;
  readonly alternatePlayFirst?: boolean | undefined;
  readonly maximumTurns?: number | undefined;
  /** Permanents on the battlefield before a game is stopped as a `boardCap` draw; `null` for no cap. */
  readonly boardCap?: number | null | undefined;
  readonly budget?: GameBudget | undefined;
  readonly caps?: EnumerationCaps | undefined;
  /** Building the replay log costs time; benchmarks turn it off. */
  readonly collectLogs?: boolean | undefined;
  /** Preserve the kernel event stream for card-instance evidence. Opt-in because it is large. */
  readonly collectEvents?: boolean | undefined;
  /** Count trigger fires and activation uses against their arrivals. Small enough to cross a worker boundary. */
  readonly censusAbilities?: boolean | undefined;
  readonly expansion?: string | undefined;
  readonly eventType?: string | undefined;
  /** Fixed timestamp for the log's `game_time`; a clock would break replayability. */
  readonly gameTime?: string | undefined;
}

export interface ResolvedMatchSpec {
  readonly runSeed: string;
  readonly games: number;
  readonly decks: readonly [DeckList, DeckList];
  readonly bots: readonly [BotSpec, BotSpec];
  readonly rolloutPool: readonly Card[] | undefined;
  readonly alternatePlayFirst: boolean;
  readonly maximumTurns: number;
  readonly boardCap: number | null;
  readonly budget: GameBudget | undefined;
  readonly caps: EnumerationCaps | undefined;
  readonly collectLogs: boolean;
  readonly collectEvents: boolean;
  readonly censusAbilities: boolean;
  readonly expansion: string;
  readonly eventType: string;
  readonly gameTime: string;
}

export const DEFAULT_EXPANSION = 'SLC';
export const DEFAULT_EVENT_TYPE = 'SelfPlay';

export function resolveMatchSpec(spec: MatchSpec): ResolvedMatchSpec {
  if (!Number.isInteger(spec.games) || spec.games <= 0) {
    throw new Error(`match spec needs a positive integer game count, got ${String(spec.games)}`);
  }
  if (spec.runSeed.length === 0) throw new Error('match spec needs a non-empty run seed');
  const boardCap = spec.boardCap === undefined ? DEFAULT_BOARD_CAP : spec.boardCap;
  if (boardCap !== null && (!Number.isInteger(boardCap) || boardCap <= 0)) {
    throw new Error(`match spec needs a positive integer board cap or null, got ${String(boardCap)}`);
  }
  return {
    runSeed: spec.runSeed,
    games: spec.games,
    decks: spec.decks,
    bots: spec.bots,
    rolloutPool: spec.rolloutPool,
    alternatePlayFirst: spec.alternatePlayFirst ?? true,
    maximumTurns: spec.maximumTurns ?? 40,
    boardCap,
    budget: spec.budget,
    caps: spec.caps,
    collectLogs: spec.collectLogs ?? false,
    collectEvents: spec.collectEvents ?? false,
    censusAbilities: spec.censusAbilities ?? false,
    expansion: spec.expansion ?? DEFAULT_EXPANSION,
    eventType: spec.eventType ?? DEFAULT_EVENT_TYPE,
    gameTime: spec.gameTime ?? '',
  };
}
