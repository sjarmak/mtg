/**
 * The pool a criteria draft names, assembled while the person is still typing.
 *
 * `mtg-1urk`. A pool can refuse the sets it was handed — two sets printing
 * different cards under one name, a set that names one card twice, a color and
 * mana-value pair that leaves nothing — and every one of those refusals is
 * knowable the moment the second set is chosen. `setDeckPool` needs no model, no
 * network and no key; it reads cards the launcher already has in memory.
 *
 * Before this, the only way to learn was to press Build and read a failed job
 * minutes later, which reads like a wasted charge even though it is not: the
 * pool is assembled before the first model call, so nothing was spent. A refusal
 * that arrives as a failed build teaches the wrong lesson about what builds
 * cost. So it arrives here instead, as an issue keyed to the Sets field, in the
 * same answer the form already re-reads on every edit.
 *
 * It states a refusal and never a repair it chose itself: the sets are the
 * person's selection and dropping one for them is a decision, not a validation.
 */
import { EmptyUniverseError } from '../build';
import type { DeckCriteria } from '../criteria';
import type { PoolSet } from '../pool';
import {
  ConflictingReprintError,
  DuplicateSetCardError,
  DuplicateSetCardIdError,
  setDeckPool,
} from '../pool';
import type { WorkbenchCriteria } from './variation';

/**
 * The workbench's criteria in the shape the build pipeline states its own.
 *
 * One translation, used by the build and by the check above it, because the
 * whole value of checking early is that it is the same assembly the build will
 * do. Two spellings of it would let the form pass a draft the build refuses.
 *
 * They differ in exactly one place — the pool is `sets` and there is no format
 * and no dollar budget — so there is no field here a person did not state.
 */
export function statedCriteria(criteria: WorkbenchCriteria): DeckCriteria {
  return {
    prompt: criteria.prompt,
    sets: [...criteria.sets],
    colors: [...criteria.colors],
    size: criteria.size,
    maxCopies: criteria.maxCopies,
    themes: [...criteria.themes],
    ...(criteria.landCount === undefined ? {} : { landCount: criteria.landCount }),
    ...(criteria.archetype === undefined ? {} : { archetype: criteria.archetype }),
    ...(criteria.maxManaValue === undefined ? {} : { maxManaValue: criteria.maxManaValue }),
    ...(criteria.powerBand === undefined ? {} : { powerBand: criteria.powerBand }),
    ...(criteria.opponentPopulation === undefined
      ? {}
      : {
          opponentPopulation: {
            ...criteria.opponentPopulation,
            members: criteria.opponentPopulation.members.map((member) => ({ ...member })),
          },
        }),
  };
}

/**
 * The staged sets a selection names, in the launcher's own ranking order.
 *
 * Order matters and is deliberately not the order they were clicked: it decides
 * which printing of a reprint the pool keeps and a game is dealt. One function
 * so the check and the build cannot disagree about that.
 */
export function poolsFor(pools: readonly PoolSet[], codes: readonly string[]): readonly PoolSet[] {
  const named = new Set(codes);
  return pools.filter((pool) => named.has(pool.code));
}

/**
 * What is wrong with the pool this draft names, or `null` when nothing is.
 *
 * Only the pool's own refusals are caught. A format or a dollar budget cannot
 * be stated in `WorkbenchCriteriaSchema` at all, so those two errors are
 * unreachable from here and anything else that throws is a defect rather than a
 * criterion: it goes up rather than being reported to the person as if their
 * form were wrong.
 */
export function checkWorkbenchPool(pools: readonly PoolSet[], criteria: WorkbenchCriteria): string | null {
  try {
    const pool = setDeckPool(poolsFor(pools, criteria.sets), statedCriteria(criteria));
    // The same condition `buildInformedDeck` refuses on, and its own sentence:
    // an empty universe is a build that asks the model to choose from nothing.
    if (pool.universe.cards.length === 0) return new EmptyUniverseError(pool.universe.filters).message;
    return null;
  } catch (cause: unknown) {
    if (
      cause instanceof ConflictingReprintError ||
      cause instanceof DuplicateSetCardError ||
      cause instanceof DuplicateSetCardIdError
    ) {
      return cause.message;
    }
    throw cause;
  }
}
