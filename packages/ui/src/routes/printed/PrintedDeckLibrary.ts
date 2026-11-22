import { createElement as h, useState } from 'react';
import type { ReactElement } from 'react';
import { modeParams, routeAt, routeHash } from '../../app/router';
import type { UiRoute } from '../../app/router';
import type { PrintedFormatRow } from '../../lab/printed-format';
import { readPrintedLibrary } from './printed-library';
import { printedLibraryEntryView, printedLibraryFacts } from './printed-library-entry';
import { printedPlayAvailabilityCopy } from './play-availability-copy';

interface Props {
  readonly formatId: string;
  readonly fingerprint: string;
  readonly title: string;
  readonly route: UiRoute;
  readonly playAvailability: PrintedFormatRow['availability']['play'];
}

/** A directory over the builders' own autosaves, not a second saved-deck representation. */
export function PrintedDeckLibrary(props: Props): ReactElement {
  const read = () => readPrintedLibrary(props.formatId, props.fingerprint);
  const [library, setLibrary] = useState(read);
  const params = modeParams(props.route);
  return h(
    'section',
    { style: { overflowWrap: 'anywhere' } },
    h('h1', { className: 'mtg-page-title' }, `${props.title} saved decks and drafts`),
    h('p', null, 'Autosaved in this browser only. Clearing site data removes these sessions.'),
    h(
      'p',
      null,
      `Opening rechecks the saved picks and physical copies. ${printedPlayAvailabilityCopy(props.playAvailability)}`,
    ),
    h(
      'p',
      null,
      h('a', { href: routeHash(routeAt('play', 'draft', params)) }, 'Start a draft'),
      ' · ',
      h('a', { href: routeHash(routeAt('play', 'sealed', params)) }, 'Open a new sealed pool'),
    ),
    h(
      'button',
      { type: 'button', className: 'mtg-btn', onClick: () => setLibrary(read()) },
      'Refresh saved sessions',
    ),
    library.error !== null
      ? h('p', { role: 'alert' }, library.error)
      : library.entries.length === 0
        ? h('p', null, 'No saved sessions for this format.')
        : h(
            'ul',
            null,
            library.entries.map((entry) =>
              printedLibraryEntryView(entry, props.route, {
                action: 'Open',
                noun: entry.mode === 'draft' ? 'draft' : 'sealed pool',
                facts: printedLibraryFacts(entry),
              }),
            ),
          ),
  );
}
