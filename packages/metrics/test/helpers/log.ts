/**
 * Synthetic `SimGameLog` fixtures.
 *
 * Every fixture is pushed through `SimGameLogSchema` before it is returned, so
 * a fixture that drifts out of the exporter's schema fails at construction
 * rather than quietly teaching a metric the wrong shape.
 *
 * The builder mirrors the kernel's turn model exactly: global player-turn
 * numbering, the on-play side taking the odd turns, and one land drop per turn
 * at most.
 */
import type { SideTotals, SideTurnStats, SimGameLog, Side, TurnRecord } from '@mtg/sim';
import { emptySideTotals, emptySideTurnStats, SIM_LOG_SCHEMA_VERSION, SimGameLogSchema } from '@mtg/sim';

/** Zeroed `CardGameStats`, with any of the four counters overridden. */
export function cardStats(overrides: Partial<SimGameLog['cards'][string]> = {}): SimGameLog['cards'][string] {
  return { deck: 0, sideboard: 0, opening_hand: 0, drawn: 0, ...overrides };
}

export interface FakeGameSpec {
  readonly index?: number;
  readonly userColors?: string;
  readonly oppoColors?: string;
  /** Seat that won; `null` is a draw. */
  readonly winner?: 0 | 1 | null;
  /** Seat on the play. */
  readonly onPlay?: 0 | 1;
  /** Global player turns the game lasted. */
  readonly playerTurns: number;
  readonly endReason?: SimGameLog['extras']['sim_end_reason'];
  /** Lands in play at the end of each of the user's own turns, 1-based. */
  readonly userLands?: readonly number[];
  readonly oppoLands?: readonly number[];
  /** Global turn numbers on which nobody advanced the board. */
  readonly inertTurns?: readonly number[];
  /**
   * Abilities the turn's owner activated on each of its turns — 17lands'
   * `abilities` column, which `@mtg/sim` fills from `abilityActivated` events.
   * Default 0, which is the shape a vanilla pool produces and the state the
   * usage floor exists to catch.
   */
  readonly activationsPerTurn?: number;
  /**
   * Abilities that triggered for the turn's owner on each of its turns — our
   * own `sim_triggers` column, which `@mtg/sim` fills from `abilityTriggered`
   * events. Default 0, the shape a pool with no triggered ability produces and
   * the state the trigger floor exists to catch.
   */
  readonly triggersPerTurn?: number;
  /**
   * Perturbs the trajectory so otherwise-identical games fingerprint apart. It
   * moves the life lines and nothing else, so no metric reads it; see
   * `lifeLine` for why that is the field it moves.
   */
  readonly variant?: number;
  /** The GAME-dataset `cards` map, keyed by card name. Default `{}`, matching a fixture with no card identity. */
  readonly cards?: SimGameLog['cards'];
}

function sideOf(seat: 0 | 1): Side {
  return seat === 0 ? 'user' : 'oppo';
}

/** Lands at the end of a side's `ordinal`-th turn; the default is a perfect curve. */
function landsAt(schedule: readonly number[] | undefined, ordinal: number): number {
  if (ordinal <= 0) return 0;
  if (schedule === undefined) return ordinal;
  const value = schedule[ordinal - 1];
  if (value !== undefined) return value;
  return schedule[schedule.length - 1] ?? 0;
}

/**
 * The life total at the end of each of a game's turns: twenty at the start,
 * declining at a rate this game does not share with its neighbors.
 *
 * This was one modular shift of a total that then stayed flat for the whole
 * game, and it cycled on 17, so a thousand games were seventeen trajectories
 * wearing a large number and every rule that scales with volume read a sample
 * the fixture had not bought (`mtg-pixl`). Perturbing the whole line rather
 * than its intercept is both far more distinct and closer to a game: life goes
 * down, at a pace the two decks decide.
 *
 * Free to move because nothing under `../../src` reads `eot_life` — its one
 * reader is `sample.ts`'s fingerprint, which is the reader this exists for.
 */
function lifeLine(variant: number, offset: number, turns: number): readonly number[] {
  const line: number[] = [];
  let life = 20;
  for (let turn = 1; turn <= turns; turn += 1) {
    // One point or none per turn. Never two, so a long game does not bottom out
    // at 1 and give back the distinctness the tail of the line is carrying.
    line.push((life = Math.max(1, life - (scramble(variant, offset, turn) % 2))));
  }
  return line;
}

