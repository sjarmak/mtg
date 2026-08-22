/**
 * The shape of a CR 113 printed ability, written once over whichever effect
 * union is wanted.
 *
 * ## Why this is a file rather than three declarations in `abilities.ts`
 *
 * A token can carry abilities (`mtg-bc2.132.7`), and a `TokenSpec` lives inside
 * the `createToken` effect. That closes a loop: an effect holds a token, a token
 * holds abilities, an ability holds effects. If `abilities.ts` owned both the
 * factory and `AbilitySchema`, then `effects.ts` would import `abilities.ts` to
 * build the token's ability list while `abilities.ts` imported `effects.ts` to
 * build its own, and the module that loaded second would read a schema that did
 * not exist yet.
 *
 * The factory has no opinion about which effects it is given, so it does not
 * need `effects.ts` at all. Putting it here is what makes the cycle go away
 * rather than be worked around with a lazy reference: `ability-shape.ts` imports
 * nothing from `effects.ts`, `effects.ts` imports the factory, and `abilities.ts`
 * applies it to the full effect union.
 *
 * `abilities.ts` is still the public face — `Ability`, its narrowing types and
 * `sortAbilities` all live there, and it re-exports what moved here — so no
 * consumer outside this package learns that the split happened.
 */
import { z } from 'zod';
import type { ZodType } from 'zod';
import { PermanentTallySchema } from './amount';
import { ManaCostSchema, ModelManaCostSchema } from './mana';
import {
  GrantableKeywordSchema,
  KeywordSchema,
  PtCountSourceSchema,
  StaticScopeSchema,
  TriggerConditionSchema,
} from './vocabulary';

/**
 * What a permanent other than the source is sacrificed as a cost: how many, and
 * which ones.
 *
 * A count alone would not do. "Sacrifice a permanent" and "sacrifice two Keys"
 * are different cards, and a Chest that could eat any permanent would eat the
 * land that paid for it. So the cost names what it eats, by the one word the
 * DSL already uses to tell two permanents apart: a subtype. `Key` is the
 * subtype the small Monsters' drop carries, and a Chest costs two of them.
 *
 * The subtype is required rather than nullable. "Sacrifice a permanent" with no
 * name would multiply the enumeration by every permanent the player controls,
 * which is the growth `activationOptions` already watches, and nothing in The
 * flagship set asks for it: widening this to a nullable is a change with a
 * card behind it, not a field left open in advance.
 *
 * Matching is by the permanent's *current* subtypes, which the kernel reads
 * through the layer system, so a Key that lost its type line to a CR 613 layer-4
 * effect stops being one for this cost too.
 */
export const SacrificeOtherSchema = z.strictObject({
  count: z.int(),
  subtype: z.string(),
});

export type SacrificeOther = z.infer<typeof SacrificeOtherSchema>;

/**
 * CR 602.1: what an activated ability costs to play. Mana, plus optionally the
 * source's own tap symbol, plus optionally sacrificing the source, plus
 * optionally sacrificing permanents the cost names, plus optionally discarding
 * cards.
 *
 * The remaining costs Magic prints — exile, pay life, remove a counter — are
 * each a new payment path in the reducer and a new
 * legality check beside it, so each stays its own bead rather than a field here
 * (`docs/design/dsl-v1-ability-model.md` section 6.2). Sacrifice came first
 * because the flagship set's first two mechanics both spend it: Fuse is
 * "Sacrifice this. Put a <part> counter on target creature", and a
 * Chest opens by sacrificing a Key (`mtg-bc2.132.11`). Discard came second, on
 * `mtg-avg2`, because the same lane was already building the hand vocabulary
 * the effect half of it needs.
 *
 * `sacrificeSelf` is the source and only the source; `sacrificeOther` is
 * everything else and never the source. They are two fields rather than one
 * because they are two different payments: the source leaves last, after every
 * part of the cost that needed it to still be a permanent, and CR 701.17a lets a
 * player sacrifice a permanent they control with no further restriction, which
 * is a condition the source satisfies by being the source and another permanent
 * has to be checked for.
 *
 * The two flags are required, defaulted `boolean`s rather than optional
 * literals: unlike `TargetSpec.distinct` there is no second spelling of "no tap
 * symbol" or "no sacrifice", so `canonicalJson` cannot see two shapes where the
 * card has one. `sacrificeOther` is optional for the opposite reason — absence
 * is the only spelling of "eats nothing", because a count of zero is refused by
 * `checkActivationCost`, so there is no `{ count: 0 }` for a null to be a second
 * spelling of.
 */
