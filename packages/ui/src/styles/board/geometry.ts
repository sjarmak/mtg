/**
 * The values more than one board sheet reads.
 *
 * A number declared beside the block that uses it is the rule everywhere else
 * in this directory; these are the exceptions, and each is here because a
 * second declaration of it would be a second thing to keep level by hand
 * (ADR-0002 §6.2 is the same argument one layer down, about the card).
 *
 * `TABLE` and `PLAY` scope a rule to a board under a height budget and to the
 * played table in particular, and `fit.ts` and `rail.ts` both emit under them.
 * `RATIO` is the printed trim as an `aspect-ratio` value, read by `fit.ts` and
 * `attach.ts`. `HOVER_SCALE` is the interactive face's lift, read by `slot.ts`
 * for a card and by `lands.ts` for a tile, which multiplies it by its own
 * tapped scale. `THREE_COLUMN_MIN_WIDTH_PX` is where the table stops being wide
 * enough for three columns, read by `mat.ts`, by `hand.ts` and — since
 * `mtg-l4w0` — by the rail's own default state.
 */
import { CARD_TRIM_MM } from '../../card/anatomy';
import { cssNumber } from '../number';
import type { UiMode } from '../../app/router';
import { routeScope } from '../tokens';

/**
 * Which routes draw the board as a table that fits a screen rather than a
 * frame read down a page.
 *
 * Three. The replay viewer joined in `mtg-ryix`: it rendered the same `Board` in
 * ordinary document flow and came out 1038.7px tall at every viewport, so a
 * 1280x800 window carried 2,451px of page and neither battlefield was whole —
 * measured in chrome-headless-shell 151.0.7922.34 on game 0 seq 120 of
 * `tools/stage-replay.ts`'s log. the playtester asked for "the sizing to match the
 * play sizing view", and the load-bearing half of that ask is *where the
 * numbers come from*: a second set of rules that agreed today is the pair that
 * drifts, so the replay board reads this sheet rather than a copy of it.
 *
 * The draft tab joined the same way and for the same reason, one report later.
 * `../../routes/draft/DraftGame.ts` hands a finished pool to `LiveGame`, which
 * is the `PlayView` the Play tab mounts and not a second surface — but
 * `../../app/Shell.ts` stamps `data-mtg-mode` from the router, so that identical
 * markup renders under `draft`, and this list named `play` and `replay`.
 * Counted off the built sheet, a draft game matched 6 scoped rules, which is
 * what `deck`, `cards` and `analysis` match: the per-mode palette and nothing
 * else. A played game matched 107. So the table fell back to document flow and
 * was drawn 895px past the foot of a 1280x800 window, both battlefields were
 * enormous and empty, the ask column was squeezed to its content width, and both
 * disclosures flipped an attribute that no rule read — pressing either one did
 * nothing, which is the half a person notices first.
 *
 * The list is the drift, not the CSS: every rule under it was already correct
 * for a draft game, because it is the same game. So the pin is a measurement
 * rather than a second reading of this array —
 * `../../../test/play/draft-table.browser.test.ts` renders the draft table
 * beside the played one and asks both for the same three properties.
 *
 * A `:is()` list rather than one emission of every rule per mode, because
 * `:is()` takes the specificity of its widest argument — one attribute selector
 * here, exactly what a bare `routeScope` was — so nothing downstream of these
 * rules changes which declaration wins.
 */
const FITTED_MODES: readonly UiMode[] = ['play', 'draft', 'replay'];

/**
 * The mat's rules under this selector belong to a board on a height budget:
 * the played table and the replay viewer.
 */
export const TABLE = `:is(${FITTED_MODES.map((mode) => routeScope(mode)).join(', ')})`;

/**
 * Which routes are a game being *played*, for the rules that are about playing
 * rather than about fitting.
 *
 * The same two modes a person can take a turn in, and the difference this draws
 * is against the replay viewer, where both of these rules would say something
 * false. The opponent's hand is a row of face-down chips in a fixed narrow track
 * on a played table and five face-up cards on a replay
 * (`routes/replay/frame.ts`: "Hands are drawn face up … the whole reason to
 * watch one is to see what a bot was holding"), so the track that is right for
 * chips would squeeze real cards. And the rail's game log is a block only a
 * played table puts in that column.
 *
 * A draft game is a played game by both of those tests — its opponent is a bot
 * whose hand is face down, and its rail carries the log — so it is in here for
 * the same reason it is in `FITTED_MODES`, and it was missing for the same one.
 */
