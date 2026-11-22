/**
 * Choosing a preconstructed deck, and who is holding the other one.
 *
 * The screen a person lands on when a precon file is staged. It is not a
 * deckbuilder: nothing here can be edited, because the whole promise of a
 * precon is that somebody already made every decision and you get to play. So
 * the only two questions are which deck is yours and which one is across the
 * table, and both are answered by pressing a name.
 *
 * Two rows rather than one control with a mode, because the two questions are
 * genuinely different and a child reading the screen should not have to hold
 * which one a click currently means. Every button carries its own accessible
 * name — `Play <deck>` against `Opponent plays <deck>` — so the rail-contract
 * rule that two controls must not read alike holds here too.
 *
 * # The start buttons sit under the matchup, not over the page
 *
 * They used to be the right-hand end of a toolbar above everything, which put
 * *Play against bot* three sections away from the deck it would play and gave
 * it no way to say which two decks it meant. the playtester's instruction is that
 * the start actions be "visually associated with the selected matchup rather
 * than floating in the top right", so the matchup states itself — your deck
 * against theirs — and the two buttons belong to that statement.
 *
 * # No seed on the picker
 *
 * The toolbar also printed the seed of the deal that had not happened yet,
 * which is a build detail on the one screen a person opens to play a game.
 * Nothing about reproducibility is lost: the seed is fixed at the deal and the
 * table still carries it (`./precon-strip.ts`), which is where a game that
 * exists can be named.
 *
 * # Headings, not panels
 *
 * Two bordered panels around two short lists made the page three boxes deep,
 * counting the section the chooser already wraps this in. A small-caps label
 * over a grid is the treatment `.mtg-group__title` exists for, and the deck
 * panes use it for the same job.
 */
import { createElement, useState } from 'react';
import type { ReactElement } from 'react';
import { DECK_CARD_GRID_CLASS, DeckCard, preconCountsLine } from '../deck/DeckCard';
import type { PlayableDeck } from './playable-deck';

export interface PreconPickerProps {
  /**
   * Every deck that can be seated, whoever made it.
   *
   * `PlayableDeck` rather than `PreconFacts` since `mtg-pxdo`: the playtester asked
   * to pick a deck the workbench built here the same way she picks Sky Islands,
   * and this row is where a deck is picked. What a deck came from rides along as
   * a badge (`origin`) rather than as a type, because nothing on this screen
   * does anything different with one.
   */
  readonly decks: readonly PlayableDeck[];
  readonly yourDeckId: string;
  readonly opponentDeckId: string;
  readonly onChooseYours: (deckId: string) => void;
  readonly onChooseTheirs: (deckId: string) => void;
  readonly onPlay: () => void;
  /** Drawn above the decks when the caller has something to say about the set. */
  readonly note?: string;
}

/**
 * The accessible name of the deck grid.
 *
 * *Your deck*, not *Preconstructed decks*: the section around this already
 * carries that name (`./PlayChooser.ts`), and a group repeating its own region's
 * label is two answers to one question for anyone reading with a screen reader.
 * What this group actually answers is which of the decks is yours, which is also
 * what pairs it with `OPPONENT_LABEL`.
 */
export const PRECON_LABEL = 'Your deck';
/** The filter row's own name, and the chip that clears it. */
export const SET_FILTER_LABEL = 'Decks from';
export const ALL_SETS_LABEL = 'All sets';
export const OPPONENT_LABEL = 'Opponent';
export const PRECON_PLAY_LABEL = 'Play against bot';

/** The accessible name of the control that makes a deck the viewer's. */
export function chooseYoursLabel(name: string): string {
  return `Play ${name}`;
}

/** The accessible name of the control that puts a deck across the table. */
export function chooseTheirsLabel(name: string): string {
  return `Opponent plays ${name}`;
}

/**
 * One deck, as much as fits on a tile a person decides from.
 *
 * The plan sentence is the whole point of the tile and is drawn first: four
 * lists of card counts are indistinguishable, and four sentences are not.
 *
 * The tile itself is `../deck/DeckCard.ts`, shared with the Decks library. What
 * stays here is the translation from `PreconFacts` to it, because what a precon
 * knows about itself is this route's business and the tile's job is to draw a
 * deck.
 */
function deckTile(deck: PlayableDeck, chosen: boolean, onSelect: (deckId: string) => void): ReactElement {
  return createElement(DeckCard, {
    key: deck.id,
    name: deck.name,
    // The badge says where it came from. A written deck and a deck somebody
    // described are different promises about what is in it, and a row of five
    // tiles that did not say which was which would be the Decks tab's own
    // `mtg-tewc.6` again.
    kind: deck.origin === 'precon' ? 'precon' : 'variation',
    colors: deck.colors,
    plan: deck.plan,
    ...(deck.centerpiece === null ? {} : { centerpiece: deck.centerpiece }),
    counts: preconCountsLine(deck),
    selected: chosen,
    actionLabel: chooseYoursLabel(deck.name),
    onSelect: (): void => {
      onSelect(deck.id);
    },
  });
}

