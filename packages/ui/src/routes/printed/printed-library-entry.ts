import { createElement as h } from 'react';
import type { ReactElement } from 'react';
import { modeParams, routeAt, routeHash } from '../../app/router';
import type { UiRoute } from '../../app/router';
import type { PrintedLibraryEntry } from './printed-library';

/** How one surface words a saved session: the verb, the noun, and the facts under it. */
export interface PrintedLibraryEntryPresentation {
  readonly action: string;
  readonly noun: string;
  readonly facts: readonly string[];
}

/** Customize's Decks section's wording: every entry opens, and the facts are the counts the save carries. */
export function printedLibraryFacts(entry: PrintedLibraryEntry): readonly string[] {
  return [
    ...(entry.cards === null ? [] : [`${String(entry.cards)} cards in deck`]),
    ...(entry.picks === null ? [] : [`${String(entry.picks)} recorded picks`]),
  ];
}

/**
 * One saved session as a list item: a link back into the same editor when the
 * save is sound, its name without a link when it is not, and the issue under it.
 */
export function printedLibraryEntryView(
  entry: PrintedLibraryEntry,
  route: UiRoute,
  presentation: PrintedLibraryEntryPresentation,
): ReactElement {
  const capitalized = presentation.noun.charAt(0).toUpperCase() + presentation.noun.slice(1);
  return h(
    'li',
    { key: entry.key },
    h(
      'p',
      null,
      entry.issue === null
        ? h(
            'a',
            {
              href: routeHash(
                routeAt('play', entry.mode === 'draft' ? 'draft' : 'sealed', {
                  ...modeParams(route),
                  seed: entry.seed,
                }),
              ),
            },
            `${presentation.action} ${presentation.noun} ${entry.seed}`,
          )
        : `${capitalized} ${entry.seed}`,
    ),
    ...presentation.facts.map((fact) => h('p', { key: fact, className: 'mtg-fact__value' }, fact)),
    entry.issue === null ? null : h('p', { role: 'status' }, entry.issue),
  );
}
