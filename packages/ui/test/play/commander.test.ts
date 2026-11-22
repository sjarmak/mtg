// @vitest-environment jsdom
/**
 * The Commander section, which is the printed decks and nothing else.
 *
 * `mtg-a982g.5`. Commander used to be the staged set's section like the other
 * three, which meant it offered a generated set that ships no command zone and
 * hid the Starter Commander decks behind a header dropdown listing them as if
 * they were a set to browse. The decks are a printed constructed format now
 * (`../../src/routes/play/sources.ts`), so the section either has one staged or
 * says so. The staged half is pinned in `../lab/printed-picker.test.ts`, beside
 * the format index that carries the decks; this is the other half, which no
 * amount of staging produces.
 */
import { createElement as h } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { COMMANDER_UNSTAGED_TITLE, LabApp } from '../../src/dev/LabApp';
import { hashSource } from '../../src/app/router';
import { SET_INDEX_VERSION } from '../../src/lab/set-index';
import { OPPONENT_CHOICE_LABEL } from '../../src/routes/play/OpponentChoice';
import { SOURCE_CHOICE_LABEL } from '../../src/routes/play/SourceChoice';

function setup(formats: readonly unknown[]): void {
  hashSource()!.location.hash = '#/play/commander';
  vi.stubGlobal('fetch', (url: string) => {
    const body =
      url === 'formats/index.json'
        ? { schemaVersion: 2, formats }
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
                  origin: 'official',
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('says the decks are not staged, and names the command that stages them', async () => {
  setup([]);
  render(
    h(LabApp, {
      cards: EXAMPLE_CARDS,
      setIndexUrl: 'index.json',
      printedFormatIndexUrl: 'formats/index.json',
    }),
  );
  await screen.findByRole('heading', { name: COMMANDER_UNSTAGED_TITLE });
  expect(screen.getByText(/npm run play/)).toBeTruthy();
  // A generated set is staged and is still not offered here: it ships no
  // command zone, so there is no chip and no pair of cells to press.
  expect(screen.queryByRole('group', { name: SOURCE_CHOICE_LABEL })).toBeNull();
  expect(screen.queryByRole('group', { name: OPPONENT_CHOICE_LABEL })).toBeNull();
});
