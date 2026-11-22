/**
 * A refusal, said to the person who has to act on it.
 *
 * `mtg-dcxg.3`. The server's judge is Zod, and Zod writes for a developer
 * reading a stack trace: an empty theme comes back as "Too small: expected
 * string to have >=1 characters", which appeared four times at once on a form
 * nobody had typed into yet. A designer cannot act on that sentence — it names
 * no field, no unit and no consequence — so the pointer the issue already
 * carries is mapped here to a sentence that does.
 *
 * Two rules keep this from becoming a second opinion about what a legal brief
 * is. The first: nothing here decides *whether* a field is refused. The server
 * did that, this module only chooses the words. The second: a sentence the
 * server wrote for a human — "mechanic names must be unique", "the brief
 * requires 300 named cards, which a 250-card set has no room for" — is passed
 * through untouched. Only the machine phrasings are replaced, and
 * `looksMechanical` is the whole of that test.
 *
 * Blank and wrong are different refusals about the same field and they want
 * different sentences, so the field's current value is handed in: a blank set
 * code needs "every set needs a code", a mistyped one needs to be told it is
 * not a code. That is also why the set-code rule itself is stated in exactly one
 * place — the hint under the field. Restating it in the refusal put the same
 * sentence on screen twice, once sentence-cased and once in the schema's
 * lowercase.
 */
import type { BriefIssue } from './client';

/**
 * The pointer with its list positions collapsed.
 *
 * `mechanics.0.name` and `mechanics.4.name` are the same field asked about twice
 * and want the same sentence, so the index is not part of the key.
 */
function shapeOf(pointer: string): string {
  return pointer
    .split('.')
    .map((segment) => (/^\d+$/.test(segment) ? '#' : segment))
    .join('.');
}

/** What each field says when it is refused for being empty. */
const WHEN_BLANK: Readonly<Record<string, string>> = {
  setCode: 'Every set needs a code: it is printed on every card in it.',
  setName: 'Every set needs a name.',
  theme: 'The theme is the paragraph the model is handed, so a brief cannot go without one.',
  seed: 'A seed is what makes a run repeatable, so it cannot be left blank.',
  'mechanics.#.name': 'Name the mechanic. The reports and the coverage checks all refer to it by this name.',
  'mechanics.#.description': 'Say what the mechanic does; this is handed to the model as written.',
  'requiredCards.#.name': 'Name the card, or take this row out.',
  'spellRoles.#.why': 'Say why this tier wants these roles, or take the tier out.',
};

/**
 * What each field says when something is there and it is still refused.
 *
 * Only the fields whose rule is already stated under the box need an entry: the
 * sentence points at that rule rather than repeating it.
 */
const WHEN_STATED: Readonly<Record<string, string>> = {
  setCode: 'That is not a set code.',
  targetSize: 'That is outside the range this field names, so nothing could build it.',
  tertiaryBudget: 'The tertiary budget is a whole number of cards, zero or more.',
  'requiredCards.#.manaValue': 'A mana value is a whole number, zero or more.',
};

/**
 * True of a message written for whoever wrote the schema rather than for whoever
 * is filling in the form. Zod's own prefixes, and nothing else: a message this
 * misses is shown as it came, which is the safe direction to fail in.
 */
function looksMechanical(message: string): boolean {
  return /^(Too small|Too big|Invalid input|Invalid option|Invalid value|Expected|Unrecognized)/.test(
    message,
  );
}

/** The last resort: still a sentence, and still about this field. */
function generic(message: string): string {
  if (message.startsWith('Too big')) return 'That is longer than this field takes.';
  if (message.startsWith('Too small')) return 'That is shorter than this field takes.';
  return 'This is not one of the values this field accepts.';
}

/**
 * One refusal as a sentence, given what the field currently holds.
 *
 * `value` is the text in the box — `''` for a list with nothing chosen — and is
 * only ever read to tell "has not said yet" from "said something wrong".
 */
export function sayIssue(issue: BriefIssue, value: string): string {
  const shape = shapeOf(issue.pointer);
  if (value.trim() === '') {
    const blank = WHEN_BLANK[shape];
    if (blank !== undefined) return blank;
  } else {
    const stated = WHEN_STATED[shape];
    if (stated !== undefined) return stated;
  }
  return looksMechanical(issue.message) ? generic(issue.message) : issue.message;
}
