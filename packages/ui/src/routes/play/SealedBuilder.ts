/**
 * The sealed deckbuilding screen.
 *
 * Six packs on the left, the deck being built on the right, and a start button
 * that is only live when the deck is legal. The suggestion is loaded on arrival
 * rather than hidden behind a button, because a blank 72-card pool is a worse
 * starting point than a build to argue with, and every card in it can be
 * clicked off.
 *
 * The mana base is offered the same way. It arrives apportioned from the chosen
 * spells and every basic in it can be counted up or down, because how a splash
 * gets paid for is a decision rather than a sum. What the screen never asks
 * anybody to work out is what their base supports: that is arithmetic, and the
 * panel reports it back at them.
 *
 * # Two panes, and they are the Constructed builder's
 *
 * `mtg-aqxi.4`. This screen stacked a toolbar, a deck panel and a pool panel
 * down the page at every width, which puts the pool a scroll below the deck on
 * the screen whose entire activity is moving cards between the two, and on a
 * landscape phone that scroll is most of a page. So it takes the vocabulary
 * `../deck/ConstructedBuilder.ts` already draws — `mtg-builder__bar` for the
 * running counts, `mtg-builder__panes` for the split, `mtg-deck__pane-head` for
 * each pane's heading — rather than a second grid meaning the same thing.
 * `../../styles/deck.ts` holds it and says where the split happens and why.
 *
 * The mana base moved inside the deck pane, which is the same reading the
 * Constructed screen made of it: counting out lands is part of the deck rather
 * than a panel beside it, and nothing about it differs between the formats.
 */
import { plural } from '../../copy';
import { Fragment, createElement, useEffect, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Color, Card as DslCard } from '@mtg/dsl';
import type { ManualDeck } from '@mtg/deckbuild';
import type { CanonicalBasicName, LimitedDeck, LimitedDeckReport, PreparedPoolCard } from '@mtg/limited';
import { Card } from '../../card/Card';
import { FaceFlip } from '../../card/FaceFlip';
import { BasicsPanel } from '../deck/BasicsPanel';
import { builderSplitHandle, builderSplitStyle, useBuilderSplit } from '../deck/builder-split';
import { builderPaneExpansionControl, builderPaneSwitch, useBuilderPane } from '../deck/builder-panes';
import { builderScreen } from '../deck/BuilderScreen';
import { DeckPane, PANE_LIMITED_CARD_VIEWS, usePaneControls } from '../deck/DeckPane';
import { cardGroupingFacts, cardStripFacts } from '../deck/build';
import { builderCounts, builderCountsLine, poolPaneNote } from '../deck/deck-counts';
import { deckColorsIndicator } from '../deck/DeckColors';
import type { BuilderCounts } from '../deck/deck-counts';
import { StripColumns } from '../deck/StripColumns';
import type { StripFaceGestures } from '../deck/StripColumns';
import type { Strip } from '../deck/strips';
import { FloatingCardPreview, readRootPx, readViewport } from '../deck/CardPreview';
import { stripLabel } from '../deck/strips';
import { groupMembers } from '../deck/grouping';
import { CurveColumns } from '../deck/CurveColumns';
import { offeredGroupings } from '../deck/grouping';
import type { Group, Grouping, GroupingFacts } from '../deck/grouping';
import { clearFilterButton, poolFacetButtons } from '../deck/PoolFacets';
import { admits, indexPool, WHOLE_POOL } from '../deck/pool-filter';
import type { PoolFilter } from '../deck/pool-filter';
import type { ColorFacet } from '../deck/pool-filter';
import { shortfallNote } from '../deck/shortfall-note';
import { GameDetails, GAME_ID_LABEL, GAME_SETUP_LABEL } from '../game-details';
import type { GameDetail } from '../game-details';
import { keepDeck, useDeckKeeping } from '../deck/deck-keeping';
import { newSavedDeckId } from '../deck/saved-decks';
import type { DeckSetRef } from '../deck/library';
import {
  KEEP_DECK_LABEL,
  KEEP_REFUSED_NOTE,
  keptDeckNote,
  limitedDeckName,
  limitedSavedDeck,
} from './keep-limited-deck';
import type { LimitedSource } from './keep-limited-deck';
import { cardDensity } from '../deck/view-mode';
import type { DeckViewMode } from '../deck/view-mode';
import { FoilControl, useDrawFoils } from './foil-preference';
import type { PositionArt } from './position';
import { chosenCards } from './sealed';
import type { SealedBuild } from './sealed';

/** The one primary transition from any completed draft into the game table. */
export const PLAY_DRAFTED_DECK_LABEL = 'Play drafted deck';

export interface LimitedCardPresentation<CardType> {
  readonly nameOf: (card: CardType) => string;
  readonly groupingFactsOf: (card: CardType) => GroupingFacts;
  readonly manaCostOf: (card: CardType) => string | null;
  readonly renderFace: (
    card: CardType,
    options: {
      readonly key?: string;
      readonly physicalId?: string;
      readonly size: 'board' | 'compact' | 'full';
      readonly selected?: boolean;
      readonly deferArt?: boolean;
      readonly footnote?: string;
      /** Which printed face to draw; absent means the front. */
      readonly faceIndex?: number;
      readonly onSelect?: () => void;
      readonly onActivate?: () => void;
      readonly onMenu?: () => void;
      readonly onHover?: (hovered: boolean) => void;
    },
  ) => ReactElement;
  /** The names of a card's printed faces; see `../draft/DraftPack.ts`'s `facesOf`. */
  readonly facesOf?: (card: CardType) => readonly string[];
}

export interface PhysicalLimitedBuilderProps<CardType> {
  readonly physicalDeck: LimitedDeck<CardType>;
  readonly report: LimitedDeckReport;
  readonly presentation: LimitedCardPresentation<CardType>;
  readonly onToggle: (physicalId: string) => void;
  readonly onSuggest: () => void;
  readonly onClear: () => void;
  readonly onAdjustBasic: (name: CanonicalBasicName, delta: number) => void;
  readonly onSuggestBasics: () => void;
  readonly onPlay: () => void;
  readonly seed: string;
  readonly contextNote: string;
  readonly poolLabel?: string;
  readonly playLabel?: string;
  readonly playDisabled?: boolean;
  readonly illegalNote?: string;
  readonly banner?: ReactNode;
  readonly head?: ReactNode;
  /**
   * The screen's name, drawn at the left end of the counts bar.
   *
   * `mtg-84703`, and `../deck/ConstructedBuilder.ts` is the precedent it
   * follows: `mtg-i8xl` took that builder's title out of a page head and put it
   * on the bar, so the name is still the screen's `h1` and what it stops being
   * is a band. The printed pool editor was the last surface still spending a
   * whole row of the window on `Draft complete - Innistrad`.
   */
  readonly title?: string;
  /** Facts folded away under `Game details`, beside the setup and the seed. */
  readonly details?: readonly GameDetail[];
  /** Format-owned actions that still belong in the shared builder toolbar. */
  readonly toolbarExtras?: ReactNode;
}

