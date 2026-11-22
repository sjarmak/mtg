/**
 * The Constructed deckbuilding screen: sixty cards out of everything playable.
 *
 * The sealed builder next door arrives with a suggestion because a blank
 * 72-card pool is a worse starting point than a build to argue with. This one
 * arrives empty on purpose. A suggestion over a Constructed pool would have to
 * be a deck *design* — which four-ofs, which plan — and that is judgment, which
 * this project sends to a person or a model rather than computing in the
 * application layer. What the screen offers instead is a starting point that
 * already exists: any of the set's preconstructed decks, opened here and edited.
 *
 * Click grammar is the same in both panes and reversible in both: a click in
 * the pool plays one more copy, a right click there cuts one, and the deck pane
 * is the same two gestures the other way round. So a deck can be tuned without
 * moving between panes, which matters when the pool pane is the one holding the
 * search box. Both moves are also a named button under every face, because a
 * right click is not a keyboard move and is not a touch move either; see
 * `addCopyLabel` below.
 *
 * # Two panes, not five panels
 *
 * The deck and the pool sit side by side, roughly two to three, and everything
 * that is neither is one sticky bar above them. It was a single column of
 * bordered boxes — save, mana base, deck, filters, pool — which put the pool a
 * scroll away from the deck on a screen whose entire activity is moving cards
 * between the two. `../../styles/deck.ts`'s `BUILDER` block holds the grid and
 * says why the split is what it is.
 *
 * The mana base is `BasicsPanel`, shared with sealed, and it sits inside the
 * deck pane: it is part of the deck rather than a thing beside it. Nothing about
 * counting out lands differs between the formats.
 *
 * Two things on this screen are not the pool or the cards, and both come from
 * one ask (the playtester, 2026-08-20). `SavedDecksPanel` gives the build a name and
 * a life longer than the tab — until it landed, the whole deck lived in
 * `ConstructedGame`'s `useState` and closing the page lost it. And the deck's
 * mana curve is drawn above the deck pane at *every* density, because the
 * columns that already answered "how many two-drops" exist only in compact, and
 * a pane switched to full would otherwise lose the answer.
 */
import { Fragment, createElement, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Color, Card as DslCard } from '@mtg/dsl';
import { CONSTRUCTED_COPY_LIMIT } from '@mtg/deckbuild';
import { withArticle } from './article';
import { blockedNotes, clearBlocked, legalityNotes, playBlocked } from './blocked';
import type { BlockedControl } from './blocked';
import { builderCounts, builderCountsLine } from './deck-counts';
import { deckColorsIndicator } from './DeckColors';
import type { ManualDeck } from '@mtg/deckbuild';
import { Card } from '../../card/Card';
import type { PositionArt } from '../play/position';
import { BasicsPanel } from './BasicsPanel';
import { builderSplitHandle, builderSplitStyle, useBuilderSplit } from './builder-split';
import { builderPaneExpansionControl, builderPaneSwitch, useBuilderPane } from './builder-panes';
import { curveStrip } from './CurveStrip';
import { DECKS_BACK_LABEL } from './deck-screen';
import { DeckListRows } from './DeckListRows';
import { DeckPane, PANE_CARD_VIEWS, PANE_DECKLIST_VIEWS, usePaneControls } from './DeckPane';
import { groupMembers } from './grouping';
import { CardPreview, readRootPx, readViewport } from './CardPreview';
import type { Box as PreviewBox, PreviewAnchor } from './CardPreview';
import { CurveColumns } from './CurveColumns';
import type { CurveFlow } from './CurveColumns';
import type { Group, Grouping } from './grouping';
import { SavedDecksPanel } from './SavedDecksPanel';
import type { DeckSetRef } from './library';
import { cardDensity } from './view-mode';
import type { DeckViewMode } from './view-mode';
import { StripColumns } from './StripColumns';
import type { StripFaceGestures } from './StripColumns';
import type { Strip } from './strips';
import { stripLabel } from './strips';
import { cardGroupingFacts, cardStripFacts, chosenCards, copiesOf, manaCurve, selectable } from './build';
import type { ConstructedBuild } from './build';
import { WHOLE_POOL, filterPool, indexPool, setCodesIn, toggleSet, withText } from './pool-filter';
import type { PoolFilter } from './pool-filter';
import { clearFilterButton, poolFacetButtons } from './PoolFacets';

export { MANA_CURVE_LABEL } from './CurveStrip';

export const CONSTRUCTED_POOL_LABEL = 'Playable cards';

/**
 * What the pool is, in the words of somebody building a deck.
 *
 * It used to read "Every card the kernel can run, up to four copies each",
 * which names a component of this application rather than anything on the
 * screen. Four copies is the rule the pane enforces and worth saying; which
 * process can execute a card is not.
 */
export const POOL_NOTE = 'Up to four copies of each';

export const DECK_LABEL = 'Your deck';

/** Names the cards region inside the deck pane, apart from the pane's own heading. */
export const DECK_CARDS_LABEL = 'Cards in your deck';

/**
 * What each pane says instead of drawing nothing at all.
 *
 * An empty deck pane used to be an empty `div`, so the builder opened on a
 * titled column, a mana row and then four hundred pixels of page. A pane that
 * is empty on purpose and a pane that failed to render look identical when
 * neither says anything, and the first one is the common case here: every
 * constructed deck starts at zero cards.
 *
 * The pool's is two sentences because the pool is empty for two different
 * reasons — a search that matched nothing, which names what was typed so it can
 * be corrected, and filters that between them keep nothing.
 *
 * The deck's names the pool rather than placing it. It read "beside this pane",
 * which is true of the two-column desk layout and false of every phone: under
 * 64rem the panes stack and the pool is *below* the deck, so at 390x844 the one
 * sentence on an empty screen pointed at a place with nothing in it
 * (`mtg-dcxg.7`, 2026-08-23).
 */
