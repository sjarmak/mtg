/**
 * A predicate over game state: the question a conditional continuous effect
 * asks before it applies.
 *
 * Magic prints three shapes of "sometimes" that DSL v1 has had no data for:
 * intervening-if (CR 603.4, "When/Whenever/At, if [condition], [effect]"),
 * "as long as" conditional continuous effects (CR 611.2c: an effect that is
 * inactive until its condition holds and stops the moment a check finds it
 * false again), and threshold/delirium-style checks, which are "as long as"
 * conditions whose predicate counts something on the board. All three are the
 * same missing shape — a value that answers a yes/no question about
 * `GameState` — and none of it existed anywhere in the effect, trigger or
 * static data model before this file.
 *
 * ## Why this is data and not a closure
 *
 * The same reason `Amount` is (`amount.ts`): a card lives in `GameState`
 * through `structuredClone`, through `stateFingerprint`'s JSON
 * canonicalization, and eventually across a worker boundary. A function in any
 * of those breaks all three. So a `Condition` is a record naming *what to
 * check*, and the kernel evaluates it against the live state at the moment the
 * question is asked — exactly the split `ObjectFilter` and `Amount` already
 * draw between "what the card says" and "what answers it".
 *
 * ## Why `controlsSubtype` was the first member
 *
 * `controlsSubtype` is the threshold shape: "you control N or more permanents
 * of a named subtype" is a tribal lord's condition and a delirium-style count
 * read off one axis instead of four card-type buckets, so it is the one
 * threshold predicate a card in this corpus needs first. The near-miss this
 * closes is named in `ability-shape.ts`: a self-scoped static was refused a
 * subtype narrowing specifically "because that would be a conditional static
 * and DSL v1 has none" — that sentence is no longer true of the data model,
 * though `checkStaticSubtype` still refuses the narrowing for the reason
 * stated there, which is about `self` being one permanent and not about
 * conditions being unavailable.
 *
 * ## Why `anyCreatureHasCounter` is the second (`mtg-jp23`)
 *
 * A reviewed common in the flagship set wants "gets +1/+1 as long as
 * any creature has a gloom counter on it" — a board-wide presence check, not
 * `controlsSubtype`'s threshold: it asks whether a kind of counter exists
 * anywhere on the battlefield, not how many permanents carry one. Three
 * narrower shapes were scoped out rather than shipped speculatively:
 *
 *  - **A creature *you control*.** The printed card asks about the whole
 *    board, and a `controller`-scoped variant would misdescribe it; nothing
 *    in this corpus needs the narrower reading yet, and adding an unused
 *    field is exactly the speculative branch `ComputedAmountSchema` and the
 *    module's own restraint below both argue against.
 *  - **Any *permanent*, not just a creature.** A gloom counter is defined
 *    (`counters.ts`) as a `-1/-1` part; a noncreature carrying one is not a
 *    state this vocabulary's counter-granting effects can produce, so
 *    widening past "creature" would accept a condition no printed effect can
 *    ever make true. `withCounter` on `TargetRestriction` (`targets.ts`) has
 *    the identical shape decision for the same reason.
 *  - **A count above one ("two or more creatures have…").** The printed card
 *    says "any creature", which is presence, not a floor; `atLeast`-shaped
 *    counting belongs to `controlsSubtype`'s family and reusing it here would
 *    print a condition the card does not say.
 *
 * ## Why `opponentGraveyardAtLeast` is the third (`mtg-nhyv.28`)
 *
 * The graveyard count the paragraph above named as an obvious next member, and
 * a card in the M11/M13 reference corpus is what finally asks for it: Jace's
 * Phantasm gets +4/+4 "as long as an opponent has ten or more cards in their
 * graveyard". It is `controlsSubtype`'s threshold shape read off a zone
 * instead of the battlefield, and it keeps `atLeast` for that family's reason —
 * every printed graveyard check is a floor.
 *
 * It names the opponent rather than carrying a `whose` field, because the
 * printed card does. A caster-side reading ("as long as there are seven or
 * more cards in your graveyard", which is threshold) is the same arithmetic
 * over the other seat and is a one-field widening the day a card prints it;
 * shipping the field now would ship a value no card in this corpus can
 * produce, which is the restraint the two members above already state.
 *
 * "An opponent" is exactly one player here, because this kernel seats two.
 * A multiplayer reading would have to decide between "any opponent" and "each
 * opponent" and the printed card would stop distinguishing them, so the
 * question is the table's rather than the vocabulary's.
 *
 * ## Why `opponentUndamagedThisTurn` is the fourth (`mtg-nhyv.60`)
 *
 * Bloodcrazed Goblin asks whether a per-turn event has happened, rather than
 * whether the current board or a zone has a shape. The condition is negative
 * because `enabledWhile` names when its `cantAttack` restriction applies: no
 * opponent has yet been dealt damage. The positive event remains the kernel's
 * stored fact, so other cards can read the history without inheriting this
 * card's restriction grammar.
 *
 * A card-in-hand count and CR 603.4's trigger clause remain obvious future
 * members. Each is a vocabulary decision that
 * belongs to the card that needs it, so inventing them now would ship members
 * no card exercises — the restraint `ComputedAmountSchema` states for the same
 * reason.
 *
 * ## Who "you" is
 *
 * Nothing here names a player. `controlsSubtype` is asked from the
 * perspective of whoever controls the ability's source, and the kernel reads
 * that live off the source's current characteristics rather than baking a
 * `PlayerId` into the record — which is what lets the same printed condition
 * answer correctly after a control-change effect, unlike `ObjectFilter`'s
 * `controller` field on a registered static (`packages/kernel/src/abilities.ts`
 * documents that field as baked in at registration time; this type does not
 * repeat that limitation).
 */
