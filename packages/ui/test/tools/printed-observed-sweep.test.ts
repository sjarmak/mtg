import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { ObservedBackend, ObservedSession, SessionSpec } from '@mtg/engine';
import { runPrintedObservedSweep } from '../../tools/printed-observed-sweep';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

async function inputs() {
  const root = await mkdtemp(join(tmpdir(), 'mtg-observed-sweep-test-'));
  roots.push(root);
  const read = async (name: string): Promise<unknown> =>
    JSON.parse(
      await readFile(new URL(`../../../data/data/akh-hou/${name}`, import.meta.url), 'utf8'),
    ) as unknown;
  return {
    format: await read('akh-hou-limited-format-v1.json'),
    catalogs: await Promise.all(['akh', 'hou', 'mp2'].map((code) => read(`${code}-printed-catalog-v1.json`))),
    mode: 'sealed' as const,
    seeds: [7, 11],
    outputDirectory: join(root, 'sweep'),
    timeoutMs: 10_000,
    maximumTurns: 8,
    decisionBudget: 12,
  };
}

function finishedAfterPass(table: SessionSpec): ObservedSession {
  const view = {
    version: 4 as const,
    turn: { number: 1, active: 0 as const, phase: 'Main', step: 'MAIN1' },
    priority: 0 as const,
    stack: [],
    seats: [
      {
        id: 0 as const,
        name: 'Local',
        life: 20,
        hand: [],
        handSize: 0,
        librarySize: 33,
        graveyard: [],
        exile: [],
        battlefield: [],
      },
      {
        id: 1 as const,
        name: 'Native',
        life: 20,
        hand: null,
        handSize: 7,
        librarySize: 33,
        graveyard: [],
        exile: [],
        battlefield: [],
      },
    ] as const,
  };
  const finished: ObservedSession = {
    backend: 'fixture-catalog-discovery',
    determinism: 'observed',
    table,
    status: 'finished',
    view,
    events: [],
    decision: null,
    play: { turnStep: 'precombatMain', passPriority: null, concede: null, objectActions: [] },
    seats: null,
    result: { winner: 1, reason: 'fixture', endedOnTurn: 1 },
    submitted: 1,
    localSeats: [0],
    transcript: [],
    submit: vi.fn(),
    close: vi.fn(async () => undefined),
  };
  return {
    ...finished,
    status: 'awaiting',
    decision: {
      seat: 0,
      kind: 'priority',
      prompt: 'Local has priority',
      options: [{ id: 'opaque-pass', text: 'Pass', targets: [] }],
      complete: true,
    },
    play: { turnStep: 'precombatMain', passPriority: 'opaque-pass', concede: null, objectActions: [] },
    result: null,
    submitted: 0,
    submit: vi.fn(async () => ({ ok: true as const, session: finished })),
  };
}

