import { createElement as h, useState } from 'react';
import { parsePrintedCardCatalog, validatePrintedDisplayMetadata } from '@mtg/printed-card';
import akh from '../../../data/data/akh-hou/akh-printed-catalog-v1.json';
import hou from '../../../data/data/akh-hou/hou-printed-catalog-v1.json';
import mp2 from '../../../data/data/akh-hou/mp2-printed-catalog-v1.json';
import display from '../../../data/data/akh-hou/akh-hou-display-metadata-v1.json';
import { PrintedCardsGallery } from '../../src/routes/printed/PrintedCardsGallery';
import { mount } from '../../src/mount';

const catalogs = [akh, hou, mp2].map(parsePrintedCardCatalog);
const metadata = validatePrintedDisplayMetadata(display, catalogs);
const rarities = Object.fromEntries(metadata.catalogs.flatMap((row) => Object.entries(row.rarities)));
function Gallery() {
  const [params, setParams] = useState<Readonly<Record<string, string>>>({});
  return h(PrintedCardsGallery, {
    cards: catalogs.flatMap((catalog) => catalog.cards),
    rarities,
    title: 'Amonkhet / Hour of Devastation',
    description: 'Printed source cards',
    route: { mode: 'cards', sub: 'gallery', params },
    onSetParams: (next) => setParams({ ...params, ...next }),
  });
}
mount('root', h(Gallery));
