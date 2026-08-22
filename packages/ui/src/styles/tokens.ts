/**
 * The token layer: the only place in `@mtg/ui` where a color is chosen.
 *
 * Discipline ported from the prior project (`the prior-project reuse audit`
 * items 3 and 10): every surface is either finalized or explicitly pending, and
 * every visual constant is named data rather than a literal buried in a
 * component. Nothing below this file may contain a color literal — a test
 * (`test/tokens.test.ts`) fails the build on a raw hex anywhere under `src/`,
 * and on any `--mtg-*` token a component references but the sheet never
 * declares.
 *
 * Colors are OKLCH so lightness is perceptual: the five color identities can
 * be tuned to equal weight against paper without one of them shouting.
 *
 * Theme resolution, in order:
 *   1. `:root` carries the complete light palette, so every token always has a
 *      value even when nothing else matches.
 *   2. `prefers-color-scheme: dark` swaps the palette, unless the viewer pinned
 *      light with `data-theme="light"`.
 *   3. `data-theme="dark"` pins dark regardless of system preference.
 *
 * The chrome palette is restrained: warm paper neutrals plus one ink-indigo
 * accent for selection and primary action. The five color identities are
 * *data* colors — they appear on card frames, mana pips and color-pair charts
 * and nowhere else, so a colored thing on screen always means a card thing.
 *
 * **The four surfaces an identity owns.** `--mtg-frame-<id>` is the card's own
 * ground — the *band*, the color you see between and around the boxes printed
 * on it — `-panel` those boxes (title bar, type bar, rules box, power/toughness
 * badge, collector bar), `-well` the art window, and `-edge` the keyline around
 * every one of them. The interior used to be neutral, so a hand read as seven
 * near-white rectangles with a colored rim; the interior then took the identity
 * and every surface of a card sat within 0.03 lightness of every other, so the
 * frame read as one flat wash instead. The band is now the deep surface and the
 * box the light one, which is the arrangement a printed Magic card has: a card
 * is a colored frame with a cream printing area laid into it.
 *
 * **The band is at least 0.12 in lightness under the box, and that is a
 * decision about text.** Body ink clears 7:1 only above lightness 0.735 on
 * paper, and the box has to stay above 0.848 for `--mtg-ink-muted` to clear
 * 4.5:1 on it; a band 0.12 under a box that high cannot also be above 0.735, so
 * a band deep enough to read as a frame is a band no text may be set on. The
 * face is drawn that way rather than tuned toward it — every printed line sits
 * on a `-panel` bar (`styles/card.ts`, and `@mtg/card-render`'s `renderFooter`
 * draws the same bar for the one line only paper still carries, the collector
 * line) — and `test/card-surfaces.test.ts` holds
 * the two text-bearing surfaces, the box and the well, to 7:1 for `--mtg-ink`
 * and 4.5:1 for `--mtg-ink-muted` in both themes while asking nothing of the
 * band except that no text lands on it.
 *
 * **Muted rather than bright.** Nothing on a printed card is vivid, so nothing
 * here is: white is a warm bone, blue a grayed slate, black a near-neutral
 * purple-gray, red a brick, green a deep olive, gold a dulled ocher. Chroma on
 * the light bands runs 0.018 to 0.092 where it used to run 0.014 to 0.092 at a
 * near-white lightness, which is the same numbers doing a different job: the
 * color is now carried by a deep surface instead of a pale one. Colorless is
 * the one identity whose *hue* moved, from 250 to 85 — a warm stone rather than
 * a cool one — because the dark palette's neutrals are all hue 265 and a
 * low-chroma cool gray cannot separate from them by lightness alone once the
 * band sits down beside `--mtg-surface-raised`.
 *
 * The one surface that stays neutral is the *pending* art window, which is not
 * the card's picture but a production notice printed in `--mtg-pending` amber,
 * and amber over a tinted well loses contrast it does not have to spare.
 *
 * **The rarity ramp is the one family here that is not a card *surface*.** Four
 * inks — black, a metallic pale blue, gold, red-orange — for the set symbol,
 * which is one shape colored by rarity (`../card/anatomy.ts`,
 * `RARITY_SEAL_INK`). They are a family rather than four one-offs because they
 * are read against each other: a person tells rare from uncommon by the two
 * being side by side in a pile, not by either one in isolation. Metallic here
 * means a cool desaturation and not a gradient — chroma 0.038 to 0.042 at hue
 * 240 for uncommon against 0.104 at 82 for the gold — because a gradient would
 * have to be expressible in both renderers and buys nothing at a 15px seal.
 *
 * Both palettes value all four, which is forced. The seal sits on a `-panel`
 * bar, lightness 0.902 on paper and 0.342–0.360 in the dark, and one fixed
 * value clearing 3:1 against both would have to be darker than 0.60 and lighter
 * than 0.62 at once. So the *neutral end* of the ramp is the paper palette's
 * darkest ink and the dark palette's palest one; the three hues keep their hue
 * and move in lightness. `test/card-surfaces.test.ts` holds all eight to WCAG
 * AA non-text contrast against every panel of every identity.
 *
 * `--mtg-rarity-mythic` is the fourth DSL rarity and is reachable by audited
 * reference cards; the slice allocator still stops at rare.
 *
 * A route may re-value tokens for itself through `scopedPalette` at the foot of
 * this file. Those blocks are kept out of `TOKEN_CSS` on purpose; see the note
 * there.
 */
