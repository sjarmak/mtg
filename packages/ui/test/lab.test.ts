// @vitest-environment jsdom
/**
 * The reference wiring end to end: mount into a document, fetch a replay, and
 * show the three views over it.
 *
 * The document is reached through a narrow structural interface for the same
 * reason `src/mount.ts` uses one — the workspace tsconfig has no `lib: dom`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, screen, waitFor } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { LabApp } from '../src/dev/LabApp';
import { mount } from '../src/mount';
import { hashSource } from '../src/app/router';

/**
 * How long an assertion here may take to come true, which is not the same knob
 * as a test timeout.
 *
 * Every test in this file runs in under 100 ms on a quiet machine — the slowest
 * is 85 ms — so nothing here is CPU-bound the way `play.test.ts`'s click-through
 * is, and `vitest.config.ts` is explicit that raising its 5 s default is not the
 * answer and is guarded by a test. The knob that actually fires is Testing
 * Library's own, which polls for one second and then throws
 * `TestingLibraryElementError` regardless of how much budget the test still has.
 * Under five concurrent agents this file failed on exactly that, reporting
 * "Unable to find an element with the alt text" for a manifest fetch that
 * resolves instantly when the machine is idle.
 *
 * Every assertion below waits on a stubbed `fetch` that is already resolved, so
 * what this buys is tolerance for a starved event loop rather than tolerance for
 * work that has not been asked for. It cannot hide a hang: `waitFor` still
 * requires the assertion to become true, and the 5 s test timeout above it is
 * untouched and still fails first if nothing ever renders.
 */
const ASYNC_BUDGET_MS = 4_000;

configure({ asyncUtilTimeout: ASYNC_BUDGET_MS });

const COMMITTED_DECK = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'decklab',
  'fixtures',
  'decks',
  'boros-aggro.deck.json',
);

/** One measured run, the same fixture the analysis reader tests are built on. */
const RUN_FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'analysis', 'fixtures', 'run-a.json');

interface BodyLike {
  innerHTML: string;
}

interface DocumentLike {
  readonly body: BodyLike;
}

function documentOf(): DocumentLike {
  const candidate: unknown = (globalThis as { readonly document?: unknown }).document;
  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error('this test needs a jsdom document');
  }
  return candidate as DocumentLike;
}

function setHash(hash: string): void {
  const source = hashSource();
  if (source === null) throw new Error('this test needs a browser location');
  source.location.hash = hash;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  documentOf().body.innerHTML = '';
});

function stubFetch(body: string, ok = true): void {
  vi.stubGlobal('fetch', () =>
    Promise.resolve({ ok, status: ok ? 200 : 404, text: () => Promise.resolve(body) }),
  );
}

