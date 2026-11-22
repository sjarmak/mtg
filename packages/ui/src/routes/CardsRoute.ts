/**
 * Card view: every card in a set, narrowed to the ones being looked at.
 *
 * Four filters and a size, all held in the URL rather than in component state,
 * so a link to "the black commons that look wrong" is a link somebody else can
 * open. The search box is the exception and `searchField` says why.
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
 *
 * They are one bar rather than several. Identity sat in its own row above the
 * selects, which drew four labeled blocks stacked down the page under a heading
 * — the reader had to find which of them held the control they wanted before
 * they could use it. One sticky bar holds all of them and stays put while the
 * gallery scrolls, because the point of a filter is to change what is under it.
 *
 * On a phone that one bar is five rows. Measured at 390x844 over the flagship's
 * 371 cards on 2026-08-23 (`mtg-dcxg.9`): 321.6px of the route ran above the
 * first card, 62% of the window counted from the top of the glass, because
 * eight identity pills, the selects and a density pair are all on the touch
 * floor's 44px and nothing about 390px lets them share a line. So the bank sits
 * behind one control there, the way `./deck/SavedDecksPanel.ts`'s save controls
 * do, and search stays outside it because it is the narrowing that needs none of
 * the others. Which of the two states is drawn is decided by width in
 * `../styles/cards-mobile.ts` and not by anything here: the markup is the same
 * markup at every size, so a page rendered to static HTML is already collapsed
 * at 390px and the shut state cannot reach a screen with no control to undo it.
 *
 * There is a set filter here now (`mtg-tewc.8`), and the sentence it replaces
 * was true when it was written: this route was handed one set's cards and the
 * set was chosen in the header, so a picker offering "all sets" would have been
 * a control over a pool the route did not have. The launcher stages every set it
 * finds (`../lab/set-index.ts`), so the pool exists.
 *
 * What it does with that pool is one decision and it is deliberate. Browsing is
 * still one set — the set the header names, which is the set the lab is playing,
 * dealing and drafting, and 371 + 162 + 145 faces on open is not a browse
 * anybody asked for. *Searching* is the whole library: a person who types a word
 * into a card browser means every card the lab holds rather than the ones
 * belonging to whichever build the header happens to name, and a search that
 * stopped at the staged set would answer "no such card" about a card the lab is
 * holding. So an unfiltered search widens by itself and the head says it did.
 * Naming a set in this filter pins it either way, and *All sets* browses the
 * whole library outright.
 *
 * The filter is drawn from `../lab/set-origin.ts`'s grouping, the same taxonomy
 * the header's picker and every other set-aware surface reads, so *Custom* and
 * *Magic* are one decision rather than a heading each surface invents. The
 * header's picker keeps its own job: it says which set this tab and the rest of
 * the browsing tabs are reading, and this one says which cards are on this page.
 * Two controls because they answer two questions — narrowing the gallery to
 * Magic 2011 should not narrow the Customize tab's pool to it.
 *
 * Each face is painted by its *own* set's art resolver. Card ids are per-set and
 * nothing makes them unique across sets, so one resolver over a mixed gallery
 * does not merely fail to resolve — it can resolve the wrong picture for an id
 * two sets both print, which is the failure `LabApp`'s `useArt` clears its
 * resolver to avoid.
 */
