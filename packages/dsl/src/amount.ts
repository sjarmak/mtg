/**
 * A number a card prints, which is not always a number.
 *
 * Every numeric slot in the effect union used to be `z.int()`. Magic's slots are
 * not: "deals 3 damage" and "deals damage equal to the number of cards exiled
 * this way" are the same slot filled two ways, and a vocabulary with only the
 * first can express the small half of the game.
 *
 * ## Why this is data and not a closure
 *
 * The same reason `ObjectFilter` is (`kernel/src/continuous.ts`): a card lives
 * in `GameState` through `structuredClone`, through `stateFingerprint`'s JSON
 * canonicalization, and eventually across a worker boundary. A function in any
 * of those breaks all three. So a computed amount is a record naming *what to
 * count*, and the kernel evaluates it against the live state at the moment the
 * effect applies.
 *
 * ## Why a bare integer is still an Amount
 *
 * `z.union([z.int(), …])` rather than `{ kind: 'literal', value }`, so every
 * card written before this existed parses byte-for-byte unchanged and every
 * card written after it keeps printing `amount: 3`. The wrapper would have been
 * a migration of the whole fixture corpus in exchange for nothing.
 *
 * ## Why the generator never sees it
 *
 * The amount is threaded into the effect union as a type parameter, exactly as
 * the target spec already is, so `ModelEffectSchema` passes `z.int()` and its
 * JSON Schema is byte-identical to what every recorded fixture was keyed
 * against. That is the whole reason the general shape is *cheaper* than a
 * special case at one field: a narrow change inside the shared factory would
 * have leaked into the model's schema and renamed every fixture.
 */
import { z } from 'zod';
import { CounterKindSchema } from './counters';
import { BasicLandTypeSchema, CardKindSchema } from './vocabulary';

/**
 * How many cards this resolution has exiled so far.
 *
 * "Exiled this way" in Magic's templating: the count belongs to one resolution
 * of one spell, so it is neither a property of the board nor of the card, and
 * it is why the kernel's evaluation needs a mark for where the resolution
 * began. Cards, not permanents: a token exiled by an earlier clause ceases to
 * be anything countable, and Magic's own wording says cards.
 */
export const ExiledThisResolutionSchema = z.strictObject({ kind: z.literal('exiledThisResolution') });

/**
 * How many permanents this resolution moved from the battlefield to exile.
 *
 * This is deliberately not `exiledThisResolution`: that amount prints
 * "cards exiled this way" and excludes tokens, while Mass Polymorph's "that
 * many" counts every creature the first clause exiled, tokens included. The
 * origin constraint also keeps a graveyard card exiled earlier in the same
 * resolution out of a count whose noun was permanents.
 */
export const PermanentsExiledThisResolutionSchema = z.strictObject({
  kind: z.literal('permanentsExiledThisResolution'),
});

/** Cards this resolution actually moved from its controller's graveyard into a library. */
export const CardsShuffledFromGraveyardThisResolutionSchema = z.strictObject({
  kind: z.literal('cardsShuffledFromGraveyardThisResolution'),
});

/**
 * The X chosen for the object on the stack whose effects are resolving.
 *
 * Two announcements produce that number and the printed sentence cannot tell
 * them apart, which is why this member names neither. A spell announces X as it
 * is cast (CR 601.2b); an activated ability announces it as it is activated (CR
 * 602.2b routes an activation through the same CR 601.2 steps), and both bank
 * the value on the `StackEntry` the resolution reads. Volcanic Geyser's "deals X
 * damage" and Silklash Spider's "deals X damage to each creature with flying"
 * are the same amount printed on two different objects, so a second member for
 * the activation would be a second name for one fact — and every reader of an
 * `Amount` would have to learn both to stay exhaustive.
 *
 * Which announcement a card is allowed to make is a *validation* question
 * rather than a shape one, and `validate/abilities.ts` and `validate/effects.ts`
 * hold it between them: a spell may read this only when its own mana cost
 * prints X, an activated ability only when `cost.mana.hasX` is set, and a
 * triggered ability never — it has no cost to announce anything against.
 */
export const ChosenXSchema = z.strictObject({ kind: z.literal('chosenX') });

