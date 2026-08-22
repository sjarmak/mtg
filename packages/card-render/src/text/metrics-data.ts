/**
 * GENERATED FILE — do not edit by hand.
 *
 * Regenerate with `python3 packages/card-render/tools/measure-font-metrics.py`.
 *
 * Advance widths at a 1000-unit em, taken as the per-character maximum across
 * the reference serif faces listed in that script. The maximum is the point:
 * an SVG is laid out by whatever font the viewer resolves, so the renderer
 * measures against an upper bound and a line that fits here fits under any
 * reference face. `DEFAULT_WIDTH_SAFETY` in `metrics.ts` adds the allowance for
 * faces outside the reference set.
 *
 * No font file is bundled or distributed by this package; these are measured
 * numbers, not glyphs. Reference faces and their licenses are named in the
 * generator script and in this package's README.
 */

/** Units per em that `METRIC_ADVANCES` is expressed in. */
export const METRIC_EM = 1000;

/** Characters covered by the table, in table order. */
export const METRIC_CHARS =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~\u2014\u2018\u2019\u201c\u201d\u2026';

/** Advance width per character of `METRIC_CHARS`, in `METRIC_EM` units. */
export const METRIC_ADVANCES: readonly number[] = [
  318, 402, 460, 838, 636, 950, 890, 275, 390, 390, 500, 838, 318, 338, 318, 337, 636, 636, 636, 636, 636,
  636, 636, 636, 636, 636, 337, 337, 838, 838, 838, 536, 1000, 722, 735, 765, 802, 730, 694, 799, 872, 395,
  401, 747, 664, 1024, 875, 820, 673, 820, 753, 685, 667, 843, 722, 1028, 722, 722, 695, 390, 337, 390, 838,
  500, 500, 596, 640, 560, 640, 592, 370, 640, 644, 320, 310, 606, 320, 948, 644, 602, 640, 640, 478, 513,
  402, 644, 565, 856, 564, 565, 527, 636, 337, 636, 838, 1000, 333, 333, 511, 511, 1000,
];

/** Reference faces the table was measured from, for provenance. */
export const METRIC_SOURCES: readonly string[] = ['DejaVu Serif', 'Liberation Serif'];