/**
 * An avalanche mix of the three numbers that name a turn of a game.
 *
 * A mix and not a modular shift, which is the whole of why this reads the way
 * it does: taking a bit out of a linear function of the variant is a structured
 * sequence, and the first thing tried here repeated its sixteen-turn pattern
 * every ten games. Two hundred games have to be two hundred lines, or the
 * fixture is back to promising a sample it did not buy.
 */
function scramble(variant: number, offset: number, turn: number): number {
  let mixed = (Math.imul(variant, 1000003) + offset * 97 + turn) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 2246822507);
  mixed = Math.imul(mixed ^ (mixed >>> 13), 3266489909);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

/** A life line's reading at `turn`, 1-based; a turn past its end holds. */
function lifeAt(line: readonly number[], turn: number): number {
  return line[turn - 1] ?? line[line.length - 1] ?? 20;
}

function stats(lands: number, life: number, creatures: number, activations = 0, triggers = 0): SideTurnStats {
  return {
    ...emptySideTurnStats(),
    abilities: activations,
    sim_triggers: triggers,
    eot_cards_in_hand: 5,
    eot_lands_in_play: lands,
    eot_creatures_in_play: creatures,
    eot_life: life,
  };
}

export function fakeLog(spec: FakeGameSpec): SimGameLog {
  if (spec.playerTurns < 1) throw new Error('fakeLog: a game lasts at least one turn');
  const onPlaySeat = spec.onPlay ?? 0;
  const onPlaySide = sideOf(onPlaySeat);
  const inert = new Set(spec.inertTurns ?? []);
  const variant = spec.variant ?? 0;
  const activations = spec.activationsPerTurn ?? 0;
  const triggers = spec.triggersPerTurn ?? 0;
  const schedules: Record<Side, readonly number[] | undefined> = {
    user: spec.userLands,
    oppo: spec.oppoLands,
  };

  const lives: Record<Side, readonly number[]> = {
    user: lifeLine(variant, 0, spec.playerTurns),
    oppo: lifeLine(variant, 3, spec.playerTurns),
  };

  const ordinals: Record<Side, number> = { user: 0, oppo: 0 };
  const totals: Record<Side, SideTotals> = { user: emptySideTotals(), oppo: emptySideTotals() };
  const turns: TurnRecord[] = [];

  for (let turn = 1; turn <= spec.playerTurns; turn += 1) {
    const owner: Side = turn % 2 === 1 ? onPlaySide : onPlaySide === 'user' ? 'oppo' : 'user';
    ordinals[owner] += 1;
    const ordinal = ordinals[owner];
    const before = landsAt(schedules[owner], ordinal - 1);
    const after = landsAt(schedules[owner], ordinal);
    const landsPlayed = Math.max(0, Math.min(1, after - before));
    const idle = inert.has(turn);
    const creaturesCast = idle ? 0 : 1;

    totals[owner] = {
      ...totals[owner],
      lands_played: totals[owner].lands_played + landsPlayed,
      creatures_cast: totals[owner].creatures_cast + creaturesCast,
      cards_drawn: totals[owner].cards_drawn + 1,
    };

    turns.push({
      turn,
      owner,
      cards_drawn: 1,
      cards_tutored: 0,
      cards_discarded: 0,
      lands_played: landsPlayed,
      creatures_cast: creaturesCast,
      non_creatures_cast: 0,
      creatures_attacked: idle ? 0 : 1,
      creatures_blocked: 0,
      creatures_unblocked: idle ? 0 : 1,
      creatures_blocking: 0,
      user: stats(
        landsAt(schedules.user, ordinals.user),
        lifeAt(lives.user, turn),
        ordinals.user,
        owner === 'user' ? activations : 0,
        owner === 'user' ? triggers : 0,
      ),
      oppo: stats(
        landsAt(schedules.oppo, ordinals.oppo),
        lifeAt(lives.oppo, turn),
        ordinals.oppo,
        owner === 'oppo' ? activations : 0,
        owner === 'oppo' ? triggers : 0,
      ),
    });
  }

  const winner = spec.winner === undefined ? 0 : spec.winner;
  const log: SimGameLog = {
    metadata: {
      expansion: 'SLC',
      event_type: 'SelfPlay',
      draft_id: `fixture/${spec.index ?? 0}`,
      draft_time: '',
      game_time: '',
      build_index: 0,
      match_number: 1,
      game_number: 1,
      rank: '',
      opp_rank: '',
      main_colors: spec.userColors ?? 'WU',
      splash_colors: '',
      on_play: onPlaySeat === 0 ? 1 : 0,
      num_mulligans: 0,
      opp_num_mulligans: 0,
      opp_colors: spec.oppoColors ?? 'BR',
      num_turns: spec.playerTurns,
      won: winner === 0 ? 1 : 0,
    },
    extras: {
      sim_schema_version: SIM_LOG_SCHEMA_VERSION,
      sim_run_seed: 'fixture',
      sim_game_seed: `fixture/game/${spec.index ?? 0}`,
      sim_game_index: spec.index ?? 0,
      sim_user_deck: spec.userColors ?? 'WU',
      sim_oppo_deck: spec.oppoColors ?? 'BR',
      sim_user_bot: 'greedy',
      sim_oppo_bot: 'greedy',
      sim_winner: winner,
      sim_end_reason: spec.endReason ?? (winner === null ? 'turnLimit' : 'lifeZero'),
      sim_decisions: spec.playerTurns * 8,
    },
    totals,
    turns,
    // This fixture synthesizes turns from schedules, not from a real deck or
    // event stream, so there is no card identity to seed per-card counts from
    // unless the spec states one.
    cards: spec.cards ?? {},
  };
  return SimGameLogSchema.parse(log);
}

