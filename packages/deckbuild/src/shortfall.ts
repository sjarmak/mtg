/**
 * Shortfalls: the ways a pool can fail to support a well-shaped deck.
 *
 * A pool that cannot fill the curve, reach the creature floor, or support a
 * color must never produce a silently mis-shaped deck. Every gap is reported
 * as a structured record so callers (the slice CLI, the metrics gate) can
 * assert on it instead of eyeballing a decklist.
 */
import type { Color } from '@mtg/dsl';
import { assertNever } from '@mtg/dsl';
import type { CurveBucket } from './curve-bucket';
import { curveBucketLabel } from './curve-bucket';

export type Shortfall =
  /** The pool had fewer playable non-land cards than the deck needs. */
  | {
      readonly kind: 'spellSlots';
      readonly target: number;
      readonly achieved: number;
      readonly missing: number;
    }
  /** A curve bucket could not be filled to its target from the playable pool. */
  | {
      readonly kind: 'curveSlot';
      readonly bucket: CurveBucket;
      readonly target: number;
      readonly achieved: number;
      readonly missing: number;
    }
  /** The deck ended below the configured creature floor. */
  | {
      readonly kind: 'creatureFloor';
      readonly target: number;
      readonly achieved: number;
      readonly missing: number;
    }
  /** A color carrying real pip demand ended below its minimum source count. */
  | {
      readonly kind: 'colorSources';
      readonly color: Color;
      readonly target: number;
      readonly achieved: number;
      readonly missing: number;
    };

export type ShortfallKind = Shortfall['kind'];

/** True when the deck is a legal, on-shape deck: no gaps of any kind. */
export function isComplete(shortfalls: readonly Shortfall[]): boolean {
  return shortfalls.length === 0;
}

export function hasShortfall(shortfalls: readonly Shortfall[], kind: ShortfallKind): boolean {
  return shortfalls.some((shortfall) => shortfall.kind === kind);
}

export function formatShortfall(shortfall: Shortfall): string {
  switch (shortfall.kind) {
    case 'spellSlots':
      return `spell slots: ${shortfall.achieved}/${shortfall.target} filled (${shortfall.missing} short)`;
    case 'curveSlot':
      return `curve MV ${curveBucketLabel(shortfall.bucket)}: ${shortfall.achieved}/${shortfall.target} filled (${shortfall.missing} short)`;
    case 'creatureFloor':
      return `creatures: ${shortfall.achieved}/${shortfall.target} (${shortfall.missing} short of the floor)`;
    case 'colorSources':
      return `${shortfall.color} sources: ${shortfall.achieved}/${shortfall.target} (${shortfall.missing} short)`;
    default:
      return assertNever(shortfall, 'formatShortfall');
  }
}

export function formatShortfalls(shortfalls: readonly Shortfall[]): string {
  if (shortfalls.length === 0) return 'none';
  return shortfalls.map(formatShortfall).join('; ');
}
