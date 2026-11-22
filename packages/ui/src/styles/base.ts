/**
 * Chrome: reset, app shell, and the shared control vocabulary every mode uses.
 *
 * One button shape, one panel shape, one table shape, and a segmented control
 * for the three modes. Product-register discipline: the same affordance looks
 * the same on every route, so the tool disappears into the task.
 */
import { MICRO_LABEL } from './number';
import { PLAY } from './board/geometry';

/**
 * The declarations that take a box out of the drawing and leave it in the
 * reading, as a string, because a second caller needs the same eight.
 *
 * `./mobile.ts` applies them to the play route's page title on a short viewport,
 * where the word "Play" over the Play tab costs a phone 27px of a 194px mat and
 * says nothing a player looking at a board does not already know. A screen
 * reader still reads the heading, which is the whole reason this is not
 * `display: none`; the docblock on `.mtg-sr-only` below has the rest.
 */
const SPOKEN_NOT_DRAWN =
  'position: fixed; top: 0; left: 0; width: 1px; height: 1px; padding: 0; ' +
  'margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;';

const RESET = `
*, *::before, *::after { box-sizing: border-box; }
html, body, #root { height: 100%; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--mtg-surface-page);
  color: var(--mtg-ink);
  font-family: var(--mtg-font-ui);
  font-size: var(--mtg-text-base);
  line-height: var(--mtg-leading-normal);
  -webkit-font-smoothing: antialiased;
}
:focus-visible { outline: 2px solid var(--mtg-accent); outline-offset: 2px; border-radius: var(--mtg-radius-sm); }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition-duration: 1ms !important; animation-duration: 1ms !important; }
}
`;

/*
 * The shell paints the ground and the ink it sits on rather than inheriting
 * them from `body`, and that is load-bearing rather than tidy. The shell root
 * is the element `styles/tokens.ts` hangs a route palette on, and `body` is
 * outside it: a route that re-values `--mtg-surface-page` and `--mtg-ink` would
 * otherwise get its own tokens for everything it draws and the page's ground
 * and its inherited text color from the theme it was overriding — paper cards
 * on a dark ground, in dark-mode ink. Repainting here costs nothing on the four
 * routes that re-value neither, since both declarations resolve to exactly what
 * `body` already set.
 */
const SHELL = `
.mtg-shell {
  display: flex; flex-direction: column; min-height: 100%;
  background: var(--mtg-surface-page); color: var(--mtg-ink);
}
.mtg-shell__bar {
  display: flex; align-items: center; gap: var(--mtg-space-5);
  padding: var(--mtg-space-3) var(--mtg-space-5);
  background: var(--mtg-surface-rail);
  border-bottom: 1px solid var(--mtg-line);
  position: sticky; top: 0; z-index: 2;
}
/* The mark is an anchor now (\`mtg-aqxi.17\`): the way back to Play, drawn as the
   caption it used to be, so color and underline come off. Its finger floor is
   \`./touch.ts\`'s, with the other controls, rather than a \`min-height\` here that
   would make every desktop bar 20px taller. */
.mtg-shell__mark {
  display: flex; align-items: center; gap: var(--mtg-space-2);
  color: inherit; text-decoration: none; cursor: pointer;
}
.mtg-shell__mark:hover .mtg-shell__title { color: var(--mtg-accent); }
.mtg-shell__title { font-size: var(--mtg-text-base); font-weight: 600; letter-spacing: -0.01em; }
.mtg-shell__spacer { flex: 1; }
/* Under the bar on every route, the play route included, because that is the
   route where an undisclosed reduced set does the most damage. Not sticky: it is
   read once, and a table already on a height budget should not pay for it on
   every scroll. */
.mtg-shell__notice {
  margin: 0;
  padding: var(--mtg-space-2) var(--mtg-space-5);
  background: var(--mtg-surface-inset);
  border-bottom: 1px solid var(--mtg-line);
  font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted);
}
/* Which set the page is showing. In the bar rather than on a tab, because every
   tab reads the staged set; see ../app/SetPicker.ts. A zero min-width on the
   select so a long set name shrinks the control instead of pushing the mode
   switch off the bar. */
.mtg-setpick { display: inline-flex; align-items: center; gap: var(--mtg-space-2); min-width: 0; }
/* Spoken, not drawn. The control's accessible name has to say what the choice is
   *of* — "the flagship set" alone is a proper noun a screen reader cannot place
   — but a drawn SET: doubles the width of the widest thing in the header and
   says nothing a person looking at a set's name does not already know. */
.mtg-setpick__label { ${SPOKEN_NOT_DRAWN} }
.mtg-setpick__name { font-size: var(--mtg-text-sm); font-weight: 600; color: var(--mtg-ink); }
.mtg-setpick__select { min-width: 0; max-width: 22rem; }
/* The two routes that draw a table are on a height budget, and the bar gives its
   height back to them (the compressed bar rule below). A select is the tallest
   thing in the bar, so on those routes it is drawn at the compressed bar's own
   metrics rather than growing the bar back to where it was. */
.mtg-shell${PLAY} .mtg-setpick__select {
  font-size: var(--mtg-text-xs);
  padding: 0 var(--mtg-space-1);
  max-width: 14rem;
}
.mtg-shell__main { flex: 1; padding: var(--mtg-space-5); }
.mtg-shell__main > * + * { margin-top: var(--mtg-space-5); }
.mtg-shell${PLAY} .mtg-shell__bar {
  gap: var(--mtg-space-2);
  padding: 0 var(--mtg-space-3);
  border-bottom: 0;
}
@media (max-width: 720px) {
  .mtg-shell__bar { flex-wrap: wrap; gap: var(--mtg-space-3); padding: var(--mtg-space-3); }
  .mtg-shell__main { padding: var(--mtg-space-3); }
}
/* The same compaction, asked for on the axis a phone held sideways is short on.
   844x390 is a desktop width by every query on this sheet, so a landscape phone
   was handed 24px of page padding and 24px between every block on the tallest
   thing it owns: measured on the Cards tab, the first card tile's top was 219.6
   in a 390px viewport, 56% of the screen spent on chrome before a card. The
   width queries cannot see that, because nothing about it is narrow. */
@media (max-height: 520px) {
  .mtg-shell__main { padding: var(--mtg-space-3); }
  .mtg-shell__main > * + * { margin-top: var(--mtg-space-3); }
}
`;