export const EMPTY_DECK_NOTE = `No cards yet. Add them from ${CONSTRUCTED_POOL_LABEL.toLowerCase()}.`;
export const EMPTY_FILTERED_POOL_NOTE = 'No card in this set matches the colors you have chosen.';
export function emptySearchNote(text: string): string {
  return `No card matches “${text.trim()}”.`;
}

/** The search box, named so a test can type into it. */
export const SEARCH_LABEL = 'Search the playable cards';

export { CLEAR_FILTER_LABEL } from './PoolFacets';

export const CLEAR_DECK_LABEL = 'Clear the deck';

/**
 * The two controls under every face, named for whoever cannot right click.
 *
 * The click grammar this screen was built on — click to play a copy, right
 * click to cut one — is reversible and fast and reachable by exactly one input
 * device. A context menu has no keyboard equivalent, and on a touch screen it
 * is a long press nobody is told about. So the gestures stay and the same two
 * moves are also two buttons on the face, which are tab stops, have names, and
 * say by being dark that a fifth copy and a cut from zero are not moves.
 */
export function addCopyLabel(name: string): string {
  return `Play another ${name}`;
}

export function cutCopyLabel(name: string): string {
  return `Cut ${withArticle(name)}`;
}

export const PLAY_LABEL = 'Play this deck';

/** What the toolbar's list of refusals is called, for a reader steering by name. */
export const BUILDER_NOTES_LABEL = 'What this deck is failing';

/**
 * What a mirror match is, said out loud.
 *
 * Constructed has no pool to open a second deck out of, so both seats play the
 * list that was just built. That is a real fact about the game about to start
 * and is invisible from the board.
 */
export const MIRROR_NOTE = 'Both seats play this deck: Constructed deals no second pool.';

/**
 * What a match is, said out loud, where the mirror note used to be.
 *
 * The mirror note is a true fact about a mirror and a false one about a match,
 * and it was still printed over the button after an opponent had been chosen.
 * Found by driving the lab rather than by reading: the deck the workbench hands
 * over and the sentence this toolbar prints are three files apart.
 */
export function matchNote(opponentName: string): string {
  return `The other seat plays ${opponentName}.`;
}

export interface ConstructedBuilderProps {
  readonly build: ConstructedBuild;
  readonly deck: ManualDeck;
  /**
   * The deck on the other side of the table, when one was chosen.
   *
   * Absent is the mirror, which is what Constructed deals when there is no
   * second deck to open. Present replaces `MIRROR_NOTE` over both play buttons,
   * because that sentence is false once there is one.
   */
  readonly opponentName?: string;
  /** Plays one more copy of a card, up to four. */
  readonly onAdd: (cardId: string) => void;
  /** Cuts one copy. */
  readonly onCut: (cardId: string) => void;
  readonly onClear: () => void;
  readonly onAdjustBasics: (color: Color, delta: number) => void;
  readonly onSuggestBasics: () => void;
  /** Starts the game. Enabled only when the deck is legal. */
  readonly onPlay: () => void;
  /** Reopens a saved deck: hands the builder's owner a whole build to hold. */
  readonly onLoad: (build: ConstructedBuild) => void;
  /** Opens one of the set's written decks here to edit. */
  readonly starters?: readonly { readonly id: string; readonly name: string }[];
  readonly onStart?: (id: string) => void;
  /** A saved deck to open once, on arrival. `./open.ts` says where it comes from. */
  readonly openSavedDeckId?: string;
  /** Which staged set each pool card came from, read by every save here. */
  readonly setOf?: ReadonlyMap<string, DeckSetRef>;
  /** Arrived by *Import deck*: open with the decklist box already on screen. */
  readonly openFiles?: boolean;
  /**
   * Whether this builder was opened on a deck rather than filled in.
   *
   * Passed to `./SavedDecksPanel.ts`, which otherwise reads the full deck as a
   * reason to open its save controls over the workspace.
   */
  readonly arrivedWithDeck?: boolean;
  /** Reports the open saved deck's name upward. `SavedDecksPanel` argues why. */
  readonly onOpenDeckChange?: (name: string | null) => void;
  readonly artFor?: PositionArt;
  /**
   * What the pool pane says about the pool, when the caller knows something this
   * component cannot: how many sets it is the union of, and what the union had
   * to leave out (`./constructed-pool.ts`). `POOL_NOTE` when nobody said.
   */
  readonly poolNote?: string;
  /**
   * What this build is called, drawn at the left end of the toolbar.
   *
   * `mtg-i8xl`. It used to be an `h1` in a page head above the builder, which is
   * a 59px band holding a title and one button, over a 66px band holding the
   * counts and the rest of the buttons. Two bands saying one thing is the shape
   * this screen had four of. Absent on a host that draws its own head.
   */
  readonly title?: string;
  /** The way back to the shelf, drawn at the right end of the same toolbar. */
  readonly onBack?: () => void;
}

/**
 * The two shapes of event this file reads, spelled out rather than imported.
 *
 * The workspace tsconfig has no `lib: dom` (`./local-store.ts` records why), so
 * `MouseEvent` and `FocusEvent` carry nothing here. What is needed is a pointer
 * position and an element's own box, and naming exactly those keeps the handlers
 * honest about what they touch.
 */
interface Boxed {
  readonly currentTarget: {
    readonly getBoundingClientRect: () => {
      readonly right: number;
      readonly top: number;
      readonly height: number;
    };
  };
}

interface PointerAt extends Boxed {
  readonly clientY: number;
}

/** Where the pointer is, in window coordinates. `./CardPreview.ts` places it. */
export interface Pointed {
  readonly x: number;
  readonly y: number;
}

/** What the floating preview is drawing, and the window it was measured in. */
interface Peek extends PreviewAnchor {
  readonly viewport: PreviewBox;
  readonly rootPx: number;
}

/** A face's own anchor: its right edge, halfway down. */
function edgeOf(element: Boxed['currentTarget']): Pointed {
  const box = element.getBoundingClientRect();
  return { x: box.right, y: box.top + box.height / 2 };
}

