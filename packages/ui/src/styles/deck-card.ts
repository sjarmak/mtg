/**
 * The deck card: one tile for a deck somebody might choose to play.
 *
 * One component, drawn identically wherever a deck is offered — the Play tab's
 * precon grid and the Decks library both. It was `.mtg-precon-tile` and lived
 * only on Play, so the Decks tab offered the same five decks as a row of pill
 * buttons and the two screens disagreed about what a deck looks like.
 *
 * A tile is a button and nothing else, so it inherits focus, press and disabled
 * behavior from the chrome sheet rather than restating them. What this file
 * adds is the shape a *decision* needs and a control does not: a left-aligned
 * block with room for a sentence, because the sentence is what tells the
 * decks apart and a row of names does not.
 *
 * # Stated columns rather than `auto-fit`
 *
 * It was `repeat(auto-fit, minmax(16rem, 1fr))`, which on the 1440-1600px window
 * this app is laid out for produced five columns of tiles too narrow to hold the
 * sentence the tile exists for. the playtester's instruction names the counts — "3
 * columns on desktop, 4 on very wide screens, 2 on tablet, 1 on mobile" — so the
 * breakpoints state them. A stated column count is also the only way to make the
 * grid agree with the rest of the pass: `auto-fit` derives its answer from a tile
 * floor, and the floor that gives three columns at 1440 gives two at 1100.
 *
 * # The chips and the matchup
 *
 * `.mtg-chip` is a selection, not an action, and the difference is the reason it
 * is not a `.mtg-btn[data-variant='primary']`: the primary fill is what *Play
 * against bot* wears, and lending it to the chosen opponent made the selection
 * look like the thing to press next.
 *
 * # Where a deck came from, as a stripe and a word
 *
 * `mtg-tewc.6` asks for preconstructed and user-made decks to be visually
 * distinct in one list. The word (`.mtg-deckcard__kind`) is the accessible half
 * and the stripe down the inline start is the half that works at a glance, and
 * both are drawn because neither is enough alone: a badge alone makes somebody
 * read three tiles to sort them, and a stripe alone is a hue carrying meaning,
 * which WCAG 1.4.1 refuses. The stripe is thick enough to read as a rail rather
 * than as a border that happens to be a different color, since the tile already
 * has a border and the selected state already moves its color.
 *
 * `.mtg-matchup` is the bar those two buttons live in, and it exists so they can
 * say what they would start. It is the last thing in the column, under both
 * choices, because reading it top to bottom is the sentence: this deck, that
 * opponent, play.
 */
const DECK_CARD = `
.mtg-deckcards {
  display: grid; gap: var(--mtg-space-3);
  grid-template-columns: 1fr;
}
@media (min-width: 40rem) { .mtg-deckcards { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 64rem) { .mtg-deckcards { grid-template-columns: repeat(3, 1fr); } }
@media (min-width: 112rem) { .mtg-deckcards { grid-template-columns: repeat(4, 1fr); } }
.mtg-deckcard {
  appearance: none; cursor: pointer; font: inherit; text-align: left; text-decoration: none;
  display: flex; flex-direction: column; gap: var(--mtg-space-2);
  padding: var(--mtg-space-3);
  border: 1px solid var(--mtg-line-strong); border-radius: var(--mtg-radius-md);
  background: var(--mtg-surface-raised); color: var(--mtg-ink);
  transition: border-color var(--mtg-duration-fast) var(--mtg-ease);
}
.mtg-deckcard:hover { border-color: var(--mtg-accent); }
.mtg-deckcard[data-selected='true'] {
  border-color: var(--mtg-accent); background: var(--mtg-accent-soft);
}
.mtg-deckcard__head { display: flex; align-items: baseline; gap: var(--mtg-space-2); }
.mtg-deckcard__name { font-weight: 600; }
.mtg-deckcard__colors {
  margin-left: auto; display: inline-flex; align-items: center; gap: 2px;
  font-size: var(--mtg-text-sm); color: var(--mtg-ink-faint);
}
.mtg-deckcard__kind {
  ${MICRO_LABEL}
  color: var(--mtg-ink-faint);
}
.mtg-deckcard[data-kind] { border-inline-start-width: 4px; }
.mtg-deckcard[data-kind='precon'] { border-inline-start-color: var(--mtg-ink-faint); }
.mtg-deckcard[data-kind='saved'] { border-inline-start-color: var(--mtg-accent); }
.mtg-deckcard[data-kind='artifact'] { border-inline-start-color: var(--mtg-line-strong); }
/* The fourth stripe. "--mtg-positive" rather than a fourth neutral: a variation
   is the only kind on this tab that a model wrote, and the three grays were
   already spent on the three a person or a file did. */
.mtg-deckcard[data-kind='variation'] { border-inline-start-color: var(--mtg-positive); }
/* A precon's plan is one clause its author wrote to fit a tile. A variation's is
   the person's own prompt, which is however long they typed: measured on the
   running lab, Alaric-v1's ran 396 characters and drew a tile twice the height of
   the two beside it in the same grid row, which is what breaks a grid of tiles.
   Clamped rather than truncated in the markup, so the tile keeps the whole
   sentence for a screen reader and for anyone who opens the deck, where the form
   shows it in full. */
.mtg-deckcard__plan {
  font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted);
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3;
  line-clamp: 3; overflow: hidden;
}
.mtg-deckcard__payoff { font-size: var(--mtg-text-sm); color: var(--mtg-ink); }
.mtg-deckcard__counts { font-size: var(--mtg-text-sm); color: var(--mtg-ink-faint); }

.mtg-chips { display: flex; flex-wrap: wrap; gap: var(--mtg-space-2); }
.mtg-chip {
  appearance: none; cursor: pointer; font: inherit; font-size: var(--mtg-text-sm);
  display: inline-flex; align-items: center; min-block-size: 2rem;
  padding: 0 var(--mtg-space-3);
  border: 1px solid var(--mtg-line-strong); border-radius: var(--mtg-radius-pill);
  background: var(--mtg-surface-raised); color: var(--mtg-ink-muted);
  transition: border-color var(--mtg-duration-fast) var(--mtg-ease);
}
.mtg-chip:hover:not(:disabled) { border-color: var(--mtg-accent); }
.mtg-chip:disabled {
  cursor: not-allowed; border-color: var(--mtg-line);
  background: var(--mtg-surface-sunken); color: var(--mtg-ink-faint);
}
.mtg-chip[data-selected='true'] {
  border-color: var(--mtg-accent); background: var(--mtg-accent-soft);
  color: var(--mtg-ink); font-weight: 600;
}
.mtg-matchup {
  display: flex; flex-wrap: wrap; align-items: center;
  gap: var(--mtg-space-2) var(--mtg-space-3);
  padding-block-start: var(--mtg-space-3);
  border-block-start: 1px solid var(--mtg-line);
}
.mtg-matchup__line {
  margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--mtg-space-2);
}
.mtg-matchup__deck { font-weight: 600; }
.mtg-matchup__vs {
  ${MICRO_LABEL}
  color: var(--mtg-ink-faint);
}
.mtg-matchup__actions {
  margin-inline-start: auto; display: flex; flex-wrap: wrap; gap: var(--mtg-space-2);
}
`;

import { MICRO_LABEL } from './number';

export const DECK_CARD_CSS = DECK_CARD;
