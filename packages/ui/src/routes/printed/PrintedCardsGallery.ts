/** Browse the existing printed catalog without admitting its cards to the DSL engine. */
import { createElement as h, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { PrintedCardCatalogEntry } from '@mtg/printed-card';
import { PrintedRaritySchema } from '@mtg/printed-card';
import type { PrintedRarity } from '@mtg/printed-card';
import { FaceFlip } from '../../card/FaceFlip';
import { PrintedCardFace } from '../../card/PrintedCardFace';
import { groupMembers } from '../deck/grouping';
import { StripColumns } from '../deck/StripColumns';
import type { PrintedCardPresentation } from '../../card/printed-card-art';
import type { UiRoute } from '../../app/router';
const COLORS = ['White', 'Blue', 'Black', 'Red', 'Green', 'Colorless', 'Multicolor'];
const COLOR_CODES = ['W', 'U', 'B', 'R', 'G'];
const TYPES = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land'];

type GalleryCard = PrintedCardPresentation &
  Pick<PrintedCardCatalogEntry, 'manaCost' | 'manaValue' | 'oracleText' | 'colorIdentity'>;

interface Props {
  readonly cards: readonly GalleryCard[];
  readonly rarities?: Readonly<Record<string, PrintedRarity>>;
  readonly title: string;
  readonly description: string;
  readonly route: UiRoute;
  readonly onSetParams: (params: Readonly<Record<string, string>>) => void;
}

function select(
  label: string,
  value: string,
  options: readonly string[],
  change: (value: string) => void,
  includeAll = true,
): ReactElement {
  return h(
    'label',
    { className: 'mtg-field' },
    label,
    h(
      'select',
      {
        className: 'mtg-select',
        value,
        onChange: (event: { target: { value: string } }) => change(event.target.value),
      },
      includeAll ? h('option', { value: '' }, 'All') : null,
      ...options.map((option) => h('option', { key: option, value: option }, option)),
    ),
  );
}

/** All search and filter facts come from Oracle metadata, not inert layout carriers. */
export function matchesPrintedCard(card: GalleryCard, params: UiRoute['params']): boolean {
  const text = [
    card.name,
    card.typeLine,
    card.oracleText,
    ...card.faces.flatMap((face) => [face.name, face.typeLine, face.oracleText]),
  ]
    .join(' ')
    .toLowerCase();
  if (
    !(params['q'] ?? '')
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .every((word) => text.includes(word))
  )
    return false;
  const color = params['color'] ?? '';
  const code = COLOR_CODES[COLORS.indexOf(color)];
  if (code !== undefined && !card.colors.some((entry) => entry === code)) return false;
  if (color === 'Colorless' && card.colors.length !== 0) return false;
  if (color === 'Multicolor' && card.colors.length < 2) return false;
  const type = params['type'] ?? '';
  if (TYPES.includes(type) && !card.faces.some((face) => face.typeLine.split(/\s+/).includes(type)))
    return false;
  const mv = params['mv'] ?? '';
  return mv === '7+' ? card.manaValue >= 7 : !/^[0-6]$/.test(mv) || card.manaValue === Number(mv);
}

export function PrintedCardsGallery(props: Props): ReactElement {
  const [bankOpen, setBankOpen] = useState(false);
  const [faces, setFaces] = useState<Readonly<Record<string, number>>>({});
  const cards = props.cards;
  const hasRarities = Object.keys(props.rarities ?? {}).length > 0;
  const availableRarities = PrintedRaritySchema.options.filter((rarity) =>
    cards.some((card) => props.rarities?.[card.physicalId] === rarity),
  );
  const visible = useMemo(() => {
    const filtered = cards.filter(
      (card) =>
        matchesPrintedCard(card, props.route.params) &&
        (!hasRarities ||
          !props.route.params['rarity'] ||
          props.rarities?.[card.physicalId] === props.route.params['rarity']),
    );
    if (!hasRarities || props.route.params['sort'] !== 'Rarity') return filtered;
    const rank = (card: GalleryCard) => {
      const rarity = props.rarities?.[card.physicalId];
      return rarity === undefined
        ? PrintedRaritySchema.options.length
        : PrintedRaritySchema.options.indexOf(rarity);
    };
    return filtered.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        a.name.localeCompare(b.name, 'en') ||
        a.physicalId.localeCompare(b.physicalId, 'en'),
    );
  }, [cards, props.route.params, props.rarities, hasRarities]);
  const head = h(
    'div',
    { className: 'mtg-page-head' },
    h('h1', null, props.title),
    h('p', null, props.description),
  );
  const params = props.route.params;
  const size = params['size'] === 'compact' ? 'compact' : 'full';
  const controls = h(
    'div',
    { className: 'mtg-cardbar__bank', id: 'cube-card-filters', 'data-open': String(bankOpen) },
    select('Color', params['color'] ?? '', COLORS, (color) => props.onSetParams({ color })),
    select('Type', params['type'] ?? '', TYPES, (type) => props.onSetParams({ type })),
    !hasRarities
      ? null
      : select('Rarity', params['rarity'] ?? '', availableRarities, (rarity) =>
          props.onSetParams({ rarity }),
        ),
    !hasRarities
      ? null
      : select(
          'Sort',
          params['sort'] === 'Rarity' ? 'Rarity' : 'Catalog order',
          ['Catalog order', 'Rarity'],
          (sort) => props.onSetParams({ sort }),
          false,
        ),
    select('Mana value', params['mv'] ?? '', ['0', '1', '2', '3', '4', '5', '6', '7+'], (mv) =>
      props.onSetParams({ mv }),
    ),
    select('Size', size, ['full', 'compact'], (value) => props.onSetParams({ size: value }), false),
    h(
      'button',
      {
        type: 'button',
        className: 'mtg-btn',
        onClick: () => props.onSetParams({ q: '', color: '', type: '', mv: '', rarity: '', card: '' }),
      },
      'Clear filters',
    ),
  );
  return h(
    'div',
    null,
    head,
    h('p', { role: 'status', 'aria-live': 'polite' }, `${visible.length} of ${cards.length} shown`),
    h(
      'div',
      { className: 'mtg-cardbar' },
      h('input', {
        type: 'search',
        className: 'mtg-input mtg-cardbar__search',
        'aria-label': 'Search cards',
        placeholder: 'Name, type, or rules text',
        value: params['q'] ?? '',
        onChange: (event: { target: { value: string } }) => props.onSetParams({ q: event.target.value }),
      }),
      h(
        'button',
        {
          type: 'button',
          className: 'mtg-btn mtg-cardbar__toggle',
          'aria-expanded': bankOpen,
          'aria-controls': 'cube-card-filters',
          onClick: () => setBankOpen(!bankOpen),
        },
        'Filters',
      ),
      controls,
    ),
    visible.length === 0 ? h('p', null, 'No cards match these filters.') : null,
    size === 'compact'
      ? // Compact is titles and no pictures, drawn the way every deck and pool pane
        // draws it (`mtg-mxkrk`): name strips in mana-value columns.
        h(StripColumns<GalleryCard>, {
          groups: groupMembers(
            visible,
            (card) => ({
              name: card.name,
              manaValue: card.manaValue,
              colorIdentity: card.colorIdentity.join(''),
              typeLine: card.typeLine,
              rarity: props.rarities?.[card.physicalId] ?? card.rarity ?? null,
            }),
            () => 1,
            'manaValue',
          ),
          factsOf: (card) => ({
            key: card.physicalId,
            name: card.name,
            manaCost: card.manaCost,
            colorIdentity: card.colorIdentity.join(''),
            copies: 1,
          }),
          density: 'compact',
          selectedKey: `${params['card'] ?? ''}#1`,
          onSelect: (strip) =>
            props.onSetParams({
              card: params['card'] === strip.member.physicalId ? '' : strip.member.physicalId,
            }),
          label: 'Cards',
        })
      : h(
          'div',
          { className: 'mtg-gallery' },
          ...visible.map((card) => {
            const faceIndex = faces[card.physicalId] ?? 0;
            return h(
              'div',
              { key: card.physicalId },
              h(PrintedCardFace, {
                card: {
                  ...card,
                  ...(props.rarities?.[card.physicalId] === undefined
                    ? {}
                    : { rarity: props.rarities[card.physicalId] }),
                },
                faceIndex,
                size,
                deferArt: true,
                selected: params['card'] === card.physicalId,
                onSelect: () =>
                  props.onSetParams({ card: params['card'] === card.physicalId ? '' : card.physicalId }),
              }),
              h(FaceFlip, {
                cardName: card.name,
                faces: card.faces.map((face) => face.name),
                index: faceIndex,
                onFlip: (next) => setFaces({ ...faces, [card.physicalId]: next }),
              }),
            );
          }),
        ),
  );
}
