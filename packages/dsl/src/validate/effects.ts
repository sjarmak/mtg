/**
 * Effect-parameter sanity, per-effect targeting legality, and effect placement
 * by card type.
 *
 * A card's own `effects` list is what a spell does when it resolves, so it is
 * legal only on instants and sorceries. A permanent's effects are printed
 * inside a triggered ability and validated there (`validate/abilities.ts`),
 * which is what `checkEffects` tells an author to do rather than refusing the
 * effect outright. `checkEffectParams` and `LIMITS` are exported to that file
 * so one range table covers both placements.
 *
 * Everything this file knows *per primitive* is stated once, in `EFFECT_RULES`.
 * `LEGAL_TARGETS`, `HAND_AUTHORED_TARGETS` and `checkEffectParams` keep their
 * names and their behavior and are now derived from it, so adding a primitive to
 * the vocabulary is one row here rather than a targeting entry and a `switch`
 * arm a reader has to know to write in two places.
 */
import type { PumpAmount } from '../amount';
import { isLiteralAmount, isRateAmount } from '../amount';
import type { Card } from '../card';
import type { AnyEffectKind, CardFilter, Effect, TargetedEffect, TokenSpec } from '../effects';
import {
  effectAllowsTargetCount,
  effectChoosesTarget,
  hasTarget,
  isCreatureTokenSpec,
  isSourceBodyEffect,
  MAX_MANA_PRODUCED,
  referentSourceIndex,
} from '../effects';
import { tokenCard } from '../token';
import { canonicalJson } from '../canonical-json';
import { manaValue } from '../mana';
import { UNLESS_PAYER_TARGETS, unlessPayerPhrase } from '../unless';
import { withArticle } from '../text-util';
import type { TargetFilter, TargetKind, TargetSpec } from '../targets';
import {
  cardTypeFilterFitsTargetKind,
  filterFitsTargetKind,
  isAttackTriggerOnlyTarget,
  isSourceBodyOnlyTarget,
  referentSourceSpace,
  requiresDistinctTarget,
  restrictionFitsTargetKind,
  targetCountOf,
  targetFilterIsEmpty,
  targetFilterOf,
  targetKindNamesACreature,
  targetKindNamesAPlayer,
  targetKindsCanCollide,
  targetRestrictionOf,
} from '../targets';
import type { Violation, ViolationCode } from '../violations';
import { violation } from '../violations';
import { checkAbilities } from './abilities';
import { checkKeywords } from './typeline';
import type { CardKind, Color } from '../vocabulary';
import type { EffectScope } from '../vocabulary';
import {
  ALL_EFFECT_KINDS,
  CARD_KINDS,
  EFFECT_SCOPE_SUBJECT,
  PERMANENT_CARD_KINDS,
  SPELL_CARD_KINDS,
  SUBTYPE_PATTERN,
  TOKEN_NAME_MAX_LENGTH,
  TOKEN_NAME_PATTERN,
  sortColors,
} from '../vocabulary';

/** The one effect the union carries for a given kind. */
type EffectOf<K extends AnyEffectKind> = Extract<Effect, { readonly kind: K }>;

/**
 * The target kinds a `pumpUntilEndOfTurn` keyword rider may ride on.
 *
 * A subset of the pump's own slots rather than all of them, and the missing
 * three say why: `targetPlayer` and `targetOpponent` are the handle a *scope*
 * reads a group off, and `noTarget` is the untargeted sweeper's slot. None of
 * the three names a body, so a keyword hung on one is a grant with no recipient
 * — it would parse, print a sentence, and land on nobody, which is the same
 * silent no-op `UNSCOPED_MAY_NAME_A_PLAYER` refuses further down this file.
 *
 * `targetCreatureDefendingPlayerControls` is here beside the two obvious ones
 * because it is a creature slot like any other; the rule that keeps it to a
 * `selfAttacks` trigger is `checkAbilityEffectTarget`'s and not this one's.
 */
const PUMP_KEYWORD_RIDER_TARGETS: readonly TargetKind[] = [
  'targetCreature',
  'targetCreatureDefendingPlayerControls',
  'selfCreature',
];

/**
 * The two rules that keep the keyword rider from being a second spelling of
 * something the vocabulary already says.
 *
 * The scope rule is the load-bearing one, and what it protects changed when
 * `grantKeywordUntilEndOfTurn` grew a scope of its own (`mtg-nhyv.15`). It used
 * to say a mass grant was a capability nothing had, so a scoped pump wearing a
 * rider would reach it sideways for the cards that happen to also pump. Now the
 * mass grant has a name, and the rule says the same thing from the other end: a
 * scoped pump with a keyword on it and a scoped pump beside a scoped grant are
 * one card with two encodings, and two encodings do not compare byte-identical
 * under `canonicalJson`. A vocabulary with one word for a thing is the property
 * this package exists to hold either way.
 *
 * The target rule is the plain one: a rider needs a body to land on.
 */
function checkPumpKeywordRider(effect: EffectOf<'pumpUntilEndOfTurn'>, path: string): readonly Violation[] {
  if (effect.keyword === undefined) return [];
  const found: Violation[] = [];
  if (effect.scope !== undefined) {
    found.push(
      violation(
        'ILLEGAL_EFFECT_SCOPE',
        path,
        'a keyword rider names one body, so it cannot ride a scoped pump; a mass keyword grant is spelled as a scoped grantKeywordUntilEndOfTurn beside the pump',
      ),
    );
  }
  if (!PUMP_KEYWORD_RIDER_TARGETS.includes(effect.target.kind)) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FOR_EFFECT',
        path,
        `a keyword rider needs a creature to land on and "${effect.target.kind}" names none`,
      ),
    );
  }
  return found;
}

/**
 * Everything the pump's two magnitudes have to be, including the three ways a
 * rate can be written down that no card can print.
 *
 * The rate rules are all one rule seen from three sides: Magic names the count
 * once, at the end of the sentence, and that one clause covers the whole P/T
 * line ("All creatures get -1/-1 until end of turn for each Swamp you
 * control"). So both halves are rates or neither is — a numeral beside a rate
 * would need two clauses in a frame that has room for one — and two rates are
 * charged against the same tally, because the sentence has one "for each" in it
 * and no way to say which half the second tally belongs to.
 *
 * They are refused here rather than in the schema because `RatePerSchema` is
 * declared once and used in two independent fields; a schema that could see
 * across the pair would have to be a schema for the pair, which is a second
 * spelling of the pump. `renderPump` throws on both shapes rather than
 * inventing a sentence for them, and this is the check whose absence would let
 * one reach it.
 *
 * The no-op rule reads the rates as well as the numerals for the same reason it
 * exists at all: `+0/+0 for each Swamp you control` is a no-op with extra words
 * on it, and the vocabulary already has one spelling of "does nothing" too many.
 */
/**
 * The two numerals a base P/T set may print.
 *
 * `checkRange` rather than `checkAmountRange`, and the difference is the whole
 * shape of the kind: a pump's halves are `Amount`s because a pump may count
 * something, and these are plain integers because a base P/T that counts
 * something is layer 7a and a different record (`effects.ts` argues it at the
 * factory). There is no no-op rule to write either — "base power and toughness
 * 0/1" says something about a 5/5 that "+0/+0" never says.
 */
function checkBasePtParams(effect: EffectOf<'setBasePtUntilEndOfTurn'>, path: string): Violation[] {
  return [
    ...checkRange(effect.power, LIMITS.basePower, `${path}.power`, 'base power'),
    ...checkRange(effect.toughness, LIMITS.baseToughness, `${path}.toughness`, 'base toughness'),
  ];
}

function checkPumpParams(effect: EffectOf<'pumpUntilEndOfTurn'>, path: string): Violation[] {
  const found = [
    ...checkAmountRange(effect.power, LIMITS.pumpDelta, `${path}.power`, 'power delta'),
    ...checkAmountRange(effect.toughness, LIMITS.pumpDelta, `${path}.toughness`, 'toughness delta'),
  ];
  const power = effect.power;
  const toughness = effect.toughness;
  if (isRateAmount(power) !== isRateAmount(toughness)) {
    found.push(
      violation(
        'PUMP_RATE_INVALID',
        path,
        'a rate covers the whole stat line, so both halves of the pump must be rates or neither may be',
      ),
    );
  } else if (
    isRateAmount(power) &&
    isRateAmount(toughness) &&
    canonicalJson(power.each) !== canonicalJson(toughness.each)
  ) {
    found.push(
      violation(
        'PUMP_RATE_INVALID',
        path,
        'a pump prints one "for each" clause, so both halves must be charged against the same tally',
      ),
    );
  }
  const noop = isRateAmount(power)
    ? isRateAmount(toughness) && power.rate === 0 && toughness.rate === 0
    : power === 0 && toughness === 0;
  if (noop) {
    // Said unconditionally, keyword rider or not. "Gains flying until end
    // of turn" already has an encoding — `grantKeywordUntilEndOfTurn` — and
    // a +0/+0 pump wearing the rider would be a second spelling of it that
    // does not compare byte-identical under `canonicalJson`, which is the
    // ambiguity `TargetSpecSchema` pins `distinct` to `literal(true)` for.
    found.push(
      violation('EFFECT_PARAM_OUT_OF_RANGE', path, 'a +0/+0 pump is a no-op; give it a nonzero delta'),
    );
  }
  return [...found, ...checkPumpKeywordRider(effect, path)];
}

/**
 * What the validator knows about one effect primitive: where it may point, and
 * what its own parameters must be.
 *
 * One declaration per primitive rather than a targeting table here and a
 * `switch` over the same discriminant a hundred lines down, for the reason
 * `counters.ts` gives at its own `DECLARATIONS`. The two questions arrive
 * together — an effect that takes a target takes parameters — and splitting them
 * made adding a primitive two edits a reader had to know to make twice.
 */
interface EffectRules<K extends AnyEffectKind = AnyEffectKind> {
  /**
   * Per-effect targeting legality **the set generator is held to**, and the
   * exact bytes the fill prompt prints.
   *
   * The second half of that sentence is not a note, it is why this is one field
   * of two. `@mtg/setgen`'s `vocabularySection` writes
   * `target.kind: ${LEGAL_TARGETS[kind].join(' | ')}` straight into the prompt,
   * and a fixture key is a hash of the prompt, so a member added to a row a slot
   * can offer renames every recorded response behind it. Adding `targetOpponent`
   * to `dealDamage` here was tried and did exactly that: four assertions across
   * two recorded runs went looking for fixture `8a81986a…` and it no longer
   * existed. A re-record costs paid model calls, which is a decision belonging
   * to whoever authorizes a generation run rather than to a kernel change.
   *
   * So everything here is something the generator could be shown, and
   * `handAuthoredTargets` holds what only a hand-written card may name. An
   * unpriced kind is safe here — `vocabularySection` only ever asks about kinds
   * a slot offers, and no slot can offer one.
   */
  readonly generatableTargets: readonly TargetKind[];
  /**
   * Target kinds a **hand-authored** card may name that the generator may not.
   *
   * One row carries this, and it is the whole point of the split: "target
   * opponent" is CR 115.4's restriction, the engine now enforces it, and
   * `dealDamage` is the row the card that asked for it needs. Writing it here
   * rather than in `generatableTargets` keeps the prompt's bytes and every
   * recorded fixture exactly where they were.
   *
   * A field here is not a widening deferred. It is a statement that the engine
   * enforces a restriction the model is not taught, which is the same asymmetry
   * `MODEL_TARGET_KINDS` and `ModelEffectSchema` already carry — the generator's
   * output space stays *inside* the engine's, never equal to it. When a
   * generation run is authorized and its fixtures are re-recorded anyway, moving
   * an entry into `generatableTargets` is what admitting it costs.
   *
   * Absent and empty mean the same thing, so a row with nothing extra to say
   * omits it rather than writing an empty array.
   */
  readonly handAuthoredTargets?: readonly TargetKind[];
  /**
   * Range and shape of this effect's own parameters, wherever it is printed.
   * Reached from a spell's effect list and from a triggered ability's
   * (`validate/abilities.ts`), so one range table covers both placements.
   */
  readonly checkParams: (effect: EffectOf<K>, path: string, cardColors: readonly Color[]) => Violation[];
}

/**
 * Every primitive's rules. Mapped over the whole union, so a primitive added to
 * the vocabulary without stated targeting and parameter rules is a compile error
 * here, exactly as the `assertNever` default it replaces was.
 */
export type EffectRulesTable = { readonly [K in AnyEffectKind]: EffectRules<K> };

/**
 * One row with the caller's kind unknown: the union of the rows, not
 * `EffectRules<AnyEffectKind>`. `checkParams`'s parameter is contravariant, so
 * the widened row is a type no row satisfies.
 */
type EffectRulesRow = EffectRulesTable[AnyEffectKind];

/** Nothing to check: the effect carries no parameters of its own. */
const noParams = (): Violation[] => [];