export const ActivationCostSchema = z.strictObject({
  /**
   * `ManaCostSchema` whole, `hasX` included — CR 107.3f's announced X is a
   * component of an activation cost exactly as it is of a spell's, and CR
   * 602.2b routes an activation through the same CR 601.2 steps that announce
   * it. Silklash Spider's `{X}{G}{G}` is the printed case.
   *
   * The field has always parsed here. What it never was until `mtg-nhyv.17` is
   * *charged*: the payment planner reads `generic` and the five colored pips,
   * `checkActivationCost` therefore refused the whole cost rather than print a
   * symbol nobody paid, and no effect could read the number back because a
   * `chosenX` amount was refused inside any ability. All three moved together,
   * because two of the three alone is a card whose face lies about what it
   * costs. The one thing that did *not* move is the model tier: every schema
   * below still omits `hasX`, so this stays a cost a designer reaches by hand
   * and the generator cannot print.
   */
  mana: ManaCostSchema,
  /**
   * CR 302.6: a creature that has not been controlled since its controller's
   * turn began cannot pay this. The kernel checks it through
   * `isCreatureObject`, which is layer-aware, so an animated artifact is
   * summoning-sick and a creature that lost its type is not.
   */
  tapSelf: z.boolean().default(false),
  /**
   * CR 701.17a: the source goes to its owner's graveyard as the cost is paid,
   * which is *before* the ability is put on the stack (CR 602.2b routes an
   * activation through CR 601.2's steps, and 601.2h pays the costs last). So a
   * sacrifice ability always resolves with its own source already gone —
   * `packages/kernel/src/stack.ts` reads the printed text off the object record
   * rather than off the battlefield, which is what makes that work. A token
   * pays the same cost into the same graveyard, and stops existing there a
   * moment later as a state-based action (CR 111.7, CR 704.5d); it resolves
   * from there for the same reason, and anything watching for it to die saw it
   * arrive first.
   *
   * CR 302.6 does not reach this one: summoning sickness restricts `{T}` and
   * `{Q}`, not a sacrifice, so a creature that arrived this turn may pay it.
   */
  sacrificeSelf: z.boolean().default(false),
  /**
   * CR 701.17a again, for permanents the source does not own the right to by
   * being itself. Paid at the same moment `sacrificeSelf` is — on activation,
   * before the ability is put on the stack (CR 601.2h) — so a Chest that opens
   * has already eaten its Keys while its own ability waits on the stack, and a
   * player who cannot produce them is never offered the activation.
   *
   * CR 302.6 does not reach this one either: summoning sickness restricts `{T}`
   * and `{Q}`, so a Key that arrived this turn may be spent.
   */
  sacrificeOther: SacrificeOtherSchema.optional(),
  /**
   * CR 701.8 as a cost rather than an effect: this many cards out of the
   * activating player's own hand, chosen by them, put into their graveyard as
   * the ability is activated (CR 601.2h).
   *
   * The second of the costs the docblock above lists as "each a new payment
   * path in the reducer and a new legality check beside it", and it is that
   * exactly: `activationBlocker` gains a hand-size condition, the enumeration
   * gains a third dimension beside the targets and the sacrifices, and the
   * `activateAbility` action gains an optional list naming what was pitched.
   * Nothing else on this record needed any of those, which is why it is a field
   * here and was a bead of its own rather than a line in `mtg-bc2.132.11`.
   *
   * A plain count and not a `SacrificeOther`-shaped record, because a discard
   * cost has nothing to name: the cards are in one zone, they all belong to the
   * activating player, and CR 701.8a lets them choose any of them. "Discard a
   * creature card" is a filter this has no field for and a card would have to
   * ask for, the way `sacrificeOther.subtype` was asked for by a Chest.
   *
   * Optional for `sacrificeOther`'s stated reason — absence is the only
   * spelling of "costs no cards", because `checkActivationCost` refuses a count
   * of zero, so there is no `0` for an absent field to be a second spelling of.
   * It is also, unlike the two flags, a cost that bounds repetition: a hand runs
   * out, so an ability priced only in discards is not free the way the same
   * ability priced in nothing would be, and the free-activation guard in
   * `validate/abilities.ts` counts it.
   *
   * CR 302.6 does not reach it, for the reason `sacrificeOther` gives:
   * summoning sickness restricts `{T}` and `{Q}` and nothing else.
   */
  discard: z.int().optional(),
});

/**
 * CR 606.4: a loyalty symbol is a signed cost paid by adding or removing that
 * many loyalty counters. Zero is a real cost; variable X is deliberately not
 * represented by this integer shape. Card validation bounds fixed costs to the
 * supported loyalty envelope.
 */
export const LoyaltyCostSchema = z.int();
export type LoyaltyCost = z.infer<typeof LoyaltyCostSchema>;

export type ActivationCost = z.infer<typeof ActivationCostSchema>;
export type ActivationCostInput = z.input<typeof ActivationCostSchema>;

/**
 * The artifact subtype an equip clause requires, and the one word the DSL knows
 * by name.
 *
 * `Card.subtypes` is a list of free strings checked against `SUBTYPE_PATTERN`,
 * and `Equipment` stays one of them: making it a member of a pinned tuple would
 * hand every table keyed by subtype a member to grow by, and there is no such
 * table. What the word buys instead is one validation rule — a card that prints
 * `Equip` and does not print `Equipment` on its type line says two different
 * things about itself (CR 301.5), and `checkEquipAbility` refuses it.
 */
export const EQUIPMENT_SUBTYPE = 'Equipment';

/**
 * The activation cost the set generator may answer with: the same cost without
 * the clause that names a subtype. `abilities.ts` argues why.
 *
 * Derived by omission rather than written out, so a field added above is inside
 * the generator's space unless it is named here — the direction that fails
 * loudly, since a generated cost the schema rejects is a repair-loop violation
 * and a hand-written cost the generator cannot reach is nothing at all.
 *
 * `.omit` only reaches this schema's own top-level fields, and `mana` is a
 * nested schema rather than a field named here, so `hasX` needs a second,
 * explicit strip: `mana` is overridden with `ModelManaCostSchema` for the same
 * reason `filled.ts` never hands a spell's own cost schema to the model
 * unnarrowed — the prompt does not teach X on an activation cost either
 * (`mtg-bc2.152.6` added the field to price a spell, not an ability), so a
 * model that saw it would be guessing, and every fixture that shows an
 * ability-bearing batch would key differently for a field never offered.
 *
 * `mana` is left in the `.omit` call (only `sacrificeOther` and `discard` are
 * dropped) and then overridden through `.extend`, rather than omitted alongside
 * them and re-added: Zod builds a shape by object spread, and JS
 * preserves a key's original position when an existing key is reassigned but
 * appends it at the end when the key did not survive the spread that came
 * before. Omitting `mana` and then extending it back moved it after
 * `sacrificeSelf`, which reordered `required` in the emitted JSON Schema and
 * so recomputed the fixture key for every ability-bearing batch, even though
 * nothing about the shape the model sees had changed.
 *
 * That `hasX` strip carries more weight after `mtg-nhyv.17` than it did when it
 * was written. The engine now charges an activation's X and lets the ability's
 * own effects read it back, so this is the line where the containment invariant
 * is strict rather than equal: Silklash Spider's `{X}{G}{G}` is expressible by
 * hand and runnable by the kernel, and unreachable from the generator, exactly
 * as `sacrificeOther` and `putCounters` already are. Widening it is a decision
 * about the prompt — taken the day a design note asks a model to price an
 * ability in X — and not a side effect of teaching the engine the cost.
 */
