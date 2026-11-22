// @vitest-environment jsdom
/**
 * A deck under 40 cards is a state the editor is for, not a state it dies in.
 *
 * `mtg-bc2.154.4.30`, third requirement. The Legacy Cube build adapter computed the
 * session spec on every render, and `toDeckRef` refuses a short deck by
 * throwing — so the first `Cut` press left 39 cards, the throw came out of
 * render, React unmounted the tree, and the whole page went white with the 45
 * picks still in the hash and nothing on screen to say so. Cutting a card is
 * the one thing a deck editor exists to do.
 *
 * These tests hold the editor across that press: the table is built at the
 * press of Start rather than on every keystroke, the short deck says how short
 * it is, and adding the card back restores the match.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ObservedBackend } from '@mtg/engine';
import { scriptBackend } from '@mtg/engine';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { LegacyCubeRoute } from '../../src/routes/legacy-cube/LegacyCubeRoute';
import {
  LEGACY_CUBE_SHORT_DECK_LABEL,
  PLAY_FRESH_LEGACY_CUBE_GAME_LABEL,
} from '../../src/routes/legacy-cube/LegacyCubeRoute';
import { readLegacyCubeCatalog, readLegacyCubeForgeReadyPool } from '../../src/routes/legacy-cube/model';
import type { LegacyCubeForgeReadyPool } from '../../src/routes/legacy-cube/model';
import { stageLegacyCubeForgeReadyPool } from '../../tools/stage-legacy-cube';
import { writeCompleteLegacyCubeLedgerFixture } from './complete-ledger-fixture';
import { readLegacyCubeMatchSeed, readLegacyCubeSession } from '../../src/routes/legacy-cube/session';
import { MANA_BASE_LABEL } from '../../src/routes/deck/BasicsPanel';

/**
 * Budgeted at 20s rather than left to vitest's 5s default. Measured with this
 * file alone, MTG_TEST_WORKERS=1, three runs at host load 9.3 to 10.2 on 16
 * cores: the slowest test (fresh match seeds from one saved deck) took 3.9 to
 * 4.3s and the rest 2.1 to 2.7s, so 20s is about 4.6x the worst run.
 *
 * The default was too tight under load: this file is on the recorded red list
 * of base d9b2115b, so the default decided which lane went red.
 *
 * File-scoped on purpose: the global `testTimeout` stays at the default and
 * nothing retries (`mtg-tqwbq`).
 */
vi.setConfig({ testTimeout: 20_000 });

const CATALOG_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'data',
  'data',
  'legacy-cube-2021-card-catalog-v1.json',
);
const LEDGER_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'data',
  'data',
  'legacy-cube-2021-forge-decisions-v1.json',
);

let catalog: PrintedCardCatalog;
let forgeReady: LegacyCubeForgeReadyPool;

interface ElementLike {
  readonly textContent: string | null;
  readonly getAttribute: (name: string) => string | null;
}

interface QueryElement {
  readonly querySelector: (selector: string) => QueryElement | null;
}

beforeAll(async () => {
  catalog = await readLegacyCubeCatalog(JSON.parse(readFileSync(CATALOG_FILE, 'utf8')) as unknown);
  const directory = mkdtempSync(join(tmpdir(), 'mtg-legacy-deck-edit-ready-'));
  const target = join(directory, 'ready.json');
  const ledger = writeCompleteLegacyCubeLedgerFixture(LEDGER_FILE, join(directory, 'ledger.json'));
  await stageLegacyCubeForgeReadyPool(CATALOG_FILE, ledger, target);
  forgeReady = await readLegacyCubeForgeReadyPool(
    JSON.parse(readFileSync(target, 'utf8')) as unknown,
    catalog,
  );
});

const store = (
  globalThis as {
    readonly localStorage: { clear(): void };
  }
).localStorage;

afterEach(() => {
  cleanup();
  store.clear();
  vi.restoreAllMocks();
});

const refusal = 'printed card "Black Lotus" is outside the audited Forge decision-family slice';

const backend: ObservedBackend = {
  id: 'forge-2.0.14',
  determinism: 'observed',
  capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
  supports: () => Promise.resolve([refusal]),
  open: () =>
    Promise.resolve({
      ok: false,
      error: { kind: 'unsupported', capability: 'printed-card coverage', message: refusal },
    }),
};

function Journey(props: { readonly gameBackend?: ObservedBackend }): ReturnType<typeof LegacyCubeRoute> {
  const [params, setParams] = useState<Readonly<Record<string, string>>>({
    seed: 'legacy-ui/route-complete',
  });
  return h(LegacyCubeRoute, {
    catalog: { status: 'ready', catalog },
    forgeReady: { status: 'ready', pool: forgeReady },
    params,
    backend: props.gameBackend ?? backend,
    onSetParams: (next) => setParams((current) => ({ ...current, ...next })),
  });
}

