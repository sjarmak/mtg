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
 * search box.
 *
 * The mana base is `BasicsPanel`, shared with sealed. Nothing about counting out
 * lands differs between the formats.
 *
 * Two things on this screen are not the pool or the cards, and both come from
 * one ask (the playtester, 2026-08-20). `SavedDecksPanel` gives the build a name and
 * a life longer than the tab — until it landed, the whole deck lived in
 * `ConstructedGame`'s `useState` and closing the page lost it. And the deck's
 * mana curve is drawn above the deck pane at *every* density, because the
 * columns that already answered "how many two-drops" only exist in compact and
 * compact is not the default.
 */
import { createElement, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { Color, Card as DslCard } from '@mtg/dsl';
import { formatCopyExcess, formatShortfall } from '@mtg/deckbuild';
import type { ManualDeck } from '@mtg/deckbuild';
import { Card } from '../../card/Card';
import type { OpponentKind } from '../play/deal';
import type { PositionArt } from '../play/position';
import { BasicsPanel } from './BasicsPanel';
import { curveLabel, manaValueGroups } from './columns';
import type { ManaValueGroup } from './columns';
import { SavedDecksPanel } from './SavedDecksPanel';
import { DeckViewControl, useDeckViewMode } from './view-mode';
import type { DeckViewMode } from './view-mode';
import { cardManaValue, chosenCards, copiesOf, manaCurve, selectable, spellCount } from './build';
import type { ConstructedBuild, CurveStep } from './build';
import {
  COLOR_FACETS,
  COLOR_FACET_NAMES,
  WHOLE_POOL,
  filterPool,
  indexPool,
  isWholePool,
  setCodesIn,
  toggleColor,
  toggleSet,
  withText,
} from './pool-filter';
import type { ColorFacet, PoolFilter } from './pool-filter';

export const CONSTRUCTED_POOL_LABEL = 'Playable cards';

export const DECK_LABEL = 'Your deck';

/** The search box, named so a test can type into it. */
export const SEARCH_LABEL = 'Search the playable cards';

export const CLEAR_FILTER_LABEL = 'Show every card';

export const CLEAR_DECK_LABEL = 'Clear the deck';

export const PLAY_LABEL = 'Play this deck';

export const HOTSEAT_LABEL = 'Two players, one screen';

/**
 * What a mirror match is, said out loud.
 *
 * Constructed has no pool to open a second deck out of, so both seats play the
 * list that was just built. That is a real fact about the game about to start
 * and is invisible from the board.
 */
export const MIRROR_NOTE =
  'Both seats play the deck you just built: Constructed has no pool to deal an opponent out of, and facing your own list is the reading that tells you something about it.';

export interface ConstructedBuilderProps {
  readonly build: ConstructedBuild;
  readonly deck: ManualDeck;
  /** Plays one more copy of a card, up to four. */
  readonly onAdd: (cardId: string) => void;
  /** Cuts one copy. */
  readonly onCut: (cardId: string) => void;
  readonly onClear: () => void;
  readonly onAdjustBasics: (color: Color, delta: number) => void;
  readonly onSuggestBasics: () => void;
  /** Starts the game. Enabled only when the deck is legal. */
  readonly onPlay: (opponent: OpponentKind) => void;
  /** Reopens a saved deck: hands the builder's owner a whole build to hold. */
  readonly onLoad: (build: ConstructedBuild) => void;
  /** Opens one of the set's written decks here to edit. */
  readonly starters?: readonly { readonly id: string; readonly name: string }[];
  readonly onStart?: (id: string) => void;
  readonly artFor?: PositionArt;
}

function counter(label: string, value: string): ReactElement {
  return createElement(
    'span',
    { key: label, className: 'mtg-fact' },
    createElement('span', { className: 'mtg-fact__label' }, label),
    createElement('span', { className: 'mtg-fact__value' }, value),
  );
}

function plural(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${String(count)} ${noun}s`;
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
 * The grouping itself is `./columns.ts`'s, shared with the artifact pane and the
 * precon pane; what stays here is the one thing this pane knows that neither of
 * them does, which is that a mana value comes off a DSL card through
 * `./build.ts`'s `cardManaValue`.
 */
function cardGroups(
  cards: readonly DslCard[],
  weigh: (card: DslCard) => number,
): readonly ManaValueGroup<DslCard>[] {
  return manaValueGroups(cards, cardManaValue, weigh);
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
  readonly artFor?: PositionArt;
}): ReactElement {
  const { card, copies } = props;
  return createElement(
    'div',
    { key: card.id, className: 'mtg-copies', 'data-copies': String(copies) },
    createElement(Card, {
      card,
      size: props.mode,
      art: props.artFor?.(card) ?? null,
      selected: copies > 0,
      onSelect: (): void => {
        props.onSelect(card.id);
      },
      onMenu: (): void => {
        props.onMenu(card.id);
      },
    }),
    copies === 0
      ? null
      : createElement('span', { className: 'mtg-copies__count' }, `${String(copies)} in deck`),
  );
}

function cardPane(props: {
  readonly cards: readonly DslCard[];
  readonly build: ConstructedBuild;
  readonly label: string;
  readonly mode: DeckViewMode;
  readonly weigh: (card: DslCard) => number;
  readonly onSelect: (cardId: string) => void;
  readonly onMenu: (cardId: string) => void;
  readonly artFor?: PositionArt;
}): ReactElement {
  const face = (card: DslCard): ReactElement =>
    cardFace({
      card,
      copies: copiesOf(props.build, card.id),
      mode: props.mode,
      onSelect: props.onSelect,
      onMenu: props.onMenu,
      ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
    });
  const groups = cardGroups(props.cards, props.weigh);
  if (props.mode === 'full') {
    return createElement(
      'div',
      { className: 'mtg-gallery', role: 'group', 'aria-label': props.label, 'data-view': 'full' },
      ...groups.flatMap((group) => group.members.map(face)),
    );
  }
  return createElement(
    'div',
    { className: 'mtg-builder-curve', role: 'group', 'aria-label': props.label, 'data-view': 'compact' },
    ...groups.map((group) =>
      createElement(
        'div',
        {
          key: String(group.manaValue),
          className: 'mtg-deck__column',
          role: 'group',
          'aria-label': curveLabel(group.manaValue, group.cards),
        },
        createElement(
          'span',
          { className: 'mtg-deck__column-head' },
          createElement('span', { className: 'mtg-deck__column-value' }, `MV ${String(group.manaValue)}`),
          createElement('span', { className: 'mtg-deck__column-count' }, String(group.cards)),
        ),
        ...group.members.map(face),
      ),
    ),
  );
}

/** What the curve strip is called, out loud and in a test. */
export const MANA_CURVE_LABEL = 'Mana curve';

/**
 * The deck's curve, drawn above the deck pane at every density.
 *
 * The playtester, 2026-08-20: "we can sort by mana cost to be able to see at a glance
 * how many one drops, two drops, three drops etc we have". The compact pane's
 * columns already answered that — and only in compact, which is not the default
 * (`./view-mode.ts` keeps full as the default and gives the reason), so the
 * answer was two presses away in the one place it is most wanted. This is the
 * same numbers, detached from the columns, so switching density changes how the
 * cards are drawn and never whether the curve is on screen.
 *
 * Not a third view mode, which `./view-mode.ts` says is a bead rather than a
 * quiet addition. It is a readout, like the counters in the toolbar above it.
 *
 * Each rung is named for a screen reader and its drawing is hidden, because
 * "MV 3" beside "8" is two numbers in a row when it is spoken — the same reason
 * `./columns.ts` writes the sentence out rather than reading the pip.
 */
function curveStrip(steps: readonly CurveStep[]): ReactElement | null {
  if (steps.length === 0) return null;
  const tallest = steps.reduce((most, step) => Math.max(most, step.cards), 0);
  return createElement(
    'ul',
    { className: 'mtg-curve', role: 'list', 'aria-label': MANA_CURVE_LABEL },
    ...steps.map((step) =>
      createElement(
        'li',
        {
          key: String(step.manaValue),
          className: 'mtg-curve__step',
          'aria-label': curveLabel(step.manaValue, step.cards),
        },
        createElement('span', { className: 'mtg-curve__count', 'aria-hidden': true }, String(step.cards)),
        createElement(
          'span',
          { className: 'mtg-curve__bar', 'aria-hidden': true },
          createElement('span', {
            className: 'mtg-curve__stem',
            // Data, so it is written here rather than in the sheet, exactly as
            // `../DeckRoute.ts` writes its track count. The bar's own shape is
            // the sheet's.
            style: { height: `${String(tallest === 0 ? 0 : Math.round((step.cards / tallest) * 100))}%` },
          }),
        ),
        createElement(
          'span',
          { className: 'mtg-curve__value', 'aria-hidden': true },
          `MV ${String(step.manaValue)}`,
        ),
      ),
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
    ...COLOR_FACETS.map((facet: ColorFacet) =>
      createElement(
        'button',
        {
          key: facet,
          type: 'button',
          className: 'mtg-btn',
          'aria-pressed': filter.colors.includes(facet),
          'aria-label': COLOR_FACET_NAMES[facet],
          onClick: (): void => {
            onFilter(toggleColor(filter, facet));
          },
        },
        facet,
      ),
    ),
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
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-btn',
        disabled: isWholePool(filter),
        onClick: (): void => {
          onFilter(WHOLE_POOL);
        },
      },
      CLEAR_FILTER_LABEL,
    ),
  );
}

export function ConstructedBuilder(props: ConstructedBuilderProps): ReactElement {
  const { build, deck } = props;
  const deckView = useDeckViewMode('constructed-deck');
  const poolView = useDeckViewMode('constructed-pool');
  const [filter, setFilter] = useState<PoolFilter>(WHOLE_POOL);

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
  const creatures = inDeck.filter((card) => card.kind === 'creature').length;
  const noncreatures = inDeck.length - creatures;
  const legal = deck.complete;

  const summary = createElement(
    'div',
    { className: 'mtg-toolbar' },
    counter('pool', String(entries.length)),
    counter('spells', `${String(spellCount(build))}/${String(deck.spellTarget)}`),
    counter('creatures', String(creatures)),
    counter('noncreature spells', String(noncreatures)),
    counter('lands', String(deck.lands.length)),
    counter('deck', `${String(deck.deck.length)}/${String(deck.config.deckSize)}`),
    counter('colors', deck.colors.length === 0 ? 'none' : deck.colors.join('')),
    createElement('span', { className: 'mtg-toolbar__spacer' }),
    createElement(
      'button',
      { type: 'button', className: 'mtg-btn', disabled: inDeck.length === 0, onClick: props.onClear },
      CLEAR_DECK_LABEL,
    ),
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-btn',
        disabled: !legal,
        onClick: (): void => {
          props.onPlay('human');
        },
      },
      HOTSEAT_LABEL,
    ),
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-btn',
        'data-variant': 'primary',
        disabled: !legal,
        onClick: (): void => {
          props.onPlay('bot');
        },
      },
      PLAY_LABEL,
    ),
  );

  // Notes, not blockers, with one exception the sealed screen does not have: a
  // fifth copy is against the rules of the format rather than against the odds,
  // so it is reported here *and* keeps the play buttons dark through
  // `deck.complete`.
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
    ...deck.excesses.map((excess) =>
      createElement('li', { key: `excess-${excess.name}` }, formatCopyExcess(excess)),
    ),
    ...deck.shortfalls.map((shortfall, index) =>
      createElement('li', { key: `short-${String(index)}` }, formatShortfall(shortfall)),
    ),
  ];

  const starters = props.starters ?? [];
  const startRow =
    starters.length === 0 || props.onStart === undefined
      ? null
      : createElement(
          'div',
          { className: 'mtg-toolbar', role: 'group', 'aria-label': 'Start from a written deck' },
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
    { className: 'mtg-play' },
    summary,
    createElement('p', { className: 'mtg-page-note' }, MIRROR_NOTE),
    notes.length === 0 ? null : createElement('ul', { className: 'mtg-play__notes' }, ...notes),
    startRow,
    createElement(SavedDecksPanel, { build, onLoad: props.onLoad }),
    createElement(BasicsPanel, {
      deck,
      chosen: build.basics !== null,
      onAdjustBasics: props.onAdjustBasics,
      onSuggestBasics: props.onSuggestBasics,
    }),
    createElement(
      'div',
      { className: 'mtg-panel' },
      createElement(
        'div',
        { className: 'mtg-panel__head' },
        createElement('span', { className: 'mtg-panel__title' }, DECK_LABEL),
        createElement(
          'span',
          { className: 'mtg-panel__note' },
          `${plural(inDeck.length, 'card')} · ${plural(creatures, 'creature')} · ${plural(noncreatures, 'noncreature spell')} · sorted by mana value`,
        ),
        createElement(DeckViewControl, { pane: DECK_LABEL, state: deckView }),
      ),
      createElement(
        'div',
        { className: 'mtg-panel__body' },
        curveStrip(curve),
        createElement(
          'p',
          { className: 'mtg-prompt__explain' },
          'Click a card to cut one copy; right click to play another.',
        ),
        cardPane({
          cards: distinct,
          build,
          label: 'Cards in your deck',
          mode: deckView.mode,
          weigh: copies,
          onSelect: props.onCut,
          onMenu: props.onAdd,
          ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
        }),
      ),
    ),
    createElement(
      'div',
      { className: 'mtg-panel' },
      createElement(
        'div',
        { className: 'mtg-panel__head' },
        createElement('span', { className: 'mtg-panel__title' }, CONSTRUCTED_POOL_LABEL),
        createElement(
          'span',
          { className: 'mtg-panel__note' },
          'Every card the kernel can run, up to four copies each',
        ),
        createElement(DeckViewControl, { pane: CONSTRUCTED_POOL_LABEL, state: poolView }),
      ),
      createElement(
        'div',
        { className: 'mtg-panel__body' },
        filterPanel({
          filter,
          setCodes,
          onFilter: setFilter,
          shown: shown.length,
          total: entries.length,
        }),
        cardPane({
          cards: shown.map((entry) => entry.card),
          build,
          label: CONSTRUCTED_POOL_LABEL,
          mode: poolView.mode,
          weigh: one,
          onSelect: props.onAdd,
          onMenu: props.onCut,
          ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
        }),
      ),
    ),
  );
}