/**
 * How many cards sit in a graveyard right now.
 *
 * CR 611.2c: nothing continuous reaches a graveyard, so this is not a
 * characteristic being read off a layer walk — it is a length, counted at
 * the moment the effect applies, off whichever graveyard `whose` names.
 * `'you'` is the controller's own, the templating every "cards in your
 * graveyard" card uses; `'each'` is both, for the templating a handful of
 * cards use instead ("the number of cards in all graveyards"). Not `PlayerId`
 * — this package does not depend on `@mtg/kernel` and never should
 * (`AGENTS.md`'s layering rule) — so the kernel resolves `'you'` against the
 * effect's own controller, exactly as `evaluateAmount` already resolves
 * `exiledThisResolution` against the trace it is given.
 */
export const CardsInGraveyardSchema = z.strictObject({
  kind: z.literal('cardsInGraveyard'),
  whose: z.enum(['you', 'each']),
});

/** The resolving object's controller's life total, read when the amount is used. */
export const ControllerLifeTotalAmountSchema = z.strictObject({
  kind: z.literal('controllerLifeTotal'),
});

/**
 * The characteristic predicate inside a battlefield count — CR 107.3h's
 * family of dynamic characteristics. "Gets -1/-1 until end of turn for each
 * Zombie you control" and "for each creature on the battlefield named X"
 * select different domains and apply the same predicate at the moment the
 * effect applies, the same timing `evaluateAmount` already gives
 * `exiledThisResolution`, just over a different span.
 *
 * Four constraint fields, all optional and all meaning "no constraint" when
 * absent — this package's own convention (`TargetSpecSchema`'s `distinct`,
 * `card.ts`'s own `subtypes`) rather than the kernel's `T[] | null`, because
 * `CountFilterSchema` is DSL-authored data and should read like every other
 * DSL shape. `packages/kernel/src/effects.ts` is the one place `undefined`
 * becomes `null` on the way to an `ObjectFilter`. `names` compares the current
 * layer-derived name. That differs deliberately
 * from `CardFilterSchema.names`, which searches hidden zones by printed name:
 * a battlefield count participates in CR 613 and therefore sees a copy effect
 * that changed the object's copiable name before the count is evaluated.
 * `keywordAbilities` is deliberately narrower than the card's full structured
 * keyword-ability vocabulary. Doorkeeper asks one exact question — whether a
 * creature has defender — and admitting parameterized abilities here would
 * require their parameters in both the printed phrase and Forge restriction.
 * The one-member list preserves the same list-shaped filter contract while
 * making duplicate or unsupported predicates structurally impossible.
 *
 * Which side is deliberately not a filter property. `CountMatchingSchema`
 * supplies "you control" or "on the battlefield", while its opponent-only
 * sibling is a separate computed amount. That keeps this record a predicate
 * over characteristics and lets every reader apply it to the domain its own
 * count selected.
 */
export const CountFilterSchema = z.strictObject({
  cardTypes: z.array(CardKindSchema).optional(),
  subtypes: z.array(z.string()).optional(),
  names: z.array(z.string().min(1)).min(1).optional(),
  keywordAbilities: z.array(z.literal('defender')).length(1).optional(),
});
export type CountFilter = z.infer<typeof CountFilterSchema>;

/** "Equal to the number of `filter`": a third `ComputedAmount`. */
export const CountMatchingSchema = z.strictObject({
  kind: z.literal('countMatching'),
  filter: CountFilterSchema,
  /** Absent is the historical "you control" reading; `each` opens the whole battlefield. */
  whose: z.enum(['you', 'each']).optional(),
  /** "Other": exclude the resolving ability or static effect's source object. */
  excludeSource: z.boolean().optional(),
});
export type CountMatching = z.infer<typeof CountMatchingSchema>;