describe('mount', () => {
  it('renders into the named element', async () => {
    documentOf().body.innerHTML = '<div id="root"></div>';
    const app = mount('root', h('p', null, 'mounted'));
    await waitFor(() => {
      expect(screen.getByText('mounted')).toBeTruthy();
    });
    app.unmount();
  });

  it('names the element it could not find', () => {
    documentOf().body.innerHTML = '';
    expect(() => mount('missing', h('p', null, 'x'))).toThrow(/#missing/);
  });
});

describe('LabApp', () => {
  it('says how to measure a set rather than showing an empty dashboard', async () => {
    // No analysis document staged, which is the state of a fresh checkout. The
    // tab names the command that writes one instead of drawing a blank page —
    // `absent`, which this route had no way to express before `mtg-ey8g`.
    stubFetch('', false);
    setHash('#/analysis');
    documentOf().body.innerHTML = '<div id="root"></div>';
    const app = mount('root', h(LabApp, { analysisUrl: 'analysis.json', cards: EXAMPLE_CARDS }));
    await waitFor(() => {
      expect(screen.getByText('Nothing measured yet')).toBeTruthy();
    });
    expect(screen.getByText(/npm run analyze/)).toBeTruthy();
    app.unmount();
  });

  it('badges the shell with the set the numbers are about', async () => {
    // `mtg-ihtz`: the badge used to read the statistics log alone and print a
    // bare count, so a lab opened on one set wore another set's number on every
    // route with nothing to say so. The measured run leads now, and both
    // branches name their set code.
    const run: unknown = JSON.parse(readFileSync(RUN_FIXTURE, 'utf8'));
    vi.stubGlobal('fetch', (url: string) =>
      url === 'analysis.json'
        ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ runs: [run] }) })
        : Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') }),
    );
    setHash('#/analysis');
    documentOf().body.innerHTML = '<div id="root"></div>';
    const app = mount('root', h(LabApp, { analysisUrl: 'analysis.json', cards: EXAMPLE_CARDS }));
    await waitFor(() => {
      expect(screen.getByText('TGR · 5,400 games analyzed')).toBeTruthy();
    });
    app.unmount();
  });

  it('says nothing has been analyzed rather than showing a count of nothing', async () => {
    stubFetch('', false);
    setHash('#/analysis');
    documentOf().body.innerHTML = '<div id="root"></div>';
    const app = mount('root', h(LabApp, { analysisUrl: 'analysis.json', cards: EXAMPLE_CARDS }));
    await waitFor(() => {
      expect(screen.getByText('no set analyzed yet')).toBeTruthy();
    });
    app.unmount();
  });

  it('reports a document it could not read instead of an empty dashboard', async () => {
    // A body that is JSON but not an analysis document: `failed`, carrying why,
    // which is a different state from `absent` and drawn differently.
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ nope: true }) }),
    );
    setHash('#/analysis');
    documentOf().body.innerHTML = '<div id="root"></div>';
    const app = mount('root', h(LabApp, { analysisUrl: 'analysis.json', cards: EXAMPLE_CARDS }));
    await waitFor(() => {
      expect(screen.getByText('That analysis document could not be read')).toBeTruthy();
    });
    expect(screen.getByText(/no "runs" array/)).toBeTruthy();
    app.unmount();
  });

  it('fetches the staged deck and renders it in the deck view', async () => {
    const deck = readFileSync(COMMITTED_DECK, 'utf8');
    // Only `deck.json` answers: the replay fetch must fail in the same run, so
    // this also pins that one missing artifact does not take the other view down.
    vi.stubGlobal('fetch', (url: string) =>
      url === 'deck.json'
        ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(deck)) })
        : Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') }),
    );
    setHash('#/deck');
    documentOf().body.innerHTML = '<div id="root"></div>';
    const app = mount(
      'root',
      h(LabApp, { replayUrl: 'missing.jsonl', deckUrl: 'deck.json', cards: EXAMPLE_CARDS }),
    );
    await waitFor(() => {
      expect(screen.getByText('Mana base')).toBeTruthy();
    });
    app.unmount();
  });

  it('says how to stage a deck rather than showing an empty deck view', async () => {
    stubFetch('', false);
    setHash('#/deck');
    documentOf().body.innerHTML = '<div id="root"></div>';
    const app = mount(
      'root',
      h(LabApp, { replayUrl: 'missing.jsonl', deckUrl: 'deck.json', cards: EXAMPLE_CARDS }),
    );
    await waitFor(() => {
      expect(screen.getByText('No deck staged')).toBeTruthy();
    });
    app.unmount();
  });

  it('fetches the staged art manifest and renders a card’s own art', async () => {
    const card = EXAMPLE_CARDS[0];
    if (card === undefined) throw new Error('the DSL example set is empty');
    const manifest = {
      formatVersion: 2,
      art: { [card.id]: [{ href: 'art/one.png', alt: 'a lantern on a pier' }] },
    };
    vi.stubGlobal('fetch', (url: string) =>
      url === 'art.json'
        ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(manifest) })
        : Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') }),
    );
    setHash('#/cards');
    documentOf().body.innerHTML = '<div id="root"></div>';
    const app = mount(
      'root',
      h(LabApp, { replayUrl: 'missing.jsonl', artUrl: 'art.json', cards: EXAMPLE_CARDS }),
    );
    await waitFor(() => {
      expect(screen.getByAltText('a lantern on a pier')).toBeTruthy();
    });
    app.unmount();
  });

  it('leaves the cards pending when the manifest is not the shape it expects', async () => {
    vi.stubGlobal('fetch', (url: string) =>
      url === 'art.json'
        ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ formatVersion: 99 }) })
        : Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') }),
    );
    setHash('#/cards');
    documentOf().body.innerHTML = '<div id="root"></div>';
    const app = mount(
      'root',
      h(LabApp, { replayUrl: 'missing.jsonl', artUrl: 'art.json', cards: EXAMPLE_CARDS }),
    );
    await waitFor(() => {
      expect(screen.getByText(`${EXAMPLE_CARDS.length} of ${EXAMPLE_CARDS.length} shown`)).toBeTruthy();
    });
    expect(screen.queryByAltText('a lantern on a pier')).toBeNull();
    app.unmount();
  });

  it('still browses cards when there is no replay', async () => {
    stubFetch('', false);
    setHash('#/cards');
    documentOf().body.innerHTML = '<div id="root"></div>';
    const app = mount('root', h(LabApp, { replayUrl: 'missing.jsonl', cards: EXAMPLE_CARDS }));
    await waitFor(() => {
      expect(screen.getByText(`${EXAMPLE_CARDS.length} of ${EXAMPLE_CARDS.length} shown`)).toBeTruthy();
    });
    app.unmount();
  });
});
