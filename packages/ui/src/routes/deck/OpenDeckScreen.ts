/**
 * A built deck, read: its panes, its densities, and the prose behind a button.
 *
 * `mtg-c52t`. This is the screen `@mtg/decklab`'s artifact opens in -- one file
 * per screen, out of the 1,258-line route that held three of them. What it draws
 * is `../../lab/deck-artifact.ts`'s `DeckArtifact` and nothing else: a deck of
 * real printings, with the criteria each card was chosen against, which is why
 * its panes hold real printings rather than DSL cards.
 *
 * They are edited all the same, which is `mtg-ipse`: cutting a card, changing a
 * count and putting a cut card back are arithmetic over fields the document
 * already carries, and `./artifact-edit.ts` is that arithmetic and the argument
 * for it. What this file adds is where the moves are drawn -- the same 2026-08-29
 * grammar `./ConstructedBuilder.ts` uses, a click selects and named buttons above
 * the columns act on the selection -- and what a moved count does to the rest of
 * the page: the numbers follow it (`./DeckFacts.ts`), the build's evidence does
 * not and says so.
 */
import { Fragment, createElement, useState } from 'react';
import type { ReactElement } from 'react';
import type { DeckArtifact, DeckArtifactEntry } from '../../lab/deck-artifact';
// A column's mana value is drawn as a pip through the registry the card face and
// the tile's own cost already read, so this adds no vocabulary to the page.
// `integer` is the analysis route's thousands-separated formatter, not a new
// one: the deck route reports the same kind of number (a whole count) and
// reuses it rather than printing the universe size unformatted.
import { integer } from '../analysis';
import { withArticle } from './article';
import { CurveColumns } from './CurveColumns';
import { BUILT_EVIDENCE_NOTE, DeckFacts } from './DeckFacts';
import { DeckPane, PANE_CARD_VIEWS, usePaneControls } from './DeckPane';
import { DeckTile } from './DeckTile';
import { ManaBasePanel } from './ManaBasePanel';
import { StripColumns } from './StripColumns';
import {
  BUILT_DECK,
  copyCeiling,
  cutEntries,
  editedEntries,
  entryCount,
  isEdited,
  withEntryCount,
} from './artifact-edit';
import type { DeckEdit } from './artifact-edit';
import { deckScreen } from './deck-screen';
import { groupMembers, offeredGroupings } from './grouping';
import type { Grouping, GroupingFacts } from './grouping';
import { MAIN_DECK_EMPTY_TEXT, MAIN_DECK_LABEL, SIDEBOARD_EMPTY_TEXT, SIDEBOARD_LABEL } from './pane-names';
import { stripLabel } from './strips';
import type { Strip, StripFacts } from './strips';
import { deckTypeCounts, typeCountsLine } from './type-counts';
import { cardDensity } from './view-mode';
import type { DeckViewMode } from './view-mode';

/** What the deck's own prose, its shared criteria and its mana base sit behind. */
export const DECK_DETAILS_LABEL = 'Deck details';

/** Puts every count back to the one the build chose. Drawn only while edited. */
export const RESTORE_BUILT_LABEL = 'Restore the built deck';

/**
 * The two moves on the selection bar, printed short and spoken long.
 *
 * A bar that already names the card it is acting on prints `Cut this one`; a
 * screen reader arriving at the button on its own hears `Cut a <name>`, which is
 * `./ConstructedBuilder.ts`'s rule and the reason that file has the same pair.
 * The pair is written twice rather than shared: importing it would hand this
 * screen the whole Constructed builder -- its pool, its facets, its filters --
 * for two template strings, and the two are free to diverge, because that screen
 * plays a deck and this one reads a document. Three callers is when they merge.
 */
export const CUT_COPY_LABEL = 'Cut this one';
export const ADD_COPY_LABEL = 'Add another';

export function cutEntryLabel(name: string): string {
  return `Cut ${withArticle(name)}`;
}

export function addEntryLabel(name: string): string {
  return `Add another ${name}`;
}

