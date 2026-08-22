/**
 * The set symbol: one mark per set, painted in the rarity's ink.
 *
 * The playtester, 2026-08-13: "the set symbol should be a trisigil so three
 * triangles but the color is based on those rarities", and that half stands —
 * a printed Magic card has carried one set symbol colored by rarity since
 * Exodus, `RARITY_SEAL_INK` is what varies, and nothing here takes a rarity.
 * The playtester, 2026-08-21: "the set symbol for the M11 cards still shows the
 * trisigil, it should be the M11 set symbol (symbol should be based on set)".
 * Both sentences are the same rule read at two scopes. One shape per *set* was
 * always the claim; the drawing was one shape per *repository*, so the reduced
 * M11 reference set, the reduced M13 beside it, the prototype and every set the
 * generator will ever emit printed the flagship's mark.
 *
 * So `setSealPath` resolves the card's own `set.code` against `SET_SEAL_MARKS`.
 * **The default arm is the design, not the table.** Every set this repository
 * generates is a set nobody has drawn a mark for, so a registry that needed an
 * entry per set would be wrong for all of them the moment it shipped and would
 * quietly hand the newest set somebody else's symbol — which is the defect
 * being fixed. The table is a list of exceptions with one entry in it.
 *
 * **What the M11 mark may not be.** Wizards' printed M11 glyph. ADR-0001 §5.6
 * commits this lab to original frames under the Fan Content Policy, and the
 * rule for a mark specifically is that it is authored from arithmetic and
 * nothing else: no asset copied, traced or measured off a scan. "The M11 set
 * symbol" therefore has to mean a mark that reads as M11's without being it,
 * and the one fact about a set that is ours to draw is its code.
 *
 * **Why the code is drawn rather than typeset.** A `<text>` element would be
 * shorter and it would break the standing condition on this frame, twice. The
 * two faces are one drawing in one color — `@mtg/card-render`'s `frame.ts` and
 * `./Card.ts` emit the same `d` attribute into different boxes, and
 * `packages/card-render/test/parity.test.ts` holds them to it — and a typeset
 * mark is two drawings that agree only while both machines resolve the same
 * font. The second reason is the one `./anatomy.ts` gives for drawing the mana
 * symbols instead of loading the Mana font: a bundled face is a dependency, a
 * fallback box when it is missing, and a trademark question, and none of that
 * buys anything at a 20-unit seal.
 *
 * **Why a segment alphabet rather than 36 authored outlines.** A set code is
 * three to five characters of `A-Z0-9` (`SET_CODE_PATTERN`), so a default arm
 * that works for an arbitrary code has to be able to draw all 36. Drawn one at
 * a time they would be 36 chances to pick a different stroke weight, a
 * different cap height or a different corner, and 33 of them would be checked
 * by nobody because no set uses them. Drawn as lit segments of one cell they
 * are one geometry and 36 lists of names: a glyph nobody has looked at is the
 * same weight as the ones we look at every day, because the weight is not its
 * to choose.
 */
import { polygon } from './path';

/**
 * A mark, drawn into the circle a caller reserves for it.
 *
 * `radius` is the circumradius, so every mark fills the same box the trisigil
 * did and both call sites keep the numbers they had: `./Card.ts`'s 20-unit
 * screen box and `typeBarSeal`'s printed one.
 */
export type SetSealMark = (cx: number, cy: number, radius: number) => string;

/**
 * The trisigil, and the argument for it as an *entry* rather than as the
 * drawing.
 *
 * An equilateral triangle is inscribed in the circle with its apex up (vertices
 * at -90°, 30° and 150°), the three edge midpoints are taken, and the three
 * corner triangles are emitted as three closed subpaths. The inverted center
 * triangle is not one of them, so under the default nonzero fill rule it stays
 * empty — the hole is an absence rather than a subtraction, which is what keeps
 * this one `d` attribute correct in both mounts and under any fill rule a
 * future stylesheet might set.
 */
const trisigil: SetSealMark = (cx, cy, radius) => {
  const half = (radius * Math.sqrt(3)) / 2;
  const apex: readonly [number, number] = [cx, cy - radius];
  const right: readonly [number, number] = [cx + half, cy + radius / 2];
  const left: readonly [number, number] = [cx - half, cy + radius / 2];
  const upperRight: readonly [number, number] = [cx + half / 2, cy - radius / 4];
  const upperLeft: readonly [number, number] = [cx - half / 2, cy - radius / 4];
  const base: readonly [number, number] = [cx, cy + radius / 2];
  return [
    polygon([apex, upperRight, upperLeft]),
    polygon([upperRight, right, base]),
    polygon([upperLeft, base, left]),
  ].join(' ');
};

