/**
 * The deck workbench's layout: what you are asking for on the left, what you
 * got on the right.
 *
 * Two columns for the reason the set designer's two columns exist, one lane
 * over: the argument for this being a surface rather than a command line is that
 * the answer stays visible while the question is edited. A finished deck on a
 * second screen, or below a fold, is a thing you go and look at, which costs the
 * same as re-running the CLI.
 *
 * The left column is a scroll of its own rather than a fixed form, because the
 * form and the shelf share it and a session's shelf grows without bound. The
 * right column is the deck, which is the tall thing. Under 60rem it is one
 * column and the deck follows the form, because a 390px phone has one column
 * whatever the argument.
 *
 * **Each column is a box with its own scrollbar, and that is not a preference.**
 * This screen is drawn inside `../routes/deck/deck-screen.ts`, whose frame
 * contract (`mtg-nuk3`, stated in `./deck.ts`) is that the route never scrolls:
 * `.mtg-work__scroll` is \`overflow: hidden\` and the panes inside it are boxes
 * that scroll themselves. Written without that, this screen's columns simply
 * grew past the clipped frame — measured on the running lab at 1600x1000 with
 * three variations on the shelf, the left column was 1874px tall inside an 836px
 * box, and every field below Power band, the name box, **the build button** and
 * the whole shelf were cut off with no scrollbar anywhere on the page. A form
 * whose submit button cannot be reached with a mouse is the failure this comment
 * exists to prevent a second time.
 *
 * `data-refused`, `data-selected` and `data-resolved` are attributes rather than
 * classes, following `./design.ts`: a field's markup does not change shape
 * between its states, so nothing reflows when a refusal arrives. Color is never
 * the whole signal — a refused field also carries its sentence, and an
 * unresolved citation carries its title — because a red border says something is
 * wrong and never says what.
 */