export const EFFECT_RULES: EffectRulesTable = {
  dealDamage: {
    generatableTargets: ['anyTarget', 'targetCreature', 'targetPlayer'],
    // `targetPlayerOrPlaneswalker` is the current Oracle wording of every burn
    // spell printed before planeswalkers were folded into the damage rules, and
    // it is hand-authored for `targetOpponent`'s reason at this same field: the
    // fill prompt prints the generatable list verbatim and every recorded
    // fixture is keyed to those bytes. Lava Axe and Chandra's Fury are the M13
    // cards that read it.
    //
    // `noTarget` is the board sweep's slot and only the board sweep's: Pyroclasm
    // and Rain of Blades choose nothing (CR 115.1) and read a region of the
    // board instead, so the target spec has to be able to say "nobody".
    // `checkEffectScope` refuses the pairing this opens up — an unscoped damage
    // aimed at nobody, which would resolve into no game action at all.
    //
    // `thatCreaturesController` is Chandra's Outrage (M11 #128), the card this
    // whole referent lane exists for: "deals 4 damage to target creature and 2
    // damage to that creature's controller". Hand-authored for the reason every
    // other kind at this field is — the fill prompt prints the generatable list
    // verbatim and every recorded fixture is keyed to those bytes — and only
    // this one of the three referents, because no card in M11 or M13 deals
    // damage to a creature an earlier slot already chose, and a widening
    // arrives with the card that needs it.
    handAuthoredTargets: [
      'targetOpponent',
      'targetPlayerOrPlaneswalker',
      'noTarget',
      'thatCreaturesController',
    ],
    checkParams: (effect, path) => checkAmountRange(effect.amount, LIMITS.damage, `${path}.amount`, 'damage'),
  },
  destroyPermanent: {
    generatableTargets: ['targetCreature'],
    // The sweeper half, hand-authored for the reason `putCounters`'s row gives
    // at the same field: a scoped form reaches a *player* and the permanents
    // are not targets (CR 115.1), and this kind is priced, so the fill prompt
    // prints its generatable list verbatim and every recorded fixture is keyed
    // to those bytes. Both player kinds, because a one-sided sweep is a card
    // aimed either way and neither direction is a gift to the wrong player.
    //
    // `targetArtifactOrEnchantment` is Disenchant, and it is hand-authored for
    // the first of those reasons only: the kind is legal in the engine and the
    // prompt's bytes are what keep it out of a generated card for now. This is
    // the row that made `removalArtifactEnchantment` print a tap instead.
    //
    // `targetPermanent` is the widest of them and the one the filter narrows:
    // Craterize, Demolish, Acidic Slime and Smelt are four printed cards that
    // differ only in which card types they admit, so the space is every
    // permanent and `TargetSpec.filter` says which. Hand-authored for the same
    // prompt-bytes reason as its neighbors.
    //
    // `noTarget` is Day of Judgment's slot, added with the untargeted scopes:
    // "destroy all creatures" chooses nothing (CR 115.1), so the space scope
    // needs a target spec that says so. `checkEffectScope` refuses an unscoped
    // destroy aimed at nobody.
    handAuthoredTargets: [
      'targetPlayer',
      'targetOpponent',
      'targetArtifactOrEnchantment',
      'targetPermanent',
      'noTarget',
    ],
    checkParams: noParams,
  },
  pumpUntilEndOfTurn: {
    generatableTargets: ['targetCreature'],
    // CR 506.2's defending player, and the second row to state a hand-authored
    // extra. It sits here rather than in `generatableTargets` for the reason
    // `dealDamage`'s `targetOpponent` does — the prompt prints the generatable
    // half verbatim and every recorded fixture is keyed to those bytes — and
    // for a second reason of its own: the kind is legal only under a
    // `selfAttacks` trigger, and a slot menu cannot say that, so a generator
    // shown it would answer with it on a spell and fail validation.
    //
    // `selfCreature` is listed here, unlike `triggeringCreature` two rows up,
    // because the two kinds are gated at different layers. `triggeringCreature`
    // needs an ability-*condition* permission this table cannot express
    // (exalted, or `selfDealsCombatDamageToCreature`), so it bypasses this list
    // entirely through `checkAbilityEffectTarget`'s own permission check.
    // `selfCreature` needs only a fact about the *card* (`card.kind ===
    // 'creature'`), which `checkSelfCreatureTarget` (`validate/abilities.ts`)
    // checks independently of this list rather than instead of it — so this
    // row still has to say the kind is targeting-legal on `pumpUntilEndOfTurn`
    // at all, the same statement every other member of this array makes.
    //
    // `noTarget` is Glorious Charge's slot, added with the untargeted scopes for
    // the reason `destroyPermanent`'s row gives at the same field.
    handAuthoredTargets: [
      'targetCreatureDefendingPlayerControls',
      'targetPlayer',
      'targetOpponent',
      'selfCreature',
      'noTarget',
    ],
    checkParams: (effect, path) => checkPumpParams(effect, path),
  },
  drawCards: {
    generatableTargets: ['noTarget', 'targetPlayer'],
    checkParams: (effect, path) => checkAmountRange(effect.count, LIMITS.draw, `${path}.count`, 'card count'),
  },
  gainLife: {
    generatableTargets: ['noTarget', 'targetPlayer'],
    checkParams: (effect, path) =>
      checkAmountRange(effect.amount, LIMITS.life, `${path}.amount`, 'life amount'),
  },
  counterSpell: {
    generatableTargets: [],
    // The one row whose parameters include a filter, because this is the one
    // primitive that narrows its target without carrying a `TargetSpec`: a
    // spell on the stack is outside the pinned targeting vocabulary, so Essence
    // Scatter and Negate say which spell through `spellFilter` instead.
    checkParams: (effect, path) => checkSpellFilter(effect.spellFilter, `${path}.spellFilter`),
  },
  createToken: {
    generatableTargets: [],
    checkParams: (effect, path, cardColors) => [
      ...checkAmountRange(effect.count, LIMITS.tokenCount, `${path}.count`, 'token count'),
      ...checkTokenSpec(effect.token, `${path}.token`, cardColors),
    ],
  },
  tapPermanent: {
    generatableTargets: ['targetCreature'],
    // The sweeper half, hand-authored for the reason `putCounters`'s row gives
    // at the same field: a scoped form reaches a *player* and the permanents
    // are not targets (CR 115.1), and this kind is priced, so the fill prompt
    // prints its generatable list verbatim and every recorded fixture is keyed
    // to those bytes. Both player kinds, because a one-sided sweep is a card
    // aimed either way and neither direction is a gift to the wrong player.
    //
    // `thatCreature` is Stabbing Pain (M11 #118): "Target creature gets -1/-1
    // until end of turn. Tap that creature." The pump slot ahead of it is the
    // one this kind reads (`referentSourceIndex`), and it needed no permission
    // of its own — a back-reference widens the row it is printed on, never the
    // row it points at.
    handAuthoredTargets: ['targetPlayer', 'targetOpponent', 'thatCreature'],
    checkParams: noParams,
  },
  returnToHand: {
    generatableTargets: ['targetCreature'],
    // Blue's answer to a permanent it cannot destroy, and the reason this kind
    // is on three rows rather than one: without it a color with no destroy has
    // no answer to an artifact at all, which is a hole in the pie rather than a
    // deliberate weakness. Hand-authored because the prompt prints the
    // generatable half verbatim and every recorded fixture is keyed to it.
    handAuthoredTargets: ['targetArtifactOrEnchantment'],
    checkParams: noParams,
  },
  millCards: {
    generatableTargets: ['noTarget', 'targetPlayer'],
    // Mind Sculpt (M13 61) is "target opponent mills seven cards", and the
    // restriction is the whole card: a mill aimed at yourself is a self-mill
    // deck's engine and a mill aimed at the table is a different, symmetrical
    // effect. `discardCards` above carries the identical pair for the identical
    // reason — `MODEL_TARGET_KINDS` is the frozen four and has no
    // `targetOpponent`, so the narrow kind is stated here where it costs
    // nothing rather than in the prompt where it would re-record every fixture.
    handAuthoredTargets: ['targetOpponent'],
    checkParams: (effect, path) => checkAmountRange(effect.count, LIMITS.mill, `${path}.count`, 'mill count'),
  },
  putCounters: {
    // Fuse reads "target creature you control", and this is the only row that
    // may say so. `targetCreatureYouControl` arrived for that card; offering it
    // to `destroyPermanent` or a pump as well would be four rows widened by a
    // card nobody has designed, which is the growth this table is written by
    // hand to stop. The wider `targetCreature` stays legal beside it, because a
    // part fused onto an opponent's creature is a legal play and a bad one.
    generatableTargets: ['targetCreature', 'targetCreatureYouControl'],
    // The sweeper half, and it is hand-authored rather than generatable for the
    // reason `dealDamage`'s row states: this kind is priced, so the fill prompt
    // prints its generatable list verbatim and every recorded fixture is keyed
    // to those bytes. A scoped `putCounters` reaches a player and a player is
    // the one thing the unscoped form must never name, so the widening lands
    // here where no prompt can see it.
    //
    // `selfPermanent` is the flagship set's Trisigil cycle (`mtg-rji`): a
    // legendary artifact whose own upkeep trigger puts a counter on the
    // artifact. Before this word that card was unprintable twice over — no
    // kind in this row reached the ability's own source at all, and the one
    // kind that reaches a source anywhere in the vocabulary, `selfCreature`,
    // is refused on a card that is not a creature. It is hand-authored for the
    // same fixture-bytes reason as the row above, and it earns a second one:
    // the generator picks a slot's target from a menu with no card in front of
    // it, so a menu that offered "the source itself" would put the word on
    // spells, where `checkEffectTarget` refuses it.
    //
    // Deliberately not paired with `selfCreature` here. A creature that pumps
    // itself or grants itself a keyword says `selfCreature`; a permanent that
    // puts a counter on itself says `selfPermanent`; and the three effect kinds
    // involved partition cleanly, so no effect kind admits both and there is
    // never a card with two spellings of one sentence.
    //
    // `noTarget` is Steel Overseer's slot (M11 214, `mtg-hfex`), and it arrives
    // with `permanentsYouControl` in `SCOPES_LEGAL_ON` below for the reason
    // `destroyPermanent`'s row gives at the same field: "put a +1/+1 counter on
    // each artifact creature you control" chooses nothing (CR 115.1) and reads
    // a region of the board, so the target spec has to be able to say "nobody".
    // `checkEffectScope` refuses the pairing it opens up — an unscoped counter
    // placement aimed at nobody, which would resolve into no game action.
    //
    // `targetCreatureDefendingPlayerControls` is CR 506.2's defending player,
    // hand-authored here for `pumpUntilEndOfTurn`'s two reasons at the same
    // field (`mtg-fz3s`): the generatable half's bytes are printed verbatim
    // into the fill prompt, and the kind is legal only under a `selfAttacks`
    // trigger, which a slot menu cannot say. "Whenever this creature attacks,
    // put a -1/-1 counter on target creature defending player controls" is the
    // standard attack-trigger template, and it was the one shape the set's
    // gloom vocabulary could not print.
    handAuthoredTargets: [
      'targetOpponent',
      'selfPermanent',
      'noTarget',
      'targetCreatureDefendingPlayerControls',
    ],
    checkParams: (effect, path) =>
      checkAmountRange(effect.count, LIMITS.counterCount, `${path}.count`, 'counter count'),
  },
  exileTarget: {
    // Two rows in one, split by `scope`. Unscoped, this is `destroyPermanent`'s
    // row with one word changed and answers a creature. Scoped, the *player* is
    // what the spell targets and the creatures are not targets at all (CR 115.1),
    // so the row has to admit a player kind as well and `checkEffectScope` below
    // is what stops the two halves being mixed.
    //
    // Which of those the *generator* may reach was settled the moment `mtg-q5yg`
    // priced this kind, because a priced kind's generatable list is printed
    // verbatim into the fill prompt. `ZoneReachingModelEffectSchema` shows the
    // model this primitive without its scope, so the scoped half is unreachable
    // and a player kind offered here would be a target the model can name and
    // the validator must then refuse. It moves down to `handAuthoredTargets`
    // beside the artifact-or-enchantment kind, which moves for the neighboring
    // reason: `MODEL_TARGET_KINDS` is the frozen four and has no word for it.
    // Altar's Light is still the printing a hand-authored card gets from it:
    // "Exile target artifact or enchantment."
    generatableTargets: ['targetCreature'],
    // `targetPermanent` is Celestial Purge, "exile target black or red
    // permanent", and it joins for `destroyPermanent`'s reason at the same
    // field: one space and a filter, rather than a kind per printed selector.
    handAuthoredTargets: ['targetOpponent', 'targetArtifactOrEnchantment', 'targetPermanent'],
    checkParams: noParams,
  },
  revealHand: {
    // A hand is somebody's, so this reaches a player and nothing else. Narrow to
    // an opponent rather than any player, because "reveal your own hand" is a
    // clause no card in this vocabulary wants and a widening arrives with the
    // card that needs it.
    generatableTargets: ['targetOpponent'],
    checkParams: noParams,
  },
  scry: { generatableTargets: [], checkParams: noParams },
  returnFromGraveyard: {
    // A graveyard is somebody's, so this reaches a player and nothing else —
    // `revealHand`'s reasoning one row up, with the opposite width. Both kinds
    // are legal, because "return all creature cards from your graveyard" and
    // "…from target opponent's graveyard" are both cards somebody would print,
    // and each returns those cards under their own owner's control, so neither
    // is a gift to the wrong player.
    //
    // Only the wider of the two is generatable, and the split is `exileTarget`'s
    // one row up: `MODEL_TARGET_KINDS` has `targetPlayer` and no `targetOpponent`,
    // so offering the narrower kind in the prompt would name a word the model
    // cannot say. Nothing is lost by it — `targetPlayer` reaches an opponent as
    // readily as it reaches you, and which one a given card should aim at is the
    // model's decision rather than the vocabulary's.
    generatableTargets: ['targetPlayer'],
    handAuthoredTargets: ['targetOpponent'],
    checkParams: noParams,
  },
  addMana: {
    // No target at all, `scry`'s shape: mana goes to the ability's own
    // controller, which `ApplyContext` already carries, and "add mana to target
    // player's pool" is not a sentence Magic prints.
    generatableTargets: [],
    checkParams: (effect, path) =>
      checkAmountRange(effect.amount, LIMITS.manaAmount, `${path}.amount`, 'mana amount'),
  },
  fight: {
    // Stated as generatable rather than hand-authored, and the generator still
    // cannot reach it. `LEGAL_TARGETS` is built from this half alone, and
    // `exhaustiveness.test.ts` asserts a targeted kind has a non-empty entry
    // there — so an empty list here would make the one totality gate over this
    // table read `fight` as untargeted. `revealHand` is the standing precedent
    // for an unpriced kind stating a generatable target. What keeps the model
    // out is `ModelEffectSchema`, which has no `fight` member at all, and
    // `RoleProfile.effectKinds`, which is `readonly EffectKind[]` and so cannot
    // name an unpriced kind.
    generatableTargets: ['targetCreatureYouDontControl'],
    checkParams: noParams,
  },
  // The library and graveyard block. Four of the five state no targets at all,
  // and that is a fact about the zones rather than a narrowing: a library and a
  // graveyard are reached by whose they are, and each of these four says whose
  // in a field of its own — the controller for three of them, `whose` for the
  // fourth. There is nothing left for a `TargetSpec` to name.
  shuffleLibrary: { generatableTargets: [], checkParams: noParams },
  revealTopCards: { generatableTargets: [], checkParams: noParams },
  putOnLibrary: {
    // The one targeted member, and it points where `returnToHand` points: at a
    // permanent, which is the only card a `TargetKind` can name outside a
    // public zone. Artifacts and enchantments are hand-authored beside it for
    // `exileTarget`'s stated reason — `MODEL_TARGET_KINDS` is the frozen four
    // and has no word for that kind — and `fight` is the standing precedent for
    // an unpriced row stating a generatable target that no model can reach,
    // because `ModelEffectSchema` has no member for this kind at all.
    generatableTargets: ['targetCreature'],
    handAuthoredTargets: ['targetArtifactOrEnchantment'],
    checkParams: noParams,
  },
  exileGraveyard: { generatableTargets: [], checkParams: noParams },
  shuffleGraveyardIntoLibrary: { generatableTargets: [], checkParams: noParams },
  searchLibrary: {
    generatableTargets: [],
    checkParams: (effect, path) => checkCardFilterLists(effect.filter, `${path}.filter`),
  },
  // The hand block. Both reach a *player*, because a hand is somebody's, and
  // both stop the resolution to ask which cards leave it — so neither names a
  // card, and there is nothing here for a second `TargetSpec` slot to hold.
  // The printed count is bounded by `MAX_DISCARD_COUNT` in the schema, which
  // is where `scry` and `revealTopCards` already put theirs, so `chooseDiscard`
  // has nothing left to check; the one thing `discardCards` checks is the pair
  // its `noTarget` slot belongs to.
  discardCards: {
    // Both player kinds, and the wider one is the generatable half for
    // `returnFromGraveyard`'s stated reason: `MODEL_TARGET_KINDS` has
    // `targetPlayer` and no `targetOpponent`. A discard aimed at yourself is a
    // real card rather than a degenerate one — every looting and madness
    // enabler is exactly that — so nothing is lost by offering the wide kind.
    //
    // `noTarget` is hand-authored and it is the *sweep's* slot: `players`
    // (Liliana's Specter) names the seats, and `checkPlayerSweep` requires the
    // target slot beside it be empty. It stays off `generatableTargets` for the
    // reason the field itself is off `ModelEffectSchema` — the generator has no
    // word for a sweep, so a slot menu offering the empty spec would be
    // offering half a card.
    generatableTargets: ['targetPlayer'],
    handAuthoredTargets: ['targetOpponent', 'noTarget'],
    // The other half of the pair `checkPlayerSweep` states. That check refuses
    // a sweep beside a live target; this one refuses the empty slot without a
    // sweep, and both are needed because the two fields are only meaningful
    // together. CR 701.8 takes cards out of a *named* hand, and a discard that
    // names none would fall through to the controller's own — "You discards a
    // card" is the sentence the renderer would build, and no printed discard
    // reaches its controller's hand without saying so.
    checkParams: (effect, path) =>
      effect.target.kind === 'noTarget' && effect.players === undefined
        ? [
            violation(
              'ILLEGAL_EFFECT_SCOPE',
              `${path}.target`,
              'a discard names whose hand it takes from, and a "noTarget" slot names nobody; add a "players" sweep, or point the slot at a player',
            ),
          ]
        : [],
  },
  chooseDiscard: {
    // `revealHand`'s row, narrowed the same way and for the same sentence: a
    // hand is somebody's, and "reveal your own hand and choose a card you
    // discard" is a clause no card in this vocabulary wants. It is the rider
    // that row's docblock says the vocabulary had no way to print, so the two
    // agree on width by construction rather than by coincidence.
    generatableTargets: ['targetOpponent'],
    // The filter is optional here where `searchLibrary` and
    // `chooseFromGraveyard` both require one, so this is the row that has to
    // ask whether there is anything to check at all.
    checkParams: (effect, path) =>
      effect.filter === undefined ? [] : checkCardFilterLists(effect.filter, `${path}.filter`),
  },
  loseLife: {
    // `gainLife`'s two slots plus the one that says whose loss it is. All three
    // are stated as generatable and none of them is reachable by a model, for
    // `fight`'s stated reason: the kind is absent from `EFFECT_KINDS`, so no
    // slot menu can offer it, and `LEGAL_TARGETS` is built from this half
    // alone — an empty list here would make the one totality gate over this
    // table read a targeted kind as untargeted.
    //
    // `targetOpponent` is the row that matters, and it is here for the printed
    // targeted line alone: "target opponent loses 2 life". It used to be here
    // for "each opponent loses 2 life" as well, on the argument that a two-seat
    // kernel makes the one opponent the whole group. That line is a scope now
    // (`players: 'eachOpponent'`, `PLAYER_SWEEP_FIELD` in `effects.ts`), and it
    // never was this row: CR 115.1 makes a target chosen and a scope not, which
    // is a difference in what the kernel does rather than in how many seats it
    // does it to. The sweep is unreachable from here in any case, because
    // `players` is not a target and this table only says which slots may be
    // filled.
    generatableTargets: ['noTarget', 'targetPlayer', 'targetOpponent'],
    // `thatPlayer` is Sign in Blood (M11 #117, M13 #110), whose printed
    // sentence names one person and whose DSL encoding is two effects — so
    // before this row the second effect chose its own player and the kernel
    // offered a cast that drew for one and drained the other. Hand-authored
    // rather than generatable for the reason `dealDamage`'s referent row is:
    // the fill prompt prints the generatable list verbatim and the recorded
    // fixtures are keyed to those bytes.
    handAuthoredTargets: ['thatPlayer'],
    checkParams: (effect, path) =>
      checkAmountRange(effect.amount, LIMITS.life, `${path}.amount`, 'life amount'),
  },
  setLife: {
    // No target at all, `scry`'s shape and `addMana`'s reason: the life total
    // set is the controller's, which `ApplyContext` already carries, and every
    // card that prints the line says "your" rather than "target".
    generatableTargets: [],
    // The same range a life gain is held to, and a floor of one for the reason
    // that row has one: a card whose text sets a life total to zero is a card
    // that reads "you lose the game", which is not what any printing of this
    // line says. A computed amount that *evaluates* to zero is a different
    // matter and is left alone — Touch of the Eternal counts artifacts, and
    // controlling none of them is a board state rather than a printed lie.
    checkParams: (effect, path) =>
      checkAmountRange(effect.amount, LIMITS.life, `${path}.amount`, 'life total'),
  },
  preventCombatDamage: { generatableTargets: [], checkParams: noParams },
  // The sibling CR 615 shape: not a wider Fog, the *other* printed card
  // (Dawn Charm's first mode). Stated as generatable rather than
  // hand-authored, `fight`'s and `putCounters`' reason exactly: the target
  // list is what `LEGAL_TARGETS` reads, and `handAuthoredTargets` is for
  // widening a row that is otherwise reachable — this kind is not, the whole
  // of it is off `EFFECT_KINDS` and `MODEL_EFFECT_KINDS`, so there is nothing
  // for the target rider to widen past.
  preventAllDamageToTarget: { generatableTargets: ['targetCreature'], checkParams: noParams },
  // `searchLibrary`'s targeting row exactly, and for its sentence: the effect
  // names no target, and the graveyard it reads is named by `whose` rather than
  // targeted, which is where this row would otherwise have had something to
  // say. Its parameters no longer all fit in the schema, though. `whose`,
  // `destination` and `maxManaValue` are still pinned by their own types, and a
  // `CardFilter` whose every field is absent is Demonic Tutor rather than a
  // mistake — but `control` and `alsoBecomes` are legal only against a
  // battlefield destination, and Zod cannot say that about a sibling field
  // without turning the object into a union the generator would have to read.
  chooseFromGraveyard: { generatableTargets: [], checkParams: checkGraveyardChoiceParams },
  // Three kinds and no `handAuthoredTargets`, `preventAllDamageToTarget`'s
  // arrangement one row up and for its reason: the whole of this kind is off
  // `EFFECT_KINDS` and `MODEL_EFFECT_KINDS`, so there is no generatable row for
  // a hand-authored rider to widen past and the list is simply stated.
  //
  // `targetPermanent` is the space Voltaic Key needs and the only one a
  // `TargetSpec.filter` may narrow (`checkTargetFilter` refuses a card-type
  // filter on every kind that has already fixed its types by being the kind it
  // is), so "untap target artifact" and "untap target land" are this kind
  // wearing a filter rather than two more members of `TARGET_KINDS`.
  //
  // The two creature kinds are here because they are what the printed sentence
  // says, not because the space needs them: "untap target creature you control"
  // is a different English clause from "untap target permanent" aimed at the
  // same board, and a card that means the first should not have to print the
  // second. What is still out of reach is "untap *it*" — a slot that names
  // whatever an earlier effect on the same card named. Two effects with
  // identical specs choose independently in `targetChoicesForEffects`, so the
  // linkage is a targeting feature rather than a widening here (`mtg-2qyk`).
  untapPermanent: {
    generatableTargets: ['targetPermanent', 'targetCreature', 'targetCreatureYouControl'],
    checkParams: noParams,
  },
  // Every creature slot the combat trick beside it reaches, and no wider.
  //
  // `pumpUntilEndOfTurn` states one generatable kind and hands the rest to
  // `handAuthoredTargets` because its prompt bytes are pinned to recorded
  // fixtures. This kind has no prompt at all — it is off `EFFECT_KINDS`
  // entirely — so the whole list is stated here and there is nothing for a
  // hand-authored row to widen past, which is `untapPermanent`'s arrangement
  // one row up.
  //
  // The three are the three English subjects a printed keyword grant has that
  // this table is the right one to say: the spell's chosen creature, the
  // chosen creature it is allowed to own, and the ability's own source
  // ("whenever this creature attacks, it gains trample"). `targetPermanent` is
  // absent and stays absent -- `AbilityChangeEffect` adds an ability to
  // whatever it names, and "target land gains flying" is a sentence the layer
  // would honor and no card in this world wants to print.
  //
  // `triggeringCreature` is absent for the reason `pumpUntilEndOfTurn` leaves
  // it out of both its lists: `checkAbilityEffectTarget` answers that kind from
  // the printed trigger's permissions and returns before it ever reads this
  // table, so a row here would be a claim no checker consults and one the
  // Forge conformance test would then have to be told to ignore.
  //
  // `noTarget` is Overwhelming Stampede's slot, and it arrived with the scope
  // (`mtg-nhyv.15`) for the reason `pumpUntilEndOfTurn`'s row gives at the same
  // field: a space scope chooses nobody (CR 115.1), so the card needs a slot
  // that names nobody. It is a fourth English subject rather than a fourth
  // creature — the group the spell's controller already has — and
  // `checkEffectScope` is what keeps it from ever standing alone, since an
  // unscoped grant aimed at nothing lands on nobody.
  grantKeywordUntilEndOfTurn: {
    generatableTargets: ['targetCreature', 'targetCreatureYouControl', 'selfCreature', 'noTarget'],
    checkParams: noParams,
  },
  // One creature, whoever controls it. The whole list sits in
  // `generatableTargets` for the reason the row above states: this kind is off
  // `EFFECT_KINDS`, so no prompt prints it and there is nothing for a
  // hand-authored row to widen past.
  //
  // `targetCreature` and nothing narrower, because Goblin Tunneler's line
  // ("target creature with power 2 or less") narrows through a
  // `TargetRestriction` rather than through a target kind, and nothing wider,
  // because CR 509.1b is a rule about blocking a *creature* and "target
  // permanent can't be blocked" is a sentence with no referent.
  cantBeBlockedThisTurn: {
    generatableTargets: ['targetCreature'],
    checkParams: noParams,
  },
  // One creature, and only one an opponent controls. The requirement names the
  // ability's controller as the defender, so aimed at a creature that player
  // already controls it is a sentence asking a creature to attack its own
  // controller — CR 508.1a makes that unsatisfiable rather than illegal, and a
  // row that admits it would be a printed line the kernel silently ignores.
  // Alluring Siren says "target creature an opponent controls" for exactly this
  // reason and the row says the same thing.
  attacksYouThisTurnIfAble: {
    generatableTargets: ['targetCreatureYouDontControl'],
    checkParams: noParams,
  },
  // The source and nothing else. `selfCreature` is a retained referent rather
  // than a chosen target (CR 115.6a), and carrying it is what makes the effect
  // print the noun the card prints — "sacrifice this creature" — without a
  // card-kind parameter reaching `renderEffect`.
  //
  // `selfPermanent` is deliberately absent. It would let one creature card be
  // written two ways for one behavior, which is the ambiguity
  // `self-permanent-target.test.ts` pins shut for `putCounters` and
  // `pumpUntilEndOfTurn`; the rule the rest of this table follows is that a
  // widening arrives with the card that needs it, and the card that asked for
  // this kind is Arc Runner, a creature. An artifact that sacrifices itself on
  // a trigger is the card that would move this line.
  //
  // Nothing generatable, which is a stronger statement than the empty rows
  // above it: `scry` and `addMana` state `[]` because they name no target at
  // all, and this one states `[]` because the one kind it admits is
  // hand-authored. The kind is off `EFFECT_KINDS` entirely, so there is no
  // prompt whose printed list this narrows and nothing keyed to those bytes.
  sacrificeSelf: {
    generatableTargets: [],
    handAuthoredTargets: ['selfCreature'],
    checkParams: noParams,
  },
  // The two player kinds, `discardCards`' exact split and for the same
  // reason: `targetPlayer` is the wide generatable half `MODEL_TARGET_KINDS`
  // carries, `targetOpponent` is hand-authored only. `sacrificePermanent` is
  // itself off `generatableEffects` (`mtg-4g77`'s containment cut, matching
  // `discardCards`), so neither list is read by a model prompt today — this
  // is the row a future generator lane finds already correct rather than
  // still to write.
  //
  // No `noTarget` and no player sweep: "each opponent sacrifices a creature"
  // is a real printed sentence and a second card, deliberately left for
  // whoever needs it, the same cut `sacrificePermanentEffect`'s docblock
  // states.
  sacrificePermanent: {
    generatableTargets: ['targetPlayer'],
    handAuthoredTargets: ['targetOpponent'],
    checkParams: noParams,
  },
  // `sacrificeSelf`'s empty generatable half, for the same reason stated one
  // different way: this kind is off `EFFECT_KINDS`, so no fill prompt prints
  // this list and no `EFFECT_RANGES` line prices it. `targetCreature` and
  // nothing else — Diminish names a creature, and a base P/T on anything that
  // is not a creature is a record layer 7b has nowhere to put.
  setBasePtUntilEndOfTurn: {
    generatableTargets: [],
    handAuthoredTargets: ['targetCreature'],
    checkParams: checkBasePtParams,
  },
};

