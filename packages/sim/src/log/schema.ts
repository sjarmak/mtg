/**
 * The self-play log schema: a superset of the 17lands *replay* dataset.
 *
 * The load-bearing decision (`docs/research/prior-art-playability-metrics.md`
 * §2.4, §9): emit our columns under 17lands' own names so calibrating bot play
 * against human play is a join, not a mapping layer. Every column below is
 * either a verbatim 17lands replay column or is prefixed `sim_` to mark it as
 * ours. Nothing 17lands publishes is renamed, and nothing of ours squats on a
 * name they might use.
 *
 * Their wide layout is reproduced exactly:
 *
 *   `{owner}_turn_{N}_{field}`            — the turn owner's own actions
 *   `{owner}_turn_{N}_{side}_{field}`     — a stat attributed to one side
 *   `{owner}_turn_{N}_eot_{side}_{field}` — end-of-turn board state per side
 *
 * where `owner`/`side` are `user` (seat 0) and `oppo` (seat 1). The structured
 * `SimGameLog` below is the in-memory form; `replayRow` in `./row` flattens it
 * into the wide row that goes to JSONL.
 *
 * That layout puts the coordinates ahead of the field name, so a column of ours
 * inside one of those families carries its `sim_` marker where the field sits
 * rather than at the front of the string: `user_turn_3_oppo_sim_triggers`. The
 * marker is what the policy is for and it still does its job there — 17lands
 * publishes no name containing `sim_` anywhere — but it means `startsWith`
 * is not the test for "ours". `joinContract` in `@mtg/metrics` filters the
 * shared field lists on the field name for that reason, so the contract never
 * tells a reader to look for one of our columns in their CSV.
 *
 * Columns that exist in 17lands but that this pipeline cannot produce are
 * emitted as zero rather than omitted, so the join stays total. One is left:
 * `cards_tutored`, because the DSL has no tutor primitive.
 *
 * `abilities` was on that list and is not any more. CR 602 activated abilities
 * are printable, playable and paid for by the bots, and `collect.ts` counts one
 * per `abilityActivated` event, so a zero in this column now means the seat
 * activated nothing rather than that nothing could be activated. What it still
 * excludes is what 17lands excludes: a land's intrinsic mana ability, which
 * uses no stack (CR 605.1) and emits no such event.
 *
 * `sim_triggers` is the other half of that, and it is ours because 17lands has
 * no column for it. CR 603 triggered abilities go on the stack without anybody
 * choosing to put them there, so no 17lands column counts one and none of
 * theirs can be stretched to; `collect.ts` counts one per `abilityTriggered`.
 * Keeping it beside `abilities` rather than folded into it is the whole point:
 * an activation is a bot decision and a trigger is not, so a pool whose
 * activations are dead and whose triggers fire constantly reads as two
 * different numbers instead of one healthy-looking sum.
 */
import { z } from 'zod';

/** Bump on any change to column names or semantics. */
export const SIM_LOG_SCHEMA_VERSION = 'mtg-sim/replay-superset/2';

/** Seat labels, matching 17lands' perspective columns. Seat 0 is always `user`. */
export const SIDES = ['user', 'oppo'] as const;
export type Side = (typeof SIDES)[number];

/** The 18 game-metadata columns shared by the 17lands game and replay datasets. */
export const REPLAY_GAME_COLUMNS = [
  'expansion',
  'event_type',
  'draft_id',
  'draft_time',
  'game_time',
  'build_index',
  'match_number',
  'game_number',
  'rank',
  'opp_rank',
  'main_colors',
  'splash_colors',
  'on_play',
  'num_mulligans',
  'opp_num_mulligans',
  'opp_colors',
  'num_turns',
  'won',
] as const;

/** Per-game totals, emitted for both sides as `{side}_total_{field}`. */
export const REPLAY_TOTAL_FIELDS = [
  'cards_drawn',
  'cards_tutored',
  'cards_discarded',
  'lands_played',
  'creatures_cast',
  'non_creatures_cast',
  'instants_sorceries_cast',
  'mana_spent',
] as const;

/** Per-turn fields belonging to whoever's turn it is. */
export const TURN_OWNER_FIELDS = [
  'cards_drawn',
  'cards_tutored',
  'cards_discarded',
  'lands_played',
  'creatures_cast',
  'non_creatures_cast',
  'creatures_attacked',
  'creatures_blocked',
  'creatures_unblocked',
  'creatures_blocking',
] as const;

/**
 * Per-turn fields attributed to a specific side. `sim_`-marked entries are ours
 * and have no 17lands counterpart; everything else is theirs, verbatim.
 */
export const TURN_SIDE_FIELDS = [
  'instants_sorceries_cast',
  'abilities',
  'combat_damage_taken',
  'creatures_killed_combat',
  'creatures_killed_non_combat',
  'mana_spent',
  'sim_triggers',
] as const;

/** End-of-turn board state, per side. */
export const TURN_SIDE_EOT_FIELDS = [
  'cards_in_hand',
  'lands_in_play',
  'creatures_in_play',
  'non_creatures_in_play',
  'life',
] as const;