export const ModelActivationCostSchema = ActivationCostSchema.omit({
  sacrificeOther: true,
  discard: true,
}).extend({
  mana: ModelManaCostSchema,
});

/**
 * The activation cost the flagship set's two mechanic batches may answer
 * with: `sacrificeOther` restored (`abilities.ts`'s `MechanicModelAbilitySchema`
 * argues why the batches the brief points at are shown the engine's own
 * `sacrificeOther`, unlike every other model tier), `mana` still narrowed, and
 * `discard` dropped here as it is one tier up. The mechanic batches are shown
 * `sacrificeOther` because the brief's mechanics spend it; nothing in the brief
 * spends a discard, so restoring it would widen the answer space for no card
 * and re-key every fixture behind these two batches to buy nothing.
 *
 * A second schema rather than `ModelActivationCostSchema` plus a field back,
 * because Zod has no un-omit: once a key is dropped from a schema's shape,
 * getting it back is a fresh `.extend`, and writing that at each of the two
 * call sites would let them drift apart the next time this cost grows a
 * field. One definition, referenced from both.
 */
export const MechanicModelActivationCostSchema = ActivationCostSchema.omit({
  discard: true,
}).extend({
  mana: ModelManaCostSchema,
});

const StatBonusModificationSchema = z.strictObject({
  kind: z.literal('statBonus'),
  power: z.int(),
  toughness: z.int(),
});

/**
 * Layer 6, narrow: the nine evergreen `KEYWORDS` and nothing else.
 *
 * This is the member every *model-facing* tier carries — `ModelStaticModification`,
 * `AttachModification` (which `ModelAttachSchema` points at) and
 * `AuraStaticModification` (which `ModelAuraModificationSchema` is built from).
 * A fixture key is `sha256(system, prompt, schema)` (`packages/llm/src/schema.ts`),
 * and 143 of the 151 recorded calls carry these nine names inside their answer
 * schema, so a tenth name here is a live paid re-record rather than an edit —
 * the same bill `vocabulary.ts` records for moving `doubleStrike` up into
 * `KEYWORDS`.
 */
const GrantKeywordModificationSchema = z.strictObject({
  kind: z.literal('grantKeyword'),
  keyword: KeywordSchema,
});

/**
 * Layer 6, in full: the nine plus `GRANTABLE_KEYWORD_ABILITY_KINDS`.
 *
 * The same `kind` and the same one field, widened only in what that field may
 * say, because "have indestructible" is the *same* CR 613.1f grant "have
 * flying" is and giving it a member of its own would hand every reader
 * downstream two arms to switch on for one rules concept. Two schemas rather
 * than one for the reason directly above: the wide name reaches no model.
 *
 * The engine's `StaticModificationSchema` and `LayeredStaticModificationSchema`
 * point here — a printed static ability and an equip clause are hand-authored,
 * and `effectForModification` (`@mtg/kernel`'s `abilities.ts`) takes a
 * `LayeredStaticModification`, so the wide name has to reach that union to
 * reach the layer walk at all. `AttachModificationSchema` stays narrow anyway,
 * and that is not an oversight: it is a subtype of the layered union either
 * way, so an equip clause still compiles through the same function, and
 * narrowing it costs a hand-authored Equipment nothing anyone has asked for
 * while keeping `ModelAttachSchema`'s bytes exactly what they were.
 */
export type GrantKeywordModification = z.infer<typeof GrantKeywordModificationSchema>;

const GrantAnyKeywordModificationSchema = z.strictObject({
  kind: z.literal('grantKeyword'),
  keyword: GrantableKeywordSchema,
});

/**
 * CR 613.4a, layer 7a. The characteristic-defining ability: `countOf` names
 * the count (`vocabulary.ts`'s `PtCountSourceSchema` explains the one member
 * this slice reads), and `powerOffset`/`toughnessOffset` are added to it
 * after it is taken — the field that lets Tarmogoyf's toughness read "that
 * number plus 1" from the same record its power reads "that number" from.
 *
 * Legal only on a `self`-scoped static ability
 * (`validate/abilities.ts`'s `checkStaticModification` holds that rule, and
 * `checkEquipAbility` refuses it in an equip clause outright): a CDA sets the
 * *source's own* power and toughness, so "creatures you control" or an
 * equipped creature — a different permanent than the source — is not a shape
 * this modification can express.
 */
const DefinePtModificationSchema = z.strictObject({
  kind: z.literal('definePt'),
  countOf: PtCountSourceSchema,
  powerOffset: z.int(),
  toughnessOffset: z.int(),
});

/**
 * CR 613.4c, layer 7c: `statBonus` with a rate instead of a fixed delta —
 * "gets +0/+1 for each Mountain you control" (Earth Servant).
 *
 * The `power`/`toughness` here are the *per-unit* bonus, not the total: the
 * kernel multiplies each by the tally `each` names, every time it walks the
 * layers. That is the CR 613 half of the reading `amount.ts`'s header settles,
 * and it is why this is a member of its own rather than a `PermanentTally`
 * allowed into `statBonus`'s two integer fields. `statBonus`
 * sits on `ModelStaticModificationSchema` and on `AuraStaticModificationSchema`,
 * so widening it would re-key every recorded fixture that has ever been shown
 * an ability (`packages/llm/src/schema.ts` hashes the answer schema); and a
 * single record whose fields sometimes mean a total and sometimes mean a rate
 * is exactly the reader-decides-from-context shape the amount union refuses.
 *
 * Not on any model-facing tier, for `definePt`'s stated reason and one more of
 * its own: a rate multiplied by a board the generator cannot see is a card
 * whose power is a property of the *set*, which is where the eight
 * hand-authored members already sit.
 */
