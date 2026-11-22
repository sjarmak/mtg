import { createElement as h, useState } from 'react';
import type { ReactElement } from 'react';
import type { PreparedPrintedLimitedFormat } from '@mtg/draft-export';
import type { UiRoute } from '../../app/router';
import { PRINTED_LOCAL_SEAT } from './printed-limited-session';
import { readPrintedLibrary } from './printed-library';
import type { PrintedLibraryEntry } from './printed-library';
import { printedLibraryEntryView } from './printed-library-entry';
import type { PrintedLibraryEntryPresentation } from './printed-library-entry';

interface Props {
  readonly prepared: PreparedPrintedLimitedFormat;
  readonly mode: PrintedLibraryEntry['mode'];
  readonly route: UiRoute;
}

/** How many picks the local seat makes in a whole draft of this format at this seed. */
function picksInDraft(prepared: PreparedPrintedLimitedFormat, seed: string): number {
  return prepared
    .openDraftPacks(seed)
    .filter((pack) => pack.openedBy === PRINTED_LOCAL_SEAT)
    .reduce((total, pack) => total + pack.cards.length, 0);
}

/**
 * A draft still being picked is continued; a finished one is opened as the deck
 * it drafted. A sealed pool is only ever opened, with its deck when one is saved.
 */
function presentation(
  entry: PrintedLibraryEntry,
  prepared: PreparedPrintedLimitedFormat,
): PrintedLibraryEntryPresentation {
  const deck = entry.cards === null ? [] : [`${String(entry.cards)} cards in deck`];
  if (entry.mode === 'sealed') return { action: 'Open', noun: 'sealed pool', facts: deck };
  const picks = entry.picks ?? 0;
  const total = picksInDraft(prepared, entry.seed);
  return picks < total
    ? { action: 'Continue', noun: 'draft', facts: [`${String(picks)} of ${String(total)} picks made`] }
    : { action: 'Open', noun: 'drafted deck', facts: [`${String(picks)} picks made`, ...deck] };
}

/**
 * The saved sessions of one kind, on the page that starts a new one.
 *
 * The Decks tab already lists every autosave, but somebody who left a draft
 * half-picked comes back through the Draft section, and a page that only
 * offered "New draft" read as if the old one was gone. Nothing is rendered when there
 * is nothing saved, so a first visit looks exactly as it did.
 */
export function PrintedSavedSessions(props: Props): ReactElement | null {
  const [library] = useState(() => readPrintedLibrary(props.prepared.format.id, props.prepared.fingerprint));
  if (library.error !== null) return h('p', { role: 'alert' }, library.error);
  const entries = library.entries.filter((entry) => entry.mode === props.mode);
  if (entries.length === 0) return null;
  return h(
    'section',
    { 'aria-label': props.mode === 'draft' ? 'Saved drafts' : 'Saved sealed pools' },
    h(
      'h2',
      null,
      props.mode === 'draft' ? 'Saved drafts in this browser' : 'Saved sealed pools in this browser',
    ),
    h(
      'ul',
      null,
      entries.map((entry) =>
        printedLibraryEntryView(entry, props.route, presentation(entry, props.prepared)),
      ),
    ),
  );
}
