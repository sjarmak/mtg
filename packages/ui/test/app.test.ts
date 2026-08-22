// @vitest-environment jsdom
/**
 * The hash router and the shell it drives.
 *
 * The browser is reached through the package's own `hashSource()` rather than
 * an ambient `window`, which is both how the router works and the only way to
 * touch the location under a tsconfig without `lib: dom`.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { App } from '../src/app/App';
import type { UiViews } from '../src/app/App';
import { Shell } from '../src/app/Shell';
import { LabApp } from '../src/dev/LabApp';
import { DEFAULT_MODE, MODE_LABELS, UI_MODES, hashSource, parseHash, routeHash } from '../src/app/router';
import { uiStyleSheet } from '../src/styles/index';
import { routeScope } from '../src/styles/tokens';

afterEach(cleanup);

function setHash(hash: string): void {
  const source = hashSource();
  if (source === null) throw new Error('this test needs a browser location');
  source.location.hash = hash;
}

function currentHash(): string {
  const source = hashSource();
  if (source === null) throw new Error('this test needs a browser location');
  return source.location.hash;
}

const VIEWS: UiViews = {
  play: () => h('p', null, 'play view'),
  draft: () => h('p', null, 'draft view'),
  deck: () => h('p', null, 'deck view'),
  analysis: (router) => h('p', null, `analysis:${router.route.params['run'] ?? 'none'}`),
  replay: (router) => h('p', null, `replay:${router.route.params['game'] ?? 'none'}`),
  cards: () => h('p', null, 'cards view'),
};

describe('parseHash', () => {
  it('reads every mode', () => {
    for (const mode of UI_MODES) {
      expect(parseHash(`#/${mode}`).mode).toBe(mode);
    }
  });

  it('falls back to the default mode for anything unrecognized', () => {
    expect(parseHash('').mode).toBe(DEFAULT_MODE);
    expect(parseHash('#/').mode).toBe(DEFAULT_MODE);
    expect(parseHash('#/nonsense').mode).toBe(DEFAULT_MODE);
    expect(parseHash('#/cards/extra/segments').mode).toBe('cards');
  });

  it('reads params and tolerates a missing hash marker', () => {
    expect(parseHash('#/replay?game=3&turn=11').params).toEqual({ game: '3', turn: '11' });
    expect(parseHash('/replay?game=3').mode).toBe('replay');
  });
});

describe('routeHash', () => {
  it('round-trips a route', () => {
    const route = { mode: 'replay' as const, params: { game: '2', turn: '7' } };
    expect(parseHash(routeHash(route))).toEqual(route);
  });

  it('sorts params and drops empty ones', () => {
    expect(routeHash({ mode: 'cards', params: { z: '1', a: '2', gone: '' } })).toBe('#/cards?a=2&z=1');
    expect(routeHash({ mode: 'analysis', params: {} })).toBe('#/analysis');
  });
});

describe('App', () => {
  beforeEach(() => {
    setHash('#/analysis');
  });

  it('renders the view for the current hash', async () => {
    setHash('#/replay?game=4');
    render(h(App, { views: VIEWS, title: 'MTG Lab', subtitle: 'foundation' }));
    await waitFor(() => {
      expect(screen.getByText('replay:4')).toBeTruthy();
    });
    expect(screen.getByText('MTG Lab')).toBeTruthy();
  });

  it('marks the current mode for assistive technology', async () => {
    setHash('#/cards');
    render(h(App, { views: VIEWS }));
    await waitFor(() => {
      expect(screen.getByRole('link', { current: 'page', name: 'Cards' })).toBeTruthy();
    });
  });

  it('keeps route navigation while letting the played table shed decorative chrome', async () => {
    setHash('#/play');
    render(
      h(App, {
        views: VIEWS,
        title: 'the flagship set',
        subtitle: 'play, analyze, replay',
        aside: 'TGR · 3 games · seed slice/v0',
      }),
    );
    await waitFor(() => {
      expect(screen.getByText('play view')).toBeTruthy();
    });
    expect(screen.getByText('the flagship set')).toBeTruthy();
    const navigation = screen.getByRole('navigation', { name: 'View mode' });
    expect(within(navigation).getByRole('link', { name: 'Draft' })).toBeTruthy();
    expect(within(navigation).getByRole('link', { name: 'Deck' })).toBeTruthy();
    expect(within(navigation).getByRole('link', { name: 'Cards' })).toBeTruthy();
    expect(screen.queryByText('play, analyze, replay')).toBeNull();
    expect(screen.queryByText('TGR · 3 games · seed slice/v0')).toBeNull();
    expect(uiStyleSheet()).toContain(
      `.mtg-shell:is(${routeScope('play')}, ${routeScope('draft')}) .mtg-shell__bar {\n  gap: var(--mtg-space-2);`,
    );
  });

  it('navigates when a mode is chosen', async () => {
    render(h(App, { views: VIEWS }));
    fireEvent.click(screen.getByRole('link', { name: 'Cards' }));
    await waitFor(() => {
      expect(screen.getByText('cards view')).toBeTruthy();
    });
    expect(currentHash()).toBe('#/cards');
  });

  it('drops the previous mode params when switching', async () => {
    setHash('#/replay?game=9');
    render(h(App, { views: VIEWS }));
    await waitFor(() => {
      expect(screen.getByText('replay:9')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('link', { name: 'Analysis' }));
    await waitFor(() => {
      expect(screen.getByText('analysis:none')).toBeTruthy();
    });
    expect(currentHash()).toBe('#/analysis');
  });

  it('mounts the token sheet, and skips it when the host owns styling', () => {
    setHash('#/cards');
    const styled = renderToStaticMarkup(h(App, { views: VIEWS }));
    expect(styled).toContain('--mtg-surface-page');
    expect(styled).toContain('data-mtg-ui="tokens"');
    const bare = renderToStaticMarkup(h(App, { views: VIEWS, withStyles: false }));
    expect(bare).not.toContain('--mtg-surface-page');
  });
});

// A `<button>` has no `href`, so middle-click and "open in a new tab" do
// nothing on it. Comparing two routes side by side means losing one of them.
// The mode control is now built from real anchors carrying the hash the
// router would put there itself, so the browser's own navigation handles the
// cases the shell never has to know about.
describe('mode items are real anchors', () => {
  it('carries the exact hash routeHash() would produce for every mode', () => {
    const html = renderToStaticMarkup(
      h(Shell, { mode: 'cards', onSelectMode: () => undefined, children: null }),
    );
    for (const mode of UI_MODES) {
      expect(html).toContain(`href="${routeHash({ mode, params: {} })}"`);
    }
  });

  it('still switches modes and updates the hash on a plain click', async () => {
    setHash('#/analysis');
    render(h(App, { views: VIEWS }));
    fireEvent.click(screen.getByRole('link', { name: 'Cards' }));
    await waitFor(() => {
      expect(screen.getByText('cards view')).toBeTruthy();
    });
    expect(currentHash()).toBe('#/cards');
  });

  it('keeps aria-current="page" on the anchor for the active mode', async () => {
    setHash('#/cards');
    render(h(App, { views: VIEWS }));
    await waitFor(() => {
      const current = screen.getByRole('link', { current: 'page', name: 'Cards' });
      expect(current).toBeTruthy();
    });
    // Every other mode is a plain link with no current state.
    for (const mode of UI_MODES) {
      if (mode === 'cards') continue;
      expect(screen.queryByRole('link', { current: 'page', name: MODE_LABELS[mode] })).toBeNull();
    }
  });

  it('does not hijack a middle click, leaving the browser free to open a new tab', async () => {
    setHash('#/analysis');
    render(h(App, { views: VIEWS }));
    fireEvent.click(screen.getByRole('link', { name: 'Cards' }), { button: 1 });
    // The click handler bails out before calling `preventDefault` or
    // `onSelect` for anything but a plain left click, so this view and hash
    // are exactly what they were before the click.
    expect(screen.queryByText('cards view')).toBeNull();
    expect(currentHash()).toBe('#/analysis');
  });

  it('does not hijack a ctrl/cmd click either', async () => {
    setHash('#/analysis');
    render(h(App, { views: VIEWS }));
    fireEvent.click(screen.getByRole('link', { name: 'Cards' }), { ctrlKey: true });
    expect(screen.queryByText('cards view')).toBeNull();
    expect(currentHash()).toBe('#/analysis');
  });
});

interface ElementLike {
  readonly querySelector: (selector: string) => ElementLike | null;
}

interface DocumentLike {
  readonly document: { readonly body: ElementLike };
}

/**
 * The one mounted element matching `selector`, or null. Shaped like
 * `card.test.ts`'s helper and for the same reason: the workspace tsconfig has
 * no `lib: dom`, so the document is reached through a narrow structural
 * interface rather than through the global types.
 */