export const StatBonusPerModificationSchema = z.strictObject({
  kind: z.literal('statBonusPer'),
  power: z.int(),
  toughness: z.int(),
  each: PermanentTallySchema,
});

/**
 * The modifications that resolve inside the CR 613 layer walk. Each member
 * names a layer rather than inventing one: `statBonus` is layer 7c,
 * `grantKeyword` is layer 6, `definePt` is layer 7a, so each compiles to
 * exactly one `ContinuousEffect` the kernel's existing walk resolves.
 *
 * A schema of its own rather than the whole union, because two things in the
 * vocabulary genuinely mean *these three and not the others*: an equip clause,
 * whose modifications are applied to the equipped creature by that same walk
 * (`packages/kernel/src/attach.ts`), and `effectForModification`, which returns
 * a `ContinuousEffect` and has nothing to return for a modification that is not
 * one. The alternative was the pattern `AuraStaticModificationSchema`'s docblock
 * argues against directly below — admit the wide union and refuse the member in
 * a validator afterwards, leaving every downstream reader an arm no valid card
 * can reach.
 *
 * Its `grantKeyword` is the wide one, and this is the union that decides that:
 * `effectForModification` takes a `LayeredStaticModification`, so a keyword the
 * layer walk is meant to grant has to be sayable here or it cannot reach layer 6
 * at all. Nothing model-facing reads this schema — `ModelAttachSchema` points at
 * the narrow `AttachModificationSchema` below — so widening it addresses no
 * fixture.
 */
export const LayeredStaticModificationSchema = z.discriminatedUnion('kind', [
  StatBonusModificationSchema,
  GrantAnyKeywordModificationSchema,
  DefinePtModificationSchema,
  StatBonusPerModificationSchema,
]);

export type LayeredStaticModification = z.infer<typeof LayeredStaticModificationSchema>;

/**
 * The three members an *attachment* clause may carry, frozen at three.
 *
 * This is the union the paragraph above used to be, under the name above, and
 * the split is a fixture-hash fact rather than a taste: `ModelAttachSchema`
 * points here, a fixture key hashes the answer schema, and the model's equip
 * clause must keep hashing to what it always did. Same members in the same
 * order, so the emitted bytes are unchanged.
 *
 * `statBonusPer` is off it for a reason that outlives the hash, which is why
 * the split does not need revisiting when the fixtures are next re-recorded: a
 * rate read off the board, riding on a permanent that moves between creatures,
 * is an Equipment whose value depends on which lands its wielder's controller
 * happens to have out, and `checkEquipAbility` already refuses the CDA for the
 * neighboring reason. `AttachModification` is a subtype of
 * `LayeredStaticModification`, so `effectForModification` takes an attachment's
 * modifications unchanged.
 */
export const AttachModificationSchema = z.discriminatedUnion('kind', [
  StatBonusModificationSchema,
  GrantKeywordModificationSchema,
  DefinePtModificationSchema,
]);

export type AttachModification = z.infer<typeof AttachModificationSchema>;

/**
 * CR 614: a damage event, doubled before it happens. Furnace of Rath's text,
 * and symmetric exactly as that card is — the trigger it registers names no
 * source, no recipient and no controller, so it doubles both seats' damage.
 *
 * Filtering it would be the interesting card (M13's Fire Servant doubles a red
 * instant or sorcery *you control*), and it is deliberately not expressible:
 * `ReplacementTrigger.fromSource` (`packages/kernel/src/replacement-effects.ts`)
 * is one object id or nothing, so "a red instant or sorcery spell you control"
 * has nowhere to go. A field here that the kernel could not honor would be the
 * divergence this vocabulary exists to prevent.
 *
 * No factor, and the fixed 2 is the containment: the kernel's
 * `multiplyDamage.factor` is a number, and every printed card that reaches it
 * from the DSL says the word in this member's name.
 */
const DoubleDamageModificationSchema = z.strictObject({
  kind: z.literal('doubleDamage'),
});

/**
 * CR 614 again, on the other event: Rhox Faithmender's "If you would gain
 * life, you gain twice that much instead."
 *
 * Its controller is the player whose life gain is doubled, and unlike the
 * damage member that makes the registered record one-sided. The kernel bakes
 * the controller at registration, which is what `RegisteredCostModifier`
 * already does with the same field and for the same reason
 * (`packages/kernel/src/cost.ts`), and the consequence is stated where the
 * record is built rather than hidden: `triggerMatches` is a pure function of a
 * trigger and an event and holds no state to re-read a controller from.
 */
const DoubleLifeGainModificationSchema = z.strictObject({
  kind: z.literal('doubleLifeGain'),
});