const MODES = `
.mtg-modes { display: inline-flex; padding: 2px; gap: 2px; background: var(--mtg-surface-inset); border-radius: var(--mtg-radius-md); }
.mtg-modes__item {
  border: 0; cursor: pointer; text-decoration: none;
  padding: var(--mtg-space-1) var(--mtg-space-3);
  font: inherit; font-size: var(--mtg-text-sm); line-height: inherit; font-weight: 500;
  color: var(--mtg-ink-muted); background: transparent;
  border-radius: var(--mtg-radius-sm);
  transition: color var(--mtg-duration-fast) var(--mtg-ease), background var(--mtg-duration-fast) var(--mtg-ease);
}
.mtg-modes__item:hover { color: var(--mtg-ink); }
.mtg-modes__item:active { background: var(--mtg-surface-sunken); }
.mtg-modes__item[aria-current='page'] {
  background: var(--mtg-surface-raised); color: var(--mtg-ink);
  box-shadow: var(--mtg-shadow-raised); font-weight: 600;
}
.mtg-subs {
  display: flex; flex-wrap: wrap; gap: var(--mtg-space-1);
  padding: 0 var(--mtg-space-4);
  border-bottom: 1px solid var(--mtg-line);
  background: var(--mtg-surface-page);
}
.mtg-subs__item {
  position: relative; text-decoration: none;
  padding: var(--mtg-space-1) var(--mtg-space-2);
  font-size: var(--mtg-text-sm); line-height: inherit; font-weight: 500;
  color: var(--mtg-ink-muted);
  transition: color var(--mtg-duration-fast) var(--mtg-ease);
}
.mtg-subs__item:hover { color: var(--mtg-ink); }
.mtg-subs__item[aria-current='page'] { color: var(--mtg-ink); font-weight: 600; }
.mtg-subs__item[aria-current='page']::after {
  content: ''; position: absolute; inset-inline: 0; inset-block-end: 0;
  height: 2px; background: var(--mtg-accent);
}
${PLAY} .mtg-subs { border-bottom: 0; }
/* The section row is chrome the short-viewport compaction above cannot reach:
   it sits beside .mtg-shell__main rather than inside it, so shrinking main's
   own padding never touches it. Measured on the Cards tab at 844x390, the row
   held its full-size padding while everything under it compacted, and the
   first card tile landed 8.6px past this sheet's own chrome budget. */
@media (max-height: 520px) {
  .mtg-modes__item, .mtg-subs__item { padding-block: 0; }
}
`;