/** What a wholly cut card's row offers: its own count back. */
export function putBackLabel(name: string): string {
  return `Put ${name} back`;
}

/** What the row of cut cards is called, out loud and in a test. */
export const CUT_LIST_LABEL = 'Cut from this deck';

interface DeckSectionProps {
  /** Which pane this is, for the layout and the rigs. */
  readonly kind: 'deck' | 'sideboard';
  /** The store key's stable half. Deliberately not derived from `title`. */
  readonly pane: string;
  /** What the pane is called when it is spoken: `Main deck`. */
  readonly name: string;
  /** What its heading prints: the name and its count, as the capture writes it. */
  readonly title: string;
  /** The stats line. Empty draws no note at all rather than an empty span. */
  readonly note: string;
  /** The cards as they stand: the built entries at their edited counts. */
  readonly entries: readonly DeckArtifactEntry[];
  /**
   * The entries as the build wrote them.
   *
   * Kept beside the edited ones because three things need the built count and
   * cannot recover it from a pane a card has left: the ceiling a `+` stops at,
   * the count `putBackLabel` restores, and the `built N×` a tile prints once its
   * own count has moved.
   */
  readonly built: readonly DeckArtifactEntry[];
  /** This pane's edit. A sideboard carries its own; see `./artifact-edit.ts`. */
  readonly edit: DeckEdit;
  readonly onEdit: (edit: DeckEdit) => void;
  readonly omit: readonly string[];
  /** Drawn where the cards would be when the pane holds none. */
  readonly emptyText: string;
}

/**
 * What a built artifact's entry can be grouped by.
 *
 * Rarity is not among them, and that is the whole reason `./grouping.ts`
 * offers axes rather than listing them: `../../lab/deck-artifact.ts`'s `EntrySchema`
 * has no rarity field, because `@mtg/decklab`'s producer writes down what it
 * selected on and it never selected on rarity. Saying so here rather than
 * letting `undefined` fall through means the menu on this pane is three long and
 * every entry in it works.
 */
function entryFacts(entry: DeckArtifactEntry): GroupingFacts {
  return {
    name: entry.name,
    manaValue: entry.manaValue,
    colorIdentity: entry.colorIdentity,
    typeLine: entry.typeLine,
    rarity: null,
  };
}

/** One strip per copy, so the number above a column counts the things under it. */
function entryStripFacts(entry: DeckArtifactEntry): StripFacts {
  return {
    key: entry.name,
    name: entry.name,
    manaCost: entry.manaCost,
    colorIdentity: entry.colorIdentity,
    copies: entry.count,
  };
}

function paneBody(props: {
  readonly mode: DeckViewMode;
  readonly entries: readonly DeckArtifactEntry[];
  readonly builtCounts: (name: string) => number | undefined;
  readonly omit: readonly string[];
  readonly grouping: Grouping;
  readonly label: string;
  readonly selectedKey: string | undefined;
  readonly onSelect: (strip: Strip<DeckArtifactEntry>) => void;
}): ReactElement {
  const { mode, entries, omit } = props;
  const groups = groupMembers(entries, entryFacts, (entry) => entry.count, props.grouping);
  if (mode === 'full') {
    // The grid used to read in the grouping's order with the columns flattened,
    // and that is exactly the reading `mtg-rgc.21` came from: the order was
    // there and the drawing did not say it. So the tiles keep their grid's
    // arrangement inside one column per group, under the count the compact
    // density already prints. `./CurveColumns.ts` is the same component the
    // two builders' pool panes draw, because this pane is the same kind of thing
    // -- a collection of whole cards you are reading, rather than a deck's
    // shape, which is what `./StripColumns.ts` is for.
    //
    // A tile rather than a strip because it is not selectable at this density
    // and never was: a real printing's tile carries a `<p>` of its reason, so it
    // cannot be the phrasing content a strip's button takes, and there is
    // nothing in this pane for a selection to act on. The compact density is
    // where a copy is picked.
    return createElement(CurveColumns<DeckArtifactEntry>, {
      groups,
      view: mode,
      label: props.label,
      faces: (group) =>
        group.members.map((entry) =>
          createElement(DeckTile, {
            key: entry.name,
            entry,
            omit,
            mode,
            builtCount: props.builtCounts(entry.name),
          }),
        ),
    });
  }
  return createElement(StripColumns<DeckArtifactEntry>, {
    groups,
    factsOf: entryStripFacts,
    selectedKey: props.selectedKey,
    onSelect: props.onSelect,
    label: props.label,
  });
}

