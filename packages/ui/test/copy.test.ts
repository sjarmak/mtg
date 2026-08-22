/**
 * Commands in copy render as commands.
 *
 * The regression this pins: every empty state in the lab was authored with
 * markdown backticks and handed to a text node, so the page printed them. A
 * person reading "Run `npm run lab` to stage one" had to work out that two of
 * those characters were punctuation the renderer forgot to eat.
 *
 * The last test is the one that matters — it walks the states a person reaches
 * by opening the lab on a clean checkout and asserts no backtick survives to
 * the screen, so a new empty state written in the same style fails here rather
 * than shipping.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { renderCopy } from '../src/copy';
import { AnalysisRoute } from '../src/routes/AnalysisRoute';
import { DeckRoute } from '../src/routes/DeckRoute';
import { PlayRoute } from '../src/routes/PlayRoute';
import { ReplayRoute } from '../src/routes/ReplayRoute';
import type { UiRoute } from '../src/app/router';

function markup(node: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(node);
}

/** The text a person reads, with element boundaries removed. */
function onScreen(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

describe('renderCopy', () => {
  it('turns a backticked span into a code element', () => {
    const html = markup(h('p', null, renderCopy('Run `npm run lab` to stage one.')));
    expect(html).toBe('<p>Run <code class="mtg-code">npm run lab</code> to stage one.</p>');
  });

  it('marks every command in a sentence, not just the first', () => {
    const html = markup(h('p', null, renderCopy('`npm run play` or `npm run lab`.')));
    expect(html.match(/<code/g)).toHaveLength(2);
    expect(onScreen(html)).toBe('npm run play or npm run lab.');
  });

  it('leaves prose with no backticks as a plain string', () => {
    expect(renderCopy('No deck staged')).toBe('No deck staged');
  });

  it('passes an unpaired backtick through rather than swallowing the rest', () => {
    // A string that lost its closing tick should look wrong on screen. Eating
    // the tail would hide the typo and lose the sentence.
    expect(renderCopy('Run `npm run lab to stage one.')).toBe('Run `npm run lab to stage one.');
  });
});

describe('the states a clean checkout reaches', () => {
  const REPLAY_ROUTE: UiRoute = { mode: 'replay', params: {} } as UiRoute;

  const states: readonly (readonly [string, string])[] = [
    ['deck, absent', markup(h(DeckRoute, { state: { status: 'absent' } }))],
    ['deck, loading', markup(h(DeckRoute, { state: { status: 'loading' } }))],
    // The play route's `loading` and `failed` states are deliberately not here:
    // this list is the states that end in something to type, and neither of
    // those does. "Reading the staged set" is a wait, and a set document that
    // failed the parser names the document rather than a command. Both are
    // covered for a title in `polish.test.ts`.
    ['play, no set', markup(h(PlayRoute, { set: null }))],
    ['analysis, no log', markup(h(AnalysisRoute, { state: { status: 'absent' } }))],
    [
      'replay, no log',
      markup(h(ReplayRoute, { log: null, route: REPLAY_ROUTE, onSetParams: () => undefined })),
    ],
  ];

  for (const [name, html] of states) {
    it(`prints no literal backtick: ${name}`, () => {
      expect(onScreen(html)).not.toContain('`');
    });

    it(`still names the command it wants typed: ${name}`, () => {
      expect(html).toContain('<code class="mtg-code">');
    });
  }

  it('does not repeat the empty-state title in the page note', () => {
    // The header used to read "no deck staged" directly above an empty block
    // titled "No deck staged". Twice is not emphasis.
    const html = markup(h(DeckRoute, { state: { status: 'absent' } }));
    expect(onScreen(html).match(/deck staged/gi)).toHaveLength(1);
  });
});
