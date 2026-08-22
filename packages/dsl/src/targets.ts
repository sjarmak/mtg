/**
 * Targeting specs, restricted to the pinned targeting vocabulary.
 *
 * The schema accepts every target kind for every targeted effect on purpose:
 * per-effect legality is a *structural validator* concern
 * (`ILLEGAL_TARGET_FOR_EFFECT`), so a mis-targeted generated card produces an
 * actionable violation instead of an opaque union parse error.
 *
 * `distinct` is a constraint on the choice, not another kind: the kind says
 * which space a target is drawn from, `distinct` says this slot may not reuse a
 * target the same spell has already chosen. Keeping it off `TARGET_KINDS` is
 * what lets `LEGAL_TARGETS`, `FORGE_VALID_TARGETS` and every other table keyed
 * by kind stay the size they are instead of doubling.
 *
 * `ModelTargetSpecSchema` is the same object without that field. It is the
 * shape `@mtg/setgen` shows the model, and it exists because a field the prompt
 * has not taught is a field the model would fill in by guessing.
 *
 * `restriction` is the second constraint of the same kind, added for `mtg-3zjg`.
 * It narrows *which* object in the kind's space may be named — "target creature
 * with power 3 or less", "target tapped creature", "target creature with flying"
 * — and it is a field rather than six new kinds for the reason `distinct` is:
 * every table in this repo keyed by `TargetKind` (`LEGAL_TARGETS`,
 * `FORGE_VALID_TARGETS`, `TARGET_SPACES`, the oracle's switch) would otherwise
 * multiply by the number of restrictions, and each of them would have to answer
 * a question about the space that the space has already answered.
 *
 * A restriction is legal only on a slot that names a creature. The other kinds
 * have nothing to restrict: a player has no power and no keywords, `noTarget`
 * names no object, and `triggeringCreature` is a referent retained from an event
 * rather than a choice, so narrowing it would mean a trigger that sometimes has
 * no referent at all. `restrictionFitsTargetKind` is that rule, and
 * `ILLEGAL_TARGET_RESTRICTION` is the violation the validator raises.
 *
 * `withCounter` is the seventh member, and it is the one that reads state the
 * other six do not: a counter is stored on the object rather than derived from
 * it, so "target creature with a gloom counter on it" asks a question no power,
 * tap state or keyword can answer. the flagship set mints six cards' worth of
 * gloom counters and prints nothing that reads one, which made the counter pure
 * attrition on a shared board; this is the word that lets a card point at it.
 * There is no `withoutCounter` beside it for the reason there is no seventh
 * target kind nobody asked for: a member arrives with the card that needs it,
 * and an untested branch shipped on speculation is a branch that is wrong the
 * first time somebody uses it.
 *
 * `filter` is the third constraint of the same kind, added for `mtg-6y4g`, and
 * it is where a narrowing goes when it reads a *characteristic* rather than a
 * state: card type, excluded card type, color, excluded color, and the one
 * combat status a printed card names. It is a field beside `restriction`
 * rather than seven more restriction members because the two are answered by
 * different machinery and at different depths — `satisfiesTargetRestriction`
 * reads one permanent through the layer system one question at a time, and a
 * filter compiles to a kernel `ObjectFilter` and is answered by `matchesFilter`,
 * the same function the CR 613 layer walk uses for an anthem's scope. Folding a
 * card type into `TargetRestriction` would mean a second evaluator for a
 * question the kernel already answers, and the two would eventually disagree.
 *
 * The two constraints compose, and CR 608.2b rechecks both: "destroy target
 * attacking creature with power 3 or less" is one filter and one restriction on
 * one slot, and a creature that stops attacking or grows past 3 between the
 * choice and the resolution has stopped being a legal target either way.
 *
 * The flag is `literal(true)`, not `boolean`, because `distinct: false` and an
 * absent `distinct` are the same card and one card must have one encoding.
 * `checkDuplicateEffects` compares effects by `canonicalJson`, so a second
 * spelling of "no constraint" is a way to write a byte-identical repeat that
 * does not compare byte-identical: `[destroyPermanent, destroyPermanent{
 * distinct: false}]` would print "Destroy target creature." twice and let the
 * kernel aim both at one body. Rejecting the redundant spelling at the schema
 * closes that for hand-authored DSL and for JSON alike, and matches how the
 * validator already treats other no-op encodings such as a +0/+0 pump.
 *
 * `count` is the fourth constraint, added for `mtg-kg44`, and unlike the other
 * three it does not narrow which object a slot may name — it says how many
 * objects one slot names at once. Magic prints two templates for a plural
 * target: "target creature and target creature" (each slot chosen and
 * rechecked independently — already expressible here as two effects each
 * carrying `distinct: true`) and "up to two target creatures" (one slot, one
 * choice of zero to two, chosen and rechecked together). The schema only needs
 * the second: the first was already reachable, and reaching for `count` to
 * re-express "exactly two" would be a second spelling of the two-effect form
 * with none of its independence — CR 608.2b lets a spell with two separately
 * chosen targets lose one to an intervening removal and keep affecting the
 * other, and two effects already give that; one slot holding two
 * locked-together choices would not, and nothing has asked for it to. So
 * `count` is "up to N": the field's presence alone means optional, and the
 * card that motivated it needs exactly that — "tap up to two target
 * creatures" is castable with one legal creature on the board, or none, where
 * two mandatory targets would not be.
 *
 * The value was `literal(2)` until `mtg-hgmz`, pinned the way `distinct` is
 * pinned to `literal(true)`, on the argument that two was the only count any
 * printed card in this vocabulary needed and a third would arrive with the
 * card that needed it. The card arrived: Downpour (M13 48, common) is "Tap up
 * to three target creatures", it is one of the M11/M13 identities the coverage
 * sweep refused, and it is the only three-target *slot* in that population of
 * 305 (Squadron Hawk's "up to three cards named Squadron Hawk" is a library
 * search and not a target).
 *
 * So the field is a bounded integer now, and the bound is counted rather than
 * guessed. Across the 38,623-card store, "tap up to N target" — the one
 * template this field can reach, since `TARGET_COUNT_EFFECT_KINDS` gates it to
 * `tapPermanent` — prints N as two 47 times, three 10, four 7, five once, and
 * never higher; four more print X, which is an `Amount` and a different
 * decision. `MAX_TARGET_COUNT` is therefore five: a ceiling drawn where the
 * printed corpus stops, which is `MAX_TARGET_RESTRICTION_POWER`'s reasoning
 * ("a bound nobody can reach is not a bound") rather than the pin's. The floor
 * is two because a counted slot is the *plural* template; "up to one target
 * creature" is a different printed sentence and nothing here asks for it.
 *
 * Nothing downstream had to move for the widening: `countedTargetPhrase`
 * already spelled the number through `numberWord`, and the kernel already read
 * the value rather than the literal (`subsetsUpToSize(candidates, count, cap)`
 * in `legal.ts`, `members.length > count` in `validateCast`).
 *
 * `count` is legal only where `distinct` is not, and only on a slot whose kind
 * is `targetCreature`: the two constraints answer the same question — how
 * many objects does this slot pick — for a slot that has answered "one" as a
 * matter of course since `TARGET_KINDS` was first written, so a slot carrying
 * both would be answering it twice and could disagree with itself.
 * `TARGET_COUNT_EFFECT_KINDS` in `@mtg/dsl`'s `effects.ts` gates which effect
 * kinds may carry it at all, the same way `SOURCE_BODY_EFFECT_KINDS` gates
 * `fight`: a count is meaningful only where the kernel already knows how to
 * fold N objects into one effect application, and today that is
 * `tapPermanent` alone. `ModelTargetSpecSchema` carries neither `distinct` nor
 * `count` for the same reason: a field the prompt has not taught is a field
 * the model would fill in by guessing, and this one gates castability itself
 * rather than merely narrowing a space, which makes a guessed value worse than
 * an absent one.
 */