/**
 * "The number of `filter` your opponents control" — `countMatching` read
 * across the table.
 *
 * A separate member rather than another `whose` value on `countMatching`, and
 * the difference is the clock. A one-shot amount is handed a resolved caster
 * and can call `opponentOf`; a continuous tally would need "opponent of the
 * source's current controller" inside the layer walk, which `ObjectFilter`
 * cannot express. Keeping the opponent-only reading out of
 * `PermanentTallySchema` makes that unsupported combination unconstructable.
 *
 * Plural "opponents" in the printed phrase, singular in the kernel: this is a
 * two-player engine, and `opponentOf` is total. The wording is Magic's own and
 * survives a multiplayer engine; the evaluation would need revisiting there,
 * which is true of `cardsInGraveyard`'s `'each'` too.
 */
export const CountMatchingOpponentSchema = z.strictObject({
  kind: z.literal('countMatchingOpponent'),
  filter: CountFilterSchema,
});

/**
 * "The number of permanents you control with one of these counters on them" —
 * `countMatching` narrowed by something that is not a characteristic.
 *
 * Two shapes in this vocabulary already read a counter and neither counts one.
 * `withCounter` (`targets.ts`) names one permanent by a counter it carries;
 * `anyCreatureHasCounter` (`condition.ts`) asks whether one exists anywhere on
 * the battlefield. Both are presence checks, and a mechanic built out of
 * counters needs a card that pays out per bearer, which is a count.
 *
 * ## Why a member and not a `counters` axis on `CountFilter`
 *
 * `CountMatchingOpponentSchema` above argues the analogous question for the
 * side of the table and lands on the amount, because the filter has six readers
 * and an amount has one. That argument holds here word for word, and it is the
 * weaker of the two available, so it is second.
 *
 * The first is that a counter is not a characteristic, and `CountFilter` exists
 * to compile into a shape that holds nothing else. Every seam that translates
 * it — `countMatching` (`kernel/src/effects.ts`), `tallyFilter`
 * (`kernel/src/abilities.ts`) — produces an `ObjectFilter`, and an
 * `ObjectFilter` is answered by `matchesFilter`, a pure function of
 * `Characteristics`. Counters are deliberately absent from `Characteristics`:
 * layer 7d derives power *from* the counters on an object, so asking the
 * derived characteristics for the counter that produced them is circular, and
 * `conditionHolds` and `satisfiesTargetRestriction` both already reach past the
 * layer walk to `state.objects` for exactly that reason. A `counters` field on
 * `CountFilter` would therefore be a constraint three translation seams could
 * not carry and `matchesFilter` would silently ignore — which is the failure
 * `targetObjectFilter`'s docblock names out loud when it drops `combat` rather
 * than pretending an `ObjectFilter` can hold it.
 *
 * `CountFilterSchema`'s own docblock does invite new axes: a color or keyword
 * constraint "is not here because no card has asked for one, and
 * `kernel/src/continuous.ts`'s `ObjectFilter` — which this compiles to — has
 * room to grow the day one does". The invitation is conditioned on that room,
 * and for a counter the room is not there. `ObjectFilter` could grow the field;
 * the function that reads an `ObjectFilter` could not grow the answer. Colors
 * and keywords are characteristics. A counter is an object sitting on top of
 * one.
 *
 * The price, stated rather than hidden: the narrowing this member does want is
 * a whole `CountFilter`, so "creatures you control with a horn counter" is two
 * nested shapes where an axis would have been one more field. That buys the
 * kernel one evaluation site per union instead of a field every `ObjectFilter`
 * consumer would have to be told to ignore.
 *
 * ## A list of kinds, and why it is not one kind
 *
 * `withCounter` and `anyCreatureHasCounter` each name exactly one kind, because
 * each printed card that asked for them named one. The card that asks for this
 * one names five: a "part" in the flagship set is any of `horn`, `wing`,
 * `talon`, `hide` or `fang`, and a payoff that read one of them would be a
 * payoff for a fifth of a mechanic. So the field is a list, read as "any of",
 * the way `CountFilter`'s own two lists are read — and a permanent carrying two
 * named counters is counted once, because this is a tally of permanents and not
 * of counters.
 *
 * There is no `part` grouping in `COUNTER_DECLARATIONS` to name instead, and
 * there should not be. `saberHorn` was renamed to `horn` (`counters.ts`)
 * precisely to keep one set's lore out of the engine's type system, and a
 * `part` group would put it straight back — it would also decide, in the DSL,
 * a question that belongs to whichever card is being written.
 *
 * Non-empty, because a list of no counters is a card that counts everything or
 * nothing depending on which reader answers it, and neither reading is a
 * sentence anybody meant to print.
 *
 * ## Which side of the table
 *
 * "You control", inherited rather than re-decided: the narrowing is a
 * `CountFilter`, and that shape is always the controller's own board for the
 * `STATIC_SCOPES` reason its docblock gives. The card that asks for this says
 * "you control" too. The other side would arrive the way it already did for
 * `countMatching` — as a sibling member, not as a field here.
 * `anyCreatureHasCounter` reading the whole battlefield is not a precedent
 * against that: it is a presence check, and nobody is being paid per permanent
 * it finds.
 */
