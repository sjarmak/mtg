/** Full printed cards get a reading-sized face; compact and game cards stay unchanged. */
const CONTEXT =
  ':is(.mtg-gallery, .mtg-builder-screen .mtg-deck__pane-scroll, .mtg-draft .mtg-work__scroll > .mtg-thumbs:has(> [data-presentation="printed-card"][data-size="full"]))';
const NESTED_FACE = `${CONTEXT} .mtg-card[data-presentation='printed-card'][data-size='full']`;
const FIT = [1, 1, 1, 0.96, 0.9, 0.84, 0.78, 0.74, 0.74, 0.74] as const;

export const PRINTED_READING_CSS = `
@media (min-width: 40.001rem) {
  .mtg-gallery .mtg-card[data-presentation='printed-card'][data-size='full'] {
    --card-w: 18rem;
  }
  /* 17.5rem, down from the gallery's 18rem: a printed pack is looked through
     rather than read one face at a time, and at 18rem a 1440px window showed
     three faces to a row with the fourth cut in half below the fold. Not
     smaller, and the geometry census in
     test/card/printed-card-face.browser.test.ts is the reason twice over: the
     container ladder below opens at a 16rem *content* box and the face carries
     about 13px of its own padding, so a face drawn 16rem or 16.5rem wide
     stopped short of the rung and every planeswalker and large-art card lost
     its title bar's padding; and at 17rem one Legacy Cube position overflowed
     its rules box by a pixel at the floor rung. 17.5rem is the largest step
     down that every official position still fits. */
  .mtg-draft .mtg-work__scroll > .mtg-thumbs:has(> [data-presentation='printed-card']) {
    --thumb-w: 17.5rem;
    --thumb-max: 17.5rem;
  }
}
/* The builder's pool keeps no printed override at all (\`mtg-84703\`).
 *
 * It had two, both 18rem, and they were the reason a drafted pool drew its cards
 * 23% larger than the deck being built out of them: the deck pane's faces are
 * strips at \`@mtg/card-geometry\`'s \`FULL_FACE_WIDTH_REM\` -- 15.25rem, the width
 * the rules text is measured readable at -- and the pool's columns were 18rem
 * against them, side by side in one window. the playtester read the pair and said
 * which one was right: "the cards in the drafted pool should be the same size as
 * the ones in the deck (deck size of cards looks correct here, drafted pool
 * cards are too large)".
 *
 * So the pool falls back to \`./views.ts\`'s 15.25rem, which is that same
 * constant, and the two panes draw one card size. What it costs is the container
 * ladder below: a 15.25rem face has about a 14.4rem content box and stops short
 * of the 16rem rung, so its rules text is sized by \`--rules-type\` instead of by
 * \`cqi\`. That is not a new state to check -- it is exactly the path the deck
 * pane's faces have always taken, measured at 9.62px with no overflow across
 * this cube's positions in test/deck/builder-density.browser.test.ts, which is
 * the drawing she was calling correct. */
/* The commit is drawn once there is something to commit. Idle, it is a gray
   "Pick a card" pinned under an empty viewer, which reads as a control that is
   waiting on you. On a phone it stays, so that a tap does not move the controls
   beside it (routes/draft/DraftPack.ts), and a phone held sideways is wide but
   not tall, so the rule asks for both; it is a rule rather than a change to
   what is rendered, and every test that finds the idle button still does. */
@media (min-width: 40.001rem) and (min-height: 40.001rem) {
  .mtg-draft .mtg-rail > .mtg-rail__foot:has(> button:disabled) {
    display: none;
  }
}
/* Container units scale type with the actual face, including full-width phones.
 * Smaller draft tiles retain their compact ladder and enlarged reading panel. */
@container (min-width: 16rem) {
  ${NESTED_FACE} > .mtg-card__bar {
    min-height: 0;
    padding: 2px 6px;
  }
  ${FIT.map((scale, step) => `${NESTED_FACE} .mtg-card__text[data-fit='${String(step)}'] { font-size: calc(5.65cqi * ${String(scale)}); }`).join('\n')}
  ${NESTED_FACE} .mtg-card__text {
    --face-space-1: 0.1em;
    --face-space-2: 0.25em;
    line-height: 1.1;
  }
  ${NESTED_FACE}[data-loyalty-frame='true'] .mtg-card__text {
    --face-space-1: 0.08em;
    --face-space-2: 0.12em;
    margin-block-end: 0;
  }
  ${NESTED_FACE}[data-loyalty-frame='true'] .mtg-card__line[data-loyalty] {
    column-gap: 1.5%;
    line-height: 1.1;
  }
  ${NESTED_FACE} .mtg-card__stats:has(.mtg-card__shield) {
    inset-block-end: calc(var(--pad) - var(--frame-band) + 6px);
  }
}
`;
