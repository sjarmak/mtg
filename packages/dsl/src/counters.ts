/**
 * Counter kinds, and what carrying one means.
 *
 * A counter kind is not a name the kernel switches on. It is one entry in
 * `COUNTER_DECLARATIONS`, and the entry says what the counter does in the same
 * vocabulary a printed static ability uses (`StaticModification`: a stat change,
 * a granted keyword, or both). Everything downstream reads the declaration:
 * layer 7d sums the stat halves, layer 6 unions the keyword halves, and the
 * oracle renderer turns the same record into reminder text. Adding a part to
 * the flagship set is an entry here plus its `FORGE_COUNTER_TYPES` entry in
 * `@mtg/forge-export`, which is exhaustive over this record and so fails the
 * typecheck until the new kind states whether Forge has a counter type for it.
 * No layer gains a branch and no renderer gains a case: those two entries are
 * the whole cost of a part.
 *
 * ## Which layer each half lands in
 *
 * The two halves of one declaration reach two different layers, and the stat
 * half does not reach the layer a static ability's identical-looking
 * modification reaches:
 *
 *  - `statBonus` from a counter is **layer 7d** (CR 613.4d, "P/T changes from
 *    counters"), not the layer 7c a static ability's stat bonus uses. A counter
 *    is on the object, so it applies after every 7c modification and before the
 *    7e switch. That ordering is what makes "switch P/T, then add a +1/+1
 *    counter" come out +1/+1 on the *switched* values.
 *  - `grantKeyword` from a counter is **layer 6** (CR 613.1f), the same layer a
 *    keyword-granting continuous effect uses, because a keyword counter adds an
 *    ability however it got there (CR 122.1c).
 *
 * `packages/kernel/src/layers.ts` applies both, and it applies the keyword half
 * *first within layer 6*, before that layer's continuous effects: a later
 * "loses all abilities" must be able to take a keyword counter's grant away,
 * which it cannot do if the counter applies last.
 *
 * ## Why this file and not `vocabulary.ts`
 *
 * A declaration is typed out of `ability-shape.ts`'s static modifications,
 * which imports `vocabulary.ts`. Putting the table in `vocabulary.ts` would make
 * that a cycle.
 *
 * ## Why the names are a tuple and the table is checked against it
 *
 * The type and the schema used to be read *out* of the table
 * (`keyof typeof DECLARATIONS`), which made a counter kind's name depend on
 * `StaticModification`, and so on everything `StaticModification` reaches. That
 * held until an amount wanted to count counters: `countWithCounter`
 * (`amount.ts`) puts `CounterKindSchema` inside `PermanentTallySchema`, which
 * `StatBonusPerModificationSchema` reads, which is a `StaticModification` — so
 * the table's own type ran through the schema that was named after it, and
 * every inference in the cycle collapsed to `any` (TS7022, and about fifty
 * errors downstream of it in packages that had touched none of this).
 *
 * `COUNTER_KINDS` is therefore the tuple, written once, and the table
 * `satisfies Readonly<Record<CounterKind, CounterDeclaration>>`. The two still
 * cannot disagree — a name with no entry and an entry with no name are both
 * typecheck failures, and `counters.test.ts` asserts the tuple against
 * `Object.keys` at run time as well — but the names no longer depend on what a
 * declaration *contains*, which is what let the cycle form. Adding a counter
 * kind is now one name and one entry, three lines apart.
 */
import { z } from 'zod';
import type { GrantKeywordModification, StaticModificationOf } from './ability-shape';
import { retiredNames } from './retired-vocabulary';
import type { RetiredNames } from './retired-vocabulary';
import { formatPtDelta, joinWithAnd, numberWord, pluralize, withArticle } from './text-util';
import { KEYWORD_PRINT_NAMES, sortKeywords } from './vocabulary';
import type { Keyword } from './vocabulary';

/** What one counter kind is and what it does. */
export interface CounterDeclaration {
  /**
   * The counter's printed name, lowercase, as it appears between "a" and
   * "counter": `+1/+1`, `horn`.
   *
   * Short, because the name is printed twice on the shortest card that can
   * carry the counter — once in the clause and once in the derived reminder —
   * so every character costs two against `@mtg/setgen`'s 140-character
   * `longText` red flag. A ten-character name put the shortest common printing
   * it at 149 and out of common altogether (`mtg-18a`).
   */
  readonly printName: string;
  /**
   * What carrying one of these does, once. An empty list is legal and means a
   * counter that only marks the permanent.
   *
   * Two members of the static vocabulary rather than all of it, and the
   * `grantKeyword` here is the *narrow* one: `mtg-nhyv.74` widened the printed
   * modification so a lord can hand out indestructible, and a counter is not a
   * lord. `counterKeywords` (`@mtg/kernel`'s `layers.ts`) folds a counter's
   * grants straight into `Characteristics.keywords`, which is the nine
   * evergreen names, so a counter that named a keyword ability would have to
   * grow the other half of that record too — for no counter this file declares.
   */
  readonly modifications: readonly (StaticModificationOf<'statBonus'> | GrantKeywordModification)[];
}

