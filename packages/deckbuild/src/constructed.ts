/**
 * What makes a deck legal in Constructed, as opposed to Limited.
 *
 * Two rules, and they are the whole difference at this layer. A deck is sixty
 * cards rather than forty (CR 100.2a), and it plays at most four copies of any
 * one card by name, with Basic lands exempt (CR 100.2a again, and CR 100.4 for
 * the exemption).
 *
 * Both live here rather than in `build-manual.ts` because Limited must not
 * inherit them. A sealed pool opens the same common three times and playing all
 * three is the format working correctly, so the copy limit is `null` by default
 * and `buildFromSpells` reports no excess for a pool builder that never asked
 * for one. That is the same shape as the mana base: the arithmetic is here, the
 * decision is the caller's.
 *
 * The curve is the part that is a guess rather than a rule. `resolveConfig`
 * requires `targetCurve` to sum to the spell count, so a sixty-card config
 * cannot reuse Limited's twenty-three-card curve and there is no printed
 * authority for what a Constructed curve should be. What is here is Limited's
 * shape scaled to thirty-six spells and shifted one notch cheaper, because a
 * Constructed deck is faster than a Limited one. It is a starting point for a
 * suggestion a person is expected to overrule, and nothing in the legality
 * check reads it: an off-curve sixty-card deck is legal and this module says so.
 */
import type { Card } from '@mtg/dsl';
import { isBasicLand } from '@mtg/dsl';
import type { DeckBuildConfigInput } from './config';
import type { CurveHistogram } from './curve-bucket';

/** CR 100.2a: sixty cards, and the deck size every Constructed format shares. */
export const CONSTRUCTED_DECK_SIZE = 60;

/** CR 100.2a: at most four of any card that is not a Basic land. */
export const CONSTRUCTED_COPY_LIMIT = 4;

/**
 * A land count rather than a land rule: twenty-four is the conventional
 * starting point for a sixty-card deck, and it is a suggestion the builder
 * counts up or down like any other.
 */
export const CONSTRUCTED_LAND_COUNT = 24;

/**
 * Limited's curve at sixty cards, one notch cheaper. Sums to 36, which is what
 * `resolveConfig` demands of a deck of `CONSTRUCTED_DECK_SIZE` with
 * `CONSTRUCTED_LAND_COUNT` lands.
 */
export const CONSTRUCTED_TARGET_CURVE: CurveHistogram = { 0: 0, 1: 7, 2: 11, 3: 8, 4: 5, 5: 3, 6: 2 };

/**
 * The config a Constructed builder starts from. Every field is overridable,
 * because a format that wants a different deck size or no copy limit at all is
 * a caller with a different `DeckBuildConfigInput`, not a fork of this module.
 */
export function constructedConfig(input: DeckBuildConfigInput = {}): DeckBuildConfigInput {
  return {
    deckSize: CONSTRUCTED_DECK_SIZE,
    landCount: CONSTRUCTED_LAND_COUNT,
    targetCurve: { ...CONSTRUCTED_TARGET_CURVE },
    minCreatures: 0,
    copyLimit: CONSTRUCTED_COPY_LIMIT,
    ...input,
  };
}

/**
 * One card played more times than the limit allows.
 *
 * Named rather than identified by card, because the rule is about names: two
 * printings of one card in two sets are four copies between them, and a deck
 * playing three of each is illegal however many distinct ids it holds.
 */
export interface CopyExcess {
  readonly name: string;
  readonly limit: number;
  readonly played: number;
}

/**
 * Every card played over the limit, by name, in the order the deck first plays
 * them so a report reads in deck order rather than alphabetically.
 *
 * A `null` limit is no limit and returns nothing, which is Limited.
 */
export function copyExcesses(cards: readonly Card[], limit: number | null): readonly CopyExcess[] {
  if (limit === null) return [];
  const counts = new Map<string, number>();
  for (const card of cards) {
    if (isBasicLand(card)) continue;
    counts.set(card.name, (counts.get(card.name) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, played]) => played > limit)
    .map(([name, played]) => ({ name, limit, played }));
}

export function formatCopyExcess(excess: CopyExcess): string {
  return `${excess.name}: ${String(excess.played)} copies, ${String(excess.limit)} allowed`;
}
