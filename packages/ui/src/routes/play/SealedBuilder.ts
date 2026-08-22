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
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { Color, Card as DslCard } from '@mtg/dsl';
import { manaValue } from '@mtg/dsl';
import { formatShortfall } from '@mtg/deckbuild';
import type { ManualDeck } from '@mtg/deckbuild';
import { Card } from '../../card/Card';
import { BasicsPanel } from '../deck/BasicsPanel';
import { DeckViewControl, useDeckViewMode } from '../deck/view-mode';
import type { DeckViewMode } from '../deck/view-mode';
import type { OpponentKind } from './deal';
import type { PositionArt } from './position';
import type { SealedBuild } from './sealed';

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
  readonly onPlay: (opponent: OpponentKind) => void;
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
  /** Draft has one human seat; sealed may also seat a second person locally. */
  readonly showHotseat?: boolean;
  /** Explains where this pool and the seat across the table came from. */
  readonly contextNote?: string;
  /** Art for full card faces in the deck and pool panes. */
  readonly artFor?: PositionArt;
}

export const SEALED_POOL_LABEL = 'Sealed pool';

/** Names the toolbar fact carrying the seed, so a test can read it back. */
export const SEED_LABEL = 'seed';

/** The button that seats a second person here rather than a bot. */
export const HOTSEAT_LABEL = 'Two players, one screen';

/**
 * What the second person gets, said out loud.
 *
 * They inherit a deck built for them out of their own sealed pool of this set
 * instead of building it, which is a real difference from what the first person
 * just did and is invisible from the board. Giving the second person a builder
 * of their own is filed work, not a thing this note excuses.
 */
const HOTSEAT_NOTE =
  'Two players share this screen: the board changes hands with the question, and the second player gets a deck built for them from their own sealed pool of this set.';

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

function poolCard(
  build: SealedBuild,
  index: number,
  onToggle: (index: number) => void,
  mode: DeckViewMode,
  artFor: PositionArt | undefined,
): ReactElement {
  const card: DslCard | undefined = build.pool[index];
  if (card === undefined) throw new Error(`sealed pool has no card at index ${String(index)}`);
  const chosen = build.chosen.includes(index);
  return createElement(Card, {
    // Keyed by index rather than card id: a pool holds duplicates, and each copy
    // is its own thing to include or cut.
    key: `pool-${String(index)}`,
    card,
    size: mode,
    art: artFor?.(card) ?? null,
    selected: chosen,
    ...(chosen ? { footnote: 'in deck' } : {}),
    onSelect: (): void => {
      onToggle(index);
    },
  });
}

interface CardGroup {
  readonly manaValue: number;
  readonly indexes: readonly number[];
}

/** Pool indexes grouped into an ascending mana curve without losing duplicate copies. */
export function manaValueGroups(build: SealedBuild, indexes: readonly number[]): readonly CardGroup[] {
  const groups = new Map<number, number[]>();
  for (const index of indexes) {
    const card = build.pool[index];
    if (card === undefined) throw new Error(`sealed pool has no card at index ${String(index)}`);
    const value = card.kind === 'land' ? 0 : manaValue(card.manaCost);
    const held = groups.get(value);
    if (held === undefined) groups.set(value, [index]);
    else held.push(index);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([manaValue, grouped]) => ({ manaValue, indexes: grouped }));
}

function cardPane(props: {
  readonly build: SealedBuild;
  readonly indexes: readonly number[];
  readonly label: string;
  readonly mode: DeckViewMode;
  readonly onToggle: (index: number) => void;
  readonly artFor?: PositionArt;
}): ReactElement {
  const groups = manaValueGroups(props.build, props.indexes);
  if (props.mode === 'full') {
    return createElement(
      'div',
      { className: 'mtg-gallery', role: 'group', 'aria-label': props.label, 'data-view': 'full' },
      ...groups.flatMap((group) =>
        group.indexes.map((index) => poolCard(props.build, index, props.onToggle, props.mode, props.artFor)),
      ),
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
          'aria-label': `Mana value ${String(group.manaValue)}, ${plural(group.indexes.length, 'card')}`,
        },
        createElement(
          'span',
          { className: 'mtg-deck__column-head' },
          createElement('span', { className: 'mtg-deck__column-value' }, `MV ${String(group.manaValue)}`),
          createElement('span', { className: 'mtg-deck__column-count' }, String(group.indexes.length)),
        ),
        ...group.indexes.map((index) =>
          poolCard(props.build, index, props.onToggle, props.mode, props.artFor),
        ),
      ),
    ),
  );
}

