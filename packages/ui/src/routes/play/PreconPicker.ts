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
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { PreconFacts } from './precon-facts';
import type { OpponentKind } from './deal';

export interface PreconPickerProps {
  readonly facts: readonly PreconFacts[];
  readonly yourDeckId: string;
  readonly opponentDeckId: string;
  readonly onChooseYours: (deckId: string) => void;
  readonly onChooseTheirs: (deckId: string) => void;
  readonly onPlay: (opponent: OpponentKind) => void;
  /** Shown so a table has a name; `#/play?deck=&vs=&seed=` reopens this one. */
  readonly seed: string;
  /** Drawn above the decks when the caller has something to say about the set. */
  readonly note?: string;
}

export const PRECON_LABEL = 'Preconstructed decks';
export const OPPONENT_LABEL = 'Opponent';
export const PRECON_SEED_LABEL = 'seed';
export const PRECON_HOTSEAT_LABEL = 'Two players, one screen';
export const PRECON_PLAY_LABEL = 'Play against the bot';

/** The accessible name of the control that makes a deck the viewer's. */
export function chooseYoursLabel(name: string): string {
  return `Play ${name}`;
}

/** The accessible name of the control that puts a deck across the table. */
export function chooseTheirsLabel(name: string): string {
  return `Opponent plays ${name}`;
}

function fact(label: string, value: string): ReactElement {
  return createElement(
    'span',
    { key: label, className: 'mtg-fact' },
    createElement('span', { className: 'mtg-fact__label' }, label),
    createElement('span', { className: 'mtg-fact__value' }, value),
  );
}

/**
 * One deck, as much as fits on a tile a person decides from.
 *
 * The plan sentence is the whole point of the tile and is drawn first: four
 * lists of card counts are indistinguishable, and four sentences are not.
 */
function deckTile(facts: PreconFacts, chosen: boolean, onSelect: (deckId: string) => void): ReactElement {
  const { deck } = facts;
  return createElement(
    'button',
    {
      key: deck.id,
      type: 'button',
      className: 'mtg-precon-tile',
      'aria-pressed': chosen,
      'data-selected': chosen ? 'true' : undefined,
      'aria-label': chooseYoursLabel(deck.name),
      onClick: (): void => {
        onSelect(deck.id);
      },
    },
    createElement(
      'span',
      { className: 'mtg-precon-tile__head' },
      createElement('span', { className: 'mtg-precon-tile__name' }, deck.name),
      createElement(
        'span',
        { className: 'mtg-precon-tile__colors' },
        facts.colors.length === 0 ? 'colorless' : facts.colors.join(''),
      ),
    ),
    createElement('span', { className: 'mtg-precon-tile__plan' }, deck.plan),
    createElement('span', { className: 'mtg-precon-tile__payoff' }, `Built around ${facts.payoffName}.`),
    createElement(
      'span',
      { className: 'mtg-precon-tile__counts' },
      `${String(facts.creatures)} creatures · ${String(facts.spells)} spells · ${String(facts.lands)} lands · ${String(facts.rares)} rare`,
    ),
  );
}

function opponentButton(
  facts: PreconFacts,
  chosen: boolean,
  onSelect: (deckId: string) => void,
): ReactElement {
  return createElement(
    'button',
    {
      key: facts.deck.id,
      type: 'button',
      className: 'mtg-btn',
      'aria-pressed': chosen,
      ...(chosen ? { 'data-variant': 'primary' } : {}),
      'aria-label': chooseTheirsLabel(facts.deck.name),
      onClick: (): void => {
        onSelect(facts.deck.id);
      },
    },
    facts.deck.name,
  );
}

export function PreconPicker(props: PreconPickerProps): ReactElement {
  const yours = props.facts.find((entry) => entry.deck.id === props.yourDeckId);
  // Every deck in the file is offered as an opponent, the viewer's own included:
  // a mirror is a legitimate and instructive game, and hiding it would make the
  // two rows disagree about which decks exist.
  const ready = yours !== undefined && yours.complete;
  return createElement(
    'div',
    { className: 'mtg-play' },
    createElement(
      'div',
      { className: 'mtg-toolbar' },
      fact('decks', String(props.facts.length)),
      fact(PRECON_SEED_LABEL, props.seed),
      createElement('span', { className: 'mtg-toolbar__spacer' }),
      createElement(
        'button',
        {
          type: 'button',
          className: 'mtg-btn',
          disabled: !ready,
          onClick: (): void => {
            props.onPlay('human');
          },
        },
        PRECON_HOTSEAT_LABEL,
      ),
      createElement(
        'button',
        {
          type: 'button',
          className: 'mtg-btn',
          'data-variant': 'primary',
          disabled: !ready,
          onClick: (): void => {
            props.onPlay('bot');
          },
        },
        PRECON_PLAY_LABEL,
      ),
    ),
    ...(props.note === undefined
      ? []
      : [createElement('p', { className: 'mtg-page-note', key: 'note' }, props.note)]),
    createElement(
      'div',
      { className: 'mtg-panel' },
      createElement(
        'div',
        { className: 'mtg-panel__head' },
        createElement('span', { className: 'mtg-panel__title' }, PRECON_LABEL),
        createElement(
          'span',
          { className: 'mtg-panel__note' },
          yours === undefined ? 'Pick the deck you want to play' : `You are playing ${yours.deck.name}`,
        ),
      ),
      createElement(
        'div',
        { className: 'mtg-panel__body' },
        createElement(
          'div',
          { className: 'mtg-precon-tiles', role: 'group', 'aria-label': PRECON_LABEL },
          ...props.facts.map((entry) =>
            deckTile(entry, entry.deck.id === props.yourDeckId, props.onChooseYours),
          ),
        ),
      ),
    ),
    createElement(
      'div',
      { className: 'mtg-panel' },
      createElement(
        'div',
        { className: 'mtg-panel__head' },
        createElement('span', { className: 'mtg-panel__title' }, OPPONENT_LABEL),
        createElement('span', { className: 'mtg-panel__note' }, 'Which deck sits across the table'),
      ),
      createElement(
        'div',
        { className: 'mtg-panel__body' },
        createElement(
          'div',
          { className: 'mtg-toolbar', role: 'group', 'aria-label': OPPONENT_LABEL },
          ...props.facts.map((entry) =>
            opponentButton(entry, entry.deck.id === props.opponentDeckId, props.onChooseTheirs),
          ),
        ),
      ),
    ),
  );
}
