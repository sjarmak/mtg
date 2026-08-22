/**
 * The browser's own store, reached safely, for the two deck-tab preferences that
 * outlive a reload.
 *
 * `./view-mode.ts` wrote this accessor out by hand and said why: two copies of
 * fifteen lines (the other is `../play/rail-collapse.ts`) is under the rule of
 * three, and hoisting a helper out of the play surface to import from here would
 * put a deck-view change inside that surface's blast radius. `./saved-decks.ts`
 * is the third copy, so the rule fires and the two callers that live in *this*
 * directory share one accessor.
 *
 * The play surface's copy kept its own for another lane's sake, and that lane
 * has landed: `../play/collapse-preference.ts` reads this file (`mtg-4mjy`), so
 * the last duplicate in `packages/ui` is gone and the name of this file is now
 * the only thing about it that says "deck". The blast radius that argument was
 * about is real and unchanged — a *deck-view* decision must not reach the played
 * table — and nothing here is one: these two functions read and write a string
 * under a key, and every caller decides on its own what a failure means.
 *
 * Both guards are load-bearing rather than defensive. The workspace tsconfig has
 * no `lib: dom` (`../../app/mount.ts` records why), so the store is reached
 * through a structural interface and runtime-checked rather than asserted; and a
 * page in a private window *throws* from `setItem` rather than declining, so
 * every call is wrapped.
 *
 * What a caller does about a failure is the caller's own decision, which is why
 * `writeStored` reports one instead of swallowing it. A view preference that
 * cannot be kept is not worth a word on screen — the pane simply draws the way a
 * first-ever visit draws it. A *deck* that cannot be kept is the opposite: a
 * save that says nothing and then loses the deck at the next reload is the exact
 * failure the person asked us to close.
 */

interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function store(): Store | null {
  const host = globalThis as { readonly localStorage?: unknown };
  const found = host.localStorage;
  if (typeof found !== 'object' || found === null) return null;
  const partial = found as Partial<Store>;
  if (typeof partial.getItem !== 'function' || typeof partial.setItem !== 'function') return null;
  return found as Store;
}

/** What is stored under a key, or null when there is nothing or no store at all. */
export function readStored(key: string): string | null {
  const kept = store();
  if (kept === null) return null;
  try {
    return kept.getItem(key);
  } catch {
    return null;
  }
}

/** Writes a key. False means the value is not kept and will not survive a reload. */
export function writeStored(key: string, value: string): boolean {
  const kept = store();
  if (kept === null) return false;
  try {
    kept.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
