/**
 * Reading a set file from a tool: one answer to "where are the cards".
 *
 * `mtg-6jk9`. A set on disk has two spellings — a bare JSON array, and setgen's
 * `{ formatVersion, set, cards }` — and `@mtg/dsl`'s `parseCardsDocumentJson`
 * has owned the choice between them since `0e253ad`. Seventeen tools under this
 * directory had each transcribed the same nine lines instead, and they were not
 * identical: some named the file in the failure and some did not, some said
 * "not a set document" and some said only that a field was missing, and none of
 * them accepted the bare array the DSL's own writer produces. Divergence at that
 * scale is what produced `mtg-y58w`, where two export commands exited 1 on the
 * 249-card flagship every other tool opened without comment.
 *
 * What this file adds over calling the DSL directly is the path. A tool is run
 * from a shell against a file the caller named, and "expected a JSON array of
 * cards" with no filename in front of it is the message that costs the hour —
 * the DSL cannot know the path because it is handed text, so the caller that
 * does know it puts it back.
 *
 * Readers that need more than the card list are deliberately not here. The
 * launcher wants a result rather than a throw and refuses an empty set, and the
 * benchmark and the drift report want the set's own code and name; those need a
 * document reader that returns the identity too, which is `mtg-dwnb`.
 */
import { readFileSync } from 'node:fs';
import type { Card } from '@mtg/dsl';
import { parseCardsDocumentJson } from '@mtg/dsl';

function withPath(path: string, cause: unknown): Error {
  return new Error(`${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
}

/** The cards a set document holds, in either spelling, named by `path` on failure. */
export function cardsInDocument(text: string, path: string): readonly Card[] {
  try {
    return parseCardsDocumentJson(text);
  } catch (cause: unknown) {
    throw withPath(path, cause);
  }
}

/** `cardsInDocument` against a file, so an unreadable path fails by name too. */
export function readSetCards(path: string): readonly Card[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (cause: unknown) {
    throw withPath(path, cause);
  }
  return cardsInDocument(text, path);
}