/**
 * Every counter kind, in printing order.
 *
 * Written here rather than derived from the table below, for the reason the
 * header gives: a name that depends on what a declaration contains is a name
 * that depends on the whole ability vocabulary, and one amount counting
 * counters closes that loop.
 */
export const COUNTER_KINDS = [
  'plusOnePlusOne',
  'minusOneMinusOne',
  'horn',
  'wing',
  'talon',
  'hide',
  'fang',
  'gloom',
  'loyalty',
  'trisigil',
] as const;

export type CounterKind = (typeof COUNTER_KINDS)[number];

/**
 * The one place a counter kind's meaning is written down.
 *
 * `plusOnePlusOne` and `minusOneMinusOne` are entries here rather than branches
 * in layer 7d, which is the point: before this table the kernel knew what a
 * +1/+1 counter did because `applyCounterLayer` subtracted one hardcoded field
 * from another hardcoded field.
 *
 * `horn` is the flagship set's first part counter (a Silver Direhorn's horn,
 * fused onto a creature) and it is here as proof that a part is data: it reaches
 * two layers from one entry and needed no code to do it.
 *
 * It was `saberHorn` until `mtg-bs1` and `mtg-18a`, and both halves of that name
 * were a problem. `saber` is set lore, which put one concept's name in the
 * engine's type system and left the public export renaming it to `trophyHorn`,
 * so the same counter had two names depending on which tree you read. And the
 * ten-character printed name was what kept the counter off common: see
 * `printName` above. A horn is a part in any world and fits in four characters.
 *
 * `gloom` means what a -1/-1 counter means and is a kind of its own anyway,
 * because identity is the one thing a declaration carries that a stat line does
 * not: `annihilateCounters` (CR 704.5q) cancels exactly the
 * `plusOnePlusOne`/`minusOneMinusOne` pair, so a gloom counter stays on a
 * creature that later gains a +1/+1 counter instead of vanishing with it. Both
 * counters remain on the object and both are read by layer 7d, which is what
 * the flagship set's gloom wants and what `minusOneMinusOne` under a second
 * name would not give it.
 *
 * `trisigil` is the set's Trisigil cycle (`mtg-rji`): three legendary artifacts
 * that each accrue one every upkeep until the third lands. It modifies nothing,
 * which makes it the second marker counter after `loyalty` and the first one a
 * card actually prints the name of — `counterReminderText` returns null for an
 * empty `modifications` list, so the card says what it does and adds no
 * reminder sentence about what the counter does, because the counter does
 * nothing on its own. Its printed name is capitalized, alone among these, and
 * that is not a slip: the other five name a quantity or a substance and this
 * one names a thing in the world. Eight characters spends more of `@mtg/setgen`'s
 * 140-character `longText` budget than `printName` above would like, and the
 * cycle is three legendary rares where that budget is loosest.
 */
const DECLARATIONS = {
  plusOnePlusOne: {
    printName: '+1/+1',
    modifications: [{ kind: 'statBonus', power: 1, toughness: 1 }],
  },
  minusOneMinusOne: {
    printName: '-1/-1',
    modifications: [{ kind: 'statBonus', power: -1, toughness: -1 }],
  },
  horn: {
    printName: 'horn',
    modifications: [
      { kind: 'statBonus', power: 1, toughness: 1 },
      { kind: 'grantKeyword', keyword: 'firstStrike' },
    ],
  },
  wing: {
    printName: 'wing',
    modifications: [
      { kind: 'statBonus', power: 1, toughness: 1 },
      { kind: 'grantKeyword', keyword: 'flying' },
    ],
  },
  talon: {
    printName: 'talon',
    modifications: [
      { kind: 'statBonus', power: 1, toughness: 1 },
      { kind: 'grantKeyword', keyword: 'deathtouch' },
    ],
  },
  hide: {
    printName: 'hide',
    modifications: [
      { kind: 'statBonus', power: 1, toughness: 1 },
      { kind: 'grantKeyword', keyword: 'trample' },
    ],
  },
  fang: {
    printName: 'fang',
    modifications: [
      { kind: 'statBonus', power: 1, toughness: 1 },
      { kind: 'grantKeyword', keyword: 'menace' },
    ],
  },
  gloom: {
    printName: 'gloom',
    modifications: [{ kind: 'statBonus', power: -1, toughness: -1 }],
  },
  loyalty: {
    printName: 'loyalty',
    modifications: [],
  },
  trisigil: {
    printName: 'Trisigil',
    modifications: [],
  },
} as const satisfies Readonly<Record<CounterKind, CounterDeclaration>>;

