/**
 * The chrome around a face in a slot: whether you can act on the card in it.
 *
 * `mtg-8ou` was reported from a real hand, measured with `getComputedStyle`: a
 * castable card and one the position could not pay for had the same
 * `border-color`, the same outline, the same opacity, the same filter and the
 * same shadow, while `data-interactive` was correct on both and clicking the
 * castable one already played it. The state was computed and not drawn, so
 * nobody discovered that clicking a card works at all.
 *
 * The playtester's own words for the fix, and they are a different treatment from an
 * outline: "whoever's turn it is, there should be a clearer indicator like their
 * side of the board being a little more lit; and same for whatever is playable
 * in your hand." A border says *this one is selected*; light says *this one is
 * available*, and the two are different sentences. The seat-scale half of that
 * sentence is its own bead; this file holds the card-scale half.
 *
 * **Not brightness alone.** A distinction carried only in luminance is invisible
 * to a viewer who cannot separate two luminances, and it is the first thing a
 * screen at reduced brightness throws away — which now matters, because a tablet
 * is a target. So the treatment is asserted here as *three* channels, and the
 * rim's color is held to a contrast ratio and to a separation in OKLab from
 * every color it could be mistaken for. Two tokens in this palette are already
 * under AA; the point of these numbers is that a third does not join them
 * silently.
 *
 * jsdom performs no layout and resolves no cascade over an emitted sheet, so
 * what is checked here is the declaration and the palette. What a browser
 * actually paints is measured by `tools/board-legibility.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  COLOR_IDENTITIES,
  DARK_TOKENS,
  LIGHT_TOKENS,
  MAT_DARK_TOKENS,
  MAT_LIGHT_TOKENS,
} from '../src/styles/tokens';
import { uiStyleSheet } from '../src/styles/index';
import { contrastRatio, inSrgb, oklabDistance, tokenColor } from './support/oklch';
import type { Oklch } from './support/oklch';

/** The rule that draws a card you can act on, as it reaches the browser. */
function litRule(): string {
  const sheet = uiStyleSheet();
  const opened = sheet.indexOf(".mtg-slot > .mtg-card[data-interactive='true'] {");
  expect(opened, 'the sheet declares a treatment for an interactive face').toBeGreaterThan(-1);
  const closed = sheet.indexOf('}', opened);
  return sheet.slice(opened, closed);
}

interface Palette {
  readonly name: string;
  readonly tokens: string;
  readonly mat: string;
}

const PALETTES: readonly Palette[] = [
  { name: 'light', tokens: LIGHT_TOKENS, mat: MAT_LIGHT_TOKENS },
  { name: 'dark', tokens: DARK_TOKENS, mat: MAT_DARK_TOKENS },
];

/**
 * The smallest WCAG 2.x contrast a non-text boundary may carry (1.4.11). The rim
 * is the channel that survives when the brightness lift does not, so it is the
 * one held to a ratio.
 */
const MINIMUM_RIM_CONTRAST = 3;

/**
 * How far the rim has to sit from a color it could be confused with, in OKLab.
 *
 * Small in absolute terms because the identity palette spans every hue and
 * nothing can be far from all of it; the number is the floor the audit's own
 * failure sits under — a rim that *is* the card's border is a distance of zero,
 * and that is exactly what a player was being shown.
 */
const MINIMUM_SEPARATION = 0.05;

