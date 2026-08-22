/**
 * The touch floor, read off the sheet that carries it.
 *
 * `mtg-yg8`. The numbers themselves were measured in a browser
 * (`../tools/touch-targets.ts`, at four viewports, with and without a
 * touch-capable device metrics override) because jsdom lays nothing out. What
 * this file holds is the part a browser cannot check for us: that the floor is
 * *only* spent inside `(pointer: coarse)`, that it reaches every surface the
 * audit measured short, that every selector it names is a selector some other
 * sheet actually draws, and that it is joined late enough in the cascade to win.
 *
 * The last three are each a way the sheet could go quietly wrong. A selector
 * with a typo in it floors nothing and reports nothing. A floor joined before
 * the sheet that sizes the control ties on specificity and loses. And a rule
 * that escaped the media query would be a restyle of the surface everybody uses
 * with a mouse, which is exactly what this bead promised not to be.
 */
import { describe, expect, it } from 'vitest';
import { BASE_CSS } from '../src/styles/base';
import { BOARD_CSS } from '../src/styles/board';
import { TOUCH_CSS, TOUCH_TARGET_PX, TOUCH_TARGET_SELECTORS } from '../src/styles/touch';
import { VIEWS_CSS } from '../src/styles/views';
import { uiStyleSheet } from '../src/styles/index';

/** The body of the one media query in the touch sheet, and everything outside it. */
function split(): { readonly coarse: string; readonly always: string } {
  const at = TOUCH_CSS.indexOf('@media (pointer: coarse) {');
  if (at < 0) throw new Error('the touch sheet declares no coarse-pointer query');
  const close = TOUCH_CSS.lastIndexOf('}');
  return { coarse: TOUCH_CSS.slice(at, close + 1), always: TOUCH_CSS.slice(0, at) };
}

describe('the touch target floor', () => {
  it('is 44px, which is what a fingertip is measured against', () => {
    // Apple's Human Interface Guidelines, in the units a sheet writes: one point
    // is one CSS px on an iPad. Android asks 48dp and WCAG 2.5.8 AA asks 24, so
    // this is the strictest of the three and the only one worth stating.
    expect(TOUCH_TARGET_PX).toBe(44);
  });

  it('reaches every surface the audit measured short', () => {
    // The list is the audit's findings, and each of these was read in
    // chrome-headless-shell 151.0.7922.47 at four viewports: the move list at
    // 36.8px, the chrome buttons at 28.8px, the turn badge at 19px, the zone and
    // log disclosures at 17.9px, the shell's route links at 26.8px, the step
    // bar's nodes at 33.9px.
    //
    // The badge entry is qualified by its element. `.mtg-badge` is worn by one
    // control and by fifteen labels, and flooring a label makes a 44px-tall
    // word: the seat pod's Active and Priority tags wrap, so the pair became a
    // 92px block on a 390px-tall landscape phone and pushed the viewer's own
    // life total under the fold. The control is a `<button>`
    // (`../src/routes/play/TurnStops.ts`), and every label is a `<span>`, so the
    // element is the distinction rather than a second class to remember to add.
    expect(TOUCH_TARGET_SELECTORS).toEqual([
      '.mtg-choice',
      '.mtg-btn',
      'button.mtg-badge',
      '.mtg-browser__head',
      '.mtg-browser__row',
      '.mtg-modes__item',
      '.mtg-phasebar__node',
    ]);
    const { coarse } = split();
    for (const selector of TOUCH_TARGET_SELECTORS) {
      expect(coarse).toContain(`${selector} { min-height: ${String(TOUCH_TARGET_PX)}px; }`);
    }
  });

  it('names no selector the rest of the sheet does not draw', () => {
    // A floor on a class nobody renders is a floor that reports nothing and
    // fails nothing. Every one of these has to be a control some other sheet
    // already sized, which is also what makes the cascade assertion below mean
    // something.
    //
    // The class is what the other sheets name; an element qualifier here is this
    // sheet narrowing its own reach, and no other sheet has to repeat it. So the
    // qualifier comes off before the lookup, and what is checked is the part
    // that could hold the typo.
    const drawn = [BASE_CSS, BOARD_CSS, VIEWS_CSS].join('\n');
    for (const selector of TOUCH_TARGET_SELECTORS) {
      expect(drawn).toContain(selector.slice(selector.indexOf('.')));
    }
  });

  it('spends nothing outside the coarse-pointer query but the gesture hints', () => {
    // The whole of "not a restyle". A fine pointer gets `touch-action`, which
    // describes a gesture it does not make, and not one size, color or spacing
    // declaration. Anything else escaping the query would change the surface
    // everybody uses today.
    const { always } = split();
    const declared = always
      .split(';')
      .map((run) => run.slice(run.lastIndexOf('{') + 1).trim())
      .filter((run) => run.length > 0 && run.includes(':'))
      .map((run) => run.slice(0, run.indexOf(':')).trim());
    expect(declared).toEqual(['touch-action']);
  });

  it('suppresses the callout only where a long press is recognized', () => {
    // `card/press.ts` arms nothing for a mouse, so the two properties that would
    // stop a player selecting a card's rules text are inside the query with the
    // rest of the touch model rather than over the whole surface.
    const { coarse, always } = split();
    expect(coarse).toContain('-webkit-touch-callout: none');
    expect(coarse).toContain('user-select: none');
    expect(always).not.toContain('user-select');
  });
});

describe('where the touch sheet is joined', () => {
  it('comes after every sheet that sizes a control it floors', () => {
    // Each of these rules ties on specificity with the one it is overriding —
    // `.mtg-choice` against `.mtg-choice` — so it wins by coming later and by
    // nothing else. `styles/index.ts` says the same thing in prose; this is the
    // assertion under it.
    const sheet = uiStyleSheet();
    const touchAt = sheet.indexOf(TOUCH_CSS);
    expect(touchAt).toBeGreaterThan(-1);
    for (const earlier of [BASE_CSS, BOARD_CSS, VIEWS_CSS]) {
      expect(sheet.indexOf(earlier)).toBeGreaterThan(-1);
      expect(sheet.indexOf(earlier)).toBeLessThan(touchAt);
    }
  });
});

describe('the move list track floor', () => {
  it('shrinks to the column rather than overflowing it', () => {
    // Not a touch rule, and it is here because the touch audit is what found it.
    // A grid track floored at a bare 11rem does not shrink below it, and the ask
    // column is capped at 11rem and falls to a pod's width on a narrow screen,
    // so every option in the list was being cut off at the panel's clip:
    // measured in chrome-headless-shell 151.0.7922.47, an option laid out at
    // 176px painted 162px at 1440x900 and 85.8px at 810x1080, the iPad's
    // portrait width. The min() is what makes `board/rail.ts`'s stated bargain
    // true — a label in that column wraps rather than being cut.
    expect(VIEWS_CSS).toContain('grid-template-columns: repeat(auto-fit, minmax(min(11rem, 100%), 1fr))');
    expect(VIEWS_CSS).not.toContain('minmax(11rem, 1fr)');
  });
});