function counter(label: string, value: string): ReactElement {
  return createElement(
    'span',
    { key: label, className: 'mtg-fact' },
    createElement('span', { className: 'mtg-fact__label' }, label),
    createElement('span', { className: 'mtg-fact__value' }, value),
  );
}

/**
 * Cards grouped into an ascending mana curve; a land is a zero.
 *
 * The faces and the count are deliberately two numbers. `./columns.ts` settled
 * what the number above a column means — **cards, not distinct entries**, so the
 * row of them sums to the count the pane states in its own header — and this
 * pane draws one face per distinct card with its copies written beside it, so
 * the two differ by exactly the playsets. The deck pane counted its faces and
 * therefore put `13` over a sixty-card deck, a number that appeared nowhere else
 * on the page.
 *
 * `weigh` is what a card is worth to its column, and it is the caller's because
 * the two panes are counting different things. In the deck it is the copies
 * played; in the pool it is one, because the pool lists each playable card once
 * and its header says how many of those are showing.
 *
 * The grouping itself is `./grouping.ts`'s, shared with the artifact pane and
 * the draft pool; what stays here is the one thing this pane knows that neither
 * of them does, which is that the facts come off a DSL card through
 * `./build.ts`'s `cardGroupingFacts`.
 */
function cardGroups(
  cards: readonly DslCard[],
  weigh: (card: DslCard) => number,
  grouping: Grouping,
): readonly Group<DslCard>[] {
  return groupMembers(cards, cardGroupingFacts, weigh, grouping);
}

/**
 * One card face in a pane, with the copies it is played at written under it.
 *
 * The count is a line of its own rather than the face's `footnote`, which is
 * what the sealed builder uses. A full face has no foot — it spends that height
 * on the picture and puts the caller's footnote in a corner badge — and the
 * default view mode is full, so a copy count passed as a footnote is invisible
 * exactly where a Constructed builder needs it most. How many copies are in the
 * deck is *the* fact this screen is about, so it is drawn beside the face at
 * every density instead of inside it at one.
 */
function cardFace(props: {
  readonly card: DslCard;
  readonly copies: number;
  readonly mode: DeckViewMode;
  readonly onSelect: (cardId: string) => void;
  readonly onMenu: (cardId: string) => void;
  /** The accelerator, when the pane has one. A double click on the face. */
  readonly onActivate?: (cardId: string) => void;
  readonly onAdd: (cardId: string) => void;
  readonly onCut: (cardId: string) => void;
  readonly artFor?: PositionArt;
  /** Under the outline: what the next move acts on. See `pickedFace`. */
  readonly picked?: boolean;
  /** Points at this card, for the floating preview. See `./CardPreview.ts`. */
  readonly onPoint?: (card: DslCard | null, at: Pointed) => void;
}): ReactElement {
  const { card, copies } = props;
  const onPoint = props.onPoint;
  return createElement(
    'div',
    {
      key: card.id,
      className: 'mtg-copies',
      'data-copies': String(copies),
      'data-picked': props.picked === true ? 'true' : 'false',
      ...(onPoint === undefined
        ? {}
        : {
            // Entering rather than moving: a `mousemove` handler over a pane of
            // nine hundred faces sets state on every pixel traveled. The
            // preview is placed once, when the pointer crosses in, and stays
            // there while it is inside -- so the face is not chased across the
            // screen while it is being read.
            //
            // Anchored to the *card's* right edge rather than to the pointer's
            // x, so the preview is never drawn over the card it is describing:
            // a pointer entering at the left of a face would otherwise put a
            // 244px face on top of it. The pointer's y is kept, because that is
            // where the reader is already looking.
            onMouseEnter: (event: PointerAt): void => {
              onPoint(card, { x: edgeOf(event.currentTarget).x, y: event.clientY });
            },
            onMouseLeave: (): void => {
              onPoint(null, { x: 0, y: 0 });
            },
            // The keyboard's own way of pointing, and the same anchor: a focus
            // event carries no coordinates at all.
            onFocus: (event: Boxed): void => {
              onPoint(card, edgeOf(event.currentTarget));
            },
            onBlur: (): void => {
              onPoint(null, { x: 0, y: 0 });
            },
          }),
    },
    createElement(Card, {
      card,
      size: cardDensity(props.mode),
      art: props.artFor?.(card) ?? null,
      selected: copies > 0,
      onSelect: (): void => {
        props.onSelect(card.id);
      },
      onMenu: (): void => {
        props.onMenu(card.id);
      },
      ...(props.onActivate === undefined
        ? {}
        : {
            onActivate: (): void => {
              props.onActivate?.(card.id);
            },
          }),
    }),
    createElement(
      'div',
      { className: 'mtg-copies__bar' },
      createElement(
        'button',
        {
          type: 'button',
          className: 'mtg-copies__step',
          'aria-label': cutCopyLabel(card.name),
          disabled: copies === 0,
          onClick: (): void => {
            props.onCut(card.id);
          },
        },
        '-',
      ),
      copies === 0
        ? null
        : createElement('span', { className: 'mtg-copies__count' }, `${String(copies)} in deck`),
      createElement(
        'button',
        {
          type: 'button',
          className: 'mtg-copies__step',
          'aria-label': addCopyLabel(card.name),
          disabled: copies >= CONSTRUCTED_COPY_LIMIT,
          onClick: (): void => {
            props.onAdd(card.id);
          },
        },
        '+',
      ),
    ),
  );
}

