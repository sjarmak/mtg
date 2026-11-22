/**
 * The workbench server, its store, and the one refusal that costs money to get
 * wrong.
 *
 * The build route's absence without a spend ceiling is the first test in the
 * file and the one to break loudest. Everything else here is a shape; that one
 * is the reason a person can leave this server running without watching it.
 */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BuildInFlightError, JobBoard } from '../src/workbench/jobs';
import type { RunningWorkbenchServer, WorkbenchSet } from '../src/workbench/server';
import { serveDeckWorkbench } from '../src/workbench/server';
import { VariationStore } from '../src/workbench/store';
import type { DeckVariation } from '../src/workbench/variation';
import { DECK_VARIATION_VERSION } from '../src/workbench/variation';

const SETS: readonly WorkbenchSet[] = [
  { code: 'XMP', name: 'the flagship set', cardCount: 371 },
  { code: 'M11', name: 'Magic 2011 (reduced)', cardCount: 249 },
];

const CRITERIA = { prompt: 'a fast white deck', sets: ['XMP'], colors: ['W'], size: 60 };

function variation(overrides: Partial<DeckVariation> = {}): DeckVariation {
  return {
    version: DECK_VARIATION_VERSION,
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    name: 'white weenie',
    builtAt: '2026-08-31T20:00:00.000Z',
    parentId: null,
    criteria: { ...CRITERIA, colors: ['W'], themes: [], maxCopies: 4 },
    statedCriteria: [{ id: 'sets', kind: 'structural', statement: 'printed in XMP' }],
    plan: 'curve out and attack',
    spells: [
      {
        id: 'xmp-skyborn-fledgling',
        name: 'Skyborn Fledgling',
        count: 4,
        manaCost: '{W}',
        manaValue: 1,
        typeLine: 'Creature — Bird Soldier',
        criteria: ['sets'],
        reason: 'a one-mana flyer',
      },
    ],
    lands: [],
    basics: [{ color: 'W', count: 21, id: 'xmp-plains' }],
    manaBase: {
      totalLands: 21,
      nonBasicLands: 0,
      castabilityTarget: 0.9,
      heavyCastabilityTarget: 0.8,
      colors: [
        { color: 'W', pipCount: 39, sources: 21, sourceFloor: 16, castability: 0.96, meetsTarget: true },
      ],
      landReason: 'a mono-white aggro deck needs its first three land drops',
      landSource: 'model',
    },
    universeSize: 95,
    shortfalls: [],
    ...overrides,
  } as DeckVariation;
}

let running: RunningWorkbenchServer | undefined;
let directory: string | undefined;

