import { createElement, Fragment } from 'react';
import type { SessionSpec } from '@mtg/engine';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import { httpObservedBackend } from '../../src/net/backend-gateway';
import { mount } from '../../src/mount';
import { legacyCubeForgeOpeningChoiceSeat } from '../../src/routes/legacy-cube/model';
import { BackendGame } from '../../src/routes/play/BackendGame';
import { GlobalStyles } from '../../src/styles/index';

const CATALOG_URL = '/legacy-cube-2021-card-catalog-v1.json';
const MATCH_SEED = 'legacy-cube/installed-forge-attacker-browser/v1';
const CREATURES = [
  'Giver of Runes',
  'Usher of the Fallen',
  'Mother of Runes',
  'Student of Warfare',
  'Thraben Inspector',
  'Charming Prince',
  'Containment Priest',
  'Remorseful Cleric',
  'Esper Sentinel',
  'Selfless Spirit',
  'Stoneforge Mystic',
  'Thalia, Guardian of Thraben',
  'Luminarch Aspirant',
] as const;

interface LiveAttackWindow {
  __mtgInstalledForgeAttackFailure?: string;
  __mtgInstalledForgeAttackReady?: boolean;
  __mtgInstalledForgeAttackUnmount?: () => void;
}

async function main(): Promise<void> {
  const response = await fetch(CATALOG_URL);
  if (!response.ok) throw new Error(`Legacy Cube catalog returned HTTP ${String(response.status)}`);
  const catalog = parsePrintedCardCatalog(await response.json());
  const known = new Set(catalog.cards.map((card) => card.name));
  const missing = CREATURES.filter((name) => !known.has(name));
  if (missing.length > 0) {
    throw new Error(`controlled attacker deck is missing from the catalog: ${missing.join(', ')}`);
  }

  const humanSeat = await legacyCubeForgeOpeningChoiceSeat(MATCH_SEED, catalog.forgeVersion, [40, 40]);
  const human = {
    name: 'You',
    controller: 'local' as const,
    deck: {
      name: 'Controlled singleton attacker proof',
      cards: [...CREATURES.map((name) => ({ name, count: 1 })), { name: 'Plains', count: 27 }],
    },
  };
  const opponent = {
    name: 'Forge bot',
    controller: 'engine' as const,
    deck: { name: 'Controlled passive opponent', cards: [{ name: 'Plains', count: 40 }] },
  };
  const table: SessionSpec = {
    content: { kind: 'printed', format: catalog.format },
    seats: humanSeat === 0 ? [human, opponent] : [opponent, human],
    seed: MATCH_SEED,
    maximumTurns: null,
  };
  const backend = httpObservedBackend({ id: `forge-${catalog.forgeVersion}` });
  const mounted = mount(
    'root',
    createElement(
      Fragment,
      null,
      createElement(GlobalStyles),
      createElement(BackendGame, { backend, table, printedCards: catalog.cards }),
    ),
  );
  const host = globalThis as typeof globalThis & LiveAttackWindow;
  host.__mtgInstalledForgeAttackUnmount = (): void => mounted.unmount();
  host.__mtgInstalledForgeAttackReady = true;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  (globalThis as typeof globalThis & LiveAttackWindow).__mtgInstalledForgeAttackFailure = message;
});