/**
 * One pane of cards, with its own density control.
 *
 * A component rather than the function this used to be, because the density is
 * per pane (`./view-mode.ts` argues why, out of the MTGO capture) and a
 * per-pane preference needs per-pane state. The pane's identity is passed in
 * rather than slugged off `title`: the title is copy, a copy edit is a thing
 * somebody does without thinking about storage, and deriving the key from it
 * would silently discard the reader's choice the first time one is reworded.
 */
function DeckSection(props: DeckSectionProps): ReactElement {
  const { pane, name, title, note, entries, built, edit, omit, emptyText } = props;
  // The axes are offered against the built entries rather than the edited ones,
  // so cutting the last multicolored card does not take an axis off the menu and
  // put the pane's grouping back to the fallback under the reader.
  const controls = usePaneControls(pane, offeredGroupings(built.map(entryFacts)), PANE_CARD_VIEWS);
  // Selection is transient and belongs to the pane, not to the store: it is
  // which copy you are about to act on, and a reload that remembered it would
  // reopen the page with a card outlined for no reason a reader could recall.
  const [selected, setSelected] = useState<Strip<DeckArtifactEntry> | null>(null);
  const builtOf = (cardName: string): DeckArtifactEntry | undefined =>
    built.find((entry) => entry.name === cardName);
  const selectedEntry = selected === null ? undefined : builtOf(selected.name);
  const cuts = cutEntries(built, edit);
  // The bar draws only while the copy under the outline still exists, which is
  // `./ConstructedBuilder.ts`'s rule and the same reason: cutting the fourth
  // copy of a four-of leaves a key naming nothing, and a bar reporting a card at
  // zero copies with a live cut on it is worse than no bar. Derived from the
  // counts rather than cleared in an effect, so there is no frame where the two
  // disagree.
  const selectedCopies = selectedEntry === undefined ? 0 : entryCount(edit, selectedEntry);
  const showSelection =
    controls.view.mode === 'compact' &&
    selected !== null &&
    selectedEntry !== undefined &&
    selected.copy <= selectedCopies;
  const setCount = (entry: DeckArtifactEntry, count: number): void => {
    props.onEdit(withEntryCount(edit, entry, count));
  };
  return createElement(
    DeckPane,
    {
      kind: props.kind,
      label: name,
      title,
      note,
      controls,
      above: createElement(
        Fragment,
        null,
        !showSelection || selected === null || selectedEntry === undefined
          ? null
          : createElement(SelectionBar, {
              strip: selected,
              omit,
              copies: selectedCopies,
              ceiling: copyCeiling(selectedEntry),
              builtCount: selectedEntry.count,
              mode: controls.view.mode,
              onCut: () => {
                setCount(selectedEntry, selectedCopies - 1);
              },
              onAdd: () => {
                setCount(selectedEntry, selectedCopies + 1);
              },
              onClear: () => {
                setSelected(null);
              },
            }),
        // The cut list is drawn at both densities, because a card that is not in
        // the pane cannot be selected in it: the only way back to a card cut to
        // nothing is a row that names it, and switching to whole cards to read
        // the deck must not take that row away.
        cuts.length === 0
          ? null
          : createElement(CutList, {
              cuts,
              onPutBack: (entry: DeckArtifactEntry) => {
                setCount(entry, entry.count);
              },
            }),
      ),
    },
    entries.length === 0
      ? createElement('span', { className: 'mtg-deck__empty' }, emptyText)
      : paneBody({
          mode: controls.view.mode,
          entries,
          builtCounts: (cardName: string) => builtOf(cardName)?.count,
          omit,
          grouping: controls.grouping.grouping,
          label: `${name}, cards`,
          selectedKey: selected?.key,
          onSelect: setSelected,
        }),
  );
}

