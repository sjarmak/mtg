/**
 * Deck view: a built deck, its real card art, and the mana base it was built to.
 *
 * The deck arrives as a staged JSON document rather than through a query,
 * because the store is 656 MB of SQLite behind `better-sqlite3` and a browser
 * has no business opening it. `npm run lab` does the reading; this reads a
 * static file. It is the same arrangement `npm run play` uses for a set, for
 * the same reason, and it is why this page needs no API key and no server.
 *
 * Absent and broken are different states and are shown differently. A checkout
 * that has never run `npm run lab` gets an instruction; a document that failed
 * the schema gets the field that failed. Neither is a blank page.
 */
import { createElement, useState } from 'react';
import type { ReactElement } from 'react';
import type { Card as DslCard } from '@mtg/dsl';
import { assertNever } from '@mtg/dsl';
import type { PreconFile } from '@mtg/deckbuild';
import { buildPrecon } from '@mtg/deckbuild';
import { renderCopy } from '../copy';
import { Card } from '../card/Card';
import type { DeckArtifact, DeckArtifactEntry } from '../lab/deck-artifact';
// A column's mana value is drawn as a pip through the registry the card face and
// the tile's own cost already read, so this adds no vocabulary to the page.
import { symbolizeLine } from '../card/SymbolText';
// `integer` is the analysis route's thousands-separated formatter, not a new
// one: the deck route reports the same kind of number (a whole count) and
// reuses it rather than printing the universe size unformatted.
import { integer } from './analysis';
import { columnLabel, curveLabel, manaValueColumns, manaValueGroups } from './deck/columns';
import { deckTypeCounts, typeCountsLine } from './deck/type-counts';
import type { DeckColumn, ManaValueGroup } from './deck/columns';
import { cardManaValue } from './deck/build';
import { ConstructedGame } from './deck/ConstructedGame';
import { DeckTile } from './deck/DeckTile';
import { ManaBasePanel } from './deck/ManaBasePanel';
import { DeckViewControl, useDeckViewMode } from './deck/view-mode';
import type { DeckViewMode } from './deck/view-mode';
import type { PositionArt } from './play/position';
import { preconFacts } from './play/precon-facts';

export type DeckState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly deck: DeckArtifact }
  | { readonly status: 'absent' }
  | { readonly status: 'failed'; readonly message: string };

export interface DeckRouteProps {
  readonly state: DeckState;
  readonly precons?:
    | { readonly status: 'loading' | 'absent' }
    | { readonly status: 'failed'; readonly message: string }
    | { readonly status: 'ready'; readonly file: PreconFile };
  readonly cards?: readonly DslCard[];
  readonly artFor?: PositionArt;
}

/**
 * Which deck the library is showing.
 *
 * `'build'` is the odd one and deliberately sits in the same list: building a
 * deck out of the playable cards is a way of arriving at a deck, so it belongs
 * beside the decks somebody already has rather than on a page of its own. It
 * carries no id because there is one builder and it holds its own state.
 */
type LibrarySelection =
  | { readonly kind: 'database' }
  | { readonly kind: 'precon'; readonly id: string }
  | { readonly kind: 'build' };

/** The Decks tab's entry to the Constructed builder. */
export const BUILD_LABEL = 'Build a deck';

/**
 * The two panes, named as the capture names them and cased as this page cases a
 * heading — `Mana base` sits in the same column of headings, and the sheet
 * uppercases all of them anyway.
 */
export const MAIN_DECK_LABEL = 'Main deck';
export const SIDEBOARD_LABEL = 'Sideboard';

/**
 * What a pane holding nothing says, in its own words rather than as a zero.
 *
 * `../board/ZoneBrowser.ts`'s register: lowercase, terse, a fact about this zone
 * rather than an apology. An empty sideboard is an ordinary deck — a limited
 * deck built out of a small pool leaves nothing over — so the sentence states it
 * and does not suggest a command or blame a build.
 */
export const SIDEBOARD_EMPTY_TEXT = 'nothing set aside';
export const MAIN_DECK_EMPTY_TEXT = 'no cards';

function empty(title: string, body: string): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-empty' },
    createElement('span', { className: 'mtg-empty__title' }, title),
    createElement('span', { className: 'mtg-empty__body' }, renderCopy(body)),
  );
}

