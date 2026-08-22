/**
 * Bounded combinatorial helpers for legal-option enumeration.
 *
 * Declaration spaces (which attackers, which blocks) are exponential, so every
 * helper takes an explicit cap and reports whether it ran to completion. The
 * kernel never silently truncates without saying so: `Decision.complete` is
 * false whenever a cap bit, and `validateAction` still accepts any legal
 * declaration an agent constructs itself.
 */

export const DEFAULT_ENUMERATION_CAP = 512;

export interface Enumerated<T> {
  readonly items: readonly T[];
  readonly complete: boolean;
}

/**
 * All subsets of `items`, up to `cap` results.
 *
 * In lattice order rather than by size: the list grows one item at a time, so
 * every subset of the first k items appears before any subset naming the k+1th.
 * That matters when the cap bites, and `mtg-dwd` measured what it costs — a
 * truncated list is every subset of a *prefix* of the board, so on twelve
 * eligible attackers the 512 options name nine creatures and the other three
 * appear in no option at all. The order is not a detail to be tidied: a recorded
 * game is a list of indices into these lists, so changing it would silently
 * replay every committed recording as a different game.
 */
export function subsets<T>(items: readonly T[], cap: number): Enumerated<readonly T[]> {
  const results: (readonly T[])[] = [[]];
  let complete = true;
  for (const item of items) {
    const grown: (readonly T[])[] = [];
    for (const existing of results) {
      if (results.length + grown.length >= cap) {
        complete = false;
        break;
      }
      grown.push([...existing, item]);
    }
    results.push(...grown);
    if (!complete) break;
  }
  return { items: results, complete };
}

/**
 * Cartesian product of per-slot choice lists, up to `cap` results.
 *
 * Every tuple returned names **one choice per slot**, whether or not the cap
 * bit. That is the whole of `mtg-4nkq`'s finding: this used to stop at the slot
 * the cap bit on and return the partial tuples built so far, so a truncated
 * product handed its caller tuples one entry short. `castOptions` and
 * `activationOptions` both read `items` without gating on `complete` — the
 * combat and trigger callers do gate — so a short tuple went straight into a
 * `castSpell` whose `targets` did not cover its effects, which is exactly what
 * `validateCast` refuses with "one target slot per effect is required". The
 * surface offered a move and the kernel rejected it.
 *
 * So the cap is applied per slot and the loop runs to the end of the slot list
 * regardless. Truncation now costs tuples, never arity. The complete case and
 * the case where the cap bites on the last slot are byte-for-byte what they
 * were, which matters for the reason `subsets`' docblock gives: a recorded game
 * is a list of indices into these lists. The tuples that do change are the ones
 * no recording can hold, because the kernel refused every one of them.
 */
export function cartesian<T>(choices: readonly (readonly T[])[], cap: number): Enumerated<readonly T[]> {
  let results: (readonly T[])[] = [[]];
  let complete = true;
  for (const slot of choices) {
    const grown: (readonly T[])[] = [];
    let room = true;
    for (const prefix of results) {
      for (const choice of slot) {
        if (grown.length >= cap) {
          room = false;
          complete = false;
          break;
        }
        grown.push([...prefix, choice]);
      }
      if (!room) break;
    }
    results = grown;
  }
  return { items: results, complete };
}

/** All permutations of `items`, up to `cap` results. */
export function permutations<T>(items: readonly T[], cap: number): Enumerated<readonly T[]> {
  if (items.length === 0) return { items: [[]], complete: true };
  const results: (readonly T[])[] = [];
  let complete = true;

  const walk = (chosen: readonly T[], rest: readonly T[]): void => {
    if (!complete) return;
    if (rest.length === 0) {
      if (results.length >= cap) {
        complete = false;
        return;
      }
      results.push(chosen);
      return;
    }
    for (let index = 0; index < rest.length; index += 1) {
      const item = rest[index];
      if (item === undefined) continue;
      walk([...chosen, item], [...rest.slice(0, index), ...rest.slice(index + 1)]);
      if (!complete) return;
    }
  };

  walk([], items);
  return { items: results, complete };
}

