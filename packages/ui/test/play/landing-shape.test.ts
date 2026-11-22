// @vitest-environment jsdom
/**
 * Every Play landing is the same page with a different set in it.
 *
 * `mtg-a982g.5`. The three drafts used to be three programs: the staged set
 * offered a boxed section and two opponents, Amonkhet offered a bare button and
 * no opponent at all, and the Legacy Cube offered a button with the cube's name
 * in it under a page title of its own. This file is the pin on that: one frame
 * (`../../src/routes/play/PlayLanding.ts`), one set of words, whichever source
 * the hash names. The cube's landing is the third of them and is checked in
 * `../legacy-cube/route.test.ts`, beside the staged Forge admission projection
 * it needs and this file has no reason to build.
 */
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { LabApp } from '../../src/dev/LabApp';
import { hashSource } from '../../src/app/router';
import { SET_INDEX_VERSION } from '../../src/lab/set-index';
import { DRAFT_NEW_LABEL } from '../../src/routes/draft/DraftChooser';
import {
  OPPONENT_BOT_LABEL,
  OPPONENT_CHOICE_LABEL,
  OPPONENT_LAN_LABEL,
} from '../../src/routes/play/OpponentChoice';
import { PlayLanding } from '../../src/routes/play/PlayLanding';
import { PLAY_GENERATE_LABEL } from '../../src/routes/play/SealedChooser';
import { SOURCE_CHOICE_LABEL } from '../../src/routes/play/SourceChoice';

const cube: unknown = JSON.parse(
  readFileSync('packages/data/data/legacy-cube-2021-card-catalog-v1.json', 'utf8'),
);
const printed = (file: string): unknown =>
  JSON.parse(readFileSync(`packages/data/data/akh-hou/${file}`, 'utf8'));
const printedRow = {
  id: 'akh-hou',
  name: 'Amonkhet / Hour of Devastation',
  formatUrl: 'formats/akh-hou/akh-hou-limited-format-v1.json',
  catalogs: [
    { code: 'AKH', name: 'Amonkhet', role: 'product' },
    { code: 'HOU', name: 'Hour of Devastation', role: 'product' },
    { code: 'MP2', name: 'Amonkhet Invocations', role: 'supplement' },
  ].map((source) => ({
    ...source,
    url: `formats/akh-hou/${source.code.toLowerCase()}-printed-catalog-v1.json`,
  })),
  availability: {
    browse: 'available',
    draft: 'available',
    sealed: 'available',
    play: { status: 'unavailable', reason: 'Full Forge play admission is still in progress.' },
  },
};
const props = {
  cards: EXAMPLE_CARDS,
  setIndexUrl: 'index.json',
  printedFormatIndexUrl: 'formats/index.json',
  legacyCubeUrl: 'cube.json',
};

