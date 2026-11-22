// @vitest-environment jsdom
/** The visible official-cube journey stays printed-card-native through the Forge boundary. */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ObservedBackend } from '@mtg/engine';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { hashSource } from '../../src/app/router';
import { LabApp } from '../../src/dev/LabApp';
import { LegacyCubeRoute } from '../../src/routes/legacy-cube/LegacyCubeRoute';
import { DRAFT_NEW_LABEL } from '../../src/routes/draft/DraftChooser';
import type { AdvisorCalibrationState } from '../../src/routes/legacy-cube/calibration';
import { DEFAULT_ADVISOR_WEIGHTS } from '@mtg/draft-export';
import {
  encodeLegacyCubePicks,
  legacyCubeDraftPool,
  readLegacyCubeCatalog,
  readLegacyCubeForgeReadyPool,
  runLegacyCubeDraft,
} from '../../src/routes/legacy-cube/model';
import type { LegacyCubeDraftPool, LegacyCubeForgeReadyPool } from '../../src/routes/legacy-cube/model';
import {
  LEGACY_CUBE_SESSION_KEY,
  LEGACY_CUBE_SESSION_VERSION,
  writeLegacyCubeSession,
} from '../../src/routes/legacy-cube/session';
import { stageLegacyCubeForgeReadyPool } from '../../tools/stage-legacy-cube';
import { writeCompleteLegacyCubeLedgerFixture } from './complete-ledger-fixture';

/**
 * Budgeted at 20s rather than left to vitest's 5s default. Measured with this
 * file alone, MTG_TEST_WORKERS=1, three runs at host load 10.3 to 11.0 on 16
 * cores: the two slowest tests (the boundary handoff and the 45-pick replay)
 * took 3.0 to 4.3s, so 20s is about 4.6x the worst run.
 *
 * The default was too tight under load: those tests took 5.0 to 6.1s at load
 * 20 to 29, so the default decided which lane went red.
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

const store = (
  globalThis as {
    readonly localStorage: {
      getItem(key: string): string | null;
      setItem(key: string, value: string): void;
      clear(): void;
    };
  }
).localStorage;

interface ElementLike {
  readonly textContent: string | null;
  readonly getAttribute: (name: string) => string | null;
  readonly querySelector: (selector: string) => unknown;
  readonly querySelectorAll: (selector: string) => readonly ElementLike[];
}

interface JsonReply {
  readonly ok: boolean;
  readonly headers: { readonly get: (name: string) => string | null };
  readonly json: () => Promise<unknown>;
}

function builderCounts(): string {
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

beforeAll(async () => {
  catalog = await readLegacyCubeCatalog(JSON.parse(readFileSync(CATALOG_FILE, 'utf8')) as unknown);
  const directory = mkdtempSync(join(tmpdir(), 'mtg-legacy-route-ready-'));
  const target = join(directory, 'ready.json');
  const ledger = writeCompleteLegacyCubeLedgerFixture(LEDGER_FILE, join(directory, 'ledger.json'));
  await stageLegacyCubeForgeReadyPool(CATALOG_FILE, ledger, target);
  forgeReady = await readLegacyCubeForgeReadyPool(
    JSON.parse(readFileSync(target, 'utf8')) as unknown,
    catalog,
  );
});

afterEach(() => {
  cleanup();
  store.clear();
  vi.unstubAllGlobals();
});

const refusal = 'printed card "Black Lotus" is outside the audited Forge decision-family slice';

function currentPack(): HTMLElement | null {
  return screen.queryByRole('group', { name: /Draft pack \d+, pick \d+/u });
}

/** Select, then commit, using the ordinary draft surface's two-step gesture. */
function pickFirst(): boolean {
  const pack = currentPack();
  if (pack === null) return false;
  fireEvent.click(within(pack).getAllByRole('button')[0]!);
  fireEvent.click(screen.getByRole('button', { name: /^Pick /u }));
  return true;
}