/**
 * The generatable half of `EFFECT_RULES`, which is what the fill prompt prints.
 * Derived rather than restated, so the prompt and the validator cannot disagree.
 */
export const LEGAL_TARGETS: Readonly<Record<AnyEffectKind, readonly TargetKind[]>> = (() => {
  const table = {} as Record<AnyEffectKind, readonly TargetKind[]>;
  for (const kind of ALL_EFFECT_KINDS) table[kind] = EFFECT_RULES[kind].generatableTargets;
  return table;
})();

/** The hand-authored half of `EFFECT_RULES`, keyed only where a row states one. */
export const HAND_AUTHORED_TARGETS: Readonly<Partial<Record<AnyEffectKind, readonly TargetKind[]>>> = (() => {
  const table: Partial<Record<AnyEffectKind, readonly TargetKind[]>> = {};
  for (const kind of ALL_EFFECT_KINDS) {
    const extra = EFFECT_RULES[kind].handAuthoredTargets;
    if (extra !== undefined) table[kind] = extra;
  }
  return table;
})();

/**
 * Every target kind an effect may name, whoever wrote the card.
 *
 * The one table the validator, the kernel's recheck and the Forge mapping are
 * all asserted against; the two halves above exist only so the prompt can read
 * the narrower one.
 */
export function legalTargetsFor(kind: AnyEffectKind): readonly TargetKind[] {
  const extra = HAND_AUTHORED_TARGETS[kind];
  return extra === undefined ? LEGAL_TARGETS[kind] : [...LEGAL_TARGETS[kind], ...extra];
}

