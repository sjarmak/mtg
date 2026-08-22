/**
 * Navigation over a recorded game: turns, clamping, and playback speeds.
 *
 * Every function here is a pure index computation over the step array, which is
 * what makes "forward then back" an identity rather than an approximation —
 * there is no accumulated state to drift.
 */
import type { LogEvent, LogPlayerId } from './log-schema';
import type { ReplayGameLog, ReplayStep } from './read-log';

export interface TurnFacts {
  readonly drawn: number;
  readonly lands: number;
  readonly spells: number;
  readonly attackers: number;
  readonly damageToPlayers: number;
}

export interface ReplayTurn {
  readonly turn: number;
  readonly active: LogPlayerId;
  readonly firstSeq: number;
  readonly lastSeq: number;
  readonly stepCount: number;
  /** Life at the end of the turn's last recorded step, per seat. */
  readonly life: readonly [number, number];
  readonly facts: TurnFacts;
}

const NO_FACTS: TurnFacts = { drawn: 0, lands: 0, spells: 0, attackers: 0, damageToPlayers: 0 };

function foldEvent(facts: TurnFacts, event: LogEvent): TurnFacts {
  switch (event.type) {
    case 'cardDrawn':
      return { ...facts, drawn: facts.drawn + 1 };
    case 'landPlayed':
      return { ...facts, lands: facts.lands + 1 };
    case 'spellCast':
      return { ...facts, spells: facts.spells + 1 };
    case 'attackersDeclared':
      return { ...facts, attackers: facts.attackers + event.attacks.length };
    case 'damageDealt':
      return event.target.kind === 'player'
        ? { ...facts, damageToPlayers: facts.damageToPlayers + event.amount }
        : facts;
    default:
      return facts;
  }
}

function factsOf(steps: readonly ReplayStep[]): TurnFacts {
  let facts = NO_FACTS;
  for (const step of steps) {
    for (const event of step.events) facts = foldEvent(facts, event);
  }
  return facts;
}

function turnOf(steps: readonly ReplayStep[]): ReplayTurn | null {
  const first = steps[0];
  const last = steps[steps.length - 1];
  if (first === undefined || last === undefined) return null;
  return {
    turn: first.turn,
    active: first.active,
    firstSeq: first.seq,
    lastSeq: last.seq,
    stepCount: steps.length,
    life: [last.state.seats[0].life, last.state.seats[1].life],
    facts: factsOf(steps),
  };
}

/** The game's turns in order, each with the step range it covers. */
export function turnsOf(game: ReplayGameLog): readonly ReplayTurn[] {
  const turns: ReplayTurn[] = [];
  let group: ReplayStep[] = [];
  for (const step of game.steps) {
    const current = group[0];
    if (current !== undefined && current.turn !== step.turn) {
      const built = turnOf(group);
      if (built !== null) turns.push(built);
      group = [];
    }
    group.push(step);
  }
  const tail = turnOf(group);
  if (tail !== null) turns.push(tail);
  return turns;
}

/** Keeps a step index inside the game; an empty game clamps to 0. */
export function clampSeq(game: ReplayGameLog, seq: number): number {
  if (!Number.isFinite(seq)) return 0;
  const last = game.steps.length - 1;
  if (last < 0) return 0;
  return Math.max(0, Math.min(last, Math.trunc(seq)));
}

/** First step of the given turn, or the nearest turn that exists. */
export function seqForTurn(game: ReplayGameLog, turn: number): number {
  const turns = turnsOf(game);
  const exact = turns.find((entry) => entry.turn === turn);
  if (exact !== undefined) return exact.firstSeq;
  const later = turns.find((entry) => entry.turn > turn);
  if (later !== undefined) return later.firstSeq;
  const last = turns[turns.length - 1];
  return last === undefined ? 0 : last.firstSeq;
}

export interface PlaybackSpeed {
  readonly id: string;
  readonly label: string;
  readonly millis: number;
}

/** Playback rates, slowest first. `id` is what goes in the URL. */
export const PLAYBACK_SPEEDS: readonly PlaybackSpeed[] = [
  { id: '0.5', label: '0.5×', millis: 800 },
  { id: '1', label: '1×', millis: 400 },
  { id: '2', label: '2×', millis: 200 },
  { id: '4', label: '4×', millis: 100 },
  { id: '8', label: '8×', millis: 50 },
];

export const DEFAULT_SPEED_ID = '1';

export function speedById(id: string): PlaybackSpeed {
  const found = PLAYBACK_SPEEDS.find((speed) => speed.id === id);
  if (found !== undefined) return found;
  const fallback = PLAYBACK_SPEEDS.find((speed) => speed.id === DEFAULT_SPEED_ID);
  if (fallback === undefined) throw new Error('PLAYBACK_SPEEDS is missing its default');
  return fallback;
}

/**
 * The events that make a frame worth resting on.
 *
 * A step is one kernel decision, and decisions are wildly unequal amounts of
 * game: a mana ability and the combat damage that ended the game are one tick
 * each. A constant interval therefore spends the same time on a priority pass
 * nobody made a choice at as on the swing that decided the match, which is the
 * one frame a watcher wants to see.
 */
const LANDMARK_EVENTS: readonly string[] = [
  'spellCast',
  'attackersDeclared',
  'blockersDeclared',
  'damageDealt',
  'permanentDestroyed',
  'permanentSacrificed',
  'tokenCreated',
  'playerLost',
  'gameEnded',
];

/**
 * A landmark rests twice as long. There is no third case: every recorded step
 * is one kernel decision and carries at least a `priorityGained`, so a "frame
 * that emitted nothing" is a state the log does not have.
 */
export const LANDMARK_BEATS = 2;

/**
 * How long playback holds this frame, in milliseconds.
 *
 * Pacing is per frame rather than per tick, and it is derived from the recorded
 * events rather than stored, so two viewers at one speed watch the same game at
 * the same rhythm.
 */
export function dwellMillis(step: ReplayStep, speed: PlaybackSpeed): number {
  const landmark = step.events.some((event) => LANDMARK_EVENTS.includes(event.type));
  return speed.millis * (landmark ? LANDMARK_BEATS : 1);
}
