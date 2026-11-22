// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EXAMPLE_CARDS, setBasics, setTokenCards } from '@mtg/dsl';
import { LabApp } from '../../src/dev/LabApp';
import { hashSource } from '../../src/app/router';
import { SET_INDEX_VERSION } from '../../src/lab/set-index';

/**
 * Budgeted rather than left to vitest's 5s default, and measured: the two tests
 * that browse the full 600-card cube 2.0 to 2.2s, this file alone with
 * MTG_TEST_WORKERS=1, three runs at host load 19.3 to 21.1 on 16 cores. Under
 * the load other lanes put on this box the same tests were seen at 3.8 to 4.5s
 * alone at load 28 to 34, and failed at the 5000ms default at load 29.8, so the
 * default decided which lane went red. 20s is about 4.4x that worst observed
 * run. File-scoped on purpose: the global `testTimeout` stays at the default
 * and nothing retries (`mtg-tqwbq`).
 */
vi.setConfig({ testTimeout: 20_000 });

const cube: unknown = JSON.parse(
  readFileSync('packages/data/data/legacy-cube-2021-card-catalog-v1.json', 'utf8'),
);
const props = { cards: EXAMPLE_CARDS, setIndexUrl: 'index.json', legacyCubeUrl: 'cube.json' };

function href(name: string): string | null {
  const link = screen.getAllByRole('link', { name })[0] as unknown as
    { getAttribute(name: string): string | null } | undefined;
  return link?.getAttribute('href') ?? null;
}

/**
 * Draft is a section of Play rather than a tab of its own, so reaching it is
 * two presses: the Play tab, then the Draft section under it. The section link
 * has no click handler of its own (`../../src/app/Shell.ts` on `subItem`), so
 * jsdom follows the fragment and the router hears the `hashchange`.
 */
async function openDraftSection(): Promise<void> {
  fireEvent.click(screen.getAllByRole('link', { name: 'Play' })[0]!);
  const draft = await screen.findByRole('link', { name: 'Draft' });
  fireEvent.click(draft);
}

function setup(hash = '#/cards'): void {
  hashSource()!.location.hash = hash;
  vi.stubGlobal('fetch', (url: string) => {
    const body =
      url === 'cube.json'
        ? cube
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
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('offers the cube with ordinary sets, browses all 600 and searches printed rules', async () => {
  setup();
  render(h(LabApp, props));
  const picker = await screen.findByRole('combobox', { name: 'Set' });
  await screen.findByRole('option', { name: 'MTGO Legacy Cube' });
  fireEvent.change(picker, { target: { value: 'legacy-cube-2021-08' } });
  await screen.findByText('600 of 600 shown');
  // The Play tab carries the cube on its href, so the source survives the way
  // to a draft; the section row under Play then carries it on to Draft.
  expect(href('Play')).toBe('#/play?source=legacy-cube-2021-08');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Reanimate' } });
  await screen.findByText('1 of 600 shown');
  expect(screen.getAllByText('Reanimate').length).toBeGreaterThan(0);
  expect(hashSource()!.location.hash).toContain('source=legacy-cube-2021-08');
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'target creature card from a graveyard' },
  });
  expect(screen.queryByText('0 of 600 shown')).toBeNull();
});

it('restores the cube on refresh, keeps it across tabs, and switches back cleanly', async () => {
  setup('#/cards?source=legacy-cube-2021-08');
  const first = render(h(LabApp, props));
  await screen.findByText('600 of 600 shown');
  first.unmount();
  render(h(LabApp, props));
  await screen.findByText('600 of 600 shown');
  await openDraftSection();
  await waitFor(() =>
    expect(hashSource()!.location.hash).toContain('/play/draft?source=legacy-cube-2021-08'),
  );
  // The cube takes the Draft section outright rather than sitting as a row
  // under the set's chooser (`mtg-a982g.1`); this lab stages no playable pool,
  // so what its route draws is the refusal, and never the DSL set's packs.
  await screen.findByText('Playable Legacy Cube is unavailable');
  expect(screen.queryByText(/DSL example cards/)).toBeNull();
  // Switched on the chips above the landing, which is where a Play section's
  // set is chosen now: the header's picker is not drawn on Play at all
  // (`mtg-a982g.5`). The press writes the source and nothing else, so the hash
  // is exactly the one a link to this landing would be.
  fireEvent.click(screen.getByRole('button', { name: 'Magic 2011' }));
  await waitFor(() => expect(hashSource()!.location.hash).toBe('#/play/draft?source=m11'));
  fireEvent.click(screen.getAllByRole('link', { name: 'Cards' })[0]!);
  await screen.findByRole('combobox', { name: 'In set' });
  // Staged galleries include tokens and basics; the bare-card count is transient.
  const surfaces =
    EXAMPLE_CARDS.length + setTokenCards(EXAMPLE_CARDS).length + setBasics(EXAMPLE_CARDS).length;
  await screen.findByText(`${surfaces} of ${surfaces} shown`);
});

it('does not silently show a DSL set when the selected cube is unavailable', async () => {
  setup('#/cards?source=legacy-cube-2021-08');
  render(h(LabApp, { cards: EXAMPLE_CARDS, setIndexUrl: 'index.json' }));
  await screen.findByText('Legacy Cube is not staged.');
  expect(screen.queryByText(EXAMPLE_CARDS[0]!.name)).toBeNull();
});
