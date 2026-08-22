/**
 * The preconstructed-deck picker: one tile for every staged deck.
 *
 * A tile is a button and nothing else, so it inherits focus, press and disabled
 * behavior from the chrome sheet rather than restating them. What this file
 * adds is the shape a *decision* needs and a control does not: a left-aligned
 * block with room for a sentence, because the sentence is what tells the
 * decks apart and a row of names does not.
 *
 * `auto-fit` with a floor rather than a fixed four columns: the number of decks
 * is whatever the staged file holds, and a narrow window should stack them
 * rather than crush them.
 */
const PRECON = `
.mtg-precon-tiles {
  display: grid; gap: var(--mtg-space-3);
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
}
.mtg-precon-tile {
  appearance: none; cursor: pointer; font: inherit; text-align: left;
  display: flex; flex-direction: column; gap: var(--mtg-space-2);
  padding: var(--mtg-space-3);
  border: 1px solid var(--mtg-line-strong); border-radius: var(--mtg-radius-md);
  background: var(--mtg-surface-raised); color: var(--mtg-ink);
  transition: border-color var(--mtg-duration-fast) var(--mtg-ease);
}
.mtg-precon-tile:hover { border-color: var(--mtg-accent); }
.mtg-precon-tile[data-selected='true'] {
  border-color: var(--mtg-accent); background: var(--mtg-accent-soft);
}
.mtg-precon-tile__head { display: flex; align-items: baseline; gap: var(--mtg-space-2); }
.mtg-precon-tile__name { font-weight: 600; }
.mtg-precon-tile__colors {
  margin-left: auto; font-size: var(--mtg-text-sm); color: var(--mtg-ink-faint);
  letter-spacing: 0.08em;
}
.mtg-precon-tile__plan { font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted); }
.mtg-precon-tile__payoff { font-size: var(--mtg-text-sm); color: var(--mtg-ink); }
.mtg-precon-tile__counts { font-size: var(--mtg-text-sm); color: var(--mtg-ink-faint); }
`;

export const PRECON_CSS = PRECON;