/**
 * The permutations of `items` that differ, where `classOf` says which items are
 * interchangeable, up to `cap` results.
 *
 * `permutations` with one line added: at each position, an item is only tried
 * once per class, so swapping two members of a class never produces a second
 * ordering. Items in classes of their own permute exactly as they did — the
 * output is `permutations`' own list with the repeats absent, in `permutations`'
 * own order — which matters because a recorded game is a list of indices into
 * these lists and a board of distinct objects must keep the indices it had.
 *
 * Which items are interchangeable is not this function's judgment to make; it is
 * a claim about the rules, and `damage-order.ts` is where the one this has a
 * caller for is argued.
 */
export function distinctPermutations<T>(
  items: readonly T[],
  classOf: (item: T) => string,
  cap: number,
): Enumerated<readonly T[]> {
  if (items.length === 0) return { items: [[]], complete: true };
  const results: (readonly T[])[] = [];
  let complete = true;

  const walk = (chosen: readonly T[], rest: readonly T[]): void => {
    if (!complete) return;
    if (rest.length === 0) {
      if (results.length >= cap) {
        complete = false;
        return;
      }
      results.push(chosen);
      return;
    }
    const tried = new Set<string>();
    for (let index = 0; index < rest.length; index += 1) {
      const item = rest[index];
      if (item === undefined) continue;
      const key = classOf(item);
      if (tried.has(key)) continue;
      tried.add(key);
      walk([...chosen, item], [...rest.slice(0, index), ...rest.slice(index + 1)]);
      if (!complete) return;
    }
  };

  walk([], items);
  return { items: results, complete };
}

/** All `size`-element combinations of `items`, up to `cap` results. */
export function combinations<T>(items: readonly T[], size: number, cap: number): Enumerated<readonly T[]> {
  if (size <= 0) return { items: [[]], complete: true };
  if (size > items.length) return { items: [], complete: true };
  const results: (readonly T[])[] = [];
  let complete = true;

  const walk = (start: number, chosen: readonly T[]): void => {
    if (!complete) return;
    if (chosen.length === size) {
      if (results.length >= cap) {
        complete = false;
        return;
      }
      results.push(chosen);
      return;
    }
    for (let index = start; index < items.length; index += 1) {
      const item = items[index];
      if (item === undefined) continue;
      walk(index + 1, [...chosen, item]);
      if (!complete) return;
    }
  };

  walk(0, []);
  return { items: results, complete };
}

/**
 * All subsets of `items` of size 0 through `maxSize`, up to `cap` results,
 * smallest first.
 *
 * Built from `combinations` rather than a second walk, because "up to N" is
 * exactly the union of the N+1 fixed-size layers `combinations` already
 * enumerates, and reusing it keeps one recursive combinatorial walk in this
 * file rather than two that have to agree. Smallest layer first, deliberately
 * — `TargetSpec.count`'s "up to two target creatures" (`mtg-kg44`) needs the
 * empty choice to survive a cap on a crowded board exactly as much as it
 * needs the full-size ones, and `subsets`' own docblock is the cautionary
 * tale for enumerating in an order where a cap discards a whole size class
 * instead of a slice of every class. A plain N-choose-K caller should reach
 * for `combinations` directly rather than pass `maxSize` equal to the one
 * size it wants, which would enumerate every smaller layer for nothing.
 */
export function subsetsUpToSize<T>(
  items: readonly T[],
  maxSize: number,
  cap: number,
): Enumerated<readonly T[]> {
  const results: (readonly T[])[] = [];
  let complete = true;
  for (let size = 0; size <= maxSize; size += 1) {
    const layer = combinations(items, size, Math.max(0, cap - results.length));
    results.push(...layer.items);
    if (!layer.complete || results.length >= cap) {
      complete = false;
      break;
    }
  }
  return { items: results, complete };
}
