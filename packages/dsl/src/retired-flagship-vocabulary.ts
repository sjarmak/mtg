/**
 * Vocabulary retired together with one set's own lore, recorded apart from
 * `retired-vocabulary.ts` for a reason that has nothing to do with the gate.
 *
 * `counters.ts` imports `retired-vocabulary.ts` to build its parse-time
 * aliases, and `counters.ts` is inside the installed Forge adapter that every
 * printed-format play admission pins by SHA-256. The public export rewrites
 * the flagship set's proper nouns wherever they appear, so a retired name
 * spelled in that table would make the public adapter's bytes differ from the
 * private ones, and the public launcher would refuse every printed format on a
 * runtime mismatch. A removal needs no parse alias, so nothing the adapter runs
 * has to read this table. The vocabulary gate reads both, through
 * `recordedRetirements`.
 *
 * Only removals belong here. A rename that old artifacts should keep parsing
 * through is an alias `counters.ts` must see, and goes in
 * `retired-vocabulary.ts`.
 *
 * The flagship set's legendary artifact cycle (`mtg-rji`) once put a marker
 * counter named for its central artifact on itself every upkeep. No committed
 * set build prints that counter any more, so the kind was removed rather than
 * renamed, and the card text that named it went with it.
 */
import { retiredNames } from './retired-vocabulary';
import type { RetiredNames } from './retired-vocabulary';

export const FLAGSHIP_RETIRED_VOCABULARY: Readonly<Record<string, RetiredNames>> = {
  COUNTER_KINDS: {
    trisigil: null,
  },
  MODEL_COUNTER_KINDS: {
    trisigil: null,
  },
};

/** Every recorded retirement of one enum: the parsed table's and this one's. */
export function recordedRetirements(enumName: string): RetiredNames {
  return { ...retiredNames(enumName), ...(FLAGSHIP_RETIRED_VOCABULARY[enumName] ?? {}) };
}