interface DeckSectionProps {
  /** The store key's stable half. Deliberately not derived from `title`. */
  readonly pane: string;
  /** What the pane is called when it is spoken: `Main deck`. */
  readonly name: string;
  /** What its heading prints: the name and its count, as the capture writes it. */
  readonly title: string;
  /** The stats line. Empty draws no note at all rather than an empty span. */
  readonly note: string;
  readonly entries: readonly DeckArtifactEntry[];
  readonly omit: readonly string[];
  /** Drawn where the cards would be when the pane holds none. */
  readonly emptyText: string;
}

/**
 * One column of a compact pane: its mana value, its card count, and its tiles.
 *
 * The head is drawn only when the pane has more than one column, and the reason
 * is the rule this route already keeps for the mana base ("says the land count
 * once instead of twice in consecutive sentences"). A pane with one column has a
 * column count that is its pane count by construction, and the pane states that
 * number three lines above in its own note. A count exists to be compared with
 * the counts beside it and to sum to the pane; with one column there is nothing
 * to compare and the sum is a number already on the screen.
 *
 * A column holding one card keeps its head. That is the opposite call and the
 * same reason: it has neighbors, so its number is doing both jobs.
 */
function DeckColumnGroup(props: {
  readonly column: DeckColumn;
  readonly omit: readonly string[];
  readonly headed: boolean;
}): ReactElement {
  const { column, omit, headed } = props;
  return createElement(
    'div',
    { className: 'mtg-deck__column', role: 'group', 'aria-label': columnLabel(column) },
    headed
      ? createElement(
          'span',
          { className: 'mtg-deck__column-head', 'aria-hidden': true },
          createElement(
            'span',
            { className: 'mtg-deck__column-value' },
            ...symbolizeLine(`{${String(column.manaValue)}}`),
          ),
          createElement('span', { className: 'mtg-deck__column-count' }, String(column.cards)),
        )
      : null,
    ...column.entries.map((entry) =>
      createElement(DeckTile, { key: entry.name, entry, omit, mode: 'compact' as const }),
    ),
  );
}

/**
 * A pane's cards, laid out for the density it is drawn at.
 *
 * Columns are a **compact** layout and deliberately not a full one. A column's
 * whole job is to make the curve readable at a glance, which needs six of them
 * side by side; a full tile is a picture, a type line and a paragraph of
 * reasoning, and six of those do not fit any viewport this was measured at — the
 * flat full grid already falls to three tracks at 810px on its own. So "full plus
 * columns" is a shape that cannot deliver what columns are for, and compact is
 * not a prerequisite to them so much as the only density at which a column means
 * anything. That is also what the capture shows: its columns are strips, and the
 * one card per column drawn full is the exception that proves the strips are the
 * mode.
 *
 * The pane's View control therefore now switches between two readings rather than
 * two sizes — the deck's argument one card at a time, or its curve all at once.
 */
function paneBody(
  mode: DeckViewMode,
  entries: readonly DeckArtifactEntry[],
  omit: readonly string[],
): ReactElement {
  if (mode === 'full') {
    const sorted = manaValueColumns(entries).flatMap((column) => column.entries);
    return createElement(
      'div',
      { className: 'mtg-deck__grid', 'data-view': mode },
      ...sorted.map((entry) => createElement(DeckTile, { key: entry.name, entry, omit, mode })),
    );
  }
  const columns = manaValueColumns(entries);
  return createElement(
    'div',
    {
      className: 'mtg-deck__grid',
      'data-view': mode,
      // Written here rather than in the sheet because the track count is data.
      // The track's own shape is the sheet's (`../styles/deck.ts` argues the cap
      // and the zero floor); only the repetition is repeated here.
      style: { gridTemplateColumns: `repeat(${String(columns.length)}, minmax(0, 13rem))` },
    },
    ...columns.map((column) =>
      createElement(DeckColumnGroup, {
        key: String(column.manaValue),
        column,
        omit,
        headed: columns.length > 1,
      }),
    ),
  );
}