/**
 * Numeric ranges the vocabulary is allowed to name. Exported because
 * `validate/abilities.ts` checks a printed modification's numbers against the
 * same table a spell's are checked against.
 *
 * `pumpDelta` and `statBonusDelta` were one entry until 2026-08-13, on the
 * argument that a static ability's P/T bonus is the same quantity a pump is.
 * They are two now, and the reason is a card: Last-Blow Obliterator prints
 * `+99/-3`, so the ceiling on a *printed, permanent* modification had to move
 * and the ceiling on a one-shot pump spell did not. Splitting them is what kept
 * the widening to the thing that asked for it — every `pumpUntilEndOfTurn` in
 * the vocabulary is still held to `-8..8`.
 *
 * `statBonusDelta` is deliberately still one entry for both placements a
 * modification has, a lord's static line and a weapon's equip clause, because
 * `checkModification` reads it for both: a weapon that could ship a bonus a lord
 * could not would be a rule about where a number is printed rather than about
 * the number.
 *
 * Two digits is what the wider bound means, and it is a statement about what a
 * card face can print and a renderer can fit, not about what a format can
 * survive. Whether a set is playable at these numbers is measured rather than
 * asserted, by the seeded balance gate in `@mtg/metrics`.
 */
export const LIMITS = {
  damage: { min: 1, max: 12 },
  pumpDelta: { min: -8, max: 8 },
  statBonusDelta: { min: -99, max: 99 },
  draw: { min: 1, max: 6 },
  life: { min: 1, max: 20 },
  mill: { min: 1, max: 20 },
  tokenCount: { min: 1, max: 8 },
  tokenPower: { min: 0, max: 12 },
  tokenToughness: { min: 1, max: 12 },
  /**
   * What `setBasePtUntilEndOfTurn` may print, and deliberately the same two
   * bounds as the token stat line directly above rather than a reference to
   * it: both bound a *printed* creature's power and toughness, so today they
   * agree, but they answer to different pressures — the token bounds move when
   * what a generator may mint moves, and these move when what a
   * characteristic-setting spell may say moves. One name per bound, so a
   * change to either states which one it meant.
   *
   * Toughness floors at 1 for the reason a token's does: a base toughness of 0
   * is a creature that dies as a state-based action the instant the effect
   * applies, which is a destroy spell written the long way round.
   */
  basePower: { min: 0, max: 12 },
  baseToughness: { min: 1, max: 12 },
  counterCount: { min: 1, max: 4 },
  /**
   * `controlsSubtype`'s floor. A threshold above roughly a deck's worth of one
   * subtype is unreachable on any board this generator can build, so it is a
   * printed lie in the same way a damage effect above `damage.max` is: the
   * number is decorative because the game the card describes never happens.
   */
  conditionThreshold: { min: 1, max: 20 },
  /**
   * `lifeAtLeast`'s floor, and a separate entry from `conditionThreshold`
   * because the two numbers measure different things. That one bounds a count
   * of permanents and reads a deck's worth of one subtype as the ceiling; this
   * one bounds a life total, which starts at 20 and moves in both directions
   * every game. Serra Ascendant's printed 30 is above the permanent-count
   * ceiling and nowhere near unreachable.
   *
   * 50 is the top because Test of Endurance prints "if you have 50 or more
   * life" and no printed card of this shape names a higher number. A threshold
   * above it would be decorative in `conditionThreshold`'s sense: the game the
   * card describes never happens.
   */
  lifeThreshold: { min: 1, max: 50 },
  /**
   * How much mana one `addMana` may add.
   *
   * The ceiling is `MAX_MANA_PRODUCED`, which is also `producesMana`'s length
   * bound, and the two are the same number on purpose (that constant's
   * docblock says why). The floor is one, because a mana ability that adds
   * nothing is a card that prints a sentence and does not do it — the same
   * failure `draw` and `life` have floors of one for.
   */
  manaAmount: { min: 1, max: MAX_MANA_PRODUCED },
} as const;

export interface Range {
  readonly min: number;
  readonly max: number;
}

/**
 * The message is shared and the code is not: a range is a range wherever it is
 * checked, but the caller decides which part of the card the reader should look
 * at, and consumers branch on the code rather than the words.
 */
export function checkRange(
  value: number,
  range: Range,
  path: string,
  label: string,
  code: ViolationCode = 'EFFECT_PARAM_OUT_OF_RANGE',
): Violation[] {
  if (value >= range.min && value <= range.max) return [];
  return [violation(code, path, `${label} must be between ${range.min} and ${range.max}, got ${value}`)];
}

/**
 * The same range check, applied to the half of an `Amount` that has a range.
 *
 * **The range table is about literals only, and that is a decision rather than
 * an omission.** `LIMITS` exists to stop the generator printing 40 damage; it is
 * a guard on numerals a model chose. A computed amount has no numeral to check —
 * "the number of cards exiled this way" is between zero and the size of a board
 * — and the two ways of pretending otherwise are both worse than declining.
 * Refusing every computed amount would delete the primitive; clamping one at
 * resolution would print a card that says one number and deals another, which
 * is the exact failure this whole vocabulary exists to prevent.
 *
 * What keeps it safe is the other gate: no generated card can carry a computed
 * amount, because `ModelEffectSchema` is built over `z.int()`. So the unchecked
 * half is the hand-authored half, and a hand-authored number is somebody's
 * decision rather than a model's.
 *
 * A rate is the one computed shape that does have a numeral, and it gets the
 * check: "-1/-1 for each Swamp you control" prints the -1 outright, and the
 * argument above for declining does not reach it — the count is what nobody can
 * bound, not the rate. The range is charged against the rate rather than
 * against the product, which is the same reading `LIMITS.pumpDelta` already has
 * for `statBonusPer` and the only one available: a rate times a board is
 * unbounded by construction, and a card that says -1 per Swamp is a normal card
 * on a board with nine of them.
 */
function checkAmountRange(
  amount: PumpAmount,
  range: Range,
  path: string,
  label: string,
  code: ViolationCode = 'EFFECT_PARAM_OUT_OF_RANGE',
): Violation[] {
  if (isLiteralAmount(amount)) return checkRange(amount, range, path, label, code);
  return isRateAmount(amount) ? checkRange(amount.rate, range, `${path}.rate`, `${label} rate`, code) : [];
}

export function effectUsesChosenX(effect: Effect): boolean {
  const contains = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(contains);
    if (typeof value !== 'object' || value === null) return false;
    if ('kind' in value && (value as { readonly kind?: unknown }).kind === 'chosenX') return true;
    return Object.values(value).some(contains);
  };
  return contains(effect);
}

/**
 * A token states a body or states none, and stating half of one is neither.
 *
 * `TokenSpec` leaves `power` and `toughness` optional so that "an artifact
 * token with no power or toughness" is expressible without a 0/0 the
 * state-based actions would bury (`effects.ts`, `token.ts`). The pair is the
 * type line: both means a creature token, neither means an artifact token, and
 * one means a design nobody wrote. `tokenCard` reads it that way and would
 * silently drop the lone number, so the coded violation is what stops that
 * being silent — the same argument `checkCreatureStats` makes when it refuses
 * an instant carrying a power.
 */
function checkTokenBody(token: TokenSpec, path: string): Violation[] {
  if (isCreatureTokenSpec(token)) {
    return [
      ...checkRange(token.power, LIMITS.tokenPower, `${path}.power`, 'token power'),
      ...checkRange(token.toughness, LIMITS.tokenToughness, `${path}.toughness`, 'token toughness'),
    ];
  }
  if (token.power === undefined && token.toughness === undefined) return [];
  const stated = token.power === undefined ? 'toughness' : 'power';
  const missing = token.power === undefined ? 'power' : 'toughness';
  return [
    violation(
      'TOKEN_STATS_INCOMPLETE',
      `${path}.${missing}`,
      `this token states a ${stated} and no ${missing}; a creature token states both, and an artifact token states neither`,
    ),
  ];
}

/**
 * Every violation, moved under the path of the effect that declares the token.
 *
 * The checks below are run against the card the kernel will actually build for
 * this token, so they report paths inside that card (`abilities[0].cost`). A
 * repair loop is editing the *creating* card, where that ability sits at
 * `effects[0].token.abilities[0].cost`, so the prefix is prepended rather than
 * the messages being rewritten.
 */
function underToken(path: string, found: readonly Violation[]): Violation[] {
  return found.map((entry) =>
    violation(entry.code, entry.path.length === 0 ? path : `${path}.${entry.path}`, entry.message),
  );
}

/**
 * A token's name is a name, not its printed line.
 *
 * `TokenSpecSchema` caps the field at 80 characters and can say nothing else
 * about it, so a generator that packs the token's rules text into the name emits
 * a set that parses and is wrong everywhere the name is shown: on the
 * battlefield, inside the oracle text of every card that creates it, in the
 * Forge token script, and in the id `tokenSlug` derives for its art. Observed in
 * a live regeneration of the flagship set as
 * `Wyrmhead Horn — Fuse: Sacrifice this: +1/+1 counter on a creature you control`.
 *
 * Same family as `TOKEN_STATS_INCOMPLETE`: a shape the schema cannot express,
 * checked where the token's other fields are checked.
 *
 * Shape and length are two checks because they catch two mistakes. The pattern
 * catches the punctuation only rules text carries; the bound catches the same
 * paragraph written in plain words, which every character class here admits. A
 * 71-character run of ordinary capitalized words passed this function until
 * `TOKEN_NAME_MAX_LENGTH` was added beside the pattern, and that is the shape a
 * repair produces when it is told to take the punctuation out and nothing tells
 * it to say less.
 */
function checkTokenName(token: TokenSpec, path: string): Violation[] {
  if (!TOKEN_NAME_PATTERN.test(token.name)) {
    return [
      violation(
        'INVALID_TOKEN_NAME',
        `${path}.name`,
        `token name ${JSON.stringify(token.name)} is not a name: a token is named in capitalised words, apostrophes and hyphens ("Reaper's Scythe"), and anything else here is rules text that landed in the name field`,
      ),
    ];
  }
  if (token.name.length <= TOKEN_NAME_MAX_LENGTH) return [];
  return [
    violation(
      'INVALID_TOKEN_NAME',
      `${path}.name`,
      `token name ${JSON.stringify(token.name)} is ${token.name.length} characters; a token is named in at most ${TOKEN_NAME_MAX_LENGTH}, which is what a card face draws, and a longer one is rules text that landed in the name field`,
    ),
  ];
}

/**
 * `control` and `alsoBecomes` are sentences about a permanent, so the only
 * destination that can read either is the battlefield. A card put into its
 * owner's hand or shuffled into a library has an owner and no controller, and
 * shows none of its characteristics to anything; CR 400.7 then makes the object
 * that arrives a new object, so a grant recorded on the way there would be a
 * grant on something that no longer exists. Refusing the combination here is
 * the difference between an author being told and the kernel quietly dropping
 * the field.
 *
 * A grant with neither list is the same shape of nothing. `GraveyardArrivalGrant`
 * makes each list optional so a card may add types without colors or colors
 * without types, which leaves `{}` as the one combination that adds nothing "in
 * addition to its other" anything.
 */
/**
 * A `CardFilter` that cannot be satisfied, or that says one thing twice.
 *
 * `checkFilterLists` for the other filter, and only the two rules that survive
 * the move. That function also refuses card types the *slot* can never hold —
 * a permanent is never an instant — and there is no such rule here: this filter
 * reads a library, a graveyard or a revealed hand, and every card type reaches
 * all three. What is left is the pair of mistakes that are wrong about the
 * filter itself rather than about where it points.
 *
 * One function for all three effects that carry a `CardFilter`, which is
 * `asPrintedFilter`'s argument in `kernel/src/scry.ts` said on the validation
 * side: `searchLibrary`, `chooseFromGraveyard` and `chooseDiscard` read one
 * shape, so a rule wired into one of them and not the others would make the
 * same printed mistake legal on two cards out of three.
 *
 * It arrived with `excludeCardTypes` and it is why that field could be added
 * without widening a gap. Before it, this filter had no validator at all, on
 * the stated ground that "a `CardFilter` whose every field is absent is Demonic
 * Tutor rather than a mistake" — true of an *empty* filter, and no argument at
 * all about a filter that wants and refuses the same card type. That one names
 * the empty set while reading as though it selects, which is exactly the class
 * of card this lane was opened to stop shipping.
 */
