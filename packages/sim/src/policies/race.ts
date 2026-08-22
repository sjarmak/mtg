/**
 * The race: who kills whom first, and what that licenses.
 *
 * The tier-1 bots' original combat heuristics were purely local — is this one
 * attack profitable, is this one block profitable — and a policy built only out
 * of local profitability never presses an advantage, because the last attack of
 * a won game is almost always a bad trade. Measured on the pinned 10,035-game
 * balance sweep (bead `mtg-bc2.35`), that produced 17.7% of games running past
 * round 15 against a 15% bound and 8.1% hitting the turn cap against 5%.
 *
 * A race assessment is the missing global term. Two clocks, in turns:
 *
 *  - `ourClock` — how many more combats we need to reduce them to zero,
 *  - `theirClock` — how many they need against us.
 *
 * Everything else in this file is a policy that reads those two numbers. The
 * weights they are priced against are the `race` section of `GreedyBotConfig`,
 * beside every other named weight in `../config`, so a per-bot race profile
 * rides in a `BotSpec` across the worker boundary like the rest of the profile.
 */
import type { GameState, PlayerId } from '@mtg/kernel';
import { opponentOf, powerOf } from '@mtg/kernel';
import type { RacePolicyConfig } from '../config';
import { attackCapableCreatures } from './combat';

export interface RaceAssessment {
  /** Combats we need to kill them, or `Infinity` when we cannot. */
  readonly ourClock: number;
  /** Combats they need to kill us, or `Infinity` when they cannot. */
  readonly theirClock: number;
  /** Our attack-capable power right now. */
  readonly ourPower: number;
  /** Theirs. */
  readonly theirPower: number;
  /** We kill them first by at least `winningMargin` turns. */
  readonly winning: boolean;
  /** They kill us first. */
  readonly losing: boolean;
}

function clock(life: number, power: number): number {
  if (power <= 0) return Number.POSITIVE_INFINITY;
  return Math.ceil(Math.max(0, life) / power);
}

function attackPower(state: GameState, player: PlayerId): number {
  let total = 0;
  for (const oid of attackCapableCreatures(state, player)) total += Math.max(0, powerOf(state, oid));
  return total;
}

/**
 * The race as it stands, from `me`'s side.
 *
 * Both clocks are deliberately crude: total attack-capable power against life,
 * with no allowance for blocks, removal, or what either player draws. A more
 * careful estimate would need a search, and the point of a tier-1 policy is that
 * it does not search. What matters is that the two sides are estimated the same
 * way, so the comparison is meaningful even where each half is wrong.
 */
export function assessRace(state: GameState, me: PlayerId, config: RacePolicyConfig): RaceAssessment {
  const them = opponentOf(me);
  const ourPower = attackPower(state, me);
  const theirPower = attackPower(state, them);
  const ourClock = clock(state.players[them].life, ourPower);
  const theirClock = clock(state.players[me].life, theirPower);
  return {
    ourClock,
    theirClock,
    ourPower,
    theirPower,
    winning: Number.isFinite(ourClock) && ourClock + config.winningMargin <= theirClock,
    losing: ourClock > theirClock,
  };
}
