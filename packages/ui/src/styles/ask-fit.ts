/**
 * The ask column's move labels shrink before they break, and break only after.
 *
 * `mtg-xgw`. `./views.ts` gives `.mtg-choice__label` `overflow-wrap:
 * break-word`, and that declaration is right: without it a label longer than
 * the column leaves the column and is sliced by the panel's edge, which is the
 * worse failure and the one the ask-column lane was fixing. What was missing is
 * the step before it. Nothing got smaller as the column narrowed, so the last
 * resort was reached on ordinary names rather than on the pathological ones it
 * exists for: measured in chrome-headless-shell 151.0.7922.34 on the parked
 * table `../../tools/touch-targets.ts` writes, at 810x1080 the label box is
 * 53.8px and eight of the ten legal moves broke inside a word — `Mountai` over a
 * lone `n`, `Emberfl` over `ow Raider`. A player scanning the list for a card by
 * name was scanning for a word that is not there.
 *
 * **A label is never too long; one of its words is.** `Cast Emberflow Raider`
 * over four lines is a wrapped label and reads fine. The failure is the single
 * word that no longer fits the column at all, so the whole of the arithmetic
 * below is about the *longest word* and not about the length of the label. That
 * is what keeps the ladder off the labels that never needed it: a move whose
 * words are all short is set at full size at every width the surface reaches.
 *
 * # The same shape as the card face's ladders, and why
 *
 * `@mtg/card-geometry`'s `NAME_FIT_STEPS` is the rule this copies: a name
 * shrinks down a ladder of rungs and is only cut past the floor. The rungs here
 * are that array's five numbers, unchanged, for the reason its own docblock
 * gives for having five where the rules box has four — a label is one short
 * string set at the interface's small size, exactly as a card name is, and
 * `0.7 x 13px` is 9.1px, which is the smallest type anywhere in `./`. Sharing
 * the numbers means a rung means one size wherever a reader meets it.
 *
 * What it cannot copy is the *measurement*. A card face is a fixed box and
 * `NAME_FIT_STEPS` is arithmetic against one pessimistic column; the ask column
 * is `clamp(POD_WIDTH_REM, ASK_PERCENT%, PLAY_ASK_REM)` (`./board/fit.ts`) and
 * lands anywhere between about 100px and 176px. A ladder computed against the
 * narrowest of those would set every long name at 9.1px on a 1440x900 window
 * that has 130px of room for it, which is not a fit, it is a tax.
 *
 * So the width is left to the browser, the way `../card/type-line.ts` leaves the
 * board face's type bar to it: **which rung a label is on is a container query,
 * not a measurement.** Each label publishes, per rung, the widest column at
 * which it must already be down to that rung, and `./views.ts` turns the
 * `ASK_BANDS` list into one `@container` block per band. The arithmetic is a
 * pure function of the text, so jsdom can hold it to cases written out by hand;
 * only the width is the browser's.
 *
 * # What the model is approximate about
 *
 * The capacity model is a mean glyph advance, and it is calibrated to err
 * toward shrinking rather than toward breaking. Measured on the same rig with
 * the interface sans at 13px, the widest per-character reading over the words
 * the example set and the flagship put in a move label is 0.579 (an eleven-
 * character name that broke at a 81.7px label; the mean over the same words is
 * 0.552). `ASK_ADVANCE` is 0.58, so every threshold is stated about 3% wide of
 * where the text really stops fitting, and `bandFor` explains why that cushion
 * is the only one taken. A word of unusual glyphs can still exceed it, and
 * `overflow-wrap: break-word` is what happens then: the ladder moved the floor,
 * it did not remove it.
 *
 * The floor is real and the docblock says where it is. At the bottom rung a
 * nine-character word wants about 45px, so a word of thirteen characters or
 * more still breaks in a column at its narrowest. That is the same statement
 * `nameFitStepOf` makes about a name past its own floor, and the answer is the
 * same one: the whole label is still on the button's `aria-label`
 * (`../routes/play/choice-button.ts`), so nothing is unreachable.
 */

/**
 * The rungs a move label shrinks down, as scales of `--mtg-text-sm`.
 *
 * `@mtg/card-geometry`'s `NAME_FIT_STEPS`, number for number. Not imported: that
 * array is the *card face's* title ladder and its floor is argued from the title
 * bar's own column, so a re-tune of the printed face must not silently re-tune
 * the interface. Two ladders that agree today and can be argued apart tomorrow,
 * which is the reason that file gives for having two of its own.
 */
export const ASK_FIT_STEPS: readonly number[] = [1, 0.92, 0.85, 0.78, 0.7];

/**
 * The rungs a *column* may take, in rem of the label's own content box — which
 * is what `./views.ts` makes the query container, so 4rem is a 64px label.
 *
 * Fine where the ask column actually lands and coarse above it, which is
 * `../card/type-line.ts`'s `TYPE_BANDS` argument applied one column over. The
 * measured label boxes are 130px at 1440x900, 114.9px at 1280x800, 81.7px at
 * 1024x768 and 53.8px at 810x1080 — 8.1, 7.2, 5.1 and 3.4rem — and the floor of
 * the column is `POD_WIDTH_REM`, which leaves the label about 2.6rem. So the
 * quarter-rem grid covers everything below 6rem, where a rung is 4px of a 50px
 * box and the choice between two rungs is decided by it, and half-rem steps
 * carry the rest, where the label has room to spare either way.
 *
 * Ascending, because `askFitBands` searches upward for the first band that
 * holds the text; `./views.ts` emits its blocks in the reverse order for the
 * separate reason stated there.
 */
