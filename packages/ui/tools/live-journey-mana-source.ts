/**
 * The mana-source cast policy the live journey's commander-cast step applies
 * when the commander itself is not yet castable (`mtg-43j03` -- a Commander
 * seat that kept three lands plus Sol Ring passed every turn Sol Ring was a
 * legal cast, discarded it to hand size, and lost the game it should have won
 * by turn five).
 *
 * A permanent's rules text carries this ability, never a list of card names:
 * `oneDecision`'s in-page script in `live-journey.ts` embeds
 * `MANA_ABILITY_LINE_SOURCE` by its regex source, so the browser-evaluated
 * check and this tested one never drift apart.
 */

/**
 * The pattern a card's rules text carries when it can be tapped for mana, the
 * same shape `@mtg/dsl`'s oracle renderer prints for a land's own
 * `producesMana` ("{T}: Add {B}.") and Forge's printed oracle text prints for
 * an artifact mana rock ("{T}: Add {C}{C}.", "{T}: Add one mana of any
 * color...").
 */
export const MANA_ABILITY_LINE_SOURCE = '\\{T\\}:\\s*Add\\b';

const MANA_ABILITY_LINE = new RegExp(MANA_ABILITY_LINE_SOURCE);

/** The word a card's type line carries when it is a land, cut from its name first. */
const LAND_TYPE_LINE = /\bLand\b/;

/**
 * A card's full detail text, as `printedDetail` / `faceDetailText` join it:
 * the name, then the type line, then its rules text lines. Read this way
 * rather than off the accessible name because `faceAccessibleName` only ever
 * spells out a *land's* mana output, never a nonland permanent's ability.
 */
export interface CardDetail {
  readonly name: string;
  readonly typeLine: string;
  readonly rulesText: string;
}

/** Splits a `printedDetail` / `faceDetailText` string into its named parts. */
export function parseCardDetail(detail: string): CardDetail {
  const [name = '', typeLine = '', ...rest] = detail.split('\n');
  return { name, typeLine, rulesText: rest.join('\n') };
}

/**
 * Whether a card is a nonland permanent whose rules text can tap for mana --
 * a mana rock or dork, never a land (those are played through the ordinary
 * land-drop path before this ever runs) and never a card whose ability is
 * merely a spell effect that happens to mention adding mana.
 */
export function isManaSourceDetail(detail: string): boolean {
  const { typeLine, rulesText } = parseCardDetail(detail);
  return !LAND_TYPE_LINE.test(typeLine) && MANA_ABILITY_LINE.test(rulesText);
}

/**
 * The first hand card, in hand order, that is a legal move and a nonland mana
 * source -- `null` when none of the offered moves qualifies. Hand order,
 * not a ranking, because "affordable" is already decided by which moves the
 * table offered: every name here is one of them.
 */
export function chooseManaSourceName(
  hand: readonly { readonly name: string; readonly detail: string }[],
  legalMoveNames: ReadonlySet<string>,
): string | null {
  const candidate = hand.find((card) => legalMoveNames.has(card.name) && isManaSourceDetail(card.detail));
  return candidate?.name ?? null;
}