import { UI_MODES } from '../app/router';
import type { UiMode } from '../app/router';

/** Color identity of a card face: the five colors, colorless, multicolor. */
export const COLOR_IDENTITIES = ['w', 'u', 'b', 'r', 'g', 'c', 'm'] as const;
export type ColorIdentity = (typeof COLOR_IDENTITIES)[number];

/** Human label per identity, used by legends and filter controls. */
export const IDENTITY_LABELS: Readonly<Record<ColorIdentity, string>> = {
  w: 'White',
  u: 'Blue',
  b: 'Black',
  r: 'Red',
  g: 'Green',
  c: 'Colorless',
  m: 'Multicolor',
};

/**
 * The three declaration blocks, exported so `test/tokens.test.ts` can assert
 * that light and dark declare exactly the same palette and that no component
 * references a token neither one defines.
 */
export const LIGHT_TOKENS = `
  color-scheme: light;

  --mtg-surface-page: oklch(0.973 0.006 85);
  --mtg-surface-raised: oklch(0.995 0.003 85);
  --mtg-surface-sunken: oklch(0.941 0.008 80);
  --mtg-surface-rail: oklch(0.955 0.007 80);
  --mtg-surface-inset: oklch(0.918 0.009 80);

  --mtg-ink: oklch(0.24 0.014 60);
  --mtg-ink-muted: oklch(0.460 0.013 65);
  --mtg-ink-faint: oklch(0.66 0.010 70);
  --mtg-ink-inverse: oklch(0.98 0.004 85);

  --mtg-line: oklch(0.884 0.010 75);
  --mtg-line-strong: oklch(0.795 0.013 72);

  --mtg-accent: oklch(0.470 0.104 266);
  --mtg-accent-hover: oklch(0.415 0.108 266);
  --mtg-accent-soft: oklch(0.936 0.030 266);
  --mtg-accent-ink: oklch(0.985 0.004 266);

  --mtg-positive: oklch(0.520 0.096 152);
  --mtg-negative: oklch(0.540 0.150 27);
  --mtg-pending: oklch(0.640 0.086 78);

  --mtg-ready: oklch(0.600 0.140 60);
  --mtg-ready-soft: oklch(0.600 0.140 60 / 0.42);
  --mtg-ready-lift: brightness(1.06) saturate(1.08);

  --mtg-rarity-common: oklch(0.255 0.012 60);
  --mtg-rarity-uncommon: oklch(0.572 0.042 240);
  --mtg-rarity-rare: oklch(0.572 0.104 82);
  --mtg-rarity-mythic: oklch(0.542 0.176 38);

  --mtg-color-w: oklch(0.845 0.045 88);
  --mtg-color-w-on: oklch(0.28 0.020 88);
  --mtg-frame-w: oklch(0.775 0.038 88);
  --mtg-frame-w-panel: oklch(0.902 0.034 88);
  --mtg-frame-w-well: oklch(0.872 0.042 88);
  --mtg-frame-w-edge: oklch(0.615 0.050 88);

  --mtg-color-u: oklch(0.545 0.085 250);
  --mtg-color-u-on: oklch(0.985 0.005 250);
  --mtg-frame-u: oklch(0.545 0.055 250);
  --mtg-frame-u-panel: oklch(0.902 0.032 250);
  --mtg-frame-u-well: oklch(0.870 0.040 250);
  --mtg-frame-u-edge: oklch(0.375 0.068 250);

  --mtg-color-b: oklch(0.395 0.042 305);
  --mtg-color-b-on: oklch(0.965 0.008 305);
  --mtg-frame-b: oklch(0.400 0.038 305);
  --mtg-frame-b-panel: oklch(0.902 0.032 305);
  --mtg-frame-b-well: oklch(0.868 0.036 305);
  --mtg-frame-b-edge: oklch(0.285 0.040 305);

  --mtg-color-r: oklch(0.545 0.110 31);
  --mtg-color-r-on: oklch(0.985 0.005 31);
  --mtg-frame-r: oklch(0.540 0.092 31);
  --mtg-frame-r-panel: oklch(0.902 0.034 31);
  --mtg-frame-r-well: oklch(0.870 0.046 31);
  --mtg-frame-r-edge: oklch(0.372 0.088 31);

  --mtg-color-g: oklch(0.505 0.078 145);
  --mtg-color-g-on: oklch(0.985 0.006 145);
  --mtg-frame-g: oklch(0.515 0.062 145);
  --mtg-frame-g-panel: oklch(0.902 0.034 145);
  --mtg-frame-g-well: oklch(0.868 0.046 145);
  --mtg-frame-g-edge: oklch(0.362 0.062 145);

  --mtg-color-c: oklch(0.700 0.018 85);
  --mtg-color-c-on: oklch(0.26 0.010 85);
  --mtg-frame-c: oklch(0.700 0.018 85);
  --mtg-frame-c-panel: oklch(0.902 0.012 85);
  --mtg-frame-c-well: oklch(0.872 0.016 85);
  --mtg-frame-c-edge: oklch(0.560 0.020 85);

  --mtg-color-m: oklch(0.730 0.078 92);
  --mtg-color-m-on: oklch(0.28 0.030 92);
  --mtg-frame-m: oklch(0.700 0.062 92);
  --mtg-frame-m-panel: oklch(0.902 0.036 92);
  --mtg-frame-m-well: oklch(0.870 0.050 92);
  --mtg-frame-m-edge: oklch(0.545 0.072 92);

  --mtg-shadow-card: 0 1px 2px oklch(0.24 0.014 60 / 0.10), 0 6px 18px oklch(0.24 0.014 60 / 0.08);
  --mtg-shadow-raised: 0 1px 2px oklch(0.24 0.014 60 / 0.09);
  --mtg-scroll-edge: oklch(0.24 0.014 60 / 0.22);
  --mtg-hatch: oklch(0.862 0.014 80);
  --mtg-pip-ring: oklch(0.24 0.014 60 / 0.16);
`;

