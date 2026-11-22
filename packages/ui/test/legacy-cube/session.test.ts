// @vitest-environment jsdom
/**
 * Pressing Draft in the tab row must not be how a cube draft ends.
 *
 * `mtg-bc2.154.4.30`. The route hands every pick straight to the hash, so a
 * reload keeps the draft and the Draft tab's cube row said that was the whole
 * of it. A tab press is the case that argument missed: the
 * router navigates with `params: {}`, `cube`, `seed` and `picks` go together,
 * and the chooser it lands on offered one button that deals a new draft over the
 * one in progress.
 *
 * So these hold the resume itself. What one pick writes is what the chooser
 * offers back; a catalog that moved underneath refuses instead of resuming onto
 * cards nobody drafted; an empty store draws no control at all; and New forgets
 * what it is replacing.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h, useState } from 'react';
import type { ObservedBackend } from '@mtg/engine';
import type { LimitedDeck } from '@mtg/limited';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { serializedPrintedCardCatalogContent } from '@mtg/printed-card';
import { LegacyCubeRoute } from '../../src/routes/legacy-cube/LegacyCubeRoute';
import { DRAFT_NEW_LABEL, DRAFT_RESUME_LABEL, DRAFT_RESUME_STALE } from '../../src/routes/draft/DraftChooser';
import { draftCubeResumeNote } from '../../src/routes/legacy-cube/resume-offer';
import {
  encodeLegacyCubePicks,
  buildLegacyCubeDeck,
  LEGACY_CUBE_HUMAN_SEAT,
  legacyCubeDraftPool,
  readLegacyCubeCatalog,
  readLegacyCubeForgeReadyPool,
  runLegacyCubeDraft,
} from '../../src/routes/legacy-cube/model';
import type { LegacyCubeDraftPool, LegacyCubeForgeReadyPool } from '../../src/routes/legacy-cube/model';
import { stageLegacyCubeForgeReadyPool } from '../../tools/stage-legacy-cube';
import { writeCompleteLegacyCubeLedgerFixture } from './complete-ledger-fixture';
import {
  LEGACY_CUBE_MATCH_KEY,
  LEGACY_CUBE_SESSION_KEY,
  readLegacyCubeMatchSeed,
  readLegacyCubeSession,
  restoreLegacyCubeDeck,
  restoreCompletedLegacyCubePool,
  resumeLegacyCube,
  writeLegacyCubeMatchSeed,
  writeLegacyCubeSession,
} from '../../src/routes/legacy-cube/session';
import { sha256Text } from '../../src/routes/analysis/calibration-read';

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

const SEED = 'legacy-ui/session';

/**
 * The store, reached the way `../../src/routes/deck/local-store.ts` reaches it.
 *
 * The UI workspace has no `lib: dom` (`../../src/mount.ts` records why), so
 * `window` is not a name here and the store is a structural interface over
 * `globalThis` -- jsdom supplies the object either way.
 */
const store = (
  globalThis as {
    readonly localStorage: {
      getItem(key: string): string | null;
      setItem(key: string, value: string): void;
      clear(): void;
    };
  }
).localStorage;

/**
 * A backend that refuses, because nothing here reaches one.
 *
 * These cases stop at the first pick; the route only opens a table from the deck
 * editor, which is 45 picks away. `./route.test.ts` is where the refusal itself
 * is read.
 */
const backend: ObservedBackend = {
  id: 'forge-2.0.14',
  determinism: 'observed',
  capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
  supports: () => Promise.resolve(['no table is opened here']),
  open: () =>
    Promise.resolve({
      ok: false,
      error: { kind: 'unsupported', capability: 'printed-card coverage', message: 'no table is opened here' },
    }),
};

let catalog: PrintedCardCatalog;
let forgeReady: LegacyCubeForgeReadyPool;

/**
 * The same 600 positions with one different card in them, checksum and all.
 *
 * The point of the guard is a catalog that was re-staged rather than corrupted,
 * so this one is internally valid -- `readLegacyCubeCatalog` accepts it -- and
 * differs from the staged catalog only in what position 1 names and therefore in
 * `contentSha256`.
 */
async function restaged(): Promise<PrintedCardCatalog> {
  const moved = structuredClone(catalog) as {
    contentSha256: string;
    cards: { correctedName: string }[];
  };
  const first = moved.cards[0];
  if (first === undefined) throw new Error('the staged catalog has no cards');
  first.correctedName = 'Another printing entirely';
  moved.contentSha256 = await sha256Text(
    serializedPrintedCardCatalogContent(moved as unknown as PrintedCardCatalog),
  );
  return readLegacyCubeCatalog(moved);
}

