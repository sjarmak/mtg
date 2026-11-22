/** OPENING_HAND seeds a real pregame; MAIN1's devMode jump must stay exactly as it was. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeScenarioBackend, compileInstalledForgeBridge } from '../src/observed/installed';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
const DROSS = 'Chancellor of the Dross';
const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seats: [
    { name: 'Pilot 0', controller: 'local', deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] } },
    { name: 'Pilot 1', controller: 'local', deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] } },
  ],
  seed: 'bridge-scenario-opening-hand-v1',
  maximumTurns: 10,
};

const isStop = (option: { readonly text: string }): boolean =>
  option.text === 'Choose none' || option.text === 'Done choosing';

async function openedSession(): Promise<{
  readonly session: ObservedSession;
  readonly dispose: () => Promise<void>;
}> {
  const compiled = compileInstalledForgeBridge();
  if (compiled === null) throw new Error('Installed Forge required');
  const initial = {
    schemaVersion: 1 as const,
    active: 0 as const,
    phase: 'OPENING_HAND' as const,
    seats: [
      {
        life: 20,
        hand: [DROSS, 'Island', 'Island', 'Island', 'Island', 'Island', 'Island'],
        library: ['Island', 'Island', 'Island'],
        battlefield: [],
        graveyard: [],
      },
      {
        life: 20,
        hand: ['Island', 'Island', 'Island', 'Island', 'Island', 'Island'],
        library: ['Island', 'Island', 'Island', 'Island'],
        battlefield: [],
        graveyard: [],
      },
    ] as const,
  };
  const backend = installedForgeScenarioBackend(initial, { compiledBridgeClasses: compiled.classDirectory });
  if (backend === null) throw new Error('Installed Forge required');
  const opened = await backend.open(table);
  if (!opened.ok) throw new Error(opened.error.message);
  return {
    session: opened.session,
    dispose: async () => {
      await opened.session.close();
      await backend.shutdown?.();
      compiled.dispose();
    },
  };
}

forgeIt(
  'reaches OPENING_HAND with the opening-hand-action decision first, and both answers reach Forge',
  async () => {
    const revealing = await openedSession();
    try {
      expect(revealing.session.decision?.kind).toBe('opening-hand-action');
      const options =
        revealing.session.decision?.kind === 'opening-hand-action' ? revealing.session.decision.options : [];
      const reveal = options.find((option) => !isStop(option) && option.text.includes(DROSS));
      if (reveal === undefined) throw new Error('Chancellor of the Dross was not offered');
      const advanced = await revealing.session.submit(reveal.id);
      if (!advanced.ok) throw new Error(advanced.error.message);
      expect(advanced.session.decision).not.toBeNull();
    } finally {
      await revealing.dispose();
    }

    const declining = await openedSession();
    try {
      expect(declining.session.decision?.kind).toBe('opening-hand-action');
      const options =
        declining.session.decision?.kind === 'opening-hand-action' ? declining.session.decision.options : [];
      const stop = options.find(isStop);
      if (stop === undefined) throw new Error('No close-out option for the opening-hand question');
      const advanced = await declining.session.submit(stop.id);
      if (!advanced.ok) throw new Error(advanced.error.message);
      expect(advanced.session.decision).not.toBeNull();
    } finally {
      await declining.dispose();
    }
  },
  60_000,
);

forgeIt(
  "holds each seat's declared hand and library at the opening-hand question, not its table deck",
  async () => {
    const opened = await openedSession();
    try {
      expect(opened.session.decision?.kind).toBe('opening-hand-action');
      const [local, other] = opened.session.view.seats;
      // Each table deck is 60 Islands; the scenario declares 7 and 6 in hand, 3 and 4 in library,
      // so a library Forge rebuilt from the deck, or a swapped seat, cannot pass by coincidence.
      expect([local?.handSize, other?.handSize]).toEqual([7, 6]);
      expect([local?.librarySize, other?.librarySize]).toEqual([3, 4]);
    } finally {
      await opened.dispose();
    }
  },
  60_000,
);

forgeIt(
  'leaves a MAIN1 scenario at priority, unaffected by the OPENING_HAND phase',
  async () => {
    const compiled = compileInstalledForgeBridge();
    if (compiled === null) throw new Error('Installed Forge required');
    const initial = {
      schemaVersion: 1 as const,
      active: 0 as const,
      phase: 'MAIN1' as const,
      seats: [
        { life: 20, hand: [], battlefield: [], library: ['Island'], graveyard: [] },
        { life: 20, hand: [], battlefield: [], library: ['Island'], graveyard: [] },
      ] as const,
    };
    const backend = installedForgeScenarioBackend(initial, {
      compiledBridgeClasses: compiled.classDirectory,
    });
    if (backend === null) throw new Error('Installed Forge required');
    let session: ObservedSession | undefined;
    try {
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      expect(session.decision?.kind).toBe('priority');
    } finally {
      await session?.close();
      await backend.shutdown?.();
      compiled.dispose();
    }
  },
  60_000,
);
