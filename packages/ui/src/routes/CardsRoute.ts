/**
 * Card view: every card in a set, narrowed to the ones being looked at.
 *
 * Three filters and a size, all held in the URL rather than in component state,
 * so a link to "the black commons that look wrong" is a link somebody else can
 * open.
 *
 * Full stays the default size on a route where 250 cards is a long scroll,
 * because PRODUCT.md makes Cards one of the two places where the card is the
 * thing a person came for rather than chrome around it. Compact is the index —
 * name, type line and a creature's stats, no art window and no rules box — and
 * the filters are what make the full gallery a workable length. The printing's
 * own line is not on either face now (`../card/anatomy.ts`, `FACE_REGIONS`): it
 * is in the description every face carries, so hovering a card in the gallery
 * says which printing it is.
 *
 * The filters are also the whole of this route's interaction, and every one of
 * them acts at a distance: a button in the toolbar changes the count line and
 * the gallery below it, and nothing at the button. So the count is a live
 * region, and each row of toggles is a named group rather than a loose run of
 * buttons beside a decorative word.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { Card as DslCard, CardKind, Rarity } from '@mtg/dsl';
import { CARD_KINDS, RARITIES, typeLineParts } from '@mtg/dsl';
import { Card } from '../card/Card';
import type { CardSize } from '../card/Card';
import type { CardArt } from '../card/ArtSlot';
import { cardColorIdentity } from '../card/identity';
import { renderCopy } from '../copy';
import { COLOR_IDENTITIES, IDENTITY_LABELS } from '../styles/tokens';
import type { ColorIdentity } from '../styles/tokens';
import type { UiRoute } from '../app/router';

/**
 * Where the cards below came from, when the caller knows (`mtg-ihtz`).
 *
 * The heading said "Cards" over whatever list it was handed, and `LabApp` hands
 * it the DSL example cards whenever the staged set is not `ready` — one frame
 * on load, and the whole life of a tab whose staged document failed to parse.
 * Seventeen example cards under the same heading as a 249-card generated set is
 * a page a reviewer cannot tell apart from the set they came to judge.
 *
 * The four states are `PlaySetState`'s, because they are the same fetch. What
 * this route does with them differs: `absent` draws its gallery and labels it,
 * since the example cards are worth looking at and nothing is minted from them,
 * while `loading` and `failed` draw no gallery at all. A list that arrives late
 * redraws harmlessly, but a list that is standing in for a set nobody can read
 * is a set being misreported for as long as the tab is open.
 *
 * Optional, because `tools/text-box.ts` and `tools/face-census.ts` render this
 * route over a card list they assembled and there is no staged set behind it.
 */
export type CardsSource =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly name: string | null }
  | { readonly status: 'absent' }
  | { readonly status: 'failed'; readonly message: string };

export interface CardsRouteProps {
  readonly cards: readonly DslCard[];
  readonly route: UiRoute;
  readonly onSetParams: (params: Readonly<Record<string, string>>) => void;
  /** Art lookup; returning `null` renders the labeled pending frame. */
  readonly artFor?: (card: DslCard) => CardArt | null;
  readonly source?: CardsSource;
}

/**
 * The two titles this route shows instead of a gallery.
 *
 * Word for word `PlayRoute`'s, and spelled again rather than imported: the two
 * routes read the same fetch and a person moving between tabs should meet the
 * same sentence about it, but a shared string module between them would make
 * one route's copy edit the other's, which is not a coupling either page wants.
 */
export const CARDS_LOADING_TITLE = 'Opening the set';
export const CARDS_UNREADABLE_TITLE = 'Could not read the staged set';

/** What the head says these cards are, or `null` when the caller did not say. */
function sourceLabel(source: CardsSource | undefined): string | null {
  if (source === undefined) return null;
  if (source.status === 'ready') return source.name ?? 'the staged set';
  if (source.status === 'absent') return 'DSL example cards, no set staged';
  return null;
}

interface SelectOption {
  readonly value: string;
  readonly label: string;
}

/**
 * The printed type word each DSL kind puts on a type line. An artifact creature
 * prints both of its words, which is what lets it answer to the Artifact filter
 * as well as the Creature one — a person asking for the artifacts means the
 * ones that say Artifact, not the ones whose discriminant happens to be it.
 */
const KIND_TYPE_WORD: Readonly<Record<CardKind, string>> = {
  creature: 'Creature',
  instant: 'Instant',
  sorcery: 'Sorcery',
  artifact: 'Artifact',
  land: 'Land',
  planeswalker: 'Planeswalker',
  enchantment: 'Enchantment',
};