function findRendered(selector: string): ElementLike | null {
  const document = (globalThis as Partial<DocumentLike>).document;
  if (document === undefined) throw new Error('this test needs a jsdom document');
  return document.body.querySelector(selector);
}

// A route that carries its own palette needs somewhere in the markup to hang
// it on. The shell root is that place: `styles/tokens.ts` writes the selector
// and the shell writes the attribute. Asserting through the selector rather
// than against the markup text is what makes the two unable to agree on a name
// while disagreeing on whether the selector matches it.
describe('the shell stamps the route it is showing', () => {
  it('matches the selector the token layer scopes a palette with, for every mode', () => {
    for (const mode of UI_MODES) {
      setHash(`#/${mode}`);
      render(h(App, { views: VIEWS }));
      expect(findRendered(`.mtg-shell${routeScope(mode)}`)).not.toBeNull();
      cleanup();
    }
  });
});

function styleRule(selector: string): string {
  const found = uiStyleSheet().match(new RegExp(`\\${selector}\\s*\\{[^}]*\\}`));
  return found === null ? '' : found[0];
}

// DESIGN.md calls the current mode "a physically depressed key". Before this
// rule existed, `.mtg-modes__item` had a hover state and a current state but
// nothing for the moment in between: pressing any item, current or not, gave
// no feedback at all.
describe('the segmented control has a pressed state', () => {
  it('declares :active with the same pressed ground the button vocabulary uses', () => {
    const active = styleRule('.mtg-modes__item:active');
    expect(active).toContain('--mtg-surface-sunken');
  });

  it('declares :active before the current-mode rule, so the current item keeps its Raised look under a press', () => {
    const css = uiStyleSheet();
    expect(css.indexOf('.mtg-modes__item:active')).toBeLessThan(
      css.indexOf(".mtg-modes__item[aria-current='page']"),
    );
  });
});