afterEach(async () => {
  if (running !== undefined) await running.close();
  running = undefined;
  if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

function newStore(): VariationStore {
  directory = mkdtempSync(join(tmpdir(), 'mtg-workbench-'));
  return new VariationStore(directory);
}

async function start(
  options: {
    readonly builder?: () => Promise<DeckVariation>;
    readonly checkPool?: () => string | null;
  } = {},
): Promise<string> {
  const store = newStore();
  running = await serveDeckWorkbench({
    port: 0,
    host: '127.0.0.1',
    sets: SETS,
    store,
    ...(options.builder === undefined ? {} : { builder: options.builder }),
    ...(options.checkPool === undefined ? {} : { checkPool: options.checkPool }),
  });
  return `http://127.0.0.1:${String(running.port)}`;
}

describe('the build route', () => {
  it('does not exist without a spend ceiling, and says which command arms it', async () => {
    // The whole safety story: a build spends model budget, so the route that
    // starts one is absent unless a person typed a dollar figure. There must be
    // no way to spend by forgetting a flag.
    const base = await start();

    const response = await fetch(`${base}/deck-api/build`, {
      method: 'POST',
      body: JSON.stringify({ criteria: CRITERIA, name: 'white weenie' }),
    });

    expect(response.status).toBe(404);
    const body = (await response.json()) as { refused: string };
    expect(body.refused).toContain('--max-usd');
  });

  it('starts a build and answers with a job rather than the deck', async () => {
    // Minutes, not milliseconds: the request that starts the work returns an id
    // and the page asks how it is going.
    const base = await start({ builder: () => Promise.resolve(variation()) });

    const response = await fetch(`${base}/deck-api/build`, {
      method: 'POST',
      body: JSON.stringify({ criteria: CRITERIA, name: 'white weenie' }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ state: 'running', name: 'white weenie' });
  });

  it('writes the variation down before it reports the build done', async () => {
    const base = await start({ builder: () => Promise.resolve(variation()) });
    const started = (await (
      await fetch(`${base}/deck-api/build`, {
        method: 'POST',
        body: JSON.stringify({ criteria: CRITERIA, name: 'white weenie' }),
      })
    ).json()) as { id: string };

    // Polled the way the page polls, rather than reaching into the board.
    let state = 'running';
    for (let attempt = 0; attempt < 50 && state === 'running'; attempt += 1) {
      await new Promise((settle) => setTimeout(settle, 10));
      state = ((await (await fetch(`${base}/deck-api/build/${started.id}`)).json()) as { state: string })
        .state;
    }

    expect(state).toBe('done');
    // A page told "done" and then handed a 404 for the deck would be worse than
    // a page still told "building", so the write happens first.
    const shelf = (await (await fetch(`${base}/deck-api/variations`)).json()) as {
      variations: readonly { name: string }[];
    };
    expect(shelf.variations.map((row) => row.name)).toStrictEqual(['white weenie']);
  });

  it('reports a failed build as a failed job rather than as a dead request', async () => {
    const base = await start({ builder: () => Promise.reject(new Error('the model refused')) });
    const started = (await (
      await fetch(`${base}/deck-api/build`, {
        method: 'POST',
        body: JSON.stringify({ criteria: CRITERIA, name: 'doomed' }),
      })
    ).json()) as { id: string };

    let job = { state: 'running', error: undefined as string | undefined };
    for (let attempt = 0; attempt < 50 && job.state === 'running'; attempt += 1) {
      await new Promise((settle) => setTimeout(settle, 10));
      job = (await (await fetch(`${base}/deck-api/build/${started.id}`)).json()) as typeof job;
    }

    expect(job.state).toBe('failed');
    expect(job.error).toBe('the model refused');
  });

  it('refuses criteria naming a set this lab has not staged, and names what it has', async () => {
    // Well-formed and unavailable are two different sentences, and only the
    // second one is a fact about this machine.
    const base = await start({ builder: () => Promise.resolve(variation()) });

    const response = await fetch(`${base}/deck-api/criteria/validate`, {
      method: 'POST',
      body: JSON.stringify({ ...CRITERIA, sets: ['ZZZ'] }),
    });

    const body = (await response.json()) as { ok: boolean; issues: readonly { message: string }[] };
    expect(body.ok).toBe(false);
    expect(body.issues[0]?.message).toContain('XMP');
  });

  it('reports what the pool itself refuses, keyed to the field the selection is in', async () => {
    // `mtg-1urk`. This is knowable the moment the second set is chosen and used
    // to arrive minutes later as a failed build, which reads like a wasted
    // charge even though the pool is assembled before the first model call.
    const base = await start({ checkPool: () => 'M11 and M13 both print Pacifism, but not the same card' });

    const body = (await (
      await fetch(`${base}/deck-api/criteria/validate`, {
        method: 'POST',
        body: JSON.stringify({ ...CRITERIA, sets: ['XMP', 'M11'] }),
      })
    ).json()) as { ok: boolean; issues: readonly { pointer: string; message: string }[] };

    expect(body.ok).toBe(false);
    expect(body.issues[0]?.pointer).toBe('/sets');
    expect(body.issues[0]?.message).toContain('both print Pacifism');
  });

  it('starts no build on criteria the pool refuses, so a doomed build costs nothing', async () => {
    let built = 0;
    const base = await start({
      builder: () => {
        built += 1;
        return Promise.resolve(variation());
      },
      checkPool: () => 'the pool holds no card at all',
    });

    const response = await fetch(`${base}/deck-api/build`, {
      method: 'POST',
      body: JSON.stringify({ criteria: CRITERIA, name: 'doomed' }),
    });

    // A refusal in the shape every other refusal takes, not the validation
    // document: a page reading this route reads jobs, and a second shape here
    // came back as a malformed job rather than as the sentence.
    expect(response.status).toBe(400);
    expect((await response.json()) as unknown).toStrictEqual({
      refused: 'these criteria cannot be built. sets: the pool holds no card at all',
    });
    expect(built).toBe(0);
  });

  it('checks the schema and the staged codes without one, so a server can have no pool', async () => {
    const base = await start();

    const body = (await (
      await fetch(`${base}/deck-api/criteria/validate`, {
        method: 'POST',
        body: JSON.stringify(CRITERIA),
      })
    ).json()) as { ok: boolean };

    expect(body.ok).toBe(true);
  });
});

describe('the shelf', () => {
  it('offers the staged sets a pool can be cut from, and says it cannot build', async () => {
    // `builds` is here so the page draws the unarmed state at load. Without it
    // the only way to learn is to press the button and read a 404, which is the
    // state this arrangement exists to state rather than to fail into.
    const base = await start();

    expect(await (await fetch(`${base}/deck-api/sets`)).json()).toStrictEqual({
      sets: SETS,
      builds: false,
    });
  });

  it('says it can build when it was given a builder', async () => {
    const base = await start({ builder: () => Promise.resolve(variation()) });

    expect(await (await fetch(`${base}/deck-api/sets`)).json()).toStrictEqual({
      sets: SETS,
      builds: true,
    });
  });

  it('answers 404 for an id that is not a variation id, rather than reading a path', async () => {
    // Ids arrive off a URL and reach a filesystem call, so what is accepted is
    // stated rather than what is rejected.
    const base = await start();

    expect((await fetch(`${base}/deck-api/variations/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
  });
});

describe('VariationStore', () => {
  it('keeps a variation across a fresh store over the same directory', () => {
    // The point of not using localStorage: the deck outlives the browser, the
    // tab, and this process.
    const store = newStore();
    store.write(variation());

    expect(new VariationStore(store.directory).read(variation().id).name).toBe('white weenie');
  });

  it('reports an unreadable file instead of failing the whole shelf', () => {
    const store = newStore();
    store.write(variation());
    writeFileSync(join(store.directory, 'broken.json'), '{ not json');

    const shelf = store.list();
    expect(shelf.variations).toHaveLength(1);
    expect(shelf.unreadable.map((entry) => entry.file)).toStrictEqual(['broken.json']);
  });

  it('leaves no temporary file behind, so a shelf reads what it wrote', () => {
    const store = newStore();
    store.write(variation());

    expect(readdirSync(store.directory)).toStrictEqual([`${variation().id}.json`]);
  });
});

describe('JobBoard', () => {
  it('refuses a second build while one is running, because each spends the ceiling', () => {
    const board = new JobBoard();
    const now = (): Date => new Date('2026-08-31T20:00:00.000Z');
    board.start(
      'first',
      'one',
      now,
      () => new Promise(() => undefined),
      () => undefined,
    );

    expect(() =>
      board.start(
        'second',
        'two',
        now,
        () => Promise.resolve(variation()),
        () => undefined,
      ),
    ).toThrow(BuildInFlightError);
  });

  it('frees the board after a build fails, so the next one can start', async () => {
    const board = new JobBoard();
    const now = (): Date => new Date('2026-08-31T20:00:00.000Z');
    board.start(
      'first',
      'one',
      now,
      () => Promise.reject(new Error('no')),
      () => undefined,
    );

    await new Promise((settle) => setTimeout(settle, 10));

    expect(board.runningId).toBeUndefined();
  });
});