export const DARK_TOKENS = `
  color-scheme: dark;

  --mtg-surface-page: oklch(0.192 0.010 265);
  --mtg-surface-raised: oklch(0.238 0.011 265);
  --mtg-surface-sunken: oklch(0.162 0.010 265);
  --mtg-surface-rail: oklch(0.216 0.011 265);
  --mtg-surface-inset: oklch(0.278 0.012 265);

  --mtg-ink: oklch(0.938 0.006 265);
  --mtg-ink-muted: oklch(0.740 0.010 265);
  --mtg-ink-faint: oklch(0.605 0.011 265);
  --mtg-ink-inverse: oklch(0.196 0.010 265);

  --mtg-line: oklch(0.330 0.012 265);
  --mtg-line-strong: oklch(0.442 0.014 265);

  --mtg-accent: oklch(0.760 0.108 266);
  --mtg-accent-hover: oklch(0.828 0.096 266);
  --mtg-accent-soft: oklch(0.320 0.052 266);
  --mtg-accent-ink: oklch(0.170 0.020 266);

  --mtg-positive: oklch(0.740 0.104 152);
  --mtg-negative: oklch(0.712 0.140 27);
  --mtg-pending: oklch(0.782 0.088 78);

  --mtg-ready: oklch(0.840 0.100 60);
  --mtg-ready-soft: oklch(0.840 0.100 60 / 0.38);
  --mtg-ready-lift: brightness(1.20) saturate(1.10);

  --mtg-rarity-common: oklch(0.885 0.006 265);
  --mtg-rarity-uncommon: oklch(0.800 0.038 240);
  --mtg-rarity-rare: oklch(0.805 0.104 88);
  --mtg-rarity-mythic: oklch(0.700 0.168 38);

  --mtg-color-w: oklch(0.760 0.042 88);
  --mtg-color-w-on: oklch(0.26 0.020 88);
  --mtg-frame-w: oklch(0.228 0.032 88);
  --mtg-frame-w-panel: oklch(0.352 0.030 88);
  --mtg-frame-w-well: oklch(0.298 0.034 88);
  --mtg-frame-w-edge: oklch(0.545 0.055 88);

  --mtg-color-u: oklch(0.620 0.080 250);
  --mtg-color-u-on: oklch(0.180 0.030 250);
  --mtg-frame-u: oklch(0.222 0.055 250);
  --mtg-frame-u-panel: oklch(0.348 0.042 250);
  --mtg-frame-u-well: oklch(0.292 0.050 250);
  --mtg-frame-u-edge: oklch(0.510 0.080 250);

  --mtg-color-b: oklch(0.600 0.045 305);
  --mtg-color-b-on: oklch(0.160 0.020 305);
  --mtg-frame-b: oklch(0.215 0.042 305);
  --mtg-frame-b-panel: oklch(0.342 0.032 305);
  --mtg-frame-b-well: oklch(0.288 0.038 305);
  --mtg-frame-b-edge: oklch(0.490 0.050 305);

  --mtg-color-r: oklch(0.600 0.105 31);
  --mtg-color-r-on: oklch(0.180 0.036 31);
  --mtg-frame-r: oklch(0.228 0.070 31);
  --mtg-frame-r-panel: oklch(0.350 0.046 31);
  --mtg-frame-r-well: oklch(0.296 0.058 31);
  --mtg-frame-r-edge: oklch(0.520 0.100 31);

  --mtg-color-g: oklch(0.600 0.080 145);
  --mtg-color-g-on: oklch(0.170 0.030 145);
  --mtg-frame-g: oklch(0.222 0.055 145);
  --mtg-frame-g-panel: oklch(0.346 0.040 145);
  --mtg-frame-g-well: oklch(0.290 0.048 145);
  --mtg-frame-g-edge: oklch(0.500 0.075 145);

  --mtg-color-c: oklch(0.660 0.016 85);
  --mtg-color-c-on: oklch(0.190 0.010 85);
  --mtg-frame-c: oklch(0.230 0.018 85);
  --mtg-frame-c-panel: oklch(0.355 0.014 85);
  --mtg-frame-c-well: oklch(0.300 0.016 85);
  --mtg-frame-c-edge: oklch(0.530 0.022 85);

  --mtg-color-m: oklch(0.700 0.078 92);
  --mtg-color-m-on: oklch(0.220 0.032 92);
  --mtg-frame-m: oklch(0.235 0.050 92);
  --mtg-frame-m-panel: oklch(0.360 0.038 92);
  --mtg-frame-m-well: oklch(0.305 0.044 92);
  --mtg-frame-m-edge: oklch(0.545 0.075 92);

  --mtg-shadow-card: 0 1px 2px oklch(0.10 0.010 265 / 0.55), 0 8px 22px oklch(0.10 0.010 265 / 0.42);
  --mtg-shadow-raised: 0 1px 2px oklch(0.10 0.010 265 / 0.50);
  --mtg-scroll-edge: oklch(0.10 0.010 265 / 0.65);
  --mtg-hatch: oklch(0.352 0.014 265);
  --mtg-pip-ring: oklch(0.10 0.010 265 / 0.45);
`;

