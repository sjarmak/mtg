/**
 * Exact-state permanent piles.
 *
 * The resting button covers the representative face, so the first interaction
 * cannot accidentally choose whichever object happened to arrive first. The
 * count stays a visible corner badge. Expansion replaces that representative
 * in the same flex item with every exact object and a small collapse control.
 */
export const PILE_CSS = `
.mtg-permanent-pile {
  position: relative; display: flex; flex: 0 1 auto; min-width: 0;
  align-items: stretch; gap: var(--mtg-space-1);
}
.mtg-permanent-pile__toggle {
  appearance: none; border: 0; font: inherit; cursor: pointer;
}
.mtg-slot > .mtg-permanent-pile__toggle,
.mtg-attach > .mtg-permanent-pile__toggle {
  position: absolute; inset: 0; z-index: 2; padding: 0;
  color: var(--mtg-ink); background: transparent; border-radius: var(--mtg-radius-md);
}
.mtg-attach:has(> .mtg-permanent-pile__toggle) { position: relative; }
.mtg-slot > .mtg-permanent-pile__toggle:focus-visible,
.mtg-attach > .mtg-permanent-pile__toggle:focus-visible {
  outline: 3px solid var(--mtg-accent); outline-offset: 2px;
}
.mtg-permanent-pile__count {
  position: absolute; inset-block-start: var(--mtg-space-1); inset-inline-end: var(--mtg-space-1);
  display: grid; place-items: center; min-width: 1.35rem; min-height: 1.35rem;
  padding-inline: 0.3rem; border: 1px solid var(--mtg-line-strong);
  border-radius: var(--mtg-radius-pill); color: var(--mtg-ink);
  background: var(--mtg-surface-raised); box-shadow: var(--mtg-shadow-card);
  font-size: 0.75rem; font-weight: 800; line-height: 1;
}
.mtg-slot:has(> .mtg-permanent-pile__toggle) > .mtg-card .mtg-card__name,
.mtg-attach:has(> .mtg-permanent-pile__toggle) > .mtg-slot > .mtg-card .mtg-card__name {
  padding-inline-end: 1.75rem;
}
.mtg-permanent-pile[data-expanded='true'] {
  padding: var(--mtg-space-1); border: 1px solid var(--mtg-line-strong);
  border-radius: var(--mtg-radius-md); background: var(--mtg-surface-inset);
}
.mtg-permanent-pile[data-expanded='true'] > .mtg-permanent-pile__toggle {
  position: relative; flex: none; align-self: flex-start;
  width: 1.8rem; height: 1.8rem; padding: 0;
  border: 1px solid var(--mtg-line-strong); border-radius: var(--mtg-radius-pill);
  color: var(--mtg-ink); background: var(--mtg-surface-raised);
}
.mtg-permanent-pile[data-expanded='true'] .mtg-permanent-pile__count {
  position: static; min-width: 0; min-height: 0; padding: 0;
  border: 0; background: transparent; box-shadow: none;
}
`;