const RARITY_LABELS: Readonly<Record<Rarity, string>> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  mythic: 'Mythic Rare',
};

/** The unset entry. Its empty value is what clears the parameter from the URL. */
const ANY: SelectOption = { value: '', label: 'Any' };

const RARITY_OPTIONS: readonly SelectOption[] = [
  ANY,
  ...RARITIES.map((rarity) => ({ value: rarity, label: RARITY_LABELS[rarity] })),
];

const TYPE_OPTIONS: readonly SelectOption[] = [
  ANY,
  ...CARD_KINDS.map((kind) => ({ value: kind, label: KIND_TYPE_WORD[kind] })),
];

/** A URL parameter narrowed to a known vocabulary; anything else reads as unset. */
function pick<T extends string>(allowed: readonly T[], raw: string): T | null {
  return allowed.find((value) => value === raw) ?? null;
}

/**
 * A row of toggles under one heading.
 *
 * The heading is the group's accessible name and is hidden from the accessible
 * tree in its own right, so it is announced once on entering the row rather
 * than as a stray word in front of the first button. Without the group the row
 * is what a screen reader met before: a run of pressed and unpressed buttons
 * with nothing saying what any of them narrows.
 */
function filterGroup(label: string, ...buttons: readonly ReactElement[]): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-filters', role: 'group', 'aria-label': label },
    createElement('span', { className: 'mtg-filters__label', 'aria-hidden': true }, label),
    ...buttons,
  );
}

function filterButton(
  identity: ColorIdentity | null,
  active: ColorIdentity | null,
  onPick: (next: ColorIdentity | null) => void,
): ReactElement {
  const key = identity ?? 'all';
  const label = identity === null ? 'All' : IDENTITY_LABELS[identity];
  const pressed = identity === active;
  return createElement(
    'button',
    {
      key,
      type: 'button',
      className: 'mtg-btn',
      'aria-pressed': pressed,
      onClick: () => {
        onPick(identity);
      },
    },
    identity === null
      ? label
      : createElement(
          'span',
          { className: 'mtg-field' },
          createElement('span', { className: 'mtg-swatch', 'data-identity': identity, 'aria-hidden': true }),
          label,
        ),
  );
}

function selectFilter(
  label: string,
  value: string,
  options: readonly SelectOption[],
  onPick: (next: string) => void,
): ReactElement {
  return createElement(
    'label',
    { className: 'mtg-field' },
    // The filter row's own micro-label rather than the field label the run
    // pickers use, so all four labels on this page read as one control block.
    createElement('span', { className: 'mtg-filters__label' }, label),
    createElement(
      'select',
      {
        className: 'mtg-select',
        value,
        onChange: (event: { target: { value: string } }) => {
          onPick(event.target.value);
        },
      },
      ...options.map((option) =>
        createElement('option', { key: option.label, value: option.value }, option.label),
      ),
    ),
  );
}

/**
 * The size control, in the identity filters' own grammar rather than a third
 * select: this is a two-way state a person flips back and forth, and a pressed
 * toggle shows which one is on without being opened.
 */
function sizeButton(size: CardSize, active: CardSize, onPick: (next: CardSize) => void): ReactElement {
  return createElement(
    'button',
    {
      key: size,
      type: 'button',
      className: 'mtg-btn',
      'aria-pressed': size === active,
      onClick: () => {
        onPick(size);
      },
    },
    size === 'full' ? 'Full' : 'Compact',
  );
}

/**
 * Nothing to show, and which of the two reasons it is.
 *
 * An empty gallery under an unset filter can only mean the route was handed no
 * cards, because Any/Any/All matches every card in the set. Both cases printed
 * "widen a filter", which is advice a person looking at an unfiltered empty set
 * cannot take: there is no filter to widen, and the thing to fix is upstream of
 * this page.
 */
function emptyState(hasCards: boolean): ReactElement {
  const [title, body] = hasCards
    ? [
        'No cards match these filters',
        'Nothing in the set matches this combination. Widen a filter to see cards again.',
      ]
    : [
        'No set loaded',
        'This view was handed no cards. `npm run play` stages a set at `packages/ui/public/set.json`.',
      ];
  return createElement(
    'div',
    { className: 'mtg-empty' },
    createElement('span', { className: 'mtg-empty__title' }, title),
    createElement('span', { className: 'mtg-empty__body' }, renderCopy(body)),
  );
}

