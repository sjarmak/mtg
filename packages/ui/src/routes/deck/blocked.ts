/**
 * Why a dark control is dark, said on the screen that darkened it.
 *
 * `mtg-dcxg.7`, 2026-08-23. At 390x844 the builder opened on a row of disabled
 * buttons — *Clear the deck*, *Play this deck* — and nothing anywhere said what
 * would light them. The information
 * existed: the deck was empty and thirty-six cards short, and the shortfall was
 * even written out further down the page. What was missing was the join between
 * the sentence and the button, and a reader on a phone cannot make that join by
 * looking, because the note is a screen away from the control.
 *
 * So every refusal is derived here, beside the rule it comes from, and the
 * builder spends it twice: as the control's own `title`, and as a line under the
 * row naming which controls a reason is holding down. Grouped by reason rather
 * than one line per button, so two controls waiting on one legality do not
 * read like two different problems.
 *
 * The wording is `./shortfall-note.ts`'s: a shortfall is stated in the words the
 * person building the deck uses, never in `@mtg/deckbuild`'s CLI phrasing.
 */
import type { ManualDeck } from '@mtg/deckbuild';
import { shortfallNote } from './shortfall-note';

/**
 * Everything the format has against this deck, in the order a build hits them:
 * too many cards, then a fifth copy, then the slots still to fill.
 *
 * The list is the one source for both the note under the toolbar and the
 * sentence on a dark play button, so the two cannot word the same rule
 * differently. `@mtg/deckbuild`'s own `formatCopyExcess` is deliberately not
 * drawn here — `Sky Sentinel: 5 copies, 4 allowed` is the CLI's phrasing, and
 * `./shortfall-note.ts` settled that a builder gets its own voice.
 */
export function legalityNotes(deck: ManualDeck): readonly string[] {
  const oversize = deck.deck.length - deck.config.deckSize;
  return [
    ...(oversize > 0
      ? [
          `${String(oversize)} card${oversize === 1 ? '' : 's'} too many for a ${String(deck.config.deckSize)}-card deck.`,
        ]
      : []),
    ...deck.excesses.map(
      (excess) =>
        `${excess.name} is played ${String(excess.played)} times, and ${String(excess.limit)} copies is the limit.`,
    ),
    ...deck.shortfalls.map(shortfallNote),
  ];
}

/**
 * The one thing standing between this deck and a game, or null when it is legal.
 *
 * One reason rather than all of them: the deck-wide notes under the toolbar
 * carry the rest, and what a button owes its reader is what to do next.
 */
export function playBlocked(deck: ManualDeck): string | null {
  if (deck.complete) return null;
  return legalityNotes(deck)[0] ?? `A legal deck is ${String(deck.config.deckSize)} cards.`;
}

/** Why *Clear the deck* is dark, or null when there is something to clear. */
export function clearBlocked(pickedCards: number): string | null {
  return pickedCards === 0 ? 'the deck is empty, so there is nothing to clear.' : null;
}

export interface BlockedControl {
  /** The control's own label, as it is drawn. */
  readonly label: string;
  readonly reason: string;
}

/** `A and B are waiting on: …`, one line per distinct reason, in the order given. */
export function blockedNotes(blocked: readonly BlockedControl[]): readonly string[] {
  const byReason = new Map<string, string[]>();
  for (const control of blocked) {
    const named = byReason.get(control.reason);
    if (named === undefined) byReason.set(control.reason, [control.label]);
    else named.push(control.label);
  }
  return [...byReason.entries()].map(([reason, labels]) => {
    const last = labels[labels.length - 1] ?? '';
    const named = labels.length === 1 ? last : `${labels.slice(0, -1).join(', ')} and ${last}`;
    const verb = labels.length === 1 ? 'is' : 'are';
    return `${named} ${verb} waiting: ${reason}`;
  });
}