export interface SealedBuilderProps {
  readonly build: SealedBuild;
  readonly deck: ManualDeck;
  readonly onToggle: (index: number) => void;
  readonly onSuggest: () => void;
  readonly onClear: () => void;
  /** Adds (+1) or cuts (-1) one basic of a color. */
  readonly onAdjustBasics: (color: Color, delta: number) => void;
  /** Hands the deck back to the mana base the picks apportion. */
  readonly onSuggestBasics: () => void;
  /** Starts the game. Enabled only when the deck is legal. */
  readonly onPlay: () => void;
  /**
   * The seed this pool was opened from, shown so the game has a name.
   *
   * The lab deals a fresh pool every time it is opened, which is what a person
   * sitting down to play expects. That is only an improvement over the old
   * pinned constant if the result can still be got back — a pool you cannot
   * name is a pool you cannot report a bug against or hand to someone else.
   * `#/play?seed=<this>` reopens it exactly.
   */
  readonly seed: string;
  /** Names the cards below without pretending every Limited pool is sealed. */
  readonly poolLabel?: string;
  /** Names the primary game action. */
  readonly playLabel?: string;
  /**
   * Explains where this pool and the seat across the table came from.
   *
   * Required, with no default: a note about where a pool came from is a fact
   * its caller holds and this component does not, so there is nowhere here for
   * a correct default to come from and no call site that gets to skip the
   * question.
   */
  readonly contextNote: string;
  /**
   * The screen's head bar, or nothing.
   *
   * The frame is this component's since `mtg-sk1c` and the bar above it is not,
   * because the bar is the only part of a deckbuilding screen that differs by
   * host: `../draft/DraftGame.ts` names the activity, and a sealed pool opened
   * from the Play tab has nothing to say that the shell bar has not said.
   */
  readonly head?: ReactNode;
  /**
   * The screen's name, drawn at the left end of the counts bar.
   *
   * `mtg-84703`, and `../deck/ConstructedBuilder.ts` is the precedent it
   * follows: `mtg-i8xl` took that builder's title out of a page head and put it
   * on the bar, so the name is still the screen's `h1` and what it stops being
   * is a band. The printed pool editor was the last surface still spending a
   * whole row of the window on `Draft complete - Innistrad`.
   */
  readonly title?: string;
  /** Facts folded away under `Game details`, beside the setup and the seed. */
  readonly details?: readonly GameDetail[];

  /**
   * The host's own chrome, drawn above the counts bar and inside the frame.
   *
   * `../play/RemoteSealed.ts` shows the room's invite and whatever the poll last
   * reported, and those are the room's business rather than the build's. They
   * go in the box `../../styles/deck.ts` already caps and scrolls, because a
   * frame divides a fixed height and anything outside that box takes what it
   * asks for and leaves the panes the rest.
   */
  readonly banner?: ReactNode;
  /** Art for full card faces in the deck and pool panes. */
  readonly artFor?: PositionArt;
  /**
   * Which surface this is, which is what a kept deck records about itself.
   *
   * Required, for `contextNote`'s reason: this component is the build screen for
   * both Limited formats, and the difference between a sealed pool and a drafted
   * one is a fact its caller holds. A default here would be a guess written into
   * every deck the other surface saves.
   */
  readonly source: LimitedSource;
  /**
   * The set the pool was dealt from, so a kept deck shelves under it.
   *
   * Absent where the page cannot name one — a lab opened on a flat set document
   * has no index row behind it and so no origin to record — and a deck that
   * names no set is shelved as exactly that rather than filed under a guess
   * (`../deck/library.ts`).
   */
  readonly setRef?: DeckSetRef;
}

export const SEALED_POOL_LABEL = 'Sealed pool';

/** The deck pane's heading, which is also the name a reading looks it up by. */
export const DECK_LABEL = 'Your deck';

/**
 * What each pane says when it is drawing no faces.
 *
 * A titled column over a blank page is the failure the 2026-08-23 cleanup wave
 * named in the Constructed builder, and until the color facets landed neither
 * sealed pane could reach it: the pool is what the suggestion did not play, and
 * the suggestion never plays all of it. A facet can empty it in one press.
 */
export const EMPTY_SEALED_DECK_NOTE = 'No cards yet. Click a card in the pool to play it.';

/** Names the cards region inside the deck pane, apart from the pane's own heading. */
export const DECK_CARDS_LABEL = 'Cards in your deck';

/** Cuts the selected copy. Named here so the bar, the strip and a test agree. */
export function returnToPoolLabel(name: string): string {
  return `Return ${name} to the pool`;
}

/** Drops the selection without moving anything. */
export const CLEAR_SELECTION_LABEL = 'Clear selection';

export const EMPTY_SEALED_FILTER_NOTE = 'No card outside your deck matches the colors you have chosen.';

/** The other way a pool empties, and it is a report rather than a dead end. */
export const EMPTY_SEALED_POOL_NOTE = 'Every card in this pool is in the deck.';

/**
 * Names the fact carrying the seed, so a test can read it back.
 *
 * It is `../game-details.ts`'s label rather than one of its own, and it is no
 * longer a counter in the toolbar: `seed lab/sealed/…` beside "pool 78" put a
 * namespaced token in the primary chrome of the deckbuilding screen, which
 * The playtester's interface pass names as an example of what must not be there.
 * The value still reproduces the pool exactly; it is now read by whoever went
 * looking for it.
 */
export const SEED_LABEL = GAME_ID_LABEL;

function counter(label: string, value: string): ReactElement {
  return createElement(
    'span',
    { key: label, className: 'mtg-fact' },
    createElement('span', { className: 'mtg-fact__label' }, label),
    createElement('span', { className: 'mtg-fact__value' }, value),
  );
}