const CONTROLS = `
.mtg-btn {
  appearance: none; cursor: pointer; font: inherit; font-size: var(--mtg-text-sm); font-weight: 500;
  padding: var(--mtg-space-1) var(--mtg-space-3);
  border: 1px solid var(--mtg-line-strong); border-radius: var(--mtg-radius-md);
  background: var(--mtg-surface-raised); color: var(--mtg-ink);
  transition: border-color var(--mtg-duration-fast) var(--mtg-ease), background var(--mtg-duration-fast) var(--mtg-ease);
}
.mtg-btn:hover:not(:disabled) { border-color: var(--mtg-accent); }
.mtg-btn:active:not(:disabled) { background: var(--mtg-surface-sunken); }
.mtg-btn[data-variant='primary'] { background: var(--mtg-accent); border-color: var(--mtg-accent); color: var(--mtg-accent-ink); }
.mtg-btn[data-variant='primary']:hover:not(:disabled) { background: var(--mtg-accent-hover); border-color: var(--mtg-accent-hover); }
.mtg-btn[aria-pressed='true'] { background: var(--mtg-accent-soft); border-color: var(--mtg-accent); color: var(--mtg-ink); }
/* Last, so it beats the variant and pressed rules above: a disabled primary is
   disabled first and primary second. The legal-move row in views.ts orders its
   own disabled rule the same way for the same reason. The sealed builder's
   "Play this deck" spends most of its life disabled and must not keep the
   accent fill while it does nothing. */
.mtg-btn:disabled { color: var(--mtg-ink-faint); cursor: not-allowed; background: var(--mtg-surface-sunken); border-color: var(--mtg-line); }

/* A game's technical name, folded shut wherever one is offered: the sealed
   builder's toolbar and the replay toolbar draw the same disclosure, which is
   the point (\`../routes/game-details.ts\`). The values are strings a person
   copies rather than reads, so they are monospaced, and the whole thing is the
   size of a note because nothing in it is a control. */
.mtg-gamedetails { font-size: var(--mtg-text-xs); }
.mtg-gamedetails > summary { cursor: pointer; color: var(--mtg-ink-muted); padding: var(--mtg-space-1) 0; }
.mtg-gamedetails[open] > summary { color: var(--mtg-ink); }
.mtg-gamedetails__list {
  display: grid; grid-template-columns: auto minmax(0, 1fr);
  gap: var(--mtg-space-1) var(--mtg-space-3);
  margin: var(--mtg-space-1) 0 0;
  color: var(--mtg-ink-muted);
}
.mtg-gamedetails__list dt { color: var(--mtg-ink-faint); }
.mtg-gamedetails__list dd { margin: 0; font-family: var(--mtg-font-mono); overflow-wrap: anywhere; }

/* A text field in a toolbar, sized and colored off the button beside it so the
   pool search does not read as a foreign control dropped into the row. The
   width is a floor rather than a fixed size: it has to hold a card name, and a
   narrow toolbar is allowed to give it less. */
.mtg-input {
  appearance: none; font: inherit; font-size: var(--mtg-text-sm);
  padding: var(--mtg-space-1) var(--mtg-space-2);
  min-width: 12rem; max-width: 100%;
  border: 1px solid var(--mtg-line-strong); border-radius: var(--mtg-radius-md);
  background: var(--mtg-surface-sunken); color: var(--mtg-ink);
}
.mtg-input:focus-visible { outline: 2px solid var(--mtg-accent); outline-offset: 1px; }
.mtg-input::placeholder { color: var(--mtg-ink-faint); }

/* A card face in the Constructed builder, with its copy count under it. The
   count is outside the face because a full face has no foot to put it in. */
.mtg-copies { display: flex; flex-direction: column; gap: var(--mtg-space-1); align-items: center; }
.mtg-copies__count { font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted); }
/* The face the next move acts on, in the Constructed collection (mtg-d0y1). A
   click there reads a card rather than playing one, so the outline is what says
   which card the double click and the right click are about. The face's own
   selected state still means "played in the deck", which is a different fact
   about a different pile and stays separately visible. */
.mtg-copies[data-picked='true'] {
  outline: 2px solid var(--mtg-accent); outline-offset: 2px; border-radius: var(--mtg-radius-sm);
}

.mtg-panel {
  background: var(--mtg-surface-raised);
  border: 1px solid var(--mtg-line);
  border-radius: var(--mtg-radius-lg);
}
.mtg-panel__head {
  display: flex; align-items: baseline; gap: var(--mtg-space-3);
  padding: var(--mtg-space-3) var(--mtg-space-4);
  border-bottom: 1px solid var(--mtg-line);
}
.mtg-panel__title { font-size: var(--mtg-text-sm); font-weight: 600; letter-spacing: 0.01em; }
.mtg-panel__note { font-size: var(--mtg-text-xs); color: var(--mtg-ink-faint); }
.mtg-panel__body { padding: var(--mtg-space-4); }

.mtg-empty {
  display: flex; flex-direction: column; gap: var(--mtg-space-2);
  padding: var(--mtg-space-6) var(--mtg-space-5);
  border: 1px dashed var(--mtg-line-strong); border-radius: var(--mtg-radius-lg);
  background: var(--mtg-surface-sunken); max-width: var(--mtg-measure);
}
.mtg-empty__title { font-weight: 600; }
.mtg-empty__body { color: var(--mtg-ink-muted); font-size: var(--mtg-text-sm); }

.mtg-badge {
  display: inline-flex; align-items: center; gap: var(--mtg-space-1);
  padding: 1px var(--mtg-space-2); border-radius: var(--mtg-radius-pill);
  font-size: var(--mtg-text-xs); font-weight: 600; letter-spacing: 0.02em;
  background: var(--mtg-surface-inset); color: var(--mtg-ink-muted);
}
.mtg-badge[data-tone='positive'] { color: var(--mtg-positive); }
.mtg-badge[data-tone='negative'] { color: var(--mtg-negative); }
.mtg-badge[data-tone='pending'] { color: var(--mtg-pending); }

.mtg-num { font-family: var(--mtg-font-mono); font-variant-numeric: tabular-nums; }

.mtg-code {
  font-family: var(--mtg-font-mono); font-size: 0.9em;
  padding: 1px var(--mtg-space-1); border-radius: var(--mtg-radius-sm);
  background: var(--mtg-surface-inset); color: var(--mtg-ink);
}

.mtg-table { width: 100%; border-collapse: collapse; font-size: var(--mtg-text-sm); }
.mtg-table th, .mtg-table td { padding: var(--mtg-space-2) var(--mtg-space-3); text-align: left; }
.mtg-table th {
  ${MICRO_LABEL}
  color: var(--mtg-ink-faint); border-bottom: 1px solid var(--mtg-line);
}
.mtg-table td { border-bottom: 1px solid var(--mtg-line); }
.mtg-table tbody tr:last-child td { border-bottom: 0; }
.mtg-table td[data-align='right'], .mtg-table th[data-align='right'] { text-align: right; }
.mtg-scroll { overflow-x: auto; }
/*
 * Spoken, never drawn.
 *
 * The clip-rect recipe rather than display:none or visibility:hidden, both of
 * which take the element out of the accessibility tree along with the pixels and
 * would make a live region announce nothing at all. Kept 1px rather than 0 for
 * the same reason, and the nowrap so a long sentence is not collapsed into a
 * one-character column before it is read.
 *
 * Four callers, all live regions: the game log's digest (src/log/GameLog.ts),
 * the priority foot, the ask flyout and the beat narrator. Each has to be in the
 * document before its text changes.
 *
 * Fixed rather than absolute, and pinned rather than left where it fell. An
 * absolute box with no offsets sits at its static position, and a 1px box below
 * the fold is scrollable overflow like any other: measured at 844x390 over
 * test/play/landscape-phone.browser.test.ts, the priority foot's region landed
 * at y=492.9 inside a scrolling column and gave the page a 104px scrollbar with
 * every visible thing already fitting. A fixed box contributes to no scroll area
 * at all, and src/routes/play/PlayView.ts records that the element these hang
 * under declares no transform, filter or containment, which is what keeps fixed
 * meaning the viewport here.
 */
.mtg-sr-only { ${SPOKEN_NOT_DRAWN} }
`;

export { SPOKEN_NOT_DRAWN };

export const BASE_CSS = `${RESET}${SHELL}${MODES}${CONTROLS}`;
