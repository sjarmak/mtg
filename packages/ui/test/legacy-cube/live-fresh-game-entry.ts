import { createElement as h, useState } from 'react';
import type { ObservedBackend } from '@mtg/engine';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { mount } from '../../src/mount';
import { LegacyCubeRoute } from '../../src/routes/legacy-cube/LegacyCubeRoute';
import {
  encodeLegacyCubePicks,
  legacyCubeDraftPool,
  runLegacyCubeDraft,
} from '../../src/routes/legacy-cube/model';
import type { LegacyCubeForgeReadyPool } from '../../src/routes/legacy-cube/model';

const catalog = parsePrintedCardCatalog(catalogJson);
const ready: LegacyCubeForgeReadyPool = {
  schemaVersion: 1,
  kind: 'legacy-cube-forge-ready-pool',
  format: catalog.format,
  forgeVersion: catalog.forgeVersion,
  catalogContentSha256: catalog.contentSha256,
  decisionLedgerContentSha256: '1'.repeat(64),
  decisionLedgerFileSha256: '2'.repeat(64),
  positions: catalog.cards.map((card) => card.position),
  cards: catalog.cards.length,
  draft: { seats: 8, rounds: 3, packSize: 15 },
  contentSha256: '3'.repeat(64),
};
const pool = legacyCubeDraftPool(catalog, 'forge-ready', ready);
const draftSeed = 'browser/fresh-game';

function completeDraft(): readonly string[] {
  const picks: string[] = [];
  for (let guard = 0; guard < 60; guard += 1) {
    const progress = runLegacyCubeDraft(pool, draftSeed, picks);
    if (progress.result !== null) return picks;
    const choice = progress.owed[0]?.cards[0];
    if (choice === undefined) throw new Error('the browser draft fixture owes no pick');
    picks.push(choice.physicalId);
  }
  throw new Error('the browser draft fixture did not finish');
}

const picks = completeDraft();
const openedSeeds: string[] = [];
(globalThis as typeof globalThis & { __legacyCubeOpenedSeeds?: string[] }).__legacyCubeOpenedSeeds =
  openedSeeds;

const backend: ObservedBackend = {
  id: 'fresh-seed-browser-fixture',
  determinism: 'observed',
  capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
  supports: (): Promise<readonly string[]> => Promise.resolve([]),
  open: (table) => {
    if (table.seed === null) throw new Error('the fresh-game browser fixture requires a match seed');
    openedSeeds.push(table.seed);
    return Promise.resolve({
      ok: false,
      error: { kind: 'backend-failure', message: 'browser fixture captured the match seed' },
    });
  },
};

function Rig() {
  const [params, setParams] = useState<Readonly<Record<string, string>>>({
    pool: 'forge-ready',
    seed: draftSeed,
    picks: encodeLegacyCubePicks(catalog, picks),
  });
  return h(LegacyCubeRoute, {
    catalog: { status: 'ready', catalog },
    forgeReady: { status: 'ready', pool: ready },
    params,
    backend,
    onSetParams: (next): void => setParams((current) => ({ ...current, ...next })),
  });
}

mount('root', h(Rig));