export type TurnOwnerField = (typeof TURN_OWNER_FIELDS)[number];
export type TurnSideField = (typeof TURN_SIDE_FIELDS)[number];
export type TurnSideEotField = (typeof TURN_SIDE_EOT_FIELDS)[number];

export function ownerColumn(owner: Side, turn: number, field: TurnOwnerField): string {
  return `${owner}_turn_${turn}_${field}`;
}

export function sideColumn(owner: Side, turn: number, side: Side, field: TurnSideField): string {
  return `${owner}_turn_${turn}_${side}_${field}`;
}

export function eotColumn(owner: Side, turn: number, side: Side, field: TurnSideEotField): string {
  return `${owner}_turn_${turn}_eot_${side}_${field}`;
}

export function totalColumn(side: Side, field: (typeof REPLAY_TOTAL_FIELDS)[number]): string {
  return `${side}_total_${field}`;
}

const counter = z.number().int().min(0);

export const SideTurnStatsSchema = z.object({
  instants_sorceries_cast: counter,
  abilities: counter,
  combat_damage_taken: counter,
  creatures_killed_combat: counter,
  creatures_killed_non_combat: counter,
  mana_spent: counter,
  sim_triggers: counter,
  eot_cards_in_hand: counter,
  eot_lands_in_play: counter,
  eot_creatures_in_play: counter,
  eot_non_creatures_in_play: counter,
  eot_life: z.number().int(),
});

export type SideTurnStats = z.infer<typeof SideTurnStatsSchema>;

export const TurnRecordSchema = z.object({
  turn: z.number().int().min(1),
  owner: z.enum(SIDES),
  cards_drawn: counter,
  cards_tutored: counter,
  cards_discarded: counter,
  lands_played: counter,
  creatures_cast: counter,
  non_creatures_cast: counter,
  creatures_attacked: counter,
  creatures_blocked: counter,
  creatures_unblocked: counter,
  creatures_blocking: counter,
  user: SideTurnStatsSchema,
  oppo: SideTurnStatsSchema,
});

export type TurnRecord = z.infer<typeof TurnRecordSchema>;

export const SideTotalsSchema = z.object({
  cards_drawn: counter,
  cards_tutored: counter,
  cards_discarded: counter,
  lands_played: counter,
  creatures_cast: counter,
  non_creatures_cast: counter,
  instants_sorceries_cast: counter,
  mana_spent: counter,
});

export type SideTotals = z.infer<typeof SideTotalsSchema>;

export const GameMetadataSchema = z.object({
  expansion: z.string(),
  event_type: z.string(),
  draft_id: z.string(),
  draft_time: z.string(),
  game_time: z.string(),
  build_index: z.number().int(),
  match_number: z.number().int(),
  game_number: z.number().int(),
  rank: z.string(),
  opp_rank: z.string(),
  main_colors: z.string(),
  splash_colors: z.string(),
  on_play: z.union([z.literal(0), z.literal(1)]),
  num_mulligans: counter,
  opp_num_mulligans: counter,
  opp_colors: z.string(),
  num_turns: counter,
  won: z.union([z.literal(0), z.literal(1)]),
});

export type GameMetadata = z.infer<typeof GameMetadataSchema>;

/** Our own columns, all `sim_`-prefixed so they can never collide with 17lands'. */
export const SimExtrasSchema = z.object({
  sim_schema_version: z.string(),
  sim_run_seed: z.string(),
  sim_game_seed: z.string(),
  sim_game_index: z.number().int().min(0),
  sim_user_deck: z.string(),
  sim_oppo_deck: z.string(),
  sim_user_bot: z.string(),
  sim_oppo_bot: z.string(),
  sim_winner: z.union([z.literal(0), z.literal(1), z.null()]),
  sim_end_reason: z.enum(['lifeZero', 'emptyLibrary', 'concede', 'turnLimit']),
  sim_decisions: z.number().int().min(0),
});

export type SimExtras = z.infer<typeof SimExtrasSchema>;

export const SimGameLogSchema = z.object({
  metadata: GameMetadataSchema,
  extras: SimExtrasSchema,
  totals: z.object({ user: SideTotalsSchema, oppo: SideTotalsSchema }),
  turns: z.array(TurnRecordSchema),
});

export type SimGameLog = z.infer<typeof SimGameLogSchema>;

/** Values a flattened replay row can hold; JSON-safe by construction. */
export type ReplayValue = string | number | null;
export type ReplayRow = Readonly<Record<string, ReplayValue>>;

export function emptySideTurnStats(): SideTurnStats {
  return {
    instants_sorceries_cast: 0,
    abilities: 0,
    combat_damage_taken: 0,
    creatures_killed_combat: 0,
    creatures_killed_non_combat: 0,
    mana_spent: 0,
    sim_triggers: 0,
    eot_cards_in_hand: 0,
    eot_lands_in_play: 0,
    eot_creatures_in_play: 0,
    eot_non_creatures_in_play: 0,
    eot_life: 0,
  };
}

export function emptySideTotals(): SideTotals {
  return {
    cards_drawn: 0,
    cards_tutored: 0,
    cards_discarded: 0,
    lands_played: 0,
    creatures_cast: 0,
    non_creatures_cast: 0,
    instants_sorceries_cast: 0,
    mana_spent: 0,
  };
}
