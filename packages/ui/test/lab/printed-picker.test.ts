// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { LabApp } from '../../src/dev/LabApp';
import { hashSource } from '../../src/app/router';
import { SET_INDEX_VERSION } from '../../src/lab/set-index';
import { LOADING_TITLE } from '../../src/routes/PlayRoute';
import { OPPONENT_CHOICE_LABEL } from '../../src/routes/play/OpponentChoice';

// The same tolerance `lab.test.ts` sets and for the same reason: every fetch here
// resolves against an in-memory stub, so what this buys is tolerance for a
// starved event loop rather than for work that has not been asked for. mtg-m9enc:
// `findByRole('button', { name: 'Generate sealed pool' })` (below, after the
// Sealed link click) failed on Testing Library's own 1s default at host load
// 33-37 while the surrounding test still finished in 2-4.5s of its untouched 5s
// vitest budget, so the fix is this knob and not a longer test timeout.
configure({ asyncUtilTimeout: 4_000 });

const read = (file: string): unknown =>
  JSON.parse(readFileSync(`packages/data/data/akh-hou/${file}`, 'utf8'));
const row = {
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
    play: {
      status: 'unavailable',
      reason: 'Full Forge play admission is still in progress.',
    },
  },
};
const props = {
  cards: EXAMPLE_CARDS,
  setIndexUrl: 'index.json',
  printedFormatIndexUrl: 'formats/index.json',
};
/** Every url the page asked for, so a test can say the index was actually read. */
const asked: string[] = [];
function setup(hash = '#/cards', missing = false, availability: typeof row.availability = row.availability) {
  hashSource()!.location.hash = hash;
  asked.length = 0;
  vi.stubGlobal('fetch', async (url: string) => {
    asked.push(url);
    const body =
      url === 'formats/index.json'
        ? missing
          ? null
          : { schemaVersion: 2, formats: [{ ...row, availability }] }
        : url.startsWith('formats/akh-hou/')
          ? read(url.split('/').at(-1)!)
          : url === 'index.json'
            ? {
                formatVersion: SET_INDEX_VERSION,
                selected: 'm11',
                sets: [
                  {
                    stem: 'm11',
                    name: 'Magic 2011',
                    code: 'M11',
                    what: 'fixture',
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
    return {
      ok: body !== null,
      status: body === null ? 404 : 200,
      headers: { get: () => 'application/json' },
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * Let every pending fetch and effect settle.
 *
 * A route that draws no chooser has nothing on screen that changes when the
 * printed index lands, so a test about what the page *did not* do waits this
 * way instead of waiting on an element (`../../src/dev/LabApp.ts` writes the
 * default printed source in an effect, and that is the write being ruled out).
 */
/** The attribute a node carries, without the DOM lib (`../play/opponent-choice.test.ts`). */
function attr(node: unknown, name: string): string | null {
  return (node as { readonly getAttribute: (name: string) => string | null }).getAttribute(name);
}

async function settle(): Promise<void> {
  for (let tick = 0; tick < 10; tick += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

it('opens the displayed printed format at the root when no generated set is staged', async () => {
  // The root is Constructed, which a printed format is never played on
  // (`../../src/routes/play/sources.ts`): it is drafted and sealed, and its
  // decks are Commander's. What the root does is put the source in the hash,
  // so every tab that reads one reads this rather than the example cards.
  setup('');
  render(h(LabApp, { ...props, setIndexUrl: 'missing-index.json' }));
  await waitFor(() => expect(hashSource()!.location.hash).toContain('source=printed%3Aakh-hou'));
  expect(screen.queryByText(/DSL example cards/)).toBeNull();
  await screen.findByText(/this section has nothing to deal/);
  fireEvent.click(await screen.findByRole('link', { name: 'Sealed' }));
  await screen.findByRole('button', { name: 'Generate sealed pool' });
  fireEvent.click(screen.getAllByRole('link', { name: 'Cards' })[0]!);
  await screen.findByText('550 of 550 shown');
});

it('keeps an existing generated default when printed formats are also staged', async () => {
  // The Sealed section, whose chooser's button is the sign the generated set landed.
  setup('#/play/sealed');
  render(h(LabApp, props));
  await screen.findByRole('button', { name: 'Generate sealed pool' });
  expect(hashSource()!.location.hash).not.toContain('source=printed');
  // Both are offered as chips and the generated one is the pressed chip.
  expect(screen.getByRole('button', { name: 'Amonkhet / Hour of Devastation' })).toBeDefined();
  expect(attr(screen.getByRole('button', { name: 'Magic 2011' }), 'aria-pressed')).toBe('true');
});

it('keeps a flat staged set when the generated index is absent', async () => {
  // The Sealed section, whose chooser's button is the sign the generated set landed.
  setup('#/play/sealed');
  render(h(LabApp, { ...props, setIndexUrl: 'missing-index.json', setUrl: 'm11.json' }));
  await screen.findByRole('button', { name: 'Generate sealed pool' });
  expect(hashSource()!.location.hash).not.toContain('source=printed');
  expect(screen.queryByText(/DSL example cards/)).toBeNull();
  // The flat-props set has no index row to take a name off and takes the
  // document's, so its chip names the set rather than saying `This set`.
  expect(attr(screen.getByRole('button', { name: 'Magic 2011' }), 'aria-pressed')).toBe('true');
});

it('waits for a delayed generated index instead of selecting a ready printed format', async () => {
  // The Sealed section, whose chooser's button is the sign the generated set landed.
  setup('#/play/sealed');
  const originalFetch = globalThis.fetch;
  let releaseIndex: () => void = () => undefined;
  const pendingIndex = new Promise<void>((resolve) => {
    releaseIndex = resolve;
  });
  vi.stubGlobal('fetch', async (url: string) => {
    if (url === 'index.json') await pendingIndex;
    return originalFetch(url);
  });
  render(h(LabApp, props));
  await screen.findByText(LOADING_TITLE);
  expect(screen.queryByRole('button', { name: 'Generate sealed pool' })).toBeNull();
  expect(hashSource()!.location.hash).not.toContain('source=printed');
  releaseIndex();
  await screen.findByRole('button', { name: 'Generate sealed pool' });
  // The printed format was staged the whole time, and the wait was for the
  // generated set, which is the one the section opens on.
  expect(screen.getByRole('button', { name: 'Amonkhet / Hour of Devastation' })).toBeDefined();
  expect(attr(screen.getByRole('button', { name: 'Magic 2011' }), 'aria-pressed')).toBe('true');
  expect(hashSource()!.location.hash).not.toContain('source=printed');
});

it.each(['room', 'table'])(
  'preserves an existing %s route when only printed formats are staged',
  async (key) => {
    setup(`#/play?${key}=existing`);
    render(h(LabApp, { ...props, setIndexUrl: 'missing-index.json' }));
    await settle();
    expect(asked).toContain('formats/index.json');
    expect(hashSource()!.location.hash).toBe(`#/play?${key}=existing`);
    // A seat is dealt by whichever lab opened it and it plays that lab's set,
    // so the section's own source never takes the page from it.
    expect(screen.queryByRole('button', { name: 'Generate sealed pool' })).toBeNull();
  },
);

it('offers individual sources and the combined format without replacing generated set data', async () => {
  setup();
  render(h(LabApp, props));
  await screen.findByRole('option', { name: 'Amonkhet' });
  const picker = screen.getByRole('combobox', { name: 'Set' });
  fireEvent.change(picker, { target: { value: 'printed:akh-hou:AKH' } });
  await screen.findByText('287 of 287 shown');
  fireEvent.change(picker, { target: { value: 'printed:akh-hou:HOU' } });
  await screen.findByText('209 of 209 shown');
  fireEvent.change(picker, { target: { value: 'printed:akh-hou' } });
  await screen.findByText('550 of 550 shown');
  expect(screen.queryByRole('option', { name: 'Amonkhet Invocations' })).toBeNull();
  fireEvent.change(picker, { target: { value: 'm11' } });
  await screen.findByText(EXAMPLE_CARDS[0]!.name);
  expect(screen.queryByText('550 of 550 shown')).toBeNull();
}, 15_000);

it('lists a one-set format once, and an old link into its only set lights that row', async () => {
  // `mtg-u7fpr`. Innistrad is one format holding one set, and the picker
  // listed it twice: the format, then its only set under the same name. The
  // set-level stem still loads, because it was a working link, but the picker
  // has one Innistrad and that is the row it selects.
  const isd = {
    id: 'isd',
    name: 'Innistrad',
    formatUrl: 'formats/isd/isd-limited-format-v1.json',
    catalogs: [{ code: 'ISD', name: 'Innistrad', url: 'formats/isd/isd-printed-catalog-v1.json' }],
    availability: row.availability,
  };
  hashSource()!.location.hash = '#/cards?source=printed%3Aisd%3AISD';
  vi.stubGlobal('fetch', async (url: string) => {
    const body =
      url === 'formats/index.json'
        ? { schemaVersion: 2, formats: [row, isd] }
        : url.startsWith('formats/akh-hou/')
          ? read(url.split('/').at(-1)!)
          : url.startsWith('formats/isd/')
            ? JSON.parse(readFileSync(`packages/data/data/isd/${url.split('/').at(-1)!}`, 'utf8'))
            : null;
    return {
      ok: body !== null,
      status: body === null ? 404 : 200,
      headers: { get: () => 'application/json' },
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
  render(h(LabApp, props));
  await screen.findByText('264 of 264 shown');
  expect(screen.getAllByRole('option', { name: 'Innistrad' })).toHaveLength(1);
  expect(screen.getAllByRole('option', { name: 'Amonkhet' })).toHaveLength(1);
  expect(screen.getByRole('option', { name: 'Amonkhet / Hour of Devastation' })).toBeDefined();
  const picker = screen.getByRole('combobox', { name: 'Set' }) as unknown as { value: string };
  expect(picker.value).toBe('printed:isd');
});

it('restores a printed selection and keeps its identity across tabs without DSL fallback', async () => {
  setup('#/cards?source=printed%3Aakh-hou%3AHOU');
  render(h(LabApp, props));
  await screen.findByText('209 of 209 shown');
  // Draft is a section of Play: the tab first, then the section under it. The
  // section link has no click handler (`../../src/app/Shell.ts` on `subItem`),
  // so jsdom follows the fragment and the router hears the `hashchange`.
  fireEvent.click(screen.getAllByRole('link', { name: 'Play' })[0]!);
  fireEvent.click(await screen.findByRole('link', { name: 'Draft' }));
  await waitFor(() =>
    expect(hashSource()!.location.hash).toBe('#/play/draft?source=printed%3Aakh-hou%3AHOU'),
  );
  expect(await screen.findByText(/Deck-aware bots.*authored set evaluations/)).toBeTruthy();
  expect(screen.queryByText(/DSL example cards/)).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'New draft' }));
  await screen.findByText('Pack 1 · Pick 1');
  expect(hashSource()!.location.hash).toContain('source=printed%3Aakh-hou%3AHOU');
});

it('shows missing printed data explicitly instead of selecting Magic 2011', async () => {
  setup('#/cards?source=printed%3Aakh-hou', true);
  render(h(LabApp, props));
  await screen.findByText('Printed formats are not staged.');
  expect((screen.getByRole('combobox', { name: 'Set' }) as unknown as { value: string }).value).toBe(
    'printed:akh-hou',
  );
  expect(screen.queryByText(EXAMPLE_CARDS[0]!.name)).toBeNull();
});

it('rejects malformed printed links without loading a different source', async () => {
  setup('#/cards?source=printed%3Aakh-hou%3AHOU%3Aextra');
  render(h(LabApp, props));
  await screen.findByText('Invalid printed format selection: printed:akh-hou:HOU:extra');
  expect(screen.queryByText('209 of 209 shown')).toBeNull();
});

it('opens the combined sealed product from a selected source gallery', async () => {
  setup('#/play/sealed?source=printed%3Aakh-hou%3AHOU');
  render(h(LabApp, props));
  fireEvent.click(await screen.findByRole('button', { name: 'Generate sealed pool' }));
  await screen.findByText(/84 physical cards/);
  expect(hashSource()!.location.hash).toContain('seed=');
  expect(hashSource()!.location.hash).toContain('source=printed%3Aakh-hou%3AHOU');
});

it('keeps unavailable printed products visible with their refusal reasons', async () => {
  const closed = { ...row.availability, draft: 'unavailable', sealed: 'unavailable' } as const;
  setup('#/draft?source=printed%3Aakh-hou', false, closed);
  const view = render(h(LabApp, props));
  const draftSource = await screen.findByRole('button', {
    name: /Amonkhet \/ Hour of Devastation.*Draft is not available for this printed format\./,
  });
  expect(attr(draftSource, 'disabled')).not.toBeNull();
  expect(attr(draftSource, 'aria-disabled')).toBe('true');
  expect(screen.getByRole('heading', { name: 'Amonkhet / Hour of Devastation' })).toBeDefined();
  view.unmount();
  setup('#/play/sealed?source=printed%3Aakh-hou', false, closed);
  render(h(LabApp, props));
  const sealedSource = await screen.findByRole('button', {
    name: /Amonkhet \/ Hour of Devastation.*Sealed is not available for this printed format\./,
  });
  expect(attr(sealedSource, 'disabled')).not.toBeNull();
  expect(attr(sealedSource, 'aria-disabled')).toBe('true');
  expect(screen.getByRole('heading', { name: 'Amonkhet / Hour of Devastation' })).toBeDefined();
});

it('keeps a constructed format off the picker and plays it on the Commander section', async () => {
  // `mtg-bc2.154.6.5.6`, narrowed by `mtg-a982g.5`. A Commander precon set has
  // no pack to open, so the header's picker -- which chooses what the browsing
  // tabs show -- lists the booster formats only, and the decks are the
  // Commander section's. A link to the set still opens its gallery and still
  // opens its decks.
  const scd = {
    id: 'scd',
    name: 'Starter Commander Decks 2022',
    kind: 'constructed',
    variant: 'commander',
    formatUrl: 'formats/scd/scd-constructed-format-v1.json',
    catalogs: [
      { code: 'SCD', name: 'Starter Commander Decks 2022', url: 'formats/scd/scd-printed-catalog-v1.json' },
    ],
    availability: {
      browse: 'available',
      draft: 'unavailable',
      sealed: 'unavailable',
      play: {
        status: 'supported',
        reason: 'The command-zone contracts are witnessed on the installed Forge.',
      },
    },
  };
  hashSource()!.location.hash = '#/cards?source=printed%3Aakh-hou';
  vi.stubGlobal('fetch', async (url: string) => {
    const body =
      url === 'formats/index.json'
        ? { schemaVersion: 2, formats: [row, scd] }
        : url.startsWith('formats/akh-hou/')
          ? read(url.split('/').at(-1)!)
          : url.startsWith('formats/scd/')
            ? JSON.parse(readFileSync(`packages/data/data/scd/${url.split('/').at(-1)!}`, 'utf8'))
            : null;
    return {
      ok: body !== null,
      status: body === null ? 404 : 200,
      headers: { get: () => 'application/json' },
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
  render(h(LabApp, props));
  await screen.findByText('550 of 550 shown');
  expect(screen.getByRole('option', { name: 'Amonkhet / Hour of Devastation' })).toBeDefined();
  expect(screen.queryByRole('option', { name: 'Starter Commander Decks 2022' })).toBeNull();
  hashSource()!.location.hash = '#/cards/gallery?source=printed%3Ascd';
  await screen.findByText('Starter Commander Decks 2022', { selector: 'h1' }, { timeout: 10000 });
  // The Commander section hosts the decks, under the format's name.
  hashSource()!.location.hash = '#/play/commander?source=printed%3Ascd';
  // `mtg-r9vgk` took the whole-format `Decks` census and the inline card list
  // off the play page; the decks are reached through the picker and a button.
  await screen.findByRole('button', { name: 'View Chaos Incarnate' }, { timeout: 10000 });
  expect(screen.queryByRole('list', { name: 'Decks' })).toBeNull();
  // And the format's name is no longer drawn over it. the playtester, 2026-09-17:
  // the presses were to be moved into the spot the name was holding, so the
  // landing's header comes off with the cells and the band's own buttons are
  // what the upper left carries. Which set this is stays readable on the source
  // chip that is selected.
  expect(screen.queryByRole('heading', { name: 'Starter Commander Decks 2022' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Play Forge match' })).toBeDefined();
  expect(screen.getByRole('combobox', { name: 'Your deck' })).toBeDefined();
  expect(screen.getByRole('combobox', { name: 'Across the table' })).toBeDefined();
  // And the two opponent cells are gone from it (the playtester, 2026-09-17): both
  // ways to play this deck are presses on the band above, so a column to choose
  // between them is a control that decides nothing.
  expect(screen.queryByRole('group', { name: OPPONENT_CHOICE_LABEL })).toBeNull();
}, 30000);