/**
 * One pane of cards, with its own density control.
 *
 * A component rather than the function this used to be, because the density is
 * per pane (`./deck/view-mode.ts` argues why, out of the MTGO capture) and a
 * per-pane preference needs per-pane state. The pane's identity is passed in
 * rather than slugged off `title`: the title is copy, a copy edit is a thing
 * somebody does without thinking about storage, and deriving the key from it
 * would silently discard the reader's choice the first time one is reworded.
 */
function DeckSection(props: DeckSectionProps): ReactElement {
  const { pane, name, title, note, entries, omit, emptyText } = props;
  const view = useDeckViewMode(pane);
  return createElement(
    'section',
    { className: 'mtg-deck__section' },
    createElement(
      'div',
      { className: 'mtg-deck__section-head' },
      createElement('h2', { className: 'mtg-deck__section-title' }, title),
      note === '' ? null : createElement('span', { className: 'mtg-deck__section-note' }, note),
      // The control is named for the pane, not titled with it: the title now
      // carries a count, and "Main deck: 60, View" is a control that renames
      // itself every time somebody cuts a card.
      createElement(DeckViewControl, { pane: name, state: view }),
    ),
    entries.length === 0
      ? createElement('span', { className: 'mtg-deck__empty' }, emptyText)
      : paneBody(view.mode, entries, omit),
  );
}

/**
 * The criteria every card in the deck cites.
 *
 * A criterion the whole deck satisfies is true of each card and distinguishing
 * of none, so repeating it on every tile costs a row and pays nothing. It is
 * still the deck's argument, so it is stated once above the cards rather than
 * dropped: what a tile keeps is the part that is only true of that card.
 *
 * Fewer than two citing entries has no shared set worth naming, because "shared
 * across one card" is just that card's own list.
 */
function sharedCriteria(entries: readonly DeckArtifactEntry[]): readonly string[] {
  const citing = entries.filter((entry) => entry.criteria.length > 0);
  const first = citing[0];
  if (first === undefined || citing.length < 2) return [];
  return first.criteria.filter((id) => citing.every((entry) => entry.criteria.includes(id)));
}