function checkCardFilterLists(filter: CardFilter, path: string): Violation[] {
  const found: Violation[] = [];
  const lists: readonly (readonly [string, readonly string[] | undefined])[] = [
    ['cardTypes', filter.cardTypes],
    ['excludeCardTypes', filter.excludeCardTypes],
    ['subtypes', filter.subtypes],
    ['supertypes', filter.supertypes],
    ['colors', filter.colors],
    ['names', filter.names],
  ];
  for (const [field, list] of lists) {
    if (list === undefined) continue;
    if (new Set(list).size !== list.length) {
      found.push(
        violation('ILLEGAL_CARD_FILTER', `${path}.${field}`, `"${field}" names the same value twice`),
      );
    }
  }
  const both = (filter.cardTypes ?? []).filter((kind) => (filter.excludeCardTypes ?? []).includes(kind));
  if (both.length > 0) {
    found.push(
      violation(
        'ILLEGAL_CARD_FILTER',
        path,
        `card type "${both.join(', ')}" is listed as both wanted and excluded, so nothing can ever satisfy this filter`,
      ),
    );
  }
  return found;
}

function checkGraveyardChoiceParams(effect: EffectOf<'chooseFromGraveyard'>, path: string): Violation[] {
  const found: Violation[] = [...checkCardFilterLists(effect.filter, `${path}.filter`)];
  if (effect.destination !== 'battlefield') {
    if (effect.control !== undefined) {
      found.push(
        violation(
          'EFFECT_PARAM_OUT_OF_RANGE',
          `${path}.control`,
          `control is a property of a permanent, and a card put into a ${effect.destination} has an owner and no controller; drop the field or send the card to the battlefield`,
        ),
      );
    }
    if (effect.alsoBecomes !== undefined) {
      found.push(
        violation(
          'EFFECT_PARAM_OUT_OF_RANGE',
          `${path}.alsoBecomes`,
          `an added color or type is read off a permanent, and a card put into a ${effect.destination} shows neither; drop the field or send the card to the battlefield`,
        ),
      );
    }
  }
  const grant = effect.alsoBecomes;
  if (grant === undefined) return found;
  if (grant.colors === undefined && grant.subtypes === undefined) {
    found.push(
      violation(
        'EFFECT_PARAM_OUT_OF_RANGE',
        `${path}.alsoBecomes`,
        'an arrival grant with neither colors nor subtypes adds nothing; state one of the two lists or drop the field',
      ),
    );
  }
  for (const [index, subtype] of (grant.subtypes ?? []).entries()) {
    if (!SUBTYPE_PATTERN.test(subtype)) {
      found.push(
        violation(
          'INVALID_SUBTYPE',
          `${path}.alsoBecomes.subtypes[${index}]`,
          `subtype "${subtype}" must be a capitalized word such as "Zombie"`,
        ),
      );
    }
  }
  return found;
}

function checkTokenSpec(token: TokenSpec, path: string, cardColors: readonly Color[]): Violation[] {
  const found: Violation[] = [...checkTokenName(token, path), ...checkTokenBody(token, path)];
  for (const [index, subtype] of token.subtypes.entries()) {
    if (!SUBTYPE_PATTERN.test(subtype)) {
      found.push(
        violation(
          'INVALID_TOKEN_SUBTYPE',
          `${path}.subtypes[${index}]`,
          `token subtype "${subtype}" must be a capitalised word such as "Beast"`,
        ),
      );
    }
  }
  const offIdentity = token.colors.filter((color) => !cardColors.includes(color));
  if (offIdentity.length > 0) {
    found.push(
      violation(
        'TOKEN_COLOR_OFF_IDENTITY',
        `${path}.colors`,
        `token colours [${sortColors(offIdentity).join('')}] are outside the card's colour identity [${sortColors(cardColors).join('') || 'colourless'}]`,
      ),
    );
  }
  // A token's keywords and printed abilities are legal exactly where the same
  // keywords and abilities are legal on the card the token becomes, so they go
  // through the card's own checks rather than through a token-shaped copy of
  // them. That is what makes "a `self` static needs a creature" and "abilities
  // belong on permanents" true of a token for free, and what stops a token
  // vocabulary drifting away from a card's.
  const card = tokenCard(token);
  found.push(...underToken(path, [...checkKeywords(card), ...checkAbilities(card)]));
  return found;
}

/**
 * Range and shape of one effect's own parameters, wherever the effect is
 * printed. Exported because a triggered ability carries the same effects a
 * spell does (`validate/abilities.ts`), and two hand-maintained copies of the
 * damage range are two chances to widen one of them.
 */
export function checkEffectParams(effect: Effect, path: string, cardColors: readonly Color[]): Violation[] {
  const rules: EffectRulesRow = EFFECT_RULES[effect.kind];
  // The one place this file narrows by assertion rather than by control flow.
  // `rules` is the union of rows and `effect` is the union of effects, and
  // TypeScript will not relate the two through a shared index it has already
  // read; the mapped table above is what makes the pairing true for every key,
  // so the assertion restates a fact the type of `EFFECT_RULES` proves.
  const check = rules.checkParams as (e: Effect, p: string, c: readonly Color[]) => Violation[];
  return check(effect, path, cardColors);
}

function checkEffectTarget(effect: Effect, path: string): Violation[] {
  if (!hasTarget(effect)) return [];
  if (effect.target.kind === 'triggeringCreature') {
    return [
      violation(
        'ILLEGAL_TARGET_FOR_EFFECT',
        `${path}.target.kind`,
        'triggeringCreature is a retained trigger referent, not a target a spell may choose',
      ),
    ];
  }
  if (isSourceBodyOnlyTarget(effect.target.kind)) {
    // A spell on the stack is not a permanent, so it has no source body for
    // "this creature" or "this permanent" to name — the same absence
    // `unless.ts`'s `UNLESS_PAYER_TARGETS` docblock gives for
    // `triggeringCreature`, one row up: the referent these kinds retain is a
    // fact about an *ability*, and a spell's own effect list is not printed on
    // one.
    //
    // Asked of `SOURCE_BODY_ONLY_TARGETS` rather than of the one literal it
    // used to name, so `selfPermanent` (`mtg-rji`) was refused on instants and
    // sorceries the moment it was appended. The message names the kind it
    // caught, which is what the literal form gave for free and a list form has
    // to do on purpose.
    return [
      violation(
        'ILLEGAL_TARGET_FOR_EFFECT',
        `${path}.target.kind`,
        `${effect.target.kind} names the ability's own source, not a target a spell may choose`,
      ),
    ];
  }
  if (isAttackTriggerOnlyTarget(effect.target.kind)) {
    // "Defending player" is CR 506.2, a role that exists only inside a combat
    // this source is attacking in. A spell has no such combat to read, so this
    // is refused here for the same reason `triggeringCreature` is one clause
    // up: the phrase would print without a referent.
    return [
      violation(
        'ILLEGAL_TARGET_FOR_EFFECT',
        `${path}.target.kind`,
        'targetCreatureDefendingPlayerControls is legal only on a triggered ability whose condition is selfAttacks, never on a spell',
      ),
    ];
  }
  const legal = legalTargetsFor(effect.kind);
  if (!legal.includes(effect.target.kind)) {
    return [
      violation(
        'ILLEGAL_TARGET_FOR_EFFECT',
        `${path}.target.kind`,
        `${effect.kind} cannot use target "${effect.target.kind}"; legal targets are ${legal.join(', ')}`,
      ),
    ];
  }
  return [
    ...checkTargetRestriction(effect.target, path),
    ...checkTargetFilter(effect.target, path),
    ...checkTargetCount(effect, path),
  ];
}

/**
 * The card types that reach the stack as a spell, which is every kind but a
 * land: playing a land uses no stack at all (CR 305.9), so it is never a spell
 * and never counterable.
 *
 * Derived from `CARD_KINDS` rather than listed, so a card type added later is
 * counterable the day it is added unless it is a second land-like kind, which
 * would be the one thing worth failing here.
 */
const SPELL_CASTABLE_CARD_KINDS: readonly CardKind[] = CARD_KINDS.filter((kind) => kind !== 'land');

/**
 * The rules a filter's own lists obey wherever it is read: a target slot, a
 * board sweep's `scopeFilter`, or the stack.
 *
 * Nine of them, and every one closes a second spelling of a card or a slot
 * nothing can ever fill rather than a mechanically impossible one. An empty filter is "no constraint" written the
 * long way, and `checkDuplicateEffects` compares effects by `canonicalJson`, so
 * `[destroy{filter:{}}, destroy]` would print one sentence twice and compare as
 * two different effects. A repeated member is the same trick inside one list. A
 * value in both a positive and its negative list is a slot nothing can ever
 * fill, which is a card that reads like removal and plays like a blank. And a
 * card type outside the space the filter is read against — an instant on the
 * battlefield, a land on the stack — is the same blank with a different cause.
 *
 * The two that arrived with `subtypes` (`mtg-nhyv.56`) are a subtype beside a
 * card type — CR 205.3 gives each subtype to one card type, so the pair says
 * the dimension twice and leaves `targetNounPhrase` two candidates for one
 * noun — and a subtype that is not a capitalized word, which is the identical
 * check `Card.subtypes` gets in `validate/typeline.ts` and the reason the field
 * holds free strings rather than an enum.
 *
 * The three that arrived with `allCardTypes` (`mtg-nhyv.2`) are the union and
 * the conjunction in one filter — the dimension stated twice, and the same
 * duplicate-encoding argument `min(2)` makes inside the field itself — a
 * conjunction naming an instant or a sorcery beside a second type, which CR
 * 205.2a says no object is, and the same wanted-and-excluded check the union
 * already gets.
 *
 * `subject` names the space in the message, because the author reading it needs
 * to know which of the two halves refused them.
 */
function checkFilterLists(
  filter: TargetFilter,
  path: string,
  reachableCardTypes: readonly CardKind[],
  subject: string,
): Violation[] {
  const found: Violation[] = [];
  if (targetFilterIsEmpty(filter)) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FILTER',
        path,
        'a filter that states no constraint is "no filter" written the long way; leave the field out',
      ),
    );
    return found;
  }
  if (filter.cardTypes !== undefined && filter.allCardTypes !== undefined) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FILTER',
        path,
        '"cardTypes" asks which of these types the object may be and "allCardTypes" asks which of them it must all be; a filter carrying both states the dimension twice, and one card must have one encoding',
      ),
    );
  }
  // CR 205.3: a subtype belongs to exactly one card type, so naming both says
  // the dimension twice and names the objects the subtype alone already names.
  // It is also what keeps one printed sentence per filter: `targetNounPhrase`
  // hands the noun to the subtype on `targetPermanent`, so a filter carrying
  // both would have two candidates for one noun and "target Forest land" would
  // be a second spelling of "target Forest" (`mtg-nhyv.56`).
  if (filter.subtypes !== undefined && (filter.cardTypes ?? filter.allCardTypes) !== undefined) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FILTER',
        path,
        `subtype "${filter.subtypes.join('", "')}" already fixes the card type it can appear on (CR 205.3), so naming a card type beside it states the dimension twice; drop the card types`,
      ),
    );
  }
  for (const subtype of filter.subtypes ?? []) {
    if (SUBTYPE_PATTERN.test(subtype)) continue;
    found.push(
      violation(
        'INVALID_SUBTYPE',
        `${path}.subtypes`,
        `subtype "${subtype}" must be a capitalized word such as "Goblin"`,
      ),
    );
  }
  const spellKinds = (filter.allCardTypes ?? []).filter((kind) => SPELL_CARD_KINDS.includes(kind));
  if (spellKinds.length > 0 && (filter.allCardTypes ?? []).length > 1) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FILTER',
        `${path}.allCardTypes`,
        `an ${spellKinds.join(' or ')} is never anything else (CR 205.2a), so a conjunction naming it beside another card type is a filter nothing can ever satisfy`,
      ),
    );
  }
  const lists: readonly (readonly [string, readonly string[] | undefined])[] = [
    ['cardTypes', filter.cardTypes],
    ['allCardTypes', filter.allCardTypes],
    ['excludeCardTypes', filter.excludeCardTypes],
    ['subtypes', filter.subtypes],
    ['colors', filter.colors],
    ['excludeColors', filter.excludeColors],
    ['keywords', filter.keywords],
  ];
  for (const [field, list] of lists) {
    if (list === undefined) continue;
    if (new Set(list).size !== list.length) {
      found.push(
        violation('ILLEGAL_TARGET_FILTER', `${path}.${field}`, `"${field}" names the same value twice`),
      );
    }
  }
  const pairs: readonly (readonly [string, readonly string[] | undefined, readonly string[] | undefined])[] =
    [
      ['card type', filter.cardTypes, filter.excludeCardTypes],
      ['card type', filter.allCardTypes, filter.excludeCardTypes],
      ['color', filter.colors, filter.excludeColors],
    ];
  for (const [what, wanted, excluded] of pairs) {
    if (wanted === undefined || excluded === undefined) continue;
    const both = wanted.filter((value) => excluded.includes(value));
    if (both.length > 0) {
      found.push(
        violation(
          'ILLEGAL_TARGET_FILTER',
          path,
          `${what} "${both.join(', ')}" is listed as both wanted and excluded, so nothing can ever satisfy this filter`,
        ),
      );
    }
  }
  for (const [field, list] of [
    ['cardTypes', filter.cardTypes],
    ['allCardTypes', filter.allCardTypes],
    ['excludeCardTypes', filter.excludeCardTypes],
  ] as const) {
    const unreachable = (list ?? []).filter((kind) => !reachableCardTypes.includes(kind));
    if (unreachable.length > 0) {
      found.push(
        violation(
          'ILLEGAL_TARGET_FILTER',
          `${path}.${field}`,
          `${subject} is never ${unreachable.join(' or ')}; legal card types here are ${reachableCardTypes.join(', ')}`,
        ),
      );
    }
  }
  return found;
}

/**
 * A filter narrows a choice among objects, so it is legal on the kinds that
 * make one among objects only.
 *
 * The refusal worth stating is the one for `anyTarget` and
 * `targetPlayerOrPlaneswalker`: both draw from a player space and an object
 * space at once, so a filter on either would enforce the printed condition
 * against half the slot's own legal targets and say nothing about the rest —
 * a card that reads as narrow and plays as wide against the wrong board.
 *
 * The card-type half is narrower again, and it closes a duplicate encoding
 * rather than an impossibility: `targetPermanent` with `{artifact,
 * enchantment}` is `targetArtifactOrEnchantment` spelled a second way, and one
 * card must have one encoding for `checkDuplicateEffects` to be able to compare
 * two effects at all. That kind keeps the pair because 177 cards in Forge's
 * 2.0.14 `res/cardsfolder` write it as one selector and every committed card
 * that answers a permanent already names it.
 */
