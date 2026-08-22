/**
 * What a card looks like when nobody at this screen may read it, and the piles
 * that are counted rather than laid out.
 *
 * Hatched rather than blank, because a face-down card is a card whose contents
 * are withheld and not a hole in the layout — the same honesty rule the pending
 * art frame follows. `./fit.ts` re-sizes it on the play route, where the
 * opponent's hand is seven of these and worth no more room than the count
 * already printed above it.
 */
export const HIDDEN_CSS = `
.mtg-facedown {
  width: 2.4rem; height: 3.4rem; border-radius: var(--mtg-radius-md);
  border: 1px solid var(--mtg-line-strong);
  background-image: repeating-linear-gradient(135deg, var(--mtg-hatch) 0 2px, var(--mtg-surface-inset) 2px 7px);
}
.mtg-pile { display: flex; flex-direction: column; gap: 2px; font-size: var(--mtg-text-sm); }
.mtg-pile__row { display: flex; gap: var(--mtg-space-2); align-items: baseline; }
`;