function cardPane(props: {
  readonly cards: readonly DslCard[];
  readonly build: ConstructedBuild;
  readonly label: string;
  /** What the pane says when it is holding nothing. See `EMPTY_DECK_NOTE`. */
  readonly empty: string;
  /**
   * Drawn under that sentence, and only there.
   *
   * The written decks to start from are the one caller (`mtg-i8xl`). They used
   * to be a band above the panes, drawn only while the deck was empty, which is
   * the same condition this slot is — so the band was a row of chrome that
   * appeared and vanished above the workspace instead of an offer made where the
   * empty pane already says there is nothing here yet.
   */
  readonly emptyExtra?: ReactNode;
  readonly mode: DeckViewMode;
  readonly grouping: Grouping;
  readonly weigh: (card: DslCard) => number;
  readonly onSelect: (cardId: string) => void;
  readonly onMenu: (cardId: string) => void;
  readonly onAdd: (cardId: string) => void;
  readonly onCut: (cardId: string) => void;
  readonly artFor?: PositionArt;
  /** How the groups are arranged. `./CurveColumns.ts`'s `CurveFlow` argues it. */
  readonly flow?: CurveFlow;
  /** A double click on a face, where the pane has an accelerator. */
  readonly onActivate?: (cardId: string) => void;
  /** The card under the outline in this pane, by id. */
  readonly pickedId?: string;
  readonly onPoint?: (card: DslCard | null, at: Pointed) => void;
}): ReactElement {
  // An empty pane keeps its group and says what it is empty of. Drawn as the
  // group's only child rather than in place of it, so a reader who navigated to
  // "Cards in your deck" arrives somewhere that still has that name.
  if (props.cards.length === 0) {
    return createElement(
      'div',
      { className: 'mtg-gallery', role: 'group', 'aria-label': props.label, 'data-view': 'empty' },
      createElement('p', { className: 'mtg-prompt__explain' }, props.empty),
      props.emptyExtra ?? null,
    );
  }
  // Compact draws the collection the way `mtg-eeqnj` asks: name strips, one
  // per card, no picture -- `./poolStrips` below, mirroring the deck pane's
  // own full/compact split in `./OpenDeckScreen.ts`'s `paneBody`. Only the
  // pool ever reaches this branch; the deck pane's own call above returns at
  // the empty check before its cards are ever non-empty here.
  if (props.mode !== 'full') {
    return poolStrips({
      cards: props.cards,
      grouping: props.grouping,
      weigh: props.weigh,
      label: props.label,
      onSelect: props.onSelect,
      onAdd: props.onAdd,
      onCut: props.onCut,
      ...(props.pickedId === undefined ? {} : { pickedId: props.pickedId }),
      ...(props.onPoint === undefined ? {} : { onPoint: props.onPoint }),
    });
  }
  const face = (card: DslCard): ReactElement =>
    cardFace({
      card,
      copies: copiesOf(props.build, card.id),
      mode: props.mode,
      onSelect: props.onSelect,
      onMenu: props.onMenu,
      onAdd: props.onAdd,
      onCut: props.onCut,
      picked: props.pickedId === card.id,
      ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
      ...(props.onActivate === undefined ? {} : { onActivate: props.onActivate }),
      ...(props.onPoint === undefined ? {} : { onPoint: props.onPoint }),
    });
  // Full used to be a wrapping gallery, and it was already emitting the cards
  // in mana-value group order -- the playtester read it on 2026-08-29 and could not
  // tell: "the cards should be sorted by mana cost even when they are in full
  // expanded view not only in compact view". A run of faces that wraps has no
  // column boundaries and no counts, so the order it was in was not a thing
  // the drawing said. It says it now.
  return createElement(CurveColumns<DslCard>, {
    groups: cardGroups(props.cards, props.weigh, props.grouping),
    view: props.mode,
    label: props.label,
    faces: (group) => group.members.map(face),
    ...(props.flow === undefined ? {} : { flow: props.flow }),
  });
}

/**
 * The pool pane at compact density: one name strip per distinct card.
 *
 * `mtg-eeqnj`. `cardPane` drew this pane as small card-shaped tiles at every
 * density -- titles and no pictures at compact, so the mtg-mxkrk ask was met,
 * but a second drawing under the one word "Compact list" the deck pane's own
 * strips already answer. This is that answer for the pool: `StripColumns` at
 * `compact`, the way `deckStrips` below draws it for the deck.
 *
 * A pool strip is not a copy the way a deck strip is. `./strips.ts`'s
 * `StripFacts.copies` says as much: "A pool pane says 1; a deck pane says the
 * count." Every card in the pool is exactly one strip regardless of how many
 * are already played, because the pool lists what is playable and the deck
 * pane already says what is played.
 *
 * The gestures are the pool's own, unchanged from what `cardFace` already
 * wires onto the full-density face one branch up: a click reads the card, a
 * double click plays a copy, a right click (or the context-menu key) cuts
 * one. `onHover` carries the strip's own anchor so the floating preview keeps
 * following the pointer the way `cardFace`'s `onMouseEnter`/`onFocus` do.
 */
function poolStrips(props: {
  readonly cards: readonly DslCard[];
  readonly grouping: Grouping;
  readonly weigh: (card: DslCard) => number;
  readonly label: string;
  readonly onSelect: (cardId: string) => void;
  readonly onAdd: (cardId: string) => void;
  readonly onCut: (cardId: string) => void;
  readonly pickedId?: string;
  readonly onPoint?: (card: DslCard | null, at: Pointed) => void;
}): ReactElement {
  return createElement(StripColumns<DslCard>, {
    groups: cardGroups(props.cards, props.weigh, props.grouping),
    factsOf: (card: DslCard) => cardStripFacts(card, card.id, 1),
    density: 'compact',
    ...(props.pickedId === undefined ? {} : { selectedKey: `${props.pickedId}#1` }),
    onSelect: (strip: Strip<DslCard>): void => {
      props.onSelect(strip.member.id);
    },
    onActivate: (strip: Strip<DslCard>): void => {
      props.onAdd(strip.member.id);
    },
    onMenu: (strip: Strip<DslCard>): void => {
      props.onCut(strip.member.id);
    },
    label: props.label,
    ...(props.onPoint === undefined
      ? {}
      : {
          onHover: (strip: Strip<DslCard>, hovered: boolean, at: { x: number; y: number }): void => {
            props.onPoint?.(hovered ? strip.member : null, at);
          },
        }),
  });
}