function setup(hash: string): void {
  hashSource()!.location.hash = hash;
  vi.stubGlobal('fetch', (url: string) => {
    const body =
      url === 'cube.json'
        ? cube
        : url === 'formats/index.json'
          ? { schemaVersion: 2, formats: [printedRow] }
          : url.startsWith('formats/akh-hou/')
            ? printed(url.split('/').at(-1)!)
            : url === 'index.json'
              ? {
                  formatVersion: SET_INDEX_VERSION,
                  selected: 'm11',
                  sets: [
                    {
                      stem: 'm11',
                      name: 'Magic 2011',
                      code: 'M11',
                      what: 'test fixture',
                      cardCount: EXAMPLE_CARDS.length,
                      reduced: false,
                      origin: 'custom',
                      setUrl: 'm11.json',
                    },
                  ],
                }
              : url === 'm11.json'
                ? { set: { code: 'M11', name: 'Magic 2011' }, cards: EXAMPLE_CARDS }
                : null;
    return Promise.resolve({
      ok: body !== null,
      status: body === null ? 404 : 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  });
}

/** The attribute a node carries, without the DOM lib (`../play/opponent-choice.test.ts`). */
function attr(node: unknown, name: string): string | null {
  return (node as { readonly getAttribute: (name: string) => string | null }).getAttribute(name);
}

/** The text under a node, on the same terms. */
function text(node: unknown): string {
  return (node as { readonly textContent: string | null }).textContent ?? '';
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The two cells and the one press, which is the whole shape being pinned. */
async function expectLanding(primary: string, section: string): Promise<void> {
  // Five seconds rather than the one `findBy` defaults to. A printed format's
  // landing is four fetches deep -- the format index, then the format, then its
  // two catalogs -- and this file was drawing its press at about 1000ms, which
  // is the default: the staged set's landing passed at 1008ms and the printed
  // one failed at 1192ms, so which cases passed was a fact about the machine
  // rather than about the page. The wait is for a press that does arrive.
  const press = await screen.findByRole('button', { name: primary }, { timeout: 5000 });
  expect(attr(press, 'data-variant')).toBe('primary');
  const opponents = screen.getByRole('group', { name: OPPONENT_CHOICE_LABEL });
  expect(text(opponents)).toContain(OPPONENT_BOT_LABEL);
  expect(text(opponents)).toContain(OPPONENT_LAN_LABEL);
  // The words each landing used to have of its own.
  expect(screen.queryByRole('button', { name: 'Start draft' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'New Legacy Cube draft' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Open sealed pool' })).toBeNull();
  expect(screen.getByRole('heading', { level: 2, name: section })).toBeTruthy();
}

it('draws the staged set’s draft landing in the frame', async () => {
  setup('#/play/draft?source=m11');
  render(h(LabApp, props));
  await expectLanding(DRAFT_NEW_LABEL, 'Draft');
  expect(screen.getByRole('heading', { level: 1, name: 'Magic 2011' })).toBeTruthy();
});

it('draws a printed format’s draft landing in the same frame', async () => {
  setup('#/play/draft?source=printed:akh-hou');
  render(h(LabApp, props));
  await expectLanding(DRAFT_NEW_LABEL, 'Draft');
  expect(screen.getByRole('heading', { level: 1, name: 'Amonkhet / Hour of Devastation' })).toBeTruthy();
});

it('draws the staged set’s sealed landing in the frame', async () => {
  setup('#/play/sealed?source=m11');
  render(h(LabApp, props));
  await expectLanding(PLAY_GENERATE_LABEL, 'Sealed');
});

it('draws a printed format’s sealed landing in the same frame', async () => {
  setup('#/play/sealed?source=printed:akh-hou');
  render(h(LabApp, props));
  await expectLanding(PLAY_GENERATE_LABEL, 'Sealed');
});

/**
 * The press itself, over a hash carrying what a section leaves behind.
 *
 * A pick list, a bot policy, a pool, a path and a deck all name something
 * inside the set being left. Which opponent you are choosing is not: `vs` is a
 * fact about the person, so it rides across (`../../src/dev/LabApp.ts`). A
 * seed, a table token and a room token are the other three the press clears,
 * and none of them can be pressed beside: each of them is a dealt game, and a
 * dealt game takes the page from the landing, which the second test here pins.
 */
it('writes the pressed set into the hash and clears what belonged to the last one', async () => {
  setup(
    '#/play/draft?source=m11&cube=legacy-cube-2021-08&picks=aa&bot=greedy' +
      '&pool=full&path=p&deck=d&against=lan&vs=lan',
  );
  render(h(LabApp, props));
  fireEvent.click(await screen.findByRole('button', { name: 'Amonkhet / Hour of Devastation' }));
  await waitFor(() => {
    expect(hashSource()!.location.hash).toContain('source=printed%3Aakh-hou');
  });
  const hash = hashSource()!.location.hash;
  for (const param of ['cube', 'picks', 'bot', 'pool', 'path', 'deck', 'against'])
    expect(hash).not.toContain(`${param}=`);
  expect(hash).toContain('vs=lan');
});

it('draws no chips over a dealt draft, which is what the seed in the hash names', async () => {
  setup('#/play/draft?source=m11&seed=landing-shape');
  render(h(LabApp, props));
  await screen.findByRole('group', { name: /^Draft pack 1, pick 1$/ });
  expect(screen.queryByRole('group', { name: SOURCE_CHOICE_LABEL })).toBeNull();
  expect(screen.queryByRole('group', { name: OPPONENT_CHOICE_LABEL })).toBeNull();
});

/**
 * The one landing that has no cells.
 *
 * `mtg-r9vgk`, the playtester 2026-09-17. The Commander landing's body carries both
 * presses itself -- a Forge match on this machine and a Forge table over the
 * network, side by side in its own head bar -- so the column that chose between
 * them decides nothing and goes. The set's name goes with it, because the upper
 * left is the spot she asked those presses to move into and the name was what
 * was holding it; the chips still say which set is showing, so the landing
 * loses two parts rather than becoming a fourth landing.
 */
it('draws a landing with no cells as its bot body, keeping the chips and dropping the header', () => {
  render(
    h(PlayLanding, {
      setName: 'Starter Commander Decks 2022',
      setLabel: 'Magic set',
      setKind: 'printed',
      format: 'commander',
      // Two, because one chip is not a choice and `SourceChoice` draws nothing
      // for it; the point here is that the chips survive losing the cells.
      sources: [
        { kind: 'printed', stem: 'printed:scd', name: 'Starter Commander Decks 2022' },
        { kind: 'printed', stem: 'printed:akh-hou', name: 'Amonkhet / Hour of Devastation' },
      ],
      selected: 'printed:scd',
      onSource: () => undefined,
      opponent: 'bot',
      onOpponent: () => undefined,
      facts: { lan: { status: 'ready' } },
      playing: false,
      cells: false,
      bot: h('p', null, 'the decks'),
      lan: h('p', null, 'the network cell'),
    }),
  );
  expect(screen.getByText('the decks')).toBeTruthy();
  expect(screen.queryByRole('group', { name: OPPONENT_CHOICE_LABEL })).toBeNull();
  expect(screen.queryByText('the network cell')).toBeNull();
  expect(screen.queryByRole('heading', { level: 1, name: 'Starter Commander Decks 2022' })).toBeNull();
  expect(screen.getByRole('group', { name: SOURCE_CHOICE_LABEL })).toBeTruthy();
});