// The shell mark is the one place a person can tell which set they are
// looking at without leaving the page. "MTG Lab" over a named set says
// nothing; the set's own name is what the mark should carry.
describe('LabApp names the shell after the staged set', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubSetFetch(name: string | null): void {
    const setBody =
      name === null
        ? { formatVersion: 1, cards: EXAMPLE_CARDS }
        : {
            formatVersion: 1,
            set: { code: 'TGR', name, theme: 't', seed: 's', profile: 'p v1' },
            cards: EXAMPLE_CARDS,
          };
    vi.stubGlobal('fetch', (url: string) =>
      url === 'set.json'
        ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(setBody) })
        : Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') }),
    );
  }

  it('shows the staged set’s name in place of the generic title', async () => {
    stubSetFetch('Tideglass Reach');
    render(
      h(LabApp, {
        replayUrl: 'missing.jsonl',
        setUrl: 'set.json',
        cards: EXAMPLE_CARDS,
        title: 'MTG Lab',
      }),
    );
    // Scoped to the bar: the Cards tab names the staged set over its gallery
    // too (`mtg-ihtz`), so an unscoped query answers about the wrong element.
    await waitFor(() => {
      expect(within(screen.getByRole('banner')).getByText('Tideglass Reach')).toBeTruthy();
    });
    expect(screen.queryByText('MTG Lab')).toBeNull();
  });

  it('falls back to "MTG Lab" when the staged set has no name', async () => {
    stubSetFetch(null);
    render(
      h(LabApp, {
        replayUrl: 'missing.jsonl',
        setUrl: 'set.json',
        cards: EXAMPLE_CARDS,
      }),
    );
    await waitFor(() => {
      expect(screen.getByText('MTG Lab')).toBeTruthy();
    });
  });

  it('falls back to "MTG Lab" when nothing is staged at all', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') }),
    );
    render(h(LabApp, { replayUrl: 'missing.jsonl', cards: EXAMPLE_CARDS }));
    await waitFor(() => {
      expect(screen.getByText('MTG Lab')).toBeTruthy();
    });
  });
});
