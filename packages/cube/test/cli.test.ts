/**
 * The flags a construction cannot start on a bad value for.
 *
 * Everything the criteria describe is checked by `CubeCriteriaSchema` before
 * anything is opened. `--max-spend-usd` was not: it is read by the loop, which
 * runs after the store is open and a provider has been resolved, so a typo cost
 * a 626 MB file handle and a live call before it produced an error. Same for a
 * price ceiling stated against `--set`, which no generated card can be held to.
 *
 * Every case here runs with no store and no provider, and that is the assertion
 * rather than a description of it: both are replaced with recorders that refuse,
 * and `afterEach` fails any case that reached one. Asserting only the message
 * leaves the ordering — which is the whole of the fix — pinned by nothing, and a
 * `main` with its early refusal deleted passes a message test unchanged.
 *
 * The last block is the other half of that worry, for a flag that is read rather
 * than refused. `--draft-seed` reaches the drafts through the options this file
 * builds, and nothing was checking that it arrived, so the options are built
 * here from a command line and handed to the measurement.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as MtgData from '@mtg/data';
import type * as MtgLlm from '@mtg/llm';
import {
  DEFAULT_AVAILABILITY_DRAFTS,
  DEFAULT_AVAILABILITY_SEED,
  measureAvailability,
} from '../src/availability';
import type { CubeAvailability } from '../src/availability';
import { availabilityOptions, main } from '../src/cli';
import { DEFAULT_CUBE_ROUNDS, defaultMaxCubeSpendUsd } from '../src/construct';
import { CUBE_DEFAULT_SIZE } from '../src/criteria';
import { UnpriceableCubePoolError } from '../src/set-pool';
import { draftableCriteria, draftableEntries, draftablePool } from './support/draftable-cube';

const REQUIRED = ['--prompt', 'a practice cube', '--format', 'modern'] as const;

/** What a case reached that no case may reach. Hoisted, because the mocks are. */
const reached = vi.hoisted(() => ({ stores: [] as string[], providers: 0 }));

vi.mock('@mtg/data', async (importOriginal) => ({
  ...(await importOriginal<typeof MtgData>()),
  openStore: (path: string) => {
    reached.stores.push(path);
    throw new Error(`the store at ${path} was opened by a case that only checks a flag`);
  },
}));

vi.mock('@mtg/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof MtgLlm>()),
  resolveProvider: () => {
    reached.providers += 1;
    throw new Error('a provider was resolved by a case that only checks a flag');
  },
}));

afterEach(() => {
  const opened = [...reached.stores];
  const resolved = reached.providers;
  reached.stores.length = 0;
  reached.providers = 0;
  expect(opened, 'a flag check opened the card store').toStrictEqual([]);
  expect(resolved, 'a flag check resolved a provider').toBe(0);
});

/** A one-card set file on disk, which is all the price check needs to reach. */
function writeSetFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cube-cli-'));
  const path = join(dir, 'set.json');
  writeFileSync(
    path,
    JSON.stringify({
      formatVersion: 1,
      set: { code: 'TGR', name: 'Tideglass Reach', theme: 'glass', seed: 'seed', profile: 'test v1' },
      cards: [
        {
          kind: 'creature',
          id: 'tgr-dawn-warden',
          name: 'Dawn Warden',
          rarity: 'common',
          set: { code: 'TGR', collectorNumber: 1 },
          manaCost: { generic: 1, W: 1 },
          colors: ['W'],
          subtypes: ['Spirit'],
          keywords: [],
          effects: [],
          supertypes: [],
          power: 2,
          toughness: 2,
        },
      ],
    }),
    'utf8',
  );
  return path;
}