/**
 * The cards cut to nothing, and the one move each of them has left.
 *
 * A pane draws the deck, and a card at zero copies is not in the deck; leaving
 * its strips in place at zero would put cards in a column that the count above
 * the column does not count, which is the one property `./strips.ts` was built
 * to protect. So it leaves the columns and lands here, above them, as a row that
 * says what it was and offers its built count back.
 */
function CutList(props: {
  readonly cuts: readonly DeckArtifactEntry[];
  readonly onPutBack: (entry: DeckArtifactEntry) => void;
}): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-deck__cuts', role: 'group', 'aria-label': CUT_LIST_LABEL },
    createElement('span', { className: 'mtg-deck__cuts-name' }, CUT_LIST_LABEL),
    ...props.cuts.map((entry) =>
      createElement(
        'button',
        {
          key: entry.name,
          type: 'button',
          className: 'mtg-btn',
          'aria-label': putBackLabel(entry.name),
          onClick: (): void => {
            props.onPutBack(entry);
          },
        },
        `${entry.name} ${String(entry.count)}×`,
      ),
    ),
  );
}

/**
 * What a selected copy is, and what can be done with it.
 *
 * The 2026-08-29 grammar: a click on a strip selects, and the named buttons that
 * used to sit under every face move up here. The bar carries the selected copy's
 * tile, because the argument for the card is what this pane exists to show, and
 * beside it the two moves `mtg-ipse` settled: a copy off, a copy on, each dark
 * at its limit so the format's rule is visible before it is reached rather than
 * as a refusal afterwards.
 *
 * The tile is drawn at the pane's own density rather than at `full`. mtg-mxkrk
 * took the picture off every compact surface, and this bar draws only in
 * compact, so a hardcoded `full` here put a whole illustration back on screen
 * the moment a reader pressed a name strip -- the one gesture the compact pane
 * offers. What a compact tile keeps is the head, the cost and the type line;
 * the reason and the cited criteria come back with the picture when the pane is
 * switched to whole cards, which is where a reader goes to read the argument.
 *
 * It is above the columns rather than beside the selected strip. A strip is
 * 26 pixels tall and a popover anchored to one would cover the two strips under
 * it, which are the copies a reader is comparing it against; the header is the
 * one place on the pane that is never covering a card.
 */
