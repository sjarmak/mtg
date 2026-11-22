/**
 * The Limited builder as `../../src/routes/printed/PrintedPoolEditor.ts` composes
 * it, mounted directly so the density of its chrome can be measured.
 *
 * The route this is standing in for is the finished printed draft, and the real
 * one costs 42 picks through three booster catalogs before it draws a pool
 * editor at all (`../lab/printed-draft.browser.test.ts` pays that). What
 * `mtg-84703` asks about is how much of the window the apparatus above the two
 * panes takes and how wide a face in each pane is drawn, and neither depends on
 * where the pool came from -- so the pool is the pinned Legacy Cube catalog and
 * the head, the banner and the bar are the editor's own, through the helpers it
 * exports.
 */
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
import { PLAY_AVAILABILITY_LABEL, printedPoolStatus } from '../../src/routes/printed/PrintedPoolEditor';

const catalog = parsePrintedCardCatalog(catalogJson);

/** Enough of the pinned cube to fill both panes with several columns. */
const cards = catalog.cards.slice(0, 40);

const presentation: LimitedCardPresentation<PrintedCardCatalogEntry> = {
  nameOf: (card) => card.name,
  groupingFactsOf: (card) => ({
    name: card.name,
    manaValue: card.manaValue,
    colorIdentity: card.colorIdentity.join(''),
    typeLine: card.typeLine,
    rarity: null,
  }),
  manaCostOf: (card) => card.manaCost,
  renderFace: (card, options) => h(PrintedCardFace, { ...options, card }),
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
    selectedPhysicalIds: prepared.slice(0, 12).map((card) => card.physicalId),
    basics: { Plains: 2, Island: 3, Swamp: 3, Mountain: 2, Forest: 2 },
    minimumDeckSize: 24,
    suggestedBasicLands: 12,
  };
}

function DensityRig(): ReturnType<typeof PhysicalLimitedBuilder<PrintedCardCatalogEntry>> {
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
    seed: 'isd/draft/bwge9gzhnwak',
    contextNote: '45 physical cards · rated against the set',
    poolLabel: 'Drafted pool',
    title: 'Draft complete · Innistrad',
    details: [
      {
        term: PLAY_AVAILABILITY_LABEL,
        value: 'Verified full-card and match interaction admission is installed.',
      },
    ],
    banner: printedPoolStatus({ saved: true, playError: null }),
  });
}

mount(
  'root',
  h('div', { className: 'mtg-shell' }, h('main', { className: 'mtg-shell__main' }, h(DensityRig))),
);