/**
 * CR 508/509's combat restrictions and requirements, generalized off the
 * source `AuraModification` already carries in `card.ts`.
 *
 * `cantAttack`, `cantBlock` and `cantBeBlocked` have no field of their own for
 * the same reason the Aura members that share their names don't: which
 * permanents they reach is the containing static ability's `scope` (and
 * `subtype`), read once at the ability level rather than repeated on every
 * modification a scoped ability can carry. `attacksEachCombatIfAble` and
 * `mustBeBlockedIfAble` are the same shape for the same reason, one CR
 * citation each (508.1d, 509.1c).
 *
 * `blockOnlyCreaturesWithKeyword` is the one member here with a field, because
 * CR 509.1b's restriction always names what the attacker must have — "can
 * block only creatures with flying" is the rule's own worked example — and a
 * keyword is the one vocabulary this codebase already has for "a thing a
 * creature either has or does not" (`vocabulary.ts`'s `KeywordSchema`).
 * Combined restrictions (a blocker under two such statics at once) AND, per
 * CR 509.1b: the attacker must satisfy every named keyword, not just one, and
 * `packages/kernel/src/combat.ts`'s `requiredBlockKeywords` implements it that
 * way.
 *
 * `cantBeBlockedBySubtype` (`mtg-nhyv.57`, Juggernaut's second line) is that
 * member's mirror and carries a field for the same reason, on the other side of
 * the relation. A CR 509.1b restriction names two permanents — the blocker it
 * is checked against and the attacker it is checked about — and `scope` reaches
 * exactly one of them. `blockOnlyCreaturesWithKeyword`'s scope names the
 * blocker and its field names the attacker; this one's scope names the attacker
 * ("Juggernaut", `scope: 'self'`) and its field names the blockers excluded, who
 * are on the other side of the table and therefore out of reach of all three
 * scopes — every one of them (`self`, `creaturesYouControl`,
 * `otherCreaturesYouControl`) is relative to the source's own controller. So
 * the docblock's "read it off the ability's scope" argument does not extend
 * here, and there is no scoped static in this vocabulary that says "can't be
 * blocked by Walls" without it.
 *
 * The field is a `subtype` rather than a `Keyword` because Juggernaut names a
 * creature type, and a bare capitalized word held to `SUBTYPE_PATTERN` is the
 * spelling this codebase already uses for one (`Card.subtypes`,
 * `StaticAbility.subtype`, a `sacrificeOther` cost's). The kernel answers it
 * with `hasSubtype`, which is the same function the scope filter and CR 205.3i's
 * basic-land-type fold already go through, so "this permanent is a Wall" has one
 * definition rather than two.
 *
 * Combined restrictions AND here too, and CR 509.1b is again the citation: no
 * restriction may be disobeyed, so an attacker printing two of these forbids the
 * *union* of the subtypes they name. The set operation differs from
 * `requiredBlockKeywords`'s intersection only because that member states a
 * permission and this one states a prohibition; the rule they implement is the
 * same sentence. `packages/kernel/src/combat.ts`'s `blockedBySubtypes` is where
 * it lands.
 */
// Exported (unlike this file's other leaf schemas) because `card.ts`'s
// `AuraCombatModificationSchema` reuses these three rather than redefining
// them: an Aura's "can't attack" and a plain static's are the identical rule,
// applied through two different live queries
// (`packages/kernel/src/attach.ts`'s `hasAuraModification`,
// `packages/kernel/src/combat.ts`'s `hasCombatModification`), and
// `AuraStaticModificationSchema` already sets the precedent of pointing at the
// shared object rather than a second literal that could drift from it.
export const CantAttackModificationSchema = z.strictObject({
  kind: z.literal('cantAttack'),
});

export const CantBlockModificationSchema = z.strictObject({
  kind: z.literal('cantBlock'),
});

export const CantBeBlockedModificationSchema = z.strictObject({
  kind: z.literal('cantBeBlocked'),
});

const AttacksEachCombatIfAbleModificationSchema = z.strictObject({
  kind: z.literal('attacksEachCombatIfAble'),
});

const MustBeBlockedIfAbleModificationSchema = z.strictObject({
  kind: z.literal('mustBeBlockedIfAble'),
});

const BlockOnlyCreaturesWithKeywordModificationSchema = z.strictObject({
  kind: z.literal('blockOnlyCreaturesWithKeyword'),
  keyword: KeywordSchema,
});

/**
 * `subtype` is a free capitalized word rather than an enum for the reason
 * `Card.subtypes` and `StaticAbility.subtype` are: a generated set invents its
 * own creature types, so a pinned list would hand every subtype-keyed table a
 * member to grow by. `SUBTYPE_PATTERN` is what holds the shape, checked in
 * `validate/abilities.ts`'s `checkStaticModificationRecord` where a
 * `sacrificeOther` cost's subtype is already checked, so a malformed word
 * surfaces as `INVALID_SUBTYPE` with a path rather than as a rendered sentence
 * nobody can read.
 */
const CantBeBlockedBySubtypeModificationSchema = z.strictObject({
  kind: z.literal('cantBeBlockedBySubtype'),
  subtype: z.string(),
});

/**
 * The seven combat members of `StaticModification`, as their own union.
 *
 * A schema of its own for the reason `LayeredStaticModificationSchema` has
 * one: `classifyStaticModification`'s `'combat'` arm and its predicate
 * (`isCombatStaticModification`, `static-modification-class.ts`) need a type
 * to narrow to, and `renderStaticAbility`'s three-way dispatch
 * (`oracle.ts`) reads this name to pick its combat-sentence branch rather
 * than re-deriving the six-member list at each call site.
 */
export const CombatModificationSchema = z.discriminatedUnion('kind', [
  CantAttackModificationSchema,
  CantBlockModificationSchema,
  CantBeBlockedModificationSchema,
  AttacksEachCombatIfAbleModificationSchema,
  MustBeBlockedIfAbleModificationSchema,
  BlockOnlyCreaturesWithKeywordModificationSchema,
  CantBeBlockedBySubtypeModificationSchema,
]);

export type CombatModification = z.infer<typeof CombatModificationSchema>;

/**
 * What a static ability does, in full: the engine's own union and every
 * hand-authored ability's (`abilities.ts`'s `AbilitySchema`, `effects.ts`'s
 * `TokenAbilitySchema`, neither shown to a model).
 *
 * The three layer members above plus the two CR 614 replacements plus the six
 * CR 508/509 combat members `mtg-t3ik` appended. The split between the three
 * classes is not cosmetic and `LayeredStaticModificationSchema`'s docblock
 * says where the first bites; `STATIC_MODIFICATION_KINDS` (`vocabulary.ts`)
 * argues why a replacement, and now a combat restriction, is printed as a
 * static ability at all.
 *
 * Neither doubler, nor any of the six combat members, is on any model-facing
 * tier, and that is the one place in this file where the containment rule is
 * a design decision rather than a fixture-hash one: a set whose generator can
 * print "this creature must be blocked if able" on every rare prints a format
 * where combat math stops being the player's decision, and no per-card check
 * can catch it, because the mistake is a property of the set. So all eight are
 * hand-authored, exactly where `addMana` sits and for the same stated reason.
 */