import { z } from 'zod';
import { CounterKindSchema } from './counters';
import {
  CardKindSchema,
  ColorSchema,
  KeywordSchema,
  ModelTargetKindSchema,
  TargetCombatRoleSchema,
  TargetKindSchema,
} from './vocabulary';

/**
 * How much power a restriction may name.
 *
 * Twelve because the largest creature this vocabulary can print is well inside
 * it and a bound nobody can reach is not a bound. `minPower` starts at 1 rather
 * than 0: "power 0 or greater" is every creature, which is a card written as
 * though it had a restriction and played as though it did not, and one card must
 * have one encoding. `maxPower` starts at 0, where "power 0 or less" really is a
 * narrower space than "any creature".
 */
export const MAX_TARGET_RESTRICTION_POWER = 12;

export const TargetRestrictionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('maxPower'),
    power: z.number().int().min(0).max(MAX_TARGET_RESTRICTION_POWER),
  }),
  z.strictObject({
    kind: z.literal('minPower'),
    power: z.number().int().min(1).max(MAX_TARGET_RESTRICTION_POWER),
  }),
  z.strictObject({ kind: z.literal('tapped') }),
  z.strictObject({ kind: z.literal('untapped') }),
  z.strictObject({ kind: z.literal('withKeyword'), keyword: KeywordSchema }),
  z.strictObject({ kind: z.literal('withoutKeyword'), keyword: KeywordSchema }),
  z.strictObject({ kind: z.literal('withCounter'), counter: CounterKindSchema }),
]);

export type TargetRestriction = z.infer<typeof TargetRestrictionSchema>;
export type TargetRestrictionKind = TargetRestriction['kind'];

