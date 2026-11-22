import { createElement as h } from 'react';
import format from '../../../data/data/scd/scd-constructed-format-v1.json';
import catalog from '../../../data/data/scd/scd-printed-catalog-v1.json';
import display from '../../../data/data/scd/scd-display-metadata-v1.json';
import tokens from '../../../data/data/scd/scd-token-printings-v1.json';
import { useHashRoute } from '../../src/app/router';
import { loadPrintedConstructedFormat } from '../../src/lab/printed-constructed-format';
import { mount } from '../../src/mount';
import { PrintedPreconRoute } from '../../src/routes/printed/PrintedPreconRoute';

const row = {
  id: 'scd',
  name: 'Starter Commander Decks 2022',
  kind: 'constructed',
  variant: 'commander',
  formatUrl: 'format.json',
  displayMetadataUrl: 'display.json',
  tokenPrintingsUrl: 'tokens.json',
  catalogs: [{ code: 'SCD', name: 'Starter Commander Decks 2022', url: 'catalog.json' }],
  availability: {
    browse: 'available',
    draft: 'unavailable',
    sealed: 'unavailable',
    play: { status: 'supported', reason: 'Verified admission is installed.' },
  },
};

const documents: Readonly<Record<string, unknown>> = {
  'format.json': format,
  'catalog.json': catalog,
  'display.json': display,
  'tokens.json': tokens,
};

function Surface({ loaded }: { readonly loaded: Awaited<ReturnType<typeof loadPrintedConstructedFormat>> }) {
  const router = useHashRoute();
  return h(
    'main',
    { className: 'mtg-shell__main' },
    h(PrintedPreconRoute, {
      loaded,
      title: row.name,
      sourceCode: undefined,
      page: 'commander',
      route: router.route,
      onSetParams: router.setParams,
    }),
  );
}

void loadPrintedConstructedFormat(row, (url) => Promise.resolve(documents[url])).then(
  (loaded) => mount('root', h('div', { className: 'mtg-shell' }, h(Surface, { loaded }))),
  (cause: unknown) => mount('root', h('p', { role: 'alert' }, String(cause))),
);