/**
 * The deck pane at compact density: one strip per copy, the way MTGO draws a deck.
 *
 * `mtg-pmpu.1`. The pane used to draw its compact density as columns of *faces*,
 * one face per distinct card with a copy count beside it. The 2026-08-29
 * captures draw the two panes of a deck editor differently on purpose, and the
 * difference is what each pane is for: a collection is a grid of whole cards you
 * are reading, and a deck is count-headed columns of overlapping name bars,
 * because the question there is how many of each and what the shape of the whole
 * list is. So the deck pane moves onto `./StripColumns.ts`.
 *
 * The pool pane kept its faces at compact until `mtg-eeqnj`: the playtester,
 * 2026-09-17, "compact should be titles only and consistent across all pages"
 * -- a pool at compact was a small card-shaped tile, title and type line and
 * count with no art, which met the letter of `mtg-mxkrk`'s ask and left a
 * second drawing under the one word "Compact list". `poolStrips` above is the
 * pool's own copy of this function, drawing name strips instead.
 *
 * Both densities since `mtg-rgc.21`. It was compact only, and full was a gallery
 * of whole cards; what the gallery could not say is the one thing the columns
 * exist to say, which is the shape of the curve. So full is these columns with
 * whole faces in them, overlapped so the deck still fits a box that does not
 * move, and the copy somebody selects opens in place.
 *
 * A copy is a strip, so a four-of is four objects the count above the column
 * literally counts, and the strip that is selected is a *copy* rather than a
 * card. That is the whole reason the pane can drop the per-face `+`/`-` pair:
 * the moves move to `deckSelectionBar` and act on the copy under the outline.
 */
function deckStrips(props: {
  readonly cards: readonly DslCard[];
  readonly build: ConstructedBuild;
  readonly grouping: Grouping;
  readonly density: DeckViewMode;
  readonly label: string;
  readonly selectedKey: string | undefined;
  readonly onSelect: (strip: Strip<DslCard>) => void;
  readonly onAdd: (cardId: string) => void;
  readonly onCut: (cardId: string) => void;
  readonly artFor?: PositionArt;
}): ReactElement {
  const copies = (card: DslCard): number => copiesOf(props.build, card.id);
  return createElement(StripColumns<DslCard>, {
    groups: cardGroups(props.cards, copies, props.grouping),
    factsOf: (card: DslCard) => cardStripFacts(card, card.id, copies(card)),
    density: cardDensity(props.density),
    selectedKey: props.selectedKey,
    onSelect: props.onSelect,
    // The pane's own move on a copy of a card that is already played is to cut
    // it, and the reverse is to play another. Same two gestures the faces had,
    // same way round; what changed is that a click now selects instead of
    // acting, so both are reachable from a bar that names them.
    onActivate: (strip: Strip<DslCard>): void => {
      props.onCut(strip.member.id);
    },
    onMenu: (strip: Strip<DslCard>): void => {
      props.onAdd(strip.member.id);
    },
    label: props.label,
    renderFace: (card: DslCard, gestures: StripFaceGestures) => stripFace(card, gestures, props.artFor),
  });
}

/**
 * A whole face inside a strip, wearing the strip's own gestures.
 *
 * The face is the button at this density (`../deck/StripColumns.ts`'s
 * `StripFaceGestures`), so the two accelerators the strip composed are handed
 * to it rather than to a wrapper: a double click still cuts the copy under the
 * pointer and a right click still plays another, which is the grammar the
 * compact strips already had and the faces had before them.
 *
 * The picture is deferred here and nowhere else in this pane. A full-density
 * pool is ninety whole faces, every one of them with an illustration in it, and
 * only the open card in each column is fully on screen.
 */
function stripFace(
  card: DslCard,
  gestures: StripFaceGestures,
  artFor: PositionArt | undefined,
): ReactElement {
  return createElement(Card, {
    card,
    size: 'full',
    deferArt: true,
    art: artFor?.(card) ?? null,
    selected: gestures.selected,
    onSelect: gestures.onSelect,
    ...(gestures.onActivate === undefined ? {} : { onActivate: gestures.onActivate }),
    ...(gestures.onMenu === undefined ? {} : { onMenu: gestures.onMenu }),
  });
}

/** Drops the selection, named so a test and a reader agree what the button is. */
export const CLEAR_SELECTION_LABEL = 'Clear selection';

/**
 * What is selected in the deck pane, and the two moves that act on it.
 *
 * The strips replace a `+`/`-` pair drawn under every face, and those buttons
 * were the whole of this screen's answer to "a right click is not a keyboard
 * move and is not a touch move" (`addCopyLabel`). A 26px name bar has no room
 * under it for two buttons, so the buttons move here — one bar, above the
 * columns, acting on the copy the reader outlined. Nothing became gesture-only.
 *
 * Above the columns rather than beside the selected strip, which is
 * `../DeckRoute.ts`'s argument: a popover anchored to a strip covers the two
 * strips under it, and those are the copies being compared against.
 *
 * It draws only while the selected copy still exists. Cutting the fourth copy
 * of a four-of leaves a key that names nothing, and a bar reporting a card at
 * zero copies with a live `Cut` button on it is worse than no bar; the caller
 * derives that from the build rather than clearing it in an effect.
 */
function deckSelectionBar(props: {
  readonly strip: Strip<DslCard>;
  readonly copies: number;
  readonly onAdd: (cardId: string) => void;
  readonly onCut: (cardId: string) => void;
  readonly onClear: () => void;
}): ReactElement {
  const card = props.strip.member;
  return createElement(
    'div',
    {
      className: 'mtg-deck__selection',
      role: 'group',
      'aria-label': `Selected: ${stripLabel(props.strip)}`,
    },
    createElement('span', { className: 'mtg-deck__selection-name' }, stripLabel(props.strip)),
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-btn',
        'aria-label': cutCopyLabel(card.name),
        disabled: props.copies === 0,
        onClick: (): void => {
          props.onCut(card.id);
        },
      },
      'Cut this one',
    ),
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-btn',
        'aria-label': addCopyLabel(card.name),
        disabled: props.copies >= CONSTRUCTED_COPY_LIMIT,
        onClick: (): void => {
          props.onAdd(card.id);
        },
      },
      'Add another',
    ),
    createElement('span', { className: 'mtg-toolbar__spacer' }),
    createElement(
      'button',
      { type: 'button', className: 'mtg-btn', onClick: props.onClear },
      CLEAR_SELECTION_LABEL,
    ),
  );
}

