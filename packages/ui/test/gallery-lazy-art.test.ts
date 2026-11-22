// @vitest-environment jsdom
/**
 * The Cards gallery asks for the pictures it is showing, not all of them.
 *
 * `mtg-xkuq`. `../src/card/ArtSlot.ts` renders an eager `<img>`, so a Cards tab
 * over a set with an art manifest starts one fetch per card on mount — 371 of
 * them on the flagship. The DOM cost of the unpaged gallery was measured under
 * `mtg-dcxg.9` and is fine; the images were what was left.
 *
 * `loading="lazy"` is opt-in rather than the shared face's default, and that is
 * the whole care in this change: the same face is the battlefield's, and a
 * permanent whose picture arrives when it is scrolled to is a permanent whose
 * picture is missing in a screenshot rig and, worse, in a game. A gallery of
 * faces below the fold is the one place the browser's own deferral is right.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { Card } from '../src/card/Card';

const CARD = EXAMPLE_CARDS[0];
if (CARD === undefined) throw new Error('the example corpus is empty');

const ART = { src: 'art/example.png', alt: 'an illustration' };

describe('the art window and when it fetches', () => {
  it('defers the fetch when the caller says the face is one of many', () => {
    const markup = renderToStaticMarkup(h(Card, { card: CARD, size: 'full', art: ART, deferArt: true }));
    expect(markup).toContain('loading="lazy"');
  });

  it('fetches outright by default, because the board face is the same face', () => {
    const markup = renderToStaticMarkup(h(Card, { card: CARD, size: 'board', art: ART }));
    expect(markup).not.toContain('loading="lazy"');
  });
});