export const StaticModificationSchema = z.discriminatedUnion('kind', [
  StatBonusModificationSchema,
  GrantAnyKeywordModificationSchema,
  DefinePtModificationSchema,
  StatBonusPerModificationSchema,
  DoubleDamageModificationSchema,
  DoubleLifeGainModificationSchema,
  CantAttackModificationSchema,
  CantBlockModificationSchema,
  CantBeBlockedModificationSchema,
  AttacksEachCombatIfAbleModificationSchema,
  MustBeBlockedIfAbleModificationSchema,
  BlockOnlyCreaturesWithKeywordModificationSchema,
  CantBeBlockedBySubtypeModificationSchema,
]);

export type StaticModification = z.infer<typeof StaticModificationSchema>;
export type StaticModificationOf<K extends StaticModification['kind']> = Extract<
  StaticModification,
  { kind: K }
>;

/**
 * `StaticModificationSchema` narrowed to the two kinds the set generator may
 * answer with — `abilitiesOver`'s default for the static member's
 * `modification` field, so every model-facing ability tier
 * (`ModelAbilitySchema`, `AttachingModelAbilitySchema`,
 * `MechanicModelAbilitySchema`, `AttachingMechanicModelAbilitySchema`) stays
 * narrowed without naming the field at each call site.
 *
 * `definePt` stays off this schema for the reason `putCounters` stays off
 * `ModelEffectSchema` (`effects.ts`): growing the shape shown to every
 * ability-bearing prompt renames every already-recorded fixture
 * (`packages/llm/src/schema.ts` hashes the answer schema) whether or not the
 * brief asked for a CDA, and no brief here does. So a characteristic-defining
 * P/T is expressible by hand and unreachable from the generator, exactly
 * where `putCounters` and a token's abilities already sit.
 */
export const ModelStaticModificationSchema = z.discriminatedUnion('kind', [
  StatBonusModificationSchema,
  GrantKeywordModificationSchema,
]);

/**
 * `StaticModificationSchema` narrowed to the two kinds an Aura may carry
 * (`card.ts`'s `AuraModificationSchema` unions this with the combat and
 * landwalk members).
 *
 * `definePt` is off it for a rule, not a policy: a CDA sets the *source's own*
 * power and toughness (CR 613.4a), and an Aura's modifications reach the
 * enchanted creature, a different permanent than the source. The Aura schema
 * used to admit the whole union and `checkAura` refused the member afterwards
 * with `DEFINE_PT_ILLEGAL_ON_SCOPE`, which meant `AuraModification` had an arm
 * no valid card could reach: every reader downstream — the oracle renderer, the
 * kernel's `attach`, the identity function in `validate/aura.ts` — had to carry
 * a branch for a shape the type admitted and the validator would not (`mtg-vmrp`).
 * Narrowing the schema deletes the branch and the violation together, and moves
 * the refusal from a rule the reader has to know to a parse error.
 *
 * The equip clause states the same rule the other way, at validation time
 * (`validate/abilities.ts`'s `checkEquipAbility`), and stays there: it reads
 * `AbilitySchema`'s one `attach.modifications` list, which is
 * `LayeredStaticModificationSchema` because a `self`-scoped static on the same
 * card is a legal CDA. An Aura has no such list to share.
 *
 * A separate schema rather than a reference to `ModelStaticModificationSchema`,
 * which happens to hold the same two members: that one answers "what may the
 * set generator write", this one answers "what may an Aura say", and a
 * hand-authored Aura is not a generated one. Collapsing them would tie an
 * Aura's vocabulary to a prompt-hash decision.
 */
export const AuraStaticModificationSchema = z.discriminatedUnion('kind', [
  StatBonusModificationSchema,
  GrantKeywordModificationSchema,
]);

/**
 * CR 702.6b: `Equip [cost]` means "[cost]: Attach this permanent to target
 * creature you control. Activate only as a sorcery."
 *
 * ## Why this is a field on the activated ability and not a fourth kind
 *
 * Equip *is* an activated ability, so a fourth member of `ABILITY_KINDS` would
 * be a second spelling of one the vocabulary already has, and every table keyed
 * by ability kind — the Forge transpiler's, the generator's prompt, the
 * kernel's `assertNever` — would grow a member to express a card that pays a
 * cost and puts something on the stack, which is what `activated` already
 * means. One optional field leaves `legal.ts` and `reduce.ts` enumerating and
 * paying for it through the code that already enumerates and pays for an
 * activation.
 *
 * ## Why the modifications ride here rather than in a static ability
 *
 * A real Equipment prints two lines, "Equipped creature gets +2/+0" and "Equip
 * {2}", and Magic models the first as a static ability whose scope is the
 * equipped creature. `STATIC_SCOPES` has no such scope, and adding one is a
 * change to two tables outside `@mtg/dsl` that are keyed by it. It is also a
 * scope no card can use without an equip ability, so the two halves are one
 * clause here: the ability that attaches states what being attached does, and
 * the renderer prints Magic's two lines from it.
 *
 * ## Why a list, and what its bounds mean
 *
 * This field was singular until 2026-08-13, and the rationale printed here was
 * Decision 12 of the set design document — eight weapons, no
 * support structure — read as a budget of one modification per weapon. That
 * reading is retired. Decision 12 bounds how many weapons a set prints; it says
 * nothing about how many things one weapon does, and the singular field turned
 * a limit on the count of Equipment into a limit on their text. One-Hit
 * Obliterator is the card that made the difference visible: the playtester's design
 * for it is `+99/-3` *and* deathtouch, which is one clause about one weapon and
 * is unspellable as one modification.
 *
 * The list is bounded at both ends, and the bounds are the encoding rule:
 *
 *  - **At least one, and the field is required.** There is no empty list and no
 *    absent field, so an equip clause has exactly one spelling and
 *    `canonicalJson` — which the fingerprints and the duplicate check read —
 *    cannot see two shapes where the card has one. This is the same rule
 *    `OptionalTriggerSchema` and `TargetSpec.distinct` state with
 *    `literal(true).optional()`, reached from the other side: those fields have
 *    one absent spelling because absence means something, and this one has no
 *    absent spelling because it would not.
 *  - **At most two**, which is `Card.abilities`' cap and a triggered ability's
 *    effect cap, taken for the reason they were taken: a third clause is a
 *    rules box, not a schema (`packages/card-render`).
 *
 * Order is printed order and nothing else, exactly as an effect list's order
 * is: the renderer says the modifications in the order the card lists them, so
 * two orders are two card faces rather than two encodings of one. What the
 * *engine* does with them is decided by CR 613's layers and never by the index
 * — `grantKeyword` is layer 6 and `statBonus` is layer 7c, so a granted keyword
 * applies first however the card lists it (`packages/kernel/src/attach.ts`,
 * asserted in `packages/kernel/test/equip.test.ts`).
 *
 * Two entries that name the same thing are refused as `DUPLICATE_MODIFICATION`
 * (`validate/abilities.ts`), the way `DUPLICATE_EFFECT` refuses a repeated
 * effect.
 */