/** `['a','b','c']` → `'a, b and c'`. */
export function listPhrase(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${String(items[items.length - 1])}`;
}

function countOf(entries: readonly DeckArtifactEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.count, 0);
}

/** `Main deck: 60` — the capture's own shape: what the pane is, then what it holds. */
function paneTitle(name: string, entries: readonly DeckArtifactEntry[]): string {
  return `${name}: ${String(countOf(entries))}`;
}

/**
 * The deck's cards, split the way the person reading them splits them.
 *
 * `mtg-o5z1`. This page used to split its cards three ways by card class —
 * Spells, Nonbasic lands, Basics — and `references/mtgo+interface+(1)-3169202701.png`
 * splits them two ways by where they are: `Main Deck: 60` and `Sideboard: 15`,
 * each a pane with its own header bar carrying its own count. Class is a true
 * thing about a card and the wrong axis for this page, because nobody ever moves
 * a card from Spells to Basics; the move a deck builder makes all day is between
 * the deck and the cards set aside beside it.
 *
 * Merging the three panes into one pays for itself twice. `./deck/columns.ts`
 * groups a pane by mana value and a land's is 0, so the lands now sit in the
 * leftmost column under a header bar that says `Lands: 24` — which is exactly
 * what the capture shows, and what that file's "# Lands" section previously had
 * to explain away as a column with a pane to itself. And the per-pane density
 * `./deck/view-mode.ts` argues for now switches between the deck and the board
 * rather than between the spells and their Mountains.
 *
 * The cost is real and is not recovered: the lands and the spells can no longer
 * be read at two different densities, because they are one pane. That ability
 * went with the pane it belonged to, and the pane was the wrong one.
 *
 * The sideboard pane is drawn only when the document carries the field, empty or
 * not — `../lab/deck-artifact.ts` argues why absent and empty are different
 * claims, and `@mtg/decklab` makes the absent one.
 *
 * **The mana base is drawn under the cards, not over them** (`mtg-o7wr`). It sat
 * above, and `../../tools/deck-density.ts` in chrome-headless-shell measured what
 * that cost: the first card tile's top was at y=906 in a 900px viewport and at
 * y=948 in a 768px one, so the count of tiles fully on screen when the page
 * opened was **zero at every viewport, in both densities** — a deck page that
 * shows no cards until you scroll. The split panes did not fix it and were not
 * going to: the deck's own prose is 245px, the plan paragraph 113px, the shared
 * criteria 38px and the mana base 384px, and the tiles start after all four.
 * Only the last one is a summary of the cards rather than part of reading them,
 * so it is the one that moves. Ordering by what the reader came for also matches
 * the capture, which opens on the panes and nothing else.
 */
function deckBody(deck: DeckArtifact): ReactElement {
  const main = [...deck.spells, ...deck.lands, ...deck.basics];
  const { sideboard } = deck;
  const shared = sharedCriteria([...main, ...(sideboard ?? [])]);
  return createElement(
    'div',
    { className: 'mtg-deck' },
    deck.plan === '' ? null : createElement('p', { className: 'mtg-deck__plan' }, deck.plan),
    shared.length === 0
      ? null
      : createElement(
          'p',
          { className: 'mtg-deck__shared' },
          `Every card here satisfies ${listPhrase(shared)}. A card's own line names only what is additionally true of it.`,
        ),
    createElement(
      'div',
      {
        className: 'mtg-deck__panes',
        // The track count is data, the same way the columns' is: a page that
        // was told about a sideboard lays out two panes and one that was not
        // lays out one, and the sheet must not guess which from a child count.
        'data-panes': String(sideboard === undefined ? 1 : 2),
      },
      createElement(DeckSection, {
        pane: 'main-deck',
        name: MAIN_DECK_LABEL,
        title: paneTitle(MAIN_DECK_LABEL, main),
        // The universe clause stays with the cards it describes — the pool the
        // spells and the nonbasic lands were chosen out of. The basics in this
        // pane were never in it; they are arithmetic, and their own tiles say so.
        note: `${typeCountsLine(deckTypeCounts(main))} · chosen from the ${integer(deck.universeSize)} the criteria allow`,
        entries: main,
        omit: shared,
        emptyText: MAIN_DECK_EMPTY_TEXT,
      }),
      sideboard === undefined
        ? null
        : createElement(DeckSection, {
            pane: 'sideboard',
            name: SIDEBOARD_LABEL,
            title: paneTitle(SIDEBOARD_LABEL, sideboard),
            note: typeCountsLine(deckTypeCounts(sideboard)),
            entries: sideboard,
            omit: shared,
            emptyText: SIDEBOARD_EMPTY_TEXT,
          }),
    ),
    createElement(
      'section',
      { className: 'mtg-deck__section' },
      createElement(
        'div',
        { className: 'mtg-deck__section-head' },
        createElement('h2', { className: 'mtg-deck__section-title' }, 'Mana base'),
        createElement(
          'span',
          { className: 'mtg-deck__section-note' },
          `${String(deck.manaBase.totalLands)} of the ${String(deck.totalCards)}`,
        ),
      ),
      createElement(ManaBasePanel, { deck }),
    ),
  );
}

/** A precon's spell, paired with the card the staged set prints for it. */
interface PreconEntry {
  readonly card: DslCard;
  readonly count: number;
}

/**
 * A written deck's spells, grouped into an ascending mana curve.
 *
 * The grouping, the sort and the sum above each column are `./deck/columns.ts`'s
 * (`mtg-xzxs`): this was the third hand-written copy of that rule, after the
 * Constructed builder's and the artifact pane's, and a third copy is a third
 * chance for the number above a column to stop meaning cards. The land rule is
 * `./deck/build.ts`'s `cardManaValue` for the same reason — a land has no mana
 * cost at all rather than a cost of nothing, and this file derived that zero a
 * second time.
 *
 * What is left here is the part that is genuinely this pane's: a precon names
 * its spells by id and carries the count beside the id, so the pair has to be
 * assembled against the staged set before anything can be grouped. A spell the
 * set does not print is dropped rather than drawn, which is what `buildPrecon`
 * does with it one line below.
 */
function preconCardGroups(
  deck: PreconFile['decks'][number],
  cards: readonly DslCard[],
): readonly ManaValueGroup<PreconEntry>[] {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const entries: PreconEntry[] = [];
  for (const entry of deck.spells) {
    const card = byId.get(entry.id);
    if (card === undefined) continue;
    entries.push({ card, count: entry.count });
  }
  return manaValueGroups(
    entries,
    (entry) => cardManaValue(entry.card),
    (entry) => entry.count,
  );
}