beforeAll(async () => {
  catalog = await readLegacyCubeCatalog(JSON.parse(readFileSync(CATALOG_FILE, 'utf8')) as unknown);
  const directory = mkdtempSync(join(tmpdir(), 'mtg-legacy-session-ready-'));
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
});

/** The route as the tab mounts it, recording what each press writes to the hash. */
function Journey(props: { readonly onParams: (next: Readonly<Record<string, string>>) => void }) {
  const [params, setParams] = useState<Readonly<Record<string, string>>>({ seed: SEED });
  return h(LegacyCubeRoute, {
    catalog: { status: 'ready', catalog },
    forgeReady: { status: 'ready', pool: forgeReady },
    params,
    backend,
    onSetParams: (next) => {
      props.onParams(next);
      setParams((current) => ({ ...current, ...next }));
    },
  });
}

/** One pick, taken the way a person takes it, and the link it wrote. */
function draftOnePick(): string {
  let written = '';
  render(h(Journey, { onParams: (next) => (written = next['picks'] ?? written) }));
  const pack = screen.getByRole('group', { name: 'Draft pack 1, pick 1' });
  const card = within(pack).getAllByRole('button')[0];
  if (card === undefined) throw new Error('the pack drew no card to draft');
  fireEvent.click(card);
  fireEvent.click(screen.getByRole('button', { name: /^Pick /u }));
  if (written === '') throw new Error('drafting a card wrote no transcript');
  cleanup();
  return written;
}

/**
 * The cube's chooser: its route with no seed in the hash, which is where a
 * typed `#/play/draft?source=legacy-cube-2021-08` or a Draft press lands
 * (`../../src/routes/legacy-cube/resume-offer.ts` is what it offers back).
 */
function chooser(state: PrintedCardCatalog, onSetParams: (next: Readonly<Record<string, string>>) => void) {
  return h(LegacyCubeRoute, {
    catalog: { status: 'ready', catalog: state },
    forgeReady: { status: 'ready', pool: forgeReady },
    params: {},
    backend,
    onSetParams,
  });
}