export const ATTACH_MODIFICATION_LIMITS = { min: 1, max: 2 } as const;

export const AttachSchema = z.strictObject({
  modifications: z
    .array(AttachModificationSchema)
    .min(ATTACH_MODIFICATION_LIMITS.min)
    .max(ATTACH_MODIFICATION_LIMITS.max),
});

export type Attach = z.infer<typeof AttachSchema>;

/**
 * The equip clause the set generator may answer with: one modification, in the
 * field the model has always been shown.
 *
 * Deliberately not `AttachSchema`, and deliberately not derived from it. A
 * fixture key is `hash(system, prompt, schema)`, so the shape of this object is
 * a *recorded* fact: `packages/setgen/fixtures/llm/` holds eight request/response
 * pairs from the one real flagship set run whose schema carries this field by
 * name, and `recorded-set.test.ts` replays them. Renaming it to `modifications`
 * strands all eight, and getting them back is a live run.
 *
 * So the widening stops at the engine, and containment is left pointing the way
 * it has always pointed: the generator expresses *less* than the DSL. That is
 * the safe direction — a card the generator cannot reach is a card a designer
 * writes by hand, which is where `putCounters`, `sacrificeOther` and an optional
 * trigger already sit. The direction that fails is the other one, and nothing
 * here moves that way.
 *
 * `abilityFromModel` (`abilities.ts`) is the crossing, and its return type is
 * the compile-time proof that the crossing lands inside `Ability`.
 */
export const ModelAttachSchema = z.strictObject({
  modification: AttachModificationSchema,
});

export type ModelAttach = z.infer<typeof ModelAttachSchema>;

/**
 * CR 603.3b's "you may": the trigger goes on the stack and its controller is
 * asked, as it resolves, whether to carry the effect out.
 *
 * Declining is a decision rather than a skip — the ability triggered, it was put
 * on the stack, both players had priority with it there, and the controller
 * answered. `packages/kernel/src/stack.ts` is where that answer is asked for and
 * `packages/kernel/src/legal.ts` is where it is enumerated as two options.
 *
 * `literal(true).optional()`, the spelling `TargetSpec.distinct` uses and for
 * the same reason: `optional: false` and an absent `optional` are the same
 * card, and one card must have one encoding or `canonicalJson` sees two shapes
 * where the design has one. It is also what keeps every ability written before
 * this field canonicalizing byte-identically after it, so no card fingerprint,
 * no recorded set and no pinned oracle text moved because the DSL learned a new
 * word.
 */
export const OptionalTriggerSchema = z
  .literal(true, {
    error:
      '"optional" is either set to true or left out; "false" is a second spelling of leaving it out, and one card must have one encoding',
  })
  .optional();

/**
 * The activated member's extra fields when a caller names none.
 *
 * Its *type* is what matters: `Record<string, never>` would spread into the
 * member as an index signature and widen every field on it, so the default is
 * the type of one empty object rather than a description of one.
 */
const NO_EXTRA_FIELDS = {};

/**
 * The three printed ability kinds, over a caller-chosen effect union.
 *
 * DSL v1 expresses three. The static ability is a continuous effect the CR 613
 * layer system already knows how to resolve
 * (`packages/kernel/src/continuous.ts`); the triggered ability is an object that
 * goes on the stack when its condition is met (CR 603,
 * `packages/kernel/src/triggers.ts`); the activated ability is the same kind of
 * stack object, put there by a player who paid for it (CR 602,
 * `packages/kernel/src/legal.ts` enumerates it and `reduce.ts` pays it). The
 * union is written with a hand-written `kind` literal per member, deliberately:
 * that is what gives `AbilityKindsCovered` (`exhaustive.ts`) teeth against
 * `ABILITY_KINDS`, and what makes the kernel's `assertNever` over
 * `Ability['kind']` fail to compile the moment the DSL grows a kind the engine
 * cannot run.
 *
 * Two unions are built from this, exactly as `effects.ts` builds two from one
 * list: `AbilitySchema` carries the full effect vocabulary, and a token's
 * ability list carries that vocabulary minus `createToken`.
 *
 * The activation cost is the second parameter for the same reason the effect
 * union is the first: the generator's ability union is built over a narrower
 * cost than a hand-written card's (`ModelActivationCostSchema`), and the
 * alternative was a second copy of the three-member union that would have to be
 * kept in step with this one by hand. The activated member's extra fields are
 * the third parameter for the same reason a third time: CR 702.6b's equip
 * clause belongs to the engine's union and to no other, and a shape spread in
 * by the caller is how a field can be absent rather than present and
 * unfillable. `abilities.ts` fills it; the generator's union and a token's
 * leave it empty.
 *
 * The fourth parameter is the triggered member's, and it carries `optional`.
 * That field is filled by the engine's union and by a token's — a part in The
 * flagship set is a token and Fuse is its printed trigger — and left empty by
 * the two the generator answers with, because a field added to the schema the
 * model is shown renames every recorded fixture keyed to it
 * (`packages/llm/src/schema.ts` hashes the answer schema). So an optional
 * trigger is expressible by hand and unreachable from the generator until a
 * setgen slice re-records, which is exactly where `putCounters` and a token's
 * abilities already sit. Nothing about *targeting* a trigger is gated that way:
 * the target spec was always on the effect, so the generator reaches targeted
 * triggers through `checkAbilities` alone, with no schema change at all.
 *
 * The fifth parameter is the static member's, added after the other four
 * rather than beside them so no positional call site silently swapped which
 * extras it was passing — `A`, `R` and this one share the identical structural
 * type, and TypeScript would not catch a call written before this parameter
 * existed suddenly binding its third argument to the wrong member. It exists
 * for `enabledWhile` (CR 611.2c's conditional continuous effect, "as long
 * as…"): the engine's union fills it and the generator's four leave it empty,
 * for the fixture-hash reason every other extra field here does.
 *
 * The sixth parameter is the static member's `modification` field itself,
 * and it defaults to `ModelStaticModificationSchema` rather than the full
 * `StaticModificationSchema` — the one parameter here whose *default* is the
 * narrow schema, because every model-facing caller (four of the five unions
 * built over this factory) wants the narrow one and none should have to name
 * it to get it. The two callers that need the full union with `definePt` —
 * `abilities.ts`'s `AbilitySchema` and `effects.ts`'s `TokenAbilitySchema`,
 * neither shown to a model — pass `StaticModificationSchema` explicitly.
 *
 * The seventh parameter is the trigger-condition schema. The engine and
 * tokens use the full tuple; model-facing unions pass their frozen subset so
 * adding a hand-authored condition does not silently widen a generated
 * fixture schema.
 */
