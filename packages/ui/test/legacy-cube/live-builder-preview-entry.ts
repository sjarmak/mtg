import { createElement as h, useState } from 'react';
import { addPhysicalCard, cutPhysicalCard, validateLimitedDeck } from '@mtg/limited';
import type { LimitedDeck } from '@mtg/limited';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import type { PrintedCardCatalogEntry } from '@mtg/printed-card';
import catalogJson from '../../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { PrintedCardFace } from '../../src/card/PrintedCardFace';
import { mount } from '../../src/mount';
import { PhysicalLimitedBuilder } from '../../src/routes/play/SealedBuilder';
import type { LimitedCardPresentation } from '../../src/routes/play/SealedBuilder';

const catalog = parsePrintedCardCatalog(catalogJson);

function requiredCard(name: string): PrintedCardCatalogEntry {
  const card = catalog.cards.find((candidate) => candidate.name === name);
  if (card === undefined) throw new Error(`the pinned catalog is missing ${name}`);
  return card;
}

const cards = [
  ...catalog.cards.slice(0, 3),
  ...[
    'Jace, the Mind Sculptor',
    "Vivien, Monsters' Advocate",
    'Nicol Bolas, Planeswalker',
    'Frost Titan',
    'Fatal Push',
    'Remand',
    'Glen Elendra Archmage',
  ].map(requiredCard),
];

function facts(card: PrintedCardCatalogEntry) {
  return {
    name: card.name,
    manaValue: card.manaValue,
    colorIdentity: card.colorIdentity.join(''),
    typeLine: card.typeLine,
    rarity: null,
  } as const;
}

const presentation: LimitedCardPresentation<PrintedCardCatalogEntry> = {
  nameOf: (card) => card.name,
  groupingFactsOf: facts,
  manaCostOf: (card) => card.manaCost,
  renderFace: (card, options) =>
    h(PrintedCardFace, {
      ...(options.physicalId === undefined ? {} : { physicalId: options.physicalId }),
      ...(options.key === undefined ? {} : { key: options.key }),
      card,
      size: options.size,
      ...(options.selected === undefined ? {} : { selected: options.selected }),
      ...(options.deferArt === undefined ? {} : { deferArt: options.deferArt }),
      ...(options.onSelect === undefined ? {} : { onSelect: options.onSelect }),
      ...(options.onActivate === undefined ? {} : { onActivate: options.onActivate }),
      ...(options.onMenu === undefined ? {} : { onMenu: options.onMenu }),
    }),
};

function initialDeck(): LimitedDeck<PrintedCardCatalogEntry> {
  const prepared = cards.map((card) => ({
    physicalId: card.physicalId,
    payload: card,
    facts: {
      name: card.name,
      colors: card.colors,
      manaValue: card.manaValue,
      type: card.typeLine.includes('Creature') ? ('creature' as const) : ('noncreature-spell' as const),
      score: 1,
    },
  }));
  return {
    pool: prepared,
    selectedPhysicalIds: prepared.slice(0, 2).map((card) => card.physicalId),
    basics: { Plains: 0, Island: 0, Swamp: 0, Mountain: 0, Forest: 0 },
    minimumDeckSize: 2,
    suggestedBasicLands: 0,
  };
}

function PreviewRig(): ReturnType<typeof PhysicalLimitedBuilder<PrintedCardCatalogEntry>> {
  const [deck, setDeck] = useState(initialDeck);
  return h(PhysicalLimitedBuilder<PrintedCardCatalogEntry>, {
    physicalDeck: deck,
    report: validateLimitedDeck(deck),
    presentation,
    onToggle: (physicalId) =>
      setDeck((current) =>
        current.selectedPhysicalIds.includes(physicalId)
          ? cutPhysicalCard(current, physicalId)
          : addPhysicalCard(current, physicalId),
      ),
    onSuggest: (): void => undefined,
    onClear: (): void => undefined,
    onAdjustBasic: (): void => undefined,
    onSuggestBasics: (): void => undefined,
    onPlay: (): void => undefined,
    seed: 'preview-rig',
    contextNote: 'Browser preview fixture.',
    poolLabel: 'Drafted pool',
  });
}

mount(
  'root',
  h('div', { className: 'mtg-shell' }, h('main', { className: 'mtg-shell__main' }, h(PreviewRig))),
);