export const CountWithCounterSchema = z.strictObject({
  kind: z.literal('countWithCounter'),
  filter: CountFilterSchema,
  counters: z.array(CounterKindSchema).min(1),
});

export type CountWithCounter = z.infer<typeof CountWithCounterSchema>;

/**
 * "The number of Swamps you control" — lands counted by basic land type.
 *
 * `countMatching` can already spell most of this: `derivedCharacteristics`
 * folds a basic land's `basicLandType` into its subtypes, so
 * `{ cardTypes: ['land'], subtypes: ['Swamp'] }` counts the Swamps on your
 * side today. Two things it cannot spell are why this is its own member.
 *
 * The first is `whose`. `CountFilter` structurally has no side, by the
 * decision its own docblock records, and "for each Swamp on the battlefield"
 * is a real templating a core set prints. The second is the subtype's type:
 * `CountFilter.subtypes` is `string[]`, so `'Swmap'` is a filter that parses,
 * validates and silently counts nothing forever, while `BasicLandTypeSchema`
 * is the five-member enum every other land-typed field in this package already
 * reads (`LandCardSchema.basicLandType`, `entersTappedUnlessControlsLandSubtype`).
 * A count that decides whether a Cabal Coffers is a rare or a blank is not a
 * place to accept a free string.
 */
export const LandsWithSubtypeSchema = z.strictObject({
  kind: z.literal('landsWithSubtype'),
  subtype: BasicLandTypeSchema,
  whose: z.enum(['you', 'each']),
});

/**
 * The greatest power among the permanents `among` names, or 0 when it names
 * none.
 *
 * A reduction rather than a tally, which is the whole reason it is its own
 * member and not a flag on `countMatching`: every other board-reading member
 * here answers "how many", and `max` of an empty set is not `0` for the same
 * reason `count` of one is. Magic settles that explicitly — CR 107.3 reads a
 * greatest-value quantity over an empty set as 0 — so the kernel returns 0
 * and the card that says "create X 1/1 tokens" creates none.
 *
 * `among` is a `CountFilter`, so it is "you control" by that filter's own
 * decision, and both printed cards this slice reads (Overwhelming Stampede,
 * Fungal Sprouting) say exactly that. It is *not* on `PermanentTallySchema`
 * below: "for each greatest power among creatures you control" is not a
 * sentence, and a schema that admits one is a schema a validator has to
 * un-admit afterwards.
 */
export const GreatestPowerAmongSchema = z.strictObject({
  kind: z.literal('greatestPowerAmong'),
  among: CountFilterSchema,
});

/**
 * How much damage this resolution has dealt so far — "the damage dealt this
 * way", the second half of Corrupt.
 *
 * `exiledThisResolution`'s sibling in every structural respect: a span of the
 * event log rather than a state of the board, marked from where the resolution
 * began, and meaningless outside one. It is a separate member rather than a
 * re-read of the first clause's amount because the two are not equal in this
 * kernel and the difference is reachable today. `damagePrevented`
 * (`kernel/src/damage.ts`) and the CR 614 `multiplyDamage` replacement
 * (`kernel/src/replacement.ts`) both exist, so a Corrupt cast into a Furnace of
 * Rath deals twice the Swamps and must gain twice the Swamps, and one cast at a
 * creature with the damage prevented gains nothing. Counting the Swamps a
 * second time gets both wrong silently; reading the damage the log actually
 * reports gets both right by construction.
 */