export function abilitiesOver<
  T extends ZodType,
  C extends ZodType = typeof ActivationCostSchema,
  A extends Record<string, ZodType> = typeof NO_EXTRA_FIELDS,
  R extends Record<string, ZodType> = typeof NO_EXTRA_FIELDS,
  S extends Record<string, ZodType> = typeof NO_EXTRA_FIELDS,
  M extends ZodType = typeof ModelStaticModificationSchema,
  TCondition extends ZodType = typeof TriggerConditionSchema,
>(
  effect: T,
  cost: C = ActivationCostSchema as unknown as C,
  activated: A = NO_EXTRA_FIELDS as A,
  triggered: R = NO_EXTRA_FIELDS as R,
  staticExtra: S = NO_EXTRA_FIELDS as S,
  staticModification: M = ModelStaticModificationSchema as unknown as M,
  triggerCondition: TCondition = TriggerConditionSchema as unknown as TCondition,
) {
  return z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('static'),
      scope: StaticScopeSchema,
      /**
       * Narrows the scope to one creature type, or `null` for all of it. A plain
       * string at the schema level for the reason `Card.subtypes` is one: a
       * malformed word surfaces as `INVALID_SUBTYPE` with a path a repair loop
       * can act on, not as an opaque parse failure. `checkAbilities` also holds
       * the rule that only the group scopes may carry one, because "this
       * permanent, if it is a Merfolk" narrows *which permanents the effect
       * reaches* rather than *whether it applies at all*, and a `self` scope is
       * exactly one permanent — there is nothing left to narrow.
       */
      subtype: z.string().nullable().default(null),
      modification: staticModification,
      // The caller's extra fields for this member, spread last for the reason
      // the activated and triggered members' are: `enabledWhile` belongs to the
      // engine's union and to neither union the generator answers with.
      ...staticExtra,
    }),
    z.strictObject({
      kind: z.literal('triggered'),
      condition: triggerCondition,
      /**
       * What the ability does when it resolves, in the same primitives a spell
       * uses, so `applyEffect` and `renderEffect` each stay one switch instead of
       * two. Two is the cap for the reason `Card.abilities` caps at two: a third
       * clause is a rules box, not a schema (`packages/card-render`).
       *
       * These may target. CR 603.3d chooses a trigger's targets when the
       * ability is put on the stack, which is inside `settle`, so the kernel
       * stops there and asks: `packages/kernel/src/trigger-choice.ts` is the
       * question and `packages/kernel/src/reduce.ts` is the stop.
       * `checkAbilities` holds each effect to the same per-effect table a spell
       * obeys (`LEGAL_TARGETS`), which is the same rule an activated ability's
       * effects go through — the two kinds of ability differ in *when* the
       * choice is made, never in where an effect may point.
       */
      effects: z.array(effect).min(1).max(2),
      // The caller's extra fields for this member, spread last for the reason
      // the activated member's are: `optional` belongs to the engine's union
      // and a token's, and to neither union the generator answers with.
      ...triggered,
    }),
    z.strictObject({
      kind: z.literal('activated'),
      cost,
      /**
       * What the ability does when it resolves, in the same primitives a spell
       * uses. Two is the cap for the reason the trigger's list caps at two.
       *
       * These may target, and that is the whole difference from a trigger: CR
       * 601.2c chooses an activated ability's targets when the player activates
       * it, which is a decision the player is already making at a priority window
       * the kernel already stops at, so the targets ride along in the action the
       * way a cast's do. `checkAbilities` still holds each effect to the same
       * per-effect table a spell obeys (`LEGAL_TARGETS`), so no ability can aim
       * an effect somewhere the card type never could.
       *
       * The floor of one is what `abilities.ts` replaces when it builds the
       * engine's union, because an equip ability prints no effect at all: the
       * caller's shape is spread last, so a field it names wins.
       */
      effects: z.array(effect).min(1).max(2),
      // The caller's extra fields for this member, spread last so they can both
      // add and replace. `AbilitySchema` uses it for CR 702.6b's equip clause
      // and for the effect floor that clause needs; the model's union and a
      // token's pass nothing, which is what keeps the JSON schema `@mtg/setgen`
      // shows the model byte-identical to the one its fixtures were recorded
      // against — those keys hash the schema alongside the prompt.
      ...activated,
    }),
  ]);
}
