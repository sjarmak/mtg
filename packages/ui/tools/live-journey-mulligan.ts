/**
 * The London-mulligan keep rule the live journey's Forge seat applies to every
 * opening hand: mulligan a hand holding fewer than three lands, bounded to two
 * mulligans so a mana-screwed run cannot loop forever (`mtg-43j03` -- a kept
 * seven that never reaches four lands fails the Commander journey's cast step
 * on luck, not a real defect).
 *
 * `OPEN_AND_KEEP`'s in-page script in `live-journey.ts` embeds `MIN_LANDS_TO_KEEP`
 * and `MAX_MULLIGANS` by value and `LAND_TYPE_LINE_SOURCE` by its regex source,
 * so the browser-evaluated rule and this tested one never drift apart.
 */

/** A hand holding fewer lands than this still short of a keep takes another mulligan. */
export const MIN_LANDS_TO_KEEP = 3;

/** A run stops mulliganing after this many and keeps whatever hand remains. */
export const MAX_MULLIGANS = 2;

/**
 * The word a hand card's accessible label ('Name. <type line>. ...') carries in
 * its type line when the card is a land. Matched after the name is cut off, so
 * a card named e.g. Land Tax does not match itself through its own name.
 */
export const LAND_TYPE_LINE_SOURCE = '\\bLand\\b';

const LAND_TYPE_LINE = new RegExp(LAND_TYPE_LINE_SOURCE);

/** Whether a hand card's accessible label names a land, by its type line. */
export function isLandLabel(cardLabel: string): boolean {
  const cut = cardLabel.indexOf('. ');
  return LAND_TYPE_LINE.test(cut === -1 ? cardLabel : cardLabel.slice(cut + 2));
}

/** How many lands a hand of accessible labels holds. */
export function landCount(handLabels: readonly string[]): number {
  return handLabels.filter(isLandLabel).length;
}

/**
 * Whether a hand takes another mulligan: only while it is short of
 * `MIN_LANDS_TO_KEEP` lands, and never past `MAX_MULLIGANS` already taken.
 */
export function shouldMulligan(handLabels: readonly string[], mulligansTaken: number): boolean {
  return landCount(handLabels) < MIN_LANDS_TO_KEEP && mulligansTaken < MAX_MULLIGANS;
}