/**
 * The three facets, as controls.
 *
 * The set facet is drawn only when the pool draws on more than one set, because
 * a filter with one value narrows nothing and its only effect would be to let
 * somebody switch the whole pool off. It appears the day a second playable set
 * is staged, which is what the pool document is for.
 */
function filterPanel(props: {
  readonly filter: PoolFilter;
  readonly setCodes: readonly string[];
  readonly onFilter: (filter: PoolFilter) => void;
  readonly shown: number;
  readonly total: number;
}): ReactElement {
  const { filter, onFilter } = props;
  return createElement(
    'div',
    { className: 'mtg-toolbar', role: 'group', 'aria-label': 'Narrow the pool' },
    createElement('label', { className: 'mtg-fact__label', htmlFor: 'mtg-pool-search' }, SEARCH_LABEL),
    createElement('input', {
      id: 'mtg-pool-search',
      type: 'search',
      className: 'mtg-input',
      value: filter.text,
      placeholder: 'name, type or rules text',
      onChange: (event: { readonly target: { readonly value: string } }): void => {
        onFilter(withText(filter, event.target.value));
      },
    }),
    ...poolFacetButtons({ filter, onFilter }),
    ...(props.setCodes.length > 1
      ? props.setCodes.map((code) =>
          createElement(
            'button',
            {
              key: `set-${code}`,
              type: 'button',
              className: 'mtg-btn',
              'aria-pressed': filter.sets.includes(code),
              onClick: (): void => {
                onFilter(toggleSet(filter, code));
              },
            },
            code,
          ),
        )
      : []),
    createElement('span', { className: 'mtg-toolbar__spacer' }),
    counter('showing', `${String(props.shown)}/${String(props.total)}`),
    clearFilterButton({ filter, onFilter }),
  );
}

