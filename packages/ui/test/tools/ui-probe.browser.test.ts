import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { runUiProbe } from '../../tools/ui-probe';
import { browserIt } from '../support/chrome';

const SET_FIXTURE = fileURLToPath(
  new URL('../../../setgen/fixtures/sets/tideglass-reach.set.json', import.meta.url),
);

browserIt(
  'probes the staged app and writes readable browser evidence',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'mtg-ui-probe-test-'));
    const out = join(root, 'artifacts');
    try {
      const result = await runUiProbe({
        out,
        route: '#/play',
        viewport: { name: 'phone-landscape', width: 844, height: 390, pointer: 'coarse' },
        steps: [
          { kind: 'click', name: 'Draft' },
          { kind: 'wait-text', text: 'No set staged' },
          { kind: 'measure', selector: '[aria-label="Playing with"]' },
        ],
      });
      expect(result.screenshots).toHaveLength(4);
      const png = await readFile(result.screenshots[3]!);
      expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(png.readUInt32BE(16)).toBeGreaterThan(0);
      expect(png.readUInt32BE(20)).toBeGreaterThan(0);
      expect(await readFile(result.page, 'utf8')).toContain('No set staged');
      expect(JSON.parse(await readFile(result.measures, 'utf8'))).toEqual([
        { selector: '[aria-label="Playing with"]', boxes: expect.any(Array) },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);

browserIt(
  'types through a controlled input and updates the page state',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'mtg-ui-probe-type-test-'));
    try {
      const result = await runUiProbe({
        out: join(root, 'artifacts'),
        route: '#/cards',
        set: SET_FIXTURE,
        viewport: { name: 'desktop', width: 1440, height: 900, pointer: 'fine' },
        steps: [{ kind: 'type', name: 'Search cards', text: 'zzzznomatchzzzz' }],
      });
      expect(await readFile(result.page, 'utf8')).toContain('0 of 90 shown');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);

browserIt(
  'selects the staged printed source',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'mtg-ui-probe-source-test-'));
    try {
      const result = await runUiProbe({
        out: join(root, 'artifacts'),
        route: '#/cards',
        source: 'isd',
        viewport: { name: 'desktop', width: 1440, height: 900, pointer: 'fine' },
        steps: [{ kind: 'wait-text', text: 'Innistrad' }],
      });
      expect(await readFile(result.page, 'utf8')).not.toContain('no set staged');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);