/** Scale tokens are theme-independent: one declaration, both palettes. */
export const SCALE_TOKENS = `
  --mtg-font-ui: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  --mtg-font-card: 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif;
  --mtg-font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;

  --mtg-text-xs: 0.6875rem;
  --mtg-text-sm: 0.8125rem;
  --mtg-text-base: 0.9375rem;
  --mtg-text-md: 1.0625rem;
  --mtg-text-lg: 1.3125rem;
  --mtg-text-xl: 1.625rem;

  --mtg-leading-tight: 1.2;
  --mtg-leading-normal: 1.45;

  --mtg-space-1: 0.25rem;
  --mtg-space-2: 0.5rem;
  --mtg-space-3: 0.75rem;
  --mtg-space-4: 1rem;
  --mtg-space-5: 1.5rem;
  --mtg-space-6: 2rem;
  --mtg-space-7: 3rem;

  --mtg-radius-sm: 3px;
  --mtg-radius-md: 6px;
  --mtg-radius-lg: 10px;
  --mtg-radius-card: 12px;
  --mtg-radius-pill: 999px;

  --mtg-duration-fast: 120ms;
  --mtg-duration: 180ms;
  --mtg-ease: cubic-bezier(0.22, 1, 0.36, 1);

  --mtg-measure: 68ch;
`;

