/**
 * The pack in front of you, and the one decision it asks for.
 *
 * `mtg-aqxi.3`. What this replaces: a page heading, a four-fact toolbar, a
 * panel with a two-line explanation, and a gallery of full-size faces where a
 * single tap recorded the pick. Measured at 844x390 that showed three of the
 * thirteen cards, each taller than the screen, with the pack's own identity
 * scrolled off the top — and the one irreversible action on the surface was a
 * tap, on a device where a tap is also how you scroll.
 *
 * Three changes, in the order they matter:
 *
 * 1. **A tap selects; a button commits.** The pick is the only move in this
 *    lab that cannot be taken back, and §6 asks for it by name. Choosing a card
 *    now reads it into the rail, and the rail's foot carries `Pick <name>`.
 * 2. **The pack is the page.** A compact status strip on top, the pack in a
 *    region that scrolls inside itself, and nothing above it that repeats what
 *    the cards already say.
 * 3. **The pool is under the pack, not after it.** `mtg-3apk` moved it out of
 *    the rail and into the deck editor's own count-headed strip columns: a rail
 *    section is one press away from the pack but is also 17rem wide, so what
 *    you have drafted was two columns of thumbnails and could not be read as a
 *    curve or as a color balance. Under the pack it is the same drawing the
 *    deck editor uses, in a box of a fixed height, so the pack above it does
 *    not walk down the page between pick 1 and pick 45.
 *
 * The dense grid, the rail, and the screen that holds them are
 * `../../styles/panel.ts` and `../../panel/ContextRail.ts` rather than anything
 * local: deckbuilding is the second surface with the same shape and the played
 * table is the third.
 */
import { createElement, Fragment, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Card as DslCard } from '@mtg/dsl';
import { rateCards, ratingValueOf, resolveCardRating } from '@mtg/draft-export';
import type { EvaluatorRating } from '@mtg/draft-export';
import { Card } from '../../card/Card';
import { FaceFlip } from '../../card/FaceFlip';
import { ContextRail } from '../../panel/ContextRail';
import type { RailSection } from '../../panel/ContextRail';
import { SplitHandle } from '../../panel/SplitHandle';
import { splitStyle, useSplit } from '../../panel/split';
import { railSplitHandle, railSplitStyle, useRailSplit } from './rail-split';
import { useStoredCollapse } from '../play/collapse-preference';
import { cardGroupingFacts, cardStripFacts } from '../deck/build';
import { GROUPINGS, groupMembers } from '../deck/grouping';
import type { Grouping, GroupingFacts } from '../deck/grouping';
import { GroupingControl, useDeckGrouping } from '../deck/GroupingControl';
import { StripColumns } from '../deck/StripColumns';
import { DRAFT_STACK_BOX } from '../deck/strips';
import type { Strip, StripFacts } from '../deck/strips';
import { packOrder } from './pack-order';
import { useDraftRatingsSwitch } from './rating-switch';
import { DraftStrip } from './DraftStrip';
import type { PositionArt } from '../play/position';

export interface DraftCardPresentation<CardType> {
  readonly keyOf: (card: CardType) => string;
  readonly nameOf: (card: CardType) => string;
  readonly groupingFactsOf: (card: CardType) => GroupingFacts;
  readonly stripFactsOf: (card: CardType, key: string) => StripFacts;
  readonly orderPack: (
    cards: readonly CardType[],
    options: { readonly ratingsShown: boolean },
  ) => readonly { readonly card: CardType; readonly index: number }[];
  readonly renderFace: (
    card: CardType,
    options: {
      readonly key?: string;
      readonly size: 'board' | 'compact' | 'full';
      readonly selected?: boolean;
      readonly autoFocus?: boolean;
      /** Which printed face to draw; absent means the front. */
      readonly faceIndex?: number;
      readonly onSelect?: () => void;
      readonly onHover?: (hovered: boolean) => void;
    },
  ) => ReactElement;
  /**
   * The names of a card's printed faces, when a card can have more than one.
   * A DSL card has one face and states nothing; a printed split card states
   * both halves, and the rail then offers to turn the card over.
   */
  readonly facesOf?: (card: CardType) => readonly string[];
  /**
   * The card's strategic rating for this format, with the source it came
   * from (never a bare number, per ADR-0005). Absent entirely means this
   * presentation has no rating source at all (a generated set drawn without
   * its staged pool), so nothing is drawn. A present function that answers `null` for a card
   * means the format stages no rankings, and the rail says so rather than
   * staying silent.
   */
  readonly ratingOf?: (card: CardType) => DraftCardRating | null;
}

