// @vitest-environment jsdom
/**
 * What gives when the table is crowded, and what a land looks like now.
 *
 * Two changes ship together here because the second moves the first's numbers.
 * `mtg-bc2.142` is that the art window was the only region on a board face that
 * could give: every bar takes its own `min-content` height, all of them reach
 * their type floors at about the same width, and from there the whole of the
 * face's shortfall came out of the picture. Measured in chromium over a built
 * row of identical creatures beside a seven-land mana base, the window was 2.7%
 * of face height at ten permanents a side at 1280x800, and 71.6px of bars is by
 * then more than the printed trim allows at the row's width floor, so the face
 * was not card-shaped either (0.653 against 0.716). Below
 * `BOARD_TYPE_LINE_MIN_REM` the type line yields instead, and the same rows
 * measure 24.9% and 0.716.
 *
 * The second is that a land is a face rather than a chip. It has since become an
 * art tile in a row under the cards in play, which is a third shape and its own
 * file: `./land-tile.test.ts` holds the band and everything about it, and what
 * stays here is only the crowded spell row, which is what this file was always
 * about. The land count still moves those numbers, because the band now spends
 * the row's height rather than a slice of its width; the table below is measured
 * at seven lands a side, and `../../tools/board-crowding.ts` renders the rest.
 *
 * **What this file can and cannot say**, in `./fit.test.ts`'s words: jsdom lays
 * nothing out and evaluates no container query, so no assertion here is a pixel.
 * The numbers above come from `../../tools/board-crowding.ts` driven in
 * chrome-headless-shell, and what a future CI browser would assert is exactly
 * those two tables — the window's share of the face at 4, 6, 8, 10, 12 and 14 a
 * side at both viewports, and the face's width over its height against 63:88.
 * What is checkable without one is the cascade the fix is made of, and the one
 * fact that is not a pixel at all: that hiding the type bar takes nothing from a
 * reader who was never reading it off the screen.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_CARDS, renderTypeLine } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { Card } from '../../src/card/Card';
import { uiStyleSheet } from '../../src/styles/index';

function creature(): DslCard {
  const card = EXAMPLE_CARDS.find((entry) => entry.kind === 'creature');
  if (card === undefined) throw new Error('the DSL example set has no creature');
  return card;
}

/** Every `@container` block on the sheet, as its threshold and its body. */
function containerQueries(): readonly (readonly [number, string])[] {
  return [...uiStyleSheet().matchAll(/@container \(max-width: ([\d.]+)rem\) \{([\s\S]*?)\n\}/g)].map(
    ([, threshold, body]) => [Number(threshold), body ?? ''] as const,
  );
}

describe('the region that gives before the picture does', () => {
  /**
   * The rule itself. Written as a container query rather than a media query for
   * the reason the pending label's is: both viewports break at the same face
   * *width* and at different permanent counts, so the face has to ask its own
   * container.
   *
   * It used to be the only rule that hid the bar, and `mtg-mq81` made it the
   * floor of a ladder: `../../src/card/type-line.ts` publishes a per-card band
   * for each part of the line and `../../src/styles/card.ts` writes one
   * `@container` block per rung, so a card whose type line is too long for the
   * face drops a whole phrase before the face reaches this width. What holds
   * across all of them is what is asserted here — every rule that takes the type
   * line off a face is a board rule, keyed to a stated width, and the
   * unconditional floor is still there under the ladder.
   */
  it('hides the type line on a board face below a stated width, and nowhere else', () => {
    const hiding = containerQueries().filter(([, body]) => /\[data-region='type'\]/.test(body));
    expect(hiding.length, 'nothing hides the type line at any width').toBeGreaterThan(0);
    for (const [threshold, body] of hiding) {
      expect(threshold, 'a type-line rule with no stated width').toBeGreaterThan(0);
      // The board face and no other. A hand card and a gallery card are read at
      // leisure and have the room; only the table runs out of height.
      for (const rule of body.split('\n')) {
        if (!/\[data-region='type'\]|\.mtg-card__type/.test(rule)) continue;
        expect(rule, 'a type-line rule that is not a board rule').toMatch(/\.mtg-card\[data-size='board'\]/);
      }
    }
    const floor = hiding.filter(([, body]) =>
      /\.mtg-card\[data-size='board'\] > \[data-region='type'\] \{ display: none; \}/.test(body),
    );
    expect(floor.length, 'the width below which no board face draws a type bar').toBe(1);
  });

  /**
   * The picture is what the room is spent on, so the window may not be given a
   * floor of its own in the same breath: two floors that add up to more than the
   * face is the failure `mtg-bc2.137` found in the rail, where a block too short
   * for its content painted over the block beneath it.
   */
  it('leaves the window as the region that takes the surplus, with no floor of its own', () => {
    const sheet = uiStyleSheet();
    expect(sheet).toMatch(
      /\.mtg-card\[data-size='board'\] > \[data-region='art'\] \{[^}]*flex: 1 1 auto;[^}]*min-height: 0;/,
    );
  });

  /**
   * The one assertion here that is about a person rather than about the
   * cascade. The type line leaves the screen and does not leave the card: it is
   * in the face's own accessible name and in the description a pointer gets, at
   * board size, where the bar may be hidden.
   *
   * If this ever fails, the rule above is no longer free and has to be argued
   * again rather than kept.
   */
  it('still says the type line on a board face, whether or not the bar is drawn', () => {
    const card = creature();
    const markup = renderToStaticMarkup(h(Card, { card, size: 'board' }));
    const line = renderTypeLine(card);
    expect(line.length).toBeGreaterThan(0);
    // Both channels, named: the button's accessible name and its description.
    const quoted = line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const named = new RegExp(`aria-label="[^"]*${quoted}`);
    const described = new RegExp(`title="[^"]*${quoted}`);
    expect(named.test(markup), 'the accessible name dropped the type line').toBe(true);
    expect(described.test(markup), 'the hover description dropped the type line').toBe(true);
  });
});