const PLAYED_MODES: readonly UiMode[] = ['play', 'draft'];

export const PLAY = `:is(${PLAYED_MODES.map((mode) => routeScope(mode)).join(', ')})`;

/** The printed 63:88 trim, as the value an `aspect-ratio` declaration takes. */
export const RATIO = `${cssNumber(CARD_TRIM_MM.width)} / ${cssNumber(CARD_TRIM_MM.height)}`;

/** The interactive face's hover lift, and the same lift on a tapped one. */
export const HOVER_SCALE = 1.03;

/**
 * The width at which the table stops affording three columns.
 *
 * `mat.ts` has drawn the two-column fallback below this since the mat was
 * written, `hand.ts` gates the short-table caps above it, and until `mtg-l4w0`
 * both were reading a number the third file had a private copy of. It is here
 * now for the reason the rest of this file is: one number, three readers.
 *
 * **Below it, the rail is the column that goes.** That was already `mat.ts`'s
 * sentence and it was not true on a played table: `fit.ts` re-states three
 * tracks under `TABLE .mtg-board`, a route-scoping ancestor selector, and a
 * media query adds no specificity, so the fallback lost to it on every fitted
 * route. Measured on a 844x390 landscape phone, the rail took 272px of the mat
 * while both battlefields and the hand shared 410px. The fix is not to win the
 * specificity fight — a fitted table has one grid row, so a wrapped rail would
 * break the height budget rather than fit under it — but to let the rail's own
 * collapse answer the question: `../../routes/play/rail-collapse.ts` reads this
 * as the default the player has not overridden, so a narrow table opens shut and
 * the disclosure still says what pressing it will do.
 */
export const THREE_COLUMN_MIN_WIDTH_PX = 901;

/**
 * That width as the media query both the sheet and the script ask.
 *
 * Written once for the reason `../../motion/reduced-motion.ts` writes its own
 * query once: a stylesheet and a script that ask different questions agree until
 * the day one of them is edited.
 */
export const NARROW_TABLE_QUERY = `(max-width: ${String(THREE_COLUMN_MIN_WIDTH_PX - 1)}px)`;

/**
 * And the height at which the table stops having room to spend on furniture.
 *
 * `mtg-l4w0`. Under this the two battlefield rows are both pinned at `fit.ts`'s
 * `SPELLS_ROW_MIN_REM` floor, which is the condition that makes every pixel of
 * page furniture a pixel of card: nothing on the table can give any more, so the
 * row takes its minimum and scrolls the rest away.
 *
 * Measured in chrome-headless-shell over `routes/play/PlayView.ts` at 844 CSS px
 * wide with the side panel shut and four permanents a side, sweeping the
 * viewport height. Both rows sit at 72px from 390 through 586 and come off the
 * floor at 588 (72.22px, and 73.22 at 590); a battlefield face is 61.44px flat
 * across that whole band and does not reach the portrait phone's 99.98 until
 * 760. So the floored band is the real thing to name, and 36rem is 576 — one
 * round step below the crossover rather than at it, because the crossover moves
 * with what the furniture above the rows costs, and this tier's whole job is to
 * make that cost smaller.
 *
 * Every landscape phone is well inside it: 390 to 430 CSS px of height across
 * the iPhone 14/15, the Pro Max sizes and the Pixel 7 Pro.
 */
export const SHORT_VIEWPORT_MAX_HEIGHT_REM = 36;

/** That height as a query. */
export const SHORT_VIEWPORT_QUERY = `(max-height: ${cssNumber(SHORT_VIEWPORT_MAX_HEIGHT_REM)}rem)`;

/**
 * Either one: a table with no room for a reference column beside the board.
 *
 * The rail costs 272px of width whatever the viewport, and there are two ways to
 * be unable to afford it. A narrow table has no width to give. A short table has
 * width and no height, and width is the only axis on this surface that turns
 * into a bigger card (`rail.ts`'s `PLAY_RAIL_SHUT_PX` carries that measurement),
 * so a short table needs the width *more* than a tall one does, not less.
 *
 * A landscape Pro Max is the case that makes the second half load-bearing: 932
 * CSS px wide is over `THREE_COLUMN_MIN_WIDTH_PX` and 430 tall is half the
 * height the three-column table was fitted to.
 *
 * Read by `../../routes/play/rail-collapse.ts` as the answer where the player
 * has given none. It is a default and not a rule: a press still wins.
 */
export const CRAMPED_TABLE_QUERY = `${NARROW_TABLE_QUERY}, ${SHORT_VIEWPORT_QUERY}`;