export const ASK_BANDS: readonly number[] = [
  2.5, 2.75, 3, 3.25, 3.5, 3.75, 4, 4.25, 4.5, 4.75, 5, 5.25, 5.5, 5.75, 6, 6.5, 7, 7.5, 8, 8.5, 9,
];

/**
 * The band value for a label that must be at a rung at every width this file
 * models. A rule keyed on it sits outside every `@container` block, so the rung
 * applies unconditionally — `../card/type-line.ts`'s `TYPE_BAND_NEVER` is the
 * same device pointed the other way.
 */
export const ASK_BAND_ALWAYS = 'always';

/** Mean glyph advance as a fraction of the font size; see the file docblock. */
const ASK_ADVANCE = 0.58;

/** `--mtg-text-sm` in px, which is what a label is set at on rung 0. */
const ASK_LABEL_PX = 13;

/** One rem, in the px `ASK_BANDS` states its rungs against. */
const REM_PX = 16;

/**
 * The longest run of characters in `text` with no break opportunity in it.
 *
 * Whitespace and dashes, because those are where a browser will break a line
 * without being asked to; an apostrophe is not one, so `Bot's` is one word and a
 * hyphenated name is two. Nothing else is treated as a boundary, which keeps
 * this a pessimistic reading rather than an optimistic one.
 */
export function longestWord(text: string): string {
  let longest = '';
  for (const word of text.split(/[-\s‐-―]+/u)) {
    if (word.length > longest.length) longest = word;
  }
  return longest;
}

/** How wide `text`'s longest word is set at rung 0, in px. */
function demandPx(text: string): number {
  return longestWord(text).length * ASK_ADVANCE * ASK_LABEL_PX;
}

/**
 * The band nearest `px`, as the attribute value a rule is keyed on.
 *
 * *Nearest*, not the next band up, because the safety margin is already spent
 * once and spending it twice costs a whole rung. `ASK_ADVANCE` is the widest
 * per-character reading measured rather than the mean, so a threshold computed
 * from it already sits about 3% wide of where the text actually stops fitting;
 * rounding the band up as well pushed a nine-character name to 9.1px at a
 * 53.8px label that had room for it at 10.1px. Nearest keeps the one cushion
 * and drops the second. What it costs is the case the cushion does not cover: a
 * word whose glyphs really are at the top of the measured range, at a width
 * that rounds down, overflows its box by a pixel or two and `overflow-wrap`
 * takes a character off the end. That is the floor doing its job over a two-
 * pixel miss, which is a different thing from the twenty-six-pixel miss this
 * ladder exists to remove.
 *
 * `null` is a rung whose band is the narrowest one modeled: the column's own
 * floor (`POD_WIDTH_REM`) leaves the label more than 2.5rem, so a rule keyed
 * there could never fire, and an attribute nothing reads is worse than no
 * attribute. `ASK_BAND_ALWAYS` is the other end, a threshold past the widest
 * band, where the rung applies at every width this file models.
 */
function bandFor(px: number): string | null {
  const floor = ASK_BANDS[0];
  const ceiling = ASK_BANDS[ASK_BANDS.length - 1];
  if (floor === undefined || ceiling === undefined) throw new Error('ask-fit: no bands');
  if (px > ceiling * REM_PX) return ASK_BAND_ALWAYS;
  let nearest = floor;
  for (const band of ASK_BANDS) {
    if (Math.abs(band * REM_PX - px) < Math.abs(nearest * REM_PX - px)) nearest = band;
  }
  return nearest === floor ? null : String(nearest);
}

/**
 * The scale at a rung of the ladder, refusing a rung it does not have.
 *
 * `@mtg/card-geometry`'s `nameFitScale` throws for the same reason: a step index
 * that has drifted past the end of the array is a bug in whatever computed it,
 * and reading `undefined` into a stylesheet writes `--ask-fit: undefined`, which
 * no browser reports.
 */
export function askFitScale(step: number): number {
  const scale = ASK_FIT_STEPS[step];
  if (scale === undefined) throw new Error(`ask-fit: no step ${String(step)}`);
  return scale;
}

/** The attribute a rung's band is published under, level with `./views.ts`. */
export function askFitAttribute(step: number): string {
  if (step < 1 || step >= ASK_FIT_STEPS.length) {
    throw new Error(`ask-fit: step ${String(step)} has no band attribute`);
  }
  return `data-ask-fit-${String(step)}`;
}

/**
 * The widest label box at which `text` must already be at each rung below the
 * top, or `null` for a rung it never needs.
 *
 * Read from the top down: rung `k` is needed once the box is narrower than the
 * longest word set at rung `k - 1`, so the thresholds descend with the scales
 * and the bands descend with them. Monotone by construction, which is what lets
 * `./views.ts` order its blocks by width and let the last matching one win.
 */
export function askFitBands(text: string): readonly (string | null)[] {
  const demand = demandPx(text);
  const bands: (string | null)[] = [];
  for (let step = 1; step < ASK_FIT_STEPS.length; step += 1) {
    bands.push(bandFor(demand * askFitScale(step - 1)));
  }
  return bands;
}

/**
 * The bands as the attributes a label carries, with the rungs it never needs
 * left off rather than published as a band no rule should fire at.
 */
export function askFitAttributes(text: string): Readonly<Record<string, string>> {
  const attributes: Record<string, string> = {};
  askFitBands(text).forEach((band, index) => {
    if (band !== null) attributes[askFitAttribute(index + 1)] = band;
  });
  return attributes;
}
