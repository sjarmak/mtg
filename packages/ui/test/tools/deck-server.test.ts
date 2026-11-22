/**
 * Who owns the deck server, decided before anything is bound.
 *
 * `mtg-j1rg`. The three states are a parent launcher's server, somebody else's
 * server, and none — and the only one of them that starts a process is the last.
 * Getting the middle one wrong is a lab that refuses to open beside a running
 * `npm run deckbench`, which is the arrangement that serves the library best.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DECK_PORT, deckLibraryArgv, planDeckServer } from '../../tools/deck-server';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');

describe('planning the deck server', () => {
  it('starts one when the port is free', () => {
    const plan = planDeckServer({ envPort: undefined, busy: false });

    expect(plan.kind).toBe('start');
    expect(plan.port).toBe(DEFAULT_DECK_PORT);
  });

  it('talks to the one already there rather than refusing to open beside it', () => {
    const plan = planDeckServer({ envPort: undefined, busy: true });

    expect(plan.kind).toBe('attach');
    expect(plan.port).toBe(DEFAULT_DECK_PORT);
    expect(plan.message).toContain('deckbench');
  });

  it('leaves a parent launcher its own server, on the port that launcher chose', () => {
    // `npm run deckbench` spawns this launcher and passes MTG_DECK_PORT, and its
    // server may be on a moved port. Starting a second one here would bind a
    // port the page never asks and keep a library nobody reads.
    const plan = planDeckServer({ envPort: '6100', busy: false });

    expect(plan.kind).toBe('inherited');
    expect(plan.port).toBe(6100);
  });

  it('names the deck library launcher, not the workbench one', () => {
    // The workbench launcher spawns the page, so play spawning it would have
    // play start a process whose job is to start play.
    const argv = deckLibraryArgv('/repo', DEFAULT_DECK_PORT);

    expect(argv).toEqual(['tsx', '/repo/packages/decklab/tools/deck-library.ts', '--port', '5278']);
  });

  it('asks the port the page asks', () => {
    // Three files spell 5278: this one, `../../vite.config.ts`'s proxy target, and
    // `@mtg/decklab`'s defaults. The proxy target is fixed when Vite boots, so a
    // server started on any other port is one the page never reaches.
    const viteConfig = readFileSync(join(REPO_ROOT, 'packages', 'ui', 'vite.config.ts'), 'utf8');
    const defaults = readFileSync(
      join(REPO_ROOT, 'packages', 'decklab', 'tools', 'deck-api-defaults.ts'),
      'utf8',
    );

    expect(viteConfig).toContain(`process.env['MTG_DECK_PORT'] ?? '${String(DEFAULT_DECK_PORT)}'`);
    expect(defaults).toContain(`export const DEFAULT_DECK_PORT = ${String(DEFAULT_DECK_PORT)};`);
  });
});
