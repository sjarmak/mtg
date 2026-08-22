/**
 * The parts of the seat picker that decide something, kept apart from the parts
 * that read a terminal or start a server.
 *
 * A launcher that asks questions is mostly prompt strings and a subprocess, and
 * none of that is testable. What is testable is the two judgments underneath:
 * how a typed answer becomes a deck, and what a seed field means when it is left
 * blank. Both are here, and `table.ts` is the shell around them.
 */
import type { PreconDeck } from '@mtg/deckbuild';

/** One numbered line of the deck menu, ready to print. */
export function deckMenu(decks: readonly PreconDeck[]): readonly string[] {
  const width = String(decks.length).length;
  return decks.map((deck, index) => {
    const number = String(index + 1).padStart(width, ' ');
    return `  ${number}. ${deck.name}\n     ${deck.plan}`;
  });
}

/**
 * Reads a typed answer as a deck.
 *
 * A number picks by position, because that is what the menu just printed and it
 * is what a person types. An id is also accepted, since the same ids appear in
 * `--decks` and in every note about this set, and refusing them would make the
 * two ways of starting a game disagree about what a deck is called. An empty
 * answer takes the fallback, which is how a seat gets a sensible default without
 * the person having to know one.
 */
export function chooseDeck(decks: readonly PreconDeck[], answer: string, fallback: PreconDeck): PreconDeck {
  const typed = answer.trim();
  if (typed.length === 0) return fallback;
  if (/^\d+$/.test(typed)) {
    const picked = decks[Number(typed) - 1];
    if (picked === undefined) {
      throw new Error(`there is no deck ${typed}; the menu goes up to ${String(decks.length)}`);
    }
    return picked;
  }
  const byId = decks.find((deck) => deck.id === typed);
  if (byId === undefined) {
    throw new Error(`no deck here is called ${typed}; type its number instead`);
  }
  return byId;
}

/**
 * Reads the seed field.
 *
 * A word typed here is the whole point of the field: the same word deals the
 * same game every time, which is what lets two people replay a hand they want to
 * argue about, or start over after a misclick without losing the draw they
 * liked. Blank means a fresh game, and it returns `undefined` rather than
 * inventing one here, so the one place that decides what a fresh seed looks like
 * stays `netplay` itself.
 */
export function chooseSeed(answer: string): string | undefined {
  const typed = answer.trim();
  return typed.length === 0 ? undefined : typed;
}

/** Reads a seat's name, falling back to the label the menu offered. */
export function chooseName(answer: string, fallback: string): string {
  const typed = answer.trim();
  return typed.length === 0 ? fallback : typed;
}

/** The flags this picker hands to `netplay`, in the order a person would read them. */
export function netplayFlags(choice: {
  readonly setPath: string | undefined;
  readonly decks: readonly [PreconDeck, PreconDeck];
  readonly names: readonly [string, string];
  readonly seed: string | undefined;
}): readonly string[] {
  const flags: string[] = [];
  if (choice.setPath !== undefined) flags.push(choice.setPath);
  flags.push('--decks', `${choice.decks[0].id},${choice.decks[1].id}`);
  flags.push('--names', `${choice.names[0]},${choice.names[1]}`);
  if (choice.seed !== undefined) flags.push('--seed', choice.seed);
  return flags;
}