function checkTargetFilter(target: TargetSpec, path: string): Violation[] {
  const filter = targetFilterOf(target);
  if (filter === null) return [];
  const at = `${path}.target.filter`;
  if (!filterFitsTargetKind(target.kind)) {
    return [
      violation(
        'ILLEGAL_TARGET_FILTER',
        at,
        `a filter narrows a choice among objects; "${target.kind}" names ${targetKindNamesAPlayer(target.kind) ? 'a player' : 'no object to narrow, or draws from a player as well'}`,
      ),
    ];
  }
  const found: Violation[] = [];
  const namesACardType =
    filter.cardTypes !== undefined ||
    filter.allCardTypes !== undefined ||
    filter.excludeCardTypes !== undefined;
  if (namesACardType && !cardTypeFilterFitsTargetKind(target.kind)) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FILTER',
        at,
        `"${target.kind}" has already fixed its card types by being the kind it is; only "targetPermanent" leaves that question open`,
      ),
    );
  }
  // The one field this filter carries that a target slot already had a word
  // for. `TargetRestriction.withKeyword` is where Plummet and Air Servant write
  // it, and admitting both spellings on one slot would give "destroy target
  // creature with flying" two canonical forms — `checkDuplicateEffects`
  // compares effects by `canonicalJson`, so the two would stop comparing equal
  // and one card would have two encodings. The field exists for the group a
  // restriction cannot reach: a board sweep names `noTarget`, and
  // `checkTargetRestriction` refuses a restriction there because it is not a
  // choice at all.
  if (filter.keywords !== undefined) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FILTER',
        `${at}.keywords`,
        `a target slot names a keyword with the "withKeyword" restriction; write { restriction: { kind: "withKeyword", keyword: "${filter.keywords[0] ?? 'flying'}" } } instead, so one card has one encoding`,
      ),
    );
  }
  const wanted = filter.cardTypes ?? [];
  if (wanted.length === 2 && wanted.includes('artifact') && wanted.includes('enchantment')) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FILTER',
        `${at}.cardTypes`,
        'this is the filter spelling of the "targetArtifactOrEnchantment" kind; name that kind instead, so one card has one encoding',
      ),
    );
  }
  return [...found, ...checkFilterLists(filter, at, PERMANENT_CARD_KINDS, 'a permanent')];
}

/**
 * The stack half of the same filter, and the three dimensions that do not carry
 * over.
 *
 * A combat role is a property of a permanent in a combat (CR 506.4); nothing on
 * the stack is attacking, so the field would print a word no board can answer.
 * A keyword is the same objection one rule out: CR 613.1 runs on permanents, so
 * `spellSatisfiesFilter` reads a spell at its printed values, and the field
 * would quietly mean printed-flying here where it means current-flying on the
 * battlefield. A land is never a spell (CR 305.9) — playing one uses no stack
 * at all — so a counter that named it would be a card that can never be cast.
 * Everything else a `TargetFilter` says means the same thing in both places,
 * which is why this reuses the type rather than declaring a stack-shaped twin.
 */
function checkSpellFilter(filter: TargetFilter | undefined, path: string): Violation[] {
  if (filter === undefined) return [];
  const found: Violation[] = [];
  if (filter.keywords !== undefined) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FILTER',
        `${path}.keywords`,
        'CR 613.1 applies to permanents, so a spell on the stack is read at its printed values; "with flying" would mean something narrower here than the one place this field is admitted, and no card in this population counters a spell by keyword',
      ),
    );
  }
  if (filter.combat !== undefined) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FILTER',
        `${path}.combat`,
        'a combat role is a property of a permanent in a combat; nothing on the stack is attacking or blocking',
      ),
    );
  }
  return [...found, ...checkFilterLists(filter, path, SPELL_CASTABLE_CARD_KINDS, 'a spell on the stack')];
}

/**
 * A restriction narrows a choice among creatures, so it is legal on the kinds
 * that make one and on nothing else.
 *
 * The refusal is worth stating rather than leaving to the schema: a player has
 * no power and no keywords, so "target player with power 3 or less" is not a
 * narrower card, it is a card that can never be cast. `noTarget`,
 * `triggeringCreature` and `selfCreature` are refused on the same footing and
 * for a second reason — none of the three is a choice at all, so a restriction
 * on any of them would print a condition the caster never gets to satisfy.
 */
function checkTargetRestriction(target: TargetSpec, path: string): Violation[] {
  const restriction = targetRestrictionOf(target);
  if (restriction === null) return [];
  if (restrictionFitsTargetKind(target.kind)) return [];
  return [
    violation(
      'ILLEGAL_TARGET_RESTRICTION',
      `${path}.target.restriction`,
      `a "${restriction.kind}" restriction narrows a choice among creatures; "${target.kind}" names no creature to narrow`,
    ),
  ];
}

/**
 * `count` turns "target creature" into "up to two target creatures", and three
 * things have to hold for that sentence to mean what it prints.
 *
 * It is legal only on `targetCreature`: "up to two target players" and "up to
 * two target permanents" are not templates this vocabulary has a printed card
 * for, and widening the space a counted slot draws from is a second decision
 * this check should not make silently by leaving it unchecked. It is legal
 * only where `effectAllowsTargetCount` says the effect kind's resolution
 * already knows how to fold N objects into one application — see that table's
 * docblock in `@mtg/dsl`'s `effects.ts` for why the gate is per-effect rather
 * than per-target-kind. And it is mutually exclusive with `distinct`: the two
 * fields answer the same question, how many objects does this slot pick, and
 * `distinct` already answers it by being on a second, independent effect —
 * see `TargetSpecSchema`'s docblock.
 */
function checkTargetCount(effect: TargetedEffect, path: string): Violation[] {
  const count = targetCountOf(effect.target);
  if (count === null) return [];
  const found: Violation[] = [];
  if (effect.target.kind !== 'targetCreature') {
    found.push(
      violation(
        'ILLEGAL_TARGET_COUNT',
        `${path}.target.count`,
        `"up to ${count}" is printed only on "targetCreature"; "${effect.target.kind}" has no such template`,
      ),
    );
  }
  if (!effectAllowsTargetCount(effect.kind)) {
    found.push(
      violation(
        'ILLEGAL_TARGET_COUNT',
        `${path}.target.count`,
        `${effect.kind} has no printed way to apply itself to more than one chosen object at once`,
      ),
    );
  }
  if (requiresDistinctTarget(effect.target)) {
    found.push(
      violation(
        'ILLEGAL_TARGET_COUNT',
        `${path}.target.count`,
        '"count" and "distinct" both answer how many objects this slot picks; a slot cannot answer that twice',
      ),
    );
  }
  return found;
}

/**
 * A one-shot scope and its target slot are one statement, and this is where the
 * halves are held to each other.
 *
 * `scope` changes what the slot is *for*. Unscoped, `exileTarget` names the
 * creature it exiles. Scoped, it names the player whose creatures it exiles, and
 * the creatures are not targets (CR 115.1) — which is the whole reason the group
 * can be larger than one and can include hexproof bodies. Nothing in the schema
 * can say that, because `scope` is one optional field and `target` is another,
 * so `{ scope: 'creaturesThatPlayerControls', target: targetCreature }` parses
 * and means nothing: the kernel would read a player off a permanent target and
 * exile an empty group. Coded rather than silently ignored, for the reason every
 * check in this file is coded — a card whose text and behavior disagree is the
 * failure the vocabulary exists to prevent.
 */
/**
 * The kinds that carry a `scope` field, read off the union rather than listed.
 *
 * A hand-written list would be a fourth place a scoped primitive has to be
 * remembered, and the one place nothing would fail if it were forgotten: a kind
 * missing from it would simply never have its scope checked.
 */
type ScopedEffectKind = {
  [K in AnyEffectKind]: 'scope' extends keyof EffectOf<K> ? K : never;
}[AnyEffectKind];

/**
 * Which scopes each scoped primitive admits, and the answers are not the same
 * because the zones a scope names are not all zones the primitive can act on.
 *
 * `exileTarget` takes all three: exile is a zone change and `moveObject`'s
 * switches are total over `ZoneId`, so a card leaving a hand or a graveyard is
 * as ordinary as a permanent leaving the battlefield.
 *
 * `putCounters` takes the battlefield scopes alone. A counter is something an
 * object on the battlefield carries; a card in a hand or a graveyard has only
 * what is printed on it (CR 611.2c, and `@mtg/kernel`'s `zone-filter.ts` at
 * length), so "put a gloom counter on each creature card in target opponent's
 * graveyard" is a sentence with nowhere to put the counter.
 *
 * `returnFromGraveyard` takes the graveyard scope alone, which is the same
 * sentence from the other end: the primitive is defined as a move *out of* a
 * graveyard, so a scope naming any other zone would name cards that are not
 * where the effect reaches.
 *
 * The four sweepers take the battlefield scopes alone, and each for the reason
 * `putCounters` does one paragraph up rather than for a shared one. Damage is
 * marked on a permanent (CR 120.3), destruction is a move *off* the
 * battlefield, a P/T modification is a layer-7c effect over objects the layer
 * system applies to (CR 611.2c), and tapping is a status only a permanent has
 * (CR 110.5). None of the four has anything to say about a card in a hand or a
 * graveyard, so the groups they can reach are on the battlefield.
 *
 * The **untargeted** scopes are spread across those four rows by census rather
 * than by rule, and the census is M11 and M13's nine printed sweepers
 * (`mtg-9u18`). Every one of them is a destroy, a damage or a pump, so
 * `tapPermanent` gains nothing: the tappers of the era all name a player
 * (Sleep, Frost Breath) and were already expressible. Three of them name a
 * whole board and none names one side of it, so `destroyPermanent` and
 * `dealDamage` take `allPermanents` alone — Day of Judgment, Back to Nature,
 * Planar Cleansing, Pyroclasm and Rain of Blades. Only the pump names a side:
 * Glorious Charge and Inspired Charge are `permanentsYouControl` and Cower in
 * Fear is `permanentsOpponentsControl`, which is why that row is the wide one.
 * A scope no printed card in the population uses would be a widening nothing
 * measured, so each row moves when a card asks it to and not before. That is
 * how `permanentsYouControl` reached `putCounters` and no further: Steel
 * Overseer (M11 214) asks for it by name, nothing in the population puts a
 * counter on a whole board or on the other side of one, and the two rows that
 * would say so stayed where they were.
 *
 * `exileTarget`'s row names its three outright rather than spreading
 * `EFFECT_SCOPES`. It used to spread, which was correct when every member read
 * a targeted player; the untargeted three would have widened the zone-move
 * primitive silently, and "exile all creatures" is a sentence no card in this
 * population prints.
 *
 * `grantKeywordUntilEndOfTurn` takes one scope, and it is the narrowest row in
 * this table for the census reason the paragraph above gives. Every printed
 * mass keyword grant in reach — Overwhelming Stampede (M11 189), Overrun,
 * Cleaver Riot — says "creatures you control" and nothing else says anything:
 * no card hands the other side of the board a keyword, none hands one to a
 * whole board, and none reads a *targeted* player's creatures, so the three
 * older scopes are as absent as the two other space ones. A row that admitted
 * them would be four spellings nothing prints guarding one that everything
 * does.
 */
const SCOPES_LEGAL_ON = {
  exileTarget: ['creaturesThatPlayerControls', 'creatureCardsInPlayerHand', 'creatureCardsInPlayerGraveyard'],
  putCounters: ['creaturesThatPlayerControls', 'permanentsYouControl'],
  returnFromGraveyard: ['creatureCardsInPlayerGraveyard'],
  dealDamage: ['creaturesThatPlayerControls', 'allPermanents'],
  destroyPermanent: ['creaturesThatPlayerControls', 'allPermanents'],
  pumpUntilEndOfTurn: [
    'creaturesThatPlayerControls',
    'allPermanents',
    'permanentsYouControl',
    'permanentsOpponentsControl',
  ],
  tapPermanent: ['creaturesThatPlayerControls'],
  grantKeywordUntilEndOfTurn: ['permanentsYouControl'],
} as const satisfies Readonly<Record<ScopedEffectKind, readonly EffectScope[]>>;

/**
 * Every scope this primitive may carry, and nothing when it carries no `scope`
 * field at all.
 *
 * `legalTargetsFor`'s sibling, and it exists for the reason that one does: a
 * table only this file can read is a table every instrument around it has to
 * restate from memory, and a restated table is right until the day the real one
 * moves. `@mtg/dsl-coverage`'s calibration corpus is the caller that found it —
 * it builds one card per (kind, target) pair straight off `legalTargetsFor`, and
 * it was finishing every board sweep with `allPermanents`, which is true of the
 * four sweepers and became false the moment `putCounters` gained a `noTarget`
 * slot (`mtg-hfex`). The corpus stopped parsing at import time, which is that
 * instrument's alarm working exactly as designed and pointing at the one fix
 * that is not "hardcode the new kind over there too".
 */
export function legalScopesFor(kind: AnyEffectKind): readonly EffectScope[] {
  return kind in SCOPES_LEGAL_ON ? SCOPES_LEGAL_ON[kind as ScopedEffectKind] : [];
}

/**
 * Which card types a damage sweep may name.
 *
 * CR 120.3: damage is dealt to a creature, a planeswalker, a battle or a
 * player, and to nothing else. "Deal 2 damage to each enchantment" parses,
 * prints and resolves into no game action at all, which is the same failure
 * `UNSCOPED_MAY_NAME_A_PLAYER` refuses one screen down and is why this is a
 * coded violation rather than a silent no-op. Battles are outside `CARD_KINDS`,
 * so the list is the two this vocabulary can name.
 */
const DAMAGEABLE_CARD_KINDS: readonly string[] = ['creature', 'planeswalker'];

