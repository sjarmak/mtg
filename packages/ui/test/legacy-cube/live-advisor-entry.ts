/** Real route, catalog and interaction handlers, without starting a game backend. */
import { createElement as h, useState } from 'react';
import type { ReactElement } from 'react';
import type { ObservedBackend } from '@mtg/engine';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { LegacyCubeRoute } from '../../src/routes/legacy-cube/LegacyCubeRoute';
import { mount } from '../../src/mount';
import { Shell } from '../../src/app/Shell';
import { DEFAULT_ADVISOR_WEIGHTS, advisorModelIdentityText } from '@mtg/draft-export';
import { sha256Text } from '../../src/routes/analysis/calibration-read';
import { useAdvisorCalibration } from '../../src/routes/legacy-cube/calibration';

const catalog = parsePrintedCardCatalog(catalogJson);
const backend: ObservedBackend = {
  id: 'advisor-browser-fixture',
  determinism: 'observed',
  capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
  supports: () => Promise.resolve([]),
  open: () =>
    Promise.resolve({
      ok: false,
      error: { kind: 'unsupported', capability: 'play', message: 'Draft-only fixture' },
    }),
};

function AdvisorRig({ calibrationUrl }: { readonly calibrationUrl: string }): ReactElement {
  const calibration = useAdvisorCalibration(calibrationUrl, catalog.contentSha256);
  const [params, setParams] = useState<Readonly<Record<string, string>>>({
    seed: 'advisor-browser',
    pool: 'full',
  });
  return h(LegacyCubeRoute, {
    calibration,
    catalog: { status: 'ready', catalog },
    backend,
    params,
    onSetParams: (next) => setParams((old) => ({ ...old, ...next })),
    forgeReady: {
      status: 'ready',
      pool: {
        schemaVersion: 1,
        kind: 'legacy-cube-forge-ready-pool',
        format: catalog.format,
        forgeVersion: 'fixture',
        catalogContentSha256: catalog.contentSha256,
        decisionLedgerContentSha256: '0'.repeat(64),
        decisionLedgerFileSha256: '0'.repeat(64),
        positions: catalog.cards.map((c) => c.position),
        cards: 600,
        draft: { seats: 8, rounds: 3, packSize: 15 },
        contentSha256: '0'.repeat(64),
      },
    },
  });
}

async function start() {
  // A synthetic snapshot exercises the real browser reader, not strategic validation.
  const body = {
    version: 'legacy-cube-advisor-calibration/v1',
    identity: {
      catalogSha256: catalog.contentSha256,
      modelSha256: await sha256Text(advisorModelIdentityText()),
    },
    weights: { ...DEFAULT_ADVISOR_WEIGHTS, revision: 'browser-trial/v1', synergy: 1.25 },
    provenance: {
      status: 'provisional',
      transitionSha256: 'a'.repeat(64),
      decisionSha256: 'b'.repeat(64),
      runtimeSha256: 'c'.repeat(64),
      independentHumanValidation: false,
      botValidated: false,
    },
  };
  const snapshot = { ...body, sha256: await sha256Text(JSON.stringify(body)) };
  const calibrationUrl = `data:application/json,${encodeURIComponent(JSON.stringify(snapshot))}`;
  mount(
    'root',
    h(Shell, {
      mode: 'play',
      sub: 'draft',
      onSelectMode: () => undefined,
      children: h(AdvisorRig, { calibrationUrl }),
    }),
  );
}
void start();