/**
 * Which object in the slot's space may be named, stated as characteristics
 * rather than as a kind.
 *
 * This is the DSL half of `@mtg/kernel`'s `ObjectFilter` (`continuous.ts`), and
 * it is deliberately a *subset* of it rather than a second filter type: every
 * field here is named after the `ObjectFilter` field it compiles to, and
 * `@mtg/kernel`'s `target-filter.ts` is the one place the translation happens —
 * `undefined` becomes `null` ("no constraint") — exactly as `countMatching`
 * already translates `CountFilterSchema`. The kernel evaluates the result with
 * `matchesFilter`, the same function the CR 613 layer walk uses, so a card that
 * says "black creature" and an anthem that says "black creature" cannot come to
 * different conclusions about one body. A second evaluator here would be a
 * second chance to disagree.
 *
 * Optional fields rather than the kernel's `T[] | null`, for
 * `CountFilterSchema`'s reason at the same seam: this is DSL-authored data and
 * should read like every other DSL shape, and the record stays free of `null`
 * so it canonicalizes and clones the way a card does.
 *
 * Eight fields, and each one arrived with printed cards in the M11/M13
 * population (`mtg-6y4g`, `mtg-nhyv.2` for the sixth, `mtg-nhyv.56` for the
 * seventh, `mtg-nhyv.62` for the eighth):
 *
 *   `cardTypes`         Craterize, Demolish, Acidic Slime, Erase, Smelt
 *   `allCardTypes`      Steel Overseer ("each artifact creature you control")
 *   `excludeCardTypes`  Bramblecrush, and Negate on the stack side
 *   `subtypes`          Arbor Elf ("untap target Forest"), Merfolk Sovereign
 *   `colors`            Celestial Purge, Deathmark, Flashfreeze
 *   `excludeColors`     Doom Blade ("destroy target nonblack creature")
 *   `keywords`          Silklash Spider ("each creature with flying")
 *   `combat`            Divine Verdict, Infantry Veteran
 *
 * **`allCardTypes` is a second field rather than a new meaning for the first**,
 * and the two say opposite things about the same dimension because Magic asks
 * both. `cardTypes` is read with `anyOf`, so Demolish's `['artifact', 'land']`
 * is "artifact or land" — the printed sentence, and the one every committed
 * card using the field relies on. Redefining it as a conjunction would turn
 * Demolish and Acidic Slime into slots no permanent can ever fill without
 * changing a byte of either card. `allCardTypes` is read with `every`, which is
 * "artifact creature": one object that is both.
 *
 * The asymmetry is not new here. `ObjectFilter`'s own docblock states it one
 * field over: `keywords` requires *all* of its values where every other list
 * requires *any*, because "creatures with flying and vigilance" and "creatures
 * that are green or white" are both common English on printed cards. Card
 * types are the second dimension that goes both ways, and this is the second
 * field.
 *
 * `min(2)` rather than `min(1)`: a one-element conjunction is a second spelling
 * of a one-element union, and one card must have one encoding for
 * `checkDuplicateEffects` to be able to compare two effects at all. The
 * validator refuses the two fields in one filter for the same reason.
 *
 * `subtypes` is the seventh field, and it arrived by correcting the finding
 * that used to stand here (`mtg-nhyv.56`). That paragraph read the
 * `mtg-ts5j.3.15` preflight as a census of the population and recorded that no
 * identity names a creature type or a land type in a target. The preflight was
 * a scoping note about *its own cohort* — the twenty-three named filtered-
 * battlefield-target cards that lane took — and it says so: "no named card uses
 * untap, subtype, or controller filters, so those were removed from scope."
 * Over the whole 305-identity M11/M13 population three identities name one:
 *
 *   Arbor Elf          "{T}: Untap target Forest."           a land type
 *   Merfolk Sovereign  "Target Merfolk creature can't ..."   a creature type
 *   Awakener Druid     "target Forest becomes a 4/5 ..."     a land type
 *
 * The old paragraph's objection was the real one, and the population answers
 * it rather than leaving it to a guess: Magic prints "destroy target Zombie"
 * and drops the noun, where every other arm of `targetNounPhrase` keeps it, and
 * the three cards above land on both sides of that. **The subtype prints where
 * the slot's noun comes from.** `targetPermanent` is the one kind whose noun
 * the filter supplies — that is `cardTypeFilterFitsTargetKind`'s whole rule, and
 * why Demolish prints "target artifact or land" and not "target artifact
 * permanent" — so on that kind the subtype supplies the noun and the noun is
 * dropped: "target Forest". On every other kind the *kind* fixed the noun by
 * being the kind it is and a filter can only qualify it, so the subtype is an
 * adjective in front: "target Merfolk creature". Both printed sentences come
 * out verbatim and no other arm of the noun phrase moves.
 *
 * A subtype and a card type in one filter are refused, which is what stops the
 * two positions from becoming two spellings of one slot. CR 205.3 gives each
 * subtype to exactly one card type, so "target Forest land" says the dimension
 * twice and names the same objects "target Forest" does, and one card must have
 * one encoding — `checkFilterLists` refuses the pair the way it already refuses
 * `cardTypes` beside `allCardTypes`.
 *
 * The values are free strings checked against `SUBTYPE_PATTERN` in the
 * validator rather than an enum, because `Card.subtypes` is (`validate/
 * typeline.ts`), and a filter that could not name a subtype a card in the same
 * set prints would be a narrower vocabulary than the cards it points at.
 * `ObjectFilter.subtypes` already existed and already folds a land's
 * `basicLandType` into it (CR 205.3i), so the kernel half of this field is the
 * one line in `target-filter.ts` that hands the list across.
 *
 * `keywords` is the eighth field, and it arrived because the paragraph that
 * used to stand here was half right (`mtg-nhyv.62`). It said the narrowing was
 * already expressible, because `TargetRestriction` above carries `withKeyword`
 * and `withoutKeyword` — true of a *target slot*, which is where Plummet and
 * Air Servant write it, and false of every group this filter also narrows. A
 * restriction rides on `TargetSpec`, a board sweep names `noTarget`, and
 * `checkTargetRestriction` refuses a restriction on that kind because it is not
 * a choice at all. So "{X}{G}{G}: This creature deals X damage to each creature
 * with flying" (Silklash Spider, M13 191) had no spelling anywhere, and neither
 * did "each creature with flying your opponents control" (Thundermaw Hellkite,
 * M13 150).
 *
 * The field is therefore admitted on a `scopeFilter` and refused on a target
 * slot and on a `spellFilter` (`checkTargetFilter`, `checkSpellFilter`), which
 * is the one arrangement that keeps one printed sentence to one encoding: with
 * both spellings reachable on one slot, "destroy target creature with flying"
 * would canonicalize two ways and `checkDuplicateEffects` compares effects by
 * `canonicalJson`. The stack refusal is the narrower of the two — nothing in
 * this population counters a spell by keyword, and CR 613 does not run on the
 * stack, so the word would mean *printed* flying there and current flying
 * everywhere else.
 *
 * Read conjunctively, which is `ObjectFilter.keywords`' own reading and the
 * reason this compiles to that field rather than to a new one: "creatures with
 * flying and vigilance" is what printed Magic means by a keyword list, where
 * "green or white creatures" is what it means by a color one. The kernel half
 * is one line in `target-filter.ts`, and it buys the CR 613 answer outright —
 * `matchesFilter` reads `characteristicsOf`, so a creature handed flying by an
 * Aura or an anthem is in the group, and `hasKeyword` (the evasion check in
 * `combat.ts`) reads the same walk. A second derivation of "does this creature
 * have flying" is a second chance to disagree with the blocking rules.
 *
 * There is no `excludeKeywords` beside it, and the reason is the subset rule at
 * the top of this docblock rather than a shortage of printed cards: Magmaquake
 * (M13 140) wants one, and `ObjectFilter` — the kernel filter this one is a
 * subset of — carries `keywords` and no negative twin. Adding the negation here
 * first would give the DSL a narrowing `matchesFilter` cannot answer, which is
 * the one direction this arrangement is built to refuse. The field belongs to
 * whichever lane widens `ObjectFilter`, and it lands in both files or neither.
 *
 * `supertypes`, `oids` and `controller` are absent because no card has asked:
 * `oids` is a runtime value no printed card can name, and control is already a
 * target *kind* (`targetCreatureYouControl`).
 */