import { z } from 'zod';
import { CountFilterSchema } from './amount';
import { CounterKindSchema } from './counters';
import { ColorSchema } from './vocabulary';

/**
 * "You control [atLeast] or more permanents with the subtype [subtype]."
 *
 * The threshold shape: a tribal lord's "as long as you control three or more
 * Merfolk" and a delirium-style count both reduce to counting permanents of a
 * named subtype against a floor. `atLeast` rather than an exact count, because
 * every printed instance of this shape in Magic is a floor ("or more"), not an
 * exact match, and an exact-match condition that stops holding above the
 * number would misdescribe every card of this shape.
 */
export const ControlsSubtypeConditionSchema = z.strictObject({
  kind: z.literal('controlsSubtype'),
  subtype: z.string(),
  atLeast: z.int().min(1),
});

export type ControlsSubtypeCondition = z.infer<typeof ControlsSubtypeConditionSchema>;

/**
 * "Any creature on the battlefield has a counter of kind [counter] on it."
 *
 * Presence, not a threshold: unlike `controlsSubtype` there is no `atLeast`,
 * because the printed shape this closes ("as long as any creature has a gloom
 * counter") asks whether the counter exists anywhere on the board, not how
 * many creatures carry one. The module docblock's `mtg-jp23` section argues
 * the three narrower readings this scopes out — controller-scoped, any
 * permanent rather than any creature, and a floor above one.
 *
 * `counter` reuses `CounterKindSchema` rather than a second counter
 * vocabulary: `TargetRestriction`'s `withCounter` (`targets.ts`) already
 * settled that a counter predicate names a `CounterKind`, and a second name
 * for the same eleven-entry enum would be a second place for the two to drift.
 */
export const AnyCreatureHasCounterConditionSchema = z.strictObject({
  kind: z.literal('anyCreatureHasCounter'),
  counter: CounterKindSchema,
});

export type AnyCreatureHasCounterCondition = z.infer<typeof AnyCreatureHasCounterConditionSchema>;

/**
 * "An opponent has [atLeast] or more cards in their graveyard."
 *
 * `controlsSubtype`'s threshold over a zone rather than the battlefield, and
 * the first condition in this file that reads anything but `state.battlefield`.
 * Cards, not cards of a kind: the printed clause counts the whole graveyard, so
 * there is no filter beside the floor — a delirium-style "four or more card
 * types among cards in your graveyard" is a different predicate and would say
 * so.
 *
 * The module docblock argues why the seat is named rather than parameterized
 * and why "an opponent" is one player here.
 */
export const OpponentGraveyardAtLeastConditionSchema = z.strictObject({
  kind: z.literal('opponentGraveyardAtLeast'),
  atLeast: z.int().min(1),
});

export type OpponentGraveyardAtLeastCondition = z.infer<typeof OpponentGraveyardAtLeastConditionSchema>;