/**
 * Which card types a keyword grant may name.
 *
 * `KEYWORDS`' nine are combat words — flying, vigilance, haste, trample,
 * deathtouch, lifelink, menace, reach, first strike — and every one of them is
 * a fact about attacking, blocking or dealing combat damage, which is something
 * only a creature does. So "all artifacts you control gain flying" is a layer-6
 * record the kernel would honor, print as a sentence, and change no game action
 * whatsoever. That is the same silent no-op `DAMAGEABLE_CARD_KINDS` refuses one
 * paragraph up, and it is refused here for the same reason: a coded violation
 * names the mistake and a narrower schema would only fail to parse.
 *
 * The targeted form of this primitive already says the same thing by leaving
 * `targetPermanent` off its `EFFECT_RULES` row — "target land gains flying" is
 * a sentence the layer would honor and no card in this world wants to print.
 * A sweep is where that rule would otherwise be reachable, because the scope
 * names a region of the board and the filter is the only thing narrowing it.
 */
const KEYWORD_BEARING_CARD_KINDS: readonly string[] = ['creature'];

/**
 * Whether a scoped primitive's **unscoped** form may name a player too.
 *
 * The missing-scope rule below reads "a player slot with no scope resolves into
 * nothing", and that sentence is true of every member here but one.
 * `dealDamage` acts on whatever it is aimed at, and a player is one of the
 * things it can be aimed at: "deals 3 damage to target player" is a whole card,
 * and was one long before a scope existed. The rest act on a player's
 * *permanents*, and the player slot is only ever the handle the scope reads the
 * group off — destroying, tapping or pumping a player is not a sentence,
 * granting one trample is not either, and exiling or counter-placing one is
 * not.
 *
 * A total record rather than a set, so a primitive that gains a scope has to
 * answer this question rather than inherit an answer. Getting it wrong in the
 * permissive direction is the expensive one: it admits a card that parses,
 * prints, and resolves into no game action at all.
 */
const UNSCOPED_MAY_NAME_A_PLAYER: Readonly<Record<ScopedEffectKind, boolean>> = {
  dealDamage: true,
  exileTarget: false,
  putCounters: false,
  returnFromGraveyard: false,
  destroyPermanent: false,
  pumpUntilEndOfTurn: false,
  tapPermanent: false,
  grantKeywordUntilEndOfTurn: false,
};

/** True when this primitive carries a `scope` field at all. */
function isScopedEffect(effect: Effect): effect is EffectOf<ScopedEffectKind> {
  return effect.kind in SCOPES_LEGAL_ON;
}

/**
 * The `scopeFilter` a primitive carries, or `undefined` when it carries no such
 * field.
 *
 * Six of the eight scoped primitives have one and two do not, so the field is
 * read through a guard rather than off the narrowed union: `exileTarget` and
 * `returnFromGraveyard` take only scopes that name their own objects, and a
 * filter on them is a sentence with two answers to one question. `putCounters`
 * left that pair when it gained `permanentsYouControl` (`mtg-hfex`), because a
 * scope naming a region of the board names no objects and the filter is the
 * only thing that can.
 * Reading it here rather than per-arm is what lets `checkEffectScope` state that
 * rule once for every primitive that could break it.
 */
function scopeFilterOf(effect: EffectOf<ScopedEffectKind>): TargetFilter | undefined {
  return 'scopeFilter' in effect ? effect.scopeFilter : undefined;
}

/**
 * Whether this effect's `scope` and its target slot agree.
 *
 * Exported because an ability's effect list gets the identical check
 * (`validate/abilities.ts`) rather than a second, drifted copy: a
 * `destroyPermanent` aimed at a player with no group beside it resolves into no
 * game action whether it is printed on a sorcery or inside a trigger, and the
 * sentence that says so should be one function. The ability path is not covered
 * by `checkAbilityEffectTarget`, which reads `legalTargetsFor` and so sees only
 * that the player slot is legal on the row.
 */
export function checkEffectScope(effect: Effect, path: string): Violation[] {
  if (!isScopedEffect(effect)) return [];
  const namesAPlayer = targetKindNamesAPlayer(effect.target.kind);
  const legalScopes: readonly EffectScope[] = SCOPES_LEGAL_ON[effect.kind];
  const filter = scopeFilterOf(effect);
  if (effect.scope === undefined) {
    if (filter !== undefined) {
      return [
        violation(
          'ILLEGAL_EFFECT_SCOPE',
          `${path}.scopeFilter`,
          `a scopeFilter narrows a group and this ${effect.kind} has no scope, so it names one permanent and there is no group to narrow; add a scope, or drop the filter`,
        ),
      ];
    }
    if (effect.target.kind === 'noTarget') {
      // The other half of the missing-scope rule, and it exists because the
      // untargeted scopes put `noTarget` on three of these rows. A scoped
      // primitive acts on objects; with no scope it acts on the one object it
      // targets, and with no target either there is no object at all. That card
      // parses, prints a sentence and resolves into nothing, which is the
      // failure this whole check exists to refuse.
      return [
        violation(
          'ILLEGAL_EFFECT_SCOPE',
          `${path}.target.kind`,
          `an unscoped ${effect.kind} reaches the permanent it targets and this effect chooses nothing; give it a target, or add a scope naming the group it reaches`,
        ),
      ];
    }
    if (!namesAPlayer || UNSCOPED_MAY_NAME_A_PLAYER[effect.kind]) return [];
    return [
      violation(
        'ILLEGAL_EFFECT_SCOPE',
        `${path}.target.kind`,
        `an unscoped ${effect.kind} reaches the permanent it targets, and "${effect.target.kind}" names a player; give it a permanent slot, or add a scope saying which of that player's permanents this reaches`,
      ),
    ];
  }
  if (!legalScopes.includes(effect.scope)) {
    return [
      violation(
        'ILLEGAL_EFFECT_SCOPE',
        `${path}.scope`,
        `${effect.kind} cannot use scope "${effect.scope}"; legal scopes are ${legalScopes.join(', ')}`,
      ),
    ];
  }
  if (EFFECT_SCOPE_SUBJECT[effect.scope] === 'targetedPlayer') {
    if (filter !== undefined) {
      return [
        violation(
          'ILLEGAL_EFFECT_SCOPE',
          `${path}.scopeFilter`,
          `scope "${effect.scope}" already names the objects it reaches, so a scopeFilter beside it would be a second, competing answer; drop the filter, or use a scope that names a region of the board`,
        ),
      ];
    }
    if (namesAPlayer) return [];
    return [
      violation(
        'ILLEGAL_EFFECT_SCOPE',
        `${path}.scope`,
        `scope "${effect.scope}" reads its group off a player and this effect targets "${effect.target.kind}"; aim it at a player slot, or drop the scope`,
      ),
    ];
  }
  return checkSpaceScope(effect, effect.scope, filter, path);
}

/**
 * The four rules an **untargeted** scope adds, three of them about the sentence
 * being complete rather than about the board.
 *
 * A space scope chooses nothing (CR 115.1), so a target slot beside it would be
 * a choice the card makes and never reads — the mirror of the missing-scope
 * rule above, and the reason the two arms are separate rather than one
 * `namesAPlayer` check with a flipped sign.
 *
 * A space says *where* and the filter says *what*, so neither is meaningful
 * alone: "destroy all" is not a sentence, and this is where it is refused
 * rather than in the schema, for the reason `putCounters`' scope rule gives —
 * a coded violation names the mistake and a narrower schema would only fail to
 * parse.
 *
 * The last two rules are about the bodies rather than the sentence, and each is
 * spelled out at the list it reads: CR 120.3's at `DAMAGEABLE_CARD_KINDS`, and
 * the keyword grant's at `KEYWORD_BEARING_CARD_KINDS`. They are per-kind arms
 * rather than a table because only two of the eight scoped primitives care
 * which card type they land on; the other six act on whatever the filter names.
 *
 * The fourth rule is `checkFilterLists`, which every filter read against the
 * battlefield obeys and this one was not being handed to. It is stated at its
 * call below rather than here, because what it closes is a gap and not a
 * decision.
 */
function checkSpaceScope(
  effect: EffectOf<ScopedEffectKind>,
  scope: EffectScope,
  filter: TargetFilter | undefined,
  path: string,
): Violation[] {
  if (effect.target.kind !== 'noTarget') {
    return [
      violation(
        'ILLEGAL_EFFECT_SCOPE',
        `${path}.scope`,
        `scope "${scope}" reads its group off the board rather than off a target, and this effect targets "${effect.target.kind}"; give it a "noTarget" slot, or use a scope that reads a targeted player`,
      ),
    ];
  }
  if (filter === undefined || Object.keys(filter).length === 0) {
    return [
      violation(
        'ILLEGAL_EFFECT_SCOPE',
        `${path}.scopeFilter`,
        `scope "${scope}" names a region of the board and not which permanents in it; add a scopeFilter saying which`,
      ),
    ];
  }
  // The same list rules a target slot's filter gets, at the only other site
  // that reads one against the battlefield. They were missing here until
  // `mtg-nhyv.62`, which is a gap rather than a decision: `checkFilterLists`
  // was reached from `checkTargetFilter` and `checkSpellFilter` and from
  // nowhere else, so a sweep could name the same card type twice, or want and
  // exclude one, and no violation said so. It became load-bearing the moment
  // this filter gained a field whose *only* legal site is this one — a field
  // validated nowhere is a field that means whatever the first author types.
  const lists = checkFilterLists(filter, `${path}.scopeFilter`, PERMANENT_CARD_KINDS, 'a permanent');
  if (effect.kind === 'grantKeywordUntilEndOfTurn') {
    const missed = unreachableSweepBodies(filter, KEYWORD_BEARING_CARD_KINDS);
    if (missed === null) return lists;
    return [
      ...lists,
      violation(
        'ILLEGAL_EFFECT_SCOPE',
        `${path}.scopeFilter.${missed.field}`,
        `a granted keyword is a fact about combat and only a ${KEYWORD_BEARING_CARD_KINDS.join(' or a ')} takes part in one, and this sweep names ${describeSweepBodies(missed)}; narrow the filter to the permanents a keyword can reach`,
      ),
    ];
  }
  if (effect.kind !== 'dealDamage') return lists;
  const missed = unreachableSweepBodies(filter, DAMAGEABLE_CARD_KINDS);
  if (missed === null) return lists;
  return [
    ...lists,
    violation(
      'ILLEGAL_EFFECT_SCOPE',
      `${path}.scopeFilter.${missed.field}`,
      `damage is dealt only to ${DAMAGEABLE_CARD_KINDS.join(' and ')} permanents (CR 120.3), and this sweep names ${describeSweepBodies(missed)}; narrow the filter to the permanents damage can reach`,
    ),
  ];
}

/**
 * The card types a sweep's filter names that the effect cannot reach, or `null`
 * when every body it names is one the effect can act on.
 *
 * One function for the two rows that ask it, and the reason is that the
 * question is subtle in the same way twice. The two card-type fields need
 * opposite readings, because they promise opposite things about the body the
 * sweep reaches: every member of a union may turn up alone, so every member has
 * to be reachable, while a conjunction reaches one object that is all of them at
 * once, so one reachable member carries the whole filter — an artifact creature
 * is a creature, and both CR 120.3's damage and a layer-6 keyword find it.
 * Writing that twice with two lists in it is two chances to get the direction
 * backwards on one of them.
 *
 * An empty filter is a miss rather than a pass: `checkSpaceScope` has already
 * refused the filterless sweep, so a filter that reaches here and names no card
 * type at all names every permanent, and neither caller can act on every
 * permanent.
 */
function unreachableSweepBodies(
  filter: TargetFilter,
  reachable: readonly string[],
): { readonly field: 'allCardTypes' | 'cardTypes'; readonly unreachable: readonly string[] } | null {
  const conjunction = filter.allCardTypes ?? [];
  if (conjunction.some((kind) => reachable.includes(kind))) return null;
  const field = conjunction.length > 0 ? 'allCardTypes' : 'cardTypes';
  const named = conjunction.length > 0 ? conjunction : (filter.cardTypes ?? []);
  const unreachable = named.filter((kind) => !reachable.includes(kind));
  if (named.length > 0 && unreachable.length === 0) return null;
  return { field, unreachable };
}

/** The card types a refused sweep names, in the words the violation prints. */
function describeSweepBodies(missed: { readonly unreachable: readonly string[] }): string {
  return missed.unreachable.length === 0 ? 'no card type at all' : `"${missed.unreachable.join('", "')}"`;
}

/**
 * Whether this effect's player sweep and its target slot agree.
 *
 * The same rule `checkSpaceScope` states for a region of the board, one field
 * over and for the same reason: `players` names everybody at the table (CR
 * 101.2), so it chooses nothing, and a target slot beside it would be a choice
 * the card makes and never reads. Temple Bell draws for the table and aims at
 * nobody; a card that aimed at an opponent and then drew for everybody would
 * print one sentence and resolve another.
 *
 * Read off the field rather than off a list of kinds that may carry it. The
 * check was written when `drawCards` was the only carrier and named it in the
 * guard, so the day `loseLife` grew the same field (Howling Banshee's "each
 * player loses 3 life") a sweep beside a live target slot passed validation
 * silently — the schema widened, nothing stopped compiling, and the rule this
 * function exists to state simply stopped applying to the new member.
 * `'players' in effect` is the honest question: whichever primitives carry the
 * field are held to the rule, and one added tomorrow is held to it without an
 * edit here.
 *
 * Exported for the reason `checkEffectScope` is: an ability's effect list runs
 * the identical check rather than a drifted copy of it.
 */
export function checkPlayerSweep(effect: Effect, path: string): Violation[] {
  if (!('players' in effect) || effect.players === undefined) return [];
  if (effect.target.kind === 'noTarget') return [];
  return [
    violation(
      'ILLEGAL_EFFECT_SCOPE',
      `${path}.players`,
      `"${effect.players}" reaches everyone at the table and reads no target, and this "${effect.kind}" targets "${effect.target.kind}"; give it a "noTarget" slot, or drop the sweep and let the target take it alone`,
    ),
  ];
}

/**
 * `distinct` is only meaningful against something it can exclude.
 *
 * It reads "differs from every target this spell already chose", and the
 * renderer turns it into "another target creature". Both statements need an
 * earlier slot that could have named the same object: on `effects[0]`, on a
 * `noTarget` spec, or after a slot drawn from a space this one cannot reach,
 * the constraint can never bite and the printed "another" is a promise the card
 * does not keep. Rejecting is cheaper than printing text the kernel disagrees
 * with, which is the failure this whole vocabulary exists to prevent.
 */
