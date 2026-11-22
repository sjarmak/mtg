/**
 * Refuse generated cards that the fixed hover zoom cannot display whole.
 *
 * The capacity is a measured UI geometry fact hosted by `@mtg/card-geometry`;
 * this module supplies the generation policy. Keeping those two concerns
 * separate is what leaves imported compatibility alone: `parseCard` and
 * `parseSetFile` validate runnable DSL, while only a card being admitted into a
 * newly generated set is held to the largest reading surface the UI provides.
 */
import { zoomRulesCharacterCapacity } from '@mtg/card-geometry';
import { renderOracleText } from '@mtg/dsl';
import type { Entry } from './composition';
import type { SetFinding } from './findings';
import { finding } from './findings';

export { ZOOM_RULES_CHARACTER_CAPACITY } from '@mtg/card-geometry';

/** One error per generated card beyond its face shape's measured boundary. */
export function checkZoomCapacity(entries: readonly Entry[]): readonly SetFinding[] {
  return entries.flatMap(({ slot, card }) => {
    const characters = renderOracleText(card).length;
    const capacity = zoomRulesCharacterCapacity(card);
    if (characters <= capacity) return [];

    return [
      finding(
        'ZOOM_TEXT_OVERFLOW',
        'error',
        `the generated card "${card.name}" has ${String(characters)} oracle characters; its fixed zoom admits at most ${String(capacity)}`,
        [slot.id],
      ),
    ];
  });
}
