/**
 * The shape of a card's flavor text.
 *
 * Flavor text is the one string on a DSL card that is authored prose rather than
 * derived from structure, so the schema can bound its length and this is where
 * the rest of "is this a piece of flavor text" is said. The bound itself is
 * `FLAVOR_TEXT_MAX_LENGTH` in `../vocabulary.ts`, which carries the two
 * measurements it was chosen from; `FLAVOR_TEXT_FORBIDDEN` beside it carries
 * why a line break and a brace are refused.
 *
 * A card with no flavor text produces nothing here. That is the ordinary case
 * and every set committed to this repository is in it.
 */
import type { Card } from '../card';
import { FLAVOR_TEXT_FORBIDDEN } from '../vocabulary';
import type { Violation } from '../violations';
import { violation } from '../violations';

export function checkFlavorText(card: Card): Violation[] {
  const flavor = card.flavorText;
  if (flavor === undefined) return [];
  if (flavor.trim().length === 0) {
    return [violation('FLAVOR_TEXT_INVALID', 'flavorText', 'flavor text is blank; omit the field instead')];
  }
  if (flavor !== flavor.trim()) {
    return [
      violation(
        'FLAVOR_TEXT_INVALID',
        'flavorText',
        'flavor text carries leading or trailing whitespace, which a face would print as an indent',
      ),
    ];
  }
  if (FLAVOR_TEXT_FORBIDDEN.test(flavor)) {
    return [
      violation(
        'FLAVOR_TEXT_INVALID',
        'flavorText',
        'flavor text must be one paragraph of prose with no line break and no brace token',
      ),
    ];
  }
  return [];
}