function completeDraft(pool: LegacyCubeDraftPool, seed: string): readonly string[] {
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

describe('the cube draft kept across a tab press', () => {
  it('keeps the last game seed only for the exact saved draft and deck journey', () => {
    const pool = legacyCubeDraftPool(catalog, 'forge-ready', forgeReady);
    const seed = `${SEED}/match-owner`;
    const picks = completeDraft(pool, seed);
    const encoded = encodeLegacyCubePicks(catalog, picks);
    const matchSeed = `${seed}/game/fresh-one`;

    expect(writeLegacyCubeMatchSeed(pool, seed, encoded, matchSeed)).toBe(true);
    expect(readLegacyCubeMatchSeed(pool, seed, encoded)).toBe(matchSeed);
    expect(readLegacyCubeMatchSeed(pool, `${seed}/other`, encoded)).toBeNull();
    expect(readLegacyCubeMatchSeed(pool, seed, `${encoded}.1`)).toBeNull();

    const stored = JSON.parse(store.getItem(LEGACY_CUBE_MATCH_KEY) ?? 'null') as Record<string, unknown>;
    store.setItem(LEGACY_CUBE_MATCH_KEY, JSON.stringify({ ...stored, pool: 'foreign-pool' }));
    expect(readLegacyCubeMatchSeed(pool, seed, encoded)).toBeNull();
  });

  it('restores the exact edited deck only for the completed draft that owns it', () => {
    const pool = legacyCubeDraftPool(catalog, 'forge-ready', forgeReady);
    const seed = `${SEED}/saved-deck`;
    const picks = completeDraft(pool, seed);
    const encoded = encodeLegacyCubePicks(catalog, picks);
    const result = runLegacyCubeDraft(pool, seed, picks).result;
    if (result === null) throw new Error('the completed draft has no result');
    const suggested = buildLegacyCubeDeck(result, LEGACY_CUBE_HUMAN_SEAT).deck;
    const outside = suggested.pool.find((card) => !suggested.selectedPhysicalIds.includes(card.physicalId));
    if (outside === undefined) throw new Error('the suggested deck has no sideboard card');
    const edited: LimitedDeck<PrintedCardCatalog['cards'][number]> = {
      ...suggested,
      selectedPhysicalIds: [...suggested.selectedPhysicalIds.slice(1), outside.physicalId],
      basics: { Plains: 1, Island: 2, Swamp: 3, Mountain: 4, Forest: 5 },
    };

    expect(writeLegacyCubeSession(pool, seed, encoded, edited)).toBe(true);
    const session = readLegacyCubeSession();
    if (session === null) throw new Error('the edited deck session was not stored');

    expect(restoreLegacyCubeDeck(session, pool, seed, encoded, suggested)).toMatchObject({
      selectedPhysicalIds: edited.selectedPhysicalIds,
      basics: edited.basics,
    });
    expect(restoreLegacyCubeDeck(session, pool, `${seed}/other`, encoded, suggested)).toBeNull();
  });

  it('refuses malformed or foreign saved deck allocations without losing the draft resume', () => {
    const pool = legacyCubeDraftPool(catalog, 'forge-ready', forgeReady);
    const seed = `${SEED}/bad-deck`;
    const picks = completeDraft(pool, seed);
    const encoded = encodeLegacyCubePicks(catalog, picks);
    const result = runLegacyCubeDraft(pool, seed, picks).result;
    if (result === null) throw new Error('the completed draft has no result');
    const suggested = buildLegacyCubeDeck(result, LEGACY_CUBE_HUMAN_SEAT).deck;
    writeLegacyCubeSession(pool, seed, encoded, suggested);
    const stored = JSON.parse(store.getItem(LEGACY_CUBE_SESSION_KEY) ?? 'null') as Record<string, unknown>;
    const deck = stored['deck'] as Record<string, unknown>;
    store.setItem(
      LEGACY_CUBE_SESSION_KEY,
      JSON.stringify({ ...stored, deck: { ...deck, selectedPhysicalIds: ['not-in-this-draft'] } }),
    );

    const session = readLegacyCubeSession();
    if (session === null) throw new Error('a structurally valid session should remain resumable');
    expect(resumeLegacyCube(session, pool)).toMatchObject({ ok: true, picksMade: 45 });
    expect(restoreLegacyCubeDeck(session, pool, seed, encoded, suggested)).toBeNull();
  });

  it('offers back the draft one pick wrote, at the seed and transcript it wrote', () => {
    const picks = draftOnePick();

    let resumed: Readonly<Record<string, string>> | null = null;
    render(chooser(catalog, (next) => (resumed = next)));
    expect(screen.getByText(draftCubeResumeNote(1))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: DRAFT_RESUME_LABEL }));

    // No `cube` key: the route is already the cube's, and the source stays
    // whatever the hash said it was.
    expect(resumed).toEqual({ pool: 'forge-ready', seed: SEED, picks });
  });

  it('refuses a draft stored against a catalog that has moved, rather than resuming onto it', async () => {
    draftOnePick();
    const moved = await restaged();
    expect(moved.contentSha256).not.toBe(catalog.contentSha256);

    render(chooser(moved, () => undefined));
    expect(screen.getByText(DRAFT_RESUME_STALE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: DRAFT_RESUME_LABEL })).toBeNull();
    expect(screen.getByRole('button', { name: DRAFT_NEW_LABEL })).toBeTruthy();
  });

  it('draws no Continue and no refusal when there is no stored draft', () => {
    render(chooser(catalog, () => undefined));
    expect(screen.queryByRole('button', { name: DRAFT_RESUME_LABEL })).toBeNull();
    expect(screen.queryByText(DRAFT_RESUME_STALE)).toBeNull();
    expect(screen.getByText(/600 admitted singleton cards/u)).toBeTruthy();
  });

  it('forgets the stored draft when a new one is dealt over it', () => {
    draftOnePick();
    expect(readLegacyCubeSession()).not.toBeNull();

    render(chooser(catalog, () => undefined));
    fireEvent.click(screen.getByRole('button', { name: DRAFT_NEW_LABEL }));

    expect(readLegacyCubeSession()).toBeNull();
  });

  it('drops a session written at another version rather than offering it', () => {
    const picks = draftOnePick();
    writeLegacyCubeSession(catalog, SEED, picks);
    const stored: unknown = JSON.parse(store.getItem(LEGACY_CUBE_SESSION_KEY) ?? 'null');
    store.setItem(
      LEGACY_CUBE_SESSION_KEY,
      JSON.stringify({ ...(stored as Record<string, unknown>), version: 5 }),
    );

    render(chooser(catalog, () => undefined));
    expect(screen.queryByRole('button', { name: DRAFT_RESUME_LABEL })).toBeNull();
    expect(screen.queryByText(DRAFT_RESUME_STALE)).toBeNull();
  });

  it('binds a Forge-ready resume to its pool mode and admission fingerprint', () => {
    const pool = legacyCubeDraftPool(catalog, 'forge-ready', forgeReady);
    const first = pool.cards[0];
    if (first === undefined) throw new Error('Forge-ready pool has no card');
    const encoded = first.position.toString(36);
    writeLegacyCubeSession(pool, SEED, encoded);

    const session = readLegacyCubeSession();
    expect(session).toMatchObject({ mode: 'forge-ready', pool: forgeReady.contentSha256 });
    if (session === null) throw new Error('session was not stored');
    expect(resumeLegacyCube(session, pool)).toMatchObject({ ok: true, mode: 'forge-ready' });
    expect(resumeLegacyCube(session, legacyCubeDraftPool(catalog, 'full'))).toEqual({ ok: false });
  });

  it('restores a finished draft exactly when the accepted projection only grows', () => {
    const original = historicalForgeReadyPool();
    const picks = completeDraft(original, `${SEED}/finished`);
    const encoded = encodeLegacyCubePicks(catalog, picks);
    writeLegacyCubeSession(original, `${SEED}/finished`, encoded);

    const session = readLegacyCubeSession();
    if (session === null) throw new Error('the finished draft was not stored');
    const restored = restoreCompletedLegacyCubePool(
      session,
      legacyCubeDraftPool(catalog, 'forge-ready', forgeReady),
      `${SEED}/finished`,
      encoded,
    );

    expect(restored?.fingerprint).toBe(original.fingerprint);
    expect(restored?.draft).toEqual(original.draft);
    expect(restored?.cards.map((card) => card.physicalId)).toEqual(
      original.cards.map((card) => card.physicalId),
    );
    expect(runLegacyCubeDraft(restored!, `${SEED}/finished`, picks).result).not.toBeNull();
  });

  it('refuses projection-drift recovery until the draft is finished', () => {
    const original = historicalForgeReadyPool();
    const first = original.cards[0];
    if (first === undefined) throw new Error('the Forge-ready pool has no card');
    const encoded = encodeLegacyCubePicks(catalog, [first.physicalId]);
    writeLegacyCubeSession(original, `${SEED}/unfinished`, encoded);

    const session = readLegacyCubeSession();
    if (session === null) throw new Error('the unfinished draft was not stored');
    expect(
      restoreCompletedLegacyCubePool(
        session,
        legacyCubeDraftPool(catalog, 'forge-ready', forgeReady),
        `${SEED}/unfinished`,
        encoded,
      ),
    ).toBeNull();
  });

  it('refuses a finished snapshot if the current projection retracts any source position', () => {
    const original = legacyCubeDraftPool(catalog, 'forge-ready', forgeReady);
    const picks = completeDraft(original, `${SEED}/retracted`);
    const encoded = encodeLegacyCubePicks(catalog, picks);
    writeLegacyCubeSession(original, `${SEED}/retracted`, encoded);
    const session = readLegacyCubeSession();
    if (session === null) throw new Error('the finished draft was not stored');
    const retracted: LegacyCubeDraftPool = {
      ...original,
      cards: original.cards.slice(1),
      fingerprint: 'e'.repeat(64),
    };

    expect(restoreCompletedLegacyCubePool(session, retracted, `${SEED}/retracted`, encoded)).toBeNull();
  });

  it('refuses reordered or duplicate source positions in a completed snapshot', () => {
    const original = historicalForgeReadyPool();
    const seed = `${SEED}/tampered-source`;
    const picks = completeDraft(original, seed);
    const encoded = encodeLegacyCubePicks(catalog, picks);
    writeLegacyCubeSession(original, seed, encoded);
    const session = readLegacyCubeSession();
    if (session === null || session.version !== 4)
      throw new Error('the current finished draft was not stored');
    const expanded = legacyCubeDraftPool(catalog, 'forge-ready', forgeReady);
    const first = session.source.positions[0];
    if (first === undefined) throw new Error('the stored source has no positions');

    expect(
      restoreCompletedLegacyCubePool(
        {
          ...session,
          source: { ...session.source, positions: [...session.source.positions].reverse() },
        },
        expanded,
        seed,
        encoded,
      ),
    ).toBeNull();
    expect(
      restoreCompletedLegacyCubePool(
        {
          ...session,
          source: { ...session.source, positions: [first, ...session.source.positions] },
        },
        expanded,
        seed,
        encoded,
      ),
    ).toBeNull();
  });
});