export const TargetFilterSchema = z.strictObject({
  cardTypes: z.array(CardKindSchema).min(1).optional(),
  allCardTypes: z.array(CardKindSchema).min(2).optional(),
  excludeCardTypes: z.array(CardKindSchema).min(1).optional(),
  subtypes: z.array(z.string()).min(1).optional(),
  colors: z.array(ColorSchema).min(1).optional(),
  excludeColors: z.array(ColorSchema).min(1).optional(),
  keywords: z.array(KeywordSchema).min(1).optional(),
  combat: TargetCombatRoleSchema.optional(),
});

export type TargetFilter = z.infer<typeof TargetFilterSchema>;

/**
 * The largest "up to N target" a slot may name. See `TargetSpecSchema`'s
 * docblock for the count behind the number.
 */
export const MAX_TARGET_COUNT = 5;

export const TargetSpecSchema = z.strictObject({
  kind: TargetKindSchema,
  restriction: TargetRestrictionSchema.optional(),
  filter: TargetFilterSchema.optional(),
  distinct: z
    .literal(true, {
      error:
        '"distinct" is either set to true or left out; "false" is a second spelling of leaving it out, and one card must have one encoding',
    })
    .optional(),
  count: z
    .int()
    .min(2, {
      error:
        '"count" makes a slot read "up to N target creatures", which is the plural template; "up to one target creature" is a different sentence and an ordinary slot with no count is the mandatory-one one',
    })
    .max(MAX_TARGET_COUNT, {
      error: `"count" is bounded at ${String(MAX_TARGET_COUNT)}, the largest literal N printed Magic prints on the template this field is gated to; a bigger slot is an X, which is an Amount rather than this field`,
    })
    .optional(),
});