export interface DraftCardRating {
  /**
   * What the source scores this card, or `null` when the source covers this
   * format but ranks nothing for this card. A card the ranking misses and a
   * set that has no ranking are two different facts, and reporting the first
   * as the second names the wrong thing as unranked.
   */
  readonly value: number | null;
  readonly source: string;
}

export interface DraftPackSurfaceProps<CardType> {
  readonly draft: { readonly picks: { readonly length: number } };
  /** The pack owing a choice. Separate from `draft` because it is never null here. */
  readonly next: {
    readonly round: number;
    readonly pickNumber: number;
    readonly packSize: number;
    readonly cards: readonly CardType[];
  };
  /** Everything this seat has taken so far, in pick order. */
  readonly pool: readonly CardType[];
  readonly onPick: (card: CardType) => void;
  readonly onNewDraft: () => void;
  readonly presentation: DraftCardPresentation<CardType>;
  /** Optional format-specific advice; the shared surface knows no evaluator. */
  readonly advice?: {
    readonly summary: ReactNode;
    readonly card: (card: CardType) => ReactNode;
    readonly sections: readonly RailSection[];
  };
}

export type DraftPackProps = Omit<DraftPackSurfaceProps<DslCard>, 'presentation'> & {
  readonly artFor?: PositionArt;
  /**
   * The staged set's whole card pool, so a rating is scaled between the
   * worst and best spell *in this set* rather than in whichever pack is on
   * screen. Absent draws no rating at all (`ratingOf`'s contract above).
   */
  readonly cards?: readonly DslCard[];
};

/**
 * Which card in the pack is under inspection.
 *
 * By position and not by id, because a pack of commons can hold two copies of
 * one card and an id would light both of them up. `at` is how many picks were
 * recorded when the choice was made: when the next pack arrives the count has
 * moved, the selection stops matching, and the rail empties itself without any
 * effect needing to clear it.
 */
interface Selection {
  readonly at: number;
  readonly index: number;
}

const CARD_SECTION = 'Card';
const POOL_SECTION = 'Pool';
const CARD_SECTION_GUIDANCE =
  'Point at a card in the pack, or choose one from the pool, to read it here. Press Pick to take the card you are reading.';

/**
 * Where the two disclosures keep their answers, namespaced like the board's
 * (`../play/rail-collapse.ts`). Shut by nobody's default: a first visit draws
 * the pool and the viewer the way the stylesheet measured them, and only a
 * press changes that.
 */
export const PICKS_COLLAPSE_KEY = 'mtg.draft.picks';
export const VIEWER_COLLAPSE_KEY = 'mtg.draft.viewer';
export const VIEWER_LABEL = 'Card viewer';

/**
 * The disclosure on the pool. Its name says what a press does rather than
 * what it discloses, because it sits in a row with a grouping control and a
 * count and "Picks" beside those would read as a third grouping.
 */
function picksToggle(state: { readonly collapsed: boolean; readonly toggle: () => void }): ReactElement {
  return createElement(
    'button',
    {
      type: 'button',
      className: 'mtg-btn mtg-draft__pool-toggle',
      'aria-expanded': !state.collapsed,
      onClick: state.toggle,
    },
    state.collapsed ? 'Expand picks' : 'Collapse picks',
  );
}