export function ConstructedBuilder(props: ConstructedBuilderProps): ReactElement {
  const { build, deck } = props;
  // Both panes hold DSL cards, and a DSL card carries a rarity, so both offer
  // every axis. `offeredGroupings` exists for the pane that cannot — a built
  // artifact's entry, over in `../DeckRoute.ts` — and there is nothing to
  // derive here, which is why `usePaneControls` offers `GROUPINGS` flat.
  // The deck offers a decklist or whole cards and opens on the list; the pool
  // offers the two card densities (`./view-mode.ts`, `mtg-umro`).
  const deckControls = usePaneControls('constructed-deck', undefined, PANE_DECKLIST_VIEWS);
  const poolControls = usePaneControls('constructed-pool', undefined, PANE_CARD_VIEWS);
  const deckView = deckControls.view;
  const poolView = poolControls.view;
  // How the workbench is shared out, once somebody has said: `./builder-split.ts`.
  const split = useBuilderSplit('constructed');
  const pane = useBuilderPane();
  const [filter, setFilter] = useState<PoolFilter>(WHOLE_POOL);
  // Which copy in the deck pane is under the outline. Transient and per pane,
  // for `../DeckRoute.ts`'s reason: it is what you are about to act on, and a
  // reload that remembered it would reopen the builder with a card lit up for
  // no reason anybody could recall.
  const [selected, setSelected] = useState<Strip<DslCard> | null>(null);
  /**
   * The card under the outline in the decklist, by id.
   *
   * Not a `Strip`, and that is the difference between the two drawings rather
   * than an omission: a strip is one *copy* of a card and carries which copy it
   * is, which is what `deckSelectionBar`'s two moves act on. A row is the card
   * with its copies written on it and carries its own `+`/`-` pair, so it needs
   * no bar above the columns and has no copy to name. Both are transient and
   * neither is stored, for `../DeckRoute.ts`'s reason.
   */
  const [picked, setPicked] = useState<string | null>(null);
  /** The card under the outline in the collection. Same rule, other pane. */
  const [poolPick, setPoolPick] = useState<string | null>(null);
  /**
   * The card being pointed at or focused, and where, so it can be read in full
   * without the collection drawing every face at reading size (`./CardPreview.ts`).
   *
   * The window is captured when the pointer arrives rather than watched: this is
   * live for as long as a pointer rests on one card, and a resize listener held
   * for that is a listener held for the whole session.
   */
  const [preview, setPreview] = useState<Peek | null>(null);
  const point = (card: DslCard | null, at: Pointed): void => {
    if (card === null) {
      setPreview(null);
      return;
    }
    const viewport = readViewport();
    // No window is no preview, which is a server render and every Node rig.
    if (viewport === null) return;
    setPreview({ card, x: at.x, y: at.y, viewport, rootPx: readRootPx() });
  };

  // Indexed once per pool rather than per keystroke: the haystack includes the
  // rendered rules text, and rendering 368 of those on every character typed is
  // the difference between a pane that keeps up and one that does not.
  const entries = useMemo(() => indexPool(selectable(build.pool)), [build.pool]);
  const setCodes = useMemo(() => setCodesIn(build.pool), [build.pool]);
  const shown = useMemo(() => filterPool(entries, filter), [entries, filter]);

  const inDeck = chosenCards(build);
  const distinct = build.pool.filter((card) => copiesOf(build, card.id) > 0);
  const curve = manaCurve(build);
  const copies = (card: DslCard): number => copiesOf(build, card.id);
  const one = (): number => 1;
  // Derived rather than stored: a cut can take the copy the outline was on, and
  // the key then names nothing. See `deckSelectionBar`.
  const held = selected === null ? 0 : copies(selected.member);
  const selection = selected !== null && held >= selected.copy ? selected : null;

  const counts = builderCounts(inDeck, deck);
  const playReason = playBlocked(deck);
  const clearReason = clearBlocked(inDeck.length);
  const blocked: readonly BlockedControl[] = [
    ...(clearReason === null ? [] : [{ label: CLEAR_DECK_LABEL, reason: clearReason }]),
    ...(playReason === null ? [] : [{ label: PLAY_LABEL, reason: playReason }]),
  ];

  // Notes, not blockers, with one exception the sealed screen does not have: a
  // fifth copy is against the rules of the format rather than against the odds,
  // so it is reported here *and* keeps the play buttons dark through
  // `deck.complete`.
  //
  // The first of them is dropped, because it is the sentence the dark play
  // buttons above already carry: printing it twice on a 390px screen reads as
  // two separate problems with the deck (`mtg-dcxg.7`).
  const noteLines: readonly string[] = legalityNotes(deck).filter((note) => note !== playReason);

  const refusals: readonly string[] = [...blockedNotes(blocked), ...noteLines];

  const action = (
    label: string,
    reason: string | null,
    onClick: () => void,
    primary: boolean,
    explain?: string,
  ) => {
    // The refusal when there is one, and otherwise whatever the control has to
    // say for itself. A dark button carries the sentence that would otherwise be
    // a line of prose under the row; a live one carries the fact a player cannot
    // see from the board (`MIRROR_NOTE`). Both are the same slot because both
    // are the same question asked of the same button.
    const title = reason ?? explain;
    return createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-btn',
        ...(primary ? { 'data-variant': 'primary' } : {}),
        disabled: reason !== null,
        ...(title === undefined ? {} : { title }),
        onClick,
      },
      label,
    );
  };

  /**
   * One bar, holding everything on this screen that is not a card.
   *
   * `mtg-i8xl`. Measured at 1600x1000 with 36 cards in the deck, this screen
   * spent 368 of 1000 pixels above its panes: a 59px page head with the title
   * and one button, a 66px counts bar, a 38px saved-decks bar, a row of written
   * decks to start from, and the legality notes as a bulleted list. The pool
   * pane was left 231px, of which 152 was the scrollport holding 26,769px of
   * cards. the playtester, 2026-08-31: "there is too much empty vertical and
   * horizontal space, the playable-card browser is compressed into a shallow
   * strip".
   *
   * So the title and the way out move in here, the saved decks become a
   * disclosure that opens *over* the workspace rather than pushing it down, the
   * starters move into the empty deck pane (which is the only state they act on
   * anyway), and the legality notes are carried on the bar. Nothing is removed:
   * every control and every sentence is still on the screen and still reachable
   * by name.
   */
  const summary = createElement(
    'div',
    { className: 'mtg-toolbar mtg-builder__bar' },
    props.title === undefined
      ? null
      : createElement('h1', { className: 'mtg-page-title mtg-builder__title' }, props.title),
    // The counts are the deck pane's note and are not repeated here
    // (`mtg-84703`), and the colors are pips rather than words for the same
    // reason. `./DeckColors.ts` argues both; the sentence each drawing replaced
    // is still the element's accessible name.
    deckColorsIndicator(deck.colors),
    createElement('span', { className: 'mtg-toolbar__spacer' }),
    createElement(SavedDecksPanel, {
      build,
      onLoad: props.onLoad,
      ...(props.openSavedDeckId === undefined ? {} : { openDeckId: props.openSavedDeckId }),
      ...(props.setOf === undefined ? {} : { setOf: props.setOf }),
      ...(props.openFiles === undefined ? {} : { openFiles: props.openFiles }),
      ...(props.arrivedWithDeck === undefined ? {} : { arrivedWithDeck: props.arrivedWithDeck }),
      ...(props.onOpenDeckChange === undefined ? {} : { onOpenDeckChange: props.onOpenDeckChange }),
    }),
    action(CLEAR_DECK_LABEL, clearReason, props.onClear, false),
    action(
      PLAY_LABEL,
      playReason,
      props.onPlay,
      true,
      props.opponentName === undefined ? MIRROR_NOTE : matchNote(props.opponentName),
    ),
    props.onBack === undefined
      ? null
      : createElement(
          'button',
          { type: 'button', className: 'mtg-btn', onClick: props.onBack },
          DECKS_BACK_LABEL,
        ),
    // Both kinds of refusal in one list. `blockedNotes` says which controls are
    // dark and why; `noteLines` says what else the deck is failing. They were
    // two bands and they answer the same question, so they are one list that
    // wraps and, past two lines of it, scrolls: a deck with eleven cards over
    // the copy limit is a deck with eleven sentences, and none of them may push
    // the pool off the screen.
    refusals.length === 0
      ? null
      : createElement(
          'ul',
          { className: 'mtg-builder__notes', 'aria-label': BUILDER_NOTES_LABEL },
          ...refusals.map((note) => createElement('li', { key: note }, note)),
        ),
    // Last, so on a phone it is the row of the bar nearest the pane it switches;
    // drawn only there, because the stylesheet hides it above the split query.
    // It is in the bar rather than beside the panes so that it inherits the
    // bar's stickiness: `./builder-panes.ts` says why there may be only one
    // sticky region here.
    builderPaneSwitch({ state: pane, deckLabel: DECK_LABEL, poolLabel: CONSTRUCTED_POOL_LABEL }),
  );

  const starters = props.starters ?? [];
  // Only while the deck is empty, and that is about what the control does
  // rather than about the width of the row: `ConstructedGame`'s `onStart`
  // REPLACES the build, so pressing a written deck's name over sixty cards you
  // chose throws them away with no confirmation and no undo. Empty is the state
  // it is for — seeding an editor that has nothing in it — and after `Clear the
  // deck` it is one press away again. It also takes a band of chrome off the
  // screen for the whole of the time somebody is actually building a deck,
  // which is requirement 8 of the interface pass.
  const startRow =
    starters.length === 0 || props.onStart === undefined || inDeck.length > 0
      ? null
      : createElement(
          'div',
          {
            className: 'mtg-toolbar mtg-builder__starters',
            role: 'group',
            'aria-label': 'Start from a written deck',
          },
          createElement('span', { className: 'mtg-fact__label' }, 'Start from'),
          ...starters.map((starter) =>
            createElement(
              'button',
              {
                key: starter.id,
                type: 'button',
                className: 'mtg-btn',
                onClick: (): void => {
                  props.onStart?.(starter.id);
                },
              },
              starter.name,
            ),
          ),
        );

  return createElement(
    'div',
    // `data-builder` rather than a second screen class: the sealed builder next
    // door shares every class here and keeps the stacked workbench `mtg-8osf`
    // argued for, because its deck pane draws mana-value columns and this one
    // draws a list. `../../styles/deck.ts` is where the two arrangements part.
    { className: 'mtg-builder', 'data-builder': 'constructed' },
    summary,
    createElement(
      'div',
      {
        className: 'mtg-builder__panes',
        // Which pane a phone is showing, and nothing at all on a desk, where the
        // stylesheet restores both: `./builder-panes.ts`.
        'data-showing': pane.showing,
        'data-expanded': pane.expanded ?? 'split',
        // The split the person dragged, or nothing at all: `./builder-split.ts`.
        ...(split.share === null ? {} : { style: builderSplitStyle(split.share) }),
      },
      createElement(
        DeckPane,
        {
          kind: 'deck',
          label: DECK_LABEL,
          note: builderCountsLine(counts),
          controls: deckControls,
          actions: builderPaneExpansionControl({ state: pane, pane: 'deck', label: DECK_LABEL }),
          above: createElement(
            Fragment,
            null,
            curveStrip(curve),
            createElement(BasicsPanel, {
              deck,
              chosen: build.basics !== null,
              onAdjustBasics: props.onAdjustBasics,
              onSuggestBasics: props.onSuggestBasics,
            }),
            selection !== null
              ? deckSelectionBar({
                  strip: selection,
                  copies: held,
                  onAdd: props.onAdd,
                  onCut: props.onCut,
                  onClear: (): void => {
                    setSelected(null);
                  },
                })
              : null,
          ),
        },
        // Three drawings, and only one of them per state. A decklist is what the
        // pane opens in and what a third of the workbench holds (`mtg-umro`);
        // `deckStrips` is the card view and says why the two panes of this
        // screen draw the same density differently; `cardPane` is only what an
        // empty deck says.
        distinct.length === 0
          ? cardPane({
              cards: distinct,
              build,
              label: DECK_CARDS_LABEL,
              empty: EMPTY_DECK_NOTE,
              ...(startRow === null ? {} : { emptyExtra: startRow }),
              mode: cardDensity(deckView.mode),
              grouping: deckControls.grouping.grouping,
              weigh: copies,
              onSelect: props.onCut,
              onMenu: props.onAdd,
              onAdd: props.onAdd,
              onCut: props.onCut,
              ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
            })
          : deckView.mode === 'list'
            ? createElement(DeckListRows, {
                groups: cardGroups(distinct, copies, deckControls.grouping.grouping),
                copiesOf: copies,
                ...(picked === null ? {} : { selectedId: picked }),
                onSelect: (card: DslCard): void => {
                  setPicked(card.id);
                },
                onAdd: props.onAdd,
                onCut: props.onCut,
                label: DECK_CARDS_LABEL,
                addLabel: addCopyLabel,
                cutLabel: cutCopyLabel,
                onPoint: point,
              })
            : deckStrips({
                cards: distinct,
                build,
                grouping: deckControls.grouping.grouping,
                density: deckView.mode,
                label: DECK_CARDS_LABEL,
                selectedKey: selection?.key,
                onSelect: setSelected,
                onAdd: props.onAdd,
                onCut: props.onCut,
                ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
              }),
      ),
      createElement(
        DeckPane,
        {
          kind: 'pool',
          label: CONSTRUCTED_POOL_LABEL,
          note: props.poolNote ?? POOL_NOTE,
          controls: poolControls,
          actions: builderPaneExpansionControl({
            state: pane,
            pane: 'pool',
            label: CONSTRUCTED_POOL_LABEL,
          }),
          above: filterPanel({
            filter,
            setCodes,
            onFilter: setFilter,
            shown: shown.length,
            total: entries.length,
          }),
        },
        cardPane({
          cards: shown.map((entry) => entry.card),
          build,
          // The collection is a column of the workbench since `mtg-x6xq`, so its
          // groups stack and their faces wrap: `./CurveColumns.ts`, `mtg-xiso`.
          flow: 'rows',
          label: CONSTRUCTED_POOL_LABEL,
          empty: filter.text.trim() === '' ? EMPTY_FILTERED_POOL_NOTE : emptySearchNote(filter.text),
          mode: poolView.mode,
          grouping: poolControls.grouping.grouping,
          weigh: one,
          // MTGO's grammar, and the one the playtester asked for (`mtg-d0y1`): a
          // click reads a card and a double click plays a copy of it. It was a
          // click to play and a right click to cut, which is fast and is a
          // single mis-aimed press away from a card in the deck you did not
          // choose -- the same argument `mtg-pmpu.1` made about the deck pane's
          // 26px strips, one pane over. The right click keeps its cut, the
          // `+`/`-` pair under the face keeps both moves for anyone who cannot
          // double click, and nothing became gesture-only.
          onSelect: (cardId: string): void => {
            setPoolPick(cardId);
          },
          onActivate: props.onAdd,
          onMenu: props.onCut,
          onAdd: props.onAdd,
          onCut: props.onCut,
          ...(poolPick === null ? {} : { pickedId: poolPick }),
          onPoint: point,
          ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
        }),
      ),
      builderSplitHandle(split, 'constructed'),
    ),
    preview === null
      ? null
      : createElement(CardPreview, {
          anchor: preview,
          art: props.artFor?.(preview.card) ?? null,
          viewport: preview.viewport,
          rootPx: preview.rootPx,
        }),
  );
}