/**
 * The lit segments of one character cell, named on the unit square: `x` runs
 * left to right, `y` runs top to bottom, and the nine nodes are the corners,
 * the edge midpoints and the center.
 *
 * Sixteen of the eighteen are the ones an alphanumeric display has used since
 * the 1970s: the top and bottom bars split at the middle (`a1 a2 d1 d2`), the
 * four half-height sides (`b c e f`), the middle bar split (`g1 g2`), the four
 * corner-to-center diagonals (`h j k m`) and the two center stems (`i l`).
 *
 * `n` and `o` are ours and exist for one letter. Every diagonal in the standard
 * set runs between a *corner* and the center, so the two strokes a V is made of
 * — left-middle down to bottom-center, bottom-center up to right-middle — are
 * the pair that set cannot draw, and every display that ships one fakes V as a
 * U or as half of a W. A set code may contain a V, and a fake is a mark that
 * says the wrong set, so the cell gets the two strokes instead.
 */
type SegmentName =
  | 'a1'
  | 'a2'
  | 'b'
  | 'c'
  | 'd1'
  | 'd2'
  | 'e'
  | 'f'
  | 'g1'
  | 'g2'
  | 'h'
  | 'i'
  | 'j'
  | 'k'
  | 'l'
  | 'm'
  | 'n'
  | 'o';

/** One stroke of the cell, as `x0, y0, x1, y1` on the unit square. */
type Stroke = readonly [number, number, number, number];

const SEGMENTS: Readonly<Record<SegmentName, Stroke>> = {
  a1: [0, 0, 0.5, 0],
  a2: [0.5, 0, 1, 0],
  b: [1, 0, 1, 0.5],
  c: [1, 0.5, 1, 1],
  d1: [0, 1, 0.5, 1],
  d2: [0.5, 1, 1, 1],
  e: [0, 0.5, 0, 1],
  f: [0, 0, 0, 0.5],
  g1: [0, 0.5, 0.5, 0.5],
  g2: [0.5, 0.5, 1, 0.5],
  h: [0, 0, 0.5, 0.5],
  i: [0.5, 0, 0.5, 0.5],
  j: [1, 0, 0.5, 0.5],
  k: [0, 1, 0.5, 0.5],
  l: [0.5, 0.5, 0.5, 1],
  m: [1, 1, 0.5, 0.5],
  n: [0, 0.5, 0.5, 1],
  o: [1, 0.5, 0.5, 1],
};

/** The cell's outer rectangle: `O`, the frame of several other glyphs, and the missing-glyph box. */
const OUTER: readonly SegmentName[] = ['a1', 'a2', 'b', 'c', 'd1', 'd2', 'e', 'f'];

/**
 * Which segments each character lights, for all 36 a set code may carry.
 *
 * `0` takes the slash so it cannot be read as `O`, and `1` takes a flag and a
 * center stem so it cannot be read as `I`, which is the pair of confusions a
 * three-character code has no context to resolve. `S` and `5` are one glyph,
 * as they are on every segment display ever built: the difference between them
 * is a curve, and there is no curve in a cell made of straight strokes. Two set
 * codes that differ only there would draw one mark, and this repository has no
 * such pair.
 */
const GLYPH_SEGMENTS: Readonly<Record<string, readonly SegmentName[]>> = {
  '0': [...OUTER, 'j', 'k'],
  '1': ['h', 'i', 'l'],
  '2': ['a1', 'a2', 'b', 'g1', 'g2', 'e', 'd1', 'd2'],
  '3': ['a1', 'a2', 'b', 'g2', 'c', 'd1', 'd2'],
  '4': ['f', 'g1', 'g2', 'b', 'c'],
  '5': ['a1', 'a2', 'f', 'g1', 'g2', 'c', 'd1', 'd2'],
  '6': ['a1', 'a2', 'f', 'g1', 'g2', 'e', 'c', 'd1', 'd2'],
  '7': ['a1', 'a2', 'b', 'c'],
  '8': [...OUTER, 'g1', 'g2'],
  '9': ['a1', 'a2', 'b', 'c', 'f', 'g1', 'g2', 'd1', 'd2'],
  A: ['a1', 'a2', 'b', 'c', 'e', 'f', 'g1', 'g2'],
  B: ['a1', 'a2', 'b', 'c', 'd1', 'd2', 'g2', 'i', 'l'],
  C: ['a1', 'a2', 'f', 'e', 'd1', 'd2'],
  D: ['a1', 'a2', 'b', 'c', 'd1', 'd2', 'i', 'l'],
  E: ['a1', 'a2', 'f', 'e', 'g1', 'g2', 'd1', 'd2'],
  F: ['a1', 'a2', 'f', 'e', 'g1'],
  G: ['a1', 'a2', 'f', 'e', 'd1', 'd2', 'c', 'g2'],
  H: ['b', 'c', 'e', 'f', 'g1', 'g2'],
  I: ['a1', 'a2', 'i', 'l', 'd1', 'd2'],
  J: ['b', 'c', 'd1', 'd2', 'e'],
  K: ['e', 'f', 'g1', 'j', 'm'],
  L: ['e', 'f', 'd1', 'd2'],
  M: ['e', 'f', 'h', 'j', 'b', 'c'],
  N: ['e', 'f', 'h', 'm', 'b', 'c'],
  O: OUTER,
  P: ['a1', 'a2', 'b', 'f', 'e', 'g1', 'g2'],
  Q: [...OUTER, 'm'],
  R: ['a1', 'a2', 'b', 'f', 'e', 'g1', 'g2', 'm'],
  S: ['a1', 'a2', 'f', 'g1', 'g2', 'c', 'd1', 'd2'],
  T: ['a1', 'a2', 'i', 'l'],
  U: ['b', 'c', 'd1', 'd2', 'e', 'f'],
  V: ['f', 'n', 'o', 'b'],
  W: ['f', 'e', 'k', 'm', 'c', 'b'],
  X: ['h', 'j', 'k', 'm'],
  Y: ['h', 'j', 'l'],
  Z: ['a1', 'a2', 'j', 'k', 'd1', 'd2'],
};