/**
 * The disclosure on the rail, in the board's shape (`../play/rail-collapse.ts`'s
 * `railToggle`): the chevron is the state, the word is the name, and the word
 * is hidden when the rail is a strip while the name stays on the button.
 */
function viewerToggle(state: { readonly collapsed: boolean; readonly toggle: () => void }): ReactElement {
  return createElement(
    'button',
    {
      type: 'button',
      className: 'mtg-btn mtg-rail__toggle',
      'aria-label': state.collapsed
        ? `Expand ${VIEWER_LABEL.toLowerCase()}`
        : `Collapse ${VIEWER_LABEL.toLowerCase()}`,
      'aria-expanded': !state.collapsed,
      onClick: state.toggle,
    },
    createElement(
      'span',
      { className: 'mtg-rail__chevron', 'aria-hidden': true },
      state.collapsed ? '‹' : '›',
    ),
    createElement('span', { className: 'mtg-rail__toggle-label', 'aria-hidden': true }, VIEWER_LABEL),
  );
}

/** The rating line under a read card, or the word for why there isn't one. */
function ratingLine(rating: DraftCardRating | null): ReactElement {
  return createElement('p', { className: 'mtg-draft__rating' }, ratingText(rating));
}

/**
 * Three facts this line keeps apart: the set stages no ranking at all, the set
 * stages one and it ranks this card, and the set stages one that misses this
 * card. The third used to print as the first, which told the reader the whole
 * set was unranked on the evidence of a single card.
 */
function ratingText(rating: DraftCardRating | null): string {
  if (rating === null) return 'No ranking for this set.';
  if (rating.value === null) return `${rating.source}: not ranked for this card.`;
  return `${rating.source}: ${rating.value.toFixed(1)}/5`;
}

function poolCountLabel(pool: number): string {
  return `${String(pool)} ${pool === 1 ? 'card' : 'cards'}`;
}

/**
 * One card in the pool, carried with the pick that took it.
 *
 * By position, for `Selection`'s reason one level up: a drafted pool holds two
 * copies of a common as two picks, and keying a strip by the card's id would
 * give the two of them one key — so a click on the second would outline the
 * first, and `../deck/strips.ts`'s per-copy strip would collapse back into the `2x`
 * badge it exists to replace.
 */
interface PoolPick<CardType> {
  readonly card: CardType;
  readonly index: number;
}

/** How a pick is keyed, spelled once so the drawing and the outline agree. */
function poolPickKey<CardType>(pick: PoolPick<CardType>, keyOf: (card: CardType) => string): string {
  return `${String(pick.index)}/${keyOf(pick.card)}`;
}

/**
 * The `Strip.key` of a drafted card, which is its pick key and its copy number.
 *
 * `../deck/strips.ts` builds that string, and every pick is one copy of itself,
 * so the copy is always 1. Stated here rather than reached for, because the
 * outline is drawn from it and a key that does not match outlines nothing.
 */
function poolStripKey<CardType>(
  pool: readonly CardType[],
  index: number,
  keyOf: (card: CardType) => string,
): string | null {
  const card = pool[index];
  return card === undefined ? null : `${poolPickKey({ card, index }, keyOf)}#1`;
}

/**
 * The pool under the pack, in the deck editor's own count-headed strip columns.
 *
 * `mtg-3apk`, and the reason `../deck/strips.ts` fixed the box height rather than
 * letting a column grow: this is the pane that actually reaches the pitch
 * floor. A pack is 45 picks deep by the end of a draft and the pack above it
 * may not walk down the page between pick 1 and pick 45, so the region is the
 * same height at both and the strips tighten inside it.
 *
 * Every pick is its own member with one copy, so a column is one strip per card
 * and the count above it counts cards either way — the invariant
 * `../deck/columns.ts` establishes holds here without the pane having to state
 * a copy count it does not have.
 */
