/**
 * The staged cast, inside the picker's box.
 *
 * It declares no position, no width and no inset, because it has none of its
 * own: `.mtg-cast` is a second class on `.mtg-picker`, so the placement argument
 * measured in `./picker.ts` — the rail's column, the window's end edge, fixed so
 * a scrolling zone body cannot clip it — carries over unchanged and there is one
 * box on this surface to keep true rather than two.
 *
 * **What does not carry over is the height, so it was measured.** The panel adds
 * a step strip, the aims a finished cast lists and a row of two controls, and
 * the picker's numbers were taken with none of those. Measured in
 * chrome-headless-shell over CDP against `tools/cast-panel.ts`'s page, on a
 * board of six permanents and a full hand where eleven moves are on offer:
 *
 *  - Targets stage, three aims: [1184,535,240,349] at 1440x900,
 *    [1024,435,240,349] at 1280x800, [768,403,240,349] at 1024x768.
 *  - Payment stage: [1184,642,240,242], [1024,542,240,242], [768,510,240,242].
 *
 * It crosses none of the eighteen card slots at any of the six, the page never
 * scrolls sideways, and the panel never scrolls inside itself — 349px at its
 * tallest, against a 60vh cap that is 460px at the shortest of the three.
 *
 * What it does cover is the rail behind it: three to seven of the eleven moves,
 * depending on the stage and the viewport. That is the panel being the active
 * task rather than a defect — the moves it hides are the ones a player who is
 * halfway through a cast is not making — and Escape, a second click on the card,
 * or Cancel gives the whole list back in one stroke.
 *
 * What is here is the inside of the panel: the step strip at the top, the
 * sentence being asked, the aims a finished cast lists, and the row holding Back
 * and Cancel. Only the strip needs a rule that is not spacing. It is an ordered
 * list, so it arrives with a marker and an indent that would put the first step
 * off the panel's edge, and the current step is marked by `aria-current` rather
 * than by a class — the attribute is what a screen reader reads, and keying the
 * highlight on the same attribute is what stops the two from disagreeing. The
 * mark is ink and an underline rather than weight, because the strip is a
 * micro-label and DESIGN.md's rule already puts every one of those at 600, so
 * weight is a channel this strip has spent (`test/polish.test.ts` sweeps it).
 *
 * This block sits after `./picker.ts` in the cascade for the ordinary reason:
 * `.mtg-cast__step[aria-current='step']` and the picker's own rules never tie,
 * but `.mtg-cast` sharing a box with `.mtg-picker` means anything here that did
 * tie should win, and being later is what makes that true without inflating a
 * selector.
 */
export const CAST_CSS = `
.mtg-cast__steps {
  display: flex; gap: var(--mtg-space-2); margin: 0; padding: 0; list-style: none;
  font-size: var(--mtg-text-xs); text-transform: uppercase; letter-spacing: 0.06em;
  font-weight: 600; color: var(--mtg-ink-faint);
}
.mtg-cast__step[aria-current='step'] {
  color: var(--mtg-accent);
  text-decoration: underline; text-underline-offset: 0.25em;
}
.mtg-cast__ask {
  display: flex; align-items: center; gap: var(--mtg-space-1);
  margin: 0; font-size: var(--mtg-text-sm); color: var(--mtg-ink);
}
.mtg-cast__cost { color: var(--mtg-ink-faint); }
.mtg-cast__aims {
  display: flex; flex-direction: column; gap: var(--mtg-space-1);
  margin: 0; padding: 0; list-style: none;
  font-size: var(--mtg-text-xs); color: var(--mtg-ink-faint);
}
.mtg-cast__controls { display: flex; gap: var(--mtg-space-1); }
.mtg-cast__controls > .mtg-btn { flex: 1 1 auto; }
`;
