// @vitest-environment jsdom
/**
 * The installed Forge process through the entire browser session boundary.
 *
 * This belongs in `@mtg/slice` rather than `@mtg/ui`: slice tests are the
 * workspace's cross-package composition point, while putting Forge in the UI
 * manifest would make a Node-only GPL subprocess adapter look like a browser
 * dependency. Ordinary checkouts skip because the downloaded jar is untracked;
 * release verification sets MTG_REQUIRE_FORGE_BRIDGE=1 and absence is then a
 * failure, never a pass.
 *
 * This proves backend selection, transport, validation, pregame and priority
 * MoveId submission, complete local-seat agency, and terminal rendering.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ObservedBackend, SessionSpec } from '@mtg/engine';
import { serveBackendGateway } from '@mtg/netplay';
import { BackendGame, CLOSE_GAME_LABEL, httpObservedBackend } from '@mtg/ui';

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Human',
      controller: 'local',
      deck: {
        name: 'human-rift',
        cards: [
          { name: 'Mountain', count: 24 },
          { name: 'Flame Rift', count: 36 },
        ],
      },
    },
    {
      name: 'Forge AI',
      controller: 'engine',
      deck: {
        name: 'ai-rift',
        cards: [
          { name: 'Mountain', count: 24 },
          { name: 'Flame Rift', count: 36 },
        ],
      },
    },
  ],
  seed: '1517-http-ui',
  maximumTurns: 30,
};

interface ForgePublicApi {
  readonly installedForgeBackend: (options: {
    readonly forgeHome: string;
    readonly userDir: string;
    readonly timeoutMs: number;
  }) => ObservedBackend | null;
}

interface ForgeSandbox {
  readonly home: string;
  readonly userDir: string;
  readonly remove: () => void;
}

const requireForge = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1';
const forgeIt = requireForge ? it : it.skip;
const INSTALLED_FORGE_HOME = fileURLToPath(new URL('../../../tools/forge/dist', import.meta.url));

afterEach(() => {
  cleanup();
});

async function forgePublicApi(): Promise<ForgePublicApi> {
  // The Forge lane lands this public export independently. Keeping the import
  // inside the required test lets this harness land first without treating an
  // unavailable implementation as an ordinary-suite skip.
  const loaded = (await import('@mtg/forge-export')) as Partial<ForgePublicApi>;
  expect(
    loaded.installedForgeBackend,
    '@mtg/forge-export must expose the finalized installed ObservedBackend adapter',
  ).toBeTypeOf('function');
  return loaded as ForgePublicApi;
}

function sandboxForge(sourceHome: string): ForgeSandbox {
  const jar = readdirSync(sourceHome).find((name) =>
    /^forge-gui-desktop-.+-jar-with-dependencies\.jar$/.test(name),
  );
  expect(jar, `MTG_REQUIRE_FORGE_BRIDGE=1 requires an installed jar under ${sourceHome}`).toBeDefined();
  if (jar === undefined) throw new Error(`no installed Forge jar under ${sourceHome}`);
  expect(
    existsSync(join(sourceHome, 'res')),
    `installed Forge has no res directory under ${sourceHome}`,
  ).toBe(true);

  // installedForgeBackend materializes a profile below forgeHome. Keep the
  // explicit shared artifact read-only by exposing its jar and res from a
  // disposable home, then delete only that mkdtemp-owned directory.
  const home = mkdtempSync(join(tmpdir(), 'mtg-forge-http-ui-'));
  symlinkSync(join(sourceHome, jar), join(home, basename(jar)));
  symlinkSync(join(sourceHome, 'res'), join(home, 'res'), 'dir');
  return {
    home,
    userDir: join(home, 'userdata'),
    remove: () => {
      rmSync(home, { force: true, recursive: true });
    },
  };
}

function phase(container: HTMLElement): string | null {
  const readable = container as unknown as {
    readonly querySelector: (
      selector: string,
    ) => { readonly getAttribute: (name: string) => string | null } | null;
  };
  return readable.querySelector('[data-session-phase]')?.getAttribute('data-session-phase') ?? null;
}

function textOf(element: HTMLElement): string {
  return (element as unknown as { readonly textContent: string | null }).textContent ?? '';
}

// The prompt title is a `<span className="mtg-panel__title">` (rail.ts's
// promptPanel), not a semantic heading, and it sits in the panel head beside
// the "Legal moves" group rather than inside it -- the same selector
// `active-task.test.ts` reads it through.
function headline(container: HTMLElement): string {
  const readable = container as unknown as {
    readonly querySelector: (selector: string) => { readonly textContent: string | null } | null;
  };
  return readable.querySelector('.mtg-panel__title')?.textContent ?? '';
}

function legalMove(container: HTMLElement): HTMLElement {
  const moves = within(container).getByRole('group', { name: 'Legal moves' });
  const options = within(moves).getAllByRole('button');
  const proactive = options.find((button) => /Mountain|Flame Rift/.test(textOf(button)));
  const playFirst = options.find((button) => textOf(button) === 'Play first');
  const keep = options.find((button) => textOf(button) === 'Keep this hand');
  const pass = options.find((button) => /pass/i.test(textOf(button)));
  return (proactive ?? playFirst ?? keep ?? pass ?? options[0]) as HTMLElement;
}

describe('installed Forge through the backend-neutral browser session', () => {
  forgeIt(
    'selects Forge once, crosses real HTTP, and renders its terminal result',
    async () => {
      const api = await forgePublicApi();
      const sandbox = sandboxForge(INSTALLED_FORGE_HOME);
      try {
        const backend = api.installedForgeBackend({
          forgeHome: sandbox.home,
          userDir: sandbox.userDir,
          timeoutMs: 120_000,
        });
        expect(backend, 'MTG_REQUIRE_FORGE_BRIDGE=1 requires an installed Forge 2.0.14').not.toBeNull();
        if (backend === null) return;
        expect(backend.id).toBe('forge-2.0.14');

        const gateway = await serveBackendGateway({
          host: '127.0.0.1',
          port: 0,
          installed: [backend],
          routes: {
            generated: 'kernel',
            printed: { 'legacy-cube-2021-08': backend.id },
          },
        });
        try {
          const browserBackend = httpObservedBackend({
            id: backend.id,
            baseUrl: `http://127.0.0.1:${String(gateway.port)}/engine-api`,
          });
          const rendered = render(createElement(BackendGame, { backend: browserBackend, table: TABLE }));
          await within(rendered.container).findByRole(
            'button',
            { name: CLOSE_GAME_LABEL },
            { timeout: 120_000 },
          );

          const answeredPrompts: string[] = [];
          const submittedLabels: string[] = [];
          for (
            let submitted = 0;
            phase(rendered.container) === 'awaiting' && submitted < 300;
            submitted += 1
          ) {
            answeredPrompts.push(headline(rendered.container));
            const move = legalMove(rendered.container);
            submittedLabels.push(textOf(move));
            fireEvent.click(move);
            await waitFor(
              () => {
                expect(phase(rendered.container)).not.toBe('submitting');
              },
              { timeout: 120_000 },
            );
          }
          expect(answeredPrompts.some((prompt) => prompt.includes('won the die roll'))).toBe(true);
          expect(submittedLabels).toContain('Play first');
          expect(submittedLabels).toContain('Keep this hand');

          if (phase(rendered.container) === 'error') {
            const alert = within(rendered.container).getByRole('alert');
            throw new Error(`real Forge browser session failed: ${textOf(alert)}`);
          }
          expect(phase(rendered.container)).toBe('finished');
          // The finished table keeps its other live-region status elements
          // (priority changes, land drop, phase-bar stop changes) mounted
          // alongside the terminal result, so the terminal is found by its
          // content among every `role="status"` node rather than assumed to
          // be the only one -- the same pattern `http-backend-game.test.ts`
          // and `backend-game.test.ts` use for this same result text.
          const terminal = within(rendered.container)
            .getAllByRole('status')
            .find((status) => /wins|Game drawn/.test(textOf(status)));
          expect(terminal, 'a status element announces the terminal result').toBeDefined();
          expect(within(rendered.container).getByRole('region', { name: 'Game table' })).toBeDefined();
          rendered.unmount();
        } finally {
          await gateway.close();
        }
      } finally {
        sandbox.remove();
      }
    },
    240_000,
  );
});