/**
 * The surfaces of the playmat: the table itself, its weave, the wells cut into
 * it, the two seats' bands and the seam between them, and the shadow it casts
 * on the page. Valued here rather than in `./board/mat.ts` or
 * `./board/band.ts`, because this file is the only place in `@mtg/ui` where a
 * color is chosen and a board sheet full of `oklch(...)` literals would end
 * that.
 *
 * **The band family is `mtg-rgc.3` and `mtg-1nc` composed, and it is four
 * grounds rather than two.** Ownership is the base tone — the seat away from
 * the viewer is permanently the lighter half and the seat nearest them the
 * darker one, the way Magic Online has drawn it for twenty years — and activity
 * is a lift on top of whichever tone a seat already has. So the far band has a
 * resting value and a lit one, the near band has a resting value and a lit one,
 * and the four are ordered `far-lit > far > near-lit > near` with the ownership
 * step deliberately several times the activity step: an active near band must
 * never reach a resting far band, or the two readings would collide and one of
 * them would win silently. `test/play/band.test.ts` holds that ordering, the
 * margin between the two steps, and every ratio below.
 *
 * **Both bands step away from `--mtg-color-w`, and on paper that is what forces
 * the numbers.** A card's outermost surface is its identity border, and white
 * sits at lightness 0.845 — 0.023 from the well every card was drawn on, which
 * is 1.08:1, a white card on a ground it cannot be told apart from. The far
 * band clears it upward and the near band clears it downward, so the worst card
 * on the worst band now separates at 1.14:1 and the best at 1.46:1 — measured
 * in a browser over the flagship set's own faces, 1.18:1 and 1.46:1 against the
 * same page's 1.08:1 for the well. No paper palette separates every identity
 * well; there is only the choice not to sit on top of one, and this family is
 * that choice made twice.
 *
 * **Each band carries a keyline and an ink of its own**, because a ground that
 * moves takes everything drawn on it along. `--mtg-mat-edge` and
 * `--mtg-ink-faint` were both chosen against the well, and the well is now the
 * value neither band has: on paper the near band would put faint ink at 1.49:1
 * against the 2.09:1 it had, and in the dark palette it is the far band that
 * moves toward the ink instead. So `-far-ink` and `-near-ink` are valued per
 * band and land at 4.6:1 or better on every one of the four grounds, which is
 * above AA and well above what the label had before this; `mtg-1nc` asks for a
 * signal that does not push an already-thin token further down, and this is the
 * half of that promise a choice of ground could not keep.
 *
 * **The dark palette runs the same arrangement over a much smaller range.** Its
 * card frames are all *lighter* than its table, so where paper is constrained
 * from above by one identity, the dark palette is constrained from above by all
 * seven at once and the four grounds live between lightness 0.118 and 0.302.
 * The relations still hold — far over near, lit over resting, ownership several
 * times the activity step — which is what the tests ask of both blocks; the
 * absolute separations are smaller and say so. No route reaches this block
 * today (`SCOPED_PALETTES` pins every route to paper), so it is kept coherent
 * rather than tuned against a screen.
 *
 * A board rendered outside the two-seat markup is exactly the board it was:
 * every rule in `./board/band.ts` keys on `data-seat`, and nothing here
 * re-values a name the rest of the palette already uses.
 *
 * `--mtg-mat-seam` is the hard bar between the halves, and it is the one chrome
 * color in this repository that is neither neutral nor an accent: a warm
 * oxblood at 6.6:1 against the paper mat, so the seam is read as a seam and not
 * as a keyline that got thicker. It is deliberately duller and darker than
 * `--mtg-negative`, which means a life total in trouble; nothing about a
 * table's edge is a warning. It is also the outer ring of a playable card
 * (`./board/slot.ts`), which is why it is held to 3:1 against every ground a
 * card can be drawn on and not only against the two it separates.
 *
 * They are declared here and shipped *outside* `TOKEN_CSS`, which is the whole
 * of the decision `mtg-bc2.46` had to take. `packages/card-render/src/palette.ts`
 * embeds `TOKEN_CSS` verbatim into every standalone SVG, so a name added to the
 * blocks above changes the bytes of every printed card face and of every
 * assertion `packages/card-render/test/` makes about them. A table has no
 * meaning inside a 63 x 88 mm card file, so the conservative half is the correct
 * one here rather than merely the safe one: the printed face is byte-for-byte
 * unchanged, and `packages/card-render/test/parity.test.ts` fails if any name
 * in this block ever reaches it. `BOARD_SURFACE_TOKEN` below is how it asks,
 * which is why every name here begins `--mtg-mat`.
 *
 * The weave inverts between themes on purpose — a darker thread on paper, a
 * lighter one in the dark — because a woven texture is read from the contrast
 * between thread and ground, not from its direction.
 */