/**
 * "No opponent has been dealt damage this turn."
 *
 * The negative predicate is deliberate: `enabledWhile` names when a static
 * modification applies, and Bloodcrazed Goblin's `cantAttack` restriction is
 * active before opposing damage, not after it. Naming the positive event here
 * would require a second inversion flag on every condition reader merely to
 * recover the predicate the printed restriction actually asks.
 */
export const OpponentUndamagedThisTurnConditionSchema = z.strictObject({
  kind: z.literal('opponentUndamagedThisTurn'),
});

export type OpponentUndamagedThisTurnCondition = z.infer<typeof OpponentUndamagedThisTurnConditionSchema>;

/**
 * "You have [atLeast] or more life."
 *
 * The source's current controller supplies "you", just as it does for
 * `controlsSubtype`; life is read live because CR 611.2c turns a conditional
 * continuous effect on and off without waiting for another event. There is no
 * arbitrary maximum: Magic life totals are unbounded, while the positive
 * integer schema refuses zero, fractions, and negative thresholds.
 */
export const ControllerLifeAtLeastConditionSchema = z.strictObject({
  kind: z.literal('controllerLifeAtLeast'),
  atLeast: z.int().min(1),
});

export type ControllerLifeAtLeastCondition = z.infer<typeof ControllerLifeAtLeastConditionSchema>;

/** "Your life total is less than [fewerThan]." */
export const ControllerLifeBelowConditionSchema = z.strictObject({
  kind: z.literal('controllerLifeBelow'),
  fewerThan: z.int().min(1),
});

export type ControllerLifeBelowCondition = z.infer<typeof ControllerLifeBelowConditionSchema>;

/** "You have [atLeast] or more cards in your library." */
export const ControllerLibraryAtLeastConditionSchema = z.strictObject({
  kind: z.literal('controllerLibraryAtLeast'),
  atLeast: z.int().min(1),
});

export type ControllerLibraryAtLeastCondition = z.infer<typeof ControllerLibraryAtLeastConditionSchema>;

/** "The top card of your library is [color]." */
export const ControllerTopLibraryHasColorConditionSchema = z.strictObject({
  kind: z.literal('controllerTopLibraryHasColor'),
  color: ColorSchema,
});

export type ControllerTopLibraryHasColorCondition = z.infer<
  typeof ControllerTopLibraryHasColorConditionSchema
>;

/**
 * "Fewer than [fewerThan] permanents matching [filter] are on the battlefield."
 *
 * This is the wide static-condition answer to Harbor Serpent rather than a
 * `cantAttackUnless` modification built for one sentence. The narrow arm would
 * add a second combat-modification grammar and a second attack-legality path;
 * this member pays the six existing exhaustive readers once and can gate any
 * static modification through the `enabledWhile` seam they already share.
 *
 * The selected M11/M13 corpus has three collector positions blocked only by a
 * board-conditional attack restriction. Harbor Serpent's M11#56 and M13#53
 * share this whole-battlefield threshold. War Falcon's M13#38 instead needs a
 * disjunction over two controlled subtypes, so this member deliberately does
 * not claim it. `CountFilterSchema` is reused because it already defines the
 * characteristic predicate for whole-battlefield counts; the condition owns
 * the domain and the strict less-than comparison.
 *
 * Negative for the same reason `opponentUndamagedThisTurn` is: `enabledWhile`
 * names when Harbor Serpent's `cantAttack` restriction applies. The stored
 * predicate is therefore count < 5, while the Oracle renderer can state the
 * equivalent permission as "unless there are five or more".
 */
export const BattlefieldCountBelowConditionSchema = z.strictObject({
  kind: z.literal('battlefieldCountBelow'),
  filter: CountFilterSchema,
  fewerThan: z.int().min(1),
});

export type BattlefieldCountBelowCondition = z.infer<typeof BattlefieldCountBelowConditionSchema>;

/**
 * "You control none of the listed subtypes."
 *
 * The list is an OR over current permanents, not a sum: one permanent that is
 * both a Knight and a Soldier still makes the predicate false exactly once.
 * This negative spelling is the state in which an `enabledWhile` restriction
 * applies; Oracle may render the equivalent positive permission as "unless".
 */
export const ControlsNoneOfSubtypesConditionSchema = z.strictObject({
  kind: z.literal('controlsNoneOfSubtypes'),
  subtypes: z.array(z.string()).min(1),
});

