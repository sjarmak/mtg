/**
 * Deck view: a built deck, its real card art, and the mana base it was built to.
 *
 * The deck arrives as a staged JSON document rather than through a query,
 * because the store is 656 MB of SQLite behind `better-sqlite3` and a browser
 * has no business opening it. `npm run lab` does the reading; this reads a
 * static file. It is the same arrangement `npm run play` uses for a set, for
 * the same reason, and it is why this page needs no API key and no server.
 *
 * Absent and broken are different states and are shown differently. A checkout
 * that has never run `npm run lab` gets an instruction; a document that failed
 * the schema gets the field that failed. Neither is a blank page.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { assertNever } from '@mtg/dsl';
import { renderCopy } from '../copy';
import { DeckLibrary } from './deck/DeckLibrary';
import type { DeckRouteProps } from './deck/route-state';

/**
 * The route's own vocabulary, still reachable from where it was written.
 *
 * `mtg-c52t` moved three screens out of this file and the words went with the
 * screen that says them. Twenty-two files import these names from here, half of
 * them rigs that read them as "what the Decks tab calls this", so the module
 * path they were written against is kept rather than rewritten across the tree.
 * The definitions are one hop away and each is argued in its own file.
 */
export {
  BUILD_LABEL,
  DECKS_EMPTY_NOTE,
  DECKS_UNPLACED_LABEL,
  IMPORT_LABEL,
  NEW_DECK_TITLE,
  builderTitle,
  deckLibraryCounts,
  openDeckLabel,
} from './deck/DeckLibrary';
export { DECKS_BACK_LABEL } from './deck/deck-screen';
export { DECK_DETAILS_LABEL, listPhrase } from './deck/OpenDeckScreen';
export {
  MAIN_DECK_EMPTY_TEXT,
  MAIN_DECK_LABEL,
  SIDEBOARD_EMPTY_TEXT,
  SIDEBOARD_LABEL,
} from './deck/pane-names';
export type { DeckRouteProps, DeckState } from './deck/route-state';

function empty(title: string, body: string): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-empty' },
    createElement('span', { className: 'mtg-empty__title' }, title),
    createElement('span', { className: 'mtg-empty__body' }, renderCopy(body)),
  );
}

export function DeckRoute(props: DeckRouteProps): ReactElement {
  const { state } = props;

  const hasPrecons = props.precons?.status === 'ready' && props.precons.file.decks.length > 0;
  // Staged cards are enough on their own. A checkout with a set and neither a
  // built artifact nor a precon file used to land on "no deck staged", which was
  // true of the library and false of the tab: every one of those cards is
  // playable and the builder is right there.
  const hasCards = props.cards !== undefined && props.cards.length > 0;
  if (state.status === 'ready' || hasPrecons || hasCards) return createElement(DeckLibrary, props);

  const head = createElement(
    'div',
    { className: 'mtg-page-head' },
    createElement('h1', { className: 'mtg-page-title' }, 'Decks'),
  );

  switch (state.status) {
    case 'loading':
      return createElement('div', null, head, empty('Reading deck.json…', 'Staged by `npm run lab`.'));
    case 'absent':
      return createElement(
        'div',
        null,
        head,
        empty(
          'No deck staged',
          'Build one with `npx tsx packages/decklab/src/cli.ts --prompt "…" --format modern ' +
            '--artifact out/decklab/deck.json`, then `npm run lab` opens it. To look at the ' +
            'committed example instead, name it: `npm run lab -- ' +
            'packages/decklab/fixtures/decks/boros-aggro.deck.json`. That one needs neither the ' +
            'card store nor an API key.',
        ),
      );
    case 'failed':
      return createElement('div', null, head, empty('That deck could not be read', state.message));
    default:
      return assertNever(state, 'DeckRoute');
  }
}
