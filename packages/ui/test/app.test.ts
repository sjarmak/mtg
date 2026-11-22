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
import {
  DEFAULT_MODE,
  DEFAULT_SUBS,
  MODE_LABELS,
  PRIMARY_MODES,
  UI_MODES,
  UI_SUBS,
  hashSource,
  parseHash,
  routeAt,
  routeHash,
} from '../src/app/router';
import type { RouteAt } from '../src/app/router';
import { uiStyleSheet } from '../src/styles/index';
import { routeScope, subScope } from '../src/styles/tokens';

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

/** Every (mode, section) pair the router can land on. */
const EVERY_AT: readonly RouteAt[] = UI_MODES.flatMap((mode) =>
  UI_SUBS[mode].map((sub) => routeAt(mode, sub)),
);

/**
 * One view per mode, each naming the section it was asked for, so a test can
 * read which (mode, sub) the router handed it straight off the screen.
 */
const VIEWS: UiViews = {
  play: (router) => h('p', null, `play:${router.route.sub}`),
  customize: (router) => h('p', null, `customize:${router.route.sub}`),
  cards: (router) => h('p', null, `cards:${router.route.sub}`),
  analysis: (router) =>
    h(
      'p',
      null,
      `analysis:${router.route.sub}:${router.route.params['game'] ?? router.route.params['run'] ?? 'none'}`,
    ),
};

describe('parseHash', () => {
  it('reads every mode onto its default section', () => {
    for (const mode of UI_MODES) {
      expect(parseHash(`#/${mode}`)).toEqual(routeAt(mode, DEFAULT_SUBS[mode]));
    }
  });

  it('reads every section of every mode', () => {
    for (const at of EVERY_AT) {
      expect(parseHash(`#/${at.mode}/${at.sub}`)).toEqual({ ...at, params: {} });
    }
  });

  it('falls back to the default mode for anything unrecognized', () => {
    expect(parseHash('').mode).toBe(DEFAULT_MODE);
    expect(parseHash('#/').mode).toBe(DEFAULT_MODE);
    expect(parseHash('#/nonsense').mode).toBe(DEFAULT_MODE);
    expect(parseHash('#/cards/extra/segments')).toEqual(routeAt('cards', 'gallery'));
    expect(parseHash('#/play/nonsense')).toEqual(routeAt('play', 'constructed'));
  });

  it('reads params and tolerates a missing hash marker', () => {
    expect(parseHash('#/play/draft?seed=1')).toEqual(routeAt('play', 'draft', { seed: '1' }));
    expect(parseHash('/analysis/replay?game=3')).toEqual(routeAt('analysis', 'replay', { game: '3' }));
    expect(parseHash('#/play/commander')).toEqual(routeAt('play', 'commander'));
  });

  // A seat token names the section it belongs to: a `?table=` is a constructed
  // game and a `?room=` is a sealed one, so a link that carries either lands on
  // the right section without spelling it.
  it('reads a seat token as the play section it belongs to', () => {
    expect(parseHash('#/play?table=t-1')).toEqual(routeAt('play', 'constructed', { table: 't-1' }));
    expect(parseHash('#/play?room=r-1')).toEqual(routeAt('play', 'sealed', { room: 'r-1' }));
    // A spelled section wins over the token.
    expect(parseHash('#/play/draft?room=r-1')).toEqual(routeAt('play', 'draft', { room: 'r-1' }));
  });

  // Every link this repository has written down, every bookmark and the
  // launcher's own stdout say the retired names, and the unknown-mode rule
  // above would land all of them on Play with no sign anything had moved. So
  // each retired hash is read onto the section it became, with its params.
  it('still reads the hashes the retired tabs used to have', () => {
    expect(parseHash('#/draft?seed=1')).toEqual(routeAt('play', 'draft', { seed: '1' }));
    expect(parseHash('#/deck?open=build')).toEqual(routeAt('customize', 'decks', { open: 'build' }));
    expect(parseHash('#/decks')).toEqual(routeAt('customize', 'decks'));
    expect(parseHash('#/design')).toEqual(routeAt('customize', 'sets'));
    expect(parseHash('#/sets')).toEqual(routeAt('customize', 'sets'));
    expect(parseHash('#/replay?game=g')).toEqual(routeAt('analysis', 'replay', { game: 'g' }));
    expect(parseHash('#/home')).toEqual(routeAt('play', 'constructed'));
    expect(parseHash('#/more')).toEqual(routeAt('play', 'constructed'));
  });

  // And reads them only. An alias that round-trips is a second name for a
  // route, which is two URLs for one page and an `aria-current` comparison that
  // fails on whichever one the link happened to use.
  it('writes the new hash and never a retired one', () => {
    expect(routeHash(parseHash('#/deck'))).toBe('#/customize/decks');
    expect(routeHash(parseHash('#/replay?game=g'))).toBe('#/analysis/replay?game=g');
  });
});