describe('a card you can act on', () => {
  it('is lit on three channels rather than outlined on one', () => {
    const rule = litRule();
    // The ground: the face itself is lifted, through a token so each theme can
    // say how much. A filter on the *face* rather than on the slot, because the
    // hover zoom is fixed-position and a filtered ancestor would trap it.
    expect(rule).toContain('filter: var(--mtg-ready-lift);');
    // The rim: a hue, which is what carries the signal when the lift does not.
    expect(rule).toContain('0 0 0 2px var(--mtg-ready)');
    // The halo: light spilling past the card's edge onto the mat.
    expect(rule).toContain('var(--mtg-ready-soft)');
    // And the card still sits on the mat like a card.
    expect(rule).toContain('var(--mtg-shadow-card)');
  });

  it('leaves the card it is not drawn on alone, unless a spell is being aimed', () => {
    // The promise `board/Battlefield.ts` and `board/Hand.ts` both make: an inert
    // face is not dimmed, grayed or faded. The difference is that one card is
    // lit, not that the other is spoiled.
    const sheet = uiStyleSheet();
    expect(sheet).not.toMatch(/\.mtg-card\[data-interactive='false'\]/);

    // `mtg-bz2.6` bought one exception and the gate narrowed to it rather than
    // being dropped. While a spell is waiting on a target the cards it cannot be
    // aimed at go quiet, which is the same sentence one moment smaller: an inert
    // face is not spoiled *at rest*, and most of a board is inert most of a
    // game. So a rule that reaches a non-interactive face has to name the state
    // it reaches it in, and the state is on the mat.
    //
    // Read as rules rather than as one regex over the sheet, because the thing
    // being forbidden is an unguarded selector and a sheet-wide "does the phrase
    // appear anywhere" match is satisfied by the guard sitting in some other
    // rule entirely.
    const inertSelectors = [...sheet.matchAll(/([^{}]*):not\(\[data-interactive[^{}]*\{/g)].map(
      (match) => (match[1] ?? '').split('\n').pop() ?? '',
    );
    // Zero would make the loop below vacuous, and this file would then pass on a
    // sheet with the dim deleted and on a sheet with it applied everywhere.
    expect(inertSelectors.length).toBeGreaterThan(0);
    for (const selector of inertSelectors) {
      expect(selector, `unguarded: ${selector}`).toContain("[data-aiming='true']");
    }
  });

  it('does not spend the outline the selected card needs', () => {
    // A lit card you have then picked wears both treatments at once, so the two
    // may not use the same property. Selection owns `outline`.
    expect(litRule()).not.toContain('outline');
    expect(uiStyleSheet()).toContain(".mtg-card[data-selected='true'] { outline:");
  });
});

describe('the color the light is', () => {
  for (const palette of PALETTES) {
    it(`is a color a ${palette.name} screen can actually show`, () => {
      expect(inSrgb(tokenColor(palette.tokens, '--mtg-ready'))).toBe(true);
    });

    it(`clears the non-text contrast minimum against the ${palette.name} mat`, () => {
      const rim = tokenColor(palette.tokens, '--mtg-ready');
      const mat = tokenColor(palette.mat, '--mtg-mat');
      expect(contrastRatio(rim, mat)).toBeGreaterThanOrEqual(MINIMUM_RIM_CONTRAST);
    });

    it(`is not the ${palette.name} selection color, which means something else`, () => {
      const rim = tokenColor(palette.tokens, '--mtg-ready');
      expect(oklabDistance(rim, tokenColor(palette.tokens, '--mtg-accent'))).toBeGreaterThan(
        MINIMUM_SEPARATION,
      );
    });

    it(`is none of the ${palette.name} identity borders it is drawn against`, () => {
      // The audit's finding restated as an assertion: the border a face already
      // carries is its color identity, so a rim that lands on one of those is
      // the defect all over again.
      const rim = tokenColor(palette.tokens, '--mtg-ready');
      for (const identity of COLOR_IDENTITIES) {
        const frame: Oklch = tokenColor(palette.tokens, `--mtg-frame-${identity}`);
        expect(oklabDistance(rim, frame), `distinct from the ${identity} frame`).toBeGreaterThan(
          MINIMUM_SEPARATION,
        );
      }
    });

    it(`states the ${palette.name} lift as a filter rather than as a color`, () => {
      // The brightness channel is themeable for the same reason the rim is: a
      // lift tuned on paper is the wrong lift on a dark table.
      expect(palette.tokens).toMatch(/--mtg-ready-lift: brightness\([\d.]+\) saturate\([\d.]+\);/);
    });
  }
});