/**
 * The spec the generator answers with: the four frozen kinds, and no
 * `distinct`.
 *
 * It reads its own enum rather than `TargetKindSchema` for the reason
 * `MODEL_TARGET_KINDS` exists — a new engine kind must not reach the JSON
 * Schema every fill batch is shown, because a fixture key hashes that schema.
 */
export const ModelTargetSpecSchema = z.strictObject({ kind: ModelTargetKindSchema });

export type TargetSpec = z.infer<typeof TargetSpecSchema>;
export type TargetKind = TargetSpec['kind'];
export type ModelTargetSpec = z.infer<typeof ModelTargetSpecSchema>;
export type ModelTargetKind = ModelTargetSpec['kind'];

export const ANY_TARGET: TargetSpec = { kind: 'anyTarget' };
export const TARGET_CREATURE: TargetSpec = { kind: 'targetCreature' };
export const TARGET_PLAYER: TargetSpec = { kind: 'targetPlayer' };
export const NO_TARGET: TargetSpec = { kind: 'noTarget' };
export const TARGET_CREATURE_YOU_CONTROL: TargetSpec = { kind: 'targetCreatureYouControl' };
export const TARGET_OPPONENT: TargetSpec = { kind: 'targetOpponent' };
export const TRIGGERING_CREATURE: TargetSpec = { kind: 'triggeringCreature' };
export const TARGET_ARTIFACT_OR_ENCHANTMENT: TargetSpec = { kind: 'targetArtifactOrEnchantment' };
export const TARGET_CREATURE_YOU_DONT_CONTROL: TargetSpec = { kind: 'targetCreatureYouDontControl' };
export const TARGET_PERMANENT: TargetSpec = { kind: 'targetPermanent' };
export const TARGET_PLAYER_OR_PLANESWALKER: TargetSpec = { kind: 'targetPlayerOrPlaneswalker' };
export const SELF_CREATURE: TargetSpec = { kind: 'selfCreature' };
export const SELF_PERMANENT: TargetSpec = { kind: 'selfPermanent' };
export const THAT_CREATURE: TargetSpec = { kind: 'thatCreature' };
export const THAT_PLAYER: TargetSpec = { kind: 'thatPlayer' };
export const THAT_CREATURES_CONTROLLER: TargetSpec = { kind: 'thatCreaturesController' };

/**
 * The target kinds whose printed phrase has a referent only inside the combat
 * their source is attacking in, so they are legal on a triggered ability whose
 * condition is `selfAttacks` and nowhere else.
 *
 * One member, and it is a rule the two per-effect tables cannot express:
 * `LEGAL_TARGETS` and `HAND_AUTHORED_TARGETS` are keyed by effect kind and know
 * nothing about the ability printed around the effect. Stated here once so the
 * two validators that refuse the kind and the two instruments that enumerate
 * legal pairs (`@mtg/dsl-coverage`'s calibration corpus and its translation
 * prompt) read one sentence rather than four copies of a literal.
 */
export const ATTACK_TRIGGER_ONLY_TARGETS: readonly TargetKind[] = ['targetCreatureDefendingPlayerControls'];

/** True when this kind may be named only under a `selfAttacks` trigger. */
export function isAttackTriggerOnlyTarget(kind: TargetKind): boolean {
  return ATTACK_TRIGGER_ONLY_TARGETS.includes(kind);
}

/**
 * The target kinds whose printed phrase reads a permanent's own body, so they
 * are legal on a triggered or activated ability of a permanent and never on a
 * spell.
 *
 * Two members, and they differ only in which noun the phrase prints: "this
 * creature" for `selfCreature`, "this permanent" for `selfPermanent`
 * (`mtg-rji`). A spell's `sourceOid` is the spell object on the stack, never a
 * permanent on the battlefield, so either phrase printed on an instant has no
 * body to name — `checkEffectTarget`'s spell-path refusal reads this list and
 * names the kind it caught, rather than testing for one of them by hand, so
 * the refusal and the list cannot drift apart. Stated here once for the same
 * reason `ATTACK_TRIGGER_ONLY_TARGETS` is: `@mtg/dsl-coverage`'s calibration
 * corpus and its translation prompt both enumerate legal (effect, target) pairs
 * without knowing which of the three bodies they are about to print the pair
 * on, and a pair this narrow lands as `invalidDsl` there instead of as the
 * decline it should be. Unlike that list, this one names targets legal on *two*
 * of the corpus's three forms rather than none, so a reader filters them out of
 * the spell form specifically rather than out of the shared pairs list every
 * form draws from.
 */
