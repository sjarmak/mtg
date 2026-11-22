import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadFrozenTablePlan, readFrozenTableOptions } from '../../tools/frozen-table';

const roots: string[] = [];
const SET = resolve('packages/setgen/fixtures/sets/tideglass-reach.set.json');

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('the frozen table service', () => {
  it('requires explicit artifact, repository, web, and table addresses', () => {
    expect(readFrozenTableOptions(['/frozen', '/repo', '5302', '45761'])).toEqual({
      root: '/frozen',
      repoRoot: '/repo',
      webPort: 5302,
      port: 45761,
    });
    expect(() => readFrozenTableOptions(['/frozen', '/repo', '5302'])).toThrow(/usage/);
    expect(() => readFrozenTableOptions(['/frozen', '/repo', '5302', '0'])).toThrow(/table port/);
  });

  it('loads the selected staged set and its optional decks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mtg-frozen-table-'));
    roots.push(root);
    await mkdir(join(root, 'sets', 'tdg'), { recursive: true });
    await copyFile(SET, join(root, 'sets', 'tdg', 'set.json'));
    await writeFile(
      join(root, 'sets', 'index.json'),
      JSON.stringify({
        formatVersion: 4,
        selected: 'tdg',
        sets: [
          {
            stem: 'tdg',
            name: 'Tideglass Reach',
            code: 'TDG',
            what: 'test fixture',
            cardCount: 265,
            reduced: false,
            origin: 'custom',
            setUrl: 'sets/tdg/set.json',
          },
        ],
      }),
    );

    const plan = loadFrozenTablePlan(root);

    expect(plan.set.path).toBe(join(root, 'sets', 'tdg', 'set.json'));
    expect(plan.set.cardCount).toBeGreaterThan(0);
    expect(plan.precons.chosen).toBeNull();
  });
});
