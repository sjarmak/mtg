/**
 * The replay event log: what a viewer needs to redraw a bot game without ever
 * asking the engine anything.
 *
 * `@mtg/sim`'s JSONL is the 17lands-superset *statistics* log — per-turn
 * aggregates, no per-decision detail. This is the other log: one record per
 * kernel decision, carrying the enumerated legal options, the action the bot
 * picked, the events the reducer produced, and a board snapshot of the state
 * that came out. A viewer over it re-runs nothing, which is the whole point —
 * a replay that re-simulates is a second engine that can disagree with the
 * first one.
 *
 * Three properties are load-bearing and each is enforced here:
 *
 *  1. **Strict objects.** Every kernel record is parsed with `strictObject`, so
 *     a field added or renamed in `@mtg/kernel` fails the recorder loudly
 *     instead of silently writing a log this viewer would narrate as
 *     `undefined`.
 *  2. **Self-contained games.** The card dictionary and the object table travel
 *     with the game, so a log file needs no set JSON beside it.
 *  3. **Carry-forward snapshots.** `state: null` means "identical to the
 *     previous step", which is the common case (a passed priority changes
 *     nothing) and is what keeps a 400-decision game a readable file rather
 *     than a megabyte of repeated board.
 */
import { z } from 'zod';
import {
  CardSchema,
  KeywordSchema,
  ManaCostSchema,
  MAX_CHOSEN_X,
  TRIGGERING_CREATURE_CONDITIONS,
  TriggerConditionSchema,
} from '@mtg/dsl';

/**
 * Bump on any change to record shapes or semantics.
 *
 * `/2` is `activateAbility` growing a required `sacrifices`. Adding a whole
 * record *variant* left older files readable and went unbumped (c3fb0f6);
 * adding a required field to a variant that already existed does not, because
 * every `activateAbility` record written under `/1` now fails `strictObject`.
 * A file that still claimed `/1` would fail on the field rather than on the
 * version, which is the wrong error to hand somebody holding an old log.
 *
 * `/3` is two required fields inside `SnapshotSchema`, and they are the same
 * shape of change one level down: a snapshot is not a record variant, but every
 * `state` a `/2` file carries has neither field anywhere in it.
 * `BoardPermanentSchema.attachedTo` is CR 701.3a attachment, which reached the
 * kernel (`@mtg/kernel`'s `attachedTo`) while the viewer went on drawing two
 * unrelated permanents where a creature was carrying a weapon; the alternative
 * to the bump was an optional field, which would have made "this log predates
 * attachment" and "this permanent is attached to nothing" the same value.
 * `StackEntrySchema.source` is what an activated ability on the stack points at,
 * and its own docblock says what was broken without it.
 *
 * `/4` retains physical card identity, copied-from object, and chosen X for
 * every stack entry. `/5` additionally widens an attack's defender from a
 * numeric player to the tagged union that can name a planeswalker. `/6` adds
 * non-target trigger context. `/7` adds last-known source characteristics and
 * regeneration evidence. `/8` adds scry actions, decisions, and events.
 * Readers keep every released grammar distinct while the producer writes `/8`.
 *
 * Hand discard (`chooseDiscards`, `handDiscard`, `activateAbility.discards`)
 * lands under `/8` unbumped, and the first paragraph is the whole argument: a
 * new record *variant* and a new decision kind widen what a reader accepts
 * without invalidating a line already written, and `discards` is optional, so
 * every `activateAbility` record in every `/8` file on disk still parses. The
 * two events the lane emits (`cardsDiscarded`, `handRevealed`) predate it.
 *
 * An activated ability's announced X (`mtg-nhyv.17`) lands under `/8` unbumped
 * on the same argument, taken twice. `activateAbility.x` is optional, so a
 * record written before an ability could announce one parses unchanged. The
 * `abilityActivated` event's `chosenX` is *not* optional — the kernel's event
 * requires it — but it carries `.default(null)`, which reads an older line back
 * as "announced nothing", which is what an older line meant. Neither is a
 * required field appearing on an existing variant with no value to give it,
 * which is the change `/2` says has to bump.
 */
export const EVENT_LOG_SCHEMA_VERSION = 'mtg-ui/event-log/8';
const READABLE_EVENT_LOG_SCHEMA_VERSIONS = [
  'mtg-ui/event-log/3',
  'mtg-ui/event-log/4',
  'mtg-ui/event-log/5',
  'mtg-ui/event-log/6',
  'mtg-ui/event-log/7',
  EVENT_LOG_SCHEMA_VERSION,
] as const;

const PlayerIdSchema = z.union([z.literal(0), z.literal(1)]);
const ObjectIdSchema = z.string().min(1);
const CombatDefenderSchema = z.union([
  PlayerIdSchema,
  z.strictObject({ kind: z.literal('planeswalker'), oid: ObjectIdSchema }),
]);
const CountSchema = z.int().min(0);

