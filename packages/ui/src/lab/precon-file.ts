/**
 * Reading a staged precon document, and keeping absent apart from broken.
 *
 * The schema itself belongs to `@mtg/deckbuild` — a written deck list is not a
 * UI concept, and `buildPrecon` is what turns one into a legal deck — so this
 * file is only the fetch boundary: the three answers a launcher's staging can
 * produce, told apart. Nobody has staged one is the ordinary state of a
 * checkout whose set has no decks written for it, and it is not an error; a
 * document that fails `parsePreconFile` is, and the message names the field.
 *
 * The same split `readDeckArtifact` makes next door, and the reason repeats:
 * "run the command" and "your file is stale, here is the field" want different
 * words on the screen.
 */
import { parsePreconFile, PreconError } from '@mtg/deckbuild';
import type { PreconFile } from '@mtg/deckbuild';

export type PreconFileResult =
  { readonly ok: true; readonly file: PreconFile } | { readonly ok: false; readonly message: string };

/**
 * A parsed body to a precon file, or the reason it is not one.
 *
 * `where` is the URL, because a message that says a field is wrong without
 * saying which document it is in sends somebody to the wrong file.
 */
export function readPreconFile(body: unknown, where: string): PreconFileResult {
  try {
    return { ok: true, file: parsePreconFile(body) };
  } catch (cause: unknown) {
    if (cause instanceof PreconError) return { ok: false, message: `${where}: ${cause.message}` };
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, message: `${where} could not be read: ${detail}` };
  }
}
