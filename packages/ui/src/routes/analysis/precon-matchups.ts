/** A readable N×N table over authored preconstructed decks. */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderCopy } from '../../copy';
import { integer, percent } from './evidence';
import type { PreconMatchupBlock, PreconMatchupCell, PreconMatchupDeck } from './model';

export interface PreconMatchupPanelProps {
  readonly matchups: PreconMatchupBlock;
}

function cellFor(
  block: PreconMatchupBlock,
  deck: PreconMatchupDeck,
  opponent: PreconMatchupDeck,
): PreconMatchupCell | null {
  return block.cells.find((cell) => cell.deckId === deck.id && cell.opponentId === opponent.id) ?? null;
}

function record(cell: PreconMatchupCell): string {
  return `${integer(cell.wins)}W-${integer(cell.losses)}L-${integer(cell.draws)}D`;
}

function matchupCell(cell: PreconMatchupCell): ReactElement {
  const evidence =
    cell.winRate === null || cell.interval === null
      ? createElement(
          'span',
          { className: 'mtg-withheld' },
          `not enough evidence · 95% CI half-width ${percent(cell.intervalHalfWidth)}`,
        )
      : createElement(
          'span',
          { className: 'mtg-matchup__rate' },
          percent(cell.winRate),
          createElement(
            'span',
            { className: 'mtg-matchup__interval' },
            `95% CI ${percent(cell.interval.low)}-${percent(cell.interval.high)}`,
          ),
        );
  return createElement(
    'td',
    { className: 'mtg-matchup', 'data-tone': cell.status === 'outside' ? 'negative' : cell.status },
    evidence,
    createElement('span', { className: 'mtg-matchup__record' }, record(cell)),
  );
}

export function PreconMatchupPanel(props: PreconMatchupPanelProps): ReactElement {
  const block = props.matchups;
  return createElement(
    'section',
    { className: 'mtg-panel', 'aria-label': 'Preconstructed deck matchups' },
    createElement(
      'div',
      { className: 'mtg-panel__head' },
      createElement('span', { className: 'mtg-panel__title' }, 'Preconstructed deck matchups'),
      createElement(
        'span',
        { className: 'mtg-panel__note' },
        `${integer(block.games)} games · ${integer(block.seatOrders)} seat orders · rates held until 95% CI half-width ≤ ${percent(block.maxIntervalHalfWidth)}`,
      ),
    ),
    createElement(
      'div',
      { className: 'mtg-panel__body' },
      createElement(
        'p',
        { className: 'mtg-chart__note' },
        renderCopy(
          `Each row is that deck's win rate against the column deck. The healthy pairing band is ${percent(block.band.min)}-${percent(block.band.max)}; draws remain in the record and rates use decided games.`,
        ),
      ),
      createElement(
        'p',
        { className: 'mtg-chart__note' },
        renderCopy(
          block.planExecution.status === 'measured'
            ? `Plan execution is measured over ${integer(block.planExecution.samples)} samples. ${block.planExecution.evidence}`
            : `Plan execution is unavailable: ${block.planExecution.reason} The plan text below is authored intent, not measured execution.`,
        ),
      ),
      createElement(
        'div',
        { className: 'mtg-scroll' },
        createElement(
          'table',
          { className: 'mtg-table mtg-matchup-table' },
          createElement(
            'thead',
            null,
            createElement(
              'tr',
              null,
              createElement('th', { scope: 'col' }, 'Deck'),
              ...block.decks.map((deck) => createElement('th', { key: deck.id, scope: 'col' }, deck.name)),
            ),
          ),
          createElement(
            'tbody',
            null,
            ...block.decks.map((deck) =>
              createElement(
                'tr',
                { key: deck.id },
                createElement(
                  'th',
                  { scope: 'row', title: `List ${deck.contentHash}` },
                  deck.name,
                  createElement('span', { className: 'mtg-matchup__plan' }, deck.plan),
                ),
                ...block.decks.map((opponent) => {
                  if (deck.id === opponent.id) {
                    return createElement(
                      'td',
                      { key: opponent.id, className: 'mtg-matchup mtg-matchup--diagonal' },
                      createElement('span', { title: 'not measured against itself' }, '—'),
                    );
                  }
                  const cell = cellFor(block, deck, opponent);
                  return cell === null
                    ? createElement('td', { key: opponent.id, className: 'mtg-matchup' }, 'missing')
                    : createElement(matchupCell, { ...cell, key: opponent.id });
                }),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