export const STEP_NAMES = [
  'untap',
  'upkeep',
  'draw',
  'precombatMain',
  'beginCombat',
  'declareAttackers',
  'declareBlockers',
  'firstStrikeDamage',
  'combatDamage',
  'endCombat',
  'postcombatMain',
  'end',
  'cleanup',
] as const;

const StepSchema = z.enum(STEP_NAMES);
const ZoneSchema = z.enum(['library', 'hand', 'battlefield', 'graveyard', 'exile', 'stack']);
const ManaColorSchema = z.enum(['W', 'U', 'B', 'R', 'G', 'C']);
const EndReasonSchema = z.enum(['lifeZero', 'emptyLibrary', 'concede', 'turnLimit']);
const LifeReasonSchema = z.enum(['damage', 'lifelink', 'gainLife', 'lifeLoss']);
const DestroyReasonSchema = z.enum(['lethalDamage', 'deathtouch', 'zeroToughness', 'destroyEffect']);
const ReplaceableKindSchema = z.enum(['damage', 'draw', 'lifeGain', 'destroy', 'enters']);

export const TargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('player'), player: PlayerIdSchema }),
  z.strictObject({ kind: z.literal('permanent'), oid: ObjectIdSchema }),
  z.strictObject({ kind: z.literal('spell'), oid: ObjectIdSchema }),
]);

const TargetSlotSchema = z.union([TargetSchema, z.null()]);

const DamageTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('player'), player: PlayerIdSchema }),
  z.strictObject({ kind: z.literal('permanent'), oid: ObjectIdSchema }),
]);