function PreconDeckView(props: {
  readonly deck: PreconFile['decks'][number];
  readonly cards: readonly DslCard[];
  readonly artFor?: PositionArt;
}): ReactElement {
  const view = useDeckViewMode(`precon-${props.deck.id}`);
  const facts = preconFacts(props.deck, props.cards);
  const built = buildPrecon(props.deck, props.cards);
  const noncreatures = facts.spells - facts.creatures;
  const groups = preconCardGroups(props.deck, props.cards);
  return createElement(
    'div',
    { className: 'mtg-deck' },
    createElement('p', { className: 'mtg-deck__plan' }, props.deck.plan),
    createElement(
      'section',
      { className: 'mtg-deck__section' },
      createElement(
        'div',
        { className: 'mtg-deck__section-head' },
        createElement('h2', { className: 'mtg-deck__section-title' }, props.deck.name),
        createElement(
          'span',
          { className: 'mtg-deck__section-note' },
          `${String(facts.creatures)} creatures · ${String(noncreatures)} noncreature spells · ${String(facts.lands)} lands · sorted by mana value`,
        ),
        createElement(DeckViewControl, { pane: props.deck.name, state: view }),
      ),
      createElement(
        'div',
        {
          className: view.mode === 'full' ? 'mtg-gallery' : 'mtg-builder-curve',
          role: 'group',
          'aria-label': `${props.deck.name} cards`,
          'data-view': view.mode,
        },
        ...(view.mode === 'full'
          ? groups.flatMap((group) =>
              group.members.map(({ card, count }) =>
                createElement(Card, {
                  key: card.id,
                  card,
                  size: 'full',
                  art: props.artFor?.(card) ?? null,
                  footnote: `${String(count)} ${count === 1 ? 'copy' : 'copies'}`,
                }),
              ),
            )
          : groups.map((group) =>
              createElement(
                'div',
                {
                  key: String(group.manaValue),
                  className: 'mtg-deck__column',
                  role: 'group',
                  // The sentence rather than the two bare numbers, for
                  // `./deck/columns.ts`'s reason: spoken, "MV 3" beside "8" is
                  // two numbers in a row and neither says which is which.
                  'aria-label': curveLabel(group.manaValue, group.cards),
                },
                createElement(
                  'span',
                  { className: 'mtg-deck__column-head' },
                  createElement(
                    'span',
                    { className: 'mtg-deck__column-value' },
                    `MV ${String(group.manaValue)}`,
                  ),
                  createElement('span', { className: 'mtg-deck__column-count' }, String(group.cards)),
                ),
                ...group.members.map(({ card, count }) =>
                  createElement(Card, {
                    key: card.id,
                    card,
                    size: 'compact',
                    art: props.artFor?.(card) ?? null,
                    footnote: `${String(count)} ${count === 1 ? 'copy' : 'copies'}`,
                  }),
                ),
              ),
            )),
      ),
      createElement(
        'p',
        { className: 'mtg-deck__section-note' },
        `${String(built.deck.length)} cards total. Basic lands: ${Object.entries(props.deck.basics)
          .filter((entry): entry is [string, number] => entry[1] !== undefined && entry[1] > 0)
          .map(([color, count]) => `${color} ${String(count)}`)
          .join(' · ')}`,
      ),
    ),
  );
}

function librarySelection(props: DeckRouteProps): LibrarySelection | null {
  if (props.state.status === 'ready') return { kind: 'database' };
  const first = props.precons?.status === 'ready' ? props.precons.file.decks[0] : undefined;
  return first === undefined ? null : { kind: 'precon', id: first.id };
}

