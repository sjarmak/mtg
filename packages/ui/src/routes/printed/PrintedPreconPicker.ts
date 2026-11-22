import { createElement as h } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { PrintedConstructedDeck } from '@mtg/printed-card';
import { DECK_CARD_GRID_CLASS, DeckCard } from '../deck/DeckCard';
import { OPPONENT_LABEL, PRECON_LABEL, chooseYoursLabel, group, opponentChip } from '../play/PreconPicker';
import { printedCountsLine } from './printed-precon-facts';
import type { PrintedPreconFacts } from './printed-precon-facts';

export interface PrintedPreconPickerProps {
  readonly decks: readonly PrintedConstructedDeck[];
  readonly facts: ReadonlyMap<string, PrintedPreconFacts>;
  readonly yourDeckId: string;
  readonly opponentDeckId: string | null;
  readonly onChooseYours: (deckId: string) => void;
  readonly onChooseTheirs: (deckId: string) => void;
}

function factsOf(props: PrintedPreconPickerProps, deck: PrintedConstructedDeck): PrintedPreconFacts {
  const facts = props.facts.get(deck.id);
  if (facts === undefined) throw new Error(`${deck.name} has no measured facts`);
  return facts;
}

function deckTile(props: PrintedPreconPickerProps, deck: PrintedConstructedDeck): ReactElement {
  const facts = factsOf(props, deck);
  return h(DeckCard, {
    key: deck.id,
    name: deck.name,
    kind: 'precon',
    colors: facts.colors,
    counts: printedCountsLine(facts),
    selected: deck.id === props.yourDeckId,
    actionLabel: chooseYoursLabel(deck.name),
    onSelect: (): void => {
      props.onChooseYours(deck.id);
    },
  });
}

export function PrintedPreconPicker(props: PrintedPreconPickerProps): ReactElement {
  const opponent = props.opponentDeckId;
  return h(
    'div',
    { className: 'mtg-play' },
    h(
      'div',
      { className: DECK_CARD_GRID_CLASS, role: 'group', 'aria-label': PRECON_LABEL },
      ...props.decks.map((deck) => deckTile(props, deck)),
    ),
    opponent === null
      ? null
      : group(
          OPPONENT_LABEL,
          h(
            'div',
            { className: 'mtg-chips', role: 'group', 'aria-label': OPPONENT_LABEL },
            ...props.decks.map((deck) => opponentChip(deck, deck.id === opponent, props.onChooseTheirs)),
          ),
        ),
  );
}

export function printedMatchup(
  yours: string,
  theirs: string | null,
  actions: readonly ReactNode[],
): ReactElement {
  return h(
    'div',
    { className: 'mtg-matchup' },
    h(
      'p',
      { className: 'mtg-matchup__line' },
      h('span', { className: 'mtg-matchup__deck' }, yours),
      ...(theirs === null
        ? []
        : [
            h('span', { className: 'mtg-matchup__vs', key: 'vs' }, 'vs'),
            h('span', { className: 'mtg-matchup__deck', key: 'theirs' }, theirs),
          ]),
    ),
    h('div', { className: 'mtg-matchup__actions' }, ...actions),
  );
}