/** The action alphabet, mirroring `@mtg/kernel`'s `Action`. */
export const ActionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('passPriority'), player: PlayerIdSchema }),
  z.strictObject({ type: z.literal('playLand'), player: PlayerIdSchema, oid: ObjectIdSchema }),
  z.strictObject({
    type: z.literal('castSpell'),
    player: PlayerIdSchema,
    oid: ObjectIdSchema,
    targets: z.array(TargetSlotSchema),
    /**
     * CR 601.2b's announced X, mirroring `@mtg/kernel`'s `Action['castSpell'].x`
     * (`mtg-bc2.152.6`). Optional rather than a version bump: an old log with no
     * `x` key still parses (nothing here required it), and `strictObject` still
     * rejects a genuinely unknown key, so this is the same backward-compatible
     * shape the schema version docblock above grants a new record variant.
     *
     * `exactOptional`, not `optional`: plain `.optional()` infers `number |
     * undefined`, which `exactOptionalPropertyTypes` refuses to assign into the
     * kernel's `x?: number` (present-and-a-number or absent, never present-and-
     * `undefined` — `actions.ts`'s own docblock states the convention).
     */
    x: CountSchema.exactOptional(),
    /**
     * CR 700.2's chosen mode (`mtg-bc2.152.4`), `x`'s shape exactly and for the
     * same reason: `exactOptional` so an old log with no `mode` key still
     * parses, and so this can assign into the kernel's `mode?: number` under
     * `exactOptionalPropertyTypes`.
     */
    mode: CountSchema.exactOptional(),
    /**
     * `TargetSpec.count`'s side-channel choice ("up to two target creatures",
     * `mtg-kg44`), mirroring `@mtg/kernel`'s `Action['castSpell'].multiTargets`
     * — `exactOptional` for the same backward-compatible reason `x` and `mode`
     * are: an old log with no counted-slot cast still parses. Keyed by string
     * rather than `CountSchema` because a JSON object's own keys are strings
     * regardless of what the kernel's `Record<number, …>` declares them as;
     * `StackEntry.multiTargets`' docblock in `@mtg/kernel` has the full shape.
     */
    multiTargets: z.record(z.string(), z.array(ObjectIdSchema)).exactOptional(),
  }),
  z.strictObject({
    type: z.literal('activateManaAbility'),
    player: PlayerIdSchema,
    oid: ObjectIdSchema,
    color: ManaColorSchema,
  }),
  z.strictObject({
    type: z.literal('activateAbility'),
    player: PlayerIdSchema,
    oid: ObjectIdSchema,
    abilityIndex: CountSchema,
    targets: z.array(TargetSlotSchema),
    /**
     * The permanents the activation cost ate (`ActivationCost.sacrificeOther`),
     * always present and empty when the cost names none. Required rather than
     * optional so the log has one spelling of "this activation sacrificed
     * nothing", the same reason the kernel's action carries it that way.
     */
    sacrifices: z.array(ObjectIdSchema),
    /**
     * The cards the activation cost discarded (`ActivationCost.discard`), CR
     * 601.2h. Optional rather than required, which is the opposite choice from
     * `sacrifices` directly above and is made for the reason that field's own
     * note gives in reverse: `sacrifices` was introduced with a version bump
     * that could afford to require it, and requiring this one would fail every
     * `activateAbility` record ever written. `exactOptional` for the reason
     * `x` states: the kernel's field is present-and-an-array or absent, never
     * present-and-`undefined`.
     */
    discards: z.array(ObjectIdSchema).exactOptional(),
    /**
     * CR 601.2b's announced X reached through CR 602.2b, mirroring
     * `@mtg/kernel`'s `Action['activateAbility'].x` (`mtg-nhyv.17`). The
     * `castSpell` field above, on the other action that announces one, and
     * optional for both the reasons that one gives: an `activateAbility` record
     * written before an ability could carry an X still parses, and
     * `exactOptional` is what lets it assign into the kernel's `x?: number`
     * under `exactOptionalPropertyTypes`.
     */
    x: CountSchema.exactOptional(),
  }),
  z.strictObject({
    type: z.literal('declareAttackers'),
    player: PlayerIdSchema,
    attackers: z.array(z.strictObject({ oid: ObjectIdSchema, defender: CombatDefenderSchema })),
    /**
     * How many of the creatures that could attack the declaration answers for,
     * absent when it answers for all of them (`mtg-tb7v` stage 2). A log that
     * required it would refuse every whole declaration ever recorded, and
     * `exactOptional` for the reason `x` above states: the kernel's field is
     * present-and-a-number or absent, never present-and-`undefined`.
     */
    settled: CountSchema.exactOptional(),
  }),
  z.strictObject({
    type: z.literal('declareBlockers'),
    player: PlayerIdSchema,
    blocks: z.array(z.strictObject({ blocker: ObjectIdSchema, attacker: ObjectIdSchema })),
    /** `declareAttackers.settled`, for the creatures that could block. */
    settled: CountSchema.exactOptional(),
  }),
  z.strictObject({
    type: z.literal('orderBlockers'),
    player: PlayerIdSchema,
    orders: z.array(z.strictObject({ attacker: ObjectIdSchema, blockers: z.array(ObjectIdSchema) })),
  }),
  z.strictObject({ type: z.literal('discard'), player: PlayerIdSchema, oids: z.array(ObjectIdSchema) }),
  /**
   * CR 103.4: the two answers an opening hand takes. `bottom` is empty for a
   * kept seven and holds one card per mulligan already taken otherwise.
   */
  z.strictObject({ type: z.literal('mulligan'), player: PlayerIdSchema }),
  z.strictObject({
    type: z.literal('keepHand'),
    player: PlayerIdSchema,
    bottom: z.array(ObjectIdSchema),
  }),
  /**
   * CR 603.3d and CR 603.3b: the two answers a triggered ability asks for.
   *
   * `oid` is the ability object on the stack (an `ab<n>`), never a card, which
   * is why it is not in the game record's object table and why `StackEntry`
   * carries a `source` for it.
   */
  z.strictObject({
    type: z.literal('chooseTriggerTargets'),
    player: PlayerIdSchema,
    oid: ObjectIdSchema,
    targets: z.array(TargetSlotSchema),
  }),
  z.strictObject({
    type: z.literal('answerOptionalTrigger'),
    player: PlayerIdSchema,
    oid: ObjectIdSchema,
    accept: z.boolean(),
  }),
  /**
   * CR 601.2c: a spell's "you may", `answerOptionalTrigger`'s shape widened
   * from a triggered ability to a spell (`mtg-bc2.152.4`). `oid` is the spell
   * on the stack, and unlike a trigger's `ab<n>` it is a card object already in
   * the game record's object table.
   */
  z.strictObject({
    type: z.literal('answerMay'),
    player: PlayerIdSchema,
    oid: ObjectIdSchema,
    accept: z.boolean(),
  }),
  /**
   * CR 118.8: the answer to a spell's printed toll. `player` is the seat the
   * spell was aimed at rather than the caster, and `pay` is `true` for the
   * answer that *stops* the spell, which is the opposite sense from
   * `answerMay`'s `accept` and is why the field is not called that.
   */
  z.strictObject({
    type: z.literal('answerUnless'),
    player: PlayerIdSchema,
    oid: ObjectIdSchema,
    pay: z.boolean(),
  }),
  /**
   * CR 704.5j: which same-named legendary permanent its controller kept. `oid`
   * is the survivor, so the record names what stayed rather than what left —
   * the losers are in the log already, as the zone changes that follow.
   */
  z.strictObject({ type: z.literal('keepLegend'), player: PlayerIdSchema, oid: ObjectIdSchema }),
  z.strictObject({
    type: z.literal('scry'),
    player: PlayerIdSchema,
    top: z.array(ObjectIdSchema),
    bottom: z.array(ObjectIdSchema),
  }),
  /**
   * CR 701.19a: the card a search took, or `null` for failing to find. Nullable
   * rather than an absent key, because "found nothing" is a choice the player
   * made and not a field the record omitted — CR 701.19c always offers it, so
   * the two answers have to be distinguishable in a log that no longer holds
   * the library.
   */
  z.strictObject({
    type: z.literal('searchLibrary'),
    player: PlayerIdSchema,
    found: z.union([ObjectIdSchema, z.null()]),
  }),
  /**
   * The card a resolving effect took out of a graveyard, or `null` for taking
   * none. Nullable for the search's reason above and not for its rule: no CR
   * 701.19c licenses this one, because a graveyard is public (CR 400.2) and
   * nothing was hidden to begin with. `null` is here because the DSL folds
   * "return a creature card" and "you may return a creature card" into one
   * effect, so declining is a move the player made and a reader has to be able
   * to see it.
   */
  z.strictObject({
    type: z.literal('chooseFromGraveyard'),
    player: PlayerIdSchema,
    chosen: z.union([ObjectIdSchema, z.null()]),
  }),
  /**
   * CR 701.8a: which cards a resolving effect discards. Its own variant rather
   * than a reuse of `discard` above, because that record answers the CR 514.1
   * cleanup step and a reader that collapsed the two would report a cleanup
   * where a spell had resolved. `player` is the seat that chose, which is the
   * hand's owner for `discardCards` and the effect's controller for
   * `chooseDiscard`; `oids` are always in hand order, because a partial
   * selection is a prefix and sorting one would corrupt it.
   */
  z.strictObject({
    type: z.literal('chooseDiscards'),
    player: PlayerIdSchema,
    oids: z.array(ObjectIdSchema),
  }),
  /**
   * CR 701.17a: which creature the target player sacrificed. `keepLegend`'s
   * shape above — one `oid` naming the choice made, never a list of what was
   * declined — because both rules offer no "none of these" arm: a legal
   * candidate always exists when either decision is asked at all.
   */
  z.strictObject({
    type: z.literal('sacrificePermanent'),
    player: PlayerIdSchema,
    oid: ObjectIdSchema,
  }),
  z.strictObject({ type: z.literal('concede'), player: PlayerIdSchema }),
]);