export const MAT_LIGHT_TOKENS = `
  --mtg-mat: oklch(0.906 0.012 78);
  --mtg-mat-weave: oklch(0.884 0.013 78);
  --mtg-mat-well: oklch(0.868 0.013 78);
  --mtg-mat-edge: oklch(0.760 0.016 76);
  --mtg-mat-seam: oklch(0.420 0.074 38);
  --mtg-mat-band-far: oklch(0.940 0.009 78);
  --mtg-mat-band-far-lit: oklch(0.966 0.011 78);
  --mtg-mat-band-far-edge: oklch(0.782 0.016 76);
  --mtg-mat-band-far-ink: oklch(0.430 0.012 65);
  --mtg-mat-band-near: oklch(0.768 0.016 78);
  --mtg-mat-band-near-lit: oklch(0.796 0.019 78);
  --mtg-mat-band-near-edge: oklch(0.618 0.018 76);
  --mtg-mat-band-near-ink: oklch(0.388 0.012 65);
  --mtg-shadow-table: 0 1px 1px oklch(0.24 0.014 60 / 0.10), 0 10px 22px oklch(0.24 0.014 60 / 0.13), inset 0 1px 0 oklch(0.995 0.003 85 / 0.55);
`;

export const MAT_DARK_TOKENS = `
  --mtg-mat: oklch(0.262 0.012 265);
  --mtg-mat-weave: oklch(0.292 0.013 265);
  --mtg-mat-well: oklch(0.224 0.011 265);
  --mtg-mat-edge: oklch(0.380 0.014 265);
  --mtg-mat-seam: oklch(0.612 0.110 38);
  --mtg-mat-band-far: oklch(0.280 0.013 265);
  --mtg-mat-band-far-lit: oklch(0.302 0.014 265);
  --mtg-mat-band-far-edge: oklch(0.472 0.015 265);
  --mtg-mat-band-far-ink: oklch(0.788 0.011 265);
  --mtg-mat-band-near: oklch(0.118 0.008 265);
  --mtg-mat-band-near-lit: oklch(0.142 0.009 265);
  --mtg-mat-band-near-edge: oklch(0.402 0.014 265);
  --mtg-mat-band-near-ink: oklch(0.700 0.011 265);
  --mtg-shadow-table: 0 1px 1px oklch(0.10 0.010 265 / 0.55), 0 10px 22px oklch(0.10 0.010 265 / 0.50), inset 0 1px 0 oklch(0.442 0.014 265 / 0.35);
`;

/**
 * The three-way theme resolution, at the document root: light for everyone,
 * dark for a viewer whose system says so and who has not pinned light, dark for
 * a viewer who pinned it. Written once and called twice, so the palette below
 * and the mat palette beside it cannot resolve themes differently.
 */
function documentPalette(light: string, dark: string): string {
  return `:root {${light}}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {${dark}}
}

:root[data-theme='dark'] {${dark}}
`;
}