function poolColumns<CardType>(props: {
  readonly pool: readonly CardType[];
  readonly grouping: Grouping;
  readonly selectedKey: string | null;
  readonly onSelect: (pick: PoolPick<CardType>) => void;
  readonly presentation: DraftCardPresentation<CardType>;
}): ReactElement {
  const picks: readonly PoolPick<CardType>[] = props.pool.map((card, index) => ({ card, index }));
  return createElement(StripColumns<PoolPick<CardType>>, {
    groups: groupMembers(
      picks,
      (pick) => props.presentation.groupingFactsOf(pick.card),
      () => 1,
      props.grouping,
    ),
    factsOf: (pick) =>
      props.presentation.stripFactsOf(pick.card, poolPickKey(pick, props.presentation.keyOf)),
    ...(props.selectedKey === null ? {} : { selectedKey: props.selectedKey }),
    onSelect: (strip: Strip<PoolPick<CardType>>) => {
      props.onSelect(strip.member);
    },
    label: POOL_SECTION,
    box: DRAFT_STACK_BOX,
  });
}

/**
 * The source label a generated set's rating is shown under. the playtester's
 * ADR-0005 ruling names the third rung "our evaluator" until a set has been
 * through `mtg-w0xm8`'s bot-play campaign, which covers no generated set yet.
 */
export const GENERATED_DRAFT_RATING_SOURCE = 'our evaluator';

function dslPresentation(
  artFor: PositionArt | undefined,
  ratingOf: ((card: DslCard) => DraftCardRating | null) | undefined,
): DraftCardPresentation<DslCard> {
  return {
    keyOf: (card) => card.id,
    nameOf: (card) => card.name,
    groupingFactsOf: cardGroupingFacts,
    stripFactsOf: (card, key) => cardStripFacts(card, key, 1),
    orderPack: packOrder,
    ...(ratingOf === undefined ? {} : { ratingOf }),
    renderFace: (card, options) =>
      createElement(Card, {
        ...(options.key === undefined ? {} : { key: options.key }),
        card,
        size: options.size,
        art: artFor?.(card) ?? null,
        ...(options.selected === undefined ? {} : { selected: options.selected }),
        ...(options.autoFocus === undefined ? {} : { autoFocus: options.autoFocus }),
        ...(options.onSelect === undefined ? {} : { onSelect: options.onSelect }),
        ...(options.onHover === undefined
          ? {}
          : { onHover: (hovered: DslCard | null): void => options.onHover?.(hovered !== null) }),
      }),
  };
}

/**
 * Where this surface's split is kept. One name, so the two panes share one.
 *
 * Exported for `../../../test/play/hand-seam.test.ts`, which asserts that the
 * app's dividers keep their shares under names none of them shares: a collision
 * would hand one surface's arrangement to another, and the failure is a store
 * key rather than anything a render would show.
 */
export const DRAFT_SPLIT = 'draft.pack';

/**
 * What the stylesheet's own arrangement is worth, announced and never drawn.
 *
 * Measured at 1440x900 on a full pack: 445px of pack over 287px of pool, which
 * is three fifths of the column. `../../panel/SplitHandle.ts` says why a number
 * has to be stated rather than read off the layout.
 */
const DRAFT_DEFAULT_SHARE = 0.6;