/**
 * One face, and the copies of it this pane is showing.
 *
 * Six packs hand out three of a common often enough that drawing every copy
 * made the pool pane a list with the same tile in it three times, which is
 * three things to read past and one decision. `../deck/ConstructedBuilder.ts`
 * settled the shape for the other builder and this is it: one face, the count
 * written on it.
 *
 * The click moves the first copy the pane is showing, which is the whole of
 * what a copy is — `SealedBuild.chosen` holds pool positions, and two positions
 * holding the same card differ in nothing a player can see.
 */
function poolCard(
  build: SealedBuild,
  indexes: readonly number[],
  onToggle: (index: number) => void,
  mode: DeckViewMode,
  artFor: PositionArt | undefined,
  foils: ReadonlySet<number> | null,
): ReactElement {
  const index = indexes[0];
  if (index === undefined) throw new Error('a card group with no copies in it');
  const card: DslCard | undefined = build.pool[index];
  if (card === undefined) throw new Error(`sealed pool has no card at index ${String(index)}`);
  const chosen = build.chosen.includes(index);
  const face = createElement(Card, {
    card,
    size: cardDensity(mode),
    art: artFor?.(card) ?? null,
    selected: chosen,
    // Omitted where the pool took no measurement or the setting is off, which
    // is the third state `../../card/anatomy.ts` argues for: a face with no
    // `data-foil` on it is a face nobody asked the question of.
    ...(foils === null ? {} : { foil: foils.has(index) }),
    ...(chosen ? { footnote: 'in deck' } : {}),
    onSelect: (): void => {
      onToggle(index);
    },
  });
  return createElement(
    'div',
    {
      // Keyed by the first copy's position rather than the card id: the same
      // card appears in both panes when some copies are played and some are not.
      key: `pool-${String(index)}`,
      className: 'mtg-copies',
      'data-copies': String(indexes.length),
    },
    face,
    indexes.length > 1
      ? createElement('span', { className: 'mtg-copies__count' }, `x${String(indexes.length)}`)
      : null,
  );
}

/**
 * Positions of one card, in pane order, so the duplicates draw as one face.
 *
 * **A foil copy is its own group.** Collapsing copies is right because two
 * positions holding the same card differ in nothing a player can see, and that
 * stops being true the moment the pool can name one of them as a foil: a pack
 * that dealt three commons and a foil of one of them would otherwise draw an
 * `x2` with one sheen over it, which is the flattening `mtg-11yd` was filed
 * about arriving one layer higher up. A pool that took no measurement groups by
 * card id exactly as before, because there is nothing to separate.
 */
function byCard(
  build: SealedBuild,
  indexes: readonly number[],
  foils: ReadonlySet<number> | null,
): readonly (readonly number[])[] {
  const groups = new Map<string, number[]>();
  for (const index of indexes) {
    const card = build.pool[index];
    if (card === undefined) throw new Error(`sealed pool has no card at index ${String(index)}`);
    const key = foils === null ? card.id : `${card.id}|${String(foils.has(index))}`;
    const held = groups.get(key);
    if (held === undefined) groups.set(key, [index]);
    else held.push(index);
  }
  return [...groups.values()];
}

/**
 * Pool indexes grouped onto the pane's chosen axis without losing duplicate copies.
 *
 * The grouping and the sort are `../deck/grouping`'s, which is the one copy of
 * that rule (`mtg-xzxs`, and this was the fourth). What stays here is the only
 * part that is this pane's: a member is a pool *index* rather than a card,
 * because the pane toggles positions and two copies of one card are two
 * positions, so the card has to be read back out of the build before its facts
 * can be asked for. A land is mana value 0 by the same reading the pool pane
 * uses everywhere else, which is `cardGroupingFacts`'s rather than this file's.
 *
 * `weigh` is one per index rather than per distinct card: this pane's column
 * header counts the cards sitting in the column, and a second copy is a second
 * card there even though `byCard` later draws the two as one face.
 */
export function sealedGroups(
  build: SealedBuild,
  indexes: readonly number[],
  grouping: Grouping,
): readonly Group<number>[] {
  return groupMembers(
    indexes,
    (index) => {
      const card = build.pool[index];
      if (card === undefined) throw new Error(`sealed pool has no card at index ${String(index)}`);
      return cardGroupingFacts(card);
    },
    () => 1,
    grouping,
  );
}

function cardPane(props: {
  readonly build: SealedBuild;
  readonly indexes: readonly number[];
  readonly label: string;
  readonly mode: DeckViewMode;
  readonly grouping: Grouping;
  readonly onToggle: (index: number) => void;
  /** What the pane says when it holds nothing. Required, so no call site forgets one. */
  readonly empty: string;
  readonly artFor?: PositionArt;
  /**
   * Which positions wear the sheen, or `null` for a pane not drawing it: the
   * pool measured nothing, or the setting is off. `null` rather than an empty
   * set on purpose — it also decides whether a foil copy groups apart from an
   * ordinary one, and an empty set would split nothing while still publishing
   * `data-foil="false"` on every face.
   */
  readonly foils: ReadonlySet<number> | null;
}): ReactElement {
  if (props.indexes.length === 0) {
    // Inside the group rather than beside it: a reader who navigated to this
    // name lands somewhere that still carries it.
    return createElement(
      'div',
      { className: 'mtg-gallery', role: 'group', 'aria-label': props.label, 'data-view': 'empty' },
      createElement('p', { className: 'mtg-prompt__explain' }, props.empty),
    );
  }
  // Compact draws name strips, the way `poolStrips` does one file over
  // (`mtg-eeqnj`). Only the pool pane ever reaches this branch with a
  // non-empty list: the deck pane's own call above returns at the empty
  // check, since it is only used for its empty state. One strip per position,
  // uncollapsed even where the full-density face above would merge two
  // ordinary copies under an `x2` -- a strip is already a grabbable object
  // per copy, which is the deck pane's own grammar (`../deck/strips.ts`'s docblock),
  // so a card dealt three times draws three strips rather than one tile
  // wearing a count. `foil` still rides along per position, the same fact
  // `poolCard`'s face carries below, so a foil copy still says so once it has
  // no picture to say it with.
  if (props.mode !== 'full') {
    return createElement(StripColumns<number>, {
      groups: sealedGroups(props.build, props.indexes, props.grouping),
      factsOf: (index: number) => {
        const card = props.build.pool[index];
        if (card === undefined) throw new Error(`sealed pool has no card at index ${String(index)}`);
        return {
          ...cardStripFacts(card, `pool-${String(index)}`, 1),
          ...(props.foils === null ? {} : { foil: props.foils.has(index) }),
        };
      },
      density: 'compact',
      // A click is the pane's whole move -- toggling a pool position into the
      // deck -- the same as the full-density face's own `onSelect` above.
      // There is no second gesture to protect here, so no `onActivate` or
      // `onMenu` is passed.
      onSelect: (strip: Strip<number>): void => {
        props.onToggle(strip.member);
      },
      label: props.label,
    });
  }
  // Both densities, one arrangement, which is `../deck/ConstructedBuilder.ts`'s
  // change and the same sentence of the playtester's behind it: a full view that
  // wraps has no column boundaries and no counts, so the mana-value order the
  // cards were already in was not a thing the drawing said.
  return createElement(CurveColumns<number>, {
    groups: sealedGroups(props.build, props.indexes, props.grouping),
    view: props.mode,
    // Stacked rows rather than side-by-side columns, for the reason the
    // Constructed collection gave (`mtg-xiso`): six mana values of whole faces
    // are wider than the pane, so the columns scrolled sideways and down at
    // once inside a pane one card tall (`mtg-0j5aw4`). Rows wrap the faces to
    // the pane's width and the pool scrolls one way.
    flow: 'rows',
    label: props.label,
    faces: (group) =>
      byCard(props.build, group.members, props.foils).map((copies) =>
        poolCard(props.build, copies, props.onToggle, props.mode, props.artFor, props.foils),
      ),
  });
}