const AttackSchema = z.strictObject({ oid: ObjectIdSchema, defender: CombatDefenderSchema });
const BlockSchema = z.strictObject({ attacker: ObjectIdSchema, blockers: z.array(ObjectIdSchema) });

/** The kernel's `GameEvent` union, one strict variant per record it emits. */
export const EventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('gameStarted'), seed: z.string(), startingPlayer: PlayerIdSchema }),
  z.strictObject({ type: z.literal('libraryShuffled'), player: PlayerIdSchema, cards: CountSchema }),
  z.strictObject({ type: z.literal('cardDrawn'), player: PlayerIdSchema, oid: ObjectIdSchema }),
  z.strictObject({ type: z.literal('drawFromEmptyLibrary'), player: PlayerIdSchema }),
  z.strictObject({ type: z.literal('turnBegan'), turn: z.int(), active: PlayerIdSchema }),
  z.strictObject({
    type: z.literal('stepBegan'),
    turn: z.int(),
    step: StepSchema,
    active: PlayerIdSchema,
  }),
  z.strictObject({ type: z.literal('stepEnded'), turn: z.int(), step: StepSchema }),
  z.strictObject({ type: z.literal('permanentUntapped'), oid: ObjectIdSchema }),
  z.strictObject({ type: z.literal('untapSkipped'), oid: ObjectIdSchema }),
  z.strictObject({ type: z.literal('permanentTapped'), oid: ObjectIdSchema }),
  z.strictObject({ type: z.literal('summoningSicknessCleared'), oid: ObjectIdSchema }),
  z.strictObject({ type: z.literal('priorityGained'), player: PlayerIdSchema }),
  z.strictObject({ type: z.literal('priorityPassed'), player: PlayerIdSchema }),
  z.strictObject({ type: z.literal('landPlayed'), player: PlayerIdSchema, oid: ObjectIdSchema }),
  z.strictObject({
    type: z.literal('manaProduced'),
    player: PlayerIdSchema,
    sourceOid: ObjectIdSchema,
    color: ManaColorSchema,
    amount: z.int(),
  }),
  z.strictObject({ type: z.literal('manaPoolEmptied'), player: PlayerIdSchema, wasted: z.int() }),
  z.strictObject({
    type: z.literal('manaPaid'),
    player: PlayerIdSchema,
    cost: ManaCostSchema.strict(),
  }),
  z.strictObject({
    type: z.literal('spellCast'),
    player: PlayerIdSchema,
    oid: ObjectIdSchema,
    targets: z.array(TargetSlotSchema),
    chosenX: z.union([z.int().min(0).max(MAX_CHOSEN_X), z.null()]),
  }),
  z.strictObject({
    type: z.literal('spellCopied'),
    player: PlayerIdSchema,
    oid: ObjectIdSchema,
    copiedFrom: ObjectIdSchema,
    targets: z.array(TargetSlotSchema),
    chosenX: z.union([z.int().min(0).max(MAX_CHOSEN_X), z.null()]),
  }),
  z.strictObject({
    type: z.literal('abilityActivated'),
    player: PlayerIdSchema,
    oid: ObjectIdSchema,
    source: ObjectIdSchema,
    index: CountSchema,
    targets: z.array(TargetSlotSchema),
    /**
     * `spellCast`'s field on the other announcement (`mtg-nhyv.17`). The kernel
     * requires it, so this cannot be `exactOptional` the way the *action*'s `x`
     * is — an event that parsed without it would infer `number | null |
     * undefined` and stop assigning into `GameEvent`. `.default(null)` is the
     * shape that satisfies both halves: an `abilityActivated` line written
     * before an ability could announce an X reads back as `chosenX: null`, which
     * is exactly what it meant, and every `/8` file on disk still parses. That
     * is the same backward-compatible grant the version docblock above makes for
     * `activateAbility.discards`.
     */
    chosenX: z.union([z.int().min(0).max(MAX_CHOSEN_X), z.null()]).default(null),
  }),
  z.strictObject({
    type: z.literal('abilityTriggered'),
    player: PlayerIdSchema,
    oid: ObjectIdSchema,
    source: ObjectIdSchema,
    index: CountSchema,
    condition: TriggerConditionSchema,
  }),
  z.strictObject({
    type: z.literal('triggerTargetsChosen'),
    oid: ObjectIdSchema,
    source: ObjectIdSchema,
    targets: z.array(TargetSlotSchema),
  }),
  z.strictObject({ type: z.literal('triggerDeclined'), oid: ObjectIdSchema, source: ObjectIdSchema }),
  z.strictObject({
    type: z.literal('triggerRemoved'),
    oid: ObjectIdSchema,
    source: ObjectIdSchema,
    why: z.string(),
  }),
  z.strictObject({ type: z.literal('spellCountered'), oid: ObjectIdSchema, by: ObjectIdSchema }),
  z.strictObject({ type: z.literal('spellFizzled'), oid: ObjectIdSchema }),
  z.strictObject({ type: z.literal('spellDeclined'), oid: ObjectIdSchema, player: PlayerIdSchema }),
  z.strictObject({ type: z.literal('unlessPaid'), oid: ObjectIdSchema, player: PlayerIdSchema }),
  z.strictObject({ type: z.literal('resolutionBegan'), oid: ObjectIdSchema }),
  z.strictObject({
    type: z.literal('effectSkipped'),
    oid: ObjectIdSchema,
    index: z.int(),
    why: z.string(),
  }),
  z.strictObject({
    type: z.literal('zoneChanged'),
    oid: ObjectIdSchema,
    from: ZoneSchema,
    to: ZoneSchema,
    owner: PlayerIdSchema,
  }),
  z.strictObject({
    type: z.literal('permanentEntered'),
    oid: ObjectIdSchema,
    controller: PlayerIdSchema,
  }),
  z.strictObject({
    type: z.literal('tokenCreated'),
    oid: ObjectIdSchema,
    controller: PlayerIdSchema,
    name: z.string(),
  }),
  z.strictObject({
    type: z.literal('damageDealt'),
    sourceOid: ObjectIdSchema,
    target: DamageTargetSchema,
    amount: z.int(),
    deathtouch: z.boolean(),
    combat: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('damagePrevented'),
    sourceOid: ObjectIdSchema,
    target: DamageTargetSchema,
    amount: z.int(),
  }),
  z.strictObject({
    type: z.literal('replacementApplied'),
    id: z.string(),
    event: ReplaceableKindSchema,
  }),
  z.strictObject({
    type: z.literal('countersChanged'),
    oid: ObjectIdSchema,
    plusOnePlusOne: z.int(),
    minusOneMinusOne: z.int(),
    loyalty: z.int().optional(),
  }),
  z.strictObject({
    type: z.literal('lifeChanged'),
    player: PlayerIdSchema,
    delta: z.int(),
    life: z.int(),
    reason: LifeReasonSchema,
  }),
  z.strictObject({
    type: z.literal('continuousEffectAdded'),
    id: z.string(),
    targetOid: ObjectIdSchema,
    power: z.int(),
    toughness: z.int(),
    layer: z.string(),
  }),
  z.strictObject({
    type: z.literal('keywordGranted'),
    id: z.string(),
    targetOid: ObjectIdSchema,
    keyword: KeywordSchema,
    layer: z.string(),
  }),
  z.strictObject({ type: z.literal('continuousEffectsExpired'), ids: z.array(z.string()) }),
  z.strictObject({
    type: z.literal('permanentDestroyed'),
    oid: ObjectIdSchema,
    reason: DestroyReasonSchema,
  }),
  z.strictObject({
    type: z.literal('permanentSacrificed'),
    oid: ObjectIdSchema,
    player: PlayerIdSchema,
  }),
  z.strictObject({ type: z.literal('permanentRegenerated'), oid: ObjectIdSchema }),
  z.strictObject({
    type: z.literal('attackersDeclared'),
    player: PlayerIdSchema,
    attacks: z.array(AttackSchema),
  }),
  z.strictObject({
    type: z.literal('blockersDeclared'),
    player: PlayerIdSchema,
    blocks: z.array(BlockSchema),
  }),
  z.strictObject({
    type: z.literal('blockerOrderChosen'),
    attacker: ObjectIdSchema,
    blockers: z.array(ObjectIdSchema),
  }),
  z.strictObject({ type: z.literal('combatDamageStep'), firstStrike: z.boolean() }),
  z.strictObject({ type: z.literal('cardsMilled'), player: PlayerIdSchema, oids: z.array(ObjectIdSchema) }),
  z.strictObject({
    type: z.literal('cardsScried'),
    player: PlayerIdSchema,
    count: CountSchema,
    bottom: CountSchema,
  }),
  z.strictObject({
    type: z.literal('cardsDiscarded'),
    player: PlayerIdSchema,
    oids: z.array(ObjectIdSchema),
  }),
  z.strictObject({
    type: z.literal('handRevealed'),
    player: PlayerIdSchema,
    oids: z.array(ObjectIdSchema),
  }),
  z.strictObject({
    type: z.literal('libraryTopRevealed'),
    player: PlayerIdSchema,
    oids: z.array(ObjectIdSchema),
  }),
  /**
   * A boolean and no id, which is the kernel's own event verbatim
   * (`events.ts`): what a search found is published by the move that follows it
   * or is not published at all, and a log that carried the id would show a
   * replay viewer a card the seat across the table never saw.
   */
  z.strictObject({ type: z.literal('librarySearched'), player: PlayerIdSchema, found: z.boolean() }),
  /**
   * Ids where `librarySearched` above has none, and the pair is not a
   * contradiction: this event is emitted only when the card printed "reveal",
   * so the ids were shown to both seats at the table and a replay that hid them
   * would be showing less than the game did.
   */
  z.strictObject({
    type: z.literal('librarySearchRevealed'),
    player: PlayerIdSchema,
    oids: z.array(ObjectIdSchema),
  }),
  z.strictObject({
    type: z.literal('handMulliganed'),
    player: PlayerIdSchema,
    mulligans: CountSchema,
  }),
  z.strictObject({
    type: z.literal('handKept'),
    player: PlayerIdSchema,
    mulligans: CountSchema,
    bottomed: z.array(ObjectIdSchema),
  }),
  z.strictObject({ type: z.literal('damageCleared'), turn: z.int() }),
  z.strictObject({ type: z.literal('playerLost'), player: PlayerIdSchema, reason: EndReasonSchema }),
  z.strictObject({
    type: z.literal('gameEnded'),
    winner: z.union([PlayerIdSchema, z.null()]),
    reason: EndReasonSchema,
    turn: z.int(),
  }),
]);

