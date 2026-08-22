/**
 * Identity primitives.
 *
 * The slice is strictly two-player, so `PlayerId` is a literal union rather
 * than an open index: every `switch` over players is exhaustive, and the
 * `players` tuple in `GameState` is length-checked by the type system.
 */

export type PlayerId = 0 | 1;

export const PLAYER_IDS: readonly PlayerId[] = [0, 1];

export function opponentOf(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

/** Every game object (card, token, stack object) carries one of these. */
export type ObjectId = string;

/** Object ids are `o<n>` with `n` drawn from the state's monotonic counter. */
export function objectId(counter: number): ObjectId {
  return `o${counter}`;
}

/**
 * A triggered ability on the stack is an object without a card (CR 113.7a), so
 * it needs an id of its own: `ab<n>`, from the same counter, and visibly not a
 * card's. A log line naming `ab7` is naming an ability.
 */
export function abilityObjectId(counter: number): ObjectId {
  return `ab${counter}`;
}

/** A copied spell is a stack object without a card in a zone: `cp<n>`. */
export function copiedSpellObjectId(counter: number): ObjectId {
  return `cp${counter}`;
}

/** Continuous-effect ids are `ce<n>` from the same counter, so they never collide. */
export function continuousEffectId(counter: number): string {
  return `ce${counter}`;
}

/** Cost-modifier ids are `cm<n>` from the same counter, so they never collide. */
export function costModifierId(counter: number): string {
  return `cm${counter}`;
}

/** Prevention-shield ids are `pv<n>` from the same counter. */
export function preventionEffectId(counter: number): string {
  return `pv${counter}`;
}

/**
 * Static-replacement ids are `sr<n>` from the same counter.
 *
 * The fourth prefix over the one counter, for the reason the third was: a
 * replacement effect registered by a printed static ability lives in
 * `state.replacements` beside ids minted by hand elsewhere
 * (`intrinsic:<oid>:entry` in `zones.ts`, `protection:<src>:<oid>` in
 * `damage.ts`, the regeneration shield in `destruction.ts`), and `applied` in
 * `applyReplacements` is keyed by id, so two effects sharing one would apply
 * as one. A counter-derived prefix cannot collide with any of those and
 * cannot collide with a second copy of the same card, which a
 * `sourceOid`-derived id could once a permanent left and re-entered.
 */
export function staticReplacementId(counter: number): string {
  return `sr${counter}`;
}