/**
 * The deck pane: one strip per copy, at both densities.
 *
 * `mtg-pmpu.1`, and the argument is `../deck/ConstructedBuilder.ts`'s
 * `deckStrips`: the 2026-08-29 captures draw a *collection* as a grid of whole
 * cards and a *deck* as count-headed columns of overlapping name bars, because
 * the questions the two panes answer are different ones. So this pane moves.
 *
 * The pool pane beside it kept its faces at compact until `mtg-eeqnj` gave it
 * the same name strips, one per distinct position, above in `cardPane`.
 *
 * A member here is a pool index rather than a card, which is this screen's own
 * rule and not a compromise: `SealedBuild.chosen` holds positions, and a strip
 * is a copy, so the two line up exactly — every strip is one position, and
 * `byCard`'s collapsing of duplicates has nothing left to do.
 *
 * The compact strip carries the foil answer itself, which is `mtg-p3g5`. The
 * bead asked whether a deck pane should say it at all; the sharper problem was
 * that this pane already answered both ways, drawing faces at full density and
 * saying it there, and drawing bars at compact and not. A density is a view
 * preference and it was changing what the pane claimed about the deck.
 *
 * It says it because `SealedBuild.foils` records which copy was played and the
 * face carries `data-foil` on the battlefield: with two copies of a card and one
 * foil, which one is in the deck decides what the player sees in the game. That
 * is information about the deck rather than decoration of it.
 *
 * So `factsOf` hands the strip the answer for that position and
 * `../deck/StripColumns.ts` draws it as a still mark on the bar; at full density
 * the strip is a face and the face draws its own sheen, which is what
 * `mtg-rgc.21` had already made true. Absent rather than false when the toggle
 * is off or the pool measured nothing, for `mtg-jpbv`'s reason: `props.foils` is
 * `null` in both cases and a bar that said "ordinary" would be answering a
 * question nobody asked.
 */
function deckStrips(props: {
  readonly build: SealedBuild;
  readonly indexes: readonly number[];
  readonly grouping: Grouping;
  readonly density: DeckViewMode;
  readonly foils: ReadonlySet<number> | null;
  readonly selectedKey: string | undefined;
  readonly onSelect: (strip: Strip<number>) => void;
  readonly onToggle: (index: number) => void;
  readonly artFor?: PositionArt;
}): ReactElement {
  const cardAt = (index: number): DslCard => {
    const card = props.build.pool[index];
    if (card === undefined) throw new Error(`sealed pool has no card at index ${String(index)}`);
    return card;
  };
  return createElement(StripColumns<number>, {
    groups: sealedGroups(props.build, props.indexes, props.grouping),
    factsOf: (index: number) => ({
      ...cardStripFacts(cardAt(index), `pool-${String(index)}`, 1),
      // Spread rather than a fifth parameter on `cardStripFacts`: that function
      // is about a card, and a foil is a property of the printed copy. Its four
      // other callers hold a card and could not answer this.
      ...(props.foils === null ? {} : { foil: props.foils.has(index) }),
    }),
    density: cardDensity(props.density),
    selectedKey: props.selectedKey,
    onSelect: props.onSelect,
    // The one move this pane has. There is no reverse of it here — a card in
    // the deck can only leave — so no `onMenu` is passed and a right click on a
    // strip stays the browser's.
    onActivate: (strip: Strip<number>): void => {
      props.onToggle(strip.member);
    },
    label: DECK_CARDS_LABEL,
    renderFace: (index: number, gestures: StripFaceGestures) =>
      createElement(Card, {
        card: cardAt(index),
        size: 'full',
        // Ninety whole faces in a pool pane, one card of each column on
        // screen. `../../card/ArtSlot.ts` argues why this is off by default.
        deferArt: true,
        art: props.artFor?.(cardAt(index)) ?? null,
        selected: gestures.selected,
        ...(props.foils === null ? {} : { foil: props.foils.has(index) }),
        onSelect: gestures.onSelect,
        ...(gestures.onActivate === undefined ? {} : { onActivate: gestures.onActivate }),
        ...(gestures.onMenu === undefined ? {} : { onMenu: gestures.onMenu }),
      }),
  });
}

/**
 * What is selected in the deck pane, and the one move that acts on it.
 *
 * Same shape and the same argument as the Constructed builder's, one button
 * shorter: a sealed deck is cut from a fixed pool, so the move is out and there
 * is nothing to add. It exists for the reason the `+`/`-` pair existed under
 * every face — a 26px name bar is no place for a button, and a move reachable
 * only by a double click is reachable by neither a keyboard nor a touch screen.
 */
function deckSelectionBar<Member>(props: {
  readonly strip: Strip<Member>;
  readonly name: string;
  readonly onToggle: (member: Member) => void;
  readonly onClear: () => void;
}): ReactElement {
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
        'aria-label': returnToPoolLabel(props.name),
        onClick: (): void => {
          props.onToggle(props.strip.member);
        },
      },
      'Return to pool',
    ),
    createElement('span', { className: 'mtg-toolbar__spacer' }),
    createElement(
      'button',
      { type: 'button', className: 'mtg-btn', onClick: props.onClear },
      CLEAR_SELECTION_LABEL,
    ),
  );
}