export const DamageDealtThisResolutionSchema = z.strictObject({
  kind: z.literal('damageDealtThisResolution'),
});

/**
 * How much life an earlier life-loss instruction in this resolution actually
 * made players lose — "the life lost this way", the second half of Blood
 * Tithe.
 *
 * This reads the emitted result rather than the earlier instruction's printed
 * amount. That distinction keeps the two clauses linked if the life-loss
 * machinery ever gains a replacement and also makes the amount additive for a
 * multiplayer sweep. Damage is excluded: it changes a life total, but Forge's
 * `AFLifeLost` protocol and Blood Tithe both bind this phrase to `LoseLife`,
 * not to every negative life change in the resolution.
 */
export const LifeLostThisResolutionSchema = z.strictObject({
  kind: z.literal('lifeLostThisResolution'),
});

/**
 * The toughness of the one creature an earlier effect in this resolution
 * targeted — Condemn's "its toughness".
 *
 * This is deliberately not a live battlefield count. The earlier instruction
 * may move the creature before this amount is read, so the kernel snapshots
 * the layer-derived value while it plans resolution, at the same CR 608.2b
 * point where it rechecks the target. The list validator requires exactly one
 * earlier creature chooser; the card therefore carries neither an object id
 * nor an effect index that could drift away from its printed antecedent.
 */
export const ThatCreatureToughnessSchema = z.strictObject({
  kind: z.literal('thatCreatureToughness'),
});

/**
 * The power of the creature retained by the event that created this trigger.
 *
 * This amount is engine-only because it has no meaning on a spell, activation,
 * state trigger, or trigger condition that retains no creature. The ability
 * validator enforces that placement; the kernel reads the same battlefield
 * incarnation live when it remains and departure LKI otherwise.
 */
export const TriggeringCreaturePowerSchema = z.strictObject({
  kind: z.literal('triggeringCreaturePower'),
});

/**
 * The toughness of the creature retained by the event that created this trigger.
 *
 * The live-or-LKI and generator-boundary contract is identical to
 * `TriggeringCreaturePowerSchema`; this sibling exists because power and
 * toughness can diverge independently before the trigger resolves.
 */
export const TriggeringCreatureToughnessSchema = z.strictObject({
  kind: z.literal('triggeringCreatureToughness'),
});

/** The final post-replacement damage amount retained by this trigger event. */
export const TriggeringDamageAmountSchema = z.strictObject({
  kind: z.literal('triggeringDamageAmount'),
});

/** Number of this cast spell's colors shared with its source object's retained entry choice. */
export const TriggeringSpellChosenColorCountSchema = z.strictObject({
  kind: z.literal('triggeringSpellChosenColorCount'),
});

/**
 * The layer-derived power of the permanent sacrificed as this spell's
 * additional cost.
 *
 * This is last-known information fixed while the cost is paid, not a live
 * battlefield read: the permanent is already in its owner's graveyard before
 * the spell reaches the stack. The spell-cost seam retains the number on the
 * stack object, and effect application is the only reader. Keeping the amount
 * hand-authored prevents the generator from producing a value whose required
 * payment it cannot describe.
 */
export const PaidSacrificePowerSchema = z.strictObject({
  kind: z.literal('paidSacrificePower'),
});

/** Layer-derived toughness of the sole permanent sacrificed as a spell or ability cost. */
export const PaidSacrificeToughnessSchema = z.strictObject({
  kind: z.literal('paidSacrificeToughness'),
});

/** Mana value of the sole card discarded as this activated ability's cost. */
export const PaidDiscardManaValueSchema = z.strictObject({
  kind: z.literal('paidDiscardManaValue'),
});

/**
 * The layer-derived power of the one permanent sacrificed by an earlier
 * instruction in this resolution.
 *
 * Unlike `paidSacrificePower`, this value is chosen while the spell or ability
 * is resolving. The kernel snapshots it immediately before the zone move, so
 * later instructions can read last-known information after the permanent (or
 * token) has left the battlefield. List validation requires exactly one
 * earlier one-permanent sacrifice, leaving the amount with one unambiguous
 * antecedent. It remains hand-authored, outside the shared model vocabulary.
 */