export const COUNTER_DECLARATIONS: Readonly<Record<CounterKind, CounterDeclaration>> = DECLARATIONS;

/**
 * Retired counter-kind names, mapped to the kind that carries their meaning
 * now, so a set file written before a rename still parses.
 *
 * The names are not written here. They are read from
 * `retired-vocabulary.ts`, which is the one table the vocabulary gate requires
 * every narrowing to be recorded in — a second copy of `saberHorn` living in
 * this file would be a second thing to keep in step, and the failure mode of
 * the pair drifting is exactly the failure the gate exists to prevent. What
 * this file still decides for itself is whether to *accept* the retired names
 * at parse time, which is a per-enum call: this enum says yes, because a set
 * generated before the rename (`out/XMP/set.json`, 2026-08-14) says
 * `saberHorn` on disk and is the reason the mechanism exists at all.
 *
 * The map is read as plain strings and handed to `z.enum` for validation
 * rather than typed as `CounterKind` here: a stale entry naming a kind this
 * tuple no longer declares fails the parse it appears in instead of being
 * asserted true, and `vocabulary-snapshot.test.ts` fails on it directly.
 * Nothing downstream of `CounterKindSchema.parse` ever sees `saberHorn` — it
 * normalizes to `horn` at the schema boundary, so the rename's "one name"
 * invariant holds for every kind the table does not name, and holds for `horn`
 * too from the moment a file is read.
 */
const LEGACY_COUNTER_KIND_ALIASES: RetiredNames = retiredNames('COUNTER_KINDS');

export const CounterKindSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  return LEGACY_COUNTER_KIND_ALIASES[value] ?? value;
}, z.enum(COUNTER_KINDS));

export interface StatBonus {
  readonly power: number;
  readonly toughness: number;
}

/** Stat change one counter of this kind contributes (layer 7d). */
export function counterStatBonus(kind: CounterKind): StatBonus {
  let power = 0;
  let toughness = 0;
  for (const modification of COUNTER_DECLARATIONS[kind].modifications) {
    if (modification.kind !== 'statBonus') continue;
    power += modification.power;
    toughness += modification.toughness;
  }
  return { power, toughness };
}

/** Keywords one counter of this kind grants (layer 6), in vocabulary order. */
export function counterGrantedKeywords(kind: CounterKind): readonly Keyword[] {
  const granted = COUNTER_DECLARATIONS[kind].modifications.flatMap((modification) =>
    modification.kind === 'grantKeyword' ? [modification.keyword] : [],
  );
  return sortKeywords(granted);
}

/**
 * The counter's own printed name, with no quantity attached.
 *
 * `counterPhrase` builds the whole noun phrase around a numeral, which a
 * computed amount has not got: "Put a number of +1/+1 counters on … equal to …"
 * needs the name and the plural noun without the count in front of them.
 */
export function counterName(kind: CounterKind): string {
  return COUNTER_DECLARATIONS[kind].printName;
}

/** `a horn counter`, `two horn counters`. */
export function counterPhrase(kind: CounterKind, count: number): string {
  const name = COUNTER_DECLARATIONS[kind].printName;
  const noun = pluralize('counter', count);
  return count === 1 ? `${withArticle(name)} ${noun}` : `${numberWord(count)} ${name} ${noun}`;
}

/**
 * Reminder text for a counter kind, or `null` when the counter's name already
 * says what it does.
 *
 * The suppression rule is derived, not a list of exempt kinds: a counter whose
 * whole effect is one stat change *and* whose printed name is that stat line
 * (`+1/+1`) would otherwise print "(A creature with a +1/+1 counter gets
 * +1/+1.)", which says nothing twice. Every other kind gets the sentence,
 * including one added tomorrow.
 */
export function counterReminderText(kind: CounterKind): string | null {
  const declaration = COUNTER_DECLARATIONS[kind];
  const bonus = counterStatBonus(kind);
  const keywords = counterGrantedKeywords(kind);
  const statLine = formatPtDelta(bonus.power, bonus.toughness);
  if (keywords.length === 0 && declaration.printName === statLine) return null;
  const clauses: string[] = [];
  if (bonus.power !== 0 || bonus.toughness !== 0) clauses.push(`gets ${statLine}`);
  if (keywords.length > 0) {
    clauses.push(`has ${joinWithAnd(keywords.map((keyword) => KEYWORD_PRINT_NAMES[keyword]))}`);
  }
  if (clauses.length === 0) return null;
  return `(A creature with ${withArticle(declaration.printName)} counter ${joinWithAnd(clauses)}.)`;
}