const BASIC_BY_COLOR: Readonly<Record<Color, CanonicalBasicName>> = {
  W: 'Plains',
  U: 'Island',
  B: 'Swamp',
  R: 'Mountain',
  G: 'Forest',
};

function physicalGroups<CardType>(
  cards: readonly PreparedPoolCard<CardType>[],
  presentation: LimitedCardPresentation<CardType>,
  grouping: Grouping,
): readonly Group<PreparedPoolCard<CardType>>[] {
  return groupMembers(
    cards,
    (card) => presentation.groupingFactsOf(card.payload),
    () => 1,
    grouping,
  );
}

function physicalCards<CardType>(props: {
  readonly cards: readonly PreparedPoolCard<CardType>[];
  readonly label: string;
  readonly mode: DeckViewMode;
  readonly grouping: Grouping;
  readonly presentation: LimitedCardPresentation<CardType>;
  readonly selectedId?: string;
  readonly onInspect: (card: PreparedPoolCard<CardType>) => void;
  readonly onToggle: (physicalId: string) => void;
  readonly empty: string;
}): ReactElement {
  if (props.cards.length === 0) {
    return createElement(
      'div',
      { className: 'mtg-gallery', role: 'group', 'aria-label': props.label, 'data-view': 'empty' },
      createElement('p', { className: 'mtg-prompt__explain' }, props.empty),
    );
  }
  // Compact draws name strips, the way `physicalDeckStrips` already does for
  // this format's deck pane (`mtg-eeqnj`). Only the pool pane ever reaches
  // this branch with a non-empty list.
  if (props.mode !== 'full') {
    return createElement(StripColumns<PreparedPoolCard<CardType>>, {
      groups: physicalGroups(props.cards, props.presentation, props.grouping),
      factsOf: (card) => ({
        key: card.physicalId,
        name: props.presentation.nameOf(card.payload),
        manaCost: props.presentation.manaCostOf(card.payload),
        colorIdentity: card.facts.colors.join(''),
        copies: 1,
      }),
      density: 'compact',
      ...(props.selectedId === undefined ? {} : { selectedKey: `${props.selectedId}#1` }),
      // Same two gestures the full-density face wires above: a click toggles
      // the card into or out of the deck, and the right click (or the
      // context-menu key) opens the inspect panel `onMenu`'s docblock argues
      // for. `onActivate` absorbs the double click for the same reflow
      // reason the face's own no-op does.
      onSelect: (strip: Strip<PreparedPoolCard<CardType>>): void => {
        props.onToggle(strip.member.physicalId);
      },
      onActivate: (): void => undefined,
      onMenu: (strip: Strip<PreparedPoolCard<CardType>>): void => {
        props.onInspect(strip.member);
      },
      label: props.label,
    });
  }
  return createElement(CurveColumns<PreparedPoolCard<CardType>>, {
    groups: physicalGroups(props.cards, props.presentation, props.grouping),
    view: props.mode,
    // One axis of scroll, as in `cardPane` above.
    flow: 'rows',
    label: props.label,
    faces: (group) =>
      group.members.map((card) =>
        createElement(
          'div',
          {
            key: card.physicalId,
            className: 'mtg-copies',
          },
          props.presentation.renderFace(card.payload, {
            physicalId: card.physicalId,
            size: cardDensity(props.mode),
            selected: props.selectedId === card.physicalId,
            deferArt: true,
            onSelect: (): void => {
              props.onToggle(card.physicalId);
            },
            // Selection already moves this physical card. Keeping an activation
            // handler makes Card consume the repeat click of a mouse double-click
            // or touch repeat instead of applying the move to the card that
            // reflows underneath the pointer.
            onActivate: (): void => undefined,
            onMenu: (): void => props.onInspect(card),
          }),
        ),
      ),
  });
}

function physicalDeckStrips<CardType>(props: {
  readonly cards: readonly PreparedPoolCard<CardType>[];
  readonly grouping: Grouping;
  readonly density: DeckViewMode;
  readonly presentation: LimitedCardPresentation<CardType>;
  readonly selectedKey: string | undefined;
  readonly onSelect: (strip: Strip<PreparedPoolCard<CardType>>) => void;
  readonly onInspect: (strip: Strip<PreparedPoolCard<CardType>>) => void;
  readonly onToggle: (physicalId: string) => void;
}): ReactElement {
  return createElement(StripColumns<PreparedPoolCard<CardType>>, {
    groups: physicalGroups(props.cards, props.presentation, props.grouping),
    factsOf: (card) => ({
      key: card.physicalId,
      name: props.presentation.nameOf(card.payload),
      manaCost: props.presentation.manaCostOf(card.payload),
      colorIdentity: card.facts.colors.join(''),
      copies: 1,
    }),
    density: cardDensity(props.density),
    selectedKey: props.selectedKey,
    onSelect: props.onSelect,
    onActivate: (strip) => props.onToggle(strip.member.physicalId),
    onMenu: props.onInspect,
    label: DECK_CARDS_LABEL,
    renderFace: (card, gestures) =>
      props.presentation.renderFace(card.payload, {
        physicalId: card.physicalId,
        key: card.physicalId,
        size: 'full',
        selected: gestures.selected,
        deferArt: true,
        onSelect: gestures.onSelect,
        ...(gestures.onActivate === undefined ? {} : { onActivate: gestures.onActivate }),
        ...(gestures.onMenu === undefined ? {} : { onMenu: gestures.onMenu }),
      }),
  });
}

function physicalColorFacets(facts: GroupingFacts): readonly ColorFacet[] {
  const colors = [...facts.colorIdentity].filter((color): color is Color => 'WUBRG'.includes(color));
  return colors.length === 0 ? ['C'] : colors;
}

interface LimitedPaneView {
  readonly mode: DeckViewMode;
  readonly grouping: Grouping;
}

interface LimitedPoolView extends LimitedPaneView {
  readonly filter: PoolFilter;
}