/**
 * The full custom-property sheet. Exported as text rather than a `.css` file so
 * the workspace's single root tsconfig keeps typechecking every source file in
 * this package (a `import './x.css'` would not resolve under `tsc`).
 *
 * Document scope only. `packages/card-render/src/palette.ts` embeds this string
 * verbatim in every standalone SVG, where there is no shell and no route, so a
 * route's palette would be dead weight inside a card file. The scoped blocks and
 * the mat's surfaces are appended after it by `uiStyleSheet()` instead.
 */
export const TOKEN_CSS: string = documentPalette(`${SCALE_TOKENS}${LIGHT_TOKENS}`, DARK_TOKENS);

/** The mat's surfaces, theme-resolved, for `uiStyleSheet()` to append. */
export const MAT_TOKEN_CSS: string = documentPalette(MAT_LIGHT_TOKENS, MAT_DARK_TOKENS);

/**
 * Which token names belong to the board rather than to the shared palette.
 *
 * The rule the block above exists for — none of these may reach a printed card
 * file — is only enforceable if it can be asked of a name rather than of a
 * location. A test that reads the names out of `MAT_LIGHT_TOKENS` and looks for
 * them in `TOKEN_CSS` cannot see the one mistake worth catching, which is a
 * declaration *moved* into `LIGHT_TOKENS`: it leaves the block, so the test
 * stops asking about it. This pattern is what
 * `packages/card-render/test/parity.test.ts` asks instead, and it is why the
 * surfaces are all named `--mtg-mat…` and the shadow keeps the
 * `--mtg-shadow-*` family's shape.
 */
export const BOARD_SURFACE_TOKEN = /^--mtg-(?:mat|shadow-table)/;

/**
 * The attribute the shell stamps with the route it is showing. Written once
 * here and read by `app/Shell.ts`, so the markup and the selector cannot end up
 * naming two different things.
 */
export const ROUTE_SCOPE_ATTRIBUTE = 'data-mtg-mode';

/** The selector matching the shell while it is showing `mode`. */
export function routeScope(mode: UiMode): string {
  return `[${ROUTE_SCOPE_ATTRIBUTE}='${mode}']`;
}

/** A palette narrower than the document: the same token names, re-valued. */
export interface ScopedPalette {
  readonly light: string;
  readonly dark: string;
}

/**
 * The same three-way theme resolution `TOKEN_CSS` performs, under a selector
 * rather than at the document root: the bare selector carries light, and the
 * two dark blocks nest the root-level guards ahead of it so a viewer who pinned
 * light still gets light inside the scope.
 *
 * A scope's light block and `:root` have equal specificity — one pseudo-class
 * against one attribute — so document order is what makes the scope win, which
 * is why `uiStyleSheet()` appends these after `TOKEN_CSS` rather than before.
 */
export function scopedPalette(selector: string, light: string, dark: string): string {
  return `${selector} {${light}}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) ${selector} {${dark}}
}

:root[data-theme='dark'] ${selector} {${dark}}
`;
}

/**
 * The route palette: paper, for every viewer, in every theme.
 *
 * The whole light palette rather than a chosen subset of it, and that is the
 * decision rather than laziness. The mat holds cards, and a card's frame, its
 * pips, its seal and its ground come from the identity tokens, the surfaces and
 * the ink; the moves under it are buttons, which reach for the accent and its
 * hover and its disabled ground; a permanent's marks reach for positive,
 * negative and pending. Pinning the table to paper and leaving the cards on it
 * dark is not half a fix, it is a worse surface than either theme on its own, so
 * the route's palette travels as one thing.
 *
 * Written as the two light blocks themselves rather than as a copy of their
 * values: a copy is a second palette to keep level with the first by hand, and
 * a card whose identity the copy had never heard of would resolve to whatever
 * the document said, which on this route is the bug being fixed. The seven
 * `--mtg-frame-<identity>` fills ride along unused — `@mtg/card-render` is their
 * only consumer — because carrying the block whole is what makes the drift
 * impossible.
 *
 * Both blocks are the same text, which `scopedPalette` emits three times: the
 * bare selector, the dark-preference guard, and the pinned-dark guard. That is
 * the point. `packages/ui/test/tokens.test.ts` holds a scope to declaring the
 * same *names* in light and dark, not to declaring different values, and a route
 * that must not follow the viewer's theme is exactly the case where the same
 * values in both is the correct answer.
 */
