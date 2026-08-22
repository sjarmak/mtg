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
 * ## Why `lifeAtLeast` is the fourth (`mtg-nhyv.76`)
 *
 * The life total the paragraph above called an obvious next member, and M11's
 * Serra Ascendant is the card that asks: "as long as you have 30 or more life,
 * this creature gets +5/+5 and has flying". It is `controlsSubtype`'s threshold
 * read off a seat's life rather than off a board or a zone, and it keeps
 * `atLeast` for that family's reason — every printed life check of this shape is
 * a floor.
 *
 * Its floor is `LIMITS.lifeThreshold` rather than `LIMITS.conditionThreshold`,
 * and the split is a card rather than a taste: the shared threshold limit caps
 * at 20, which is a statement about how many permanents of one subtype a deck
 * can put on a board, and 30 is a life total a game reaches routinely. Reusing
 * the permanent-count ceiling would have refused the one card the member is for.
 *
 * ## Why `noOpponentDealtDamageThisTurn` is the fifth (`mtg-nhyv.76`)
 *
 * M11's Bloodcrazed Goblin: "this creature can't attack unless an opponent has
 * been dealt damage this turn". The `cantAttack` restriction is CR 508.1a and
 * has worked unconditionally since it landed; the whole card refused on this
 * clause.
 *
 * It is the first member of a different family. The four above are censuses —
 * each counts or looks for something the state holds right now, so each is
 * answerable from a board and a zone with no history. This one reads what
 * *happened*, and the state has to have been kept for it. The kernel keeps it
 * the way it already keeps a land drop: `TurnState.damagedPlayers`, written at
 * `applyDamage`'s one player-recipient branch and reset by `beginTurn`, which
 * rebuilds the whole turn record. A second per-turn accumulator with a reset of
 * its own is how two turn boundaries end up disagreeing.
 *
 * It is also the first member written in the negative, and the polarity is the
 * printed sentence rather than a preference. `enabledWhile` turns a
 * modification *on*; the printed clause is a restriction with an "unless" in
 * it, so the thing that has to be on is the prohibition, and the prohibition is
 * on exactly while no opponent has been dealt damage. Spelling the member
 * positively and negating it at the reader would have put the polarity in six
 * `switch` arms instead of in the name, and `conditionPhrase` would have had to
 * invent an "unless" the schema does not carry. A `not` wrapper over the union
 * is the general answer and it is not this card's: one card asks, and a
 * combinator that reaches every member is a vocabulary decision with no
 * evidence behind it yet.
 *
 * Presence rather than a floor, unlike the other member that names the opponent:
 * the printed clause asks whether damage happened, not how much, and an amount
 * would print a condition no card in this corpus says. It names the opponent for
 * `opponentGraveyardAtLeast`'s stated reason and reads the seat live for the
 * same one.
 *
 * A card-in-hand count and CR 603.4's trigger clause are still the obvious next
 * members. Each is a vocabulary decision that belongs to the card that needs it,
 * so inventing them now would ship members no card exercises — the restraint
 * `ComputedAmountSchema` states for the same reason.
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
import { CounterKindSchema } from './counters';

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
 * "You have [atLeast] or more life."
 *
 * `controlsSubtype`'s threshold read off a life total. "You" is the ability
 * source's controller, read live, which is the module docblock's rule for every
 * member that does not name a seat.
 *
 * `atLeast` and not an exact total, for the threshold family's stated reason,
 * and no upper bound of its own: "as long as you have exactly 30 life" is a
 * sentence Magic does not print on this shape, and a window would stop holding
 * above the number the card names.
 */
export const LifeAtLeastConditionSchema = z.strictObject({
  kind: z.literal('lifeAtLeast'),
  atLeast: z.int().min(1),
});

export type LifeAtLeastCondition = z.infer<typeof LifeAtLeastConditionSchema>;

/**
 * "No opponent has been dealt damage this turn."
 *
 * The first member that reads accumulated turn state rather than a census of
 * the board, a zone or a seat, and the first written in the negative; the
 * module docblock argues both, including why the negation is in the name and
 * not in a wrapper.
 *
 * No field. Presence, like `anyCreatureHasCounter` and for its reason — the
 * printed clause asks whether damage happened, not how much and not from what.
 * Damage specifically, not life loss: `applyDamage` is the one write site, so a
 * card that made an opponent pay life does not turn this on, which is the
 * distinction CR 119.3 draws and the distinction the printed word makes.
 */
export const NoOpponentDealtDamageThisTurnConditionSchema = z.strictObject({
  kind: z.literal('noOpponentDealtDamageThisTurn'),
});

export type NoOpponentDealtDamageThisTurnCondition = z.infer<
  typeof NoOpponentDealtDamageThisTurnConditionSchema
>;

/**
 * The predicate union, so readers can switch on `kind` and stay exhaustive as
 * it grows. Five members as of `mtg-nhyv.76`; see the module docblock for why
 * the obvious next ones are not here yet.
 */
export const ConditionSchema = z.discriminatedUnion('kind', [
  ControlsSubtypeConditionSchema,
  AnyCreatureHasCounterConditionSchema,
  OpponentGraveyardAtLeastConditionSchema,
  LifeAtLeastConditionSchema,
  NoOpponentDealtDamageThisTurnConditionSchema,
]);

/**
 * What now keeps a third member from silently skipping a reader (retired the
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
 * With a real multi-member union, `Condition['kind']` is now a literal type
 * naming every member rather than a plain `string`, so the standard idiom works
 * on its own terms: a `switch` over `condition.kind` that omits a case leaves
 * `condition` un-narrowed in the `default` arm, `assertNever` demands a
 * `never`, and `tsc` refuses to compile. A separate tripwire type is
 * redundant now that the compiler enforces the real property directly at
 * every call site — `npm run typecheck` is what a third member without a
 * matching `case` fails, not a hand-maintained arithmetic check on
 * `.options.length`.
 */
export type Condition = z.infer<typeof ConditionSchema>;