interface LimitedBuilderSurfaceProps {
  readonly counts: BuilderCounts;
  readonly colors: readonly string[];
  readonly seed: string;
  readonly contextNote: string;
  readonly poolLabel: string;
  readonly poolSize: number;
  readonly outside: number;
  readonly legal: boolean;
  readonly playDisabled?: boolean;
  readonly playLabel: string;
  readonly onSuggest: () => void;
  readonly onClear: () => void;
  readonly onPlay: () => void;
  readonly offeredGroupings?: readonly Grouping[];
  readonly toolbarExtras?: ReactNode;
  readonly banner?: ReactNode;
  readonly notices?: ReactNode;
  readonly title?: string;
  /** Extra `Game details` rows, after the setup and the seed. */
  readonly details?: readonly GameDetail[];
  readonly deckAbove: ReactNode;
  readonly renderDeck: (view: LimitedPaneView) => ReactElement;
  readonly renderPool: (view: LimitedPoolView) => {
    readonly shown: number;
    readonly body: ReactElement;
  };
  readonly head?: ReactNode;
}

/** The one Limited builder composition; card representations only fill its two panes. */
function LimitedBuilderSurface(props: LimitedBuilderSurfaceProps): ReactElement {
  const deckControls = usePaneControls('limited-deck', props.offeredGroupings, PANE_LIMITED_CARD_VIEWS);
  const poolControls = usePaneControls('limited-pool', props.offeredGroupings, PANE_LIMITED_CARD_VIEWS);
  const split = useBuilderSplit('sealed');
  const pane = useBuilderPane();
  const [filter, setFilter] = useState<PoolFilter>(WHOLE_POOL);
  const deckView = {
    mode: deckControls.view.mode,
    grouping: deckControls.grouping.grouping,
  } as const;
  const poolView = {
    mode: poolControls.view.mode,
    grouping: poolControls.grouping.grouping,
    filter,
  } as const;
  const pool = props.renderPool(poolView);
  const summary = createElement(
    'div',
    { className: 'mtg-toolbar mtg-builder__bar' },
    // The name of the screen, where the Constructed builder has kept it since
    // `mtg-i8xl`. No `mtg-builder__counts` beside it: the deck pane's own note
    // is `builderCountsLine` of the same counts, the two sat one band apart
    // saying the same sentence, and `mtg-84703` is the reader asking for the
    // duplicate's row back -- "the '40 of 40 cards - 14 creatures ...' doesnt
    // need to be at the top it's fine to include next ot the Your deck portion
    // only".
    props.title === undefined
      ? null
      : createElement('h1', { className: 'mtg-page-title mtg-builder__title' }, props.title),
    deckColorsIndicator(props.colors),
    createElement(GameDetails, {
      details: [
        { term: GAME_SETUP_LABEL, value: props.contextNote },
        { term: SEED_LABEL, value: props.seed },
        ...(props.details ?? []),
      ],
    }),
    createElement('span', { className: 'mtg-toolbar__spacer' }),
    createElement(
      'button',
      { type: 'button', className: 'mtg-btn', onClick: props.onSuggest },
      'Suggest a build',
    ),
    createElement('button', { type: 'button', className: 'mtg-btn', onClick: props.onClear }, 'Clear'),
    props.toolbarExtras ?? null,
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-btn',
        'data-variant': 'primary',
        disabled: !props.legal || props.playDisabled === true,
        onClick: props.onPlay,
      },
      props.playLabel,
    ),
    builderPaneSwitch({ state: pane, deckLabel: DECK_LABEL, poolLabel: props.poolLabel }),
  );
  const builder = createElement(
    'div',
    { className: 'mtg-play mtg-builder' },
    createElement(
      'div',
      { className: 'mtg-builder__above' },
      props.banner ?? null,
      summary,
      props.notices ?? null,
    ),
    createElement(
      'div',
      {
        className: 'mtg-builder__panes',
        'data-showing': pane.showing,
        'data-expanded': pane.expanded ?? 'split',
        ...(split.share === null ? {} : { style: builderSplitStyle(split.share) }),
      },
      createElement(
        DeckPane,
        {
          kind: 'deck',
          label: DECK_LABEL,
          note: builderCountsLine(props.counts),
          controls: deckControls,
          actions: builderPaneExpansionControl({ state: pane, pane: 'deck', label: DECK_LABEL }),
          above: props.deckAbove,
        },
        props.renderDeck(deckView),
      ),
      createElement(
        DeckPane,
        {
          kind: 'pool',
          label: props.poolLabel,
          note: poolPaneNote(props.poolSize, props.outside),
          controls: poolControls,
          actions: builderPaneExpansionControl({
            state: pane,
            pane: 'pool',
            label: props.poolLabel,
          }),
          above: createElement(
            'div',
            { className: 'mtg-toolbar', role: 'group', 'aria-label': 'Narrow the pool' },
            ...poolFacetButtons({ filter, onFilter: setFilter }),
            createElement('span', { className: 'mtg-toolbar__spacer' }),
            counter('showing', `${String(pool.shown)}/${String(props.outside)}`),
            clearFilterButton({ filter, onFilter: setFilter }),
          ),
        },
        pool.body,
      ),
      builderSplitHandle(split),
    ),
  );
  return builderScreen({ screen: 'mtg-builder-screen', head: props.head ?? null, body: builder });
}