function draftToTheEnd(): void {
  for (let guard = 0; guard < 60; guard += 1) {
    if (!pickFirst()) return;
  }
  throw new Error('45 picks did not finish this draft');
}

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

function Journey(props: {
  readonly calibration?: AdvisorCalibrationState;
  readonly initial?: Readonly<Record<string, string>>;
  readonly backend?: ObservedBackend;
  readonly forgeReadyPool?: LegacyCubeForgeReadyPool;
}): ReturnType<typeof LegacyCubeRoute> {
  const [params, setParams] = useState(props.initial ?? { seed: 'legacy-ui/route' });
  return h(LegacyCubeRoute, {
    ...(props.calibration === undefined ? {} : { calibration: props.calibration }),
    catalog: { status: 'ready', catalog },
    forgeReady: { status: 'ready', pool: props.forgeReadyPool ?? forgeReady },
    params,
    backend: props.backend ?? backend,
    onSetParams: (next) => setParams((current) => ({ ...current, ...next })),
  });
}

it('applies a checked local revision to real pack advice and shows failures without blocking picks', () => {
  const snapshot = {
    version: 'legacy-cube-advisor-calibration/v1' as const,
    identity: { catalogSha256: catalog.contentSha256, modelSha256: 'a'.repeat(64) },
    weights: { ...DEFAULT_ADVISOR_WEIGHTS, revision: 'ui-trial/v1', synergy: 1.25 },
    provenance: {
      status: 'provisional' as const,
      transitionSha256: 'b'.repeat(64),
      decisionSha256: 'c'.repeat(64),
      runtimeSha256: 'd'.repeat(64),
      independentHumanValidation: false as const,
      botValidated: false as const,
    },
    sha256: 'e'.repeat(64),
  };
  const view = render(h(Journey, { calibration: { status: 'ready', snapshot } }));
  expect(screen.getByText(/ui-trial\/v1/)).toBeTruthy();
  expect(screen.getByText(/Provisional local calibration/)).toBeTruthy();
  expect(pickFirst()).toBe(true);
  expect(screen.getByText(/ui-trial\/v1/)).toBeTruthy();
  view.rerender(h(Journey, { calibration: { status: 'failed', message: 'checksum mismatch' } }));
  expect(screen.getByText(/checksum mismatch/)).toBeTruthy();
  expect(screen.getByText(/legacy-cube-authored\/v1/)).toBeTruthy();
  expect(pickFirst()).toBe(true);
});

function completePicks(pool: LegacyCubeDraftPool, seed: string): readonly string[] {
  const picks: string[] = [];
  for (let guard = 0; guard < 60; guard += 1) {
    const draft = runLegacyCubeDraft(pool, seed, picks);
    if (draft.result !== null) return picks;
    const card = draft.owed[0]?.cards[0];
    if (card === undefined) throw new Error('an unfinished draft offered no card');
    picks.push(card.physicalId);
  }
  throw new Error('the draft did not finish in 45 picks');
}

function historicalForgeReadyPool(): LegacyCubeDraftPool {
  return {
    mode: 'forge-ready',
    catalog,
    cards: catalog.cards.slice(0, 321),
    fingerprint: 'e'.repeat(64),
    draft: { seats: 6, rounds: 3, packSize: 15 },
  };
}