export const SOURCE_BODY_ONLY_TARGETS: readonly TargetKind[] = ['selfCreature', 'selfPermanent'];

/** True when this target names a permanent's own body, illegal on a spell. */
export function isSourceBodyOnlyTarget(kind: TargetKind): boolean {
  return SOURCE_BODY_ONLY_TARGETS.includes(kind);
}

/**
 * The target kinds that name what an *earlier slot of the same effect list*
 * already chose, rather than choosing anything themselves (`mtg-nhyv.75`).
 *
 * Three members, and they divide into the two things a back-reference can do.
 * `thatCreature` and `thatPlayer` name the chosen object itself; the split
 * between them is the printed noun and nothing else, which is why Forge writes
 * both `Defined$ Targeted`. `thatCreaturesController` names a player derived
 * from a chosen permanent, which Forge writes `Defined$ TargetedController`,
 * and is the one that changes space between what was chosen and what is named.
 *
 * Listed here rather than derived from an empty `TARGET_SPACES` row, even
 * though all three have one: `triggeringCreature` and the two source-body kinds
 * have empty rows too and are not these — they retain a referent from outside
 * the effect list, so nothing about a sibling slot answers them. The empty row
 * is what they have in common, not what makes them referents, and deriving from
 * it would have made every future no-choice kind a back-reference by accident.
 *
 * Stated once for the reason `SOURCE_BODY_ONLY_TARGETS` is stated once: the
 * validator, the kernel's enumeration, its resolution recheck and the Forge
 * export all ask the same question, and four copies of a three-string literal
 * is four chances for a member added later to reach three of them.
 */
export const REFERENT_TARGETS: readonly TargetKind[] = [
  'thatCreature',
  'thatPlayer',
  'thatCreaturesController',
];

/** True when this kind names what an earlier slot of the same list chose. */
export function isReferentTarget(kind: TargetKind): boolean {
  return REFERENT_TARGETS.includes(kind);
}

/**
 * Which space the slot a referent points back at has to draw from.
 *
 * `'creature'` for both kinds whose phrase starts at a creature — the one that
 * names the creature and the one that names its controller — and `'player'`
 * for the one that names a chosen person. Returning `null` for every other kind
 * rather than throwing keeps this total over `TargetKind`, so the two callers
 * that walk an effect list (`referentSourceIndex` and the validator's
 * `checkReferentTargets`) test one value instead of asking twice whether the
 * kind is a referent at all.
 */
export function referentSourceSpace(kind: TargetKind): 'creature' | 'player' | null {
  if (kind === 'thatCreature' || kind === 'thatCreaturesController') return 'creature';
  if (kind === 'thatPlayer') return 'player';
  return null;
}

/**
 * The kinds a restriction may narrow: the three that name a creature.
 *
 * Derived from `TARGET_SPACES` rather than listed, so a creature kind added
 * later is restrictable the day it is added and a player kind never is. The
 * kinds that draw from no space at all — `noTarget`, `triggeringCreature` and
 * the two source-body kinds — fall out of this by drawing from nothing, which
 * is the right answer for all of them and for the same reason: none is a
 * choice among objects, so there is no choice to narrow.
 */
export function restrictionFitsTargetKind(kind: TargetKind): boolean {
  return targetKindNamesACreature(kind);
}

/** The restriction on this slot, or `null` when it names any object in its space. */
export function targetRestrictionOf(spec: TargetSpec): TargetRestriction | null {
  return spec.restriction ?? null;
}

/** The filter on this slot, or `null` when it names any object in its space. */
export function targetFilterOf(spec: TargetSpec): TargetFilter | null {
  return spec.filter ?? null;
}

/** True when this filter states no constraint at all, which is a second spelling of no filter. */
export function targetFilterIsEmpty(filter: TargetFilter): boolean {
  return (
    filter.cardTypes === undefined &&
    filter.allCardTypes === undefined &&
    filter.excludeCardTypes === undefined &&
    filter.subtypes === undefined &&
    filter.colors === undefined &&
    filter.excludeColors === undefined &&
    filter.keywords === undefined &&
    filter.combat === undefined
  );
}