function DeckLibrary(props: DeckRouteProps): ReactElement {
  const [selected, setSelected] = useState<LibrarySelection | null>(() => librarySelection(props));
  const preconDecks = props.precons?.status === 'ready' ? props.precons.file.decks : [];
  const databaseReady = props.state.status === 'ready';
  const total = preconDecks.length + (databaseReady ? 1 : 0);
  const selectedPrecon =
    selected?.kind === 'precon' ? preconDecks.find((deck) => deck.id === selected.id) : undefined;
  const buildable = props.cards !== undefined && props.cards.length > 0;
  const content =
    selected?.kind === 'build' && props.cards !== undefined
      ? createElement(ConstructedGame, {
          pool: props.cards,
          ...(props.precons?.status === 'ready' ? { precons: props.precons.file } : {}),
          ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
        })
      : selected?.kind === 'database' && databaseReady
        ? deckBody(props.state.deck)
        : selectedPrecon !== undefined && props.cards !== undefined
          ? createElement(PreconDeckView, {
              deck: selectedPrecon,
              cards: props.cards,
              ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
            })
          : null;
  return createElement(
    'div',
    null,
    createElement(
      'div',
      { className: 'mtg-page-head' },
      createElement('h1', { className: 'mtg-page-title' }, 'Decks'),
      createElement(
        'span',
        { className: 'mtg-page-note' },
        buildable ? `${String(total)} available, or build your own` : `${String(total)} available`,
      ),
    ),
    createElement(
      'div',
      { className: 'mtg-panel' },
      createElement(
        'div',
        { className: 'mtg-panel__head' },
        createElement('span', { className: 'mtg-panel__title' }, 'Deck library'),
        createElement(
          'span',
          { className: 'mtg-panel__note' },
          'Preconstructed decks and staged database builds',
        ),
      ),
      createElement(
        'div',
        { className: 'mtg-panel__body' },
        createElement(
          'div',
          { className: 'mtg-toolbar', role: 'group', 'aria-label': 'Available decks' },
          ...(databaseReady
            ? [
                createElement(
                  'button',
                  {
                    key: 'database',
                    type: 'button',
                    className: 'mtg-btn',
                    'aria-pressed': selected?.kind === 'database',
                    onClick: (): void => setSelected({ kind: 'database' }),
                  },
                  `Database build: ${props.state.deck.prompt}`,
                ),
              ]
            : []),
          ...preconDecks.map((deck) =>
            createElement(
              'button',
              {
                key: deck.id,
                type: 'button',
                className: 'mtg-btn',
                'aria-pressed': selected?.kind === 'precon' && selected.id === deck.id,
                onClick: (): void => setSelected({ kind: 'precon', id: deck.id }),
              },
              `${deck.name} · preconstructed`,
            ),
          ),
          ...(buildable
            ? [
                createElement('span', { key: 'spacer', className: 'mtg-toolbar__spacer' }),
                createElement(
                  'button',
                  {
                    key: 'build',
                    type: 'button',
                    className: 'mtg-btn',
                    'data-variant': 'primary',
                    'aria-pressed': selected?.kind === 'build',
                    onClick: (): void => setSelected({ kind: 'build' }),
                  },
                  BUILD_LABEL,
                ),
              ]
            : []),
        ),
      ),
    ),
    content,
  );
}

export function DeckRoute(props: DeckRouteProps): ReactElement {
  const { state } = props;

  const hasPrecons = props.precons?.status === 'ready' && props.precons.file.decks.length > 0;
  // Staged cards are enough on their own. A checkout with a set and neither a
  // built artifact nor a precon file used to land on "no deck staged", which was
  // true of the library and false of the tab: every one of those cards is
  // playable and the builder is right there.
  const hasCards = props.cards !== undefined && props.cards.length > 0;
  if (state.status === 'ready' || hasPrecons || hasCards) return createElement(DeckLibrary, props);

  const head = createElement(
    'div',
    { className: 'mtg-page-head' },
    createElement('h1', { className: 'mtg-page-title' }, 'Decks'),
  );

  switch (state.status) {
    case 'loading':
      return createElement('div', null, head, empty('Reading deck.json…', 'Staged by `npm run lab`.'));
    case 'absent':
      return createElement(
        'div',
        null,
        head,
        empty(
          'No deck staged',
          'Run `npm run lab` to stage one. With no arguments it shows the committed example deck, ' +
            'which needs neither the card store nor an API key.',
        ),
      );
    case 'failed':
      return createElement('div', null, head, empty('That deck could not be read', state.message));
    default:
      return assertNever(state, 'DeckRoute');
  }
}