const ManaPoolSchema = z.strictObject({
  W: CountSchema,
  U: CountSchema,
  B: CountSchema,
  R: CountSchema,
  G: CountSchema,
  C: CountSchema,
});

/**
 * One permanent as the board draws it. `power`/`toughness` are the *derived*
 * characteristics — what the layer system says right now — and are `null` for
 * anything that is not a creature, never a guessed zero.
 *
 * `attachedTo` is CR 701.3a's answer for this permanent and `null` when it is
 * attached to nothing, which is every permanent in a game with no Equipment in
 * it. Required and nullable rather than optional, for the reason `sacrifices`
 * above is: the log gets one spelling of "attached to nothing" instead of two.
 * There is no list in the other direction — what is attached to a creature is
 * every permanent naming it here, and a second field would be a second place
 * for the same fact to be wrong.
 */
export const BoardPermanentSchema = z.strictObject({
  oid: ObjectIdSchema,
  controller: PlayerIdSchema,
  tapped: z.boolean(),
  summoningSick: z.boolean(),
  damage: CountSchema,
  plusCounters: CountSchema,
  minusCounters: CountSchema,
  /** Present in `/5` recordings; absent in released `/3` and `/4` snapshots. */
  loyalty: CountSchema.optional(),
  power: z.union([z.int(), z.null()]),
  toughness: z.union([z.int(), z.null()]),
  attachedTo: z.union([ObjectIdSchema, z.null()]),
  attacking: z.boolean(),
  blocking: z.boolean(),
});