export function SealedBuilder(props: SealedBuilderProps): ReactElement {
  const { build, deck } = props;
  const deckView = useDeckViewMode('limited-deck');
  const poolView = useDeckViewMode('limited-pool');
  const legal = deck.complete;
  const poolLabel = props.poolLabel ?? SEALED_POOL_LABEL;
  const playLabel = props.playLabel ?? 'Play this deck';
  const showHotseat = props.showHotseat ?? true;
  const chosenCards = build.chosen.map((index) => build.pool[index]).filter((card) => card !== undefined);
  const creatures = chosenCards.filter((card) => card.kind === 'creature').length;
  const noncreatures = chosenCards.length - creatures;
  const summary = createElement(
    'div',
    { className: 'mtg-toolbar' },
    counter('pool', String(build.pool.length)),
    counter('spells', `${String(deck.spellCount)}/${String(deck.spellTarget)}`),
    counter('creatures', String(creatures)),
    counter('noncreature spells', String(noncreatures)),
    counter('lands', String(deck.lands.length)),
    counter('deck', String(deck.deck.length)),
    counter('colors', deck.colors.length === 0 ? 'none' : deck.colors.join('')),
    counter(SEED_LABEL, props.seed),
    createElement('span', { className: 'mtg-toolbar__spacer' }),
    // Buttons, not choices. The legal-move row is a full-width block on
    // purpose; these are toolbar controls, and borrowing the move list's class
    // made them render as stacked full-width bars with no disabled state.
    createElement(
      'button',
      { type: 'button', className: 'mtg-btn', onClick: props.onSuggest },
      'Suggest a build',
    ),
    createElement('button', { type: 'button', className: 'mtg-btn', onClick: props.onClear }, 'Clear'),
    showHotseat
      ? createElement(
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
        )
      : null,
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
      playLabel,
    ),
  );

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
      createElement('li', { key: `short-${String(index)}` }, formatShortfall(shortfall)),
    ),
  ];
  const problems =
    notes.length === 0 ? null : createElement('ul', { className: 'mtg-play__notes' }, ...notes);

  return createElement(
    'div',
    { className: 'mtg-play' },
    summary,
    createElement('p', { className: 'mtg-page-note' }, props.contextNote ?? HOTSEAT_NOTE),
    problems,
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
        createElement('span', { className: 'mtg-panel__title' }, 'Your deck'),
        // The spells, because the lands are a panel of their own now and a note
        // repeating their split one panel away would be a second place to keep
        // right.
        createElement(
          'span',
          { className: 'mtg-panel__note' },
          `${plural(creatures, 'creature')} · ${plural(noncreatures, 'noncreature spell')} · sorted by mana value`,
        ),
        createElement(DeckViewControl, { pane: 'Your deck', state: deckView }),
      ),
      createElement(
        'div',
        { className: 'mtg-panel__body' },
        createElement('p', { className: 'mtg-prompt__explain' }, 'Click a card to cut it from the deck.'),
        cardPane({
          build,
          indexes: build.chosen,
          label: 'Cards in your deck',
          mode: deckView.mode,
          onToggle: props.onToggle,
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
        createElement('span', { className: 'mtg-panel__title' }, poolLabel),
        createElement(
          'span',
          { className: 'mtg-panel__note' },
          `${String(build.pool.length - build.chosen.length)} not in the deck`,
        ),
        createElement(DeckViewControl, { pane: poolLabel, state: poolView }),
      ),
      createElement(
        'div',
        { className: 'mtg-panel__body' },
        cardPane({
          build,
          indexes: build.pool.map((_card, index) => index).filter((index) => !build.chosen.includes(index)),
          label: poolLabel,
          mode: poolView.mode,
          onToggle: props.onToggle,
          ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
        }),
      ),
    ),
  );
}