export function PhysicalLimitedBuilder<CardType>(props: PhysicalLimitedBuilderProps<CardType>): ReactElement {
  const { physicalDeck: deck, report, presentation } = props;
  const deckFacts = deck.pool.map((card) => presentation.groupingFactsOf(card.payload));
  const offered = offeredGroupings(deckFacts);
  const [selectedStrip, setSelectedStrip] = useState<Strip<PreparedPoolCard<CardType>> | null>(null);
  const [inspected, setInspected] = useState<PreparedPoolCard<CardType> | null>(null);
  // Which face of the inspected card is turned up; the front again for the next card.
  const [turned, setTurned] = useState<{ readonly physicalId: string; readonly index: number } | null>(null);
  useEffect((): (() => void) | undefined => {
    if (inspected === null) return undefined;
    const host = globalThis as {
      readonly document?: {
        addEventListener(type: 'pointerdown', listener: () => void): void;
        removeEventListener(type: 'pointerdown', listener: () => void): void;
      };
    };
    const document = host.document;
    if (document === undefined) return undefined;
    const dismiss = (): void => setInspected(null);
    document.addEventListener('pointerdown', dismiss);
    return (): void => document.removeEventListener('pointerdown', dismiss);
  }, [inspected]);
  const selectedIds = new Set(deck.selectedPhysicalIds);
  const chosen = deck.pool.filter((card) => selectedIds.has(card.physicalId));
  const outside = deck.pool.filter((card) => !selectedIds.has(card.physicalId));
  const selection =
    selectedStrip !== null && selectedIds.has(selectedStrip.member.physicalId) ? selectedStrip : null;
  const inspect = (card: PreparedPoolCard<CardType>): void => {
    setInspected(card);
  };
  const previewCard = inspected;
  const previewViewport = previewCard === null ? null : readViewport();
  const previewFaces = previewCard === null ? [] : (presentation.facesOf?.(previewCard.payload) ?? []);
  const previewFace =
    previewCard !== null &&
    turned?.physicalId === previewCard.physicalId &&
    turned.index < previewFaces.length
      ? turned.index
      : 0;
  const poolLabel = props.poolLabel ?? SEALED_POOL_LABEL;
  const counts = {
    cards: report.cards,
    size: report.minimumDeckSize,
    creatures: report.creatures,
    spells: report.noncreatureSpells,
    lands: report.basicLands + report.nonbasicLands,
  };
  const colors = Object.entries(report.colors)
    .filter(([, count]) => count > 0)
    .map(([color]) => color);
  const basicCounts = {
    lands: { length: report.basicLands },
    manaBase: {
      landsByColor: Object.fromEntries(
        Object.entries(BASIC_BY_COLOR).map(([color, name]) => [color, deck.basics[name]]),
      ) as Record<Color, number>,
    },
  };
  const problems = report.legal
    ? null
    : createElement(
        'ul',
        { className: 'mtg-play__notes' },
        createElement(
          'li',
          null,
          props.illegalNote ?? `${plural(report.missingCards, 'card')} short of a legal deck.`,
        ),
      );
  return createElement(
    Fragment,
    null,
    createElement(LimitedBuilderSurface, {
      counts,
      colors,
      seed: props.seed,
      contextNote: props.contextNote,
      poolLabel,
      poolSize: deck.pool.length,
      outside: outside.length,
      legal: report.legal,
      ...(props.playDisabled === undefined ? {} : { playDisabled: props.playDisabled }),
      playLabel: props.playLabel ?? 'Play this deck',
      onSuggest: props.onSuggest,
      onClear: props.onClear,
      onPlay: props.onPlay,
      offeredGroupings: offered,
      toolbarExtras: props.toolbarExtras,
      banner: props.banner,
      notices: problems,
      deckAbove: createElement(
        Fragment,
        null,
        createElement(BasicsPanel, {
          deck: basicCounts,
          chosen: true,
          onAdjustBasics: (color, delta): void => props.onAdjustBasic(BASIC_BY_COLOR[color], delta),
          onSuggestBasics: props.onSuggestBasics,
        }),
        selection === null
          ? null
          : deckSelectionBar({
              strip: selection,
              name: presentation.nameOf(selection.member.payload),
              onToggle: (card): void => props.onToggle(card.physicalId),
              onClear: (): void => setSelectedStrip(null),
            }),
      ),
      renderDeck: (view) =>
        chosen.length === 0
          ? physicalCards({
              cards: chosen,
              label: DECK_CARDS_LABEL,
              mode: view.mode,
              grouping: view.grouping,
              presentation,
              ...(inspected === null ? {} : { selectedId: inspected.physicalId }),
              onInspect: inspect,
              onToggle: props.onToggle,
              empty: EMPTY_SEALED_DECK_NOTE,
            })
          : physicalDeckStrips({
              cards: chosen,
              grouping: view.grouping,
              density: view.mode,
              presentation,
              selectedKey: selection?.key,
              onSelect: setSelectedStrip,
              onInspect: (strip): void => inspect(strip.member),
              onToggle: props.onToggle,
            }),
      renderPool: (view) => {
        const shown = outside.filter((card) => {
          if (view.filter.colors.length === 0) return true;
          return view.filter.colors.some((color) =>
            physicalColorFacets(presentation.groupingFactsOf(card.payload)).includes(color),
          );
        });
        return {
          shown: shown.length,
          body: physicalCards({
            cards: shown,
            label: poolLabel,
            mode: view.mode,
            grouping: view.grouping,
            presentation,
            ...(inspected === null ? {} : { selectedId: inspected.physicalId }),
            onInspect: inspect,
            onToggle: props.onToggle,
            empty: outside.length === 0 ? EMPTY_SEALED_POOL_NOTE : EMPTY_SEALED_FILTER_NOTE,
          }),
        };
      },
      head: props.head,
      ...(props.title === undefined ? {} : { title: props.title }),
      ...(props.details === undefined ? {} : { details: props.details }),
    }),
    previewCard === null || previewViewport === null
      ? null
      : createElement(
          FloatingCardPreview,
          {
            at: { left: previewViewport.width / 2, top: previewViewport.height / 2 },
            viewport: previewViewport,
            rootPx: readRootPx(),
            interactive: previewFaces.length > 1,
          },
          createElement(
            Fragment,
            null,
            presentation.renderFace(previewCard.payload, {
              size: 'full',
              physicalId: previewCard.physicalId,
              faceIndex: previewFace,
            }),
            createElement(FaceFlip, {
              cardName: presentation.nameOf(previewCard.payload),
              faces: previewFaces,
              index: previewFace,
              onFlip: (next): void => setTurned({ physicalId: previewCard.physicalId, index: next }),
            }),
          ),
        ),
  );
}