export type ControlsNoneOfSubtypesCondition = z.infer<typeof ControlsNoneOfSubtypesConditionSchema>;

/** The source has fewer than the named number of one counter kind. */
export const SelfCounterCountBelowConditionSchema = z.strictObject({
  kind: z.literal('selfCounterCountBelow'),
  counter: CounterKindSchema,
  fewerThan: z.int().min(1),
});

export type SelfCounterCountBelowCondition = z.infer<typeof SelfCounterCountBelowConditionSchema>;

/** The source has at least the named number of one counter kind. */
export const SelfCounterCountAtLeastConditionSchema = z.strictObject({
  kind: z.literal('selfCounterCountAtLeast'),
  counter: CounterKindSchema,
  atLeast: z.int().min(1),
});

export type SelfCounterCountAtLeastCondition = z.infer<typeof SelfCounterCountAtLeastConditionSchema>;

/**
 * The predicate union, so readers can switch on `kind` and stay exhaustive as
 * it grows.
 */
export const ConditionSchema = z.discriminatedUnion('kind', [
  ControlsSubtypeConditionSchema,
  AnyCreatureHasCounterConditionSchema,
  OpponentGraveyardAtLeastConditionSchema,
  OpponentUndamagedThisTurnConditionSchema,
  ControllerLifeAtLeastConditionSchema,
  ControllerLifeBelowConditionSchema,
  ControllerLibraryAtLeastConditionSchema,
  ControllerTopLibraryHasColorConditionSchema,
  BattlefieldCountBelowConditionSchema,
  ControlsNoneOfSubtypesConditionSchema,
  SelfCounterCountBelowConditionSchema,
  SelfCounterCountAtLeastConditionSchema,
]);

/**
 * What keeps a new member from silently skipping a reader (retired the
 * `ConditionStillHasOneMember` type-level tripwire, `mtg-5adk`/`mtg-jp23`).
 *
 * That tripwire existed because `z.discriminatedUnion` with exactly one
 * option infers `Condition['kind']` to a plain `string`, not a literal type —
 * the standard `switch`/`assertNever` idiom does not compile against a union
 * that is not really a union yet, so nothing stopped a reader from doing
 * direct field access that would silently misread a second member sharing
 * `controlsSubtype`'s field names. `anyCreatureHasCounter` does not share
 * them (`counter` instead of `subtype`/`atLeast`), so every direct-field-access
 * reader from the one-member era would have failed to typecheck the moment
 * this schema gained its second option, before any test ran — and each was
 * converted to real dispatch ahead of that instead, so the failure never
 * happened. The six call sites that read a `Condition` (`conditionHolds` in
 * `packages/kernel/src/characteristics.ts`, `combatConditionHolds` in
 * `packages/kernel/src/combat.ts`, `checkStaticCondition` in
 * `packages/dsl/src/validate/abilities.ts`, `conditionPhrase` in
 * `packages/dsl/src/oracle.ts`, `conditionParams` in
 * `packages/forge-export/src/ability-script.ts`, and `conditionSupply` in
 * `packages/deckbuild/src/deck-context.ts`) are now real
 * `switch`/`assertNever` dispatch, exactly the conversion the tripwire's
 * message described. This sentence said five until `mtg-nhyv.28` added the
 * third member: `conditionSupply` arrived after the list was written and
 * nothing made the prose keep up, which is what a count stated in prose does.
 * The compiler named the sixth reader anyway, which is the property retiring
 * the tripwire was betting on, and named all six again at `mtg-nhyv.76`'s
 * fourth and fifth members without the list above being consulted.
 *
 * With a real multi-member union, `Condition['kind']` is now a literal union
 * of every discriminator above rather than plain `string`,
 * so the standard idiom works
 * on its own terms: a `switch` over `condition.kind` that omits a case leaves
 * `condition` un-narrowed in the `default` arm, `assertNever` demands a
 * `never`, and `tsc` refuses to compile. A separate tripwire type is
 * redundant now that the compiler enforces the real property directly at
 * every call site — `npm run typecheck` is what a third member without a
 * matching `case` fails, not a hand-maintained arithmetic check on
 * `.options.length`.
 */
export type Condition = z.infer<typeof ConditionSchema>;
