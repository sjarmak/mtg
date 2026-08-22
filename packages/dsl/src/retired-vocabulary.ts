/**
 * Every name this DSL's vocabulary used to declare and no longer does, mapped
 * to the member that carries its meaning now.
 *
 * ## What this table is for
 *
 * Renaming a member of a DSL enum is a *narrowing*: the old name stops being a
 * legal value the moment the tuple changes. Every generated artifact already on
 * disk still says the old name, and nothing in CI reads those artifacts — they
 * are outputs, not sources, so a gate that parsed them would have an exit code
 * that depended on which files a given machine happened to be holding. A rename
 * of one counter kind on 2026-08-16 therefore made a generated set file
 * unopenable and stayed unnoticed for two days.
 *
 * So the record of what was narrowed lives here, in the tree, where the gate can
 * read it: `packages/dsl/tools/vocabulary-snapshot.ts` diffs the committed
 * snapshot against the vocabulary the package exports today, and a member that
 * disappeared without an entry in this table fails hard and says so. Recording a
 * retirement is one line; the point is that it cannot be skipped.
 *
 * ## Recording is not parsing
 *
 * An entry here states a historical fact. It does not, by itself, make any
 * schema accept the retired name. Whether a given enum should keep parsing its
 * old names is a per-enum decision about whether artifacts naming them are worth
 * reading: `counters.ts` says yes, because a set generated before the rename is
 * the reason this whole mechanism exists, and it builds its parse-time alias map
 * out of `retiredNames('COUNTER_KINDS')`. Most enums will say no and leave the
 * entry as a note to whoever next reads a file that will not parse.
 *
 * ## The keys
 *
 * Outer key: the exported tuple's name, exactly as `@mtg/dsl` exports it
 * (`COUNTER_KINDS`, not `CounterKind`), because that is what the snapshot is
 * keyed by. Inner key: the retired name. Inner value: the live member that means
 * what it meant. `vocabulary-snapshot.test.ts` holds both ends to the live
 * vocabulary — an outer key that names no exported tuple, or a value that is not
 * a current member, is a stale entry and fails there rather than rotting.
 */

/** Retired names of one enum, mapped to the live member each became. */
export type RetiredNames = Readonly<Record<string, string>>;

/**
 * The whole record of narrowed DSL vocabulary, by enum name.
 *
 * `saberHorn` is the counter kind `horn` under its pre-`mtg-bs1`/`mtg-18a` name.
 * Both halves of the old name were a problem — `saber` put one set's lore in the
 * engine's type system, and ten characters of printed name kept the counter off
 * common — and the rename commit (7d47f6e, 2026-08-16) narrowed `COUNTER_KINDS`
 * with no way back in for the set file that had already been generated. That is
 * the retirement this table was seeded from.
 *
 * `MANA_COST_ZERO` is a *removal* rather than a rename, and it is the first
 * entry that has to be read as one. It refused a total mana value of 0 with the
 * message "DSL v0 has no free spells", and `mtg-nhyv.79` deleted it after
 * measuring that the kernel offers, pays and resolves a {0} spell from a board
 * with no mana at all (`kernel/test/free-spell.test.ts`): the sentence was about
 * what the *generator* may print, and the generator states it itself, in every
 * slot's cost window. So a card that reported this code reports nothing today —
 * it is legal. The value names `MANA_COST_OUT_OF_RANGE` because this table's
 * shape requires a live member and that is the nearest true one: it still guards
 * the ceiling of the range whose floor this code was, so a reader chasing an old
 * report lands on the check that survived rather than on nothing.
 */
export const RETIRED_VOCABULARY: Readonly<Record<string, RetiredNames>> = {
  COUNTER_KINDS: {
    saberHorn: 'horn',
  },
  VIOLATION_CODES: {
    MANA_COST_ZERO: 'MANA_COST_OUT_OF_RANGE',
  },
};

/**
 * The retired names of one enum, or an empty map for an enum that has never
 * been narrowed.
 *
 * Returning `{}` rather than `undefined` is what lets a caller write the lookup
 * as one expression: a schema deriving its alias map does not want a branch for
 * "this enum has no history", and neither does the gate.
 */
export function retiredNames(enumName: string): RetiredNames {
  return RETIRED_VOCABULARY[enumName] ?? {};
}