export const SeatStateSchema = z.strictObject({
  life: z.int(),
  hand: z.array(ObjectIdSchema),
  library: CountSchema,
  graveyard: z.array(ObjectIdSchema),
  pool: ManaPoolSchema,
  lost: z.boolean(),
});

/**
 * One thing waiting to resolve.
 *
 * `source` is the permanent an activated ability was printed on, and `null` for
 * a spell, which is its own object. An ability on the stack is an object with
 * no card (CR 113.7a) and the kernel gives it an `ab<n>` id that never enters
 * the object table, so without this field the entry named an id the log could
 * not resolve: the reader refused the file, and every viewer that got past it
 * had nothing to draw. The first recorded game to activate anything but a mana
 * ability is what found that, which is `equip.test.ts`.
 */
export const StackEntrySchema = z.strictObject({
  oid: ObjectIdSchema,
  controller: PlayerIdSchema,
  /** The physical card whose face this spell or ability uses. */
  card: ObjectIdSchema,
  source: z.union([ObjectIdSchema, z.null()]),
  copiedFrom: z.union([ObjectIdSchema, z.null()]),
  chosenX: z.union([z.int().min(0).max(MAX_CHOSEN_X), z.null()]),
  triggerContext: z.union([
    z.strictObject({
      // The conditions that retain a creature from their own event, taken from
      // the DSL's one list rather than restated here. Restating them is what
      // went wrong: `selfBlocksOrIsBlockedByGreaterPower` joined the kernel's
      // `TriggerContextKind` and this enum still named two, so the first
      // recorded game in which a flurry-rush trigger reached the stack was
      // refused by its own recorder and the launcher stopped with a schema
      // error naming neither the card nor the condition. The list is in
      // `@mtg/dsl` and not in `@mtg/kernel` because this route may not import
      // the kernel at all (`record.test.ts` fails the build if it does): a
      // viewer that can reach the engine is a second engine that can disagree
      // with the first. Importing it keeps a rejected log the answer for a kind
      // the kernel does not have, and never for one it does.
      kind: z.enum(TRIGGERING_CREATURE_CONDITIONS),
      triggeringCreature: ObjectIdSchema,
    }),
    z.null(),
  ]),
  sourceCharacteristics: z.union([
    z.strictObject({
      colors: z.array(z.enum(['W', 'U', 'B', 'R', 'G'])),
      subtypes: z.array(z.string()),
    }),
    z.null(),
  ]),
  /**
   * CR 700.2's chosen mode (`mtg-bc2.152.4`), mirroring `@mtg/kernel`'s
   * `StackEntry.mode` — `null` for every ability entry and for a spell with no
   * `modes` to choose among, an index into `card.modes` otherwise.
   *
   * `.default(null)` rather than required-plus-a-version-bump, unlike
   * `chosenX`/`copiedFrom`/`triggerContext`/`sourceCharacteristics` above:
   * those fields' bumps (`/4`, `/6`, `/7`) each paired with a backfill branch
   * in `read-log.ts`'s per-version `migrateStep`, and that file already keys
   * three branches to the literal `/8` string for scry's own bump — bumping
   * this file's version without updating them would silently misclassify
   * every freshly-recorded `/9` game as pre-`/8` for scry migration, which is
   * a worse bug than the one this field fixes. `mtg-7si0` is scoped to this
   * file, `record-replay.ts` and `frame.ts`; a `/9` bump that pairs correctly
   * with `read-log.ts` is a follow-up. `.default(null)` means an already-
   * recorded `/8` file's stack entry — which never carried this key — reads
   * as "no mode chosen," indistinguishable here from the true case; the
   * producer (`record-replay.ts`'s `snapshotOf`) always writes the key
   * explicitly going forward, and `StackEntryKeysCovered` there is what
   * catches the next kernel field this transform would otherwise drop
   * silently, the way this one was.
   */
  mode: z.union([CountSchema, z.null()]).default(null),
  targets: z.array(TargetSlotSchema),
  /**
   * The objects chosen for a counted slot ("up to two target creatures",
   * `mtg-kg44`), keyed by the slot's index in `targets`. Absent rather than
   * `null` when the entry has no counted slot, which is every entry in every
   * committed fixture: the kernel's own field is optional for the same reason,
   * and an omitted key leaves a `/8` file byte-identical to what it already is.
   * The frame does not draw these yet; the log carries them so that the day a
   * counted spell reaches a recorded stack, the record is not missing the half
   * of the cast that says what it hit.
   */
  multiTargets: z.record(z.string(), z.array(ObjectIdSchema)).optional(),
});