import { createElement, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { Card as DslCard, CardKind, Rarity } from '@mtg/dsl';
import { CARD_KINDS, RARITIES, setBasics, setTokenCards, typeLineParts } from '@mtg/dsl';
import { Card } from '../card/Card';
import type { CardSize } from '../card/Card';
import type { CardArt } from '../card/ArtSlot';
import { cardColorIdentity } from '../card/identity';
import { renderCopy } from '../copy';
import { cardGroupingFacts, cardManaValue, cardStripFacts } from './deck/build';
import { groupMembers } from './deck/grouping';
import { StripColumns } from './deck/StripColumns';
import { WHOLE_POOL, filterPool, indexPool, withText } from './deck/pool-filter';
import { COLOR_IDENTITIES, IDENTITY_LABELS } from '../styles/tokens';
import type { ColorIdentity } from '../styles/tokens';
import { groupSetsByOrigin } from '../lab/set-origin';
import type { SetOrigin } from '../lab/set-origin';
import type { UiRoute } from '../app/router';
import { missingCards } from './cards/MissingCards';
import type { SetReduction } from '../lab/reduced-notice';

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

/**
 * One staged set, as this route needs it: enough to label it, group it, search
 * it and paint it.
 *
 * The stem rather than the set code is the identity, for `set-index.ts`'s own
 * reason: two rows can be builds of the same set — a generation run and the
 * committed fixture both call themselves XMP — and a filter that could not tell
 * them apart would be a filter that hides one.
 */
export interface CardsLibrarySet {
  readonly stem: string;
  readonly name: string;
  readonly origin: SetOrigin;
  readonly cards: readonly DslCard[];
  /** This set's own art lookup; `null` from it renders the pending frame. */
  readonly artFor?: (card: DslCard) => CardArt | null;
}

/**
 * Every set the lab has staged, in the order the picker draws them.
 *
 * Optional on the route, and its absence is the ordinary state of every caller
 * that is not the lab shell: `tools/text-box.ts` and `tools/face-census.ts`
 * render this route over a list they assembled, and a page staged by a launcher
 * older than the set index has no index to read. Those callers keep the
 * one-list route they always had, down to the absent set filter.
 */
export interface CardsLibrary {
  readonly sets: readonly CardsLibrarySet[];
  /**
   * The stem the header's picker is on, which is what an unset filter browses.
   * The route does not choose it: every other tab is already reading that set,
   * and a gallery that opened on a different one would be the picker lying.
   */
  readonly selected: string;
}

export interface CardsRouteProps {
  /**
   * The cards to draw when no library is given. With one, the pool is the
   * library — the shell passes both, and its `cards` is one member of its
   * `sets`, so nothing reads this twice.
   */
  readonly cards: readonly DslCard[];
  readonly library?: CardsLibrary;
  readonly route: UiRoute;
  readonly onSetParams: (params: Readonly<Record<string, string>>) => void;
  /** Art lookup; returning `null` renders the labeled pending frame. */
  readonly artFor?: (card: DslCard) => CardArt | null;
  readonly source?: CardsSource;
  /**
   * The staged set's reduction record, when it has one (`./cards/MissingCards.ts`).
   *
   * It belongs to the set the header names and to no other, so the list is drawn
   * only while the gallery is on that set: a reader who filtered to Magic 2011
   * should not be told what Magic 2013's build left out. Absent for every
   * ordinary set, which is the ordinary case rather than a failure.
   */
  readonly reduction?: SetReduction | null;
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

/**
 * What the head says the gallery is: the chosen set, the whole library, or the
 * caller's own statement about the one list it handed over.
 *
 * The library sentence counts sets rather than naming them, because three names
 * in the page head is a paragraph where a label goes, and the filter beside it
 * already lists them.
 */
function subject(
  source: CardsSource | undefined,
  sets: readonly CardsLibrarySet[],
  stem: string | null,
  selected: string | null,
): string | null {
  if (stem === null && sets.length > 1) return `every staged set, ${String(sets.length)} of them`;
  // The caller's own sentence wins for the set it is about. `source` is the
  // fetch of the header's set and carries that *document's* name; a library row
  // carries the index's, and the two can differ by a restaging.
  if (stem === null || stem === selected) return sourceLabel(source);
  return sets.find((set) => set.stem === stem)?.name ?? sourceLabel(source);
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
  battle: 'Battle',
};

const RARITY_LABELS: Readonly<Record<Rarity, string>> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  mythic: 'Mythic Rare',
};

/**
 * The unset entry, which names its own facet.
 *
 * Its empty value is what clears the parameter from the URL. The word is "Any
 * type" rather than "Any" because the micro-label above each select is drawn
 * only where there is room for it: on a phone the bar is three selects and
 * three of them reading "Any" is three controls with no names.
 */
function anyOf(facet: string): SelectOption {
  return { value: '', label: `Any ${facet}` };
}

const RARITY_OPTIONS: readonly SelectOption[] = [
  anyOf('rarity'),
  ...RARITIES.map((rarity) => ({ value: rarity, label: RARITY_LABELS[rarity] })),
];

const TYPE_OPTIONS: readonly SelectOption[] = [
  anyOf('type'),
  ...CARD_KINDS.map((kind) => ({ value: kind, label: KIND_TYPE_WORD[kind] })),
];

/**
 * The mana value bands, as a card search states them: every value the curve
 * separates, and one bucket for the top of it. Six and up is one band because a
 * set prints few cards there and a person asking for them means "the expensive
 * ones" rather than exactly six.
 */
const MANA_BANDS = ['0', '1', '2', '3', '4', '5', '6+'] as const;
type ManaBand = (typeof MANA_BANDS)[number];

const MANA_OPTIONS: readonly SelectOption[] = [
  anyOf('mana value'),
  ...MANA_BANDS.map((band) => ({ value: band, label: `MV ${band}` })),
];

/** What the search box narrows, said once for the label and the placeholder. */
export const CARDS_SEARCH_LABEL = 'Search cards';
const CARDS_SEARCH_PLACEHOLDER = 'Search cards…';
export const CARDS_CLEAR_LABEL = 'Clear filters';

/**
 * The set filter's accessible name, and the word above it.
 *
 * *In set* rather than *Set*, which is the word the row's grammar wants: the
 * header's picker is already named `Set` (`../app/SetPicker.ts`) and the two are
 * on screen together on this route, so a second control by that name is two
 * controls a screen reader cannot tell apart and a person cannot either. The
 * preposition also says which way this one points — it narrows what is below it,
 * where the header's decides which set this tab is reading.
 */
export const CARDS_SET_LABEL = 'In set';

/** The option that browses the whole library rather than one set. */
export const CARDS_ALL_SETS_LABEL = 'All sets';

/** Its parameter value. Not a stem, and no stem can be it: stems are directory names. */
export const CARDS_ALL_SETS = 'all';

/**
 * The control that opens the filter bank on a phone, and the count it carries.
 *
 * Measured at 390x844 over the flagship's 371 cards: the bank is five wrapped
 * rows of 44px controls and 321.6px of the route ran above the first card. It
 * is shut there and open everywhere else, decided by width in
 * `../styles/cards-mobile.ts` rather than by script here, so the same markup
 * serves both and a page rendered to static HTML is already collapsed at
 * 390px. The label says how many filters are on because a shut bank is the one
 * state in which the gallery is narrowed by something the reader cannot see.
 */
export const CARDS_FILTERS_LABEL = 'Filters';
const CARDS_FILTERS_ID = 'mtg-cards-filters';

/** `Filters`, or `Filters (2)` when two of them are narrowing the gallery. */
export function filtersLabel(active: number): string {
  return active === 0 ? CARDS_FILTERS_LABEL : `${CARDS_FILTERS_LABEL} (${String(active)})`;
}

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
      // Drawn as the pip a Magic player already reads and spoken as the word,
      // because seven spelled-out colors is the widest thing on the toolbar and
      // a filter row that wraps to three lines is the containeritis this pass
      // is removing. The swatch carries the color and the letter carries it
      // again, so the choice is never color alone.
      'aria-label': label,
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
          identity.toUpperCase(),
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
 * The set filter: one option for the whole library, then the staged sets under
 * their origin headings.
 *
 * `<optgroup>` for the reason `../app/SetPicker.ts` gives for the same list: it
 * is the platform's answer to the question `../lab/set-origin.ts` asks, it costs
 * the closed control no height, and on a phone it is the system's own sheet
 * drawing the headings. An origin with nothing staged under it is not drawn at
 * all, which `groupSetsByOrigin` already decides.
 */
function setFilter(
  value: string,
  sets: readonly CardsLibrarySet[],
  onPick: (next: string) => void,
): ReactElement {
  return createElement(
    'label',
    { className: 'mtg-field' },
    createElement('span', { className: 'mtg-filters__label' }, CARDS_SET_LABEL),
    createElement(
      'select',
      {
        className: 'mtg-select',
        value,
        onChange: (event: { target: { value: string } }) => {
          onPick(event.target.value);
        },
      },
      createElement('option', { key: 'all', value: CARDS_ALL_SETS }, CARDS_ALL_SETS_LABEL),
      ...groupSetsByOrigin(sets).map((group) =>
        createElement(
          'optgroup',
          { key: group.origin, label: group.label },
          ...group.rows.map((row) => createElement('option', { key: row.stem, value: row.stem }, row.name)),
        ),
      ),
    ),
  );
}

/**
 * The cards this route is drawing, and which set each of them came from.
 *
 * The owner map is keyed by the card object rather than by its id, because an id
 * is unique inside a set and nothing makes it unique across them. Built once per
 * library rather than per keystroke, beside the haystack index for the same
 * reason.
 *
 * "Cards" here is the set's *surfaces*, which is one more thing than its card
 * list: `setSurfaces` below says why, and what it costs.
 */
export interface CardsPool {
  readonly cards: readonly DslCard[];
  readonly owner: ReadonlyMap<DslCard, CardsLibrarySet>;
}

/**
 * One set as this gallery browses it: its printed cards, then the tokens they
 * create and the five basics it is played with.
 *
 * A set's art run covers all three — the art pipeline's `artSurfaces` is that same
 * walk, and the art pipeline's governance check fails a set that leaves one of them pending —
 * and this route drew only the first. So of the flagship's 405 illustrations,
 * 33 could be seen only if a game happened to mint one, which is how token art
 * that had already been bought came to be reported missing.
 *
 * Minted through `setTokenCards` and `setBasics` rather than derived here, for
 * the reason `@mtg/dsl`'s `tokenCard` gives: those are the functions the
 * manifest is keyed by and the renderer resolves through, so the id this
 * gallery asks a picture for cannot be derived apart from the id it is filed
 * under.
 *
 * They are appended rather than mixed in, so the printed cards keep the
 * collector order the document lists them in and the additions read as what
 * they are: the things the set is played with, after the things it prints.
 *
 * Over a *staged set* only, which is the library arm below. The other arm is a
 * bare list handed to the route with no index behind it — the DSL examples on a
 * lab with nothing staged — and that is a stand-in rather than a set: it is
 * played with nothing, so it is played with no basics, and minting five for it
 * would put Plains in a gallery of examples.
 */
function setSurfaces(cards: readonly DslCard[]): readonly DslCard[] {
  return [...cards, ...setTokenCards(cards), ...setBasics(cards)];
}

export function cardsPool(cards: readonly DslCard[], library: CardsLibrary | undefined): CardsPool {
  if (library === undefined) return { cards, owner: new Map() };
  const owner = new Map<DslCard, CardsLibrarySet>();
  const all: DslCard[] = [];
  for (const set of library.sets) {
    for (const card of setSurfaces(set.cards)) {
      owner.set(card, set);
      all.push(card);
    }
  }
  return { cards: all, owner };
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

/** A card's mana value against one band. The top band is a floor, not a value. */
function inBand(card: DslCard, band: ManaBand): boolean {
  const value = cardManaValue(card);
  return band === '6+' ? value >= 6 : value === Number(band);
}

interface CardFilters {
  readonly identity: ColorIdentity | null;
  readonly rarity: Rarity | null;
  readonly kind: CardKind | null;
  readonly band: ManaBand | null;
}

function matches(card: DslCard, filters: CardFilters): boolean {
  const { identity, rarity, kind, band } = filters;
  if (identity !== null && cardColorIdentity(card) !== identity) return false;
  if (rarity !== null && card.rarity !== rarity) return false;
  if (kind !== null && !typeLineParts(card).types.includes(KIND_TYPE_WORD[kind])) return false;
  if (band !== null && !inBand(card, band)) return false;
  return true;
}

/**
 * The search box.
 *
 * Its text is the one narrowing this route keeps out of the URL, and the reason
 * is the router: `setParams` assigns `location.hash`, so a parameter written on
 * every keystroke leaves one history entry per letter and the back button walks
 * a person through "gobli", "gobl", "gob". The four filters beside it are single
 * presses and stay linkable, which is what the page's shareable state is for.
 */
function searchField(value: string, onSearch: (next: string) => void): ReactElement {
  return createElement(
    'label',
    { className: 'mtg-field mtg-cardbar__search' },
    createElement('span', { className: 'mtg-filters__label' }, CARDS_SEARCH_LABEL),
    createElement('input', {
      type: 'search',
      className: 'mtg-input',
      value,
      placeholder: CARDS_SEARCH_PLACEHOLDER,
      onChange: (event: { readonly target: { readonly value: string } }): void => {
        onSearch(event.target.value);
      },
    }),
  );
}

export function CardsRoute(props: CardsRouteProps): ReactElement {
  const { cards, library, route, onSetParams, source } = props;
  const [query, setQuery] = useState('');
  // Shut, because the only width at which this is read is the one where the
  // bank costs five rows; `../styles/cards-mobile.ts` draws it open at every
  // other width and never draws the control that would shut it.
  const [bankOpen, setBankOpen] = useState(false);
  // The haystack per card is built once per set rather than once per keystroke;
  // it is the pool document's own index (`./deck/pool-filter.ts`), so a word
  // typed here finds what the same word finds in the deck builder.
  // Over the whole library when there is one: the pool a search runs against is
  // every staged set, and narrowing to a single set happens below, on the entries
  // rather than on the index. Indexing per selection would rebuild the haystacks
  // every time the filter moved.
  const pool = useMemo(() => cardsPool(cards, library), [cards, library]);
  const entries = useMemo(() => indexPool(pool.cards), [pool]);
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
  const band = pick(MANA_BANDS, route.params['mv'] ?? '');
  const size: CardSize = route.params['size'] === 'compact' ? 'compact' : 'full';
  const selectedId = route.params['card'] ?? '';
  const filters: CardFilters = { identity, rarity, kind, band };
  const librarySets = library?.sets ?? [];
  // A stem the library no longer lists reads as unset, the way every other
  // parameter on this route does: a link shared before a restaging opens on the
  // set the header is on rather than on an empty gallery.
  const asked = route.params['set'] ?? '';
  const pinned = pick(
    librarySets.map((set) => set.stem),
    asked,
  );
  const searching = query.trim() !== '';
  // Widened either because somebody asked for the whole library, or because they
  // searched without pinning a set and the answer is not in one set to give.
  const spanning = librarySets.length > 1 && (asked === CARDS_ALL_SETS || (pinned === null && searching));
  const stem = spanning ? null : (pinned ?? library?.selected ?? null);
  const narrowed =
    searching || identity !== null || rarity !== null || kind !== null || band !== null || asked !== '';
  const inSet = (card: DslCard): boolean => stem === null || pool.owner.get(card)?.stem === stem;
  const visible = filterPool(entries, withText(WHOLE_POOL, query))
    .map((entry) => entry.card)
    .filter((card) => matches(card, filters) && inSet(card));
  const poolSize = stem === null ? pool.cards.length : pool.cards.filter(inSet).length;
  const routeArt = props.artFor;
  // Its own set's resolver, never the shell's, whenever the card came from the
  // library: an id two sets both print would otherwise be painted with whichever
  // manifest the header happens to hold.
  const artFor = (card: DslCard): CardArt | null => {
    const set = pool.owner.get(card);
    if (set !== undefined) return set.artFor === undefined ? null : set.artFor(card);
    return routeArt === undefined ? null : routeArt(card);
  };

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

  // The filters themselves, as one element rather than six siblings. It is
  // `display: contents` above a phone, so the bar below is laid out exactly as
  // it was when these were its own children; at 390px it is the block that goes
  // behind the toggle (`../styles/cards-mobile.ts`).
  const activeFilters =
    [identity, rarity, kind, band].filter((value) => value !== null).length + (asked === '' ? 0 : 1);
  const bank = createElement(
    'div',
    { className: 'mtg-cardbar__bank', id: CARDS_FILTERS_ID, 'data-open': bankOpen ? 'true' : 'false' },
    // First, because it is the widest narrowing on the bar: every other control
    // acts inside whatever this one left.
    librarySets.length === 0
      ? null
      : setFilter(spanning ? CARDS_ALL_SETS : (stem ?? CARDS_ALL_SETS), librarySets, (next) => {
          onSetParams({ set: next });
        }),
    identityFilters,
    selectFilter('Type', kind ?? '', TYPE_OPTIONS, (next) => {
      onSetParams({ type: next });
    }),
    selectFilter('Rarity', rarity ?? '', RARITY_OPTIONS, (next) => {
      onSetParams({ rarity: next });
    }),
    selectFilter('Mana value', band ?? '', MANA_OPTIONS, (next) => {
      onSetParams({ mv: next });
    }),
    createElement('span', { className: 'mtg-toolbar__spacer' }),
    narrowed
      ? createElement(
          'button',
          {
            type: 'button',
            className: 'mtg-btn',
            onClick: (): void => {
              setQuery('');
              onSetParams({ identity: '', rarity: '', type: '', mv: '', set: '' });
            },
          },
          CARDS_CLEAR_LABEL,
        )
      : null,
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

  // One bar: the search and the control that opens the rest, then the rest.
  // Above a phone the bank is `display: contents` and the toggle is not drawn,
  // so this is the same single wrapping line it has always been.
  const toolbar = createElement(
    'div',
    { className: 'mtg-cardbar' },
    searchField(query, setQuery),
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-btn mtg-cardbar__toggle',
        'aria-expanded': bankOpen,
        'aria-controls': CARDS_FILTERS_ID,
        onClick: (): void => {
          setBankOpen(!bankOpen);
        },
      },
      filtersLabel(activeFilters),
    ),
    bank,
  );

  // Only over the set the reduction is about: unset or pinned to the header's
  // own set, never over the widened library.
  const onOwnSet = !spanning && (stem === null || stem === (library?.selected ?? stem));
  const missing = onOwnSet ? missingCards(props.reduction ?? null, query, rarity) : null;

  // Qualified by the set, because a card id is unique inside a set and nothing
  // makes it unique across them.
  const cardKey = (card: DslCard): string => `${pool.owner.get(card)?.stem ?? ''}:${card.id}`;
  const selectedCard = visible.find((card) => card.id === selectedId);

  const gallery =
    visible.length === 0
      ? emptyState(pool.cards.length > 0)
      : size === 'compact'
        ? // Compact is titles and no pictures, drawn the way every deck and pool
          // pane draws it (`mtg-mxkrk`): name strips in mana-value columns, not a
          // second small card-shaped tile under the same word.
          createElement(StripColumns<DslCard>, {
            groups: groupMembers(visible, cardGroupingFacts, () => 1, 'manaValue'),
            factsOf: (card: DslCard) => cardStripFacts(card, cardKey(card), 1),
            density: 'compact',
            selectedKey: selectedCard === undefined ? undefined : `${cardKey(selectedCard)}#1`,
            onSelect: (strip) => {
              onSetParams({ card: strip.member.id === selectedId ? '' : strip.member.id });
            },
            label: 'Cards',
          })
        : createElement(
            'div',
            { className: 'mtg-gallery' },
            ...visible.map((card) =>
              createElement(Card, {
                key: cardKey(card),
                card,
                size,
                art: artFor(card),
                // A whole library of faces at once: the browser fetches the
                // pictures it is showing rather than all of them (`mtg-xkuq`).
                deferArt: true,
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
    pageHead(
      subject(source, librarySets, stem, library?.selected ?? null),
      `${visible.length} of ${poolSize} shown`,
    ),
    toolbar,
    missing,
    gallery,
  );
}