export function DraftPackSurface<CardType>(props: DraftPackSurfaceProps<CardType>): ReactElement {
  const surface = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [section, setSection] = useState<string>(CARD_SECTION);
  // Which drafted card is being looked at, by pick number. Independent of
  // `selection` on purpose: the commit button is bound to the pack and only to
  // the pack, so reading a card you already own can never change what `Pick
  // <name>` would take. It names the card it commits either way.
  const [poolIndex, setPoolIndex] = useState<number | null>(null);
  // What the pointer (or the keyboard's focus) is resting on in the pack.
  //
  // A `Selection` and not a card, for `Selection`'s own reason and one more: a
  // pack holding two copies of a common would otherwise light the panel from
  // whichever copy the id found first, and the `at` guard means a pointer left
  // over a face that the next pack replaced reads as nothing rather than as the
  // card that used to be there.
  const [hover, setHover] = useState<Selection | null>(null);
  // Which face of the card being read is turned up. Keyed by the card, so
  // pointing at the next card reads its front and not the back of the last.
  const [turned, setTurned] = useState<{ readonly key: string; readonly index: number } | null>(null);
  const grouping = useDeckGrouping('draft-pool', GROUPINGS);
  // How the main column is shared between the pack and what has been drafted
  // out of it. `mtg-rgc.19`: the split the stylesheet ships with is right for
  // pick one and wrong by pick eleven, and only the player knows which of the
  // two they are reading.
  const packSplit = useSplit(DRAFT_SPLIT);
  const railSplit = useRailSplit();
  // Whether the pool and the rail are drawn, or folded to their heads. View
  // state, not draft state, for the reason `../play/rail-collapse.ts` gives:
  // nothing here changes what a pick is.
  const picks = useStoredCollapse(PICKS_COLLAPSE_KEY, false);
  const viewer = useStoredCollapse(VIEWER_COLLAPSE_KEY, false);
  const ratingsSwitch = useDraftRatingsSwitch();
  const { presentation } = props;
  const ratingOf = presentation.ratingOf;
  const hasRatingSource = ratingOf !== undefined;
  const ratingSource =
    ratingOf === undefined || !ratingsSwitch.enabled
      ? null
      : props.next.cards.reduce<string | null>(
          (found, card) => found ?? ratingOf(card)?.source ?? null,
          null,
        );

  const taken = props.draft.picks.length;
  const chosenIndex = selection !== null && selection.at === taken ? selection.index : null;
  const chosen = chosenIndex === null ? null : (props.next.cards[chosenIndex] ?? null);
  const drafted = poolIndex === null ? null : (props.pool[poolIndex] ?? null);
  const hoveredIndex = hover !== null && hover.at === taken ? hover.index : null;
  const hovered = hoveredIndex === null ? null : (props.next.cards[hoveredIndex] ?? null);
  // Chosen, then pointed at, then nothing (`mtg-pklv`).
  //
  // The rail shows whichever was chosen last, and choosing in the pack clears
  // the pool's outline below, so the two panes never both claim to be the one
  // being read. A hover comes last of the three: measured at 1440x900 the rail
  // is 280px of the window, 19% of it, and before this it held two lines of
  // instruction until the first press -- but a pointer crossing the pack on its
  // way to the card you already chose must not take the panel off that card,
  // which is exactly the complaint the playtester raised against a preview that
  // "consumes space without consistently providing value". So pointing fills an
  // empty panel and never empties a full one.
  const reading = drafted ?? chosen ?? hovered;
  const readingFaces = reading === null ? [] : (presentation.facesOf?.(reading) ?? []);
  const turnedIndex =
    reading !== null &&
    turned !== null &&
    turned.key === presentation.keyOf(reading) &&
    turned.index < readingFaces.length
      ? turned.index
      : 0;

  const select = (index: number): void => {
    setSelection({ at: taken, index });
    setPoolIndex(null);
    // The card goes where you are already looking. A rail left on another
    // section would have answered a tap with no visible change, which reads as
    // a dead control.
    setSection(CARD_SECTION);
  };

  const sections: readonly RailSection[] = [
    {
      name: CARD_SECTION,
      render: () =>
        reading === null && props.advice === undefined
          ? null
          : createElement(
              Fragment,
              null,
              props.advice?.summary,
              reading === null
                ? props.advice === undefined
                  ? null
                  : createElement('p', null, 'Point at or select a card to examine the tradeoffs.')
                : createElement(
                    Fragment,
                    null,
                    props.advice?.card(reading),
                    presentation.renderFace(reading, {
                      key: presentation.keyOf(reading),
                      size: 'full',
                      faceIndex: turnedIndex,
                    }),
                    ratingOf === undefined || !ratingsSwitch.enabled ? null : ratingLine(ratingOf(reading)),
                    createElement(FaceFlip, {
                      cardName: presentation.nameOf(reading),
                      faces: readingFaces,
                      index: turnedIndex,
                      onFlip: (next): void => setTurned({ key: presentation.keyOf(reading), index: next }),
                    }),
                  ),
            ),
      empty: CARD_SECTION_GUIDANCE,
    },
    ...(props.advice?.sections ?? []),
  ];

  const commit = createElement(
    'button',
    {
      type: 'button',
      className: 'mtg-btn',
      'data-variant': 'primary',
      disabled: chosen === null,
      onClick: (): void => {
        if (chosen === null) return;
        // The pool grows by one and every index below it still names the card
        // it named, but what the rail is showing is a card from the pack you
        // just passed on. Cleared here so the next pack opens on its own
        // prompt.
        setPoolIndex(null);
        // And a card read from the pool later opens on its front, whichever
        // face it was picked on.
        setTurned(null);
        props.onPick(chosen);
      },
    },
    chosen === null ? 'Pick a card' : `Pick ${presentation.nameOf(chosen)}`,
  );

  return createElement(
    'div',
    { className: 'mtg-draft mtg-screen', ref: surface },
    // Spoken, not drawn. The page still has a heading a screen reader can jump
    // to; what it no longer has is 40px of the word "Draft" above a pack that
    // says so four ways. `../../styles/base.ts` owns the class.
    createElement('h1', { className: 'mtg-sr-only' }, 'Draft'),
    createElement(DraftStrip, {
      next: props.next,
      taken,
      hasAdvice: props.advice !== undefined,
      viewerCollapsed: viewer.collapsed,
      onExpandViewer: viewer.expand,
      surface,
      hasRatingSource,
      ratingSource,
      ratingsEnabled: ratingsSwitch.enabled,
      onToggleRatings: (): void => ratingsSwitch.setEnabled(!ratingsSwitch.enabled),
      onNewDraft: props.onNewDraft,
    }),
    createElement(
      'div',
      // The rail collapses to its head, and the commit moves rather than
      // hides. The rail's foot holds the only irreversible action on the
      // surface, and a control that can hide the commit button is a control
      // that can strand a player mid-pack, which is why this surface refused a
      // disclosure for as long as it did. So while the rail is shut the same
      // button is drawn under the pack instead, in the rail's own foot class
      // so the portrait commit bar (`../../styles/draft-mobile.ts`) pins it
      // where it always was. Shut, the grid has no seam to drag, so the rail
      // handle goes with the split (`./rail-split.ts`).
      {
        className: 'mtg-work',
        'data-rail': viewer.collapsed ? 'shut' : 'split',
        ...(railSplit.share === null || viewer.collapsed ? {} : { style: railSplitStyle(railSplit.share) }),
      },
      createElement(
        'div',
        {
          className: 'mtg-work__main',
          // Shut picks hand the pack their height: `../../styles/panel.ts`
          // reads this to let the pack pane grow past its split share.
          ...(picks.collapsed ? { 'data-pool': 'shut' } : {}),
          // The split the player dragged, or nothing at all: `../../panel/split.ts`
          // renders no property until there is one, so an undragged draft is the
          // arrangement `../../styles/panel.ts` measured and argued for.
          ...(packSplit.share === null
            ? { 'data-split': 'auto' }
            : { style: splitStyle('--split-a', packSplit.share) }),
        },
        createElement(
          'div',
          { className: 'mtg-work__scroll' },
          createElement(
            'div',
            {
              className: 'mtg-thumbs mtg-thumbs--pack',
              role: 'group',
              'aria-label': `Draft pack ${String(props.next.round)}, pick ${String(props.next.pickNumber)}`,
            },
            // The route's own reading order (rarest first, or best rated first
            // where the format has ratings and the switch is on) rather than
            // the order the sheets dealt, and the dealt index travels with the
            // card because that index is what a selection names. `./pack-order.ts`
            // argues both; `ratingsSwitch` is what lets a route drop back to
            // rarest-first without a second reading of `presentation.ratingOf`.
            ...presentation
              .orderPack(props.next.cards, { ratingsShown: ratingsSwitch.enabled })
              .map(({ card, index }, slot) =>
                presentation.renderFace(card, {
                  key: `${String(props.next.round)}/${String(props.next.pickNumber)}/${String(index)}/${presentation.keyOf(card)}`,
                  // A pack is a reading surface, so it uses the same complete
                  // face as deckbuilding and the preview rail. Reusing the
                  // battlefield's adaptive `board` face made each card trade
                  // picture against rules text independently, which left a pack
                  // looking like a mixture of unrelated crops and text panels.
                  // The grid still scales this one face down on phones; it does
                  // not substitute a second card anatomy.
                  size: 'full',
                  selected: index === chosenIndex,
                  // Every pack after the first: committing removes the button
                  // that was pressed, and without this focus falls to the body —
                  // a keyboard player would have to tab back in from the top of
                  // the document once per pick.
                  //
                  // Not the first, which is `mtg-dcxg.5`. Nothing has been
                  // pressed on a pack that opens with the route, so there is no
                  // focus to give back, and the ring an autofocus paints on the
                  // opening face reads as a choice: the 2026-08-23 sweep's
                  // `out/shots/route-draft.portrait.png` shows the first card of
                  // the pack ringed above a rail saying "Choose a card in the
                  // pack to read it here". A tap is what selects here, and until
                  // there has been one the pack draws nothing as chosen.
                  autoFocus: slot === 0 && taken > 0,
                  onSelect: (): void => select(index),
                  // Reading, never choosing: the panel fills while the pointer
                  // crosses the pack and the commit button below it keeps naming
                  // whatever was actually chosen.
                  onHover: (isHovered: boolean): void => {
                    if (isHovered) {
                      setHover({ at: taken, index });
                      return;
                    }
                    // Only the face that is still holding the panel may empty it.
                    // A pointer crossing from one card to the next delivers the
                    // leave and the enter in that order, but focus does not: a
                    // click moves focus to the pressed face before the old one
                    // blurs, and an unguarded clear would blank the panel on the
                    // way into a card.
                    setHover((seen) =>
                      seen !== null && seen.at === taken && seen.index === index ? null : seen,
                    );
                  },
                }),
              ),
          ),
        ),
        // The divider, drawn only when there is a pool to divide from: before
        // the first pick the pack has the column to itself and there is no
        // second pane for a handle to be between.
        props.pool.length === 0 || picks.collapsed
          ? null
          : createElement(SplitHandle, {
              label: 'the pack and the drafted pool',
              orientation: 'horizontal',
              share: packSplit.share,
              defaultShare: DRAFT_DEFAULT_SHARE,
              onShare: packSplit.setShare,
            }),
        // The pool, under the pack rather than after it: it is the second half
        // of the main column and not a scroll below the page, so it is on
        // screen while the pick is being made. It appears at the first pick and
        // is the same height forever after, which is the one reflow the fixed
        // box buys the whole draft.
        //
        // Shut, it is its head and nothing else: the title, the count and the
        // disclosure stay where they were, so the row a player pressed is the
        // row that reopens it, and the box under them is not drawn.
        props.pool.length === 0
          ? null
          : createElement(
              'section',
              {
                className: 'mtg-draft__pool',
                ...(picks.collapsed ? { 'data-collapsed': 'true' } : {}),
                ...(props.pool.length <= 1 ? { 'data-shallow': 'true' } : {}),
              },
              createElement(
                'div',
                { className: 'mtg-deck__pane-head' },
                createElement('h2', { className: 'mtg-deck__pane-title' }, POOL_SECTION),
                createElement(
                  'span',
                  { className: 'mtg-deck__pane-note' },
                  poolCountLabel(props.pool.length),
                ),
                picks.collapsed
                  ? null
                  : createElement(GroupingControl, {
                      pane: POOL_SECTION,
                      // Every axis: a drafted pool is DSL cards, so each of them
                      // can answer rarity as well as the other three.
                      offered: GROUPINGS,
                      state: grouping,
                    }),
                picksToggle(picks),
              ),
              picks.collapsed
                ? null
                : createElement(
                    'div',
                    { className: 'mtg-draft__poolbox' },
                    poolColumns({
                      pool: props.pool,
                      grouping: grouping.grouping,
                      selectedKey:
                        poolIndex === null ? null : poolStripKey(props.pool, poolIndex, presentation.keyOf),
                      onSelect: (pick): void => {
                        setPoolIndex(pick.index);
                        setSection(CARD_SECTION);
                      },
                      presentation,
                    }),
                  ),
            ),
        // The commit, under the pack while the rail that usually carries it is
        // shut. Never both at once and never neither.
        viewer.collapsed
          ? createElement(
              'div',
              { className: 'mtg-rail__foot' },
              commit,
              createElement('p', { className: 'mtg-rail__note' }, CARD_SECTION_GUIDANCE),
            )
          : null,
      ),
      viewer.collapsed ? null : railSplitHandle(railSplit),
      createElement(ContextRail, {
        label: 'Draft context',
        sections,
        active: section,
        onSelect: setSection,
        head: viewerToggle(viewer),
        collapsed: viewer.collapsed,
        foot: commit,
      }),
    ),
  );
}

