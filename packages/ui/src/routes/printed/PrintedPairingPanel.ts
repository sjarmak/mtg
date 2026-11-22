import { createElement as h } from 'react';
import type { ReactElement } from 'react';
import { rankHeadToHeadByCloseness, rankOpponentsByCloseness } from '@mtg/printed-card';
import type {
  CommanderHeadToHeadResults,
  PairingDeck,
  PrintedDeckWinRates,
  RankedOpponent,
} from '@mtg/printed-card';
import {
  CLOSEST_MATCH_UNAVAILABLE_COPY,
  HEAD_TO_HEAD_PANEL_LABEL,
  HEAD_TO_HEAD_RANKED_LABEL,
  NO_HEAD_TO_HEAD_OPPONENT_COPY,
  NO_MEASURED_OPPONENT_COPY,
  NO_WIN_RATE_COPY,
  PAIRING_PANEL_LABEL,
  RANKED_OPPONENTS_LABEL,
  acrossTheTableCopy,
  closestMatchLabel,
  closestMatchSeatedCopy,
  headToHeadBasisCopy,
  headToHeadClosestMatchLabel,
  headToHeadClosestMatchSeatedCopy,
  headToHeadOpponentCopy,
  headToHeadSeatedCopy,
  opponentGapCopy,
  pairingBasisCopy,
  yourDeckCopy,
} from './pairing-copy';

interface Props {
  readonly table: PrintedDeckWinRates;
  readonly headToHead?: CommanderHeadToHeadResults;
  readonly decks: readonly PairingDeck[];
  readonly mine: PairingDeck;
  readonly opponent: PairingDeck | null;
  readonly onChooseOpponent: (deckId: string) => void;
}

function frame(...children: readonly (ReactElement | null)[]): ReactElement {
  return h(
    'section',
    { className: 'mtg-pairing', 'aria-label': PAIRING_PANEL_LABEL },
    h('h2', { className: 'mtg-pairing__title' }, PAIRING_PANEL_LABEL),
    ...children,
  );
}

function line(text: string): ReactElement {
  return h('p', { className: 'mtg-pairing__line' }, text);
}

function headToHeadBlock(
  table: CommanderHeadToHeadResults | undefined,
  decks: readonly PairingDeck[],
  mine: PairingDeck,
  opponent: PairingDeck | null,
  onChooseOpponent: (deckId: string) => void,
): ReactElement | null {
  if (table === undefined) return null;
  const heading = h('h3', { className: 'mtg-pairing__label' }, HEAD_TO_HEAD_PANEL_LABEL);
  const basis = h('p', { className: 'mtg-hint' }, headToHeadBasisCopy());
  if (opponent === null) {
    return h('div', { className: 'mtg-pairing__head-to-head' }, heading, basis);
  }
  const ranking = rankHeadToHeadByCloseness(
    mine,
    decks.filter((deck) => deck.id !== mine.id),
    table,
  );
  const seated = ranking.find((entry) => entry.deck.id === opponent.id);
  const closest = ranking.find((entry) => entry.measured);
  const closestControl =
    closest === undefined
      ? line(NO_HEAD_TO_HEAD_OPPONENT_COPY)
      : closest.deck.id === opponent.id
        ? line(headToHeadClosestMatchSeatedCopy(closest.deck, mine))
        : h(
            'button',
            {
              type: 'button',
              className: 'mtg-btn',
              onClick: () => {
                onChooseOpponent(closest.deck.id);
              },
            },
            headToHeadClosestMatchLabel(closest.deck),
          );
  return h(
    'div',
    { className: 'mtg-pairing__head-to-head' },
    heading,
    seated === undefined ? null : line(headToHeadSeatedCopy(mine, seated)),
    closestControl,
    h('h4', { className: 'mtg-pairing__label' }, HEAD_TO_HEAD_RANKED_LABEL),
    h(
      'div',
      { className: 'mtg-pairing__opponents', role: 'group', 'aria-label': HEAD_TO_HEAD_RANKED_LABEL },
      ranking.map((entry) =>
        h(
          'button',
          {
            key: entry.deck.id,
            type: 'button',
            className: 'mtg-chip',
            'data-selected': entry.deck.id === opponent.id,
            'aria-pressed': entry.deck.id === opponent.id,
            onClick: () => {
              onChooseOpponent(entry.deck.id);
            },
          },
          headToHeadOpponentCopy(mine, entry),
        ),
      ),
    ),
    basis,
  );
}

export function PrintedPairingPanel(props: Props): ReactElement {
  const { table, headToHead, decks, mine, opponent, onChooseOpponent } = props;
  const headToHeadSection = headToHeadBlock(headToHead, decks, mine, opponent, onChooseOpponent);
  const ranking = rankOpponentsByCloseness(
    mine,
    decks.filter((deck) => deck.id !== mine.id),
    table,
  );
  if (ranking.kind === 'unmeasured') {
    return frame(
      line(NO_WIN_RATE_COPY),
      opponent === null ? null : line(CLOSEST_MATCH_UNAVAILABLE_COPY),
      headToHeadSection,
    );
  }
  const basis = h('p', { className: 'mtg-hint' }, pairingBasisCopy(table));
  const yours = line(yourDeckCopy(table, mine, ranking.mine));
  if (opponent === null) return frame(yours, basis, headToHeadSection);
  const mirror: RankedOpponent<PairingDeck> = {
    measured: true,
    deck: opponent,
    rate: ranking.mine,
    gapPoints: 0,
  };
  const seated = ranking.opponents.find((entry) => entry.deck.id === opponent.id) ?? mirror;
  const closest = ranking.opponents.find((entry) => entry.measured);
  const closestControl =
    closest === undefined
      ? line(NO_MEASURED_OPPONENT_COPY)
      : closest.deck.id === opponent.id
        ? line(closestMatchSeatedCopy(closest.deck, mine))
        : h(
            'button',
            {
              type: 'button',
              className: 'mtg-btn',
              onClick: () => {
                onChooseOpponent(closest.deck.id);
              },
            },
            closestMatchLabel(closest.deck),
          );
  return frame(
    yours,
    line(acrossTheTableCopy(table, seated)),
    closestControl,
    h('h3', { className: 'mtg-pairing__label' }, RANKED_OPPONENTS_LABEL),
    h(
      'div',
      { className: 'mtg-pairing__opponents', role: 'group', 'aria-label': RANKED_OPPONENTS_LABEL },
      ranking.opponents.map((entry) =>
        h(
          'button',
          {
            key: entry.deck.id,
            type: 'button',
            className: 'mtg-chip',
            'data-selected': entry.deck.id === opponent.id,
            'aria-pressed': entry.deck.id === opponent.id,
            onClick: () => {
              onChooseOpponent(entry.deck.id);
            },
          },
          opponentGapCopy(table, entry),
        ),
      ),
    ),
    basis,
    headToHeadSection,
  );
}