/**
 * The page head, drawn in every state.
 *
 * `AnalysisRoute`'s argument for the same thing: a route that drops its heading
 * when it has nothing to draw leaves the document with no landmark and a person
 * reading the shell to work out where they are. The subject and the count are
 * separate spans because only one of them is a live region — the count is what a
 * filter press changes, and the set is not.
 */
function pageHead(subject: string | null, count: string | null): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-page-head' },
    createElement('h1', { className: 'mtg-page-title' }, 'Cards'),
    subject === null ? null : createElement('span', { className: 'mtg-page-note' }, subject),
    // The one place a filter reports what it did. `role="status"` is what
    // carries that to a reader who pressed the button without watching the
    // gallery redraw under it.
    count === null ? null : createElement('span', { className: 'mtg-page-note', role: 'status' }, count),
  );
}

/** No gallery, and which of the two reasons it is. `PlayRoute`'s notice. */
function notice(title: string, body: string): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-empty' },
    createElement('span', { className: 'mtg-empty__title' }, title),
    createElement('span', { className: 'mtg-empty__body', role: 'status' }, renderCopy(body)),
  );
}

function matches(
  card: DslCard,
  identity: ColorIdentity | null,
  rarity: Rarity | null,
  kind: CardKind | null,
): boolean {
  if (identity !== null && cardColorIdentity(card) !== identity) return false;
  if (rarity !== null && card.rarity !== rarity) return false;
  if (kind !== null && !typeLineParts(card).types.includes(KIND_TYPE_WORD[kind])) return false;
  return true;
}

export function CardsRoute(props: CardsRouteProps): ReactElement {
  const { cards, route, onSetParams, source } = props;
  // Nothing is drawn over a set that is still coming or that could not be read.
  // The gallery under either of those is the caller's stand-in list, and a
  // gallery is exactly the shape of the thing it is standing in for.
  if (source?.status === 'loading') {
    return createElement(
      'div',
      null,
      pageHead(null, null),
      notice(CARDS_LOADING_TITLE, 'Reading the staged set.'),
    );
  }
  if (source?.status === 'failed') {
    return createElement('div', null, pageHead(null, null), notice(CARDS_UNREADABLE_TITLE, source.message));
  }
  const identity = pick(COLOR_IDENTITIES, route.params['identity'] ?? '');
  const rarity = pick(RARITIES, route.params['rarity'] ?? '');
  const kind = pick(CARD_KINDS, route.params['type'] ?? '');
  const size: CardSize = route.params['size'] === 'compact' ? 'compact' : 'full';
  const selectedId = route.params['card'] ?? '';
  const visible = cards.filter((card) => matches(card, identity, rarity, kind));
  const artFor = props.artFor;

  const identityFilters = filterGroup(
    'Identity',
    filterButton(null, identity, () => {
      onSetParams({ identity: '' });
    }),
    ...COLOR_IDENTITIES.map((candidate) =>
      filterButton(candidate, identity, (next) => {
        onSetParams({ identity: next ?? '' });
      }),
    ),
  );

  const toolbar = createElement(
    'div',
    { className: 'mtg-toolbar' },
    selectFilter('Rarity', rarity ?? '', RARITY_OPTIONS, (next) => {
      onSetParams({ rarity: next });
    }),
    selectFilter('Type', kind ?? '', TYPE_OPTIONS, (next) => {
      onSetParams({ type: next });
    }),
    createElement('span', { className: 'mtg-toolbar__spacer' }),
    // Full is the default, so it writes the parameter away rather than in, and
    // the shared link of an unremarkable gallery carries no size at all.
    filterGroup(
      'Size',
      ...(['full', 'compact'] as const).map((candidate) =>
        sizeButton(candidate, size, (next) => {
          onSetParams({ size: next === 'full' ? '' : next });
        }),
      ),
    ),
  );

  const gallery =
    visible.length === 0
      ? emptyState(cards.length > 0)
      : createElement(
          'div',
          { className: 'mtg-gallery' },
          ...visible.map((card) =>
            createElement(Card, {
              key: card.id,
              card,
              size,
              art: artFor === undefined ? null : artFor(card),
              selected: card.id === selectedId,
              onSelect: () => {
                onSetParams({ card: card.id === selectedId ? '' : card.id });
              },
            }),
          ),
        );

  return createElement(
    'div',
    null,
    pageHead(sourceLabel(source), `${visible.length} of ${cards.length} shown`),
    identityFilters,
    toolbar,
    gallery,
  );
}
