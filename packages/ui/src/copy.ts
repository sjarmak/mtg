/**
 * Prose that names a command, rendered as a command.
 *
 * Empty states in this app almost always end in something to type: `npm run
 * lab`, `npm run slice`, a path under `out/`. Those were written with markdown
 * backticks and handed straight to a text node, so the lab printed the
 * backticks: a person read "Run `npm run lab` to stage one" and had to work out
 * that two of those characters were not part of the command.
 *
 * Copy stays authored as one string with backticks, which is what makes it
 * readable at the call site and greppable across the package. This is the one
 * place that turns those spans into `<code>`, so every view marks a command the
 * same way and the mono treatment is defined once in `styles/base.ts`.
 *
 * Unpaired backticks are left alone rather than swallowed. A string that lost
 * its closing tick should look wrong on screen, not silently eat the rest of
 * the sentence.
 */
import { createElement } from 'react';
import type { ReactNode } from 'react';

/** Splits on paired backticks; odd-numbered spans are the code ones. */
export function renderCopy(text: string): ReactNode {
  const spans = text.split('`');
  // An even count of ticks leaves an odd number of spans. Anything else is
  // unpaired, so the string is passed through exactly as written.
  if (spans.length === 1 || spans.length % 2 === 0) return text;
  return spans.map((span, index) =>
    index % 2 === 0 ? span : createElement('code', { key: `c${String(index)}`, className: 'mtg-code' }, span),
  );
}

/**
 * `1 card`, `3 cards`: a count and the noun it counts, agreeing.
 *
 * Here rather than in each route because four files had written the same three
 * lines (`deck-counts.ts`, `shortfall-note.ts`, `routes/play/SealedBuilder.ts`,
 * and this module's own caller), which is one past the rule of three. English
 * plurals that are not an `s` are not handled and are not wanted: every noun
 * this app counts is a card, a deck, a sheet, a configuration or a pack.
 */
export function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}