/**
 * The kinds a filter may narrow: the ones that draw from objects and only from
 * objects.
 *
 * Derived from `TARGET_SPACES` rather than listed, the way
 * `restrictionFitsTargetKind` is. A player has no card type, no subtype and no
 * color, so every player-naming kind falls out — including the two that draw
 * from both spaces at once, `anyTarget` and `targetPlayerOrPlaneswalker`. Those
 * two are the interesting refusal: a filter on them would narrow the object
 * half of the space and say nothing about the player half, which is a card that
 * enforces its printed condition against some of its own legal targets and not
 * the rest. The kinds that draw from nothing — `noTarget` and
 * `triggeringCreature` — fall out by drawing from nothing, for
 * `restrictionFitsTargetKind`'s reason: neither is a choice among objects, so
 * there is no choice to narrow.
 */
export function filterFitsTargetKind(kind: TargetKind): boolean {
  const spaces = TARGET_SPACES[kind];
  return spaces.length > 0 && !spaces.includes('player');
}

/**
 * The kinds a *card-type* constraint may narrow.
 *
 * One member, listed rather than derived from `TARGET_SPACES` the way the two
 * predicates above are, and the reason is that `TARGET_SPACES` answers a
 * different question. Its members are a collision alphabet for `distinct` and
 * deliberately over-state overlaps (see its docblock), so "how many spaces does
 * this kind draw from" is not the same question as "has this kind already fixed
 * its card types". `targetArtifactOrEnchantment` draws from two entries and has
 * fixed its card types completely; `targetPermanent` draws from four and has
 * fixed none. Deriving from a count would have made a sharpening of the
 * collision table silently open a card-type filter on a kind that never wanted
 * one, so the rule is stated where it can be read.
 *
 * Every other object kind has already fixed its card types by being the kind it
 * is: `cardTypes: ['creature']` on `targetCreature` is a second spelling of the
 * kind, and `cardTypes: ['artifact']` on it is a card that can never be cast.
 * Only `targetPermanent` leaves the question open. `ATTACK_TRIGGER_ONLY_TARGETS`
 * above is the same shape for the same reason — a one-member rule that a table
 * keyed by kind cannot express.
 */
export const CARD_TYPE_FILTERABLE_TARGETS: readonly TargetKind[] = ['targetPermanent'];

/** True when a filter on this kind may name card types. */
export function cardTypeFilterFitsTargetKind(kind: TargetKind): boolean {
  return CARD_TYPE_FILTERABLE_TARGETS.includes(kind);
}

/** True when this slot must differ from every target the spell already chose. */
export function requiresDistinctTarget(spec: TargetSpec): boolean {
  return spec.distinct === true;
}

/**
 * How many objects this slot names at once, or `null` for the ordinary
 * one-object slot. A non-null result always means "up to this many" — see
 * `TargetSpecSchema`'s docblock for why the schema never expresses "exactly
 * N" this way.
 */
export function targetCountOf(spec: TargetSpec): number | null {
  return spec.count ?? null;
}

/**
 * What each kind draws from, so two slots can be asked whether they can collide.
 *
 * `artifactOrEnchantment` is a third space rather than a narrower draw from the
 * creature one, and it overlaps the creature space rather than being disjoint
 * from it. That row said "disjoint" until `mtg-6y4g`, on the argument that no
 * printed card kind is both an artifact and a creature. The argument was wrong
 * about this DSL: `CreatureCardSchema` has carried an `artifact` flag since
 * artifact creatures started filling a generated set's colorless slot, and
 * `isArtifact` has always read it. What was true is that the *kernel* dropped
 * the second type — `printedCharacteristics` reported `[card.kind]` — so a
 * Disenchant could not name an artifact creature and the disjointness held by
 * accident. Smelt and Torch Fiend are the cards that made that a bug rather
 * than a simplification, and the kernel now reports both types.
 *
 * The overlap is written as `artifactOrEnchantment` *plus* `creature`, which
 * over-states it: an ordinary creature is not a legal target for "target
 * artifact or enchantment", and this table now says the two slots could collide
 * anyway. Over is the safe direction, because the one reader is
 * `checkDistinctTargets` and what it decides is whether `distinct` has anything
 * to exclude — over-stating permits an "another target" a careful card did not
 * strictly need, and under-stating refuses one a real board makes meaningful.
 * The alphabet cannot say "the artifact ones", and inventing a sixth space to
 * say it would buy a sharper answer to a question nothing else asks.
 */
const TARGET_SPACES: Readonly<
  Record<
    TargetKind,
    readonly ('creature' | 'player' | 'artifactOrEnchantment' | 'planeswalker' | 'otherPermanent')[]
  >