export const SacrificedPermanentPowerThisResolutionSchema = z.strictObject({
  kind: z.literal('sacrificedPermanentPowerThisResolution'),
});

/**
 * Half the chosen player's library size, rounded down at resolution.
 *
 * The player is deliberately not stored in the amount. It is the player in
 * the enclosing effect's target slot, so retaining a second selector here
 * would admit two disagreeing answers to one printed "their". Validation
 * limits the amount to a player-targeted mill effect, and the kernel reads the
 * live library after CR 608.2b has rechecked that target.
 */
export const HalfTargetLibraryRoundedDownSchema = z.strictObject({
  kind: z.literal('halfTargetLibraryRoundedDown'),
});

/**
 * The mana value of the one card an earlier instruction revealed from the top
 * of this controller's library and moved to their hand.
 *
 * This is a resolution-scoped referent rather than a live zone query. The card
 * is no longer in the library when a later instruction reads the amount, and a
 * second card may now occupy the top. The kernel therefore reads the reveal
 * event emitted by the earlier instruction and follows that physical card's
 * stable object id across the CR 400.7 zone change. Validation requires one
 * earlier `revealTopCardToHand` writer, so there is no authored id or effect
 * index that can drift from the printed "its".
 *
 * Hand-authored only by containment: `ModelEffectSchema` still supplies plain
 * integers to the shared effect factories and never imports this member.
 */
export const RevealedCardManaValueThisResolutionSchema = z.strictObject({
  kind: z.literal('revealedCardManaValueThisResolution'),
});

/**
 * The CR 613 reading's vocabulary: the members that name a standing fact about
 * the battlefield, so asking them again at an arbitrary later moment is a
 * well-formed question.
 *
 * The argument for splitting this out of `ComputedAmount` rather than tagging
 * one union with a clock is this file's own header, which is where the two
 * readings are settled. What that argument leaves to be said here is which
 * members are in and which are out, and why the two exclusions are exclusions
 * rather than oversights.
 *
 * `cardsInGraveyard` is out because the kernel's CR 613 machinery cannot read
 * it. A layer-7 count resolves through `PtCount`
 * (`kernel/src/continuous.ts`), whose graveyard arm counts *distinct card
 * types* — Tarmogoyf's question, not "how many cards" — so admitting the
 * member here would be admitting a shape the layer walk has no arm for.
 *
 * `countMatchingOpponent` is out for the neighboring reason. A static's filter
 * is resolved live against whoever currently controls the source
 * (`ObjectFilter`'s `controllerIsSource`), and there is no "the opponent of
 * whoever currently controls the source" spelling of that field. A one-shot
 * amount has no such problem because it is handed a resolved `PlayerId` and
 * `opponentOf` is total, which is exactly why the member sits on the union
 * that is read once and not on this one.
 *
 * `greatestPowerAmong` is out because it is not a tally at all, and "for each
 * greatest power among creatures you control" is not a sentence.
 *
 * `countWithCounter` is in, and it is the member that costs the layer walk
 * something. The other two tallies resolve to an `ObjectFilter` and are
 * answered by `matchesFilter` off the characteristic map; this one has to reach
 * past that map to the counters on the objects themselves, which is why
 * `PtCount` grows an arm for it rather than `ObjectFilter` growing a field.
 * That reach is safe in the direction it is made — the count reads counters and
 * layer 7d reads counters, and neither reads the other — and unsafe in the
 * direction nobody may make it, which is a filter asking the layer output for
 * the counter that produced it.
 *
 * ## Two clocks read this union, and that is not a contradiction
 *
 * `RatePerSchema` below charges a rate per one of these tallies and is read
 * exactly once, as a spell resolves. So the union is no longer "the members a
 * layer walk may re-ask" but "the members that name a group of permanents", and
 * the CR 613 half of that is a *reason* three members are in rather than the
 * boundary itself — a shape safe to re-ask is safe to ask once. The three
 * exclusions above survive both readings, though not all for one reason.
 * `cardsInGraveyard` names cards in a zone no permanent is in, and
 * `greatestPowerAmong` is a reduction rather than a tally, so neither is a
 * group a rate could be charged per under any clock. `countMatchingOpponent` is
 * the one whose exclusion is the layer walk's alone — a rate read once is
 * handed a resolved `PlayerId`, so "for each creature your opponents control
 * until end of turn" is a sentence this reader could answer. It stays out
 * because a member here answers to both readers and the layer walk still cannot
 * spell it, and because no card in this corpus prints it.
 */