it('samples full Limited decks and runs every seed through one catalog-scoped backend', async () => {
  const options = await inputs();
  const open = vi.fn(async (table: SessionSpec) => ({
    ok: true as const,
    session: finishedAfterPass(table),
  }));
  const shutdown = vi.fn(async () => undefined);
  const backend: ObservedBackend = {
    id: 'fixture-catalog-discovery',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: vi.fn(async () => []),
    open,
    shutdown,
  };
  const dispose = vi.fn(async () => undefined);
  const inventory: string[][] = [];
  const result = await runPrintedObservedSweep(options, async (names) => {
    inventory.push([...names]);
    return { backend, dispose };
  });

  expect(result.qualification).toBe('unproven');
  expect(result.admission).toBe('unchanged');
  expect(result.policy).toBe('adapter-declared-enumerated-coverage-directed/v1');
  expect(result.sessions).toHaveLength(2);
  expect(result.sessions.every((session) => session.observed?.status === 'finished')).toBe(true);
  expect(result.summary).toEqual({ requested: 2, opened: 2, finished: 2, incomplete: 0 });
  expect(result.callbackCounts).toEqual({ priority: 2 });
  expect(result.coverage.catalogPrintings).toBe(550);
  expect(result.coverage.catalogNames).toBeGreaterThan(500);
  expect(result.coverage.uniquePoolPrintings).toBeGreaterThan(result.coverage.uniqueDeckPrintings);
  expect(result.coverage.poolPrintingIds).toHaveLength(result.coverage.uniquePoolPrintings);
  expect(result.coverage.deckPrintingIds).toHaveLength(result.coverage.uniqueDeckPrintings);
  expect(result.coverage.poolPrintingIds).toEqual([...result.coverage.poolPrintingIds].sort());
  expect(result.coverage.deckPrintingIds).toEqual([...result.coverage.deckPrintingIds].sort());
  expect(result.coverage.deckPrintingIds.every((id) => result.coverage.poolPrintingIds.includes(id))).toBe(
    true,
  );
  expect(result.coverage.observedCardNames).toEqual([]);
  expect(result.coverage.offeredActionCardNames).toEqual([]);
  expect(result.coverage.selectedActionCardNames).toEqual([]);
  expect(open).toHaveBeenCalledTimes(2);
  for (const [table] of open.mock.calls) {
    expect(table.content).toEqual({ kind: 'printed', format: 'akh-hou' });
    expect(table.maximumTurns).toBe(8);
    expect(table.seats.map((seat) => seat.controller)).toEqual(['local', 'engine']);
    expect(
      table.seats.every((seat) => seat.deck.cards.reduce((sum, card) => sum + card.count, 0) === 40),
    ).toBe(true);
  }
  expect(inventory).toHaveLength(1);
  expect(inventory[0]).toContain('Angel of Sanctions');
  expect(inventory[0]).toContain('The Scarab God');
  expect(dispose).toHaveBeenCalledOnce();
  expect(shutdown).toHaveBeenCalledOnce();
  expect(JSON.parse(await readFile(join(options.outputDirectory, 'report.json'), 'utf8'))).toEqual(result);
});

it('runs denser catalog-covering decks as an explicit non-Limited discovery strategy', async () => {
  const options = {
    ...(await inputs()),
    seeds: [0, 1],
    deckStrategy: 'catalog-coverage' as const,
    catalogTargetsPerDeck: 4,
  };
  const tables: SessionSpec[] = [];
  const backend: ObservedBackend = {
    id: 'fixture-catalog-discovery',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: vi.fn(async () => []),
    open: vi.fn(async (table: SessionSpec) => {
      tables.push(table);
      return { ok: true as const, session: finishedAfterPass(table) };
    }),
  };

  const result = await runPrintedObservedSweep(options, async () => ({
    backend,
    dispose: async () => undefined,
  }));

  expect(result.deckStrategy).toBe('catalog-coverage');
  expect(result.catalogTargetsPerDeck).toBe(4);
  expect(result.policy).toBe('adapter-declared-enumerated-catalog-coverage-directed/v1');
  expect(result.coverage.uniquePoolPrintings).toBe(8);
  expect(result.coverage.uniqueDeckPrintings).toBe(8);
  expect(
    tables.every((table) =>
      table.seats.every((seat) => seat.deck.cards.reduce((total, card) => total + card.count, 0) === 40),
    ),
  ).toBe(true);
  expect(tables[0]?.seats[0].deck).toEqual(tables[1]?.seats[1].deck);
  expect(tables[0]?.seats[1].deck).toEqual(tables[1]?.seats[0].deck);
});

it('retains an open refusal and continues later seeds without manufacturing callback coverage', async () => {
  const options = await inputs();
  let attempt = 0;
  const backend: ObservedBackend = {
    id: 'fixture-catalog-discovery',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: vi.fn(async () => []),
    open: vi.fn(async (table) => {
      attempt += 1;
      return attempt === 1
        ? { ok: false as const, error: { kind: 'backend-failure' as const, message: 'unsupported callback' } }
        : { ok: true as const, session: finishedAfterPass(table) };
    }),
    shutdown: vi.fn(async () => undefined),
  };
  const result = await runPrintedObservedSweep(options, async () => ({
    backend,
    dispose: async () => undefined,
  }));
  expect(result.sessions[0]).toMatchObject({ status: 'open-failed', observed: null });
  expect(result.sessions[1]?.observed?.status).toBe('finished');
  expect(result.summary).toEqual({ requested: 2, opened: 1, finished: 1, incomplete: 1 });
});