function checkDistinctTargets(effects: readonly Effect[]): Violation[] {
  const found: Violation[] = [];
  for (const [index, effect] of effects.entries()) {
    if (!hasTarget(effect) || effect.target.distinct !== true) continue;
    const path = `effects[${index}].target.distinct`;
    if (effect.target.kind === 'noTarget') {
      found.push(
        violation(
          'ILLEGAL_DISTINCT_TARGET',
          path,
          'a noTarget spec chooses nothing, so there is nothing for "distinct" to exclude; drop the flag or give this effect a real target kind',
        ),
      );
      continue;
    }
    const kind = effect.target.kind;
    const collidable = effects
      .slice(0, index)
      .some((earlier) => hasTarget(earlier) && targetKindsCanCollide(earlier.target.kind, kind));
    if (collidable) continue;
    found.push(
      violation(
        'ILLEGAL_DISTINCT_TARGET',
        path,
        `no earlier effect chooses a target a "${kind}" slot could repeat, so "distinct" excludes nothing and the card would print "another" with no first; drop the flag`,
      ),
    );
  }
  return found;
}

/**
 * Every back-reference in this list has exactly one thing to refer back to.
 *
 * The list-level half of the referent kinds (`mtg-nhyv.75`). `checkEffectTarget`
 * has already decided whether this effect may print "that creature" at all;
 * what it cannot decide is whether the phrase means anything, because that is a
 * fact about the effects *around* it. `referentSourceIndex` (`@mtg/dsl`'s
 * `effects.ts`) is the derivation, and the kernel resolves the referent through
 * the identical call — so a card that validates here is a card `planResolution`
 * can fill, and the two cannot come to different conclusions about which slot
 * the phrase names.
 *
 * Two failures, and they are told apart in the message because the author fixes
 * them differently. No earlier chooser at all means the phrase has no referent
 * — Magic prints no card whose first sentence says "that creature" — and the
 * fix is to add or reorder an effect. More than one earlier chooser of the same
 * space means the phrase has two readings, and the fix is to say which by
 * splitting the card. Neither is a case to guess at: a card that prints one
 * sentence and resolves against another object is the failure this vocabulary
 * exists to refuse, and a nearest-wins rule would make that failure silent.
 *
 * Written over the whole list rather than per effect for `checkDistinctTargets`'
 * reason one function down, and called from the same three places an effect
 * list is checked: a spell's flat list, each of a modal spell's modes, and an
 * ability's own list. A mode is its own list because `effectsFor` hands the
 * kernel one mode's effects and nothing else, so a referent in mode 1 can no
 * more read mode 0's slot than it could read another card's.
 */
export function checkReferentTargets(effects: readonly Effect[], pathPrefix: string): Violation[] {
  const found: Violation[] = [];
  for (const [index, effect] of effects.entries()) {
    if (!hasTarget(effect)) continue;
    const kind = effect.target.kind;
    const space = referentSourceSpace(kind);
    if (space === null) continue;
    if (referentSourceIndex(effects, index) !== null) continue;
    const earlierChoosers = effects
      .slice(0, index)
      .filter(
        (earlier) =>
          hasTarget(earlier) &&
          effectChoosesTarget(earlier) &&
          targetCountOf(earlier.target) === null &&
          (space === 'creature'
            ? targetKindNamesACreature(earlier.target.kind)
            : targetKindNamesAPlayer(earlier.target.kind)),
      ).length;
    found.push(
      violation(
        'ILLEGAL_REFERENT_TARGET',
        `${pathPrefix}[${index}].target.kind`,
        earlierChoosers === 0
          ? `"${kind}" names what an earlier effect chose, and no effect before this one chooses a ${space}; give an earlier effect a ${space} slot or drop the back-reference`
          : `"${kind}" names what an earlier effect chose, and ${String(earlierChoosers)} earlier effects each choose a ${space}, so the phrase has more than one reading; split the card`,
      ),
    );
  }
  return found;
}

/**
 * The same effect object twice is not two effects.
 *
 * The kernel resolves an effects list index by index and picks a target per
 * index, so `[destroyPermanent, destroyPermanent]` enumerates a cast that aims
 * both copies at the same creature and destroys one. The card prints "Destroy
 * target creature. Destroy target creature." and is priced as double removal,
 * which is a card whose text and behavior disagree: exactly what the
 * generator's output space must not contain. A repeat is a slip, a design that
 * wants a real primitive (`drawCards` with a count, a token count), or a design
 * that wants a second *body* — and that last one now has an answer, so it is
 * still not a second identical entry: it is `target.distinct` on the second,
 * which prints "another target creature" and which the kernel refuses to
 * resolve against the first slot's choice.
 *
 * Compared by `canonicalJson` so key order cannot hide a duplicate.
 */
function checkDuplicateEffects(effects: readonly Effect[]): Violation[] {
  const firstSeen = new Map<string, number>();
  const found: Violation[] = [];
  for (const [index, effect] of effects.entries()) {
    const key = canonicalJson(effect);
    const earlier = firstSeen.get(key);
    if (earlier === undefined) {
      firstSeen.set(key, index);
      continue;
    }
    found.push(
      violation(
        'DUPLICATE_EFFECT',
        `effects[${index}]`,
        `this ${effect.kind} repeats effects[${earlier}] exactly; the kernel would resolve both against the same target, so delete it, express the intent as one effect, or — when the design wants a second body — set target.distinct on this entry`,
      ),
    );
  }
  return found;
}

/**
 * A spell has no body, so an effect that reads the source's own body is refused
 * wherever a spell's effect list is checked.
 *
 * The engine reason, not a style rule: `applyResolutionEffects` is called with
 * the *stack* object's oid for a spell, and a stack object is not a creature on
 * the battlefield. A `fight` printed on an instant would find no first fighter
 * and resolve as a silent no-op, which is a card that prints a sentence and
 * does not do it. `checkEffectList` is called once for `card.effects` and once
 * per mode, and `checkEffects` has already refused a permanent's flat effect
 * list outright, so both paths through here are spell paths.
 *
 * `EFFECT_ILLEGAL_ON_CARD_TYPE` rather than a new code: the code already carries
 * exactly this meaning, and `checkActivatedAbility` uses its sibling for the
 * self-regeneration creature-only rule, which is the same shape.
 */
function checkSourceBodyEffect(effect: Effect, path: string): Violation[] {
  if (!isSourceBodyEffect(effect.kind)) return [];
  return [
    violation(
      'EFFECT_ILLEGAL_ON_CARD_TYPE',
      path,
      `${effect.kind} reads the source's own body on the battlefield, and a spell on the stack is not one; print it on a creature's triggered ability`,
    ),
  ];
}

/**
 * Every structural check one effect list gets: per-effect param/target/scope
 * legality, plus the list-level distinct-target and duplicate-effect checks.
 *
 * Extracted so a modal spell's own mode gets the identical rigor rather than
 * a second, drifted copy of this loop — `checkEffects` below calls it once
 * for the card's flat `effects` and once per entry in `card.modes`.
 */
function checkEffectList(
  effects: readonly Effect[],
  pathPrefix: string,
  cardColors: readonly Color[],
): Violation[] {
  const found: Violation[] = [];
  for (const [index, effect] of effects.entries()) {
    const path = `${pathPrefix}[${index}]`;
    found.push(...checkEffectParams(effect, path, cardColors));
    found.push(...checkEffectTarget(effect, path));
    found.push(...checkEffectScope(effect, path));
    found.push(...checkPlayerSweep(effect, path));
    found.push(...checkSourceBodyEffect(effect, path));
  }
  found.push(...checkDistinctTargets(effects));
  found.push(...checkReferentTargets(effects, pathPrefix));
  found.push(...checkDuplicateEffects(effects));
  return found;
}

export function checkEffects(card: Card): Violation[] {
  const found: Violation[] = [];
  const isSpell = card.kind === 'instant' || card.kind === 'sorcery';
  const modes = card.modes ?? [];
  if (!isSpell && card.effects.length > 0) {
    found.push(
      violation(
        'EFFECT_ILLEGAL_ON_CARD_TYPE',
        'effects',
        `a permanent's effects are printed inside its abilities, so ${withArticle(card.kind)} cannot carry a spell's effect list; move them into a triggered ability`,
      ),
    );
  }
  if (!isSpell && modes.length > 0) {
    found.push(
      violation(
        'MODES_ILLEGAL_ON_CARD_TYPE',
        'modes',
        `a permanent's effects are printed inside its abilities, so ${withArticle(card.kind)} cannot carry a modal spell's mode list; move them into a triggered ability`,
      ),
    );
  }
  if (isSpell && card.effects.length > 0 && modes.length > 0) {
    found.push(
      violation(
        'EFFECTS_AND_MODES_BOTH_PRESENT',
        'modes',
        `a spell prints a fixed effect list or a modal one, not both; move the effects into a mode of their own or remove modes`,
      ),
    );
  }
  if (isSpell && card.effects.length === 0 && modes.length === 0) {
    found.push(
      violation(
        'SPELL_WITHOUT_EFFECT',
        'effects',
        `${withArticle(card.kind)} must have at least one effect or at least two modes`,
      ),
    );
  }
  if (!isSpell && card.may !== undefined) {
    found.push(
      violation(
        'MAY_ILLEGAL_ON_CARD_TYPE',
        'may',
        `a permanent's effects are printed inside its abilities, so ${withArticle(card.kind)} cannot carry a spell's "you may" clause; move it into an optional triggered ability`,
      ),
    );
  }
  if (isSpell && card.may !== undefined && modes.length > 0) {
    found.push(
      violation(
        'MAY_AND_MODES_BOTH_PRESENT',
        'may',
        `a spell asks its "you may" question about a fixed effect list, not a choice among modes; move the modal effects into a mode of their own or remove "may"`,
      ),
    );
  }
  found.push(...checkUnless(card, isSpell, modes.length > 0));
  found.push(...checkEffectList(card.effects, 'effects', card.colors));
  found.push(...checkChosenXOnSpell(card, card.effects, 'effects'));
  for (const [modeIndex, mode] of modes.entries()) {
    found.push(...checkEffectList(mode.effects, `modes[${modeIndex}].effects`, card.colors));
    found.push(...checkChosenXOnSpell(card, mode.effects, `modes[${modeIndex}].effects`));
  }
  return found;
}

/**
 * The four bounds on an "unless" clause, all of them the printed line's rather
 * than the engine's.
 *
 * Split into its own function instead of five more blocks inside `checkEffects`
 * because every one of them reads the same three facts — is this a spell, does
 * it print modes, what is its one effect aimed at — and a reader following the
 * modal and "you may" guards above should not have to hold a fourth clause's
 * state to get past them. `unless.ts` argues each bound at length; this states
 * it to the author who tripped it.
 */
function checkUnless(card: Card, isSpell: boolean, hasModes: boolean): Violation[] {
  const clause = card.unless;
  if (clause === undefined) return [];
  const found: Violation[] = [];
  if (!isSpell) {
    found.push(
      violation(
        'UNLESS_ILLEGAL_ON_CARD_TYPE',
        'unless',
        `a permanent's effects are printed inside its abilities, so ${withArticle(card.kind)} cannot carry a spell's "unless" clause`,
      ),
    );
    return found;
  }
  if (hasModes) {
    found.push(
      violation(
        'UNLESS_AND_MODES_BOTH_PRESENT',
        'unless',
        'an "unless" clause names the player its own effect is aimed at, and which effect that is depends on the mode chosen; print the clause on a spell with a fixed effect',
      ),
    );
  }
  if (card.may !== undefined) {
    found.push(
      violation(
        'UNLESS_AND_MAY_BOTH_PRESENT',
        'unless',
        'a spell that pauses twice while it resolves is not a card the kernel can run; keep the "you may" or the "unless" and drop the other',
      ),
    );
  }
  if (clause.cost.hasX) {
    found.push(
      violation(
        'UNLESS_COST_IS_VARIABLE',
        'unless.cost',
        'an {X} toll needs an X, and the payer is not the caster: nothing on this card says what the player being charged would be choosing; state a fixed price',
      ),
    );
  } else if (manaValue(clause.cost) === 0) {
    found.push(
      violation(
        'UNLESS_COST_IS_FREE',
        'unless.cost',
        'a price of {0} is a clause the card prints and never charges; state what stopping this spell costs, or remove the clause',
      ),
    );
  }
  if (card.effects.length !== 1) {
    if (!hasModes) {
      found.push(
        violation(
          'UNLESS_NEEDS_ONE_EFFECT',
          'unless',
          `the clause modifies the sentence it is printed on, and this spell prints ${String(card.effects.length)} of them; a spell carrying "unless" prints exactly one effect`,
        ),
      );
    }
    return found;
  }
  const legal = UNLESS_PAYER_TARGETS[clause.payer];
  const only = card.effects[0];
  const aimed = only !== undefined && hasTarget(only) ? only.target.kind : undefined;
  if (aimed === undefined || !legal.includes(aimed)) {
    found.push(
      violation(
        'UNLESS_PAYER_HAS_NO_TARGET',
        'unless.payer',
        `"${unlessPayerPhrase(clause.payer)}" is read off what this spell targets, and ${aimed === undefined ? 'it targets nothing' : `"${aimed}" is not one of ${legal.join(', ')}`}`,
      ),
    );
  }
  return found;
}

/**
 * A chosen-X amount reads the X paid to cast this exact spell, so it is legal
 * only on a spell whose own mana cost carries `X` (a land has no cast, hence
 * `card.kind !== 'land'` guards this the same way `checkEffects` above does).
 */
function checkChosenXOnSpell(card: Card, effects: readonly Effect[], pathPrefix: string): Violation[] {
  if (card.kind === 'land' || card.manaCost.hasX) return [];
  const found: Violation[] = [];
  for (const [index, effect] of effects.entries()) {
    if (!effectUsesChosenX(effect)) continue;
    found.push(
      violation(
        'CHOSEN_X_WITHOUT_X_COST',
        `${pathPrefix}[${index}]`,
        'a chosen-X amount is legal only on a spell whose own mana cost contains X',
      ),
    );
  }
  return found;
}