export const PermanentTallySchema = z.discriminatedUnion('kind', [
  CountMatchingSchema,
  CountWithCounterSchema,
  LandsWithSubtypeSchema,
]);

export type PermanentTally = z.infer<typeof PermanentTallySchema>;
/**
 * The computed half, as its own union so the readers can switch on `kind` and
 * stay exhaustive.
 *
 * The two exile counts, `damageDealtThisResolution`, and
 * `lifeLostThisResolution` count a resolution-scoped span of the event log;
 * `chosenX` reads the announcement
 * that put the object on the stack, whether that was a cast or an activation;
 * every other member reads the board (a zone off the
 * battlefield, and the battlefield itself), as a tally or, for
 * `greatestPowerAmong`, as a reduction. `countWithCounter` is the one member
 * that reads something the battlefield's *characteristics* do not hold, and its
 * own docblock argues why that makes it a member here rather than a field on
 * `CountFilter`. All of them are evaluated against the
 * game as it stands at the moment the effect applies (`evaluateAmount`'s own
 * docblock), never a property of the card printing them — which is CR 609.2,
 * and is the half of the reading the header's argument pairs
 * against CR 613.
 */
function computedAmountOptions() {
  return [
    ExiledThisResolutionSchema,
    PermanentsExiledThisResolutionSchema,
    CardsInGraveyardSchema,
    ControllerLifeTotalAmountSchema,
    CountMatchingSchema,
    ChosenXSchema,
    CountMatchingOpponentSchema,
    CountWithCounterSchema,
    LandsWithSubtypeSchema,
    GreatestPowerAmongSchema,
    DamageDealtThisResolutionSchema,
    LifeLostThisResolutionSchema,
    ThatCreatureToughnessSchema,
    HalfTargetLibraryRoundedDownSchema,
  ] as const;
}

/** The frozen amount vocabulary shared with generator-facing effect factories. */
export const SharedComputedAmountSchema = z.discriminatedUnion('kind', computedAmountOptions());

export const SharedAmountSchema = z.union([z.int(), SharedComputedAmountSchema]);

/** Executable card vocabulary, isolated from the frozen generator schemas. */
export const ComputedAmountSchema = z.discriminatedUnion('kind', [
  ...computedAmountOptions(),
  CardsShuffledFromGraveyardThisResolutionSchema,
  PaidSacrificePowerSchema,
  PaidSacrificeToughnessSchema,
  PaidDiscardManaValueSchema,
  SacrificedPermanentPowerThisResolutionSchema,
  RevealedCardManaValueThisResolutionSchema,
  TriggeringCreaturePowerSchema,
  TriggeringCreatureToughnessSchema,
  TriggeringDamageAmountSchema,
  TriggeringSpellChosenColorCountSchema,
]);

export const AmountSchema = z.union([z.int(), ComputedAmountSchema]);

export type ComputedAmount = z.infer<typeof ComputedAmountSchema>;
export type Amount = z.infer<typeof AmountSchema>;