export const WORKBENCH_CSS = `
.mtg-workbench { display: flex; flex-direction: column; flex: 1 1 auto; min-block-size: 0; }
.mtg-workbench__panes {
  display: grid; gap: var(--mtg-space-4);
  grid-template-columns: minmax(0, 24rem) minmax(0, 1fr);
  align-items: stretch; flex: 1 1 auto; min-block-size: 0;
}
/* The scrollports. "min-block-size: 0" is what makes "overflow" mean anything
   inside a grid track: a grid item's automatic minimum size is its content, so
   a column of ten fields refuses to be shorter than ten fields without it, and
   the box grows instead of scrolling. Same note as "./deck.ts"'s panes. */
.mtg-workbench__left,
.mtg-workbench__right {
  display: flex; flex-direction: column; gap: var(--mtg-space-4);
  min-inline-size: 0; min-block-size: 0; overflow-y: auto;
  /* Asymmetric on purpose, and each side clears a different thing. The end pads
     the scrollbar. The start pads the FOCUS RING: "overflow-y: auto" forces the
     used "overflow-x" to "auto" as well, so this box clips its own start edge,
     and every control in the column sits flush against it. Measured on the
     running lab, focusing the prompt box drew a ring closed on three sides and
     flat on the fourth -- "base.ts"'s ".mtg-input:focus-visible" is 2px at a 1px
     offset, so exactly 3px of it fell outside the pane and was cut. 4px is that
     3px with a pixel to spare, and it applies to the chips and the number boxes
     too: they are flush at the same edge and lost the same 3px. */
  padding-inline: var(--mtg-space-1) var(--mtg-space-2);
}
/* Stacked, the scroll moves up one box: the panes grid becomes the single
   scrollport and the columns go back to growing inside it.
   "./deck.ts" splits its two panes evenly at this width and is right to, because
   both of its panes are cards. One of these is a form somebody fills once and
   stops looking at, and splitting evenly was measured at 900x800: two 310px
   boxes, the first card row 640px into the deck box's own scroll, so **zero**
   cards on screen and three and a half of eleven fields. One scroll, form then
   deck, is what the header paragraph above always said this width does. */
@media (max-width: 60rem) {
  .mtg-workbench__panes {
    grid-template-columns: minmax(0, 1fr);
    align-items: start; overflow-y: auto;
  }
  .mtg-workbench__left,
  .mtg-workbench__right { overflow-y: visible; min-block-size: auto; }
}

.mtg-workbench__form { display: flex; flex-direction: column; gap: var(--mtg-space-3); }
/* No "flex" of its own. It carried "flex: 1 1 7rem", which reads as a width for
   the four number boxes and is not one: the form is a flex *column*, so 7rem was
   a floor on every field's HEIGHT. Measured on the running lab, Archetype,
   Themes, Power band and the name box were each 112px tall around a 40px input,
   which is about 300 pixels of nothing in a column that already overflowed. */
.mtg-workbench__field { display: flex; flex-direction: column; gap: var(--mtg-space-1); min-inline-size: 0; }
/* The four number fields, side by side and wrapping. Named for what it holds
   rather than for its shape: this was ".mtg-workbench__row" until the shelf's
   row rule below landed under the same name in this same sheet, won on source
   order, and drew the four boxes as one bordered clickable-looking column
   1200px tall. One class, one rule: "../../test/panel/sheet-ownership.test.ts"
   grew a second check for this, because the one it had could only see a class
   styled from two sheets and this was one sheet contradicting itself. */
.mtg-workbench__numbers {
  display: grid; gap: var(--mtg-space-3); align-items: start;
  grid-template-columns: repeat(auto-fit, minmax(min(9rem, 100%), 1fr));
}
/* "minmax(min(9rem, 100%), 1fr)" rather than a bare rem, which
   "../../test/touch-sheet.test.ts" bans for the grids it names: a bare floor
   refuses to shrink below itself, so in a 361px column the three boxes on the
   first line were 20 pixels wider than the box holding them and the pane grew a
   sideways scrollbar. An input carries its own intrinsic width, so it is told
   to take the cell rather than its content. */
.mtg-workbench__numbers .mtg-input { inline-size: 100%; min-inline-size: 0; }
/* Muted rather than faint. Measured on the running page, "--mtg-ink-faint"
   against this route's own ground comes out at 2.88:1, which misses even the
   3:1 large-text bar, and it was the color of every form hint, every meta line,
   all 69 criterion chips and every type line and cost. Faint is for something a
   reader may skip; a sentence stating a rule the control cannot is not that.
   "--mtg-ink-muted" measures 6.61:1 on the same ground. */
.mtg-workbench__hint { margin: 0; font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted); }
.mtg-workbench__issues { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; }
.mtg-workbench__issue { font-size: var(--mtg-text-sm); color: var(--mtg-negative); }
.mtg-workbench__refusal {
  margin: 0; padding: var(--mtg-space-2);
  border: 1px solid var(--mtg-negative); border-radius: var(--mtg-radius-sm);
  font-size: var(--mtg-text-sm); color: var(--mtg-negative);
}

/* The build control and its one disabled state, which is a deliberate
   arrangement rather than a failure and is drawn as a sentence, not a tooltip.
   Pinned to the bottom of the left pane rather than sitting at the end of its
   scroll. Measured before this, at three viewports, the primary action of the
   whole screen was 453px / 410px / 463px below the fold of a column the reader
   had to discover a scrollbar in, and pressing "Change something and rebuild" in
   the other pane moved it further down without scrolling anything into view. The
   block is 91px in an 836px pane, so the cost is nothing and the button is
   always there. Opaque, because the fields scroll under it. */
.mtg-workbench__build {
  display: flex; flex-direction: column; gap: var(--mtg-space-2);
  position: sticky; inset-block-end: 0; z-index: 1;
  padding-block: var(--mtg-space-3);
  border-block-start: 1px solid var(--mtg-line);
  /* The pane's own ground, which "--mtg-work__scroll" paints and this has to
     match exactly: written as "--mtg-surface", a token that does not exist, the
     background resolved to transparent and the fields scrolled visibly through
     the pinned block. */
  background: var(--mtg-surface-sunken);
}
.mtg-workbench__unarmed { display: flex; flex-direction: column; gap: var(--mtg-space-1); }

.mtg-chip__note { margin-inline-start: var(--mtg-space-1); font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted); }

/* The shelf. A row is a button because selecting one is the whole of its job. */
.mtg-workbench__shelf { display: flex; flex-direction: column; gap: var(--mtg-space-2); }
.mtg-workbench__shelf-title { margin: 0; font-size: var(--mtg-text-md); }
.mtg-workbench__rows { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--mtg-space-1); }
.mtg-workbench__row {
  inline-size: 100%; display: flex; flex-direction: column; gap: 2px; text-align: start;
  padding: var(--mtg-space-2);
  border: 1px solid var(--mtg-line); border-radius: var(--mtg-radius-sm);
  background: var(--mtg-surface-sunken); color: inherit; cursor: pointer;
  /* A button element takes the user agent's Arial and 13.33px unless it is told
     otherwise, which every other button-shaped control in this app says
     ("./base.ts"'s ".mtg-btn", ".mtg-chip", "./views.ts"'s ".mtg-modes__item").
     Measured before this: "Sky lane" on the shelf and "Sky lane" as the deck's
     heading were two different typefaces one column apart. */
  font: inherit; appearance: none;
}
.mtg-workbench__row[data-selected='true'] { border-color: var(--mtg-accent); background: var(--mtg-surface-raised); }
.mtg-workbench__row-name { font-weight: 600; }
.mtg-workbench__row-meta,
.mtg-workbench__row-parent { font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted); }
.mtg-workbench__row-short { font-size: var(--mtg-text-sm); color: var(--mtg-negative); }
.mtg-workbench__row-cost { font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted); font-variant-numeric: tabular-nums; }

/* The deck itself. */
.mtg-workbench__variation { display: flex; flex-direction: column; gap: var(--mtg-space-4); }
.mtg-workbench__variation-head { display: flex; flex-direction: column; gap: var(--mtg-space-2); }
.mtg-workbench__variation-name { margin: 0; font-size: var(--mtg-text-lg); }
.mtg-workbench__variation-meta { margin: 0; font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted); }
.mtg-workbench__variation-cost { margin: 0; font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted); font-variant-numeric: tabular-nums; }
.mtg-workbench__variation-actions { display: flex; flex-wrap: wrap; gap: var(--mtg-space-2); }
/* Who to play against, beside the button rather than under it: choosing an
   opponent and pressing play is one gesture. */
.mtg-workbench__opponent { display: inline-flex; align-items: center; gap: var(--mtg-space-2); min-width: 0; }
.mtg-workbench__opponent-label { font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted); }
/* The lineage line's link back. A button because it selects rather than
   navigates, drawn as text because it is a sentence and not a control. */
.mtg-workbench__parent {
  font: inherit; appearance: none; padding: 0; border: 0; background: none;
  color: var(--mtg-accent); text-decoration: underline; cursor: pointer;
}
.mtg-workbench__section { display: flex; flex-direction: column; gap: var(--mtg-space-2); }
.mtg-workbench__section-title { margin: 0; font-size: var(--mtg-text-md); }
/* A measure. Measured before this, the plan ran 156 / 153 / 80 characters over
   a 1135px pane at 15px, which is twice a comfortable line and the one paragraph
   explaining what the deck is trying to do. */
.mtg-workbench__plan { margin: 0; max-inline-size: 62ch; }
.mtg-workbench__shortfalls {
  margin: 0; padding-inline-start: var(--mtg-space-4);
  max-inline-size: 78ch; color: var(--mtg-negative);
}
.mtg-workbench__basics { margin: 0; font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted); }

.mtg-workbench__deck { display: flex; flex-direction: column; gap: var(--mtg-space-2); }
.mtg-workbench__deck-head { display: flex; justify-content: flex-end; }
.mtg-workbench__deck .mtg-builder-curve[data-flow='rows'] .mtg-deck__column {
  grid-template-columns: repeat(auto-fill, minmax(min(18rem, 100%), 1fr));
}
.mtg-workbench__entry {
  display: flex; flex-direction: column; gap: 2px;
  padding: var(--mtg-space-2);
  border: 1px solid var(--mtg-line); border-radius: var(--mtg-radius-sm);
}
.mtg-workbench__entry-head { display: flex; flex-wrap: wrap; gap: var(--mtg-space-2); align-items: baseline; }
.mtg-workbench__entry-count { font-variant-numeric: tabular-nums; color: var(--mtg-ink-muted); }
.mtg-workbench__entry-name { font-weight: 600; }
.mtg-workbench__entry-cost { font-size: var(--mtg-text-sm); }
.mtg-workbench__entry-type { font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted); }
.mtg-workbench__entry-reason { margin: 0; font-size: var(--mtg-text-sm); }
.mtg-workbench__cites { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: var(--mtg-space-1); }
.mtg-workbench__cite {
  font-size: var(--mtg-text-sm); font-family: var(--mtg-font-mono, monospace);
  padding: 0 var(--mtg-space-1); border-radius: var(--mtg-radius-sm);
  background: var(--mtg-surface-sunken); color: var(--mtg-ink-muted);
}
/* A citation of an id nobody stated. Marked rather than hidden: it is a defect,
   and hiding it is how it survives. */
.mtg-workbench__cite[data-resolved='false'] { color: var(--mtg-negative); border: 1px solid var(--mtg-negative); }
/* The criteria every row shares, stated once above the rows. These are the
   person's own sentences rather than ids, so they read in the body face. */
.mtg-workbench__shared { display: flex; flex-direction: column; gap: var(--mtg-space-1); }
.mtg-workbench__shared-lead { font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted); }
.mtg-workbench__shared .mtg-workbench__cite { font-family: inherit; }

/* "align-self: start" because the section is a flex column, whose default
   stretch blew a table of five numbers out to the full 1135px pane: 83px of ink
   per row, and a 703px eye traverse from the color to its own castability. */
.mtg-workbench__mana {
  border-collapse: collapse; font-size: var(--mtg-text-sm);
  inline-size: auto; align-self: start;
}
.mtg-workbench__mana th,
.mtg-workbench__mana td { text-align: start; padding: var(--mtg-space-1) var(--mtg-space-2); border-block-end: 1px solid var(--mtg-line); }
.mtg-workbench__mana td { font-variant-numeric: tabular-nums; }
.mtg-workbench__mana tr[data-meets='false'] td { color: var(--mtg-negative); }
`;
