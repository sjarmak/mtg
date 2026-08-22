/**
 * The three-state open/shut preference the played table's two side columns share.
 *
 * `./rail-collapse.ts` wrote this out first and its docblock argues every part
 * of it: why a panel's open state is view state rather than game state, why the
 * store is reached through a structural interface and runtime-checked, and why
 * *nothing stored* is a third state — unanswered — rather than a synonym for
 * open. What is here is that mechanism with the column's identity taken out of
 * it, because `./ask-collapse.ts` now needs the same three states for the same
 * reason and a second copy of sixty lines is not the rule-of-three case
 * `../deck/local-store.ts` declines to extract.
 *
 * That note is worth reading beside this one, because it declined a smaller
 * extraction and said why: two copies of a fifteen-line `localStorage` accessor
 * are under the rule, and hoisting one out of the play surface to import from
 * the deck tab would put a deck change inside this surface's blast radius. Both
 * halves of that fail here. This is sixty lines rather than fifteen — the store,
 * the media watch and the hook that resolves the three states against each other
 * — and both callers are in *this* directory, so nothing crosses a surface.
 *
 * The accessor underneath it is the deck tab's, though. `mtg-4mjy` says to fold
 * the play surface's copy in once this lane lands, so `readStored`/`writeStored`
 * come from `../deck/local-store.ts` and the third copy is gone. What crosses
 * the directory line is two functions that read and write a string under a key
 * and know nothing about a deck; what stays here is every decision about *this*
 * preference — that a missing key is a third state, that a press wins, and that
 * a store which cannot keep the answer is a first visit rather than an error.
 *
 * What stays with each column is what is actually different about it: its
 * storage key, its accessible name, its chevron, and whether it binds a key.
 */
import { useCallback, useEffect, useState } from 'react';
import { readStored, writeStored } from '../deck/local-store';

/**
 * The two stored values, and the third state that is the absence of both.
 *
 * A player who has never pressed the disclosure gets the answer the viewport
 * implies — shut on a table with no room to afford the column, open on one that
 * has — and a player who has pressed it gets what they pressed, whatever the
 * viewport says. Before `mtg-l4w0`, absence meant open, so a landscape phone
 * that had never been told anything spent 272px of an 844px mat on the log.
 */
const SHUT = 'shut';
const OPEN = 'open';

interface MediaQueryLike {
  readonly matches: boolean;
  readonly addEventListener?: (type: 'change', listener: () => void) => void;
  readonly removeEventListener?: (type: 'change', listener: () => void) => void;
}

interface MediaHost {
  readonly matchMedia?: (query: string) => MediaQueryLike;
}

/**
 * The stored answer, or `null` where the player has not given one.
 *
 * `null` for a missing store and for a store that throws as well as for an empty
 * key: none of the three is a player who chose, and the whole point of the third
 * state is that only a press counts as choosing.
 */
export function readPreference(key: string): boolean | null {
  const found = readStored(key);
  if (found === SHUT) return true;
  if (found === OPEN) return false;
  return null;
}

/**
 * Records a press, and says nothing when it cannot be recorded.
 *
 * `writeStored` reports the failure and this caller drops it, which is the
 * decision `../deck/local-store.ts` leaves to each caller: a page in a private
 * window still opens and shuts its columns, it just forgets across a reload,
 * and that is the behavior of a first visit rather than something worth a word
 * on screen. A deck that cannot be saved is the opposite, and that is why the
 * report exists.
 */
function writePreference(key: string, shut: boolean): void {
  writeStored(key, shut ? SHUT : OPEN);
}

/**
 * Whether the table is in the condition that shuts this column, watched rather
 * than sampled.
 *
 * Watched because a window is resized and a phone is rotated, and an unanswered
 * default that froze at mount would be the wrong answer for the rest of the
 * game. `false` where there is no host to ask, which is the roomy answer: a
 * server render and a test environment without `matchMedia` both draw the layout
 * this surface has always drawn, and a viewport that never announces itself must
 * not silently lose a column.
 *
 * The query is the caller's, because the two columns are not shut by the same
 * thing. `../../styles/board/geometry.ts` has both and the two hooks name which.
 */
export function crampedTable(query: string, host: MediaHost = globalThis as MediaHost): boolean {
  return host.matchMedia?.(query).matches ?? false;
}

export function watchCrampedTable(
  media: string,
  onChange: (cramped: boolean) => void,
  host: MediaHost = globalThis as MediaHost,
): () => void {
  const query = host.matchMedia?.(media);
  if (query?.addEventListener === undefined) return (): void => undefined;
  const listener = (): void => {
    onChange(query.matches);
  };
  query.addEventListener('change', listener);
  return (): void => {
    query.removeEventListener?.('change', listener);
  };
}

export interface CollapsePreference {
  /** What the board should draw. The player's answer, and nothing overrides it. */
  readonly collapsed: boolean;
  readonly toggle: () => void;
}

/**
 * The preference and the viewport it falls back to, resolved against each other.
 *
 * The player's answer wins outright wherever there is one; the viewport is only
 * consulted when the player has said nothing, which is why neither disclosure
 * has a disabled state and neither lies about what a press does. The first press
 * writes, so the fallback stops applying from then on — the behavior a person
 * expects of a panel they shut on a phone and then opened again.
 */
export function useCollapsePreference(key: string, media: string): CollapsePreference {
  const [chosen, setChosen] = useState<boolean | null>(() => readPreference(key));
  const [cramped, setCramped] = useState<boolean>(() => crampedTable(media));
  useEffect((): (() => void) => watchCrampedTable(media, setCramped), [media]);
  const collapsed = chosen ?? cramped;
  const toggle = useCallback((): void => {
    setChosen((was) => {
      const next = !(was ?? crampedTable(media));
      writePreference(key, next);
      return next;
    });
  }, [key, media]);
  return { collapsed, toggle };
}
