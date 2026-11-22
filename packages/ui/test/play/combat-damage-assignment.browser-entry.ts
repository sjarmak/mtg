import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { ObservedBackend, ObservedSession, SessionSpec } from '@mtg/engine';
import { scriptBackend } from '@mtg/engine';
import { BackendGame } from '../../src/routes/play/BackendGame';

const table: SessionSpec = {
  content: { kind: 'printed', format: 'legacy' },
  seats: [
    { name: 'North', controller: 'local', deck: { name: 'north', cards: [] } },
    { name: 'South', controller: 'engine', deck: { name: 'south', cards: [] } },
  ],
  seed: 'ui/combat-damage-browser',
  maximumTurns: null,
};

const assignment = {
  inputId: 'combat-damage-assignment:17',
  source: { oid: 'forge-card-17', name: 'Charging Rhino', power: 5 },
  total: 5,
  canDefer: true,
  overrideOrder: false,
  recipients: [
    { oid: 'forge-card-20', name: 'Bear Cub', kind: 'blocker' as const, toughness: 2, damage: 0, lethal: 2 },
    {
      oid: 'forge-card-21',
      name: 'Horned Turtle',
      kind: 'blocker' as const,
      toughness: 3,
      damage: 1,
      lethal: 2,
    },
    {
      oid: 'forge-player-1',
      name: 'South',
      kind: 'defender' as const,
      toughness: null,
      damage: 0,
      lethal: 0,
    },
  ],
  defaultAmounts: [2, 2, 1],
};

const encoded = JSON.stringify({
  version: 1,
  ...assignment,
  amounts: assignment.defaultAmounts,
  defer: false,
});

const backend: ObservedBackend = {
  id: 'combat-damage-browser',
  determinism: 'observed',
  capabilities: { undo: false, fork: false, perSeatProjection: true, engineSeats: true },
  supports: async () => [],
  open: async (): Promise<{ readonly ok: true; readonly session: ObservedSession }> => {
    const opened = await scriptBackend().open(table);
    if (!opened.ok) throw new Error(opened.error.message);
    return {
      ok: true,
      session: {
        ...opened.session,
        decision: {
          seat: 0,
          kind: 'combat-damage',
          prompt: 'Assign 5 combat damage from Charging Rhino',
          options: [],
          input: {
            kind: 'text',
            id: assignment.inputId,
            label: 'Assign combat damage',
            minLength: 2,
            maxLength: 16384,
            suggestions: [encoded],
          },
          complete: true,
        },
        play: { ...opened.session.play!, combatDamage: assignment },
      },
    };
  },
};

const browserDocument = (
  globalThis as { readonly document?: { readonly getElementById: (id: string) => unknown } }
).document;
if (browserDocument === undefined) throw new Error('browser fixture document is missing');
const root = browserDocument.getElementById('root');
if (root === null) throw new Error('browser fixture root is missing');
createRoot(root as Parameters<typeof createRoot>[0]).render(createElement(BackendGame, { backend, table }));
