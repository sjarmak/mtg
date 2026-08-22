/**
 * Land-drop policy.
 *
 * Two questions: should we spend the turn's land drop at all, and which land.
 * The first is a curve question (keep making drops while anything in hand is
 * still out of reach); the second is a color-screw question (play the land
 * that unlocks the most uncastable pips in hand).
 */
import type { Color } from '@mtg/dsl';
import { cardManaValue, COLORS } from '@mtg/dsl';
import type { Action, GameState, PlayerId } from '@mtg/kernel';
import { getObject, landsControlledBy } from '@mtg/kernel';
import type { LandPolicyConfig } from '../config';

type PlayLandAction = Extract<Action, { type: 'playLand' }>;

/** Colored pips in hand that the lands already in play cannot produce. */
function missingPips(state: GameState, player: PlayerId): Readonly<Record<Color, number>> {
  const producible = new Set<Color>();
  for (const land of landsControlledBy(state, player)) {
    if (land.card.kind !== 'land') continue;
    for (const color of land.card.producesMana) {
      if (color !== 'C') producible.add(color);
    }
  }
  const missing: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const oid of state.players[player].hand) {
    const card = getObject(state, oid).card;
    if (card.kind === 'land') continue;
    for (const color of COLORS) {
      if (card.manaCost[color] > 0 && !producible.has(color)) missing[color] += card.manaCost[color];
    }
  }
  return missing;
}

/** True when something in hand still costs more than the lands we control. */
function hasUncastableCard(state: GameState, player: PlayerId, lands: number): boolean {
  for (const oid of state.players[player].hand) {
    const card = getObject(state, oid).card;
    if (card.kind === 'land') continue;
    if (cardManaValue(card) > lands) return true;
  }
  return false;
}

/**
 * Picks the land drop to make, or `null` to skip it.
 *
 * Skipping matters: at saturation, holding a land keeps a card in hand rather
 * than converting it into a dead permanent, and the discard policy will pitch
 * it if the hand overflows.
 */
export function chooseLandDrop(
  state: GameState,
  player: PlayerId,
  options: readonly PlayLandAction[],
  config: LandPolicyConfig,
): PlayLandAction | null {
  const first = options[0];
  if (first === undefined) return null;

  const lands = landsControlledBy(state, player).length;
  const below = lands < config.saturationLands;
  const climbing = config.keepDroppingForUncastables && hasUncastableCard(state, player, lands);
  const overflowing = state.players[player].hand.length > state.config.maximumHandSize;
  if (!below && !climbing && !overflowing) return null;

  const missing = missingPips(state, player);
  let best = first;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const option of options) {
    const card = getObject(state, option.oid).card;
    if (card.kind !== 'land') continue;
    let score = 0;
    for (const color of card.producesMana) {
      if (color !== 'C') score += missing[color] * config.colorNeedWeight;
    }
    if (score > bestScore) {
      bestScore = score;
      best = option;
    }
  }
  return best;
}