export function SealedBuilder(props: SealedBuilderProps): ReactElement {
  const { build, deck } = props;
  // Which copy in the deck pane is under the outline. Transient and per pane;
  // `../DeckRoute.ts` argues why it never goes to storage.
  const [selected, setSelected] = useState<Strip<number> | null>(null);
  // Every axis in both panes: a sealed pool is DSL cards, and a DSL card
  // carries a rarity. `offeredGroupings` is for the pane whose members cannot
  // answer that, which is a built artifact's over in `../DeckRoute.ts`.
  // One setting for the page rather than one per pane: a foil is a fact about a
  // copy, and the copy is the same object in either pane. `./foil-preference.ts`
  // argues that, where the control lives, and why it defaults on.
  const foilPreference = useDrawFoils();
  // `null` all the way down where there is nothing to draw, which is a pool that
  // measured no slots as well as a setting turned off. A pane handed `null`
  // draws exactly the pane it drew before any of this existed.
  const foils = useMemo(
    () => (build.foils === null || !foilPreference.draw ? null : new Set(build.foils)),
    [build.foils, foilPreference.draw],
  );
  // Indexed once per pool rather than per press: the haystack walks each card's
  // whole effect tree, and the color facets come off the same pass.
  const entries = useMemo(() => indexPool(build.pool), [build.pool]);
  const legal = deck.complete;
  const poolLabel = props.poolLabel ?? SEALED_POOL_LABEL;
  const chosenName = (index: number): string => {
    const card = build.pool[index];
    if (card === undefined) throw new Error(`sealed pool has no card at index ${String(index)}`);
    return card.name;
  };
  // Derived rather than stored: the move this pane offers takes the selected
  // copy out of the deck, so the key that named it stops naming anything. A bar
  // still offering to return a card that is already in the pool is worse than
  // no bar, and deriving it needs no effect to clear.
  const selection = selected !== null && build.chosen.includes(selected.member) ? selected : null;
  const playLabel = props.playLabel ?? 'Play this deck';
  // One derivation of "how many cards", shared with the Constructed builder:
  // `../deck/deck-counts.ts`. The bar and the deck pane's note both read it, and
  // the local creature/noncreature split they each used to do is what let the
  // two disagree.
  const counts = builderCounts(chosenCards(build), deck);
  // The library, for the same three reasons the Decks tab reads it: the list is
  // what a proposed name is checked against, the keeper is what the note after a
  // save can truthfully say, and a save from here has to reach the machine when
  // there is one (`../deck/deck-keeping.ts`).
  const keeping = useDeckKeeping();
  // One id for as long as this pool is on screen, so pressing Keep a second time
  // updates the deck rather than filling the library with copies of one pool.
  // The name follows the id: a deck already in the library keeps whatever it was
  // renamed to, and only a deck that is not there yet is proposed a name.
  const [keptId] = useState(() => newSavedDeckId(Date.now(), Math.random()));
  const [keptNote, setKeptNote] = useState<string | null>(null);
  const keep = (): void => {
    const name =
      keeping.decks.find((entry) => entry.id === keptId)?.name ??
      limitedDeckName(props.source, props.seed, keeping.decks);
    const saved = limitedSavedDeck({
      id: keptId,
      name,
      savedAt: new Date().toISOString(),
      build,
      landsByColor: deck.manaBase.landsByColor,
      source: props.source,
      ...(props.setRef === undefined ? {} : { set: props.setRef }),
    });
    if (!keepDeck(saved)) {
      setKeptNote(KEEP_REFUSED_NOTE);
      return;
    }
    setKeptNote(keptDeckNote(name, keeping.keeper));
  };
  // The pool is what was not played, and `shown` is what the facets leave of it.
  // Indexes rather than cards throughout: a pool has duplicates in it, and two
  // copies of one card are two separate things to click.
  const outside = build.pool.map((_card, index) => index).filter((index) => !build.chosen.includes(index));

  // Notes, not blockers. An over-size deck cannot start and says so; a color
  // short of sources is a deck somebody may mean to play, so it is reported
  // beside the buttons rather than in place of them.
  const oversize = deck.deck.length - deck.config.deckSize;
  const notes: readonly ReactElement[] = [
    ...(oversize > 0
      ? [
          createElement(
            'li',
            { key: 'over' },
            `${plural(oversize, 'card')} too many for a ${String(deck.config.deckSize)}-card deck.`,
          ),
        ]
      : []),
    ...deck.shortfalls.map((shortfall, index) =>
      createElement('li', { key: `short-${String(index)}` }, shortfallNote(shortfall)),
    ),
  ];
  const problems =
    notes.length === 0 ? null : createElement('ul', { className: 'mtg-play__notes' }, ...notes);

  // What the save did, above the panes rather than inside the Game details
  // disclosure the pool's own sentence went into: that disclosure holds facts
  // you go looking for, and this one answers a press.
  const keptLine =
    keptNote === null ? null : createElement('p', { className: 'mtg-page-note', role: 'status' }, keptNote);
  return createElement(LimitedBuilderSurface, {
    counts,
    colors: deck.colors,
    seed: props.seed,
    contextNote: props.contextNote,
    poolLabel,
    poolSize: build.pool.length,
    outside: outside.length,
    legal,
    playLabel,
    onSuggest: props.onSuggest,
    onClear: props.onClear,
    onPlay: props.onPlay,
    toolbarExtras: createElement(
      Fragment,
      null,
      createElement(
        'button',
        {
          type: 'button',
          className: 'mtg-btn',
          disabled: deck.deck.length === 0,
          onClick: keep,
        },
        KEEP_DECK_LABEL,
      ),
      build.foils === null ? null : createElement(FoilControl, { state: foilPreference }),
    ),
    banner: props.banner,
    notices: createElement(Fragment, null, keptLine, problems),
    deckAbove: createElement(
      Fragment,
      null,
      createElement(BasicsPanel, {
        deck,
        chosen: build.basics !== null,
        onAdjustBasics: props.onAdjustBasics,
        onSuggestBasics: props.onSuggestBasics,
      }),
      selection === null
        ? null
        : deckSelectionBar({
            strip: selection,
            name: chosenName(selection.member),
            onToggle: props.onToggle,
            onClear: (): void => setSelected(null),
          }),
    ),
    renderDeck: (view) =>
      build.chosen.length > 0
        ? deckStrips({
            build,
            indexes: build.chosen,
            grouping: view.grouping,
            density: view.mode,
            foils,
            selectedKey: selection?.key,
            onSelect: setSelected,
            onToggle: props.onToggle,
            ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
          })
        : cardPane({
            build,
            indexes: build.chosen,
            label: DECK_CARDS_LABEL,
            empty: EMPTY_SEALED_DECK_NOTE,
            mode: view.mode,
            grouping: view.grouping,
            onToggle: props.onToggle,
            foils,
            ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
          }),
    renderPool: (view) => {
      const shown = outside.filter((index) => {
        const entry = entries[index];
        return entry !== undefined && admits(entry, view.filter);
      });
      return {
        shown: shown.length,
        body: cardPane({
          build,
          indexes: shown,
          label: poolLabel,
          empty: outside.length === 0 ? EMPTY_SEALED_POOL_NOTE : EMPTY_SEALED_FILTER_NOTE,
          mode: view.mode,
          grouping: view.grouping,
          onToggle: props.onToggle,
          foils,
          ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
        }),
      };
    },
    head: props.head,
    ...(props.title === undefined ? {} : { title: props.title }),
    ...(props.details === undefined ? {} : { details: props.details }),
  });
}