> = {
  anyTarget: ['creature', 'player'],
  targetCreature: ['creature'],
  targetPlayer: ['player'],
  noTarget: [],
  // A narrower draw from the same space, not a space of its own: "target
  // creature" and "target creature you control" can name one body, which is
  // exactly the collision `distinct` is asked about.
  targetCreatureYouControl: ['creature'],
  // Same reasoning one row down: "target player" and "target opponent" can name
  // one person, so a `distinct` slot after either of them has something to
  // exclude.
  targetOpponent: ['player'],
  // A referent retained from the triggering event, not a CR 115 target choice.
  triggeringCreature: [],
  // A narrower draw from the creature space, the way `targetCreatureYouControl`
  // is: "target creature" and "target creature defending player controls" can
  // name one body, so a `distinct` slot after either has something to exclude.
  targetCreatureDefendingPlayerControls: ['creature'],
  // Two entries because an artifact creature is a legal target for this slot and
  // for "target creature" both, so `distinct` after either has something to
  // exclude; the docblock above says why the creature entry over-states the
  // overlap and why over is the direction to be wrong in.
  targetArtifactOrEnchantment: ['artifactOrEnchantment', 'creature'],
  // The complement of `targetCreatureYouControl`, and the same space for the
  // same reason: "target creature" and "target creature you don't control" can
  // name one body. Sharing the creature space is also what makes a restriction
  // legal on it, so "fights target creature you don't control with power 3 or
  // less" is expressible the day somebody prints it.
  targetCreatureYouDontControl: ['creature'],
  // Every class of permanent at once, which is what makes this the one kind a
  // card-type filter may narrow. `otherPermanent` is the land row and anything a
  // later card type adds: the space names are a collision alphabet for
  // `distinct`, not a type system, so a class nothing else draws from needs one
  // member and not one member per type.
  targetPermanent: ['creature', 'artifactOrEnchantment', 'planeswalker', 'otherPermanent'],
  // Two spaces, the way `anyTarget` has two, and for the same consequence: a
  // scope cannot hang off it (`targetKindNamesAPlayer` is false) and a filter
  // cannot narrow it (`filterFitsTargetKind` is false), because either would
  // reach half the space and say nothing about the other half.
  targetPlayerOrPlaneswalker: ['player', 'planeswalker'],
  // A referent retained from the ability's own source, not a CR 115 target
  // choice — the same empty space `triggeringCreature` draws from, and for the
  // same reason: nothing here is ever chosen, so nothing here can collide with
  // a choice made elsewhere, take a restriction, or take a filter. CR 115.6a is
  // the rule underneath: an object referring to itself is not targeting itself.
  selfCreature: [],
  // Empty for exactly the reasons above, and not because the object it names is
  // hard to classify. It is every class of permanent at once — the source of
  // the ability, whatever card type that card has — but the space names exist
  // to detect collisions between two *choices*, and this kind makes none.
  selfPermanent: [],
  // Empty for the reason the two rows above are empty, and it is worth saying
  // which reason, because a back-reference looks like a thing that could
  // collide. It cannot: the collision alphabet answers `distinct`, which asks
  // whether this slot could repeat an object some *other* slot chose, and a
  // referent repeats an earlier slot's object on purpose. Giving it the
  // creature space would have made `distinct` legal on it, which is a card
  // printing "another that creature".
  thatCreature: [],
  // The same argument one space over: nothing is chosen here either, so there
  // is nothing to narrow with a restriction, nothing to narrow with a filter,
  // and nothing for `distinct` to exclude.
  thatPlayer: [],
  // Empty for the two reasons above *and* one of its own: the object this kind
  // reads is a permanent and the thing it names is a player, so no single space
  // name is even true of it. The row that answers collisions has nothing to say
  // about a slot that makes no choice.
  thatCreaturesController: [],
};

/**
 * True when every object this slot can name is a creature.
 *
 * The creature-side twin of `targetKindNamesAPlayer` below, and it exists
 * because two callers need the same sentence: `restrictionFitsTargetKind`
 * decides which kinds a restriction may narrow, and `referentSourceIndex`
 * (`effects.ts`) decides which earlier slot "that creature" is allowed to point
 * back at. Written once so the two cannot disagree about whether a kind added
 * later names a creature — a referent that could point at a slot no restriction
 * fits would be reading a space this file says does not exist.
 */
export function targetKindNamesACreature(kind: TargetKind): boolean {
  const spaces = TARGET_SPACES[kind];
  return spaces.length === 1 && spaces[0] === 'creature';
}

/**
 * True when every object this slot can name is a player.
 *
 * Read by the effect-scope check: a one-shot scope such as "all creatures target
 * opponent controls" reads its group off a *person*, so the slot has to name one
 * and only one. `anyTarget` is deliberately false here — it draws from both
 * spaces, so a scope hung on it would be a group the card cannot name half the
 * time, which is a card that sometimes does nothing rather than a card.
 */
export function targetKindNamesAPlayer(kind: TargetKind): boolean {
  const spaces = TARGET_SPACES[kind];
  return spaces.length === 1 && spaces[0] === 'player';
}

/** True when two slots could name the same object, which is what `distinct` forbids. */
export function targetKindsCanCollide(a: TargetKind, b: TargetKind): boolean {
  return TARGET_SPACES[a].some((space) => TARGET_SPACES[b].includes(space));
}