/**
 * One deck as an opponent, as a chip.
 *
 * A chip rather than a `.mtg-btn` with a primary variant: the primary variant is
 * the vocabulary of the action that starts the game, and lending it to a
 * selection made the chosen opponent look like the thing to press next. Chosen
 * is carried by `aria-pressed` as well as by the fill, because a person choosing
 * between five chips under WCAG 1.4.1 cannot be asked to see a hue.
 */
export function opponentChip(
  deck: Pick<PlayableDeck, 'id' | 'name'>,
  chosen: boolean,
  onSelect: (deckId: string) => void,
): ReactElement {
  return createElement(
    'button',
    {
      key: deck.id,
      type: 'button',
      className: 'mtg-chip',
      'aria-pressed': chosen,
      'data-selected': chosen ? 'true' : undefined,
      'aria-label': chooseTheirsLabel(deck.name),
      onClick: (): void => {
        onSelect(deck.id);
      },
    },
    deck.name,
  );
}

/** A small-caps label over a list, the treatment every short list on this app takes. */
export function group(label: string, body: ReactElement): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-group', key: label },
    createElement('h3', { className: 'mtg-group__title' }, label),
    body,
  );
}

/**
 * Every set any offered deck is cut from, in the order the decks introduce them.
 *
 * Derived rather than taken as a prop: the filter's job is to narrow *this row*,
 * so a set with no deck in it would be a chip that empties the screen, and the
 * staged index holds several of those.
 */
function setsOffered(decks: readonly PlayableDeck[]): readonly string[] {
  const seen: string[] = [];
  for (const deck of decks) {
    for (const code of deck.sets) if (!seen.includes(code)) seen.push(code);
  }
  return seen;
}

export function PreconPicker(props: PreconPickerProps): ReactElement {
  // Which set the row is narrowed to, or `null` for all of them. Held here
  // rather than lifted, because nothing outside this row acts on it: the two
  // chosen decks stay chosen while it moves, so filtering cannot lose a matchup
  // somebody has already set up.
  const [onlySet, setOnlySet] = useState<string | null>(null);
  const offered = setsOffered(props.decks);
  const shown = onlySet === null ? props.decks : props.decks.filter((deck) => deck.sets.includes(onlySet));
  const yours = props.decks.find((entry) => entry.id === props.yourDeckId);
  const theirs = props.decks.find((entry) => entry.id === props.opponentDeckId);
  // Every deck in the file is offered as an opponent, the viewer's own included:
  // a mirror is a legitimate and instructive game, and hiding it would make the
  // two rows disagree about which decks exist.
  const ready = yours !== undefined && yours.complete && theirs !== undefined;
  return createElement(
    'div',
    { className: 'mtg-play' },
    ...(props.note === undefined
      ? []
      : [createElement('p', { className: 'mtg-page-note', key: 'note' }, props.note)]),
    // Only when there is a choice to make. One staged set is the ordinary lab and
    // a filter with a single option is a control that cannot be used.
    ...(offered.length < 2
      ? []
      : [
          group(
            SET_FILTER_LABEL,
            createElement(
              'div',
              { className: 'mtg-chips', role: 'group', 'aria-label': SET_FILTER_LABEL, key: 'sets' },
              createElement(
                'button',
                {
                  key: 'all',
                  type: 'button',
                  className: 'mtg-chip',
                  'aria-pressed': onlySet === null,
                  'data-selected': onlySet === null ? 'true' : undefined,
                  onClick: (): void => {
                    setOnlySet(null);
                  },
                },
                ALL_SETS_LABEL,
              ),
              ...offered.map((code) =>
                createElement(
                  'button',
                  {
                    key: code,
                    type: 'button',
                    className: 'mtg-chip',
                    'aria-pressed': onlySet === code,
                    'data-selected': onlySet === code ? 'true' : undefined,
                    onClick: (): void => {
                      setOnlySet(onlySet === code ? null : code);
                    },
                  },
                  code,
                ),
              ),
            ),
          ),
        ]),
    createElement(
      'div',
      { className: DECK_CARD_GRID_CLASS, role: 'group', 'aria-label': PRECON_LABEL },
      ...shown.map((entry) => deckTile(entry, entry.id === props.yourDeckId, props.onChooseYours)),
    ),
    group(
      OPPONENT_LABEL,
      createElement(
        'div',
        { className: 'mtg-chips', role: 'group', 'aria-label': OPPONENT_LABEL },
        ...shown.map((entry) => opponentChip(entry, entry.id === props.opponentDeckId, props.onChooseTheirs)),
      ),
    ),
    createElement(
      'div',
      { className: 'mtg-matchup' },
      createElement(
        'p',
        { className: 'mtg-matchup__line' },
        createElement('span', { className: 'mtg-matchup__deck' }, yours?.name ?? '—'),
        createElement('span', { className: 'mtg-matchup__vs' }, 'vs'),
        createElement('span', { className: 'mtg-matchup__deck' }, theirs?.name ?? '—'),
      ),
      createElement(
        'div',
        { className: 'mtg-matchup__actions' },
        createElement(
          'button',
          {
            type: 'button',
            className: 'mtg-btn',
            'data-variant': 'primary',
            disabled: !ready,
            onClick: props.onPlay,
          },
          PRECON_PLAY_LABEL,
        ),
      ),
    ),
  );
}