function SelectionBar(props: {
  readonly strip: Strip<DeckArtifactEntry>;
  readonly omit: readonly string[];
  /** Copies of this card the deck holds now, which is what the moves act on. */
  readonly copies: number;
  /** The most it may reach, or `null` where the game states no limit. */
  readonly ceiling: number | null;
  /** What the build chose, so the tile can say the count has moved. */
  readonly builtCount: number;
  /** The pane's density, which the tile is drawn at. See the docblock. */
  readonly mode: DeckViewMode;
  readonly onCut: () => void;
  readonly onAdd: () => void;
  readonly onClear: () => void;
}): ReactElement {
  const { strip } = props;
  return createElement(
    'div',
    { className: 'mtg-deck__selection', role: 'group', 'aria-label': `Selected: ${stripLabel(strip)}` },
    createElement('span', { className: 'mtg-deck__selection-name' }, stripLabel(strip)),
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-btn',
        'aria-label': cutEntryLabel(strip.name),
        disabled: props.copies === 0,
        onClick: props.onCut,
      },
      CUT_COPY_LABEL,
    ),
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-btn',
        'aria-label': addEntryLabel(strip.name),
        disabled: props.ceiling !== null && props.copies >= props.ceiling,
        onClick: props.onAdd,
      },
      ADD_COPY_LABEL,
    ),
    createElement('span', { className: 'mtg-toolbar__spacer' }),
    createElement(
      'button',
      { type: 'button', className: 'mtg-btn', onClick: props.onClear },
      'Clear selection',
    ),
    createElement(DeckTile, {
      entry: { ...strip.member, count: props.copies },
      omit: props.omit,
      mode: cardDensity(props.mode),
      builtCount: props.builtCount,
    }),
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
 * Merging the three panes into one pays for itself twice. `./columns.ts`
 * groups a pane by mana value and a land's is 0, so the lands now sit in the
 * leftmost column under a header bar that says `Lands: 24` — which is exactly
 * what the capture shows, and what that file's "# Lands" section previously had
 * to explain away as a column with a pane to itself. And the per-pane density
 * `./view-mode.ts` argues for now switches between the deck and the board
 * rather than between the spells and their Mountains.
 *
 * The cost is real and is not recovered: the lands and the spells can no longer
 * be read at two different densities, because they are one pane. That ability
 * went with the pane it belonged to, and the pane was the wrong one.
 *
 * The sideboard pane is drawn only when the document carries the field, empty or
 * not — `../../lab/deck-artifact.ts` argues why absent and empty are different
 * claims, and `@mtg/decklab` makes the absent one.
 *
 * # The page opens on the cards, and everything else is behind a button
 *
 * `mtg-z4q6`, and the finish of what `mtg-o7wr` started. That bead moved the
 * mana base below the cards because `../../../tools/deck-density.ts` measured what
 * it cost above them: the first tile's top was at y=906 in a 900px viewport and
 * y=948 in a 768px one, so the number of tiles fully on screen when the page
 * opened was **zero at every viewport, in both densities**. It measured the
 * other three too — the deck's prose is 245px, the plan paragraph 113px, the
 * shared criteria 38px, the mana base 384px — and moved only the mana base,
 * because it was the only one that is a summary of the cards rather than part
 * of reading them.
 *
 * The remaining 396px is now behind `DECK_DETAILS_LABEL`, on the playtester's own
 * argument of 2026-08-29: the prose is read once and the columns are read
 * continuously, so prose above the columns spends the height that makes the
 * columns work, every time the page is opened, for a paragraph nobody rereads.
 * The mana base joins it rather than staying below the panes, because a
 * disclosure whose panel is somewhere else on the page is not a disclosure.
 *
 * What stays visible is the half that IS read continuously and was already in
 * the header: `Main deck: 60`, and the type counts beside it. The panel opens
 * *above* the panes rather than below them, which does push the columns down —
 * that is a reader's explicit request for the prose, and closing it puts them
 * back. `mtg-tz11` asked where these three live once the panes are boxes; this
 * is the answer.
 */
