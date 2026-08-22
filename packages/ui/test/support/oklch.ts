/**
 * OKLCH, converted rather than trusted.
 *
 * Every color in `src/styles/tokens.ts` is an `oklch()` triple, and two claims
 * about the palette cannot be checked in that space: whether a pair of colors
 * clears a WCAG contrast ratio, which is defined on sRGB relative luminance, and
 * whether a color is inside sRGB at all. A value outside the gamut is not a
 * failure the browser reports — it clips, and the color that reaches the screen
 * is a paler, less saturated one than the sheet asked for, which on a card frame
 * is exactly the defect the palette is being tuned against.
 *
 * The conversion is the CSS Color 4 matrices, verbatim. `jsdom` computes no
 * color spaces, so there is nothing to ask the environment for.
 */

/** An OKLCH color: lightness 0-1, chroma, hue in degrees. */
export type Oklch = readonly [number, number, number];

function toLinearSrgb([L, C, H]: Oklch): readonly [number, number, number] {
  const hue = (H * Math.PI) / 180;
  const a = C * Math.cos(hue);
  const b = C * Math.sin(hue);
  const long = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ];
}

/** Whether every channel lands inside sRGB, so nothing is clipped on the way out. */
export function inSrgb(color: Oklch): boolean {
  return toLinearSrgb(color).every((channel) => channel >= -0.0005 && channel <= 1.0005);
}

/** WCAG relative luminance of the color as it would actually be displayed. */
function luminance(color: Oklch): number {
  const [r, g, b] = toLinearSrgb(color).map((channel) => Math.min(1, Math.max(0, channel)));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/** The WCAG 2.x contrast ratio between two colors, 1 to 21. */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/**
 * How far apart two colors are in OKLab, which is the space the palette is
 * written in and a perceptually uniform one: a single number for "these are
 * different colors" that a lightness comparison alone cannot give, because two
 * surfaces at one lightness and opposite hues differ by nothing in `L`.
 */
export function oklabDistance(a: Oklch, b: Oklch): number {
  const point = ([L, C, H]: Oklch): readonly [number, number, number] => {
    const hue = (H * Math.PI) / 180;
    return [L, C * Math.cos(hue), C * Math.sin(hue)];
  };
  const [al, aa, ab] = point(a);
  const [bl, ba, bb] = point(b);
  return Math.hypot(al - bl, aa - ba, ab - bb);
}

/** The `oklch()` value a palette block declares for a token. */
export function tokenColor(block: string, token: string): Oklch {
  const found = new RegExp(`${token}:\\s*oklch\\(\\s*([0-9.]+)\\s+([0-9.]+)\\s+([0-9.]+)\\s*\\)`).exec(block);
  if (found === null) throw new Error(`${token} is not declared as a plain oklch value in this block`);
  return [Number(found[1]), Number(found[2]), Number(found[3])];
}