describe('cube flag validation', () => {
  it('refuses a spend bound that is not a positive number of dollars', async () => {
    await expect(main([...REQUIRED, '--max-spend-usd', '0'])).rejects.toThrow(
      /--max-spend-usd must be a positive number of dollars, got 0/,
    );
    await expect(main([...REQUIRED, '--max-spend-usd', '-2'])).rejects.toThrow(
      /--max-spend-usd must be a positive number of dollars/,
    );
  });

  it('reads that bound before it opens the store or resolves a provider', async () => {
    // The ordering rather than the message. `main` refuses the bound itself, so
    // a typo costs neither the 626 MB handle nor a live call; delete that early
    // read and every message assertion here still passes, because the loop
    // refuses the same value a store and a provider later.
    await expect(
      main([...REQUIRED, '--max-spend-usd', '-2', '--db', 'data/store/mtg.sqlite']),
    ).rejects.toThrow(/--max-spend-usd must be a positive number of dollars/);
    expect(reached.stores).toStrictEqual([]);
    expect(reached.providers).toBe(0);
  });

  it('refuses a spend bound that is not a number at all', async () => {
    await expect(main([...REQUIRED, '--max-spend-usd', 'five'])).rejects.toThrow(
      /--max-spend-usd must be a number, got five/,
    );
  });

  it('refuses a draft count that cannot be run, before it opens the store or resolves a provider', async () => {
    // The drafts run after the model has been paid, so a typo here would be
    // discovered at the most expensive possible moment.
    await expect(main([...REQUIRED, '--drafts', '0'])).rejects.toThrow(
      /--drafts must be a positive whole number of drafts, got 0/,
    );
    await expect(main([...REQUIRED, '--drafts', '2.5'])).rejects.toThrow(
      /--drafts must be a positive whole number of drafts, got 2.5/,
    );
    expect(reached.stores).toStrictEqual([]);
    expect(reached.providers).toBe(0);
  });

  it('refuses a price ceiling on a set that has no prices', async () => {
    await expect(
      main([...REQUIRED, '--set', writeSetFile(), '--size', '45', '--max-card-usd', '5']),
    ).rejects.toThrow(UnpriceableCubePoolError);
  });

  it('states the derived spend default in the usage rather than a figure that can drift', async () => {
    const written: string[] = [];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    try {
      await expect(main(['--help'])).resolves.toBe(0);
    } finally {
      write.mockRestore();
    }

    const usage = written.join('');
    expect(usage).toContain(`$${defaultMaxCubeSpendUsd(CUBE_DEFAULT_SIZE, DEFAULT_CUBE_ROUNDS).toFixed(2)}`);
    expect(usage).toContain('--set <path>');
    expect(usage).toContain(`--drafts <n>`);
    expect(usage).toContain(`(default ${String(DEFAULT_AVAILABILITY_DRAFTS)})`);
    expect(usage).toContain(`(default ${DEFAULT_AVAILABILITY_SEED})`);
  });

  it('says under --allow-multiples that such a cube is measured but not drafted', async () => {
    // The flag's cost is invisible until a run comes back with a reason instead
    // of a share, and the place to learn it is the flag's own line.
    const written: string[] = [];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    try {
      await expect(main(['--help'])).resolves.toBe(0);
    } finally {
      write.mockRestore();
    }

    const [multiples] = written.join('').split('--allow-multiples').slice(1);
    expect(multiples ?? '').toContain('measured but not drafted');
  });
});

/**
 * The seed is the whole of what makes a published share reproducible, and the
 * only path from the flag to a share runs through a construction, which needs
 * the store and a paid provider. So the flag is read here and the options it
 * produces are handed to the measurement directly. Dropping the seed on the way
 * out of the parser left every test in this package green (mtg-bc2.123): the
 * flag worked, and nothing said so.
 */
describe('the drafts a command line asks for', () => {
  const CRITERIA = draftableCriteria();
  const ENTRIES = draftableEntries();
  const POOL = draftablePool();

  function reportFor(argv: readonly string[]): CubeAvailability {
    return measureAvailability(ENTRIES, CRITERIA, POOL.draftable, availabilityOptions(argv));
  }

  function assembled(availability: CubeAvailability): readonly number[] {
    if (availability.kind === 'unmeasured') throw new Error(`not drafted: ${availability.reason}`);
    return availability.archetypes.map((archetype) => archetype.assembled);
  }

  it('reads --drafts and --draft-seed, and states neither when neither was given', () => {
    expect(availabilityOptions([...REQUIRED])).toStrictEqual({});
    expect(availabilityOptions([...REQUIRED, '--draft-seed', 'cube/cli/one'])).toStrictEqual({
      seed: 'cube/cli/one',
    });
    expect(availabilityOptions([...REQUIRED, '--drafts', '2', '--draft-seed', 'cube/cli/two'])).toStrictEqual(
      { drafts: 2, seed: 'cube/cli/two' },
    );
  });

  it('runs them under the seed it was handed: one seed one report, two seeds two reports', () => {
    const one = [...REQUIRED, '--drafts', '1', '--draft-seed', 'cube/cli/one'];
    const two = [...REQUIRED, '--drafts', '1', '--draft-seed', 'cube/cli/two'];

    expect(reportFor(one)).toStrictEqual(reportFor(one));
    // The counts, not just the seed the report carries: a seed that reaches the
    // page and not the pods would pass a comparison of whole reports.
    expect(assembled(reportFor(one))).not.toStrictEqual(assembled(reportFor(two)));
  });
});