/**
 * The board after a step. Deliberately holds no priority marker: priority
 * changes on nearly every decision, and carrying it here would defeat the
 * carry-forward dedup that keeps a 300-decision game a readable file. The
 * viewer reads priority off the *next* step's decision, which is the seat the
 * kernel asks from exactly this state.
 */
export const SnapshotSchema = z.strictObject({
  seats: z.tuple([SeatStateSchema, SeatStateSchema]),
  battlefield: z.array(BoardPermanentSchema),
  exile: z.array(ObjectIdSchema),
  stack: z.array(StackEntrySchema),
});

const DecisionKindSchema = z.enum([
  // CR 103.4, asked before turn 1 and the only decision a game can hold while
  // `turn.number` is still 0.
  'mulligan',
  'priority',
  'declareAttackers',
  'declareBlockers',
  'orderBlockers',
  'discard',
  // CR 603.3d and CR 603.3b. Both are stops inside the settle loop rather than
  // priority windows, which the log does not have to model: a decision is a
  // decision, and the record already carries the kind, the options and the
  // index chosen.
  'triggerTargets',
  'optionalTrigger',
  // CR 601.2c, `optionalTrigger`'s shape widened to a spell (`mtg-bc2.152.4`):
  // still a stop inside the settle loop rather than a priority window.
  'may',
  // CR 118.8, the same stop addressed to the seat the spell is aimed at rather
  // than to a seat the card names (`mtg-3zjg`).
  'unless',
  // CR 704.5j, the one decision a state-based action raises rather than the
  // stack, and the one whose asked player is neither the active player nor the
  // holder of priority.
  'legendRule',
  'scry',
  // CR 701.19a, `scry`'s stop with a different question: both pause a
  // resolution mid-way (`@mtg/kernel`'s `scry.ts` runs both), and neither is a
  // priority window.
  'searchLibrary',
  // The one stop `scry.ts` runs on a zone both seats can already see, which is
  // why it carries no CR cite for the pause itself: nothing in the rules
  // licenses looking, because nothing was hidden.
  'graveyardChoice',
  // CR 701.8a, the third stop `scry.ts` runs. Distinct from `discard` above,
  // which is the CR 514.1 cleanup step: this one is a resolution paused
  // mid-way, and the seat it asks is not always the seat losing the cards.
  'handDiscard',
  // CR 701.17a, the fourth stop `scry.ts` runs and the second on a zone both
  // seats can already see (`graveyardChoice`'s reason, the battlefield rather
  // than a graveyard). Distinct from every other member: the asked seat is
  // always the effect's target, never the caster.
  'permanentSacrifice',
]);

