/**
 * The pending-art label, in the one place both renderers read it.
 *
 * Ported governance rule from the prior project (`docs/art-governance.md`, reuse
 * item 9): a generative backlog rots silently unless every unfinished surface
 * announces itself. A card with no art renders a hatched frame carrying this
 * label and the card's own id, so a screenshot of a set in progress is
 * self-describing and a missing render can never pass for a design choice.
 *
 * It is a string in a file of its own because the rule is only worth anything
 * if both faces state it identically: `@mtg/ui`'s `card/ArtSlot.ts` draws the
 * DOM frame and `@mtg/card-render`'s `art.ts` draws the printed one, and
 * `packages/card-render/test/render.test.ts` asserts the two say the same
 * words. Before `mtg-ey09` the printed renderer imported it from the React
 * component that draws the other frame.
 */
export const ART_PENDING_LABEL = 'Art pending';
