/** Selecting the two written decks a network table will seat. */
import { preconDeck, PreconError } from '@mtg/deckbuild';
import type { PreconDeck, PreconFile } from '@mtg/deckbuild';

export function selectPreconPair(
  file: PreconFile,
  requested: string | undefined,
): readonly [PreconDeck, PreconDeck] {
  if (requested === undefined) {
    const first = file.decks[0];
    const second = file.decks[1];
    if (first === undefined || second === undefined) {
      throw new PreconError('netplay needs at least two preconstructed decks');
    }
    return [first, second];
  }

  const ids = requested
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (ids.length !== 2) throw new PreconError('--decks takes two deck ids separated by a comma');
  const first = ids[0];
  const second = ids[1];
  if (first === undefined || second === undefined) throw new PreconError('--decks takes two deck ids');
  return [preconDeck(file, first), preconDeck(file, second)];
}
