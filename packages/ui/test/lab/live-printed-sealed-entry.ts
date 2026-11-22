import { createElement as h } from 'react';
import { preparePrintedLimitedFormat } from '@mtg/draft-export';
import type { PreparedPrintedLimitedFormat } from '@mtg/draft-export';
import type { ObservedBackend } from '@mtg/engine';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import akh from '../../../data/data/akh-hou/akh-printed-catalog-v1.json';
import hou from '../../../data/data/akh-hou/hou-printed-catalog-v1.json';
import mp2 from '../../../data/data/akh-hou/mp2-printed-catalog-v1.json';
import format from '../../../data/data/akh-hou/akh-hou-limited-format-v1.json';
import { sha256Text } from '../../src/routes/analysis/calibration-read';
import { PrintedFormatRoute } from '../../src/routes/printed/PrintedFormatRoute';
import { modeParams, routeHash, useHashRoute } from '../../src/app/router';
import { mount } from '../../src/mount';

const catalogs = [akh, hou, mp2].map((catalog, index) => ({
  code: ['AKH', 'HOU', 'MP2'][index]!,
  catalog: parsePrintedCardCatalog(catalog),
}));
const backend: ObservedBackend = {
  id: 'akh-hou-browser-fixture',
  determinism: 'observed',
  capabilities: { undo: false, fork: false, perSeatProjection: true, engineSeats: true },
  supports: () => Promise.resolve([]),
  open: () =>
    Promise.resolve({
      ok: false,
      error: { kind: 'backend-failure', message: 'Browser layout fixture does not start Forge.' },
    }),
};

function Surface({ prepared }: { readonly prepared: PreparedPrintedLimitedFormat }) {
  const router = useHashRoute();
  return h(
    'main',
    { className: 'mtg-shell__main' },
    h(
      'a',
      { href: routeHash({ mode: 'customize', sub: 'decks', params: modeParams(router.route) }) },
      'Saved decks',
    ),
    h(PrintedFormatRoute, {
      state: {
        status: 'ready',
        value: {
          availability: {
            browse: 'available',
            draft: 'available',
            sealed: 'available',
            play: { status: 'supported', reason: 'Verified admission is installed.' },
          },
          prepared,
          catalogs,
          rarities: {},
          tokens: [],
        },
      },
      title: prepared.format.name,
      sourceCode: undefined,
      page: router.route.mode === 'play' ? router.route.sub : 'decks',
      route: router.route,
      onSetParams: router.setParams,
      backend,
    }),
  );
}

void preparePrintedLimitedFormat(format, [akh, hou, mp2], sha256Text).then(
  (prepared) => mount('root', h('div', { className: 'mtg-shell' }, h(Surface, { prepared }))),
  (cause: unknown) => mount('root', h('p', { role: 'alert' }, String(cause))),
);
