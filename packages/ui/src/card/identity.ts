/**
 * Color identity of a card face.
 *
 * The DSL is the authority on color: `card.colors` is the declared identity
 * and the cost is the mechanical one, and the validators already require them
 * to agree. The frame takes the union so a face is never less colored than the
 * card it prints, and lands fall back to what they tap for — a Mountain has no
 * color but it is obviously red on a table.
 */
import type { Card, Color } from '@mtg/dsl';
import { BASIC_LAND_COLOR, colorsFromCost, isCastable, sortColors } from '@mtg/dsl';
import type { ColorIdentity } from '../styles/tokens';

const IDENTITY_OF: Readonly<Record<Color, ColorIdentity>> = {
  W: 'w',
  U: 'u',
  B: 'b',
  R: 'r',
  G: 'g',
};

/** Every color the face should read as, WUBRG-sorted. Empty means colorless. */
export function cardColors(card: Card): readonly Color[] {
  const declared = new Set<Color>(card.colors);
  if (isCastable(card)) {
    for (const color of colorsFromCost(card.manaCost)) declared.add(color);
  } else {
    for (const color of card.producesMana) {
      if (color !== 'C') declared.add(color);
    }
    if (declared.size === 0 && card.basicLandType !== undefined) {
      declared.add(BASIC_LAND_COLOR[card.basicLandType]);
    }
  }
  return sortColors([...declared]);
}

/** Which of the seven frame identities the face uses. */
export function cardColorIdentity(card: Card): ColorIdentity {
  return colorsToIdentity(cardColors(card));
}

/** Frame identity for a bare color list (deck colors, chart series, filters). */
export function colorsToIdentity(colors: readonly Color[]): ColorIdentity {
  if (colors.length === 0) return 'c';
  if (colors.length > 1) return 'm';
  const [only] = colors;
  return only === undefined ? 'c' : IDENTITY_OF[only];
}

/** Identity for a single DSL color letter. */
export function colorToIdentity(color: Color): ColorIdentity {
  return IDENTITY_OF[color];
}