/** Executable-set adapter for the representation-neutral draft screen. */
export function DraftPack(props: DraftPackProps): ReactElement {
  const { cards, ...surfaceProps } = props;
  // `rateCards` is a scan of the whole staged set, and the switch's contract
  // is that off computes nothing (`./rating-switch.ts`). So the map is built
  // lazily, on the first `ratingOf` call rather than up front here: while the
  // switch stays off `DraftPackSurface` never calls it, and this closure never
  // runs `rateCards` at all. `useRef` rather than `useMemo`, because the point
  // is to *not* run on every `cards` change — only on first read of whichever
  // set is current — and a ref survives the read without re-triggering it.
  const ratedRef = useRef<{
    readonly cards: readonly DslCard[];
    readonly map: Map<string, EvaluatorRating>;
  } | null>(null);
  const ratingOf = useMemo(() => {
    if (cards === undefined) return undefined;
    return (card: DslCard): DraftCardRating => {
      if (ratedRef.current === null || ratedRef.current.cards !== cards) {
        ratedRef.current = {
          cards,
          map: new Map(rateCards(cards).map((entry) => [entry.card.id, entry])),
        };
      }
      // The pool is the set, so it *has* a ranking; a card it does not hold is
      // that card unranked, and `null` would say the whole set is (`ratingText`).
      // Resolved through `resolveCardRating` (ADR-0005 section 2's ladder) even
      // though this lane only ever has rung 3 to offer, so a generated set's
      // rating is decided by the one shared ladder rather than by this lane
      // inventing its own precedence.
      const resolved = resolveCardRating({ evaluator: ratedRef.current.map.get(card.id) });
      return {
        value: resolved === undefined ? null : ratingValueOf(resolved),
        source: GENERATED_DRAFT_RATING_SOURCE,
      };
    };
  }, [cards]);
  return createElement(DraftPackSurface<DslCard>, {
    ...surfaceProps,
    presentation: dslPresentation(props.artFor, ratingOf),
  });
}