/**
 * What the kernel asked and what it was willing to accept.
 *
 * `optionCount` is the true size of the enumerated space; `options` may hold a
 * prefix of it when a declaration space is large. `chosen` indexes `options`
 * and is `null` when the bot constructed a declaration of its own rather than
 * picking a listed one — which is a thing the tier-1 bots legitimately do, and
 * exactly the thing a viewer should make visible.
 */
export const DecisionSchema = z.strictObject({
  kind: DecisionKindSchema,
  player: PlayerIdSchema,
  optionCount: CountSchema,
  truncated: z.boolean(),
  complete: z.boolean(),
  options: z.array(ActionSchema),
  chosen: z.union([z.int().min(0), z.null()]),
});

export const ResultSchema = z.strictObject({
  winner: z.union([PlayerIdSchema, z.null()]),
  loser: z.union([PlayerIdSchema, z.null()]),
  reason: EndReasonSchema,
  endedOnTurn: z.int(),
});

export const HeaderRecordSchema = z.strictObject({
  record: z.literal('header'),
  schema: z.enum(READABLE_EVENT_LOG_SCHEMA_VERSIONS),
  source: z.string(),
  games: CountSchema,
});

export const GameRecordSchema = z.strictObject({
  record: z.literal('game'),
  game: CountSchema,
  seed: z.string(),
  startingPlayer: PlayerIdSchema,
  maximumTurns: z.int(),
  seats: z.tuple([
    z.strictObject({ bot: z.string(), deck: z.string() }),
    z.strictObject({ bot: z.string(), deck: z.string() }),
  ]),
  cards: z.record(z.string(), CardSchema),
  objects: z.record(
    z.string(),
    z.strictObject({ card: z.string(), owner: PlayerIdSchema, token: z.boolean() }),
  ),
  steps: CountSchema,
  result: ResultSchema,
});

export const StepRecordSchema = z.strictObject({
  record: z.literal('step'),
  game: CountSchema,
  seq: CountSchema,
  turn: z.int(),
  step: StepSchema,
  active: PlayerIdSchema,
  decision: z.union([DecisionSchema, z.null()]),
  action: z.union([ActionSchema, z.null()]),
  events: z.array(EventSchema),
  state: z.union([SnapshotSchema, z.null()]),
});

export const LogRecordSchema = z.discriminatedUnion('record', [
  HeaderRecordSchema,
  GameRecordSchema,
  StepRecordSchema,
]);

export type LogPlayerId = z.infer<typeof PlayerIdSchema>;
export type LogTarget = z.infer<typeof TargetSchema>;
export type LogAction = z.infer<typeof ActionSchema>;
export type LogEvent = z.infer<typeof EventSchema>;
export type LogEventType = LogEvent['type'];
export type LogStep = z.infer<typeof StepSchema>;
export type LogSnapshot = z.infer<typeof SnapshotSchema>;
export type LogSeatState = z.infer<typeof SeatStateSchema>;
export type LogBoardPermanent = z.infer<typeof BoardPermanentSchema>;
export type LogStackEntry = z.infer<typeof StackEntrySchema>;
export type LogDecision = z.infer<typeof DecisionSchema>;
export type LogDecisionKind = LogDecision['kind'];
export type LogResult = z.infer<typeof ResultSchema>;
export type HeaderRecord = z.infer<typeof HeaderRecordSchema>;
export type GameRecord = z.infer<typeof GameRecordSchema>;
export type StepRecord = z.infer<typeof StepRecordSchema>;
export type LogRecord = z.infer<typeof LogRecordSchema>;