describe('Legacy Cube route', () => {
  it('pins a learning path across picks and explains focused pack cards', () => {
    render(h(Journey));
    expect(screen.getByRole('region', { name: 'Draft recommendations' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Paths' }));
    fireEvent.change(screen.getByLabelText('Explore an archetype'), { target: { value: 'reanimator' } });
    expect(screen.getByRole('button', { name: 'Unpin path' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Card' }));
    const card = within(currentPack()!).getAllByRole('button')[0]!;
    fireEvent.focus(card);
    expect(screen.getByRole('heading', { name: 'Effect on paths' })).toBeTruthy();
    expect(pickFirst()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Paths' }));
    expect(
      (screen.getByLabelText('Explore an archetype') as unknown as { readonly value: string }).value,
    ).toBe('reanimator');
    expect(screen.getByText(/Reanimator.*Pinned/u)).toBeTruthy();
  });
  it('draws real printed faces, physical copy identity, and an explicit missing-art state', () => {
    render(h(Journey));

    expect(screen.getByRole('heading', { name: 'Draft' })).toBeTruthy();
    expect(screen.getByText('Pack 1 · Pick 1')).toBeTruthy();
    const pack = screen.getByRole('group', { name: 'Draft pack 1, pick 1' });
    expect(within(pack).getAllByRole('button')).toHaveLength(15);
    expect(
      (pack as unknown as ElementLike).querySelectorAll('[data-presentation="printed-card"]').length,
    ).toBe(15);
    expect((pack as unknown as ElementLike).querySelectorAll('[data-physical-id]').length).toBe(15);
    expect((pack as unknown as ElementLike).querySelectorAll('img, [data-art="missing"]').length).toBe(15);
    expect((pack as unknown as ElementLike).querySelectorAll('[data-region="title"]')).toHaveLength(15);
    expect((pack as unknown as ElementLike).querySelectorAll('[data-region="art"]')).toHaveLength(15);
    expect((pack as unknown as ElementLike).querySelectorAll('[data-region="rules"]')).toHaveLength(15);
    expect((pack as unknown as ElementLike).querySelectorAll('.mtg-printed-card-image')).toHaveLength(0);
    expect((pack as unknown as ElementLike).querySelectorAll('.mtg-legacy-card')).toHaveLength(0);
  });

  it('starts from one press rather than dealing a pack, and offers no second chooser', () => {
    // No suite rendered this branch: `Journey` seeds itself and the three
    // `params: {}` rerenders below all carry a catalog that is not ready, so
    // the ready-with-no-seed screen -- what a typed or bookmarked
    // `#/play/draft?source=legacy-cube-2021-08` link lands on -- was drawn by
    // nothing. The source was chosen before this route was mounted, by the
    // chips above the landing (`../../src/routes/play/SourceChoice.ts`), so
    // with no draft stored in this browser there is one button, which deals
    // (`./session.test.ts` is where a stored one is offered back).
    render(h(Journey, { initial: {} }));

    expect(currentPack()).toBeNull();
    expect(screen.getByText(/600 admitted singleton cards/u)).toBeTruthy();

    const start = screen.getByRole('button', { name: DRAFT_NEW_LABEL });
    expect((start as unknown as ElementLike).getAttribute('data-variant')).toBe('primary');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(start);

    expect(screen.getByText('Pack 1 · Pick 1')).toBeTruthy();
    expect(
      within(screen.getByRole('group', { name: 'Draft pack 1, pick 1' })).getAllByRole('button'),
    ).toHaveLength(15);
  });

  it('deals all 600 ledger-accepted positions in the eight-seat Forge-ready mode', () => {
    render(h(Journey, { initial: { seed: 'legacy-ui/forge-ready', pool: 'forge-ready' } }));

    const accepted = new Set(forgeReady.positions);
    const pack = screen.getByRole('group', { name: 'Draft pack 1, pick 1' });
    const positions = Array.from(
      (pack as unknown as ElementLike).querySelectorAll('[data-physical-id]'),
      (card) => Number(card.getAttribute('data-physical-id')?.split(':')[1]),
    );
    expect(positions).toHaveLength(15);
    expect(positions.every((position) => accepted.has(position))).toBe(true);
  });

  it('opens the exact finished deck after the accepted projection grows', () => {
    const seed = 'legacy-ui/forge-ready-saved';
    const original = historicalForgeReadyPool();
    const picks = completePicks(original, seed);
    const encoded = encodeLegacyCubePicks(catalog, picks);
    writeLegacyCubeSession(original, seed, encoded);

    render(
      h(Journey, {
        initial: { seed, picks: encoded, pool: 'forge-ready' },
      }),
    );

    expect(screen.getByText('Draft finished from 45 recorded picks.')).toBeTruthy();
    const deck = screen.getByRole('group', { name: 'Cards in your deck' }) as unknown as ElementLike;
    const pool = screen.getByRole('group', { name: 'Drafted pool' }) as unknown as ElementLike;
    // A finished Cube draft opens on the same complete, current card face used
    // while drafting and inspecting cards. Compact remains an available view,
    // but it is not a second, older-looking default frame.
    expect(deck.querySelectorAll('[data-size="full"]').length).toBeGreaterThan(0);
    expect(pool.querySelectorAll('[data-size="full"]').length).toBeGreaterThan(0);
    expect(deck.querySelectorAll('[data-size="compact"]')).toHaveLength(0);
    expect(pool.querySelectorAll('[data-size="compact"]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Play a new game' })).toBeTruthy();
  });

  it('upgrades an older finished browser session while its original projection is still staged', async () => {
    const seed = 'legacy-ui/forge-ready-v2';
    const original = legacyCubeDraftPool(catalog, 'forge-ready', forgeReady);
    const picks = completePicks(original, seed);
    const encoded = encodeLegacyCubePicks(catalog, picks);
    writeLegacyCubeSession(original, seed, encoded);
    const stored = JSON.parse(store.getItem(LEGACY_CUBE_SESSION_KEY) ?? 'null') as Record<string, unknown>;
    const { source: _source, ...oldSession } = stored;
    store.setItem(LEGACY_CUBE_SESSION_KEY, JSON.stringify({ ...oldSession, version: 2 }));

    render(h(Journey, { initial: { seed, picks: encoded, pool: 'forge-ready' } }));
    expect(screen.getByRole('group', { name: 'Cards in your deck' })).toBeTruthy();

    await waitFor(() => {
      const upgraded = JSON.parse(store.getItem(LEGACY_CUBE_SESSION_KEY) ?? 'null') as {
        readonly version?: number;
        readonly source?: { readonly positions?: readonly number[] };
      };
      expect(upgraded.version).toBe(LEGACY_CUBE_SESSION_VERSION);
      expect(upgraded.source?.positions).toHaveLength(forgeReady.cards);
    });
  });

  it('carries only accepted drafted names and basic lands to the backend boundary', async () => {
    const opened: Array<Parameters<ObservedBackend['open']>[0]> = [];
    const recordingBackend: ObservedBackend = {
      ...backend,
      supports: () => Promise.resolve([]),
      open: (table) => {
        opened.push(table);
        return Promise.resolve({
          ok: false,
          error: { kind: 'backend-failure', message: 'capture complete' },
        });
      },
    };
    render(
      h(Journey, {
        initial: { seed: 'legacy-ui/forge-ready-complete', pool: 'forge-ready' },
        backend: recordingBackend,
      }),
    );
    draftToTheEnd();
    fireEvent.click(screen.getByRole('button', { name: 'Play a new game' }));
    await waitFor(() => expect(opened).toHaveLength(1));

    const allowed = new Set(
      forgeReady.positions.map((position) => catalog.cards[position - 1]?.correctedName).filter(Boolean),
    );
    const table = opened[0];
    if (table === undefined) throw new Error('the backend did not receive a session');
    for (const seat of table.seats) {
      for (const slot of seat.deck.cards) {
        expect(
          allowed.has(slot.name) || ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].includes(slot.name),
        ).toBe(true);
      }
    }
  });

  it('uses the ordinary select-then-pick grammar and the ordinary live pool', () => {
    render(h(Journey, { initial: { seed: 'legacy-ui/transcript' } }));

    const pack = screen.getByRole('group', { name: 'Draft pack 1, pick 1' });
    const first = within(pack).getAllByRole('button')[0]!;
    const firstName =
      ((first as unknown as ElementLike).querySelector('.mtg-card__name') as ElementLike | null)
        ?.textContent ?? null;
    if (firstName === null) throw new Error('the first printed card has no accessible name');
    fireEvent.click(first);

    // Selection only reads the card. The explicit primary action owns the pick.
    expect(within(pack).getAllByRole('button')).toHaveLength(15);
    expect(screen.getByRole('button', { name: `Pick ${firstName}` })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: `Pick ${firstName}` }));

    expect(
      within(screen.getByRole('group', { name: 'Draft pack 1, pick 2' })).getAllByRole('button'),
    ).toHaveLength(14);
    const pool = screen.getByRole('group', { name: 'Pool' });
    expect(within(pool).getAllByRole('button')).toHaveLength(1);
    expect((pool as unknown as ElementLike).querySelectorAll('.mtg-legacy-card')).toHaveLength(0);
  });

  it('replays all 45 picks, edits a legal 40-card deck, and keeps it visible on exact refusal', async () => {
    render(h(Journey, { initial: { seed: 'legacy-ui/route-complete' } }));

    draftToTheEnd();

    expect(screen.getByText(/Draft finished from 45 recorded picks/u)).toBeTruthy();
    expect(builderCounts()).toContain('40 cards');
    const deckList = screen.getByRole('group', { name: 'Cards in your deck' });
    const sideboardList = screen.getByRole('group', { name: 'Drafted pool' });
    expect(deckList).toBeTruthy();
    expect(sideboardList).toBeTruthy();
    expect(within(deckList).getAllByRole('button').length).toBeGreaterThan(0);
    expect(within(sideboardList).getAllByRole('button').length).toBeGreaterThan(0);
    expect((deckList as unknown as ElementLike).querySelectorAll('.mtg-legacy-card__oracle')).toHaveLength(0);
    expect(
      (screen.getByRole('button', { name: 'Play a new game' }) as unknown as ElementLike).getAttribute(
        'data-variant',
      ),
    ).toBe('primary');

    const manaBase = screen.getByRole('group', { name: 'Mana base' });
    fireEvent.click(within(manaBase).getByRole('button', { name: 'Add a Forest' }));
    expect(builderCounts()).toContain('41 of 40 cards');
    fireEvent.click(within(manaBase).getByRole('button', { name: 'Cut a Forest' }));
    expect(builderCounts()).toContain('40 of 40 cards');

    fireEvent.click(screen.getByRole('button', { name: 'Play a new game' }));
    await waitFor(() => {
      expect((screen.getByRole('alert') as unknown as ElementLike).textContent).toContain(refusal);
    });
    expect(await screen.findByRole('group', { name: 'Cards in your deck' })).toBeTruthy();
    expect(screen.getByText(/Draft finished from 45 recorded picks/u)).toBeTruthy();
  });

  it('names malformed transcripts and every catalog load state', () => {
    const { rerender } = render(h(Journey, { initial: { seed: 'legacy-ui/bad', picks: 'zzzz' } }));
    expect(screen.getByText(/draft link is invalid/i)).toBeTruthy();
    expect(screen.getByText(/outside this catalog/i)).toBeTruthy();

    for (const [state, text] of [
      [{ status: 'loading' } as const, /Reading the official cube/i],
      [{ status: 'absent' } as const, /Official cube is not staged/i],
      [{ status: 'failed', message: 'checksum drift' } as const, /checksum drift/i],
    ] as const) {
      rerender(
        h(LegacyCubeRoute, {
          catalog: state,
          params: {},
          backend,
          onSetParams: vi.fn(),
        }),
      );
      expect(screen.getByText(text)).toBeTruthy();
    }
  });

  it('loads the portable catalog through LabApp without changing the generated-set draft path', async () => {
    const source = hashSource();
    if (source === null) throw new Error('this test needs a browser hash');
    source.location.hash = '#/draft?cube=legacy-cube-2021-08&seed=legacy-ui%2Flab';
    vi.stubGlobal('fetch', (url: string) =>
      url === 'legacy-cube.json'
        ? Promise.resolve({
            ok: true,
            headers: { get: () => 'application/json' },
            json: () => Promise.resolve(catalog),
          })
        : url === 'legacy-cube-ready.json'
          ? Promise.resolve({
              ok: true,
              headers: { get: () => 'application/json' },
              json: () => Promise.resolve(forgeReady),
            })
          : Promise.resolve({ ok: false, status: 404, headers: { get: () => 'application/json' } }),
    );

    render(
      h(LabApp, {
        cards: [],
        legacyCubeUrl: 'legacy-cube.json',
        legacyCubeForgeReadyUrl: 'legacy-cube-ready.json',
        legacyCubeBackend: backend,
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Draft' })).toBeTruthy();
      expect(screen.getByRole('group', { name: 'Draft pack 1, pick 1' })).toBeTruthy();
    });

    // Off the seed, the Draft section's landing. The cube is the only thing
    // this lab can draft -- no set is staged and no printed format is -- so it
    // is what the section resolves to with nothing in the hash naming a source
    // (`../../src/routes/play/sources.ts`).
    source.location.hash = '#/draft';
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'MTGO Legacy Cube' })).toBeTruthy();
      expect(screen.getByText(/600 admitted singleton cards/u)).toBeTruthy();
    });
    // And it is the landing every other draft has: the two cells above one
    // press, in the words every set uses (`../play/landing-shape.test.ts` is
    // the same check on the staged set and on a printed format).
    const opponents = screen.getByRole('group', { name: 'Play against' }) as unknown as {
      readonly textContent: string | null;
    };
    expect(opponents.textContent).toContain('Against a bot');
    expect(opponents.textContent).toContain('Over this network');
    expect(
      (
        screen.getByRole('button', { name: DRAFT_NEW_LABEL }) as unknown as {
          getAttribute(name: string): string | null;
        }
      ).getAttribute('data-variant'),
    ).toBe('primary');
    expect(screen.queryByRole('button', { name: 'New Legacy Cube draft' })).toBeNull();

    // And a link that does name it lands on the same landing, one press from a
    // pack (`mtg-a982g.5`).
    source.location.hash = '#/play/draft?cube=legacy-cube-2021-08';
    fireEvent.click(await screen.findByRole('button', { name: DRAFT_NEW_LABEL }));
    await waitFor(() => {
      expect(screen.getByRole('group', { name: 'Draft pack 1, pick 1' })).toBeTruthy();
    });
  });

  it('refreshes when the staged catalog URL changes and ignores the stale read', async () => {
    const source = hashSource();
    if (source === null) throw new Error('this test needs a browser hash');
    source.location.hash = '#/draft?cube=legacy-cube-2021-08&seed=legacy-ui%2Frefresh';
    let answerFirst!: (reply: JsonReply) => void;
    const first = new Promise<JsonReply>((resolve) => {
      answerFirst = resolve;
    });
    vi.stubGlobal('fetch', (url: string) =>
      url === 'first.json'
        ? first
        : url === 'ready.json'
          ? Promise.resolve({
              ok: true,
              headers: { get: () => 'application/json' },
              json: () => Promise.resolve(forgeReady),
            })
          : Promise.resolve({
              ok: true,
              headers: { get: () => 'application/json' },
              json: () => Promise.resolve(catalog),
            }),
    );

    const { rerender } = render(
      h(LabApp, {
        cards: [],
        legacyCubeUrl: 'first.json',
        legacyCubeForgeReadyUrl: 'ready.json',
        legacyCubeBackend: backend,
      }),
    );
    rerender(
      h(LabApp, {
        cards: [],
        legacyCubeUrl: 'second.json',
        legacyCubeForgeReadyUrl: 'ready.json',
        legacyCubeBackend: backend,
      }),
    );
    await waitFor(() => {
      expect(screen.getByRole('group', { name: 'Draft pack 1, pick 1' })).toBeTruthy();
    });
    answerFirst({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ stale: true }),
    });
    await Promise.resolve();
    expect(screen.getByRole('group', { name: 'Draft pack 1, pick 1' })).toBeTruthy();
  });
});