/**
 * The destinations, as a list rather than as a rendered bar.
 *
 * `../src/app/Shell.ts` draws `PRIMARY_MODES`, so what that one array holds is
 * the whole information architecture: four peers, each with a row of sections
 * under it, and the picker in the bar is the set list on every route.
 */
describe('the destinations', () => {
  it('are the four, in the order they were asked for', () => {
    expect(PRIMARY_MODES).toEqual(['play', 'customize', 'cards', 'analysis']);
  });

  // The gate that bites when a route is added later: a mode outside the primary
  // row is a page with no way to reach it.
  it('leave no mode unreachable, and name no mode twice', () => {
    expect(new Set(PRIMARY_MODES).size).toBe(PRIMARY_MODES.length);
    expect([...PRIMARY_MODES].sort()).toEqual([...UI_MODES].sort());
  });

  it('each carry a drawn label, and every section does too', () => {
    for (const mode of UI_MODES) {
      expect(MODE_LABELS[mode].length, `${mode} has no label to draw`).toBeGreaterThan(0);
      expect(UI_SUBS[mode]).toContain(DEFAULT_SUBS[mode]);
    }
    expect(MODE_LABELS.customize).toBe('Customize');
  });
});

describe('routeHash', () => {
  it('round-trips every section', () => {
    for (const at of EVERY_AT) {
      const route = { ...at, params: { game: '2', turn: '7' } };
      expect(parseHash(routeHash(route))).toEqual(route);
    }
  });

  it('emits the bare mode when no section is named, which lands on the default one', () => {
    expect(routeHash({ mode: 'play' })).toBe('#/play');
    expect(parseHash(routeHash({ mode: 'analysis' }))).toEqual(routeAt('analysis', 'explorer'));
  });

  it('sorts params and drops empty ones', () => {
    expect(routeHash({ mode: 'cards', params: { z: '1', a: '2', gone: '' } })).toBe('#/cards?a=2&z=1');
    expect(routeHash({ mode: 'analysis', sub: 'replay', params: {} })).toBe('#/analysis/replay');
  });
});

