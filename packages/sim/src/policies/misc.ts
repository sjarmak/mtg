/**
 * The two small decisions: damage-assignment order and cleanup discard.
 */
import { cardManaValue } from '@mtg/dsl';
import type { Block, BlockerOrdering, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import { availableMana, getObject, hasKeyword, lethalDamageFor } from '@mtg/kernel';
import type { DiscardPolicyConfig } from '../config';

/**
 * Damage-assignment order: cheapest kill first.
 *
 * The attacker assigns lethal damage down the list, so ordering blockers by
 * ascending lethal requirement maximizes how many of them die. Deathtouch
 * collapses every requirement to 1, which the kernel's `lethalDamageFor`
 * already reflects.
 */
export function chooseBlockerOrder(state: GameState, blocks: readonly Block[]): readonly BlockerOrdering[] {
  return blocks.map((block) => {
    const deathtouch = hasKeyword(state, block.attacker, 'deathtouch');
    const blockers = [...block.blockers].sort(
      (a, b) => lethalDamageFor(state, a, deathtouch) - lethalDamageFor(state, b, deathtouch),
    );
    return { attacker: block.attacker, blockers };
  });
}

/** The most expensive thing in hand; what the land count is still climbing toward. */
function highestCostInHand(state: GameState, hand: readonly ObjectId[]): number {
  let highest = 0;
  for (const oid of hand) {
    const card = getObject(state, oid).card;
    if (card.kind === 'land') continue;
    highest = Math.max(highest, cardManaValue(card));
  }
  return highest;
}

/**
 * Keep value of a card in hand at cleanup. A spell is worth its mana value,
 * discounted hard by how far out of reach it still is, so a stranded bomb goes
 * before a castable cheap card. A land is worth keeping while the hand still
 * has something we cannot pay for, and close to nothing once it does not.
 */
function keepValue(
  state: GameState,
  player: PlayerId,
  oid: ObjectId,
  hand: readonly ObjectId[],
  config: DiscardPolicyConfig,
): number {
  const card = getObject(state, oid).card;
  const reach = availableMana(state, player);
  if (card.kind === 'land') {
    return highestCostInHand(state, hand) > reach ? config.landKeepValue : config.surplusLandKeepValue;
  }
  const cost = cardManaValue(card);
  const shortfall = Math.max(0, cost - reach);
  return cost - shortfall * config.uncastablePenalty;
}

/** The `count` least valuable cards in hand, deterministically ordered. */
export function chooseDiscards(
  state: GameState,
  player: PlayerId,
  hand: readonly ObjectId[],
  count: number,
  config: DiscardPolicyConfig,
): readonly ObjectId[] {
  if (count <= 0) return [];
  const ranked = [...hand].sort((a, b) => {
    const delta = keepValue(state, player, a, hand, config) - keepValue(state, player, b, hand, config);
    return delta !== 0 ? delta : a.localeCompare(b);
  });
  return ranked.slice(0, count);
}
