import { createElement as h } from 'react';
import type { ObjectView, ObservedBackend, SessionSpec } from '@mtg/engine';
import { scriptBackend } from '@mtg/engine';
import type { PrintedCardCatalogEntry } from '@mtg/printed-card';
import { mount } from '../../src/mount';
import { BackendGame } from '../../src/routes/play/BackendGame';

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy' },
  seats: [
    { name: 'You', controller: 'local', deck: { name: 'you', cards: [] } },
    { name: 'Forge bot', controller: 'engine', deck: { name: 'bot', cards: [] } },
  ],
  seed: 'ui/live-stack-inspect',
  maximumTurns: null,
};

const PRINTED = {
  physicalId: 'legacy-cube-2021:0001:00000000-0000-0000-0000-000000000001',
  position: 1,
  sourceName: 'Stack Sentinel',
  correctedName: 'Stack Sentinel',
  name: 'Stack Sentinel',
  oracleId: '00000000-0000-0000-0000-000000000002',
  scryfallId: '00000000-0000-0000-0000-000000000001',
  forgeScript: 'stack-sentinel.txt',
  forgeScriptSha256: '0'.repeat(64),
  layout: 'normal',
  manaCost: '{2}',
  manaValue: 2,
  typeLine: 'Artifact Creature',
  oracleText: 'Vigilance',
  power: '2',
  toughness: '3',
  loyalty: null,
  colors: [],
  colorIdentity: [],
  faces: [
    {
      name: 'Stack Sentinel',
      manaCost: '{2}',
      typeLine: 'Artifact Creature',
      oracleText: 'Vigilance',
      power: '2',
      toughness: '3',
      loyalty: null,
      colors: [],
    },
  ],
  art: {
    status: 'available',
    source: 'scryfall',
    scryfallId: '00000000-0000-0000-0000-000000000001',
    images: [
      {
        face: null,
        uris: {
          art_crop:
            'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="800" height="600"%3E%3Crect width="800" height="600" fill="%23343a40"/%3E%3C/svg%3E',
        },
      },
    ],
  },
} satisfies PrintedCardCatalogEntry;

const SPELL: ObjectView = {
  oid: 'foreign:stack:printed:10',
  name: PRINTED.name,
  typeLine: PRINTED.typeLine,
  power: null,
  toughness: null,
  tapped: false,
  attacking: false,
  damage: 0,
  controller: 0,
  counters: {},
};

async function start(): Promise<void> {
  const base = scriptBackend({ clock: 3 });
  const opened = await base.open(TABLE);
  if (!opened.ok) throw new Error(opened.error.message);
  const session = {
    ...opened.session,
    view: { ...opened.session.view, stack: [SPELL] },
  };
  const backend: ObservedBackend = {
    id: 'stack-inspection-browser-fixture',
    determinism: 'observed',
    capabilities: {
      undo: false,
      fork: false,
      perSeatProjection: true,
      engineSeats: true,
    },
    supports: (): Promise<readonly string[]> => Promise.resolve([]),
    open: () => Promise.resolve({ ok: true, session }),
  };
  mount('root', h(BackendGame, { backend, table: TABLE, printedCards: [PRINTED] }));
}

void start();