function deckBody(props: {
  readonly deck: DeckArtifact;
  readonly details: boolean;
  readonly mainEdit: DeckEdit;
  readonly onMainEdit: (edit: DeckEdit) => void;
  readonly sideEdit: DeckEdit;
  readonly onSideEdit: (edit: DeckEdit) => void;
}): ReactElement {
  const { deck, details, mainEdit, sideEdit } = props;
  const main = [...deck.spells, ...deck.lands, ...deck.basics];
  const { sideboard } = deck;
  const shared = sharedCriteria([...main, ...(sideboard ?? [])]);
  const mainNow = editedEntries(main, mainEdit);
  const sideNow = sideboard === undefined ? undefined : editedEntries(sideboard, sideEdit);
  return createElement(
    'div',
    { className: 'mtg-deck' },
    createElement(DeckFacts, { deck, edit: mainEdit }),
    !details
      ? null
      : createElement(
          'section',
          { className: 'mtg-deck__details', role: 'region', 'aria-label': DECK_DETAILS_LABEL },
          // At the top of the panel rather than beside each frozen thing: the
          // plan, the criteria and the bands are one record of one build, and
          // three copies of one sentence is the cost `sharedCriteria` refuses a
          // few lines down for exactly the same reason.
          !isEdited(mainEdit) && !isEdited(sideEdit)
            ? null
            : createElement('p', { className: 'mtg-deck__built-note' }, BUILT_EVIDENCE_NOTE),
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
            { className: 'mtg-deck__pane-head' },
            createElement('h2', { className: 'mtg-deck__pane-title' }, 'Mana base'),
            createElement(
              'span',
              { className: 'mtg-deck__pane-note' },
              `${String(deck.manaBase.totalLands)} of the ${String(deck.totalCards)}`,
            ),
          ),
          createElement(ManaBasePanel, { deck }),
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
        kind: 'deck',
        pane: 'main-deck',
        name: MAIN_DECK_LABEL,
        title: paneTitle(MAIN_DECK_LABEL, mainNow),
        // The universe clause stays with the cards it describes — the pool the
        // spells and the nonbasic lands were chosen out of. The basics in this
        // pane were never in it; they are arithmetic, and their own tiles say so.
        // It does not move with an edit: the universe is a fact about the build's
        // criteria, and cutting a card narrows nothing.
        note: `${typeCountsLine(deckTypeCounts(mainNow))} · chosen from the ${integer(deck.universeSize)} the criteria allow`,
        entries: mainNow,
        built: main,
        edit: mainEdit,
        onEdit: props.onMainEdit,
        omit: shared,
        emptyText: MAIN_DECK_EMPTY_TEXT,
      }),
      sideboard === undefined || sideNow === undefined
        ? null
        : createElement(DeckSection, {
            kind: 'sideboard',
            pane: 'sideboard',
            name: SIDEBOARD_LABEL,
            title: paneTitle(SIDEBOARD_LABEL, sideNow),
            note: typeCountsLine(deckTypeCounts(sideNow)),
            entries: sideNow,
            built: sideboard,
            edit: sideEdit,
            onEdit: props.onSideEdit,
            omit: shared,
            emptyText: SIDEBOARD_EMPTY_TEXT,
          }),
    ),
  );
}

/**
 * An open deck: its panes, and the button that opens everything else about it.
 *
 * A component rather than the two functions it composes, because the disclosure
 * is one piece of state read in two places — the button is in the screen's head,
 * which is outside the scroll region, and the panel is at the top of the body,
 * which is inside it.
 */
export function OpenDeck(props: { readonly deck: DeckArtifact; readonly onBack: () => void }): ReactElement {
  const [details, setDetails] = useState(false);
  // Two edits rather than one, because a sideboard is free to reprint a
  // main-deck card and both maps key by name: one map would move the two counts
  // together, which is a bug nobody would look for. `./artifact-edit.ts` states
  // that where the keying is decided.
  const [mainEdit, setMainEdit] = useState<DeckEdit>(BUILT_DECK);
  const [sideEdit, setSideEdit] = useState<DeckEdit>(BUILT_DECK);
  const edited = isEdited(mainEdit) || isEdited(sideEdit);
  return deckScreen(
    props.deck.prompt,
    deckBody({
      deck: props.deck,
      details,
      mainEdit,
      onMainEdit: setMainEdit,
      sideEdit,
      onSideEdit: setSideEdit,
    }),
    props.onBack,
    createElement(
      Fragment,
      null,
      // Drawn only while there is something to restore. A button that is always
      // there and does nothing most of the time is a button a reader has to
      // check; this one's presence is the page saying the deck has been moved.
      !edited
        ? null
        : createElement(
            'button',
            {
              key: 'restore',
              type: 'button',
              className: 'mtg-btn',
              onClick: () => {
                setMainEdit(BUILT_DECK);
                setSideEdit(BUILT_DECK);
              },
            },
            RESTORE_BUILT_LABEL,
          ),
      createElement(
        'button',
        {
          key: 'details',
          type: 'button',
          className: 'mtg-btn',
          'aria-expanded': details,
          onClick: () => {
            setDetails(!details);
          },
        },
        DECK_DETAILS_LABEL,
      ),
    ),
  );
}
