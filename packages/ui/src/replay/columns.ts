/**
 * The replay column grammar, mirrored from `@mtg/sim`'s log schema.
 *
 * Why a mirror instead of an import: `@mtg/sim`'s entry point pulls in the
 * runner, which pulls in `node:worker_threads` and `node:fs`. This package is
 * bundled for a browser, so it imports only *types* from `@mtg/sim` (erased at
 * build time) and restates the column names here. The duplication is deliberate
 * and it is not on the honor system — `test/replay-contract.test.ts` imports
 * `@mtg/sim` for real, in Node, and fails if a single field name, column
 * spelling or the schema version drifts apart.
 */

export const REPLAY_SCHEMA_VERSION = 'mtg-sim/replay-superset/2';

export const SIDES = ['user', 'oppo'] as const;
export type ReplaySide = (typeof SIDES)[number];

export const GAME_COLUMNS = [
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

export const TOTAL_FIELDS = [
  'cards_drawn',
  'cards_tutored',
  'cards_discarded',
  'lands_played',
  'creatures_cast',
  'non_creatures_cast',
  'instants_sorceries_cast',
  'mana_spent',
] as const;

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

export const TURN_SIDE_FIELDS = [
  'instants_sorceries_cast',
  'abilities',
  'combat_damage_taken',
  'creatures_killed_combat',
  'creatures_killed_non_combat',
  'mana_spent',
  'sim_triggers',
] as const;

export const TURN_SIDE_EOT_FIELDS = [
  'cards_in_hand',
  'lands_in_play',
  'creatures_in_play',
  'non_creatures_in_play',
  'life',
] as const;

export const EXTRA_STRING_FIELDS = [
  'sim_schema_version',
  'sim_run_seed',
  'sim_game_seed',
  'sim_user_deck',
  'sim_oppo_deck',
  'sim_user_bot',
  'sim_oppo_bot',
] as const;

export const END_REASONS = ['lifeZero', 'emptyLibrary', 'concede', 'turnLimit'] as const;
export type EndReason = (typeof END_REASONS)[number];

export type TurnOwnerField = (typeof TURN_OWNER_FIELDS)[number];
export type TurnSideField = (typeof TURN_SIDE_FIELDS)[number];
export type TurnSideEotField = (typeof TURN_SIDE_EOT_FIELDS)[number];
export type TotalField = (typeof TOTAL_FIELDS)[number];

export function ownerColumn(owner: ReplaySide, turn: number, field: TurnOwnerField): string {
  return `${owner}_turn_${turn}_${field}`;
}

export function sideColumn(owner: ReplaySide, turn: number, side: ReplaySide, field: TurnSideField): string {
  return `${owner}_turn_${turn}_${side}_${field}`;
}

export function eotColumn(
  owner: ReplaySide,
  turn: number,
  side: ReplaySide,
  field: TurnSideEotField,
): string {
  return `${owner}_turn_${turn}_eot_${side}_${field}`;
}

export function totalColumn(side: ReplaySide, field: TotalField): string {
  return `${side}_total_${field}`;
}

/** The seat opposite `side`. */
export function otherSide(side: ReplaySide): ReplaySide {
  return side === 'user' ? 'oppo' : 'user';
}
