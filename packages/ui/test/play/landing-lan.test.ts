// @vitest-environment jsdom
/**
 * The network column of a Play landing, wired to what the lab's Forge says.
 *
 * `mtg-a982g.5` put the two opponent cells on every landing and `Over this
 * network` was dark on all of them, because nothing had been wired behind it.
 * Lane B's start control was mounted inside four routes instead, under the bot
 * column's body, so the cell that said the network was closed sat above a
 * button that opened one. This is the pin on the wiring: the cell reads the
 * lab's health answer (`../../src/routes/play/LanForgeStart.ts`), and the
 * control the cell promises is drawn as that column's body rather than beside
 * it.
 *
 * The control's own three sentences and its press are pinned in
 * `../net/lan-forge-start.test.ts`; what is checked here is which cell they
 * hang under, on each of the two sources Forge can seat. The frame and its
 * fixtures are `./landing-shape.test.ts`'s.
 */
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { LabApp } from '../../src/dev/LabApp';
import { hashSource } from '../../src/app/router';
import { SET_INDEX_VERSION } from '../../src/lab/set-index';
import { LEGACY_CUBE_FORMAT } from '../../src/routes/legacy-cube/model';
import { CLIENT_PROTOCOL } from '../../src/net/snapshot';
import { OPPONENT_LAN_LABEL } from '../../src/routes/play/OpponentChoice';
import { LAN_FORGE_START_LABEL } from '../../src/routes/play/LanForgeStart';
import { PLAY_GENERATE_LABEL } from '../../src/routes/play/SealedChooser';

const PRINTED_FORMAT = 'akh-hou';

const cube: unknown = JSON.parse(
  readFileSync('packages/data/data/legacy-cube-2021-card-catalog-v1.json', 'utf8'),
);
const printed = (file: string): unknown =>
  JSON.parse(readFileSync(`packages/data/data/${PRINTED_FORMAT}/${file}`, 'utf8'));
const printedRow = {
  id: PRINTED_FORMAT,
  name: 'Amonkhet / Hour of Devastation',
  formatUrl: `formats/${PRINTED_FORMAT}/${PRINTED_FORMAT}-limited-format-v1.json`,
  catalogs: [
    { code: 'AKH', name: 'Amonkhet', role: 'product' },
    { code: 'HOU', name: 'Hour of Devastation', role: 'product' },
    { code: 'MP2', name: 'Amonkhet Invocations', role: 'supplement' },
  ].map((source) => ({
    ...source,
    url: `formats/${PRINTED_FORMAT}/${source.code.toLowerCase()}-printed-catalog-v1.json`,
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

/**
 * The lab, answering health with the formats its Forge advertises, and the
 * staged files the landing reads on the way to drawing the cell.
 */
function setup(hash: string, observed: readonly string[]): void {
  hashSource()!.location.hash = hash;
  vi.stubGlobal('fetch', (url: string) => {
    const body =
      url === '/api/health'
        ? { ok: true, protocol: CLIENT_PROTOCOL, deals: true, observed: { protocol: 1, formats: observed } }
        : url === 'cube.json'
          ? cube
          : url === 'formats/index.json'
            ? { schemaVersion: 2, formats: [printedRow] }
            : url.startsWith(`formats/${PRINTED_FORMAT}/`)
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

/** The attribute a node carries, without the DOM lib (`./opponent-choice.test.ts`). */
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

/** The network cell, once the landing has drawn it. */
function lanCell(): Promise<unknown> {
  return screen.findByRole('button', { name: OPPONENT_LAN_LABEL });
}

describe('a printed format’s landing', () => {
  it('opens the network cell onto the start control when Forge advertises the format', async () => {
    setup(`#/play/sealed?source=printed:${PRINTED_FORMAT}&vs=lan`, [PRINTED_FORMAT]);
    render(h(LabApp, props));

    const cell = await lanCell();
    expect(attr(cell, 'disabled')).toBeNull();
    expect(attr(cell, 'aria-pressed')).toBe('true');
    // The control is the open column's body, so the bot column's offer is not
    // drawn beside it; that is the whole point of moving the mount here.
    expect(await screen.findByRole('button', { name: LAN_FORGE_START_LABEL })).toBeTruthy();
    expect(screen.queryByRole('button', { name: PLAY_GENERATE_LABEL })).toBeNull();
  });

  it('darkens the cell with Forge’s own sentence when it serves other formats', async () => {
    setup(`#/play/sealed?source=printed:${PRINTED_FORMAT}&vs=lan`, ['scd']);
    const rendered = render(h(LabApp, props));

    const cell = await lanCell();
    expect(attr(cell, 'disabled')).not.toBeNull();
    expect(text(rendered.container)).toContain(
      `Forge on this lab does not serve ${PRINTED_FORMAT} over the network; it serves scd.`,
    );
    expect(screen.queryByRole('button', { name: LAN_FORGE_START_LABEL })).toBeNull();
  });
});

describe('the Legacy Cube’s landing', () => {
  it('opens the network cell onto the start control when Forge advertises the cube', async () => {
    setup(`#/play/draft?source=${LEGACY_CUBE_FORMAT}&vs=lan`, [LEGACY_CUBE_FORMAT]);
    render(h(LabApp, props));

    const cell = await lanCell();
    expect(attr(cell, 'disabled')).toBeNull();
    expect(attr(cell, 'aria-pressed')).toBe('true');
    expect(await screen.findByRole('button', { name: LAN_FORGE_START_LABEL })).toBeTruthy();
  });

  it('darkens the cell with Forge’s own sentence when it serves other formats', async () => {
    setup(`#/play/draft?source=${LEGACY_CUBE_FORMAT}&vs=lan`, [PRINTED_FORMAT]);
    const rendered = render(h(LabApp, props));

    const cell = await lanCell();
    expect(attr(cell, 'disabled')).not.toBeNull();
    expect(text(rendered.container)).toContain(
      `Forge on this lab does not serve ${LEGACY_CUBE_FORMAT} over the network; it serves ${PRINTED_FORMAT}.`,
    );
    expect(screen.queryByRole('button', { name: LAN_FORGE_START_LABEL })).toBeNull();
  });
});

/**
 * A seat at a Forge table over the network. `routeSeatsObserved`
 * (`../../src/dev/section-views.ts`) is what keeps its `obs-` token off the
 * kernel PlayRoute, which would answer it with a kernel table's client and a
 * 404 from the lab. The printed format's own page is the one that draws the
 * format's name as its heading; the kernel route never does.
 *
 * Only the printed source is pinned here: on the cube both branches reach the
 * same draft route, so no rendering tells them apart.
 */
describe('a seat at an observed table', () => {
  it('keeps a printed format’s Forge seat on the format’s own page', async () => {
    setup(`#/play/sealed?source=printed:${PRINTED_FORMAT}&vs=lan&table=obs-abc123`, [PRINTED_FORMAT]);
    const rendered = render(h(LabApp, props));

    expect(await screen.findByRole('heading', { name: printedRow.name })).toBeTruthy();
    expect(text(rendered.container)).not.toContain('Cannot reach the table');
  });
});