/**
 * A delta charged *per* permanent the tally names, read once — "-1/-1 until end
 * of turn for each Swamp you control" (Mutilate, M13 102).
 *
 * ## Why it is not `statBonusPer`
 *
 * The two records hold the same two things, a signed per-unit number and a
 * `PermanentTally`, and they are still different vocabulary because the clock
 * is different and the clock is the card. `statBonusPer` (`ability-shape.ts`)
 * is a layer-7c modification: the kernel multiplies the rate by the tally
 * *every time it walks the layers*, so Earth Servant shrinks the moment a
 * Mountain leaves. Mutilate is CR 609.2 — the count is taken as the spell
 * resolves and the modification it creates does not move again, so a Swamp
 * sacrificed in response to the deaths it caused takes nothing back.
 *
 * Collapsing them into one kind would leave that difference to whoever reads
 * the record next, decided by where the record happens to sit. This file's
 * header is an argument against exactly that, and `PermanentTallySchema`'s
 * docblock is the same argument from the CR 613 side: two readings, two
 * unions, and a reader that holds one of them can never be handed the other.
 *
 * ## Why the multiplicand is a `PermanentTally` and not a `ComputedAmount`
 *
 * A rate is charged per *thing on the battlefield*, and `PermanentTally` is
 * already the name of that group. Resolution spans, retained targets, cast
 * choices, hidden-zone lengths, and opponent-only readings name no such group.
 * "For each card exiled this way" is not a printed frame, and a rate over
 * `chosenX` is a second spelling of a number the caster already chose.
 *
 * Board-reading members `PermanentTally` excludes are excluded for reasons
 * that belong to the layer walk rather than to this reading, so the day a card
 * prints "for each card in your graveyard" the answer is a member on that
 * union with its CR 613 arm argued, not a second tally vocabulary here.
 *
 * ## Where it may be printed
 *
 * One slot: `pumpUntilEndOfTurn`'s `power` and `toughness`, through
 * `PumpAmountSchema` below. That is a schema boundary rather than a validator
 * rule on purpose — `AuraStaticModificationSchema` makes the same choice for
 * the same reason — because admitting a rate into every numeral slot would
 * leave `dealDamage`, `drawCards` and `gainLife` each holding an arm no valid
 * card can reach, and the "twice the number of Swamps you control" frame those
 * slots would need is a printed sentence nothing in this corpus asks for.
 */
export const RatePerSchema = z.strictObject({
  kind: z.literal('ratePer'),
  rate: z.int(),
  each: PermanentTallySchema,
});

export type RatePer = z.infer<typeof RatePerSchema>;

/**
 * What a one-shot P/T change may print: any `Amount`, or a rate charged per
 * board count.
 *
 * A union of its own rather than a widening of `AmountSchema`, for the reason
 * `RatePerSchema` just gave, and threaded into the effect union exactly as the
 * keyword rider is: `CardEffectSchema` passes this and every model-facing tier
 * passes `z.int()`, so the JSON Schema the generator is shown is byte-identical
 * to the one it was shown before this existed and no recorded fixture is
 * re-keyed (`packages/llm/src/schema.ts` hashes the answer schema).
 */
export const PumpAmountSchema = z.union([AmountSchema, RatePerSchema]);

export type PumpAmount = z.infer<typeof PumpAmountSchema>;

/** True when the card prints a numeral rather than a quantity to be counted. */
export function isLiteralAmount(amount: PumpAmount): amount is number {
  return typeof amount === 'number';
}

/**
 * True when the printed quantity is a rate charged per board count.
 *
 * Written over `PumpAmount` rather than over `RatePer` alone so a caller
 * holding either union can ask; every reader that has only an `Amount` gets
 * `false` for free, which is the truth — `AmountSchema` cannot carry one.
 */
export function isRateAmount(amount: PumpAmount): amount is RatePer {
  return typeof amount === 'object' && amount.kind === 'ratePer';
}

/**
 * The number a static reader should assume, given one it cannot compute.
 *
 * Deliberately not a default that hides the difference: callers pass the
 * assumption they are willing to name, and every call site that does is a place
 * where a documented weight sits beside it. Nothing in this package calls it —
 * it exists so the two evaluators outside the engine (`@mtg/deckbuild`'s card
 * score, `@mtg/sim`'s targeting policy) reach for one spelling of the same
 * compromise rather than two.
 */
export function amountOrAssume(amount: PumpAmount, assumed: number): number {
  if (isLiteralAmount(amount)) return amount;
  // A rate multiplies the assumption rather than replacing it: "-1 for each
  // Swamp" and "-3 for each Swamp" are the same board away from being three
  // times apart, and an evaluator that answered the assumption for both would
  // price them identically. The tally is still the number nobody outside the
  // kernel can know, so it is still the assumption that stands in for it.
  return isRateAmount(amount) ? amount.rate * assumed : assumed;
}