/** Take the first card of every pack until the draft is done. */
function draftToTheEnd(): void {
  for (let guard = 0; guard < 60; guard += 1) {
    const pack = screen.queryByRole('group', { name: /Draft pack/ });
    if (pack === null) return;
    fireEvent.click(within(pack).getAllByRole('button')[0]!);
    fireEvent.click(screen.getByRole('button', { name: /^Pick / }));
  }
  throw new Error('45 picks did not finish this draft');
}

function status(): string {
  return (
    (
      screen.getByText(/cards/u, {
        // `mtg-84703`. The bar carried a `.mtg-builder__counts` span saying the
        // same thing the deck pane's note said a pane away, and the note is the
        // one that stayed: "the '40 of 40 cards · 14 creatures ...' doesnt need
        // to be at the top it's fine to include next ot the Your deck portion
        // only".
        selector: '[data-pane="deck"] .mtg-deck__pane-note',
      }) as unknown as ElementLike
    ).textContent ?? ''
  );
}

describe('editing a drafted Legacy Cube deck', () => {
  it('starts fresh match seeds from one saved deck and keeps the last one available for exact replay', async () => {
    let byte = 1;
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(((array: Uint8Array) => {
      array.fill(byte);
      byte += 1;
      return array;
    }) as typeof globalThis.crypto.getRandomValues);
    const opened: Array<Parameters<ObservedBackend['open']>[0]> = [];
    const recordingBackend: ObservedBackend = {
      ...backend,
      supports: () => Promise.resolve([]),
      open: (table) => {
        opened.push(table);
        return Promise.resolve({
          ok: false,
          error: { kind: 'backend-failure', message: 'match captured' },
        });
      },
    };
    render(h(Journey, { gameBackend: recordingBackend }));
    draftToTheEnd();
    const saved = readLegacyCubeSession();
    if (saved === null) throw new Error('the completed draft was not stored');

    fireEvent.click(screen.getByRole('button', { name: 'Play a new game' }));
    await waitFor(() => expect(opened).toHaveLength(1));
    // Seeing `open` is not seeing the route settle: the rejected session still
    // has to report its failure and hand control back to the saved-deck builder.
    // Wait on the control a person can actually press, rather than racing that
    // transition against the backend promise's bookkeeping.
    fireEvent.click(await screen.findByRole('button', { name: 'Play a new game' }));
    await waitFor(() => expect(opened).toHaveLength(2));

    const first = opened[0];
    const second = opened[1];
    if (first === undefined || second === undefined) throw new Error('two games were not captured');
    expect(first.seed).not.toBe(second.seed);
    expect(first.seats).toEqual(second.seats);
    const pool = {
      mode: saved.mode,
      catalog,
      cards: forgeReady.positions.map((position) => catalog.cards[position - 1]!),
      fingerprint: saved.pool,
      draft: forgeReady.draft,
    } as const;
    expect(readLegacyCubeMatchSeed(pool, saved.seed, saved.picks)).toBe(second.seed);

    fireEvent.click(await screen.findByRole('button', { name: 'Replay last game' }));
    await waitFor(() => expect(opened).toHaveLength(3));
    expect(opened[2]?.seed).toBe(second.seed);
    expect(readLegacyCubeSession()).toEqual(saved);
  });

  it('restores the exact card allocation and basic-land counts after a remount', () => {
    render(h(Journey));
    draftToTheEnd();

    const pool = screen.getByRole('group', { name: 'Drafted pool' });
    fireEvent.click(within(pool).getAllByRole('button')[0]!);
    const mana = screen.getByRole('group', { name: MANA_BASE_LABEL });
    const cut = within(mana)
      .getAllByRole('button', { name: /^Cut an? /u })
      .find((button) => !(button as unknown as { disabled: boolean }).disabled);
    if (cut === undefined) throw new Error('the suggested deck has no basic land to cut');
    fireEvent.click(cut);
    const exactStatus = status();
    const exactMana = (mana as unknown as ElementLike).textContent;
    const session = readLegacyCubeSession();
    if (session === null) throw new Error('the completed draft was not stored');

    cleanup();
    render(
      h(LegacyCubeRoute, {
        catalog: { status: 'ready', catalog },
        forgeReady: { status: 'ready', pool: forgeReady },
        params: { pool: session.mode, seed: session.seed, picks: session.picks },
        backend,
        onSetParams: () => undefined,
      }),
    );

    expect(status()).toBe(exactStatus);
    expect((screen.getByRole('group', { name: MANA_BASE_LABEL }) as unknown as ElementLike).textContent).toBe(
      exactMana,
    );
  });

  it('survives cutting a card, and says how short the deck is', () => {
    render(h(Journey));
    draftToTheEnd();
    expect(status()).toContain('40 of 40 cards');

    const deck = screen.getByRole('group', { name: 'Cards in your deck' });
    fireEvent.doubleClick(within(deck).getAllByRole('button')[0]!);

    // The editor is still on screen. Before this fix the throw came out of
    // render and there was nothing here to assert against at all.
    expect(screen.getByRole('group', { name: 'Cards in your deck' })).toBeTruthy();
    expect(status()).toContain('39 of 40 cards');
    expect(screen.getByText(LEGACY_CUBE_SHORT_DECK_LABEL(1))).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: PLAY_FRESH_LEGACY_CUBE_GAME_LABEL,
        }) as unknown as ElementLike
      ).getAttribute('disabled'),
    ).not.toBeNull();
  });

  it('takes the card back and opens the match on the deck as it stands at the press', async () => {
    render(h(Journey));
    draftToTheEnd();

    const deck = screen.getByRole('group', { name: 'Cards in your deck' });
    fireEvent.doubleClick(within(deck).getAllByRole('button')[0]!);
    const sideboard = screen.getByRole('group', { name: 'Drafted pool' });
    const returned = within(sideboard).getAllByRole('button')[0]!;
    fireEvent.doubleClick(returned);
    expect(status()).toContain('39 of 40 cards');
    fireEvent.click(returned);
    expect(status()).toContain('40 of 40 cards');
    expect(screen.queryByText(LEGACY_CUBE_SHORT_DECK_LABEL(1))).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: PLAY_FRESH_LEGACY_CUBE_GAME_LABEL }));
    await waitFor(() => {
      expect((screen.getByRole('alert') as unknown as ElementLike).textContent).toContain(refusal);
    });

    // An opening refusal returns to the editor with the reason intact. The
    // next cut edits a future match; no second game table remains under it.
    const restoredDeck = await screen.findByRole('group', { name: 'Cards in your deck' });
    fireEvent.doubleClick(within(restoredDeck).getAllByRole('button')[0]!);
    expect(screen.queryByRole('region', { name: 'Forge match' })).toBeNull();
    expect(status()).toContain('39 of 40 cards');
  });

  it('opens a pinned preview explicitly without changing the one-click pool move', () => {
    const view = render(h(Journey));
    draftToTheEnd();
    const body = (
      globalThis as unknown as {
        readonly document: { readonly body: Parameters<typeof fireEvent.pointerDown>[0] };
      }
    ).document.body;
    const preview = (): QueryElement | null =>
      (view.container as unknown as QueryElement).querySelector('.mtg-cardpeek');
    const deck = screen.getByRole('group', { name: 'Cards in your deck' });
    const deckCard = within(deck).getAllByRole('button')[0]!;

    fireEvent.mouseEnter(deckCard);
    expect(preview()).toBeNull();
    fireEvent.mouseLeave(deckCard);
    expect(preview()).toBeNull();

    fireEvent.focus(deckCard);
    expect(preview()).toBeNull();
    fireEvent.blur(deckCard);
    expect(preview()).toBeNull();

    fireEvent.contextMenu(deckCard);
    expect(preview()?.querySelector('[data-presentation="printed-card"]')).not.toBeNull();
    expect(status()).toContain('40 of 40 cards');
    fireEvent.pointerDown(body);
    expect(preview()).toBeNull();
    fireEvent.keyDown(deckCard, { key: 'ContextMenu' });
    expect(preview()?.querySelector('[data-presentation="printed-card"]')).not.toBeNull();
    fireEvent.pointerDown(deckCard);
    expect(preview()).toBeNull();

    fireEvent.click(deckCard);
    expect(status()).toContain('40 of 40 cards');
    expect(preview()).toBeNull();
    fireEvent.doubleClick(deckCard);
    expect(status()).toContain('39 of 40 cards');

    const pool = screen.getByRole('group', { name: 'Drafted pool' });
    const poolCard = within(pool).getAllByRole('button')[0]!;
    fireEvent.mouseEnter(poolCard);
    expect(preview()).toBeNull();
    fireEvent.contextMenu(poolCard);
    expect(preview()?.querySelector('[data-presentation="printed-card"]')).not.toBeNull();
    expect(status()).toContain('39 of 40 cards');
    fireEvent.pointerDown(body);
    expect(preview()).toBeNull();
    fireEvent.click(poolCard);
    expect(status()).toContain('40 of 40 cards');
    expect(preview()).toBeNull();
  });

  it('gives an opened match the shared board and returns to the same editor on close', async () => {
    render(h(Journey, { gameBackend: scriptBackend() }));
    draftToTheEnd();

    fireEvent.click(screen.getByRole('button', { name: PLAY_FRESH_LEGACY_CUBE_GAME_LABEL }));
    const match = await screen.findByRole('region', { name: 'Game table' });
    expect(screen.queryByRole('region', { name: 'Forge match' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Game context' })).toBeTruthy();
    expect(
      (match as unknown as { querySelector(selector: string): unknown }).querySelector('.mtg-board'),
    ).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Your Legacy Cube deck' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back to draft deckbuilding' }));
    expect(await screen.findByRole('group', { name: 'Cards in your deck' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Forge match' })).toBeNull();
  });
});