describe('App', () => {
  beforeEach(() => {
    setHash('#/analysis');
  });

  it('renders the view for the current hash', async () => {
    setHash('#/replay?game=4');
    render(h(App, { views: VIEWS, title: 'MTG Lab' }));
    await waitFor(() => {
      expect(screen.getByText('analysis:replay:4')).toBeTruthy();
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
      }),
    );
    await waitFor(() => {
      expect(screen.getByText('play:constructed')).toBeTruthy();
    });
    expect(screen.getByText('the flagship set')).toBeTruthy();
    const navigation = screen.getByRole('navigation', { name: 'View mode' });
    expect(within(navigation).getByRole('link', { name: 'Customize' })).toBeTruthy();
    expect(within(navigation).getByRole('link', { name: 'Cards' })).toBeTruthy();
    expect(within(navigation).getByRole('link', { name: 'Analysis' })).toBeTruthy();
    expect(screen.queryByText('play, analyze, replay')).toBeNull();
    expect(screen.queryByText('TGR · 3 games · seed slice/v0')).toBeNull();
    expect(uiStyleSheet()).toContain(
      `.mtg-shell${routeScope('play')} .mtg-shell__bar {\n  gap: var(--mtg-space-2);`,
    );
  });

  it('navigates when a mode is chosen', async () => {
    render(h(App, { views: VIEWS }));
    fireEvent.click(screen.getByRole('link', { name: 'Cards' }));
    await waitFor(() => {
      expect(screen.getByText('cards:gallery')).toBeTruthy();
    });
    expect(currentHash()).toBe('#/cards');
  });

  it('drops the previous mode params when switching', async () => {
    setHash('#/analysis/replay?game=9');
    render(h(App, { views: VIEWS }));
    await waitFor(() => {
      expect(screen.getByText('analysis:replay:9')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('link', { name: 'Customize' }));
    await waitFor(() => {
      expect(screen.getByText('customize:sets')).toBeTruthy();
    });
    expect(currentHash()).toBe('#/customize');
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

/**
 * The un-hijacked click is left to the browser, and jsdom's browser follows a
 * fragment link on a later tick, in this window (a real one would open a tab).
 * Waiting for it keeps that navigation from landing in the next test's hash.
 */
async function browserFollowsLink(): Promise<void> {
  await waitFor(() => {
    expect(currentHash()).toBe('#/cards');
  });
}

// A `<button>` has no `href`, so middle-click and "open in a new tab" do
// nothing on it. Comparing two routes side by side means losing one of them.
// The mode control is now built from real anchors carrying the hash the
// router would put there itself, so the browser's own navigation handles the
// cases the shell never has to know about.
describe('mode items are real anchors', () => {
  it('carries the exact hash routeHash() would produce for every destination', () => {
    const html = renderToStaticMarkup(
      h(Shell, { mode: 'cards', onSelectMode: () => undefined, children: null }),
    );
    for (const mode of PRIMARY_MODES) {
      expect(html).toContain(`href="${routeHash({ mode, params: {} })}"`);
    }
    // And nothing else: the modes, the mark (which points at Play, already in
    // the list) and one anchor per section of the mode on screen. A bar with
    // one more is a bar that grew a destination without anybody deciding to.
    expect(html.split('href=').length - 1).toBe(PRIMARY_MODES.length + 1 + UI_SUBS.cards.length);
  });

  it('still switches modes and updates the hash on a plain click', async () => {
    setHash('#/analysis');
    render(h(App, { views: VIEWS }));
    fireEvent.click(screen.getByRole('link', { name: 'Cards' }));
    await waitFor(() => {
      expect(screen.getByText('cards:gallery')).toBeTruthy();
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
    for (const mode of PRIMARY_MODES) {
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
    expect(screen.queryByText('cards:gallery')).toBeNull();
    expect(currentHash()).toBe('#/analysis');
    await browserFollowsLink();
  });

  it('does not hijack a ctrl/cmd click either', async () => {
    setHash('#/analysis');
    render(h(App, { views: VIEWS }));
    fireEvent.click(screen.getByRole('link', { name: 'Cards' }), { ctrlKey: true });
    expect(screen.queryByText('cards:gallery')).toBeNull();
    expect(currentHash()).toBe('#/analysis');
    await browserFollowsLink();
  });
});

/**
 * The landing counter's two callers. `goTo` is the mark and the tab row, and
 * both mean *take me to that destination's landing screen*; `goToSub` is a
 * move between sections of one destination, and a section row that re-landed
 * the route on every press would throw away the game in progress
 * (`../src/app/router.ts` on `landing`).
 */
describe('moving between sections', () => {
  const COUNTED: UiViews = {
    ...VIEWS,
    play: (router) =>
      h(
        'div',
        null,
        h('p', null, `landing:${String(router.landing)} at ${router.route.sub}`),
        h('button', { type: 'button', onClick: () => router.goToSub('draft') }, 'to draft'),
        h('button', { type: 'button', onClick: () => router.goTo({ mode: 'play' }) }, 'land'),
      ),
  };

  it('keeps the params and does not count as a landing, where a mode press does', async () => {
    setHash('#/play?source=tgr');
    render(h(App, { views: COUNTED }));
    await waitFor(() => {
      expect(screen.getByText('landing:0 at constructed')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'to draft' }));
    await waitFor(() => {
      expect(screen.getByText('landing:0 at draft')).toBeTruthy();
    });
    expect(currentHash()).toBe('#/play/draft?source=tgr');
    fireEvent.click(screen.getByRole('button', { name: 'land' }));
    await waitFor(() => {
      expect(screen.getByText('landing:1 at constructed')).toBeTruthy();
    });
    expect(currentHash()).toBe('#/play?source=tgr');
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
  it('matches the selector the token layer scopes a palette with, for every mode and section', () => {
    for (const at of EVERY_AT) {
      setHash(routeHash(at));
      render(h(App, { views: VIEWS }));
      expect(findRendered(`.mtg-shell${routeScope(at.mode)}${subScope(at.sub)}`)).not.toBeNull();
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

// The mark is the lab's name, always, and it is the way home (`mtg-aqxi.17`).
// It used to be the staged set's name, which the playtester rejected in one
// sentence: "instead of having the set name in the upper left always that
// should just be MTG Lab". Which set is staged is on the picker beside it.
describe('LabApp names the shell after the lab, not the staged set', () => {
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

  it('keeps the mark reading "MTG Lab" over a named set', async () => {
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
      expect(within(screen.getByRole('banner')).getByText('MTG Lab')).toBeTruthy();
    });
    expect(within(screen.getByRole('banner')).queryByText('Tideglass Reach')).toBeNull();
  });

  it('draws the mark as a link to Play', async () => {
    // It used to lead to a landing page that listed the sets, the decks and the
    // destinations, which is three things the destinations already hold. Play is
    // what a person opened the lab to do; the set list is the picker beside the
    // mark, on every route.
    stubSetFetch('Tideglass Reach');
    render(
      h(LabApp, {
        replayUrl: 'missing.jsonl',
        setUrl: 'set.json',
        cards: EXAMPLE_CARDS,
      }),
    );
    const mark = await waitFor(() =>
      within(screen.getByRole('banner')).getByRole('link', { name: 'MTG Lab, Play' }),
    );
    expect((mark as unknown as { getAttribute(name: string): string | null }).getAttribute('href')).toBe(
      '#/play',
    );
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