/**
 * `count` games from one spec, each perturbed so they fingerprint apart. Use
 * this whenever a test needs to clear a sample floor without pretending that
 * one repeated trajectory is evidence.
 *
 * `count` distinct trajectories, and not approximately: `countGames` reports
 * `count` distinct for every size this suite asks for. That was not true until
 * `mtg-pixl` — it saturated at 17 — and the sentence above was a promise the
 * helper was not keeping, silently, at exactly the sizes a gate needs to be
 * decidable.
 */
export function distinctGames(count: number, spec: FakeGameSpec): readonly SimGameLog[] {
  return Array.from({ length: count }, (_unused, index) => fakeLog({ ...spec, index, variant: index }));
}

/** `count` byte-identical games: the sample illusion, on purpose. */
export function repeatedGame(count: number, spec: FakeGameSpec): readonly SimGameLog[] {
  const log = fakeLog(spec);
  return Array.from({ length: count }, () => log);
}

/**
 * What a matchup varies from one game to the next, on top of its own spec.
 *
 * A matchup deals one trajectory `count` times and moves only the life lines,
 * which `lifeLine` now makes distinct per game; a matchup of a thousand is a
 * thousand trajectories. What it does not move is the *shape* of the play — the
 * turn count, the inert turns, the land schedules are one spec for the whole
 * matchup, so every game reaches the same board on the same turn. This is the
 * dial for that: anything the fingerprint reads, moved per game rather than per
 * matchup, when a fixture wants games that differ in more than how much life
 * was left.
 *
 * It exists because the life perturbation used to cycle on 17, which capped a
 * matchup at about 68 trajectories however large `count` got and made a run of
 * thousands a few dozen trajectories wearing a large number (`mtg-ijl6`). That
 * ceiling is gone (`mtg-pixl`); the hook is still the honest way to vary a game
 * in a way that a life total cannot express.
 */
export type PerGameSpec = (
  index: number,
) => Omit<Partial<FakeGameSpec>, 'userColors' | 'oppoColors' | 'winner' | 'onPlay' | 'index' | 'variant'>;

/**
 * A matchup: `count` games between two color pairs, with `winsForUser` of them
 * won by the seat-0 deck and the play/draw seat alternating as the runner does.
 */
export function matchup(
  userColors: string,
  oppoColors: string,
  count: number,
  winsForUser: number,
  spec: Omit<FakeGameSpec, 'userColors' | 'oppoColors' | 'winner' | 'onPlay' | 'index'> = {
    playerTurns: 16,
  },
  perGame?: PerGameSpec,
): readonly SimGameLog[] {
  return Array.from({ length: count }, (_unused, index) =>
    fakeLog({
      ...spec,
      ...(perGame === undefined ? {} : perGame(index)),
      index,
      userColors,
      oppoColors,
      winner: index < winsForUser ? 0 : 1,
      onPlay: index % 2 === 0 ? 0 : 1,
      variant: index,
    }),
  );
}