const PAPER_PALETTE = `${LIGHT_TOKENS}${MAT_LIGHT_TOKENS}`;

/**
 * Routes that re-value tokens for themselves: all of them.
 *
 * `mtg-bc2.46` shipped the playmat as a recomposition of the document palette
 * and registered nothing here, which left a viewer whose system prefers dark
 * looking at a table that had never been reviewed: the dark half of the mat pair
 * is not a darker paper but the generic dark surface family's blue hue wearing
 * the mat's name. Registering the play route fixed the table and left the other
 * four tabs following the system, on the reading that they are reading surfaces
 * and a person who set their machine to dark meant it about those. Looking at
 * the running app settled it the other way: the tabs are one app, the mockup
 * that was reviewed is hard-stamped `data-theme="light"`, and half a themed app
 * is a worse surface than either theme whole.
 *
 * Built from `UI_MODES` rather than written out entry by entry, because a list
 * of near-identical registrations is the shape where the sixth route is the one
 * nobody remembers: no test can miss a route that no source file names. The cost
 * of deriving it is that every future mode is paper by default and a mode that
 * wanted its own palette would have to say so here, which is the right way round
 * while the answer for every route is the same answer.
 *
 * A `Map` rather than a partial record because the sheet below iterates it and
 * a partial record's entries arrive as possibly-undefined, which would buy a
 * branch that can never run.
 */
export const SCOPED_PALETTES: ReadonlyMap<UiMode, ScopedPalette> = new Map(
  UI_MODES.map((mode) => [mode, { light: PAPER_PALETTE, dark: PAPER_PALETTE }]),
);

/**
 * The declarations in a palette block that are not custom properties.
 *
 * A palette is nearly all `--mtg-*` names, and those reach everything under the
 * block that declares them by inheriting, which is the whole of what a scope on
 * `.mtg-shell` has to do. `color-scheme` is the exception in both directions: it
 * is not a custom property, and the thing that reads it is not an element the
 * scope contains. It tells the browser which way round to draw the chrome the
 * sheet never touches — the scrollbar, the ground under a `<select>`, a date
 * field's own controls — and the *viewport's* scrollbar is drawn from the value
 * on the root element, one level above every scope.
 *
 * Lifted out of the palette rather than named here, so a route that stopped
 * being paper would take the chrome with it. Nothing filters to nothing, which
 * is the case a palette narrowed past this declaration would produce, and
 * `test/tokens.test.ts` fails a registered scope that hands the viewport an
 * empty rule.
 */
export function nativeDeclarations(block: string): string {
  return block
    .split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration.includes(':') && !declaration.startsWith('--'))
    .map((declaration) => `\n  ${declaration};`)
    .join('');
}

/**
 * What a route hands the root element, under the same three-way resolution the
 * palettes get.
 *
 * `:has()` is the whole mechanism: a scope is registered on the shell, and this
 * is the one direction CSS lets a rule read the other way, so the root can ask
 * which route is on the page. Every guard is the root-level guard with the
 * question appended, so the scope's light block and its dark block land where
 * the scope's own palette lands and a viewer who pinned light still gets light.
 *
 * `:root:has(SCOPE)` ties with `TOKEN_CSS`'s `:root:not([data-theme='light'])`
 * on specificity, so it wins on order alone, the same way a scope's light block
 * wins over `:root`. `uiStyleSheet()` appending this after `TOKEN_CSS` is what
 * makes that true.
 */
export function viewportScheme(selector: string, light: string, dark: string): string {
  return `:root:has(${selector}) {${light}}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']):has(${selector}) {${dark}}
}

:root[data-theme='dark']:has(${selector}) {${dark}}
`;
}

/**
 * Every registered scope, in one block, for `uiStyleSheet()` to append: the
 * palette on the shell, and the chrome the shell cannot reach on the root.
 */
export const SCOPED_TOKEN_CSS: string = [...SCOPED_PALETTES]
  .map(
    ([mode, palette]) =>
      `${scopedPalette(routeScope(mode), palette.light, palette.dark)}${viewportScheme(
        routeScope(mode),
        nativeDeclarations(palette.light),
        nativeDeclarations(palette.dark),
      )}`,
  )
  .join('\n');
