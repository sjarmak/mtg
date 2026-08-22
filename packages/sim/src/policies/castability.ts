/**
 * Can this hand cast one of its own spells, from its own lands, on curve?
 *
 * The mulligan policy's land band cannot see colors: two Mountains in a blue
 * deck is a two-land hand and passes. This module is the term that reads them.
 * It is deliberately a hand-only question — no library, no draws, no scry — so
 * it answers what a human answers looking at seven cards: is there a line here.
 *
 * "On curve" means by a stated turn: the hand plays one land per turn, so with
 * `landsIn(hand)` lands the mana available on turn `t` is `min(t, lands)`, and
 * the hand is live when some nonland card in it costs no more than that and its
 * colored pips can be paid by lands the hand actually holds. Which lands get
 * played is ours to choose, so the pips are matched against any subset — a
 * bipartite matching, not a greedy scan, because a hand holding one dual and
 * one basic can pay `{W}{U}` exactly one way.
 *
 * `{X}` is priced at zero (CR 707.3: X is 0 anywhere but the stack), which is
 * the right reading for a card sitting in an opening hand.
 */
import type { Card, Color, ManaColor, ManaCost } from '@mtg/dsl';
import { COLORS, manaValue } from '@mtg/dsl';

/** The colors each land in a hand can produce; one entry per land card. */
export type LandSources = readonly ReadonlySet<ManaColor>[];

export function landSourcesOf(cards: readonly Card[]): LandSources {
  const sources: ReadonlySet<ManaColor>[] = [];
  for (const card of cards) {
    if (card.kind === 'land') sources.push(new Set(card.producesMana));
  }
  return sources;
}

/** The colored pips of a cost, one entry per pip. */
function pipsOf(cost: ManaCost): readonly Color[] {
  const pips: Color[] = [];
  for (const color of COLORS) {
    for (let index = 0; index < cost[color]; index += 1) pips.push(color);
  }
  return pips;
}

/**
 * True when `pips` can each be assigned a distinct land that produces them.
 *
 * Augmenting-path matching rather than a greedy pass: a hand is at most seven
 * cards and a cost at most a handful of pips, so the exact answer is cheap and
 * the greedy one is wrong on the hands that matter.
 */
function pipsMatchable(pips: readonly Color[], sources: LandSources): boolean {
  const assignedTo: (number | null)[] = sources.map(() => null);
  const augment = (pip: number, seen: boolean[]): boolean => {
    const color = pips[pip];
    if (color === undefined) return false;
    for (let land = 0; land < sources.length; land += 1) {
      if (seen[land] === true) continue;
      if (sources[land]?.has(color) !== true) continue;
      seen[land] = true;
      const held = assignedTo[land];
      if (held === null || held === undefined || augment(held, seen)) {
        assignedTo[land] = pip;
        return true;
      }
    }
    return false;
  };
  for (let pip = 0; pip < pips.length; pip += 1) {
    if (
      !augment(
        pip,
        sources.map(() => false),
      )
    )
      return false;
  }
  return true;
}

/** True when `cost` is payable from `available` of these lands. */
export function costPayable(cost: ManaCost, sources: LandSources, available: number): boolean {
  const value = manaValue(cost);
  if (value > available) return false;
  const pips = pipsOf(cost);
  // Only `available` lands will have been played, so the pips have to fit in
  // that many; the rest of the cost is generic and any land pays it.
  if (pips.length > available) return false;
  return pipsMatchable(pips, sources);
}

export interface CastabilityReading {
  /** Lands in the hand. */
  readonly lands: number;
  /** Some spell in the hand is castable from the hand's lands by the stated turn. */
  readonly castable: boolean;
  /**
   * Some spell is cheap enough for the mana the hand would have, but no
   * assignment of the hand's lands pays its pips. This is color screw as
   * distinct from land screw, and it is the share the land band cannot see.
   */
  readonly colorBlocked: boolean;
}

/** Reads a hand for the castability term, by the stated turn. */
export function readCastability(cards: readonly Card[], byTurn: number): CastabilityReading {
  const sources = landSourcesOf(cards);
  const available = Math.min(byTurn, sources.length);
  let castable = false;
  let affordable = false;
  for (const card of cards) {
    if (card.kind === 'land' || !('manaCost' in card)) continue;
    if (manaValue(card.manaCost) <= available) affordable = true;
    if (costPayable(card.manaCost, sources, available)) {
      castable = true;
      break;
    }
  }
  return { lands: sources.length, castable, colorBlocked: !castable && affordable };
}
