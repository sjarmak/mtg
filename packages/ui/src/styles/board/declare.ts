/**
 * The staged combat declaration, inside the ask column.
 *
 * It declares no width, no column and no placement, for `./cast.ts`'s reason one
 * surface over: `.mtg-declare` is drawn inside `.mtg-choices`, so `./rail.ts`'s
 * column and `../views.ts`'s track sizing carry over unchanged and there is one
 * box on this surface to keep true rather than two. What is here is the inside —
 * the confirm over the roster, the rows, and the question that replaces them.
 *
 * **Every row is a `.mtg-choice`**, which is not decoration: that class is the
 * one `../touch.ts` floors at 44px under a coarse pointer, so a creature row on
 * a tablet is the same size as a move button, and a second class here would have
 * been a control the touch sheet does not know about. The rows carry the same
 * label-over-detail stack every move on this surface carries (`../views.ts`
 * argues that shape against the column's width), so a creature's name and what
 * it is doing wrap rather than ellipsizing each other.
 *
 * The only rule that is not spacing is the declared mark. A creature that is
 * attacking or blocking is drawn in the accent the surface already uses for the
 * thing under the cursor, keyed on `data-declared` — the same attribute the row
 * puts in its accessible name — because a highlight keyed on anything else is a
 * second answer to "is this creature blocking" that can disagree with the one a
 * screen reader hears. It weighs `0,2,0` against `.mtg-choice`'s `0,1,0`, so it
 * wins on specificity rather than on where this block sits, and the `:hover`
 * rule it would otherwise tie with is `.mtg-choice:hover` at `0,2,0` — kept
 * apart by this selector naming an attribute rather than a state, so hovering a
 * declared row still lights it.
 *
 * This block sits straight after `./rail.ts` for the reason `./cast.ts` sits
 * straight after `./picker.ts`: it styles the inside of that block's box, and a
 * reader looking for it will look there. It ties with nothing in the sheet, so
 * the position is where it reads rather than what makes it win.
 *
 * # What it cost the column, measured
 *
 * `../../tools/block-ask.ts` parks a real blocker declaration and reports the
 * ask panel's body. Read in chrome-headless-shell 151.0.7922.47 without
 * `--hide-scrollbars`, the same page before and after, one attacker throughout:
 *
 *   8 untapped creatures — 256 legal blocks
 *   viewport    controls        content px        wholly visible
 *   1440x900    256 -> 9        64,411 -> 609     3 -> 6
 *   1280x800    256 -> 9        71,723 -> 647     3 -> 4
 *   1024x768    256 -> 9       100,422 -> 817     1 -> 3
 *
 *   4 untapped creatures — 16 legal blocks
 *   1440x900     16 -> 5         2,474 -> 485     3 -> 5   (nothing hidden)
 *   1280x800     16 -> 5         2,795 -> 416     3 -> 4
 *   1024x768     16 -> 5         3,586 -> 510     1 -> 3
 *
 * The 1440x900 reading of the crowded board is `mtg-y1t`'s own to within a
 * rounding of the fixture (it measured 63,582px of content in a 449px body with
 * three moves painted whole), which is what makes this rig the same instrument
 * rather than a second opinion. Content fell by 106x on that board because the
 * list was 2^n labels of n clauses each — the tallest single control went from
 * 468.3px to 53.8px — and the roster is n+1 rows of two lines.
 *
 * The crowded board still hides 124px at 1440x900 and that is left hidden: it
 * is one flick of a scroll rather than a hundred and forty screens, and buying
 * it back would mean taking height from the card rows, which `./rail.ts`'s
 * ASK_PERCENT argues against for the whole surface rather than for this panel.
 */
export const DECLARE_CSS = `
.mtg-declare { display: flex; flex-direction: column; gap: var(--mtg-space-2); }
/* The creatures, in the order the kernel listed them. A tighter gap than the
   panel's, so the roster reads as one block under the confirm rather than as a
   second list of moves beside it. */
.mtg-declare__roster, .mtg-declare__answers {
  display: flex; flex-direction: column; gap: var(--mtg-space-1);
}
.mtg-declare__row[data-declared='true'], .mtg-declare__answer[data-declared='true'] {
  border-color: var(--mtg-accent); background: var(--mtg-accent-soft);
}
.mtg-declare__ask {
  margin: 0; font-size: var(--mtg-text-sm); color: var(--mtg-ink);
  overflow-wrap: break-word;
}
/* Why there is nothing to confirm yet. Muted rather than an alarm: a half-built
   block is a normal step on the way to a legal one, not an error the player
   made. */
.mtg-declare__note {
  margin: 0; font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted);
  overflow-wrap: break-word;
}
/* Chrome, so it takes the chrome button's width rather than a move's full-width
   bar: neither of these submits anything. */
.mtg-declare__clear, .mtg-declare__back { align-self: flex-start; }
`;