/**
 * How the wordmark is proportioned inside the seal's circle.
 *
 * Width is the binding constraint and height is free: the printed type bar
 * reserves exactly `radius * 2` for the seal (`typeBarSeal` in
 * `@mtg/card-render`'s `regions.ts`) and the on-screen box is 20 units across,
 * so a code that grew past its diameter would print over the type line on one
 * face and out of its own `<svg>` on the other. `FILL` is the margin inside
 * that reservation, the cell width falls out of the character count, and the
 * cap height follows from `ASPECT`. A five-character code is therefore smaller
 * than a three-character one rather than wider, which is the trade a fixed
 * width forces and the right way round: a mark that overflows is a defect and a
 * mark that is small is a mark.
 *
 * `WEIGHT` is a fraction of the cell rather than a stroke width in user units,
 * for the reason the seal no longer carries a CSS stroke at all: one absolute
 * number cannot serve a mark drawn at two sizes on two faces.
 */
const FILL = 0.94;
const ASPECT = 0.62;
const GAP = 0.18;
const WEIGHT = 0.2;
const TRIM = 0.35;

/** One lit segment as a closed quad: the stroke pulled back at both ends, then given its width. */
function segmentQuad(
  stroke: Stroke,
  originX: number,
  originY: number,
  width: number,
  height: number,
  weight: number,
): string {
  const [x0, y0, x1, y1] = stroke;
  const ax = originX + x0 * width;
  const ay = originY + y0 * height;
  const bx = originX + x1 * width;
  const by = originY + y1 * height;
  const run = Math.hypot(bx - ax, by - ay);
  const ux = (bx - ax) / run;
  const uy = (by - ay) / run;
  const trim = weight * TRIM;
  const sx = ax + ux * trim;
  const sy = ay + uy * trim;
  const ex = bx - ux * trim;
  const ey = by - uy * trim;
  const px = (-uy * weight) / 2;
  const py = (ux * weight) / 2;
  return polygon([
    [sx + px, sy + py],
    [ex + px, ey + py],
    [ex - px, ey - py],
    [sx - px, sy - py],
  ]);
}

/**
 * The set code itself, set in the segment alphabet and centered on the seal.
 *
 * A character the alphabet has no glyph for draws the cell's outer rectangle,
 * which is the missing-glyph box every typesetter has drawn since metal: it
 * cannot arrive from a card that went through `parseCard`, and if it ever does
 * it should look like the defect it is rather than like a mark. An *empty* code
 * cannot be drawn at all — there is nothing to be legible — and a seal that
 * silently paints nothing is the failure this whole bug was, so it throws.
 */
function wordmark(code: string, cx: number, cy: number, radius: number): string {
  const characters = [...code.toUpperCase()];
  if (characters.length === 0) throw new RangeError('a set seal needs a set code to draw');
  const width = (2 * radius * FILL) / (characters.length + (characters.length - 1) * GAP);
  const height = width / ASPECT;
  const weight = width * WEIGHT;
  const advance = width * (1 + GAP);
  const left = cx - (advance * (characters.length - 1) + width) / 2;
  const top = cy - height / 2;
  return characters
    .flatMap((character, index) =>
      (GLYPH_SEGMENTS[character] ?? OUTER).map((name) =>
        segmentQuad(SEGMENTS[name], left + advance * index, top, width, height, weight),
      ),
    )
    .join(' ');
}

/**
 * The sets that have a mark of their own. One entry, and that is the point.
 *
 * The flagship keeps the trisigil: the 2026-08-13 decision preserved rather
 * than reversed, now scoped to the set it was always about. Anything else here
 * would have to be a shape somebody drew on purpose, which is a thing a person
 * does for a set they care about and not a thing this file does on their
 * behalf — an unlisted set draws its code, which is correct rather than
 * merely available.
 */
export const SET_SEAL_MARKS: Readonly<Record<string, SetSealMark>> = { XMP: trisigil };

/**
 * The mark a card's set is printed with, centered on `cx, cy` in a circle of
 * `radius`.
 *
 * The code rather than the whole `SetRef`, because a mark that could read the
 * collector number could differ card to card inside one set, and one symbol for
 * the whole set is the rule this is implementing.
 */
export function setSealPath(code: string, cx: number, cy: number, radius: number): string {
  const drawn = SET_SEAL_MARKS[code.toUpperCase()];
  return drawn === undefined ? wordmark(code, cx, cy, radius) : drawn(cx, cy, radius);
}
