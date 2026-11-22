/**
 * Deterministic oracle-text renderer: structured card -> printed English.
 *
 * The renderer is total over the pinned vocabulary and exhaustive by
 * construction (`assertNever` default), so adding an effect primitive without
 * a print rule is a compile error.
 */
import type {
  Ability,
  ActivatedAbility,
  ActivationCost,
  AttachingAbility,
  LoyaltyCost,
  SacrificeOther,
  SacrificeMatching,
  StaticAbility,
  StaticGameRuleAbility,
  StaticPlayerRuleAbility,
  StaticBundleAbility,
  StateTriggeredAbility,
  StaticModificationOf,
  TriggeredAbility,
} from './abilities';
import {
  flurryRushRank,
  gloomRank,
  isAttachingAbility,
  isCounterTriggeringSpellOrAbilityAbility,
  isControlledCreatureCombatDamageCountersAbility,
  isCombatDamageRetaliationAbility,
  isJaceArchitectAttackDebuffAbility,
  isJaceArchitectPilesAbility,
  isJaceArchitectSearchAndCastAbility,
  isSourceLinkedMatchingPlayCompletionAbility,
  isSourceLinkedTopFiveExileAbility,
  isGuildFeudAbility,
  isDamageTargetAndCreaturesWithSameNameAbility,
  isExaltedAbility,
  isEnchantedLandBecomesTappedMillAbility,
  isOptionalDrawThenDiscardAbility,
  isOptionalDiscardThenDrawAbility,
  isRegenerationAbility,
  isReturnAnotherCreatureOrSacrificeSelfAbility,
  isSacrificeSelfUnlessControllerPaysAbility,
  isControlledSubtypeAttacksTokenAbility,
  isScavengeAbility,
  isVariableLoyaltyCost,
} from './abilities';
import type { AttachModification, CombatModification, LayeredStaticModification } from './abilities';
import type { StaticBundleModification } from './ability-shape';
import type { ReplacementStaticModification } from './static-modification-class';
import { isCombatStaticModification, isLayeredStaticModification } from './static-modification-class';
import type { Amount, ComputedAmount, CountFilter, PermanentTally, PumpAmount } from './amount';
import type { Condition } from './condition';
import { isLiteralAmount, isRateAmount } from './amount';
import type {
  Aura,
  AuraModification,
  Card,
  CastingRestriction,
  EntryCharacteristicMode,
  KeywordAbility,
  ProtectionQuality,
  SpellAlternativeCost,
  TargetingRestriction,
} from './card';
import {
  isArtifact,
  isAuraCard,
  isCastable,
  isSpellCard,
  isStaticAuraModification,
  openingHandActionOf,
  printedEntryReplacement,
  printedPowerToughness,
} from './card';
import type { CounterKind } from './counters';
import { counterName, counterPhrase, counterReminderText } from './counters';
import { describeCostReduction } from './cost-reduction';
import { canonicalJson } from './canonical-json';
import type { CardFilter, Effect, GraveyardArrivalGrant, SearchDestination, TokenSpec } from './effects';
import { hasTarget, isCreatureTokenSpec, referentSourceIndex, tokenAbilities } from './effects';
import type { Modes } from './modal';
import { tokenCard, tokenReferenceName } from './token';
import type { TargetFilter, TargetSpec } from './targets';
import {
  cardTypeFilterFitsTargetKind,
  isGraveyardCardTargetKind,
  requiresDistinctTarget,
  targetCountOf,
  targetMinimumOf,
  targetFilterOf,
  targetFilterIsEmpty,
  targetRestrictionOf,
  targetsAnyNumber,
} from './targets';
import { formatManaCost, manaValue } from './mana';
import { formatOverloadCost, spellEffectsFor } from './overload';
import type {
  CardKind,
  Color,
  EffectScope,
  Keyword,
  ManaColor,
  PlayerScope,
  TargetCombatRole,
} from './vocabulary';
import {
  assertNever,
  COLOR_WORDS,
  COLORS,
  GRANTABLE_KEYWORD_PRINT_NAMES,
  KEYWORD_PRINT_NAMES,
  PERMANENT_CARD_KINDS,
  PT_COUNT_PRINT_TEXT,
  isSpaceScope,
  sortKeywords,
  TRIGGER_PRINT_TEMPLATES,
} from './vocabulary';
import { withUnlessClause } from './unless';
import {
  articleForNumber,
  articleForWord,
  asClause,
  capitalize,
  englishPlural,
  formatDelta,
  formatDeltaBeside,
  formatPtDelta,
  joinWithAnd,
  joinWithOr,
  mayClause,
  numberWord,
  pluralize,
  withArticle,
} from './text-util';

/** The five colors offered at once, which Magic prints as "any color". */
function isAnyColor(produces: readonly ManaColor[]): boolean {
  const distinct = new Set<ManaColor>(produces);
  return distinct.size === COLORS.length && COLORS.every((color) => distinct.has(color));
}

export interface TypeLineParts {
  readonly supertypes: readonly string[];
  readonly types: readonly string[];
  readonly subtypes: readonly string[];
}

/** Structured type line: supertypes, card types (from the discriminant), subtypes. */
export function typeLineParts(card: Card): TypeLineParts {
  const supertypes = card.supertypes.map(capitalize);
  switch (card.kind) {
    case 'creature':
      return {
        supertypes,
        types: isArtifact(card) ? ['Artifact', 'Creature'] : ['Creature'],
        subtypes: card.subtypes,
      };
    case 'instant':
      return { supertypes, types: ['Instant'], subtypes: card.subtypes };
    case 'sorcery':
      return { supertypes, types: ['Sorcery'], subtypes: card.subtypes };
    case 'artifact':
      return { supertypes, types: ['Artifact'], subtypes: card.subtypes };
    case 'land':
      return {
        supertypes,
        types: ['Land'],
        subtypes: card.basicLandType === undefined ? card.subtypes : [card.basicLandType],
      };
    case 'planeswalker':
      return { supertypes, types: ['Planeswalker'], subtypes: card.subtypes };
    case 'battle':
      return { supertypes, types: ['Battle'], subtypes: card.subtypes };
    case 'enchantment':
      return { supertypes, types: ['Enchantment'], subtypes: card.subtypes };
    default:
      return assertNever(card, 'typeLineParts');
  }
}

/** Printed type line, e.g. `Artifact Creature — Golem` or `Basic Land — Mountain`. */
export function renderTypeLine(card: Card): string {
  const parts = typeLineParts(card);
  const left = [...parts.supertypes, ...parts.types].join(' ');
  return parts.subtypes.length > 0 ? `${left} — ${parts.subtypes.join(' ')}` : left;
}

/**
 * What an effect may refer back to, because an earlier effect on the same card
 * already said it.
 *
 * Magic writes a card the way a person speaks: "Exile all creatures target
 * opponent controls. **That player** reveals their hand. Exile all creature
 * cards **from it**." The DSL cannot say sameness — it has one target slot per
 * effect and a `distinct` flag for the opposite — so the repetition is real in
 * the structure and an artifact in the text, and this is where the text stops
 * repeating.
 *
 * Both flags are computed by `renderEffectList` over the effects printed before
 * this one, never guessed per effect.
 */
interface PriorMention {
  /** An earlier effect named the same person, and it can only be that person. */
  readonly samePlayerNamed: boolean;
  /** An earlier effect revealed that person's hand, so "it" has a referent. */
  readonly handShown: boolean;
}

const NOTHING_SAID: PriorMention = { samePlayerNamed: false, handShown: false };

/**
 * A `distinct` slot prints Magic's "another target …" template, which is the
 * printed form of the constraint the kernel enforces on the chosen tuple. The
 * two land together on purpose: text promising a second body while the engine
 * still allowed one is worse than a DSL that cannot say it at all.
 *
 * `back` is the other direction, and it is deliberately narrow: only a repeated
 * `targetOpponent` prints "that player", because that is the only slot whose
 * legal space has exactly one member in a two-player game, so sameness is a fact
 * rather than a hope. A repeated `targetPlayer` really can name two different
 * people and keeps saying "target player" both times.
 */
/**
 * The two halves of a restriction's printed form, because English puts them in
 * different places.
 *
 * A state is an adjective and sits in front of the noun ("target tapped
 * creature"); everything else is a clause and sits behind the whole noun phrase,
 * after any "you control" that is already there ("target creature you control
 * with power 3 or less"). Returning both halves rather than one string is what
 * lets one call site assemble either without knowing which it got.
 */
function restrictionPhrases(target: TargetSpec): { readonly before: string; readonly after: string } {
  const restriction = targetRestrictionOf(target);
  if (restriction === null) return { before: '', after: '' };
  switch (restriction.kind) {
    case 'tapped':
      return { before: 'tapped ', after: '' };
    case 'untapped':
      return { before: 'untapped ', after: '' };
    case 'maxPower':
      return { before: '', after: ` with power ${String(restriction.power)} or less` };
    case 'maxToughness':
      return { before: '', after: ` with toughness ${String(restriction.toughness)} or less` };
    case 'minPower':
      return { before: '', after: ` with power ${String(restriction.power)} or greater` };
    case 'withKeyword':
      return { before: '', after: ` with ${KEYWORD_PRINT_NAMES[restriction.keyword]}` };
    case 'withoutKeyword':
      return { before: '', after: ` without ${KEYWORD_PRINT_NAMES[restriction.keyword]}` };
    // "on it" rather than the bare counter phrase, because a counter is
    // something a permanent carries and English says so: "target creature with
    // a gloom counter" reads as a creature accompanied by one.
    case 'withCounter':
      return { before: '', after: ` with ${counterPhrase(restriction.counter, 1)} on it` };
    case 'playerLostLifeThisTurn':
      return { before: '', after: ' who lost life this turn' };
    default:
      return assertNever(restriction, 'restrictionPhrases');
  }
}

/**
 * The filter's printed adjectives, in the order Magic prints them.
 *
 * Status first, then exclusions, then colors: "target attacking creature",
 * "target nonblack creature", "target black or red permanent". The exclusions
 * are comma-joined rather than "and"-joined, which is Ashes to Ashes' printed
 * wording for exactly this shape ("two target nonartifact, nonblack
 * creatures"), and each one is the `non` prefix Magic writes rather than a
 * clause behind the noun — English puts a negated characteristic in front.
 *
 * The card types are not here. On a battlefield slot they replace the *noun*
 * ("target artifact", not "target artifact permanent"), which is
 * `targetNounPhrase`'s decision, and on the stack they are an adjective in
 * front of "spell", which `renderEffect`'s counter arm assembles.
 *
 * A subtype is here *and* there, and `nounFromFilter` is which. It prints where
 * the slot's noun comes from (`TargetFilterSchema`'s docblock argues it from
 * the three printed cards that settle it): on `targetPermanent` the filter
 * already supplies the noun, so the subtype is the noun and this function must
 * not also say it — "untap target Forest", not "untap target Forest permanent".
 * Everywhere else the kind fixed the noun and a subtype can only qualify it, so
 * it prints here, last of the adjectives and therefore closest to the noun,
 * which is the order Magic writes: "target attacking blue Merfolk creature".
 */
function filterAdjectives(filter: TargetFilter | null, nounFromFilter = false): string {
  if (filter === null) return '';
  const words: string[] = [];
  if (filter.combat !== undefined) words.push(COMBAT_ROLE_WORDS[filter.combat]);
  const excluded = [
    ...(filter.excludeCardTypes ?? []).map((kind) => `non${kind}`),
    ...(filter.excludeColors ?? []).map((color) => `non${COLOR_WORDS[color]}`),
  ];
  if (excluded.length > 0) words.push(excluded.join(', '));
  if (filter.monocolored === true) words.push('monocolored');
  if (filter.colors !== undefined) words.push(joinWithOr(filter.colors.map((color) => COLOR_WORDS[color])));
  if (!nounFromFilter && filter.subtypes !== undefined) words.push(joinWithOr([...filter.subtypes]));
  return words.length === 0 ? '' : `${words.join(' ')} `;
}

/** A mana-value bound is a trailing noun clause, never an adjective. */
function targetFilterBound(filter: TargetFilter | null): string {
  const manaValue =
    filter?.maxManaValue === undefined ? '' : ` with mana value ${filter.maxManaValue} or less`;
  const damage = filter?.dealtDamageThisTurn === true ? ' that dealt damage this turn' : '';
  return `${manaValue}${damage}`;
}

/** Does this list name the complete, current permanent-card type family? */
function isPermanentCardTypeList(types: readonly CardKind[] | undefined): boolean {
  return (
    types !== undefined &&
    types.length === PERMANENT_CARD_KINDS.length &&
    PERMANENT_CARD_KINDS.every((kind) => types.includes(kind))
  );
}

/** CR 506.4's two statuses, and the one printed selector that names both. */
const COMBAT_ROLE_WORDS: Readonly<Record<TargetCombatRole, string>> = {
  attacking: 'attacking',
  blocking: 'blocking',
  attackingOrBlocking: 'attacking or blocking',
};

/**
 * "Artifact creature", and "artifact creatures" — one noun made of two words.
 *
 * A conjunctive card type takes no joining word at all, which is the whole
 * difference from `cardTypes`: that field is a list of alternatives and needs
 * "or" or "and" to say which reading it is, and this one is a single printed
 * noun that English writes by juxtaposition. Only the last word takes the
 * plural, because only the last word is the head.
 */
function conjunctiveCardTypeNoun(types: readonly string[], plural: boolean): string {
  const head = types[types.length - 1] ?? 'permanent';
  return [...types.slice(0, -1), plural ? englishPlural(head) : head].join(' ');
}

/** A stack spell's filter, printed as adjectives and types before the noun. */
function spellFilterWords(filter: TargetFilter | null): string {
  const conjunction = filter?.allCardTypes;
  const types = filter?.cardTypes;
  const kinds =
    conjunction !== undefined
      ? `${conjunctiveCardTypeNoun(conjunction, false)} `
      : types === undefined
        ? ''
        : `${joinWithOr([...types])} `;
  return `${filterAdjectives(filter)}${kinds}`;
}

function targetPhrase(target: TargetSpec, back = false): string {
  const count = targetCountOf(target);
  if (count !== null) return countedTargetPhrase(target, count);
  const { before, after } = restrictionPhrases(target);
  let phrase = targetNounPhrase(target, back);
  // "that player" and "that creature" are back-references to a choice already
  // made and printed; the restriction was printed with it and saying it twice
  // would read as a second condition rather than the same one.
  if (!phrase.startsWith('target') && !phrase.startsWith('another target')) return phrase;
  // Street Spasm's source-attested English binds "without flying" to the
  // creature noun before the controller clause. Forge uses the same ordering
  // in its selector (`Creature.withoutFlying+YouDontCtrl`); leaving the generic
  // restriction suffix after the whole target phrase changes the printed card.
  const restriction = targetRestrictionOf(target);
  const sourceOrderedExclusion =
    target.kind === 'targetCreatureYouDontControl' && restriction?.kind === 'withoutKeyword';
  if (sourceOrderedExclusion) {
    phrase = phrase.replace(
      "creature you don't control",
      `creature without ${KEYWORD_PRINT_NAMES[restriction.keyword]} you don't control`,
    );
  }
  // The restriction's state adjective goes in front of the filter's, so a slot
  // carrying both prints "target tapped attacking creature": both are states,
  // and the one the older field owns keeps the position it has always printed
  // in rather than moving because a second field arrived.
  const adjectives = `${before}${filterAdjectives(targetFilterOf(target), cardTypeFilterFitsTargetKind(target.kind))}`;
  const bound = isGraveyardCardTargetKind(target.kind) ? '' : targetFilterBound(targetFilterOf(target));
  return `${phrase.replace(/^((?:another )?target )/, `$1${adjectives}`)}${sourceOrderedExclusion ? '' : after}${bound}`;
}

/**
 * "Up to two target creatures", with room for the same adjectives a plain
 * slot carries.
 *
 * Counted creature slots print their creature noun and counted `anyTarget`
 * slots print bare “targets,” Magic's current all-target-types template.
 * `checkTargetCardinality` refuses every other plural kind. `distinct` is
 * refused on the same slot, so `targetNounPhrase`'s “another” branch has
 * nothing to contribute here and this does not call it.
 */
function countedTargetPhrase(target: TargetSpec, count: number): string {
  const minimum = targetMinimumOf(target);
  if (minimum > 0) {
    const choices = Array.from({ length: count - minimum + 1 }, (_, index) => numberWord(minimum + index));
    return `${joinWithOr(choices)} targets`;
  }
  const { before, after } = restrictionPhrases(target);
  const adjectives = `${before}${filterAdjectives(targetFilterOf(target))}`;
  if (count === 1) {
    const phrase = targetNounPhrase(target, false);
    return `up to one ${phrase.replace(/^target /, `target ${adjectives}`)}${after}`;
  }
  if (target.kind === 'anyTarget') return `up to ${numberWord(count)} targets`;
  if (target.kind === 'targetCreatureOpponentControls') {
    return `up to ${numberWord(count)} target creatures your opponents control`;
  }
  if (target.kind === 'targetNonlandPermanentOpponentControls') {
    return `up to ${numberWord(count)} target nonland permanents your opponents control`;
  }
  return `up to ${numberWord(count)} target ${adjectives}creatures${after}`;
}

function targetNounPhrase(target: TargetSpec, back: boolean): string {
  const another = requiresDistinctTarget(target) || target.excludeSource === true;
  if (back && !another && target.kind === 'targetOpponent') return 'that player';
  switch (target.kind) {
    case 'anyTarget':
      return another ? 'another target' : 'any target';
    case 'targetCreature':
      return another ? 'another target creature' : 'target creature';
    case 'targetPlayer':
      return another ? 'another target player' : 'target player';
    case 'targetOpponent':
      return another ? 'another target opponent' : 'target opponent';
    case 'targetCreatureYouControl':
      return another ? 'another target creature you control' : 'target creature you control';
    case 'noTarget':
      return 'you';
    case 'triggeringCreature':
      return 'that creature';
    case 'triggeringPlayer':
      return 'that player';
    case 'chosenPlayer':
      return 'the chosen player';
    // The ability's own source, spelled the way Prodigal Pyromancer and Fiery
    // Hellhound spell it rather than by the card's own name: `staticSubject`'s
    // `case 'self'` prints the literal `cardName` for a *static* ability's
    // scope, a different convention region for a different CR (612 vs 115.6a),
    // and this switch's own `triggeringCreature` two lines up is the nearer
    // precedent — one fixed phrase, chosen once, used everywhere the kind
    // appears rather than threaded through as a parameter.
    case 'selfCreature':
      return 'this creature';
    // The same source, printed the way a card that is not a creature has to
    // print it (`mtg-rji`). One fixed phrase for the same reason the case
    // above has one, and the alternative here is worse than a parameter: to
    // print "this artifact" on an artifact and "this enchantment" on an
    // enchantment, the card's kind would have to be threaded through
    // `renderEffect` and every caller of it, and the kind is deliberately
    // legal on all five permanent card types. "This permanent" is the noun
    // that is true of every one of them, which is the whole point of having
    // the kind at all rather than widening `selfCreature`.
    case 'selfPermanent':
      return 'this permanent';
    // The back-references (`mtg-nhyv.75`), each one a fixed phrase for the
    // reason the two source-body cases above are fixed phrases: the noun is a
    // property of the kind, decided once here, rather than a parameter every
    // caller of `renderEffect` would have to supply. Three of those callers do
    // not go through `renderEffectList` at all (`@mtg/forge-export`'s
    // `card-script.ts`, and the play surface's prompt and cast lines), so a
    // threaded noun would have degraded in exactly the places a player reads.
    //
    // `thatCreature` prints what `triggeringCreature` prints, and the identical
    // string is right: English has one phrase for "the creature already named",
    // and which mechanism retained it is not something the card says. `another`
    // is not consulted on any of the three, because `checkDistinctTargets`
    // refuses `distinct` on a kind with an empty `TARGET_SPACES` row — there is
    // no "another that creature".
    case 'thatCreature':
      return 'that creature';
    case 'thatPlayer':
      return 'that player';
    // The printed possessive, Chandra's Outrage's own wording. The apostrophe
    // is the printed one; nothing downstream reads this string as an
    // identifier.
    case 'thatCreaturesController':
      return "that creature's controller";
    case 'thatPlayerOrPlaneswalkerController':
      return "that player or that planeswalker's controller";
    case 'enchantedCreature':
      return 'enchanted creature';
    case 'equippedCreature':
      return 'equipped creature';
    case 'targetCreatureDefendingPlayerControls':
      return another
        ? 'another target creature defending player controls'
        : 'target creature defending player controls';
    case 'targetArtifactOrEnchantment':
      // Disenchant's printed wording, and Naturalize's: one noun phrase for the
      // one selector, never "target artifact and/or enchantment", which is the
      // plural form and belongs to a card that takes more than one.
      return another ? 'another target artifact or enchantment' : 'target artifact or enchantment';
    case 'targetArtifactYouDontControl':
      return another ? "another target artifact you don't control" : "target artifact you don't control";
    case 'targetCreatureYouDontControl':
      // Foe-Razer Regent's printed wording, and Affectionate Indrik's. The
      // apostrophe is the printed one; nothing downstream reads this string as
      // an identifier.
      return another ? "another target creature you don't control" : "target creature you don't control";
    case 'targetCreatureOpponentControls':
      return another
        ? 'another target creature an opponent controls'
        : 'target creature an opponent controls';
    case 'targetNonlandPermanentOpponentControls':
      return another
        ? 'another target nonland permanent an opponent controls'
        : 'target nonland permanent an opponent controls';
    case 'targetNonlandPermanentYouDontControl':
      return another
        ? "another target nonland permanent you don't control"
        : "target nonland permanent you don't control";
    case 'targetPermanentYouNeitherOwnNorControl':
      return another
        ? 'another target permanent you neither own nor control'
        : 'target permanent you neither own nor control';
    case 'targetPermanent': {
      // The one kind whose noun the filter replaces. Magic prints "destroy
      // target artifact", never "destroy target artifact permanent", and prints
      // the bare noun only when nothing narrows it (Bramblecrush reads "destroy
      // target noncreature permanent", where the adjective is an exclusion and
      // the noun survives). `joinWithOr` is Magic's own list: "artifact or
      // land", "artifact, enchantment, or land".
      const filter = targetFilterOf(target);
      const conjunction = filter?.allCardTypes;
      const types = filter?.cardTypes;
      // A subtype stands where a card type would, and never beside one:
      // `checkFilterLists` refuses the pair, because CR 205.3 gives each
      // subtype to exactly one card type and a filter naming both would print
      // "target Forest land" for the objects "target Forest" already names.
      const subtypes = filter?.subtypes;
      const noun =
        subtypes !== undefined
          ? joinWithOr([...subtypes])
          : conjunction !== undefined
            ? conjunctiveCardTypeNoun(conjunction, false)
            : types === undefined
              ? 'permanent'
              : joinWithOr([...types]);
      return `${another ? 'another target ' : 'target '}${noun}`;
    }
    case 'targetPlayerOrPlaneswalker':
      // Lava Axe's current Oracle wording, and Chandra's Fury's. One noun
      // phrase for the one selector, the way `targetArtifactOrEnchantment`
      // above is one phrase for its own.
      return another ? 'another target player or planeswalker' : 'target player or planeswalker';
    case 'targetCardInYourGraveyard':
    case 'targetCardInAGraveyard':
    case 'targetCardInOpponentsGraveyard': {
      const filter = targetFilterOf(target);
      const conjunction = filter?.allCardTypes;
      const types = filter?.cardTypes;
      const subtypes = filter?.subtypes;
      const kind =
        subtypes !== undefined
          ? joinWithOr([...subtypes])
          : conjunction !== undefined
            ? conjunctiveCardTypeNoun(conjunction, false)
            : isPermanentCardTypeList(types)
              ? 'permanent'
              : types === undefined
                ? ''
                : joinWithOr([...types]);
      const zone =
        target.kind === 'targetCardInYourGraveyard'
          ? 'your graveyard'
          : target.kind === 'targetCardInOpponentsGraveyard'
            ? "an opponent's graveyard"
            : 'a graveyard';
      const bound = targetFilterBound(filter);
      const noun = `${kind.length === 0 ? '' : `${kind} `}card${bound} from ${zone}`;
      return `${another ? 'another target' : 'target'} ${noun}`;
    }
    default:
      return assertNever(target.kind, 'targetPhrase');
  }
}

/**
 * The whole object phrase a one-shot scope names, built around the player the
 * effect targets.
 *
 * A phrase rather than a noun, because a scope says where as well as which and
 * English puts the two in different places: "all creatures target opponent
 * controls" and "all creature cards from target opponent's hand" share no
 * template. Total over `EFFECT_SCOPES`, so a scope added without a printed
 * phrase is a compile error here — the same guarantee `KEYWORD_PRINT_NAMES`
 * gives one file over.
 */
const EFFECT_SCOPE_PHRASES: Readonly<
  Record<EffectScope, (who: string, prior: PriorMention, filter: TargetFilter | undefined) => string>
> = {
  creaturesThatPlayerControls: (who) => `all creatures ${who} controls`,
  // "from it" once the hand has been revealed, which is Magic's own wording
  // after "reveals their hand" and is what the card this exists for says.
  creatureCardsInPlayerHand: (who, prior) =>
    prior.handShown ? 'all creature cards from it' : `all creature cards from ${who}'s hand`,
  // A graveyard is a public zone (CR 400.2), so there is no reveal step and
  // therefore no "from it" arm: the phrase never has an earlier sentence to
  // refer back to.
  creatureCardsInPlayerGraveyard: (who) => `all creature cards from ${who}'s graveyard`,
  // The three space scopes name nobody, so `who` goes unread and the group is
  // whatever the filter says: "all creatures", "all enchantments", "all nonland
  // permanents" are Day of Judgment, Back to Nature and Planar Cleansing word
  // for word.
  allPermanents: (_who, _prior, filter) => `all ${scopeNoun(filter, true)}`,
  // No determiner on the two sided scopes, and that is printed rather than
  // arbitrary: `SCOPES_LEGAL_ON` admits them only on the pump and on the
  // keyword grant, where the group is the sentence's *subject*, and Magic
  // writes a subject group bare —
  // "Creatures you control get +1/+1 until end of turn" (Glorious Charge),
  // "Creatures your opponents control get -1/-1 until end of turn" (Cower in
  // Fear). The one deviation left is Trumpet Blast, which prints "Attacking
  // creatures get +2/+0" against this table's "All attacking creatures get
  // +2/+0": `allPermanents` keeps its determiner because its other three cards
  // are object-position destroys that need it, and the sentence a subject group
  // with an adjective wants is a word shorter. One word on one card, and the
  // same deviation `creaturesThatPlayerControls` has printed since it landed.
  permanentsYouControl: (_who, _prior, filter) => `${scopeNoun(filter, true)} you control`,
  permanentsOpponentsControl: (_who, _prior, filter) => `${scopeNoun(filter, true)} your opponents control`,
  creatureCardsInAllGraveyards: () => 'all creature cards from all graveyards',
  targetAndPermanentsItsPlayerControls: (_who, _prior, filter) =>
    `the target and all ${scopeNoun(filter, true)} that player or that permanent's controller controls`,
};

/**
 * The subject a player sweep prints.
 *
 * Singular, which is what lets the arm reading it conjugate the verb once and
 * not per member: "each player" names everybody and still takes "draws", the
 * way Temple Bell prints it, and "each opponent" takes "discards" the way
 * Liliana's Specter prints it. Total over `PLAYER_SCOPES` for the reason the
 * scope tables above are total over theirs.
 *
 * "Each opponent" is printed only where the effect carries the scope, never as
 * a loosening of `targetOpponent`. That substitution is the one failure this
 * renderer exists to prevent, and `renderEffect`'s `loseLife` arm says so at
 * length.
 */
const PLAYER_SCOPE_PHRASES: Readonly<Record<PlayerScope, string>> = {
  eachPlayer: 'Each player',
  eachOpponent: 'Each opponent',
};

/**
 * The noun a space scope's filter names, in the number the sentence needs.
 *
 * `permanent` when the filter names no card type, which is the noun Magic
 * reaches for when a sweep crosses types (Planar Cleansing's "all nonland
 * permanents"), and the card types themselves otherwise, because on a
 * battlefield group they replace the noun exactly as they do in
 * `targetNounPhrase`.
 *
 * Joined with "and" in both numbers, where a target's types are joined with
 * "or". That is the difference between choosing one object from a union and
 * hitting every object in it: Star of Extinction deals its damage "to each
 * creature and planeswalker", and no sweep prints "or".
 */
function scopeNoun(filter: TargetFilter | undefined, plural: boolean): string {
  const adjectives = filterAdjectives(filter ?? null);
  const clause = keywordClause(filter);
  const conjunction = filter?.allCardTypes;
  if (conjunction !== undefined) {
    return `${adjectives}${conjunctiveCardTypeNoun(conjunction, plural)}${clause}`;
  }
  const types = filter?.cardTypes ?? [];
  const nouns = types.length === 0 ? ['permanent'] : [...types];
  return `${adjectives}${joinWithAnd(plural ? nouns.map(englishPlural) : nouns)}${clause}`;
}

/** The noun for choosing members of a filtered permanent set: alternatives stay "or". */
function permanentChoiceNoun(filter: TargetFilter | undefined, plural: boolean): string {
  const nounFromSubtype = filter?.subtypes !== undefined;
  const adjectives = filterAdjectives(filter ?? null, nounFromSubtype);
  const clause = keywordClause(filter);
  const conjunction = filter?.allCardTypes;
  if (conjunction !== undefined) {
    return `${adjectives}${conjunctiveCardTypeNoun(conjunction, plural)}${clause}`;
  }
  const alternatives = filter?.subtypes ?? filter?.cardTypes;
  if (alternatives === undefined) return `${adjectives}${plural ? 'permanents' : 'permanent'}${clause}`;
  // Magic treats Equipment as a mass type: Turn to Slag says "all Equipment",
  // while ordinary subtypes such as Auras and creatures take their plural.
  const nouns = plural
    ? alternatives.map((word) => (word === 'Equipment' ? word : englishPlural(word)))
    : [...alternatives];
  return `${adjectives}${joinWithOr(nouns)}${clause}`;
}

/**
 * Live filter clauses printed behind the noun rather than in front of it.
 *
 * A keyword is the one narrowing in `TargetFilter` that English will not take
 * as an adjective, which is why it is not in `filterAdjectives` beside the
 * colors: Magic writes "each creature with flying" (Silklash Spider, M13 191)
 * and never "each flying creature". Behind the noun is also what puts it in the
 * right place on a sided scope — the templates append "you control" after this
 * whole phrase, so Thundermaw Hellkite's "each creature with flying your
 * opponents control" comes out in the printed order without the template
 * knowing the clause is there.
 *
 * "and" rather than "or", for the reason `ObjectFilter.keywords` is read with
 * `every`: a keyword list is a conjunction, so a group narrowed by two is the
 * creatures that have both.
 *
 * Only a `scopeFilter` reaches this. On a target slot the same narrowing is a
 * `withKeyword` restriction and `restrictionPhrases` prints it, which is the
 * validator's rule (`checkTargetFilter`) read back out as a rendering: one
 * printed sentence, one place that writes it.
 * `dealtDamageThisTurn` joins this path because its relative clause has the
 * same trailing position: "each creature that dealt damage this turn."
 */
function keywordClause(filter: TargetFilter | undefined): string {
  const keywords = filter?.keywords;
  const excluded = filter?.excludeKeywords;
  const clauses = [
    ...(keywords === undefined
      ? []
      : [`with ${joinWithAnd(keywords.map((keyword) => KEYWORD_PRINT_NAMES[keyword]))}`]),
    ...(excluded === undefined
      ? []
      : [`without ${joinWithAnd(excluded.map((keyword) => KEYWORD_PRINT_NAMES[keyword]))}`]),
    ...(filter?.dealtDamageThisTurn === true ? ['that dealt damage this turn'] : []),
  ];
  return clauses.length === 0 ? '' : ` ${joinWithAnd(clauses)}`;
}

/**
 * The same three groups named one member at a time.
 *
 * A second table rather than a second arm of the first, because the two are
 * different grammatical numbers and Magic uses them in different sentences. An
 * effect that does one thing to a group takes the plural — "exile all creatures
 * target opponent controls" — and an effect that repeats a thing per member
 * takes the distributive singular: "put a -1/-1 counter on each creature target
 * opponent controls", never "on all creatures". Rendering the sweeper through
 * the plural phrase would print one counter for a whole board.
 *
 * Total over `EFFECT_SCOPES` for the reason the table above is, even though
 * `SCOPES_LEGAL_ON` admits far less than that on the two primitives that read
 * it: the renderer is total over what the schema can hold, and the validator is
 * what narrows it. That is also why the two sided scopes read grammatically
 * here and not in the plural table — the combinations where the determiner
 * would be missing are combinations the validator refuses.
 */
const EFFECT_SCOPE_EACH_PHRASES: Readonly<
  Record<EffectScope, (who: string, filter: TargetFilter | undefined) => string>
> = {
  creaturesThatPlayerControls: (who) => `each creature ${who} controls`,
  creatureCardsInPlayerHand: (who) => `each creature card in ${who}'s hand`,
  creatureCardsInPlayerGraveyard: (who) => `each creature card in ${who}'s graveyard`,
  // "each creature" and "each attacking creature" are Pyroclasm and Rain of
  // Blades; "each creature and planeswalker" is Star of Extinction, and it is
  // one "each" over a joined noun rather than two, which is why the join lives
  // inside `scopeNoun` rather than around this template.
  allPermanents: (_who, filter) => `each ${scopeNoun(filter, false)}`,
  permanentsYouControl: (_who, filter) => `each ${scopeNoun(filter, false)} you control`,
  permanentsOpponentsControl: (_who, filter) => `each ${scopeNoun(filter, false)} your opponents control`,
  creatureCardsInAllGraveyards: () => 'each creature card in all graveyards',
  targetAndPermanentsItsPlayerControls: (_who, filter) =>
    `target player or planeswalker and each ${scopeNoun(filter, false)} that player or that planeswalker's controller controls`,
};

/**
 * What a `countMatching` filter names, in the noun a card prints: "Zombies",
 * "creatures", or nothing narrower than "permanents" when the filter carries
 * neither constraint.
 *
 * Subtypes win when both are present — Magic's own convention is to drop the
 * card-type word once a subtype is specific enough to carry it ("the number
 * of Zombies you control", never "the number of Zombie creatures you
 * control"), and every subtype this filter can name is specific in that
 * sense because `CountFilterSchema` has no field for anything broader than a
 * subtype and a card type.
 */
function countMatchingPhrase(filter: CountFilter): string {
  const subtypes = filter.subtypes ?? [];
  if (subtypes.length > 0) return joinWithAnd(subtypes.map(englishPlural));
  const cardTypes = filter.cardTypes ?? [];
  if (cardTypes.length > 0) return joinWithAnd(cardTypes.map(englishPlural));
  return 'permanents';
}

/**
 * The same filter in the singular, for the one frame that needs it.
 *
 * "For each" distributes over one thing at a time — a card prints "for each
 * Goblin you control", never "for each Goblins you control" — while
 * `computedPhrase`'s "the number of" frame one function up takes the plural.
 * Two frames, two spellings, and the pluralization is the only difference, so
 * this shares the precedence order (subtypes over card types) rather than
 * restating it.
 */
function countMatchingSingular(filter: CountFilter): string {
  const subtypes = filter.subtypes ?? [];
  if (subtypes.length > 0) return joinWithAnd([...subtypes]);
  const cardTypes = filter.cardTypes ?? [];
  if (cardTypes.length > 0) return joinWithAnd([...cardTypes]);
  return 'permanent';
}

/** The identity constraint trails the battlefield/controller phrase in Magic templating. */
function countMatchingNameClause(filter: CountFilter): string {
  return filter.names === undefined ? '' : ` named ${joinWithOr([...filter.names])}`;
}

/** Structured keyword-ability predicates trail the controller phrase in current Oracle. */
function countMatchingKeywordAbilityClause(filter: CountFilter): string {
  return filter.keywordAbilities === undefined ? '' : ' with defender';
}

/**
 * The counter half of `countWithCounter`: "with a horn counter on it".
 *
 * The names print in the order the card listed them, the way
 * `countMatchingPhrase` prints subtypes in the order the card listed them — a
 * card that says "fang, hide, horn, talon, or wing" chose that order, and
 * reordering it into declaration order would print a sentence nobody wrote.
 * "Or" and not "and", because a permanent qualifies by carrying any one of
 * them; the article comes from the joined phrase rather than the first name, so
 * a counter kind whose name starts with a vowel gets "an" the day one exists.
 *
 * `on it` against `on them` is the same singular/plural split
 * `countMatchingSingular` exists for, and it is the pronoun rather than the
 * noun that moves: Magic prints "with a +1/+1 counter on them", never
 * "counters".
 */
function counterClause(counters: readonly CounterKind[], plural: boolean): string {
  const names = withArticle(joinWithOr(counters.map(counterName)));
  return `with ${names} counter on ${plural ? 'them' : 'it'}`;
}

/** What a CR 613 rate is charged per, in the words a card prints. */
function permanentTallyPhrase(tally: PermanentTally): string {
  switch (tally.kind) {
    case 'countMatching': {
      const noun = `${tally.excludeSource === true ? 'other ' : ''}${countMatchingSingular(tally.filter)}`;
      const domain = tally.whose === 'each' ? 'on the battlefield' : 'you control';
      return `${noun} ${domain}${countMatchingNameClause(tally.filter)}${countMatchingKeywordAbilityClause(tally.filter)}`;
    }
    case 'countWithCounter':
      return `${countMatchingSingular(tally.filter)} you control${countMatchingNameClause(tally.filter)}${countMatchingKeywordAbilityClause(tally.filter)} ${counterClause(tally.counters, false)}`;
    case 'landsWithSubtype':
      return tally.whose === 'each' ? `${tally.subtype} on the battlefield` : `${tally.subtype} you control`;
    default:
      return assertNever(tally, 'permanentTallyPhrase');
  }
}

/**
 * What each computed amount counts, in the words a card prints.
 *
 * Total over `ComputedAmount['kind']` via `assertNever`'s default arm, the
 * same totality `renderEffect` and `typeLineParts` use a few sections away —
 * so a computed shape added without a printed phrase is a compile error
 * rather than a card that renders its own discriminant. A `Record` sufficed
 * while every phrase was a fixed string; `cardsInGraveyard`'s phrase depends
 * on `'you'` vs `'each'` and `countMatching`'s depends on the filter the card
 * printed (CR 107.3h's "the number of Zombies you control" varies card to
 * card), so this reads its cases through a switch instead.
 */
function computedPhrase(amount: ComputedAmount): string {
  switch (amount.kind) {
    case 'exiledThisResolution':
      return 'the number of cards exiled this way';
    case 'permanentsExiledThisResolution':
      return 'the number of permanents exiled this way';
    case 'cardsShuffledFromGraveyardThisResolution':
      return 'the number of cards shuffled from your graveyard this way';
    case 'cardsInGraveyard':
      return amount.whose === 'each'
        ? 'the number of cards in all graveyards'
        : 'the number of cards in your graveyard';
    case 'controllerLifeTotal':
      return 'your life total';
    case 'countMatching':
      return `the number of ${amount.excludeSource === true ? 'other ' : ''}${countMatchingPhrase(amount.filter)} ${amount.whose === 'each' ? 'on the battlefield' : 'you control'}${countMatchingNameClause(amount.filter)}${countMatchingKeywordAbilityClause(amount.filter)}`;
    case 'countWithCounter':
      return `the number of ${countMatchingPhrase(amount.filter)} you control${countMatchingNameClause(amount.filter)}${countMatchingKeywordAbilityClause(amount.filter)} ${counterClause(
        amount.counters,
        true,
      )}`;
    case 'countMatchingOpponent':
      // Plural "opponents" in a two-player engine, because it is the wording
      // Magic prints and the wording survives a table with more seats; the
      // kernel's `opponentOf` is what is singular, and that is its business.
      return `the number of ${countMatchingPhrase(amount.filter)} your opponents control${countMatchingNameClause(amount.filter)}${countMatchingKeywordAbilityClause(amount.filter)}`;
    case 'landsWithSubtype':
      return amount.whose === 'each'
        ? `the number of ${englishPlural(amount.subtype)} on the battlefield`
        : `the number of ${englishPlural(amount.subtype)} you control`;
    case 'chosenX':
      return 'the value chosen for X';
    case 'greatestPowerAmong':
      return `the greatest power among ${countMatchingPhrase(amount.among)} you control${countMatchingNameClause(amount.among)}${countMatchingKeywordAbilityClause(amount.among)}`;
    case 'damageDealtThisResolution':
      return 'the damage dealt this way';
    case 'lifeLostThisResolution':
      return 'the life lost this way';
    case 'thatCreatureToughness':
      return "that creature's toughness";
    case 'triggeringCreaturePower':
      return "that creature's power";
    case 'triggeringCreatureToughness':
      return "that creature's toughness";
    case 'triggeringDamageAmount':
      return 'that much';
    case 'triggeringSpellChosenColorCount':
      return 'the number of chosen colors that spell is';
    case 'paidSacrificePower':
      return "the sacrificed creature's power";
    case 'paidSacrificeToughness':
      return "the sacrificed creature's toughness";
    case 'paidDiscardManaValue':
      return "the discarded card's mana value";
    case 'sacrificedPermanentPowerThisResolution':
      return "that permanent's power";
    case 'halfTargetLibraryRoundedDown':
      return "half the targeted player's library, rounded down";
    case 'revealedCardManaValueThisResolution':
      return 'its mana value';
    default:
      return assertNever(amount, 'computedPhrase');
  }
}

/**
 * Magic's two templates for a quantity, chosen by which one the card has.
 *
 * A numeral goes where a numeral goes. A computed amount does not: "deals 3
 * damage" becomes "deals damage equal to the number of cards exiled this way",
 * which moves the noun and drops the numeral rather than substituting into it.
 * That is why every arm of `renderEffect` that carries an amount has two
 * sentences in it rather than one sentence with a hole — a substitution would
 * print "deals the number of cards exiled this way damage".
 *
 * The one exception is a P/T bonus, where Magic has no "equal to" form and uses
 * the letter convention instead ("gets +X/+X until end of turn, where X is …").
 * `renderPump` below is that arm.
 */
function amountEqualTo(amount: ComputedAmount): string {
  return `equal to ${computedPhrase(amount)}`;
}

/**
 * "+X/+X until end of turn, where X is …" — the letter convention, which is the
 * only templating Magic offers for a computed P/T change.
 *
 * `power` and `toughness` are independent `Amount`s, so a pump effect can
 * name two distinct computed kinds — power counting the board, toughness
 * counting a resolution's exiles — now that `ComputedAmount` has more than
 * one member; `seen`/`letters` below is what assigns each distinct kind its
 * own letter rather than collapsing both onto `X`. It stayed written this
 * way, rather than assuming one letter, for exactly this day.
 *
 * A rate is the other templating, and it is a different sentence rather than a
 * different letter: Mutilate prints "All creatures get -1/-1 until end of turn
 * for each Swamp you control", where the numerals on the P/T line are the rate
 * itself and the count is named once, at the end, for the pair. Pushing that
 * through the letter convention would print "get +X/+X … where X is the number
 * of Swamps you control", which is a different card — it says one Swamp is
 * worth one point of power, not one point per Swamp on both halves. So the
 * rate arm returns before `seen` is ever touched.
 */
function renderPump(
  subject: string,
  power: PumpAmount,
  toughness: PumpAmount,
  singular = true,
  keyword?: Keyword,
  durationFirst = false,
): string {
  // The keyword rider joins the same sentence rather than starting a second
  // one, which is the whole of what it buys: Magic prints "Target creature gets
  // +2/+2 and gains flying until end of turn", and the two-sentence form is a
  // spell with two targets and a different card. One duration covers both
  // clauses because both modifications end at the same moment, so "until end of
  // turn" is said once, at the end, exactly as the printed cards say it.
  const rider =
    keyword === undefined ? '' : ` and ${singular ? 'gains' : 'gain'} ${KEYWORD_PRINT_NAMES[keyword]}`;
  const verb = singular ? 'gets' : 'get';
  if (isRateAmount(power) || isRateAmount(toughness)) {
    // Both halves or neither, charged against one tally, because the printed
    // sentence names the count once and covers the whole P/T line with it.
    // `checkPumpParams` refuses every other pairing by name; this is the
    // `renderEquipAbility` arrangement, where the renderer states the shape it
    // was promised instead of inventing a sentence for one nobody validated.
    if (!isRateAmount(power) || !isRateAmount(toughness)) {
      throw new Error('a half-rate pump reached renderPump; checkPumpParams should have refused it first');
    }
    if (canonicalJson(power.each) !== canonicalJson(toughness.each)) {
      throw new Error(
        'a pump charged against two different tallies reached renderPump; checkPumpParams should have refused it first',
      );
    }
    const change = `${subject} ${verb} ${formatPtDelta(power.rate, toughness.rate)}`;
    const tally = `for each ${permanentTallyPhrase(power.each)}`;
    return durationFirst
      ? `Until end of turn, ${lowercaseOpening(change)} ${tally}${rider}.`
      : `${change}${rider} until end of turn ${tally}.`;
  }
  if (durationFirst) {
    throw new Error(
      'a duration-first pump without a rate reached renderPump; checkPumpPresentation should have refused it first',
    );
  }
  const letters = ['X', 'Y'] as const;
  const seen: ComputedAmount[] = [];
  // The partner is read so a zero takes the sign of the number beside it, which
  // is `formatPtDelta`'s rule and the reason it cannot be applied to the pair
  // wholesale here: either half may be computed, and a computed half prints a
  // letter with no sign to lend. A computed partner is therefore positive, which
  // is what `+X` already says.
  const symbol = (amount: Amount, partner: Amount): string => {
    if (isLiteralAmount(amount)) {
      return isLiteralAmount(partner) ? formatDeltaBeside(amount, partner) : formatDelta(amount);
    }
    const already = seen.findIndex((entry) => entry.kind === amount.kind);
    const index = already === -1 ? seen.push(amount) - 1 : already;
    return `+${letters[index] ?? 'X'}`;
  };
  const deltas = `${symbol(power, toughness)}/${symbol(toughness, power)}`;
  const clause = seen
    .map((entry, index) => `${letters[index] ?? 'X'} is ${computedPhrase(entry)}`)
    .join(' and ');
  const where = clause.length === 0 ? '' : `, where ${clause}`;
  // The verb agrees with the subject for the reason `StaticSubject` carries a
  // number a few sections down: Magic prints "Skywatch Sentinel gets +1/+1" and
  // "All creatures target player controls get +3/+3", and the number belongs to
  // the subject rather than to the modification.
  return `${subject} ${verb} ${deltas}${rider} until end of turn${where}.`;
}

function colorPhrase(colors: readonly Color[]): string {
  if (colors.length === 0) return 'colorless';
  return joinWithAnd(colors.map((color) => COLOR_WORDS[color]));
}

/**
 * "That creature is a black Zombie in addition to its other colors and types."
 *
 * The trailing clause names only the dimensions the grant actually touches, the
 * way the printed cards do: Rise from the Grave adds a color and a subtype and
 * says "colors and types", and a grant that only recolors would print a
 * sentence about types it never changed. Empty grants never reach here —
 * `checkGraveyardArrivalParams` refuses a grant with neither list — so the
 * absent case is the absent field and nothing else.
 *
 * The colors are adjectives and the subtypes are the noun, which is English and
 * also Magic's own order on the card. One indefinite article covers the whole
 * phrase, taken from its first word.
 */
function grantSentence(grant: GraveyardArrivalGrant | undefined): string {
  if (grant === undefined) return '';
  const colors = grant.colors ?? [];
  const subtypes = grant.subtypes ?? [];
  const words = [...colors.map((color) => COLOR_WORDS[color]), ...subtypes];
  const phrase =
    subtypes.length === 0 ? joinWithAnd(words) : `${articleForWord(words[0] ?? '')} ${words.join(' ')}`;
  const dimensions = colors.length === 0 ? 'types' : subtypes.length === 0 ? 'colors' : 'colors and types';
  return ` That creature is ${phrase} in addition to its other ${dimensions}.`;
}

function keywordPhrase(keywords: readonly Keyword[]): string {
  return joinWithAnd(sortKeywords(keywords).map((keyword) => KEYWORD_PRINT_NAMES[keyword]));
}

function characteristicPowerToughnessSentence(
  characteristic: NonNullable<Card['characteristicPowerToughness']>,
  subject: string,
): string {
  switch (characteristic.kind) {
    case 'creaturesYouControl':
      return `${subject} power and toughness are each equal to the number of creatures you control.`;
    case 'controllerLifeTotal':
      return `${subject} power and toughness are each equal to your life total.`;
    case 'controlledSubtype':
      return `${subject} power and toughness are each equal to the number of ${englishPlural(characteristic.subtype)} you control.`;
    default:
      return assertNever(characteristic, 'characteristicPowerToughnessSentence');
  }
}

/**
 * What the token *has*, as the creating card prints it.
 *
 * Most token abilities are deliberately absent. Magic names those tokens and
 * leaves their text on the token card; inlining every part token's Fuse ability
 * drove several flagship set cards past the printed-text cap (`mtg-hmb`). A
 * hand-authored token may set `quoteAbilities` when the creating card itself
 * prints the quoted text, as Mitotic Slime does. Keywords remain the compact
 * "with flying" clause in the ordinary form.
 *
 * The name that replaces the dropped text is `tokenReferenceName`'s, which is
 * `tokenCard`'s: the pointer a creating card prints has to be the name on the
 * card it points at, and there is one function deciding what that card is.
 *
 * The returned clause closes the sentence it is appended to, punctuation
 * included.
 */
function tokenHavingClause(token: TokenSpec, plural: boolean): string {
  const printedReminder =
    token.printedKeywordReminder === 'vigilance'
      ? ` (Attacking doesn't cause ${plural ? 'them' : 'it'} to tap.)`
      : '';
  if (token.characteristicPowerToughness !== undefined) {
    const quoteAllRules = token.quoteAbilities === true;
    const quoted = [
      ...(quoteAllRules && token.keywords.length > 0 ? [keywordRowText(token.keywords)] : []),
      characteristicPowerToughnessSentence(token.characteristicPowerToughness, "This token's"),
      ...(quoteAllRules ? tokenAbilities(token).map((ability) => renderAbility(ability, 'this token')) : []),
    ].join(' ');
    const inlineKeywords =
      !quoteAllRules && token.keywords.length > 0 ? ` with ${keywordPhrase(token.keywords)}` : '';
    return `${inlineKeywords}. ${plural ? 'They have' : 'It has'} "${quoted}"${printedReminder}`;
  }
  if (token.quoteAbilities === true) {
    if (token.inlineQuotedAbilities === true) {
      return ` with "${renderTokenOracleText(token)}"${printedReminder}`;
    }
    return `. ${plural ? 'They have' : 'It has'} "${renderTokenOracleText(token)}"${printedReminder}`;
  }
  if (token.keywords.length === 0) return `.${printedReminder}`;
  return ` with ${keywordPhrase(token.keywords)}.${printedReminder}`;
}

/**
 * "named Trophy Horn", or nothing.
 *
 * Only a token whose text this card no longer prints needs the pointer: a
 * vanilla or keyword-only token is fully described by the phrase in front of it,
 * and "Create a 1/1 white Soldier creature token named Soldier" is noise. A
 * noncreature token is already named by its own clause, which is why this is
 * reached from the creature half alone.
 */
function tokenNameClause(token: TokenSpec): string {
  return tokenAbilities(token).length > 0 && token.quoteAbilities !== true
    ? ` named ${tokenReferenceName(token)}`
    : '';
}

/**
 * "Create a Trophy Horn token. It's an artifact." — the noncreature
 * half of the primitive.
 *
 * A token with no body is named rather than described: there is no `2/2 white
 * Soldier` phrase to build, so the name carries the identity and a second
 * sentence states the type, which is how Magic prints Treasure, Food and Clue.
 *
 * That second sentence is not in parentheses. It states a rule — what type the
 * token is, and which keywords it has — so it reads as one. The token's printed
 * abilities are not in it; `tokenHavingClause` says why, and the name in the
 * first sentence is the pointer to where they are printed.
 */
function renderNoncreatureTokenClause(count: Amount, token: TokenSpec): string {
  const single = isLiteralAmount(count) && count === 1;
  const noun = single ? 'token' : 'tokens';
  const sentence = isLiteralAmount(count)
    ? `Create ${single ? articleForWord(token.name) : numberWord(count)} ${token.name} ${noun}.`
    : `Create a number of ${token.name} ${noun} ${amountEqualTo(count)}.`;
  const subject = single ? "It's an artifact" : "They're artifacts";
  return `${sentence} ${subject}${tokenHavingClause(token, !single)}`;
}

function renderTokenClause(count: Amount, token: TokenSpec): string {
  if (!isCreatureTokenSpec(token)) return renderNoncreatureTokenClause(count, token);
  const plural = !isLiteralAmount(count) || count !== 1;
  const body = [
    ...(token.creationPowerToughness !== undefined
      ? ['X/X']
      : token.characteristicPowerToughness === undefined
        ? [`${token.power}/${token.toughness}`]
        : []),
    colorPhrase(token.colors),
    ...token.subtypes,
    'creature',
    plural ? 'tokens' : 'token',
  ].join(' ');
  const named = `${body}${tokenNameClause(token)}`;
  if (!isLiteralAmount(count)) {
    if (count.kind === 'controllerLifeTotal') {
      return `Create X ${named}, where X is your life total${tokenHavingClause(token, true)}`;
    }
    if (count.kind === 'paidSacrificeToughness') {
      return `Create X ${named}, where X is the sacrificed creature's toughness${tokenHavingClause(token, true)}`;
    }
    return `Create a number of ${named} ${amountEqualTo(count)}${tokenHavingClause(token, true)}`;
  }
  const quantity =
    count === 1
      ? token.creationPowerToughness !== undefined
        ? 'an'
        : token.characteristicPowerToughness === undefined
          ? articleForNumber(token.power)
          : articleForWord(body)
      : numberWord(count);
  return `Create ${quantity} ${named}${tokenHavingClause(token, plural)}`;
}

/**
 * One printed sentence for a single effect. `cardName` fills CARDNAME slots.
 *
 * `prior` is what the effects printed before this one already established, and
 * it defaults to nothing: a caller rendering one effect on its own has no
 * earlier sentence to refer back to, which is the right answer for a token's
 * one-line ability and for every caller that predates the idea.
 */
/**
 * A `CardFilter`'s exclusions as the one adjective they print as.
 *
 * Returned as a list of at most one string rather than one word per excluded
 * type, because the two joins differ and the caller applies only one of them.
 * Every other list in a card-filter noun phrase joins with "or" — `selectPrinted`
 * matches any of its values, so "an artifact or creature card" is what the
 * filter means — but exclusions are refused *together*: Duress takes a card
 * that is neither a creature nor a land, and Magic writes that conjunction with
 * a comma ("a noncreature, nonland card"). Pre-joining here keeps
 * `cardFilterPhrase` and `searchPluralPhrase` reading one list of lists with one
 * rule, instead of each carrying a special case for this field.
 *
 * The words themselves are `filterAdjectives`' words for the same field on a
 * target filter, deliberately: Bramblecrush and Duress print the same English
 * about the same `CardKind` enum, and a second spelling here would be a second
 * chance for the two to drift.
 */
function excludedCardTypeWords(filter: CardFilter): readonly string[] {
  const excluded = (filter.excludeCardTypes ?? []).map((kind) => `non${kind}`);
  return excluded.length === 0 ? [] : [excluded.join(', ')];
}

/**
 * What a `searchLibrary` filter names, as the noun a card prints: "a basic land
 * card", "a creature card", "a Zombie card", or "a card" when it names nothing.
 *
 * The lists concatenate in Magic's own order — supertype, color, subtype, card
 * type — because that is the order a type line reads once the color adjective
 * is put where a card prints it ("target legendary green creature card"), and
 * a search or graveyard clause quotes a type line. Within a list the words join
 * with "or" (an artifact or creature card), which is what the filter means:
 * `selectPrinted` matches *any* of a list's values, so an "and" would print a
 * promise the kernel does not keep.
 *
 * A color-only filter is the case that has no type word at all and still has to
 * read as English: Revive is "a green card", which falls out of the same
 * concatenation because `articleForWord` is asked about the finished noun
 * phrase rather than about a type.
 *
 * Exclusions sit where `filterAdjectives` puts them — after the supertype and
 * in front of the color — so the two filter renderers order their shared fields
 * the same way and "a noncreature, nonland card" comes out in printed order.
 * No card in this population states an exclusion beside a supertype or a color,
 * so that relative order is a consistency choice rather than a printed fact.
 *
 * This is `countMatchingPhrase`'s sibling and deliberately not a reuse of it.
 * That one drops the card-type word once a subtype is present, because it is
 * counting permanents on a battlefield and "the number of Zombie creatures" is
 * not how Magic says it; a search clause keeps both ("a Zombie creature card")
 * and always ends in "card", because what it is looking through is a library.
 *
 * Exported because a play surface has to print the same restriction this does
 * (`mtg-7mrf`): the lab's discard prompt told a player to choose one card and
 * never said the card had to be noncreature and nonland, so two of the four
 * revealed cards were grayed out for no stated reason. Threading this phrase is
 * the fix rather than assembling a second one there, for the reason the whole
 * file exists — a second spelling of a printed clause is a second chance for
 * the prompt and the card face to disagree.
 */
export function cardFilterPhrase(filter: CardFilter): string {
  if (filter.anyOf !== undefined) {
    return joinWithOr(filter.anyOf.map((alternative) => cardFilterPhrase(alternative)));
  }
  const lists: readonly (readonly string[])[] = [
    filter.supertypes ?? [],
    excludedCardTypeWords(filter),
    (filter.colors ?? []).map((color) => COLOR_WORDS[color]),
    filter.subtypes ?? [],
    filter.cardTypes ?? [],
  ];
  const spoken = lists.filter((list) => list.length > 0).map((list) => joinWithOr([...list]));
  // A bound is a trailing clause, never an adjective, which is why it is
  // appended to the finished noun phrase instead of joining `lists`: Magic
  // prints "a creature card with mana value 3 or less" and never "a mana value
  // 3 or less creature card". It also has to survive the no-type case —
  // "a card with mana value 2 or less" is a printed clause, and returning the
  // bare `'a card'` early would have dropped the whole restriction.
  const bound =
    filter.manaValue !== undefined
      ? ` with mana value ${filter.manaValue}`
      : filter.maxManaValue === undefined
        ? ''
        : ` with mana value ${filter.maxManaValue} or less`;
  const keywords =
    filter.keywords === undefined
      ? ''
      : ` with ${joinWithOr(filter.keywords.map((keyword) => GRANTABLE_KEYWORD_PRINT_NAMES[keyword]))}`;
  // A name is the other trailing clause, and it goes in front of the bound
  // because Magic prints the identity next to the noun it identifies: "a card
  // named Squadron Hawk", "a creature card named Ashnod's Altar with mana value
  // 3 or less". Like the bound it survives the no-type case, which is the case
  // that matters — a search by name almost never states a type as well, because
  // naming the card has already stated everything the type would.
  const named = filter.names === undefined ? '' : ` named ${joinWithOr([...filter.names])}`;
  if (spoken.length === 0) return `a card${named}${bound}${keywords}`;
  const noun = `${spoken.join(' ')} card`;
  return `${articleForWord(noun)} ${noun}${named}${bound}${keywords}`;
}

/**
 * The plural of a search's noun phrase, with the count in front of it.
 *
 * `cardFilterPhrase` is the singular and takes an article ("a basic land
 * card"); Magic's plural drops the article and takes a numeral instead ("two
 * basic land cards"), so this is a second assembly of the same lists rather
 * than a suffix on the first. Only the head word pluralizes — "basic land
 * cards", never "basics lands cards" — which is `conjunctiveCardTypeNoun`'s
 * rule at a different noun, and here the head is always `card` because a search
 * looks through a library.
 *
 * The `maxManaValue` bound stays a trailing clause for the reason
 * `cardFilterPhrase` states, and it survives the no-type case for the same
 * reason.
 */
function searchPluralPhrase(filter: CardFilter, quantity: string): string {
  const lists: readonly (readonly string[])[] = [
    filter.supertypes ?? [],
    excludedCardTypeWords(filter),
    (filter.colors ?? []).map((color) => COLOR_WORDS[color]),
    filter.subtypes ?? [],
    filter.cardTypes ?? [],
  ];
  const spoken = lists.filter((list) => list.length > 0).map((list) => joinWithOr([...list]));
  const bound =
    filter.manaValue !== undefined
      ? ` with mana value ${filter.manaValue}`
      : filter.maxManaValue === undefined
        ? ''
        : ` with mana value ${filter.maxManaValue} or less`;
  const named = filter.names === undefined ? '' : ` named ${joinWithOr([...filter.names])}`;
  const keywords =
    filter.keywords === undefined
      ? ''
      : ` with ${joinWithOr(filter.keywords.map((keyword) => GRANTABLE_KEYWORD_PRINT_NAMES[keyword]))}`;
  const noun = spoken.length === 0 ? 'cards' : `${spoken.join(' ')} cards`;
  return `${quantity} ${noun}${named}${bound}${keywords}`;
}

/** A printed-card filter phrased as the class of spells a timing rule permits. */
function spellFilterPhrase(filter: CardFilter): string {
  return searchPluralPhrase(filter, '').trimStart().replace('cards', 'spells');
}

/**
 * CR 701.19's template with its three optional clauses filled in.
 *
 * One function rather than a nested ternary in the arm, because the count is
 * not one substitution: it changes the noun phrase (singular with an article,
 * plural with a numeral), the pronoun that carries into the destination clause
 * ("put it" against "put them"), and — for a computed count — adds a
 * `where X is …` aside between the two. Magic prints all three together, and a
 * one-line arm that got two of them right was the failure worth avoiding.
 *
 * The reveal goes between the search and the move, in printed order, because
 * that is when the kernel performs it: the cards are revealed out of the
 * library and moved afterwards (`answerSearch`).
 *
 * **"Up to"**, on every count above one, and it is the honest wording rather
 * than a house style. The kernel offers the take-nothing answer at every one of
 * a multi-card search's questions, so a card printing "search your library for
 * two Forest cards" (Skyshroud Claim's template, which Magic does print) would
 * promise something the resolution does not enforce. Ranger's Path and M13's
 * mass-ramp sorcery both print "up to", and the line this renders for each is
 * their printed line word for word. The singular keeps its article: "search
 * your library for a card" is how every one-card searcher reads, and unlike a
 * search with a stated quality that unrestricted form is mandatory when the
 * library is nonempty (CR 701.19b).
 */
function renderSearch(effect: Extract<Effect, { kind: 'searchLibrary' }>): string {
  const filterQuotas = effect.filterQuotas;
  if (filterQuotas !== undefined) {
    const descendingInstantValues = filterQuotas.map((quota) =>
      quota.count === 1 &&
      quota.filter.cardTypes?.length === 1 &&
      quota.filter.cardTypes[0] === 'instant' &&
      Object.keys(quota.filter).every((field) => field === 'cardTypes' || field === 'manaValue')
        ? quota.filter.manaValue
        : undefined,
    );
    if (
      effect.destination === 'hand' &&
      effect.reveal === true &&
      descendingInstantValues.length === 3 &&
      descendingInstantValues[0] === 3 &&
      descendingInstantValues[1] === 2 &&
      descendingInstantValues[2] === 1
    ) {
      return 'Search your library for an instant card with mana value 3, reveal it, and put it into your hand. Then repeat this process for instant cards with mana values 2 and 1. Then shuffle.';
    }
    const subjects = filterQuotas.flatMap((quota) =>
      quota.count === 1
        ? [cardFilterPhrase(quota.filter)]
        : [searchPluralPhrase(quota.filter, numberWord(quota.count))],
    );
    const reveal = effect.reveal === true ? ', reveal those cards' : '';
    const destination =
      typeof effect.destination === 'string' && effect.destination === 'hand'
        ? 'put them into your hand'
        : null;
    if (destination === null) {
      throw new Error('heterogeneous search oracle text currently requires one hand destination');
    }
    return `Search your library for ${joinWithAnd(subjects)}${reveal}, ${destination}, then shuffle.`;
  }
  const filter = effect.filter;
  if (filter === undefined) throw new Error('a homogeneous search needs a card filter');
  const count = effect.count ?? 1;
  const single = isLiteralAmount(count) && count === 1;
  const subject = single
    ? cardFilterPhrase(filter)
    : searchPluralPhrase(filter, `up to ${isLiteralAmount(count) ? numberWord(count) : 'X'}`);
  const where = isLiteralAmount(count) ? '' : `, where X is ${computedPhrase(count)}`;
  const pronoun = single ? 'it' : 'them';
  const reveal =
    effect.reveal === true
      ? `, reveal ${typeof effect.destination === 'string' ? pronoun : 'those cards'}`
      : '';
  if (typeof effect.destination !== 'string' && effect.destination.kind === 'oneToHandRestToGraveyard') {
    return `Search your library for ${subject}${where} and reveal them. Put one into your hand and the other into your graveyard. Then shuffle.`;
  }
  if (effect.destination === 'libraryTop') {
    return `Search your library for ${subject}${where}${reveal}, then shuffle and put ${single ? 'that card' : 'those cards'} on top.`;
  }
  const destinationTail = (destination: SearchDestination) =>
    destination === 'hand'
      ? 'into your hand'
      : destination === 'battlefieldTapped'
        ? 'onto the battlefield tapped'
        : destination === 'battlefield'
          ? 'onto the battlefield'
          : destination === 'exile'
            ? 'into exile'
            : 'on top of your library';
  const destinationPhrase = (destination: SearchDestination, what: string) =>
    destination === 'exile' ? `exile ${what}` : `put ${what} ${destinationTail(destination)}`;
  const move =
    effect.destination === 'sourceLinkedExile'
      ? `exile ${pronoun}`
      : typeof effect.destination === 'string'
        ? destinationPhrase(effect.destination, pronoun)
        : `${destinationPhrase(effect.destination.one, 'one')} and ${
            isLiteralAmount(count) && count === 2 ? 'the other' : 'the rest'
          } ${destinationTail(effect.destination.rest)}`;
  return `Search your library for ${subject}${where}${reveal}, ${move}, then shuffle.`;
}

export function renderEffect(
  effect: Effect,
  cardName: string,
  prior: PriorMention = NOTHING_SAID,
  sourceKind?: CardKind,
): string {
  const who = (target: TargetSpec): string =>
    target.kind === 'selfPermanent' && cardName.startsWith('this ')
      ? cardName
      : target.kind === 'selfPermanent' && sourceKind === 'enchantment'
        ? 'this Aura'
        : target.kind === 'selfPermanent' && sourceKind === undefined && effect.kind === 'destroyPermanent'
          ? cardName
          : targetPhrase(target, prior.samePlayerNamed);
  switch (effect.kind) {
    // "deals 3 damage to X" and "deals damage to X equal to N" are two
    // sentences, not one with a hole: the numeral's slot disappears when the
    // quantity is computed. Every amount-bearing arm below is written twice for
    // that reason, and the second wording is Magic's.
    // `scope` changes only the noun phrase after "to", and it takes the
    // distributive singular: damage is dealt to each member (CR 120.3), so
    // Magic prints "deals 3 damage to each creature target opponent controls"
    // and never "to all creatures".
    case 'dealDamage': {
      if (effect.eachScopedPermanentDealsToItsController === true) {
        const subject =
          effect.scope === undefined
            ? 'Each permanent'
            : capitalize(EFFECT_SCOPE_EACH_PHRASES[effect.scope](who(effect.target), effect.scopeFilter));
        return isLiteralAmount(effect.amount)
          ? `${subject} deals ${String(effect.amount)} damage to its controller.`
          : `${subject} deals damage to its controller ${amountEqualTo(effect.amount)}.`;
      }
      const damageSource = damageSourcePhrase(effect, cardName, sourceKind);
      const withLinkedDeathReplacement = (text: string): string =>
        effect.exileDamagedCreatureIfItWouldDieThisTurn === true
          ? `${text} If a creature dealt damage this way would die this turn, exile it instead.`
          : text;
      if (effect.division !== undefined) {
        const recipients =
          effect.division.kind === 'each'
            ? `to each of ${who(effect.target)}`
            : effect.division.kind === 'evenlyRoundedDown'
              ? 'divided evenly, rounded down, among any number of targets'
              : `divided as you choose among ${who(effect.target)}`;
        const amount = isLiteralAmount(effect.amount) ? String(effect.amount) : 'X';
        return withLinkedDeathReplacement(`${damageSource} deals ${amount} damage ${recipients}.`);
      }
      const primaryPermanentRecipient =
        effect.scope === undefined
          ? undefined
          : EFFECT_SCOPE_EACH_PHRASES[effect.scope](who(effect.target), effect.scopeFilter);
      const additionalPermanentRecipient =
        effect.scope === undefined || effect.additionalScopeFilter === undefined
          ? undefined
          : EFFECT_SCOPE_EACH_PHRASES[effect.scope](who(effect.target), effect.additionalScopeFilter);
      const permanentRecipient =
        primaryPermanentRecipient === undefined
          ? undefined
          : additionalPermanentRecipient === undefined
            ? primaryPermanentRecipient
            : `${primaryPermanentRecipient} and ${additionalPermanentRecipient}`;
      const playerRecipient =
        effect.players === undefined ? undefined : PLAYER_SCOPE_PHRASES[effect.players].toLowerCase();
      const recipient =
        permanentRecipient === undefined
          ? (playerRecipient ??
            (effect.opponentPlayerOrPlaneswalkerOnly === true
              ? 'target opponent or planeswalker'
              : who(effect.target)))
          : playerRecipient === undefined
            ? permanentRecipient
            : `${permanentRecipient} and ${playerRecipient}`;
      if (!isLiteralAmount(effect.amount) && effect.amount.kind === 'chosenX') {
        const damage = `${damageSource} deals X damage to ${recipient}.`;
        return withLinkedDeathReplacement(
          effect.preventable === false ? `${damage} The damage can't be prevented.` : damage,
        );
      }
      if (effect.scopeAmount !== undefined && primaryPermanentRecipient !== undefined) {
        const group = `each ${scopeNoun(effect.scopeFilter, false)} that player or that planeswalker's controller controls`;
        const first = isLiteralAmount(effect.amount) ? String(effect.amount) : 'X';
        const second = isLiteralAmount(effect.scopeAmount) ? String(effect.scopeAmount) : 'X';
        const damage = `${damageSource} deals ${first} damage to ${who(effect.target)} and ${second} damage to ${group}.`;
        return withLinkedDeathReplacement(
          effect.tapScopeGroup === true ? `${damage} Tap those creatures.` : damage,
        );
      }
      const damage = isLiteralAmount(effect.amount)
        ? `${damageSource} deals ${effect.amount} damage to ${recipient}.`
        : effect.amount.kind === 'paidSacrificePower'
          ? `${damageSource} deals damage ${amountEqualTo(effect.amount)} to ${recipient}.`
          : `${damageSource} deals damage to ${recipient} ${amountEqualTo(effect.amount)}.`;
      const withPrevention =
        effect.preventable === false ? `${damage} The damage can't be prevented.` : damage;
      return withLinkedDeathReplacement(
        effect.tapScopeGroup === true ? `${withPrevention} Tap those creatures.` : withPrevention,
      );
    }
    // The plural group phrase, not the distributive one: destruction is a
    // single action taken on a set (CR 701.7b destroys them simultaneously),
    // and Magic's wording follows — "Destroy all creatures target player
    // controls", never "each creature".
    case 'destroyPermanent':
      if (effect.controllerLibraryFollowup === 'revealUntilLandToGraveyard') {
        return `Destroy ${who(effect.target)}. Its controller reveals cards from the top of their library until they reveal a land card, then puts those cards into their graveyard.`;
      }
      return effect.scope === undefined
        ? `Destroy ${who(effect.target)}.`
        : `Destroy ${EFFECT_SCOPE_PHRASES[effect.scope](who(effect.target), prior, effect.scopeFilter)}.`;
    case 'destroyAttachedPermanents':
      return `Destroy all ${permanentChoiceNoun(effect.filter, true)} attached to ${who(effect.target)}.`;
    // Two sentences from one primitive, and Magic prints them differently
    // enough that a shared template would be wrong: the scoped form has no
    // "target creature" in it at all, because the creatures are not targets.
    case 'exileTarget': {
      if (effect.scope === undefined) {
        if (effect.creatureBattlefieldOrGraveyard === true) {
          return 'Exile up to three other target creatures from the battlefield and/or creature cards from graveyards.';
        }
        if (effect.sameNameCohort !== undefined) {
          return `Exile ${who(effect.target)} not named ${effect.sameNameCohort.excludedName} and all other permanents with the same name as that permanent.`;
        }
        const exile = `Exile ${who(effect.target)}.`;
        return effect.returnAtNextEndStep === undefined
          ? exile
          : `${exile} At the beginning of the next end step, return it to the battlefield tapped under its owner's control.`;
      }
      const group = EFFECT_SCOPE_PHRASES[effect.scope](who(effect.target), prior, effect.scopeFilter);
      return `Exile ${isSpaceScope(effect.scope) && effect.scope !== 'allPermanents' ? `all ${group}` : group}.`;
    }
    // Plural again, and for the reason destroy is: one continuous effect over a
    // group, so the subject of "get" is the group. "All creatures target player
    // controls get +3/+3 until end of turn" is the sentence, and `renderPump`
    // needs no arm of its own to print it — only a different subject.
    case 'pumpUntilEndOfTurn':
      return renderPump(
        capitalize(
          effect.scope === undefined
            ? who(effect.target)
            : EFFECT_SCOPE_PHRASES[effect.scope](who(effect.target), prior, effect.scopeFilter),
        ),
        effect.power,
        effect.toughness,
        effect.scope === undefined,
        effect.keyword,
        effect.printedDurationFirst === true,
      );
    case 'drawCards': {
      const cards = isLiteralAmount(effect.count)
        ? effect.count === 1
          ? 'a card'
          : `${numberWord(effect.count)} cards`
        : `a number of cards ${amountEqualTo(effect.count)}`;
      // `players` replaces the subject outright rather than qualifying it: the
      // draw is no longer aimed at anybody, so the `target` the schema still
      // carries prints nothing. `checkPlayerSweep` is what keeps that from
      // being a silent drop — a sweep alongside a real target is refused before
      // it reaches here, so the only target this arm ever discards is
      // `noTarget`.
      if (effect.players !== undefined) return `${PLAYER_SCOPE_PHRASES[effect.players]} draws ${cards}.`;
      if (targetsAnyNumber(effect.target)) {
        return `Any number of target players each draw ${cards}.`;
      }
      return effect.target.kind === 'noTarget'
        ? `Draw ${cards}.`
        : `${capitalize(who(effect.target))} draws ${cards}.`;
    }
    case 'gainLife': {
      const life =
        effect.amountFrom === 'thatPlayersHandSize'
          ? "life equal to the number of cards in that player's hand"
          : isLiteralAmount(effect.amount)
            ? `${effect.amount} life`
            : `life ${amountEqualTo(effect.amount)}`;
      if (targetsAnyNumber(effect.target)) {
        return `Any number of target players each gain ${life}.`;
      }
      return effect.target.kind === 'noTarget'
        ? `You gain ${life}.`
        : `${capitalize(who(effect.target))} gains ${life}.`;
    }
    // The filter is an adjective in front of "spell" rather than a replacement
    // for it, which is the one place a `TargetFilter` prints differently from
    // the battlefield side: "counter target creature spell" keeps the noun
    // because the object is a spell that happens to be a creature spell, while
    // "destroy target artifact" drops it because the object is the artifact.
    case 'counterSpell': {
      const sentence = `Counter target ${spellFilterWords(effect.spellFilter ?? null)}spell${
        'spellSelection' in effect && effect.spellSelection === 'targetSpellYouDontControl'
          ? " you don't control"
          : ''
      }.`;
      const counter =
        effect.unlessCost === undefined
          ? sentence
          : 'kind' in effect.unlessCost
            ? `${sentence.slice(0, -1)} unless its controller pays {X}.`
            : withUnlessClause(sentence, { payer: 'targetController', cost: effect.unlessCost });
      const withDestination =
        effect.destination === 'exile'
          ? `${counter} If that spell is countered this way, exile it instead of putting it into its owner's graveyard.`
          : counter;
      return effect.dealDamageToControllerEqualToSpellPower === true
        ? `${withDestination} ${cardName} deals damage equal to that spell's power to its controller.`
        : withDestination;
    }
    case 'changeSpellTargets':
      return `You may choose new targets for target ${spellFilterWords(effect.spellFilter ?? null)}spell.`;
    case 'copySpell':
      return `Copy target ${spellFilterWords(effect.spellFilter ?? null)}spell${effect.spellSelection === 'targetSpellYouControl' ? ' you control' : ''}. You may choose new targets for the copy.`;
    case 'copyNextInstantOrSorceryThisTurn':
      return 'When you next cast an instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy.';
    // CR 701.16a's action, in Magic's own words. "Their" rather than "his or
    // her": the current templating, and the only pronoun that works when the
    // subject is "target opponent".
    case 'revealHand':
      return `${capitalize(who(effect.target))} reveals their hand.`;
    case 'revealRandomCardFromHand':
      return `${capitalize(who(effect.target))} reveals a card at random from their hand.`;
    case 'playRandomHandCardWithoutPayingManaCost':
      return `${capitalize(who(effect.target))} reveals a card at random from their hand. If it's a land card, the player puts it onto the battlefield. Otherwise, the player casts it without paying its mana cost if able.`;
    case 'scry':
      return `Scry ${String(effect.count)}.`;
    case 'populate':
      return 'Populate.';
    case 'createTokenCopyOfSelf':
      return "Create a token that's a copy of this creature.";
    case 'reorderTopLibrary':
      return 'Look at the top five cards of your library, then put them back in any order.';
    case 'selectFromTopLibrary':
      return effect.grislySalvageProfile === true
        ? 'Reveal the top five cards of your library. You may put a creature or land card from among them into your hand. Put the rest into your graveyard.'
        : 'Look at the top three cards of your library. You may reveal an instant or sorcery card from among them and put it into your hand. Put the rest on the bottom of your library in any order.';
    case 'separateTopLibraryIntoPiles':
      return 'Reveal the top five cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard.';
    case 'createToken':
      return renderTokenClause(effect.count, effect.token);
    // Two sentences when the rider is on, and the second one is the whole
    // reason the rider exists: a tap that lasts until the next untap step buys
    // one attack, and the sentence that says it does not untap is what every
    // playable tapper Magic prints says out loud. Magic's own wording, and it
    // changes grammatical number with the scope, so it is two templates rather
    // than one with a plural suffix -- Frost Breath says "Those creatures don't
    // untap during their controller's next untap step", Dungeon Geists says
    // "That creature doesn't untap ... during its controller's".
    //
    // The unscoped hand-authored arm may name a permanent (Frost Titan), in
    // which case Magic refers back with "It" rather than narrowing the object
    // to a creature in the second sentence. Scoped taps still name creatures.
    case 'tapPermanent': {
      const tap =
        effect.scope === undefined
          ? `Tap ${who(effect.target)}.`
          : `Tap ${EFFECT_SCOPE_PHRASES[effect.scope](who(effect.target), prior, effect.scopeFilter)}.`;
      if (effect.doesNotUntap !== true) return tap;
      // A counted slot ("up to two target creatures") is unscoped by
      // construction — `checkTargetCardinality` refuses `count` on anything but a
      // plain `targetCreature` slot, and a scope replaces the slot with a
      // player reference — so this branch only has to beat the singular
      // "That creature" case to the return, and it reads "their" rather than
      // "their controller's" because the two chosen creatures may answer to
      // two different controllers, and this vocabulary has no printed card
      // asking the two to untap on two different steps.
      if (effect.scope === undefined && targetCountOf(effect.target) !== null) {
        return `${tap} They don't untap during their next untap step.`;
      }
      return effect.scope === undefined
        ? effect.target.kind === 'targetPermanent'
          ? `${tap} It doesn't untap during its controller's next untap step.`
          : `${tap} That creature doesn't untap during its controller's next untap step.`
        : `${tap} Those creatures don't untap during their controller's next untap step.`;
    }
    case 'returnToHand':
      return effect.target.kind === 'targetCardInYourGraveyard'
        ? `Return ${who(effect.target)} to your hand.`
        : `Return ${who(effect.target)} to its owner's hand.`;
    case 'millCards': {
      if (
        !isLiteralAmount(effect.count) &&
        effect.count.kind === 'cardsShuffledFromGraveyardThisResolution'
      ) {
        return `${capitalize(who(effect.target))} mills that many cards.`;
      }
      if (!isLiteralAmount(effect.count) && effect.count.kind === 'halfTargetLibraryRoundedDown') {
        return `${capitalize(who(effect.target))} mills half their library, rounded down.`;
      }
      const cards = isLiteralAmount(effect.count)
        ? effect.count === 1
          ? 'a card'
          : `${numberWord(effect.count)} ${pluralize('card', effect.count)}`
        : effect.printedVariable === 'X'
          ? `X cards, where X is ${computedPhrase(effect.count)}`
          : `a number of cards ${amountEqualTo(effect.count)}`;
      const sentence =
        effect.target.kind === 'noTarget'
          ? `You mill ${cards}.`
          : `${capitalize(who(effect.target))} mills ${cards}.`;
      return effect.printedOneCardReminder === true
        ? `${sentence} (They put the top card of their library into their graveyard.)`
        : sentence;
    }
    case 'putCounters': {
      // The reminder is generated from the counter's declaration rather than
      // written per kind, so a part added to `counters.ts` tomorrow prints what
      // it does without touching this switch.
      //
      // `scope` changes only the noun phrase after "on": scoped, the counters
      // go on each member of a group and the group is read off the player this
      // effect targets or off a region of the board, so the distributive
      // singular is what the clause needs. Magic prints "on each artifact
      // creature you control" (Steel Overseer, M11 214), never "on all".
      const recipient =
        effect.scope === undefined
          ? effect.timing === 'nextEndStep' && effect.target.kind === 'selfPermanent'
            ? 'it'
            : who(effect.target)
          : EFFECT_SCOPE_EACH_PHRASES[effect.scope](who(effect.target), effect.scopeFilter);
      const timing = effect.timing === 'nextEndStep' ? ' at the beginning of the next end step' : '';
      const sentence =
        !isLiteralAmount(effect.count) && effect.count.kind === 'triggeringCreaturePower'
          ? `Put X ${counterName(effect.counter)} counters on ${recipient}, where X is that creature's power${timing}.`
          : isLiteralAmount(effect.count)
            ? `Put ${counterPhrase(effect.counter, effect.count)} on ${recipient}${timing}.`
            : `Put a number of ${counterName(effect.counter)} counters on ${recipient} ${amountEqualTo(effect.count)}${timing}.`;
      const condition =
        effect.recipientCondition === undefined
          ? ''
          : ` if it's ${COLOR_WORDS[effect.recipientCondition.color]}`;
      const conditioned = `${sentence.slice(0, -1)}${condition}.`;
      const withKeyword =
        effect.keyword === undefined
          ? conditioned
          : `${conditioned} Those creatures gain ${KEYWORD_PRINT_NAMES[effect.keyword]} until end of turn.`;
      const reminder = counterReminderText(effect.counter);
      return reminder === null ? withKeyword : `${withKeyword} ${reminder}`;
    }
    case 'doubleSourceCounters':
      return `Double the number of ${counterName(effect.counter)} counters on ${cardName}.`;
    // "under their owner's control" is printed rather than left to the default,
    // and the default is why: an effect that puts a card onto the battlefield
    // gives it to the spell's controller unless the card says otherwise (Rise
    // from the Grave), and this one gives each card back to whoever owned it.
    // A card that behaved one way and printed the other is the failure this
    // whole vocabulary exists to prevent.
    //
    // The hand arm keeps "their owner's" and drops "under ... control", because
    // a hand has no controller to name — the possessive is the whole of where
    // the card goes.
    case 'returnFromGraveyard': {
      if (effect.fromBattlefieldThisTurn === true) {
        return 'Return to the battlefield all permanent cards in your graveyard that were put there from the battlefield this turn.';
      }
      if (effect.scope === undefined) {
        const card = who(effect.target);
        if (effect.destination === 'hand') {
          return effect.target.kind === 'targetCardInYourGraveyard'
            ? `Return ${card} to your hand.`
            : `Return ${card} to its owner's hand.`;
        }
        if (effect.control === 'you') {
          return `Put ${card} onto the battlefield under your control.${grantSentence(effect.alsoBecomes)}`;
        }
        if (effect.target.kind === 'targetCardInYourGraveyard') {
          return `Return ${card} to the battlefield.${grantSentence(effect.alsoBecomes)}`;
        }
        return `Return ${card} to the battlefield under its owner's control.${grantSentence(effect.alsoBecomes)}`;
      }
      const cards = EFFECT_SCOPE_PHRASES[effect.scope](who(effect.target), prior, undefined);
      return effect.destination === 'hand'
        ? `Return ${cards} to their owner's hand.`
        : effect.control === 'you'
          ? `Put ${cards} onto the battlefield under your control.`
          : `Return ${cards} to the battlefield under their owner's control.`;
    }
    // "It" is a literal rather than the card's name, and that is safe only
    // because the validator refuses `fight` anywhere the pronoun would have no
    // antecedent: it is legal on a triggered ability and nowhere else, and
    // `renderTriggeredAbility` has just printed "When Foe-Razer Regent enters
    // the battlefield," in front of it. `mayClause` carries the matching arm,
    // because "you may it fights" is the sentence this reads as otherwise.
    case 'fight':
      return effect.fighter === undefined
        ? `It fights ${who(effect.target)}.`
        : `${capitalize(who(effect.fighter))} fights ${who(effect.target)}. (Each deals damage equal to its power to the other.)`;
    case 'petrifyCreature':
      return `Put a petrification counter on ${who(effect.target)}. It gains defender and becomes a colorless artifact in addition to its other types. Its activated abilities can't be activated. (A creature with defender can't attack.)`;
    // Magic's three "Add" lines, and the card's own shape picks which one.
    //
    // A choice of colors prints as a choice — "Add {W} or {U}", which is what
    // every dual land and every Birds of Paradise has printed — and the
    // validator has already pinned that shape to one mana, so the quantity
    // never has to fight the conjunction for the same slot. A quantity of one
    // color prints as repeated symbols, because "Add {C}{C}" is how Sol Ring
    // says two and "Add 2 colorless mana" is not a line Magic prints. A
    // counted amount takes the "Add an amount of {B} equal to …" frame, which
    // is Nykthos's own templating and the only one Magic offers for a
    // production quantity read off the board.
    case 'addMana': {
      if (effect.distribution === 'anyCombinationOfColors' && !isLiteralAmount(effect.amount)) {
        return `Add X mana in any combination of colors, where X is ${computedPhrase(effect.amount)}.`;
      }
      const symbols = effect.produces.map((color) => `{${color}}`);
      if (!isLiteralAmount(effect.amount)) {
        return `Add an amount of ${symbols.join(' or ')} ${amountEqualTo(effect.amount)}.`;
      }
      // "Any color" is the five colors offered at once, and Magic prints that
      // choice as a sentence rather than a disjunction of pips — including the
      // one shape that carries a quantity, "Add three mana of any one color".
      if (isAnyColor(effect.produces)) {
        return effect.amount === 1
          ? 'Add one mana of any color.'
          : `Add ${numberWord(effect.amount)} mana of any one color.`;
      }
      if (symbols.length > 1) return `Add ${symbols.join(' or ')}.`;
      return `Add ${symbols.join('').repeat(effect.amount)}.`;
    }
    case 'createEmblem': {
      const grant = effect.emblem.grantsManaAbility;
      const subtype = grant.filter.subtypes[0];
      const color = grant.produces[0];
      return `You get an emblem with "${englishPlural(subtype)} you control have '{T}: Add ${`{${color}}`.repeat(grant.amount)}.'"`;
    }
    case 'shuffleLibrary':
      return 'Shuffle your library.';
    // "Reveal", not "look at": the difference is who sees, and this primitive
    // shows both seats (`kernel/src/visibility.ts` passes the event through
    // unredacted). A card that only its controller may see is a different
    // effect and would print "Look at".
    case 'revealTopCards':
      return `Reveal the top ${numberWord(effect.count)} ${pluralize('card', effect.count)} of your library.`;
    case 'revealTopCardToHand':
      return 'Reveal the top card of your library and put that card into your hand.';
    case 'revealUntilCreatureCards':
      return `${
        !isLiteralAmount(effect.count) && effect.count.kind === 'permanentsExiledThisResolution'
          ? 'Then reveal cards from the top of your library until you reveal that many creature cards.'
          : isLiteralAmount(effect.count)
            ? `Reveal cards from the top of your library until you reveal ${numberWord(effect.count)} creature ${pluralize('card', effect.count)}.`
            : `Reveal cards from the top of your library until you reveal a number of creature cards ${amountEqualTo(effect.count)}.`
      } Put all creature cards revealed this way onto the battlefield, then shuffle the rest of the revealed cards into your library.`;
    // "Its owner's library", for `returnToHand`'s reason one arm up: CR 701.19a
    // sends a card to the library it came from, not to the caster's, and a card
    // that behaved one way and printed the other is exactly what this
    // vocabulary exists to prevent.
    case 'putOnLibrary':
      return effect.position === 'top'
        ? `Put ${who(effect.target)} on top of its owner's library.`
        : `Put ${who(effect.target)} on the bottom of its owner's library.`;
    case 'putSourceAndTargetOnOwnersLibrariesThenShuffle':
      return `Put ${selfPermanentPhrase(cardName, sourceKind)} and ${who(effect.target)} on top of their owners' libraries, then those players shuffle their libraries.`;
    // Three sentences from one primitive, because Magic prints all three and
    // none is a substitution into the others: "Exile target player's graveyard"
    // has a possessive where "Exile all graveyards" has a quantifier.
    // CR 701.22's own template. The shuffle is the sentence rather than a rider
    // on it, which is why nothing here prints "then shuffle" the way
    // `renderSearch` does: the cards never sat in an ordered library to be
    // shuffled afterwards.
    case 'shuffleGraveyardIntoLibrary':
      return effect.includeSelf === true
        ? "Shuffle this permanent and your graveyard into their owner's library."
        : effect.printedAllCardsFromYourGraveyard === true
          ? 'Shuffle all cards from your graveyard into your library.'
          : "Shuffle your graveyard into its owner's library.";
    case 'exileGraveyard':
      return hasTarget(effect)
        ? "Exile target player's graveyard."
        : effect.whose === 'you'
          ? 'Exile your graveyard.'
          : effect.whose === 'opponent'
            ? "Exile target opponent's graveyard."
            : 'Exile all graveyards.';
    // CR 701.19's own template, shuffle clause and all. The shuffle is printed
    // rather than left implicit because the kernel performs it whether or not
    // the search found anything (CR 701.19c), and an unprinted shuffle is a
    // library reordering the player was never told about.
    case 'searchLibrary':
      return renderSearch(effect);
    case 'moveSourceLinkedExile':
      return effect.destination === 'hand'
        ? effect.plural === true
          ? "Return the exiled cards to their owners' hands."
          : "Put the exiled card into its owner's hand."
        : effect.plural === true
          ? "Return the exiled cards to the battlefield under their owner's control."
          : "Return the exiled card to the battlefield under its owner's control.";
    case 'exileNonbasicGraveyardAndMatchingLibrary':
      return "Exile all cards from target player's graveyard other than basic land cards. For each card exiled this way, search that player's library for all cards with the same name as that card and exile them. Then that player shuffles.";
    case 'eachPlayerNamesCardThenRevealsTop':
      return "Each player chooses a card name. Then each player reveals the top card of their library. If the card a player revealed has the name they chose, that player puts it into their hand. If it doesn't, that player puts it on the bottom of their library.";
    case 'nameNonlandCardAndExileMatchingOpponentZones':
      return "Choose a nonland card name. Search target opponent's graveyard, hand, and library for any number of cards with that name and exile them. Then that player shuffles.";
    // "A creature card" and not "target creature card", which is the one place
    // this vocabulary's wording departs from the printed cards it was built for.
    // The kernel asks a mid-resolution question here rather than choosing a
    // target (`vocabulary.ts` argues why at the kind), so "target" would print
    // an interaction — making the choice illegal in response — that the effect
    // does not offer. `putOnLibrary`'s rule two arms up is the same rule: a card
    // that behaved one way and printed the other is what this file exists to
    // prevent.
    //
    // "Your hand" and "your control" for `whose: 'you'`, "its owner's" for the
    // other two. That is not a stylistic split: a card in a graveyard is always
    // in its owner's graveyard, so `'you'` makes the owner and the controller
    // the same seat and the shorter wording is exact. Reaching another
    // graveyard, the card goes back to *its* owner, because `moveObject`
    // carries a card's owner onto the battlefield with it and the DSL has no
    // word for a control change — the same sentence `returnFromGraveyard` in
    // `kernel/src/effects.ts` prints and the reason Rise from the Grave is not
    // this effect.
    case 'chooseFromGraveyard': {
      const cards = cardFilterPhrase(effect.filter);
      const zone =
        effect.whose === 'you'
          ? 'your graveyard'
          : effect.whose === 'opponent'
            ? "an opponent's graveyard"
            : 'a graveyard';
      if (effect.destination === 'exile') return `Exile ${cards} from ${zone}.`;
      if (effect.destination === 'hand') {
        return effect.whose === 'you'
          ? `Return ${cards} from ${zone} to your hand.`
          : `Return ${cards} from ${zone} to its owner's hand.`;
      }
      // `control` decides the second half of this sentence and `whose` decides
      // it only when `control` is absent, which is the ordering CR 110.2 asks
      // for: the effect says who controls the permanent, and the graveyard it
      // came out of says so only by default. An explicit `'owner'` prints the
      // owner's clause even out of your own graveyard, where the two seats
      // happen to coincide, because a face that read the seat off the board
      // would say something different on a board where they do not.
      const control = effect.control ?? (effect.whose === 'you' ? 'you' : 'owner');
      const under = control === 'you' ? 'under your control' : "under its owner's control";
      return `Return ${cards} from ${zone} to the battlefield ${under}.${grantSentence(effect.alsoBecomes)}`;
    }
    case 'chooseFromBattlefield':
      return `Return a ${permanentChoiceNoun(effect.filter, false)} you control to its owner's hand.`;
    case 'returnSourceFromGraveyard':
      return effect.destination === 'hand'
        ? `Return ${cardName} from your graveyard to your hand.`
        : `Return ${cardName} from your graveyard to the battlefield tapped.`;
    case 'returnDepartedSourceToOwnerHand':
      return `Return ${cardName} to its owner's hand.`;
    case 'putDepartedSourceOnTopOfOwnerLibrary':
      return "Put it on top of its owner's library.";
    case 'shuffleSourceIntoOwnerLibrary':
      return "Shuffle it into its owner's library.";
    case 'returnSourceAuraAttached':
      return `Return this card from its owner's graveyard to the battlefield attached to ${who(effect.target)}.`;
    // CR 701.8's own template. "Cards" is spelled with a number word for one
    // and a numeral for none of them, which is Magic's rule for a count inside
    // rules text, and `pluralize` is what keeps "discards a card" from printing
    // as "discards one cards".
    //
    // `players` replaces the subject outright, `drawCards`' rule at the third
    // primitive to carry the field: Liliana's Specter's "Each opponent
    // discards a card" aims at nobody, so the `noTarget` slot beside the sweep
    // prints nothing. The verb does not move — `PLAYER_SCOPE_PHRASES` is
    // singular precisely so it does not have to.
    case 'discardCards': {
      const suffix = effect.random === true ? ' at random' : '';
      const count = effect.countFrom === 'chosenX' ? 'X' : effect.count;
      if (effect.players === undefined && effect.target.kind === 'noTarget') {
        if (count === 'all') return 'You discard your hand.';
        return count === 1
          ? `You discard a card${suffix}.`
          : `You discard ${typeof count === 'number' ? numberWord(count) : count} cards${suffix}.`;
      }
      const subject =
        effect.players === undefined ? capitalize(who(effect.target)) : PLAYER_SCOPE_PHRASES[effect.players];
      if (count === 'all') return `${subject} discards their hand.`;
      return count === 1
        ? `${subject} discards a card${suffix}.`
        : `${subject} discards ${typeof count === 'number' ? numberWord(count) : count} cards${suffix}.`;
    }
    // Three sentences, and Coercion prints all three: the reveal, the choice,
    // and the discard. They are one effect and not three, because anything
    // printed between the reveal and the choice could change the hand that was
    // shown (`chooseDiscardEffect`), so the primitive that shows the cards is
    // the primitive that takes them.
    //
    // "You choose" rather than "its controller chooses": the chooser is this
    // effect's own controller, which is who "you" means in rules text on a card
    // (CR 109.5), and the alternative wording would be a lie on a card whose
    // controller is not its owner.
    //
    // The noun phrase comes from the search builders rather than from two
    // literals here, which is what lets Duress print "a noncreature, nonland
    // card from it" without this arm learning how a filter reads. An absent
    // filter is the case that had to stay byte-identical: `cardFilterPhrase({})`
    // is "a card" and `searchPluralPhrase({}, 'two')` is "two cards", which is
    // exactly what the two literals said, so Coercion's line has not moved.
    case 'chooseDiscard': {
      const noun =
        effect.count === 1
          ? cardFilterPhrase(effect.filter ?? {})
          : searchPluralPhrase(effect.filter ?? {}, numberWord(effect.count));
      const discarded = effect.count === 1 ? 'that card' : 'those cards';
      return `${capitalize(who(effect.target))} reveals their hand. You choose ${noun} from it. That player discards ${discarded}.`;
    }
    case 'chooseFromRevealedHand': {
      const subject = capitalize(who(effect.target));
      if (effect.outcome.kind === 'mayCastWithoutPayingManaCost') {
        const noun = cardFilterPhrase(effect.filter).replace(' card', ' spell');
        return `${subject} reveals their hand. You may cast ${noun} from among those cards without paying its mana cost.`;
      }
      const noun = cardFilterPhrase(effect.filter);
      return `${subject} reveals their hand. You choose ${noun} from it. Search that player's graveyard, hand, and library for all cards with the same name as that card and exile them. Then that player shuffles.`;
    }
    // `gainLife`'s sentence with the other verb, and the `noTarget` slot means
    // the same thing it means there: the controller.
    //
    // A `targetOpponent` life loss prints "Target opponent", never "Each
    // opponent". This kernel seats two players so the two phrases pick out the
    // same player, and they are still different cards: CR 115.1 makes one of
    // them choosable, so hexproof answers it and "each opponent" it does not.
    // Printing the phrase the kernel does not perform is the one failure this
    // renderer exists to prevent, and this comment used to close by saying a
    // set that wanted the untargeted line wanted a target kind that did not
    // exist yet. It got the shape wrong as well as the tense: what arrived was
    // a scope rather than a target kind, because the line chooses nobody.
    //
    // `players` is that scope, and it is read here rather than paraphrased:
    // `PLAYER_SCOPE_PHRASES` holds one whole subject per member, so a third
    // member prints its own sentence instead of inheriting this one's. It
    // replaces the subject outright for `drawCards`' reason at the same field:
    // the loss is aimed at nobody, so the `noTarget` slot beside it prints
    // nothing, and `checkPlayerSweep` is what keeps that from being a silent
    // drop.
    case 'loseLife': {
      if (effect.amountFrom === 'triggeringPlayerLifeHalfRoundedUp') {
        return `${capitalize(who(effect.target))} loses half their life, rounded up.`;
      }
      const life = isLiteralAmount(effect.amount)
        ? `${effect.amount} life`
        : `life ${amountEqualTo(effect.amount)}`;
      if (effect.players !== undefined) return `${PLAYER_SCOPE_PHRASES[effect.players]} loses ${life}.`;
      return effect.target.kind === 'noTarget'
        ? `You lose ${life}.`
        : `${capitalize(who(effect.target))} loses ${life}.`;
    }
    // CR 118.5's own line. "Becomes" rather than "is set to": the printed
    // wording on every card that does this, and the one that says the change
    // is a life gain or loss of the difference rather than an assignment —
    // which is exactly what `setLife` does in the kernel, so the sentence and
    // the behavior say the same thing.
    case 'setLife':
      return `${
        effect.players === undefined
          ? 'Your life total'
          : `${PLAYER_SCOPE_PHRASES[effect.players]}'s life total`
      } becomes ${
        isLiteralAmount(effect.amount) ? `${effect.amount}.` : `a number ${amountEqualTo(effect.amount)}.`
      }`;
    case 'loseGame':
      return `${capitalize(who(effect.target))} loses the game.`;
    case 'winGame':
      return 'You win the game.';
    // Fog's line, unchanged. No count and no recipient, because the effect has
    // neither: it prevents all of it, for everyone, for the turn.
    case 'preventCombatDamage':
      return 'Prevent all combat damage that would be dealt this turn.';
    case 'preventCombatDamageToYou':
      return 'Prevent all combat damage that would be dealt to you this turn.';
    case 'detainPermanent': {
      const plural = targetCountOf(effect.target) !== null && (effect.target.count ?? 0) > 1;
      const detained = `Detain ${who(effect.target)}.`;
      return plural
        ? `${detained} (Until your next turn, those ${effect.target.kind === 'targetCreatureOpponentControls' ? 'creatures' : 'permanents'} can't attack or block and their activated abilities can't be activated.)`
        : `${detained} (Until your next turn, that ${effect.target.kind === 'targetCreatureOpponentControls' ? 'creature' : 'permanent'} can't attack or block and its activated abilities can't be activated.)`;
    }
    case 'chooseBlockersThisCombat':
      return 'You choose which creatures block this combat and how those creatures block.';
    // Dawn Charm's first mode, aimed rather than blanket: one named creature,
    // every source of damage rather than only combat. `who` already renders
    // the hand-authored-only `targetCreature` the same way every other
    // targeted effect in this switch does.
    case 'preventAllDamageToTarget':
      return `Until end of turn, prevent all damage to ${who(effect.target)}.`;
    case 'preventAllDamageToYouAndCreaturesYouControl':
      return 'Prevent all damage that would be dealt to you and creatures you control this turn.';
    case 'preventNextDamageToYouAndRetaliate': {
      const amount =
        isLiteralAmount(effect.amount) || effect.amount.kind !== 'chosenX'
          ? isLiteralAmount(effect.amount)
            ? String(effect.amount)
            : `an amount ${amountEqualTo(effect.amount)}`
          : 'X';
      if (effect.target.kind === 'noTarget') {
        return `Prevent the next ${amount} damage that would be dealt to you this turn.`;
      }
      return `Prevent the next ${amount} damage that would be dealt to you this turn. If damage is prevented this way, ${cardName} deals that much damage to ${who(effect.target)}.`;
    }
    case 'cantCastSpellsThisTurn':
      return "Your opponents can't cast spells this turn.";
    case 'protectSpellsAndCreaturesFromSpellColorsThisTurn': {
      const colors = joinWithOr(effect.colors.map((color) => COLOR_WORDS[color]));
      return `Spells you control can't be countered by ${colors} spells this turn, and creatures you control can't be the targets of ${colors} spells this turn.`;
    }
    case 'flipCoin': {
      const branch = (effects: readonly Effect[] | undefined): string | null => {
        if (effects === undefined) return null;
        return joinWithAnd(
          renderEffectList(effects, cardName).map((sentence) => {
            const clause = asClause(sentence, cardName);
            return clause.endsWith('.') ? clause.slice(0, -1) : clause;
          }),
        );
      };
      const win = branch(effect.winEffects);
      const loss = branch(effect.loseEffects);
      return [
        'Flip a coin.',
        ...(win === null ? [] : [`If you win the flip, ${win}.`]),
        ...(loss === null ? [] : [`If you lose the flip, ${loss}.`]),
      ].join(' ');
    }
    // One verb and one target, and no rider anywhere: the hold this cannot
    // clear belongs to the untap step rather than to this sentence, so the
    // printed line says nothing about it. `who` carries the filter, which is
    // what turns the widest space into Voltaic Key's "target artifact".
    case 'untapPermanent':
      return `Untap ${who(effect.target)}.`;
    case 'untapPermanents':
      return `Untap up to ${numberWord(effect.upTo)} ${permanentChoiceNoun(effect.filter, true)}.`;
    case 'skipNextUntap':
      return `${capitalize(who(effect.target))} doesn't untap during its controller's next untap step.`;
    case 'gainControlUntilEndOfTurn':
      return `Gain control of ${who(effect.target)} until end of turn.`;
    case 'gainControl':
      return `Gain control of ${who(effect.target)}.`;
    case 'exchangeControl':
      return effect.exchangeSource === true
        ? `Exchange control of ${selfPermanentPhrase(cardName, sourceKind)} and ${who(effect.target)}.`
        : 'Exchange control of two target creatures.';
    case 'addSubtype': {
      const subtype = withArticle(effect.subtype);
      return effect.target.kind === 'thatCreature'
        ? `It becomes ${subtype} in addition to its other types.`
        : `${capitalize(who(effect.target))} becomes ${subtype} in addition to its other types.`;
    }
    case 'targetPlayerGainsControlOfSelfPermanent':
      return `${capitalize(who(effect.target))} gains control of ${selfPermanentPhrase(cardName, sourceKind)}.`;
    // The printed order is the subject's, not the verb's, which is why this is
    // the `capitalize(who(...))` form rather than the imperative one above it:
    // Magic says "Target creature gains flying until end of turn", never
    // "Grant flying to target creature". `KEYWORD_PRINT_NAMES` is what makes
    // `firstStrike` print as two words.
    //
    // Scoped, the subject is the group and the verb loses its `s`: "Creatures
    // you control gain trample until end of turn" is Overwhelming Stampede's
    // second clause word for word, and Cleaver Riot's whole line. That is the
    // only thing the two forms disagree about — the same one-word difference
    // `renderPump` takes a `singular` flag for — so this is one template with
    // two subjects rather than two templates.
    case 'grantKeywordUntilEndOfTurn': {
      const subject =
        effect.scope === undefined
          ? who(effect.target)
          : EFFECT_SCOPE_PHRASES[effect.scope](who(effect.target), prior, effect.scopeFilter);
      const gains = effect.scope === undefined ? 'gains' : 'gain';
      const keywords = [effect.keyword, ...(effect.additionalKeywords ?? [])].map(
        (keyword) => GRANTABLE_KEYWORD_PRINT_NAMES[keyword],
      );
      const granted = joinWithAnd(keywords);
      if (effect.removeKeywordAbility === 'defender') {
        return `Until end of turn, ${subject} loses defender and ${gains} ${granted}.`;
      }
      return `${capitalize(subject)} ${gains} ${granted} until end of turn.`;
    }
    case 'regeneratePermanent':
      return effect.scope === undefined
        ? `Regenerate ${who(effect.target)}.`
        : `Regenerate ${EFFECT_SCOPE_EACH_PHRASES[effect.scope](who(effect.target), effect.scopeFilter)}.`;
    // The subject's order again, and "this turn" rather than "until end of
    // turn": both phrases name the same duration and Magic picks between them
    // by what the sentence is about. A characteristic a creature *gains* is
    // held until the end of the turn; a combat rule it is *under* applies this
    // turn. Goblin Tunneler and Alluring Siren both print the second.
    case 'cantBeBlockedThisTurn':
      return `${capitalize(who(effect.target))} can't be blocked this turn.`;
    case 'cantBlockThisTurn':
      return `${capitalize(who(effect.target))} can't block this turn.`;
    case 'blocksThisTurnIfAble': {
      const subject =
        effect.scope === undefined
          ? capitalize(who(effect.target))
          : capitalize(EFFECT_SCOPE_EACH_PHRASES[effect.scope](who(effect.target), effect.scopeFilter));
      return `${subject} blocks this turn if able.`;
    }
    case 'attacksYouThisTurnIfAble':
      return `${capitalize(who(effect.target))} attacks you this turn if able.`;
    case 'setColorsUntilEndOfTurn':
      return `${capitalize(who(effect.target))} becomes ${colorPhrase(effect.colors)} until end of turn.`;
    case 'attacksThisTurnIfAble':
      return `${capitalize(who(effect.target))} attacks this turn if able.`;
    case 'shuffleHandsAndGraveyardsIntoLibraries':
      return 'Each player shuffles their hand and graveyard into their library.';
    case 'exileHandsAndGraveyards':
      return 'Exile all cards from all hands and graveyards.';
    case 'exileThisSpell':
      return `Exile ${cardName}.`;
    case 'castCopiesOfCardsExiledThisResolutionWithoutPayingManaCosts':
      return effect.topXOriginalsProfile === true
        ? "Exile the top X cards of your library. You may cast instant and sorcery spells with mana value X or less from among them without paying their mana costs. Then put all cards exiled this way that weren't cast into your graveyard."
        : 'Copy those cards. Cast the copies if able without paying their mana costs.';
    // The imperative form, `untapPermanent`'s shape rather than the subject-
    // first one above it: Magic prints "Sacrifice this creature", never "This
    // creature is sacrificed". `who` renders the noun off the target kind, so
    // the same arm prints Arc Runner's line and an artifact's.
    //
    // Sacrifice, not destroy: the verb is the whole reason this effect kind
    // exists rather than reusing `destroyPermanent` aimed at the source. CR
    // 701.17 is a different action from CR 701.7, and `@mtg/kernel`'s
    // `sacrificePermanent` is the sibling of `destroyPermanent` that says so.
    case 'sacrificeSelf':
      return `Sacrifice ${effect.target.kind === 'selfPermanent' ? cardName : who(effect.target)}.`;
    // The subject-first form `drawCards` uses, not the imperative form the arm
    // above it does. The omitted fields retain the original edict's canonical
    // "a creature"; Destructive Force states all three widenings and prints
    // "Each player sacrifices five lands" from the same shape.
    case 'sacrificePermanent': {
      const count = effect.count ?? 1;
      const filter = effect.filter ?? { cardTypes: ['creature'] as const };
      const baseNoun = permanentChoiceNoun(filter, count !== 1);
      const object =
        count === 1
          ? effect.excludeSource === true
            ? `another ${baseNoun}`
            : `${articleForWord(baseNoun)} ${baseNoun}`
          : `${numberWord(count)} ${effect.excludeSource === true ? 'other ' : ''}${baseNoun}`;
      if (effect.target.kind === 'noTarget' && effect.players === undefined) {
        return `Sacrifice ${object}.`;
      }
      const subject =
        effect.players === undefined ? capitalize(who(effect.target)) : PLAYER_SCOPE_PHRASES[effect.players];
      const choice =
        effect.players !== undefined || effect.target.kind === 'thatPlayerOrPlaneswalkerController'
          ? ' of their choice'
          : '';
      return `${subject} sacrifices ${object}${choice}.`;
    }
    // Diminish, word for word, and the wording is load-bearing: "has base power
    // and toughness 1/1" is how Magic prints a layer-7b set, and "gets -4/-4"
    // is how it prints the 7c delta that produces the same board on an empty
    // one. A reader who cannot tell the two apart from the card face cannot
    // tell them apart on the stack either, so the arm prints the first and
    // never the second.
    //
    // The subject-first form, `cantBeBlockedThisTurn`'s rather than
    // `untapPermanent`'s, for the reason the keyword grant states: this is a
    // fact about the creature, not an instruction to a player.
    case 'setBasePtUntilEndOfTurn':
      return `${capitalize(who(effect.target))} has base power and toughness ${effect.power}/${effect.toughness} until end of turn.`;
    case 'animateLandWhileSourceOnBattlefield': {
      const body = [colorPhrase(effect.colors), ...effect.subtypes, 'creature'].join(' ');
      return `${capitalize(who(effect.target))} becomes a ${effect.power}/${effect.toughness} ${body} for as long as ${cardName} remains on the battlefield. It's still a land.`;
    }
    case 'animateSourceUntilEndOfTurn': {
      const body = [colorPhrase(effect.colors), ...effect.subtypes, 'artifact creature'].join(' ');
      const keywords = effect.keywords.length === 0 ? '' : ` with ${keywordPhrase(effect.keywords)}`;
      const subject = effect.printedDurationFirst === true ? cardName : capitalize(cardName);
      const change = `${subject} becomes a ${effect.power}/${effect.toughness} ${body}${keywords}`;
      return effect.printedDurationFirst === true
        ? `Until end of turn, ${change}.`
        : `${change} until end of turn.`;
    }
    default:
      return assertNever(effect, 'renderEffect');
  }
}

/** The source-reference noun used when a permanent ability names its source. */
function selfPermanentPhrase(cardName: string, sourceKind: CardKind | undefined): string {
  if (sourceKind === undefined || sourceKind === 'instant' || sourceKind === 'sorcery') return cardName;
  return `this ${sourceKind}`;
}

/** The subject of a damage instruction, shared with triggered-ability pronoun folding. */
function damageSourcePhrase(
  effect: Extract<Effect, { readonly kind: 'dealDamage' }>,
  cardName: string,
  sourceKind: CardKind | undefined,
): string {
  if (
    effect.target.kind === 'noTarget' &&
    effect.scope === undefined &&
    effect.players === undefined &&
    sourceKind !== undefined
  ) {
    return selfPermanentPhrase(cardName, sourceKind);
  }
  return sourceKind === 'planeswalker' && cardName.includes(',')
    ? (cardName.split(',')[0] ?? cardName)
    : cardName;
}

/**
 * Who a static ability is about, and whether that subject takes a singular
 * verb. Magic prints "Other Merfolk creatures you control get +1/+1" and
 * "Skywatch Sentinel gets +1/+1", so the number is part of the subject rather
 * than of the modification.
 */
interface StaticSubject {
  readonly phrase: string;
  readonly singular: boolean;
}

function staticSubject(ability: StaticAbility, cardName: string): StaticSubject {
  const colorQualifier = filterAdjectives(ability.filter ?? null);
  const tappedQualifier = ability.filter?.tapped === true ? 'tapped ' : '';
  const subtypeQualifier = ability.subtype === null ? '' : `${ability.subtype} `;
  const qualifier = `${tappedQualifier}${colorQualifier}${subtypeQualifier}`;
  const creatureNoun = ability.filter?.token === true ? 'creature tokens' : 'creatures';
  switch (ability.scope) {
    case 'self':
      return {
        phrase:
          ability.printedSubjectReference === 'thisCreature'
            ? 'this creature'
            : ability.printedSubjectReference === 'cardNameBeforeComma'
              ? cardName.slice(0, Math.max(0, cardName.indexOf(','))) || cardName
              : cardName,
        singular: true,
      };
    case 'creaturesYouControl':
      return { phrase: `${qualifier}${creatureNoun} you control`, singular: false };
    case 'otherCreaturesYouControl':
      return { phrase: `other ${qualifier}${creatureNoun} you control`, singular: false };
    case 'allLands':
      return { phrase: 'all lands', singular: false };
    case 'landsYouControl':
      return { phrase: 'lands you control', singular: false };
    case 'allCreatures':
      return { phrase: 'creatures', singular: false };
    default:
      return assertNever(ability.scope, 'staticSubject');
  }
}

/**
 * One modification as its verb and optional object, with no subject and no full
 * stop: `gets +2/+0`, `has flying`, `can't be blocked`.
 *
 * P/T uses *get* and keywords use *have*, which are Magic's two verbs for a
 * modification, and the subject decides the number. Split out from the sentence
 * so a clause carrying more than one modification can say the subject once —
 * Magic prints "Equipped creature gets +99/-3 and has deathtouch", not the same
 * sentence twice.
 */
interface ModificationPhrase {
  readonly verb: string;
  readonly object?: string;
}

/**
 * `modificationPhrase`'s domain: every modification kind Magic prints as
 * "{subject} {verb} {object}" or a complete verb phrase. `definePt` (CR 613.4a) is not one of these —
 * its sentence has no verb shared between the power half and the toughness
 * half ("Tarmogoyf's power is equal to… and its toughness is equal to…"), so
 * `renderStaticAbility` prints it through `definePtSentence` instead and
 * never reaches this type. `checkEquipAbility` (`validate/abilities.ts`)
 * refuses a `definePt` in an equip clause, which is what lets
 * `renderEquipAbility` narrow to this type below rather than widen
 * `modificationPhrase` to a sentence shape it cannot print.
 */
type VerbObjectModification = Exclude<
  LayeredStaticModification,
  { kind: 'definePt' } | { kind: 'addSubtype' }
>;

/** The shared-verb members an Equip clause may print, including its combat rule. */
type EquipClauseModification =
  VerbObjectModification | Extract<AttachModification, { kind: 'cantBeBlocked' }>;
type PrintableBundleModification = EquipClauseModification | StaticBundleModification;

/**
 * `ability.attach.modifications` as `VerbObjectModification`s, for the one
 * caller (`renderEquipAbility`) that has no narrower type to read: throws
 * rather than silently dropping a modification, because reaching this with a
 * `definePt` in the list is a validation gap (`checkEquipAbility` should
 * already have refused the card), not a shape this renderer is meant to
 * absorb.
 */
function verbObjectModifications(
  modifications: readonly (AttachModification | StaticBundleModification)[],
): readonly PrintableBundleModification[] {
  return modifications.map((modification) => {
    if (modification.kind !== 'definePt') return modification;
    throw new Error(
      'a characteristic-defining P/T (CR 613.4a) reached renderEquipAbility; checkEquipAbility should have refused it first',
    );
  });
}

function modificationPhrase(
  subject: StaticSubject,
  modification: PrintableBundleModification,
): ModificationPhrase {
  switch (modification.kind) {
    case 'statBonus':
      return {
        verb: subject.singular ? 'gets' : 'get',
        object: formatPtDelta(modification.power, modification.toughness),
      };
    case 'grantKeyword':
      return {
        verb: subject.singular ? 'has' : 'have',
        // `GRANTABLE_KEYWORD_PRINT_NAMES` rather than `KEYWORD_PRINT_NAMES`,
        // because a printed static may grant a keyword *ability* as well as an
        // evergreen keyword ("Other Knight creatures you control get +1/+1 and
        // have indestructible"). The wider table is the nine plus those, and
        // both halves print in the same lowercase mid-sentence form, so the
        // clause below neither knows nor cares which half it drew from.
        object: GRANTABLE_KEYWORD_PRINT_NAMES[modification.keyword],
      };
    case 'grantKeywordAbilities': {
      const objects: string[] = [];
      for (const grant of modification.grants) {
        if (grant.kind === 'keyword') {
          objects.push(GRANTABLE_KEYWORD_PRINT_NAMES[grant.keyword]);
          continue;
        }
        if (grant.kind === 'landwalk') {
          objects.push(`${grant.landType.toLowerCase()}walk`);
          continue;
        }
        const quality = protectionQualityPhrase(grant.quality);
        const previous = objects[objects.length - 1];
        if (previous?.startsWith('protection from ')) {
          objects[objects.length - 1] = `${previous} and from ${quality}`;
        } else {
          objects.push(`protection from ${quality}`);
        }
      }
      return {
        verb: subject.singular ? 'has' : 'have',
        object: joinWithAnd(objects),
      };
    }
    case 'grantTriggeredAbility':
      return {
        verb: subject.singular ? 'has' : 'have',
        object: isExaltedAbility(modification.ability)
          ? 'exalted'
          : `"${renderAbility(modification.ability, 'this permanent')}"`,
      };
    case 'grantAnyColorManaAbility':
      return {
        verb: 'have',
        object: '"{T}: Add one mana of any color."',
      };
    case 'statBonusPer':
      // The rate, then the thing it is charged per. Magic prints the whole
      // clause in the same "gets +0/+1 …" frame `statBonus` uses above, which
      // is why this is a verb-object modification rather than a sentence of
      // its own the way `definePt` is.
      return {
        verb: subject.singular ? 'gets' : 'get',
        object: `${formatPtDelta(modification.power, modification.toughness)} for each ${
          'zone' in modification.each && modification.each.zone === 'controllerGraveyard'
            ? 'creature card in your graveyard'
            : permanentTallyPhrase(modification.each)
        }`,
      };
    case 'statBonusPerColor':
      return {
        verb: subject.singular ? 'gets' : 'get',
        object: `${formatPtDelta(modification.power, modification.toughness)} for each of ${subject.singular ? 'its' : 'their'} colors`,
      };
    case 'cantBeBlocked':
      return { verb: "can't be blocked" };
    default:
      return assertNever(modification, 'modificationPhrase');
  }
}

/**
 * The sentence one subject and its modifications print.
 *
 * Written over a subject rather than over a static ability because an equip
 * clause carries the same modifications about a different subject, and two
 * copies of this would be two chances for "gets +2/+0" and "has flying" to come
 * out differently on a weapon than on a lord.
 *
 * Adjacent modifications sharing a verb share it in print: two granted keywords
 * read "has deathtouch and trample" rather than "has deathtouch and has
 * trample", which is how Magic templates a keyword pair. A longer run uses the
 * ordinary serial-list helper, as Sword of Vengeance's four keywords do.
 * Different verbs are joined by the same "and" with the verb repeated, which
 * is how Magic templates "gets +1/+1 and has flying".
 */
function modificationClause(
  subject: StaticSubject,
  modifications: readonly PrintableBundleModification[],
): string {
  const groups: { verb: string; objects: string[] }[] = [];
  for (const modification of modifications) {
    const phrase = modificationPhrase(subject, modification);
    const open = groups[groups.length - 1];
    if (open !== undefined && open.verb === phrase.verb) {
      if (phrase.object !== undefined) open.objects.push(phrase.object);
    } else {
      groups.push({ verb: phrase.verb, objects: phrase.object === undefined ? [] : [phrase.object] });
    }
  }
  const said = groups
    .map((group) => (group.objects.length === 0 ? group.verb : `${group.verb} ${joinWithAnd(group.objects)}`))
    .join(' and ');
  return `${capitalize(subject.phrase)} ${said}.`;
}

/**
 * `offset` folded onto a printed CDA clause: zero prints nothing ("plus 0" is
 * not a line Magic prints), a positive offset reads "plus N", a negative one
 * "minus N" — the same two words `formatDelta` uses elsewhere on this page,
 * spelled out because they sit inside a sentence here rather than beside a
 * `/`.
 */
function ptCountOffsetClause(offset: number): string {
  if (offset === 0) return '';
  return offset > 0 ? ` plus ${offset}` : ` minus ${Math.abs(offset)}`;
}

/**
 * A characteristic-defining P/T's own sentence (CR 613.4a) — Tarmogoyf's
 * "Tarmogoyf's power is equal to the number of card types among cards in all
 * graveyards and its toughness is equal to that number plus 1." Two clauses,
 * one per stat, each with its own possessive subject and its own "is equal
 * to", joined by "and" — not `modificationClause`'s shared-verb template,
 * which has nowhere to put a second subject.
 *
 * Legal only on a `self`-scoped static ability (`ability-shape.ts`'s
 * `DefinePtModificationSchema` docblock), so `cardName` is always the right
 * possessive subject for the power clause; the toughness clause says "its"
 * rather than repeating the name, matching how Magic's own CDAs print the
 * second half.
 */
function definePtSentence(cardName: string, modification: StaticModificationOf<'definePt'>): string {
  const count = PT_COUNT_PRINT_TEXT[modification.countOf];
  const power = `${cardName}'s power is equal to ${count}${ptCountOffsetClause(modification.powerOffset)}`;
  const toughness = `its toughness is equal to that number${ptCountOffsetClause(modification.toughnessOffset)}`;
  return `${power} and ${toughness}.`;
}

/**
 * The `doesNotUntap` clause's whole sentence, word for word off the printed
 * cards it comes from.
 *
 * Exported for the reason the paragraph below is: `@mtg/forge-export` writes
 * this sentence into the `R:` line the clause compiles to, and it writes it
 * alone rather than writing the Aura's whole paragraph the way an `S:` line
 * does — every shipped Forge Aura that carries this replacement gives it a
 * `Description$` naming only this rule (Immobilizing Ink and Sinking Feeling
 * both put it beside an `S:` line with a paragraph of its own). One constant, so
 * the printed card and the Forge card cannot disagree about the wording.
 */
export const ENCHANTED_DOES_NOT_UNTAP =
  "Enchanted creature doesn't untap during its controller's untap step.";

/** The untap sentence for the host noun selected by an Aura's enchant clause. */
type AuraHostNoun = 'creature' | 'permanent' | 'land' | 'nonland permanent';

function enchantedDoesNotUntap(host: AuraHostNoun): string {
  return `Enchanted ${host} doesn't untap during its controller's untap step.`;
}

function auraHostNoun(enchant: Aura['enchant']): AuraHostNoun {
  switch (enchant) {
    case 'creature':
      return 'creature';
    case 'artifactOrCreature':
      return 'permanent';
    case 'land':
      return 'land';
    case 'nonlandPermanent':
      return 'nonland permanent';
    default:
      return assertNever(enchant, 'auraHostNoun');
  }
}

function auraHostKind(host: AuraHostNoun): CardKind | undefined {
  return host === 'permanent' || host === 'nonland permanent' ? undefined : host;
}

/**
 * The exact M11/M13 creature-Aura paragraph, in printed modification order.
 *
 * Exported because `@mtg/forge-export` writes this same sentence into every
 * `S:` line an Aura compiles to, and a second derivation of it there would be a
 * second chance for the Forge card and the printed card to disagree about what
 * the Aura does — the rule `transpileAbility` already follows for every other
 * ability's `Description$`.
 *
 * `gainControl` is the one modification that does not fit the shared-verb
 * template, and the reason is grammatical rather than special: every other
 * clause predicates something of the enchanted creature, so they all share the
 * subject the template hoists out front, and this one predicates something of
 * *you*. Magic prints it as its own sentence and prints it first — Corrupted
 * Conscience is "You control enchanted creature. Enchanted creature has
 * infect." — so that is the order here, and a control-only Aura emits the one
 * sentence rather than the template's empty "Enchanted creature ." husk.
 *
 * `doesNotUntap` is the second exception and for the same grammatical reason
 * pointed the other way: it shares the subject but not the shape, because the
 * verb carries a step clause after it and the template joins objects with "or".
 * Folding it in would print "Enchanted creature can't attack or doesn't untap
 * during its controller's untap step.", which is not a sentence Magic writes.
 * Every printing keeps it as its own line — Bitter Chill, Claustrophobia and
 * Tractor Beam all do — so it comes out as its own sentence, after the shared
 * one and before the reminders.
 */
export function renderAuraModificationClause(
  modifications: readonly AuraModification[],
  host: AuraHostNoun = 'creature',
): string {
  const subject: StaticSubject = { phrase: `enchanted ${host}`, singular: true };
  const reminders: string[] = [];
  const phrases: { readonly verb: string; readonly object: string }[] = [];
  let control = false;
  let held = false;
  let activationLocked = false;
  const granted: string[] = [];
  for (const modification of modifications) {
    if (isStaticAuraModification(modification)) {
      const phrase = modificationPhrase(subject, modification);
      if (phrase.object === undefined) {
        throw new Error(`Aura modification ${modification.kind} rendered without an object`);
      }
      phrases.push({ verb: phrase.verb, object: phrase.object });
      continue;
    }
    switch (modification.kind) {
      case 'cantAttack':
        phrases.push({ verb: "can't", object: 'attack' });
        break;
      case 'cantBlock':
        phrases.push({ verb: "can't", object: 'block' });
        break;
      case 'cantBeBlocked':
        phrases.push({ verb: "can't", object: 'be blocked' });
        break;
      case 'grantLandwalk':
        reminders.push(
          `(It can't be blocked as long as defending player controls a ${modification.landType}.)`,
        );
        phrases.push({ verb: 'has', object: `${modification.landType.toLowerCase()}walk` });
        break;
      case 'gainControl':
        control = true;
        break;
      case 'doesNotUntap':
        held = true;
        break;
      case 'cantActivateAbilities':
        activationLocked = true;
        break;
      case 'grantTriggeredAbility':
        granted.push(
          `Enchanted ${host} has "${renderAbility(modification.ability, `this ${host}`, auraHostKind(host))}"`,
        );
        break;
      case 'grantActivatedAbility':
        phrases.push({
          verb: 'has',
          object: `"${renderAbility(modification.ability, `this ${host}`, auraHostKind(host))}"`,
        });
        break;
      default:
        return assertNever(modification, 'renderAuraModificationClause');
    }
  }
  const groups: { verb: string; objects: string[] }[] = [];
  for (const phrase of phrases) {
    const open = groups[groups.length - 1];
    if (open !== undefined && open.verb === phrase.verb) open.objects.push(phrase.object);
    else groups.push({ verb: phrase.verb, objects: [phrase.object] });
  }
  const sentences: string[] = [];
  if (control) sentences.push(`You control ${subject.phrase}.`);
  if (groups.length === 0 && held && activationLocked) {
    sentences.push(
      `Enchanted ${host} doesn't untap during its controller's untap step and its activated abilities can't be activated.`,
    );
    held = false;
    activationLocked = false;
  } else if (groups.length > 0) {
    const clause = `Enchanted ${host} ${groups
      .map((group) => `${group.verb} ${group.objects.join(' or ')}`)
      .join(' and ')}${activationLocked ? ", and its activated abilities can't be activated" : ''}`;
    sentences.push(`${clause}${clause.endsWith('."') ? '' : '.'}`);
  } else if (activationLocked) {
    sentences.push(`Enchanted ${host}'s activated abilities can't be activated.`);
  }
  if (held) sentences.push(enchantedDoesNotUntap(host));
  return [...sentences, ...granted, ...reminders].join(' ');
}

/**
 * CR 611.2c's "as long as" clause, in front of the sentence it governs.
 *
 * Magic prints the condition and never leaves it implied, and the reason is
 * that the card is the only place a player can read it: a conditional static
 * whose text says "Creatures you control get +1/+1." describes a strictly
 * better card than the one the kernel runs, which is the divergence this
 * vocabulary exists to prevent, pointing the wrong way. The clause is missing
 * from nothing else — `@mtg/forge-export` writes
 * `ConditionPresent$`/`ConditionCompare$` for the same field, and
 * `conditionHolds` enforces it every layer walk.
 *
 * Real `kind` switch as of `mtg-jp23`, mirroring `conditionHolds`
 * (`packages/kernel/src/characteristics.ts`), `combatConditionHolds`
 * (`packages/kernel/src/combat.ts`), `checkStaticCondition`
 * (`packages/dsl/src/validate/abilities.ts`) and `conditionParams`
 * (`packages/forge-export/src/ability-script.ts`): `condition.ts` argues why
 * every call site is real `switch`/`assertNever` dispatch now that
 * `ConditionSchema` has multiple members, rather than the direct field access
 * a single-member union could not be exhaustively checked against.
 *
 * `controlsSubtype`'s floor of one prints the article Magic prints ("as long
 * as you control a Merfolk"); every higher floor prints the "or more" the field
 * means, because `atLeast` is a floor and "as long as you control three
 * Merfolk" reads as an exact count. `anyCreatureHasCounter` has no floor to
 * print — it is presence, not a threshold (`condition.ts`'s `mtg-jp23`
 * section) — so it always prints the singular counter phrase: "as long as any
 * creature has a gloom counter", never "creatures" or a count.
 */
function conditionClause(condition: Condition): string {
  switch (condition.kind) {
    case 'controlsSubtype': {
      const noun =
        condition.atLeast === 1
          ? withArticle(condition.subtype)
          : `${numberWord(condition.atLeast)} or more ${englishPlural(condition.subtype)}`;
      return `you control ${noun}`;
    }
    case 'anyCreatureHasCounter':
      return `any creature has ${counterPhrase(condition.counter, 1)}`;
    // "in their graveyard" rather than "in his or her graveyard": the singular
    // they is what current Oracle wording uses, and "an opponent" is the
    // printed subject even at two players, where it names one person.
    case 'opponentGraveyardAtLeast':
      return `an opponent has ${numberWord(condition.atLeast)} or more cards in their graveyard`;
    case 'opponentUndamagedThisTurn':
      return "an opponent hasn't been dealt damage this turn";
    case 'controllerLifeAtLeast':
      return `you have ${numberWord(condition.atLeast)} or more life`;
    case 'controllerLifeBelow':
      return `your life total is less than ${String(condition.fewerThan)}`;
    case 'controllerLibraryAtLeast':
      return `you have ${String(condition.atLeast)} or more cards in your library`;
    case 'controllerTopLibraryHasColor':
      return `the top card of your library is ${COLOR_WORDS[condition.color]}`;
    case 'battlefieldCountBelow':
      return `there are fewer than ${numberWord(condition.fewerThan)} ${countMatchingPhrase(condition.filter)} on the battlefield`;
    case 'controlsNoneOfSubtypes':
      return `you control no ${joinWithOr(condition.subtypes.map((subtype) => englishPlural(subtype)))}`;
    case 'selfCounterCountBelow':
      return `this permanent has fewer than ${numberWord(condition.fewerThan)} ${counterName(condition.counter)} counters on it`;
    case 'selfCounterCountAtLeast':
      return `this permanent has ${numberWord(condition.atLeast)} or more ${counterName(condition.counter)} counters on it`;
    default:
      return assertNever(condition, 'conditionPhrase');
  }
}

function conditionPhrase(condition: Condition): string {
  return `As long as ${conditionClause(condition)},`;
}

/**
 * A CR 614 replacement printed as a static ability, in the "If … would …, …
 * instead" template Magic reserves for one.
 *
 * Its own sentence for `definePtSentence`'s reason and one further one. The
 * grammatical reason is the same: `modificationClause` hoists one subject out
 * front and predicates a shared verb of it, and neither of these sentences has
 * a subject the static's scope supplies — the subject of Furnace of Rath's is
 * "a source", which is not the enchantment and not a permanent the scope could
 * name. The further reason is that a replacement effect names the event twice,
 * once in the condition and once in the result, and a two-slot verb/object
 * phrase has one place to put a thing.
 *
 * The wordings are the printed ones. Furnace of Rath says "to that permanent or
 * player" because the redirect half of a damage replacement can move the
 * recipient and this one does not; Rhox Faithmender says "that much life"
 * rather than "that much", because "twice that much" alone is what a damage
 * doubler says and the two lines are not interchangeable in print.
 */
function replacementSentence(modification: ReplacementStaticModification, sourceReference: string): string {
  switch (modification.kind) {
    case 'doubleDamage': {
      const filter = modification.sourceFilter;
      if (filter === undefined) {
        return 'If a source would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.';
      }
      const colors = joinWithOr(filter.colors.map((color) => COLOR_WORDS[color]));
      const cardTypes = joinWithOr([...filter.cardTypes]);
      return `If a ${colors} ${cardTypes} spell you control would deal damage, it deals double that damage instead.`;
    }
    case 'doubleLifeGain':
      return 'If you would gain life, you gain twice that much life instead.';
    case 'doublePlusOnePlusOneCountersOnCreaturesYouControl':
      return 'If one or more +1/+1 counters would be put on a creature you control, twice that many +1/+1 counters are put on it instead.';
    case 'damageCannotReduceControllerLifeBelow':
      return `As long as you have ${String(modification.minimum)} or more life, damage that would reduce your life total to less than ${String(modification.minimum)} reduces it to ${String(modification.minimum)} instead.`;
    case 'discardedByOpponentEntersBattlefield':
      return `If a spell or ability an opponent controls causes you to discard ${sourceReference}, put it onto the battlefield instead of putting it into your graveyard.`;
    case 'preventDamageToSelfAndRemoveCounters':
      return `If damage would be dealt to ${sourceReference}, prevent that damage and remove that many ${counterName(modification.counter)} counters from it.`;
    default:
      return assertNever(modification, 'replacementSentence');
  }
}

/**
 * CR 508/509's combat modifications, each its own full sentence rather
 * than through `modificationClause`'s shared-verb template.
 *
 * `cantAttack`/`cantBlock`/`cantBeBlocked`/`blockOnlyCreaturesWithKeyword`/
 * `cantBeBlockedBySubtype` read a modal verb ("can't", "can … only"), and
 * English modals do not conjugate for number, so the same wording is correct
 * whether `subject` is `self` or a whole team — unlike `modificationPhrase`'s
 * `gets`/`get` and `has`/`have`, there is no `subject.singular` branch to take
 * here.
 * `attacksEachCombatIfAble` is the one exception: "attacks" is an ordinary
 * present-tense verb, not a modal, so it does conjugate and does read
 * `subject.singular`.
 *
 * `mustBeBlockedIfAble` is not phrased as "{subject} must be blocked if
 * able" — Magic's own printed template for this restriction (Lure: "All
 * creatures able to block enchanted creature do so.") names the *blocker* as
 * its grammatical subject rather than the creature carrying the ability, so
 * `subject.phrase` appears as the object of "block" instead of out front.
 * That is also why this one modification cannot join
 * `modificationClause`'s shared-subject template even in principle: the
 * template hoists one subject and predicates a verb of it, and this
 * sentence's subject is "all creatures", not the static's own scope.
 */
function combatModificationSentence(subject: StaticSubject, modification: CombatModification): string {
  switch (modification.kind) {
    case 'cantAttack':
      return `${capitalize(subject.phrase)} can't attack.`;
    case 'cantBlock':
      return `${capitalize(subject.phrase)} can't block.`;
    case 'cantBeBlocked':
      return `${capitalize(subject.phrase)} can't be blocked.`;
    case 'attacksEachCombatIfAble':
      return `${capitalize(subject.phrase)} ${subject.singular ? 'attacks' : 'attack'} each combat if able.`;
    case 'mustBeBlockedIfAble':
      return `All creatures able to block ${subject.phrase} do so.`;
    case 'canBlockAnyNumber':
      return `${capitalize(subject.phrase)} can block any number of creatures.`;
    case 'canAttackAsThoughNoDefender':
      return `${capitalize(subject.phrase)} can attack as though it didn't have defender.`;
    case 'blockOnlyCreaturesWithKeyword':
      return `${capitalize(subject.phrase)} can block only creatures with ${
        KEYWORD_PRINT_NAMES[modification.keyword]
      }.`;
    case 'cantBeBlockedBySubtype':
      // The subtype is *pluralized*, which is Magic's own template: Juggernaut
      // prints "can't be blocked by Walls", never "by Wall" and never "by Wall
      // creatures". `englishPlural` is the function that already does this to a
      // subtype the card chose rather than one this package wrote — the same
      // table a `sacrificeOther` cost reads, so `Wall` and `Wolf` are one
      // decision rather than two. It is the whole rule: no article, no
      // "creatures", no singular branch, because the modal verb does not
      // conjugate for number any more than the four arms above it do.
      return `${capitalize(subject.phrase)} can't be blocked by ${englishPlural(modification.subtype)}.`;
    case 'cantAttackWithoutAnyOf': {
      const admissions = modification.anyOf.map((admission) => {
        switch (admission.kind) {
          case 'keyword':
            return KEYWORD_PRINT_NAMES[admission.keyword];
          case 'landwalk':
            return `${admission.landType.toLowerCase()}walk`;
          default:
            return assertNever(admission, 'combatModificationSentence admission');
        }
      });
      return `${capitalize(subject.phrase)} without ${joinWithOr(admissions)} can't attack.`;
    }
    case 'cantAttackOrBlock':
      return `${capitalize(subject.phrase)} can't attack or block.`;
    case 'cantAttackOrBlockAlone':
      return `${capitalize(subject.phrase)} can't attack or block alone.`;
    default:
      return assertNever(modification, 'combatModificationSentence');
  }
}

/** CR 615's live prevention sentence, phrased from the containing static scope. */
function damagePreventionSentence(ability: StaticAbility, subject: StaticSubject): string {
  const permanent = ability.scope === 'self' ? 'this creature' : subject.phrase;
  return `Prevent all combat damage that would be dealt to and dealt by ${permanent}.`;
}

function renderStaticAbility(ability: StaticAbility, cardName: string): string {
  const modification = ability.modification;
  const subject = staticSubject(ability, cardName);
  const sentence = isLayeredStaticModification(modification)
    ? modification.kind === 'definePt'
      ? definePtSentence(cardName, modification)
      : modification.kind === 'addSubtype'
        ? `${capitalize(staticSubject(ability, cardName).phrase)} are ${englishPlural(modification.subtype)} in addition to their other types.`
        : modification.kind === 'grantAnyColorManaAbility'
          ? 'Lands you control have "{T}: Add one mana of any color."'
          : modificationClause(subject, [modification])
    : isCombatStaticModification(modification)
      ? combatModificationSentence(
          ability.scope === 'self' &&
            (modification.kind === 'cantBlock' || modification.kind === 'mustBeBlockedIfAble')
            ? { phrase: 'this creature', singular: true }
            : subject,
          modification,
        )
      : modification.kind === 'preventCombatDamage'
        ? damagePreventionSentence(ability, subject)
        : replacementSentence(
            modification,
            ability.printedSourceReference === 'thisCard' ? 'this card' : cardName,
          );
  const landwalkReminders =
    modification.kind === 'grantKeywordAbilities'
      ? modification.grants.flatMap((grant) =>
          grant.kind === 'landwalk'
            ? [
                `(${subject.singular ? 'It' : 'They'} can't be blocked as long as defending player controls ${withArticle(grant.landType)}.)`,
              ]
            : [],
        )
      : [];
  const withLandwalkReminders = (rendered: string): string =>
    landwalkReminders.length === 0 ? rendered : `${rendered} ${landwalkReminders.join(' ')}`;
  if (ability.activeDuring === 'turnsOtherThanYours') {
    const lowered = `${sentence[0]?.toLowerCase() ?? ''}${sentence.slice(1)}`;
    return withLandwalkReminders(`During turns other than yours, ${lowered}`);
  }
  const condition = ability.enabledWhile ?? null;
  if (condition === null) return withLandwalkReminders(sentence);
  // Bloodcrazed Goblin's source-proven grammar states the permission as an
  // exception to the restriction. The data still records the condition under
  // which `cantAttack` is active; this structural pairing is only how Magic
  // prints that predicate, not a card-name exception.
  if (
    condition.kind === 'opponentUndamagedThisTurn' &&
    modification.kind === 'cantAttack' &&
    ability.scope === 'self'
  ) {
    return withLandwalkReminders(
      `${cardName} can't attack unless an opponent has been dealt damage this turn.`,
    );
  }
  if (
    condition.kind === 'battlefieldCountBelow' &&
    modification.kind === 'cantAttack' &&
    ability.scope === 'self'
  ) {
    return withLandwalkReminders(
      `${cardName} can't attack unless there are ${numberWord(condition.fewerThan)} or more ${countMatchingPhrase(condition.filter)} on the battlefield.`,
    );
  }
  if (
    condition.kind === 'controlsNoneOfSubtypes' &&
    modification.kind === 'cantAttack' &&
    ability.scope === 'self'
  ) {
    const alternatives = condition.subtypes.map((subtype) => withArticle(subtype));
    return withLandwalkReminders(`${cardName} can't attack unless you control ${joinWithOr(alternatives)}.`);
  }
  if (
    condition.kind === 'selfCounterCountBelow' &&
    modification.kind === 'cantAttackOrBlock' &&
    ability.scope === 'self'
  ) {
    return withLandwalkReminders(
      `${cardName} can't attack or block unless it has ${numberWord(condition.fewerThan)} or more ${counterName(condition.counter)} counters on it.`,
    );
  }
  if (
    condition.kind === 'selfCounterCountAtLeast' &&
    modification.kind === 'grantKeyword' &&
    ability.scope === 'self'
  ) {
    if (condition.atLeast === 1) {
      return withLandwalkReminders(
        `This creature has ${GRANTABLE_KEYWORD_PRINT_NAMES[modification.keyword]} as long as it has ${withArticle(counterName(condition.counter))} counter on it.`,
      );
    }
    return withLandwalkReminders(
      `${cardName} has ${GRANTABLE_KEYWORD_PRINT_NAMES[modification.keyword]} as long as it has ${numberWord(condition.atLeast)} or more ${counterName(condition.counter)} counters on it.`,
    );
  }
  // Self-scoped keyword conditions put their short board predicate after the
  // grant in current Oracle: Armory Guard reads "has vigilance as long as",
  // while lord-style conditions still lead with "As long as" below.
  if (
    condition.kind === 'controlsSubtype' &&
    condition.atLeast === 1 &&
    (modification.kind === 'grantKeyword' || modification.kind === 'canAttackAsThoughNoDefender') &&
    ability.scope === 'self'
  ) {
    return withLandwalkReminders(`${sentence.slice(0, -1)} as long as ${conditionClause(condition)}.`);
  }
  // A subtype is a proper noun and keeps its capital wherever the sentence sits.
  // Magic prints "As long as you control three or more Monsters, Monster
  // creatures you control get +1/+1", never "monster creatures" — the same rule
  // `asClause` already keeps for the card's own name, and for the same reason:
  // the lowercase exists to undo `capitalize`, and a word that was capitalized
  // before `capitalize` ran was never the thing being undone. `staticSubject` is
  // the one place a subtype reaches the front of the sentence, so the test is
  // whether the sentence actually opens with it: "All creatures able to block
  // Monster creatures you control do so." opens with "All" and is lowercased,
  // which is right, and so does the `otherCreaturesYouControl` scope's "Other".
  const opener =
    ability.subtype !== null && sentence.startsWith(ability.subtype) ? ability.subtype : cardName;
  return withLandwalkReminders(`${conditionPhrase(condition)} ${asClause(sentence, opener)}`);
}

/** Printed English for a live static rule whose affected subject is a player. */
function renderStaticPlayerRule(ability: StaticPlayerRuleAbility): string {
  switch (ability.rule) {
    case 'cantAttackWithCreaturesIfCastSpellThisTurn':
      return "Each opponent who cast a spell this turn can't attack with creatures.";
    case 'cantCastSpellsIfAttackedWithCreatureThisTurn':
      return "Each opponent who attacked with a creature this turn can't cast spells.";
    case 'hasHexproof':
      return "You have hexproof. (You can't be the target of spells or abilities your opponents control.)";
    case 'castSpellsAsThoughFlash':
      return `${
        ability.spellFilter === undefined
          ? 'You may cast spells as though they had flash.'
          : `You may cast ${spellFilterPhrase(ability.spellFilter)} as though they had flash.`
      }${
        ability.flashTimingReminder === true ? ' (You may cast them any time you could cast an instant.)' : ''
      }`;
    case 'castSpellsFromHandWithoutPayingManaCost':
      return 'You may cast spells from your hand without paying their mana costs.';
    case 'cardsToGraveyardAreExiled':
      return "If a card would be put into an opponent's graveyard from anywhere, exile it instead.";
    case 'cardsOrTokensToGraveyardAreExiled':
      return 'If a card or token would be put into a graveyard from anywhere, exile it instead.';
    case 'instantOrSorceryCardsToGraveyardAreExiled':
      return 'If an instant or sorcery card would be put into a graveyard from anywhere, exile it instead.';
    case 'noMaximumHandSize':
      return 'You have no maximum hand size.';
    case 'playWithTopLibraryRevealed':
      return 'Play with the top card of your library revealed.';
    case 'attackControllerOrPlaneswalkersTaxedByControlledEnchantments':
      return "Creatures can't attack you or planeswalkers you control unless their controller pays {X} for each of those creatures, where X is the number of enchantments you control.";
    default:
      return assertNever(ability.rule, 'renderStaticPlayerRule');
  }
}

/** A single printed clause whose fixed modifications resolve in separate layers. */
function renderStaticBundleAbility(ability: StaticBundleAbility): string {
  const subtype = ability.subtype === undefined ? '' : `${ability.subtype} `;
  const phrase =
    ability.includeSelf === true
      ? `this creature and other ${subtype}creatures you control`
      : `other ${subtype}creatures you control`;
  const sentence = modificationClause(
    { phrase, singular: false },
    verbObjectModifications(ability.modifications),
  );
  return `${conditionPhrase(ability.enabledWhile)} ${asClause(sentence, phrase)}`;
}

/** Printed English for a live rule over game results. */
function renderStaticGameRule(ability: StaticGameRuleAbility): string {
  switch (ability.rule) {
    case 'controllerCantLoseAndOpponentsCantWin':
      return "You can't lose the game and your opponents can't win the game.";
    case 'playersCantGainLife':
      return "Players can't gain life.";
    case 'damageCantBePrevented':
      return "Damage can't be prevented.";
    case 'cardsInGraveyardsCantBeTargets':
      return "Cards in graveyards can't be the targets of spells or abilities.";
    default:
      return assertNever(ability.rule, 'renderStaticGameRule');
  }
}

/**
 * The trigger's condition clause, then what it does, on one line.
 *
 * The effect sentences are the same ones a spell prints, which is the point of
 * building an ability over the effect union rather than beside it — but the
 * first of them follows a comma, so `asClause` lowercases it unless it opens
 * with the card's name. The hand-authored player sweep follows Magic's
 * source-pronoun construction after its trigger has named the source; ordinary
 * generated damage retains the historical card-name rendering.
 *
 * An optional trigger (CR 603.3b) puts "you may" in front of that clause and
 * prints nothing else differently — the permission is one word, not a second
 * template. It is always the *first* clause because `checkAbilities` refuses an
 * optional trigger with a second effect: the kernel asks once for the whole
 * ability, and a "may" that reached one of two printed sentences would describe
 * a card that behaves the other way.
 */
function renderTriggeredAbility(ability: TriggeredAbility, cardName: string, sourceKind?: CardKind): string {
  if (isGuildFeudAbility(ability)) {
    return 'At the beginning of your upkeep, target opponent reveals the top three cards of their library, may put a creature card from among them onto the battlefield, then puts the rest into their graveyard. You do the same with the top three cards of your library. If two creatures are put onto the battlefield this way, those creatures fight each other.';
  }
  if (isSourceLinkedTopFiveExileAbility(ability)) {
    return 'When this enchantment enters, exile the top five cards of your library.';
  }
  if (isSourceLinkedMatchingPlayCompletionAbility(ability)) {
    return "Whenever you play a card with the same name as one of the exiled cards, you may put one of those cards with that name into its owner's hand. Then if there are no cards exiled with this enchantment, sacrifice it. If you do, take an extra turn after this one.";
  }
  if (ability.putCounterThenWinAtThreshold !== undefined) {
    const { counter, atLeast } = ability.putCounterThenWinAtThreshold;
    return `At the beginning of your upkeep, put ${withArticle(counterName(counter))} counter on this creature. Then if this creature has ${numberWord(atLeast)} or more ${counterName(counter)} counters on it, you win the game.`;
  }
  if (ability.controllerDamageRemovesSourceCounter !== undefined) {
    return `Whenever a source deals damage to you, remove ${withArticle(counterName(ability.controllerDamageRemovesSourceCounter.counter))} counter from this creature.`;
  }
  if (ability.opponentCreatureDiesReturnAtNextEndStep !== undefined) {
    return "Whenever a creature you don't control dies, return it to the battlefield under your control with an additional +1/+1 counter on it at the beginning of the next end step. That creature is a black Zombie in addition to its other colors and types.";
  }
  if (isExaltedAbility(ability)) return 'Exalted';
  // The ability word, when the ability is the exact envelope that earns it.
  // `flurryRushRank` returns the printed number rather than a boolean, so the
  // line and the reminder are both derived from one recognizer and cannot
  // disagree about which rank the card has.
  const flurryRush = flurryRushRank(ability);
  if (flurryRush !== null) return `Flurry rush ${flurryRush}`;
  const gloom = gloomRank(ability);
  if (gloom !== null) return `Gloom ${gloom}`;
  if (ability.enchantedControllerDrawStepAdditionalDraw === true) {
    return "At the beginning of the draw step of enchanted creature's controller, that player draws an additional card.";
  }
  const conditionTemplate = TRIGGER_PRINT_TEMPLATES[ability.condition];
  const printedCondition = isSacrificeSelfUnlessControllerPaysAbility(ability)
    ? 'When this land enters,'
    : isReturnAnotherCreatureOrSacrificeSelfAbility(ability)
      ? 'When this creature enters,'
      : isControlledSubtypeAttacksTokenAbility(ability)
        ? `Whenever a ${ability.attackingCreatureSubtype} you control attacks,`
        : ability.enchantedControllerDrawStepAdditionalDraw === true
          ? "At the beginning of the draw step of enchanted creature's controller,"
          : ability.condition === 'beginningOfEachPlayersUpkeep' &&
              ability.sacrificeEnchantedPermanentUnlessControllerPaysManaValue === true
            ? "At the beginning of the upkeep of enchanted permanent's controller,"
            : ability.condition === 'beginningOfEachPlayersUpkeep' &&
                ability.triggeringPlayerIsEnchantedCreatureController === true
              ? "At the beginning of the upkeep of enchanted creature's controller,"
              : ability.condition === 'beginningOfEachPlayersUpkeep' &&
                  ability.triggeringPlayerIsOpponent === true
                ? "At the beginning of each opponent's upkeep,"
                : ability.condition === 'controlledLandSubtypeEnters' && ability.landSubtype !== undefined
                  ? conditionTemplate.replace('{subtype}', ability.landSubtype)
                  : ability.condition === 'youCastSpell' && ability.castFromGraveyardByAnyPlayer === true
                    ? 'Whenever a player casts a spell from a graveyard,'
                    : ability.condition === 'youCastSpell' && ability.spellSharesChosenColors === true
                      ? "Whenever you cast a spell, if it's at least one of the chosen colors,"
                      : ability.condition === 'youCastSpell' && ability.spellIsMulticolored === true
                        ? 'Whenever you cast a multicolored spell,'
                        : ability.condition === 'youCastSpell' && ability.spellColors !== undefined
                          ? `Whenever you cast a spell that's ${joinWithOr(ability.spellColors.map((color) => COLOR_WORDS[color]))},`
                          : ability.condition === 'selfDealsCombatDamageToPlayer' &&
                              ability.includesNoncombatDamage === true
                            ? 'Whenever {name} deals damage to a player,'
                            : ability.condition === 'selfEnters' &&
                                (ability.printedSourceReference === 'thisCreature' ||
                                  ability.printedSourceReference === 'thisEnchantment' ||
                                  ability.printedSourceReference === 'thisAura' ||
                                  ability.effects[0]?.kind === 'animateLandWhileSourceOnBattlefield')
                              ? 'When {name} enters,'
                              : conditionTemplate;
  const sourceReference =
    ability.printedSourceReference === 'thisCreature'
      ? 'this creature'
      : ability.printedSourceReference === 'thisArtifact'
        ? 'this artifact'
        : ability.printedSourceReference === 'thisEnchantment'
          ? 'this enchantment'
          : ability.printedSourceReference === 'thisAura'
            ? 'this Aura'
            : ability.printedSourceReference === 'cardNameBeforeComma'
              ? cardName.slice(0, Math.max(0, cardName.indexOf(','))) || cardName
              : cardName;
  const eventCondition = printedCondition.replace('{name}', sourceReference);
  const condition =
    ability.triggeringPlayerHandAtMost !== undefined
      ? `${eventCondition} if that player has ${numberWord(ability.triggeringPlayerHandAtMost)} or fewer cards in hand,`
      : ability.interveningIf === undefined
        ? eventCondition
        : ability.interveningIf.kind === 'selfCounterCountBelow' && ability.interveningIf.fewerThan === 1
          ? `${eventCondition} if ${sourceReference} has no ${counterName(ability.interveningIf.counter)} counters on it,`
          : `${eventCondition} if ${conditionClause(ability.interveningIf)},`;
  if (ability.spellSharesChosenColors === true) {
    return `${condition} you gain 1 life for each of the chosen colors it is.`;
  }
  if (ability.opponentMaySacrificeCreatureThenTapAndCounterSelf === true) {
    return 'At the beginning of each combat, any opponent may sacrifice a creature of their choice. If a player does, tap this creature and put a +1/+1 counter on it.';
  }
  const sourcePowerPump = ability.effects[0];
  if (
    ability.condition === 'selfAttacks' &&
    ability.effects.length === 1 &&
    sourcePowerPump?.kind === 'pumpUntilEndOfTurn' &&
    !isLiteralAmount(sourcePowerPump.power) &&
    sourcePowerPump.power.kind === 'triggeringCreaturePower' &&
    !isLiteralAmount(sourcePowerPump.toughness) &&
    sourcePowerPump.toughness.kind === 'triggeringCreaturePower' &&
    sourcePowerPump.scope === 'permanentsYouControl' &&
    canonicalJson(sourcePowerPump.scopeFilter) === '{"cardTypes":["creature"]}' &&
    sourcePowerPump.excludeReferent === true &&
    sourcePowerPump.target.kind === 'noTarget'
  ) {
    return `${condition} each other creature you control gets +X/+X until end of turn, where X is this creature's power.`;
  }
  if (isOptionalDrawThenDiscardAbility(ability)) {
    return `${condition} you may draw a card. If you do, discard a card.`;
  }
  if (isOptionalDiscardThenDrawAbility(ability)) {
    return `${condition} you may discard a card. If you do, draw a card.`;
  }
  if (ability.optionalControllerPayment !== undefined) {
    const effect = ability.effects[0];
    if (effect?.kind !== 'discardCards') throw new Error('paid optional trigger lost its discard payload');
    return `${condition} you may pay ${formatManaCost(ability.optionalControllerPayment.cost)}. If you do, target player discards a card.`;
  }
  const deathGrowth = ability.effects[0];
  if (
    ability.condition === 'controlledCreatureDies' &&
    ability.effects.length === 1 &&
    deathGrowth?.kind === 'putCounters' &&
    deathGrowth.counter === 'plusOnePlusOne' &&
    !isLiteralAmount(deathGrowth.count) &&
    deathGrowth.count.kind === 'triggeringCreaturePower' &&
    deathGrowth.target.kind === 'targetCreatureYouControl'
  ) {
    return `${condition} put X +1/+1 counters on target creature you control, where X is the power of the creature that died.`;
  }
  const returnAura = ability.effects[0];
  if (
    ability.condition === 'enchantedCreatureDies' &&
    ability.targetChooser === 'triggeringPlayer' &&
    ability.effects.length === 1 &&
    returnAura?.kind === 'returnSourceAuraAttached'
  ) {
    return `${condition} its controller chooses target creature one of their opponents controls. Return this card from its owner's graveyard to the battlefield attached to that creature.`;
  }
  if (isCounterTriggeringSpellOrAbilityAbility(ability)) {
    return `${condition} counter that spell or ability unless its controller pays ${formatManaCost(ability.counterTriggeringSpellOrAbilityUnless.cost)}.`;
  }
  if (isSacrificeSelfUnlessControllerPaysAbility(ability)) {
    return `${condition} sacrifice it unless you pay ${formatManaCost(ability.sacrificeSelfUnlessControllerPays.cost)}.`;
  }
  if (ability.sacrificeEnchantedPermanentUnlessControllerPaysManaValue === true) {
    return `${condition} that player sacrifices it unless they pay {X}, where X is its mana value.`;
  }
  if (isEnchantedLandBecomesTappedMillAbility(ability)) {
    return `${condition} its controller mills three cards.`;
  }
  if (isControlledCreatureCombatDamageCountersAbility(ability)) {
    return `${condition} put that many +1/+1 counters on it.`;
  }
  if (isReturnAnotherCreatureOrSacrificeSelfAbility(ability)) {
    return `${condition} sacrifice it unless you return another creature you control to its owner's hand.`;
  }
  const attackEffect = ability.effects[0];
  if (
    ability.condition === 'creatureAttacksYouOrPlaneswalkerYouControl' &&
    ability.effects.length === 1 &&
    attackEffect?.kind === 'putCounters' &&
    attackEffect.count === 1 &&
    attackEffect.target.kind === 'selfCreature'
  ) {
    return `${condition} put ${counterPhrase(attackEffect.counter, 1)} on ${cardName}.`;
  }
  if (
    ability.condition === 'creatureAttacksYouOrPlaneswalkerYouControl' &&
    ability.effects.length === 1 &&
    attackEffect?.kind === 'loseLife' &&
    attackEffect.amount === 1 &&
    attackEffect.target.kind === 'triggeringPlayer'
  ) {
    return `${condition} that creature's controller loses 1 life.`;
  }
  if (
    ability.condition === 'selfAttacksAlone' &&
    ability.effects.length === 1 &&
    attackEffect?.kind === 'sacrificePermanent' &&
    attackEffect.target.kind === 'triggeringPlayer' &&
    (attackEffect.count ?? 1) === 1 &&
    attackEffect.players === undefined &&
    attackEffect.filter?.cardTypes?.length === 1 &&
    attackEffect.filter.cardTypes[0] === 'creature' &&
    Object.keys(attackEffect.filter).length === 1
  ) {
    return `${condition} defending player sacrifices a creature of their choice.`;
  }
  const damageEffect = ability.effects[0];
  if (
    ability.condition === 'selfIsDealtDamage' &&
    ability.effects.length === 1 &&
    damageEffect?.kind === 'dealDamage' &&
    typeof damageEffect.amount !== 'number' &&
    damageEffect.amount.kind === 'triggeringDamageAmount' &&
    damageEffect.target.kind === 'chosenPlayer'
  ) {
    return `${condition} it deals that much damage to the chosen player.`;
  }
  const millEffect = ability.effects[0];
  if (
    ability.condition === 'selfDealsCombatDamageToPlayer' &&
    ability.effects.length === 1 &&
    millEffect?.kind === 'millCards' &&
    typeof millEffect.count !== 'number' &&
    millEffect.count.kind === 'triggeringDamageAmount' &&
    millEffect.target.kind === 'triggeringPlayer'
  ) {
    return `${condition} that player mills that many cards.`;
  }
  // A coin branch follows a clause that already established the source, so
  // source-dealt damage inside the branch uses Oracle's retained pronoun
  // ("it deals") rather than repeating the printed source reference. Source-
  // body targets such as `selfCreature` still render their own exact noun.
  const effectSourceName =
    ability.effects[0]?.kind === 'flipCoin'
      ? 'it'
      : ability.triggerZone === 'graveyard'
        ? 'this card'
        : sourceReference;
  const [first, ...unlinkedRest] = renderEffectList(ability.effects, effectSourceName, sourceKind);
  // Current Oracle carries the opponent named by the intervening-if clause
  // forward with singular "they". Other triggering-player templates still
  // use "that player" because their event clause, not this predicate, is the
  // antecedent.
  const firstWithRetainedPlayerPronoun =
    ability.triggeringPlayerIsOpponent === true && ability.triggeringPlayerHandAtMost !== undefined
      ? first?.replace(/^That player loses\b/u, 'They lose')
      : first;
  const openingEffect = ability.effects[0];
  const firstWithSourcePronoun =
    openingEffect !== undefined &&
    hasTarget(openingEffect) &&
    openingEffect.target.kind === 'selfPermanent' &&
    ability.printedSourceReference !== undefined
      ? firstWithRetainedPlayerPronoun?.replace(
          new RegExp(`^Return ${sourceReference.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\b`, 'u'),
          'Return it',
        )
      : firstWithRetainedPlayerPronoun;
  const firstEffectTarget =
    openingEffect !== undefined && hasTarget(openingEffect) ? openingEffect.target.kind : null;
  const rest = unlinkedRest.map((sentence, index) => {
    const effect = ability.effects[index + 1];
    const repeatsSelfCreature =
      firstEffectTarget === 'selfCreature' &&
      effect !== undefined &&
      hasTarget(effect) &&
      effect.target.kind === 'selfCreature';
    return repeatsSelfCreature
      ? sentence.replace(/^This creature\b/u, 'It').replace(/\bthis creature\b/gu, 'it')
      : sentence;
  });
  const clause = ability.optional === true ? mayClause : asClause;
  const firstEffect = ability.effects[0];
  const repeatedSource =
    firstEffect?.kind === 'dealDamage'
      ? `${damageSourcePhrase(firstEffect, effectSourceName, sourceKind)} `
      : undefined;
  const firstWithPronoun =
    firstWithSourcePronoun !== undefined &&
    printedCondition.includes('{name}') &&
    firstEffect?.kind === 'dealDamage' &&
    (firstEffect.players !== undefined ||
      firstEffect.target.kind === 'noTarget' ||
      firstEffect.division !== undefined) &&
    repeatedSource !== undefined
      ? `It ${firstWithSourcePronoun.slice(repeatedSource.length)}`
      : firstWithSourcePronoun;
  const opening = firstWithPronoun === undefined ? '' : clause(firstWithPronoun, cardName);
  return [`${condition} ${opening}`, ...rest].join(' ');
}

/** Printed English for a CR 603.8 condition that reads current battlefield state. */
function renderStateTriggeredAbility(
  ability: StateTriggeredAbility,
  cardName: string,
  sourceKind?: CardKind,
): string {
  const condition = ability.condition;
  const [first, ...rest] = renderEffectList(ability.effects, cardName, sourceKind);
  const opening = first === undefined ? '' : asClause(first, cardName);
  return [
    `When you control no permanents with ${counterName(condition.counter)} counters on them, ${opening}`,
    ...rest,
  ].join(' ');
}

/**
 * The printed cost of an activated ability, up to but not including the colon.
 *
 * Magic prints the mana symbols first and every other cost after them, in
 * comma-separated order: `{1}{R}, {T}, Sacrifice Bomb Bag`. A free ability
 * prints only `{T}`, because `{0}, {T}` is not something a card says —
 * `formatManaCost` renders an empty cost as `{0}`, which is right at the top of
 * a card and wrong in the middle of a cost line. A cost that is none of the
 * three cannot be printed at all, so it falls back to `{0}`; `checkAbilities`
 * refuses that card as `ABILITY_COST_INVALID` before it can reach a face, since
 * a free repeatable ability is not a card.
 *
 * The sacrifice names the card rather than saying "this artifact", so the
 * caller's name slot fills it: a printed card reads "Sacrifice Bomb Bag" and
 * the Forge transpiler, which renders with `CARDNAME`, gets the spelling
 * `res/cardsfolder` uses.
 *
 * `sacrificeOther` is its own clause after that one, never a wider spelling of
 * it: they are two payments, and a chest that ate a Key and itself prints both.
 * A cost that prints no clause here is a cost the card charges and its own text
 * does not name, which is the one failure a renderer over a checked vocabulary
 * is here to make impossible.
 *
 * `discard` prints last, which is where Magic puts it on every card that has
 * both ("{1}, Sacrifice a creature, Discard a card"). The clause names no card,
 * because CR 701.8a lets the paying player choose any of theirs and the cost
 * has no filter field to print (`ability-shape.ts`).
 *
 * The mana clause is printed when the cost has an `{X}` even though its mana
 * value is zero, because `manaValue` counts X as nothing (CR 202.3b, X is 0
 * everywhere but the stack) and Silklash Spider's `{X}{G}{G}` would otherwise
 * lose the one symbol that says what the player announces. `formatManaCost`
 * puts the `{X}` first, which is where a card prints it.
 */
function activationCostText(cost: ActivationCost, cardName: string, activationZone?: 'graveyard'): string {
  const parts: string[] = [];
  if (manaValue(cost.mana) > 0 || cost.mana.hasX) parts.push(activationManaCostText(cost));
  if (cost.tapSelf) parts.push('{T}');
  if (cost.payLife !== undefined) parts.push(`Pay ${String(cost.payLife)} life`);
  if (cost.tapMatching !== undefined) parts.push(tapMatchingText(cost.tapMatching));
  if (cost.removeCounter !== undefined) {
    parts.push(
      `Remove ${counterPhrase(cost.removeCounter.counter, cost.removeCounter.count)} from ${cardName}`,
    );
  }
  if (cost.sacrificeSelf) parts.push(`Sacrifice ${cardName}`);
  if (cost.exileSelf) {
    parts.push(activationZone === 'graveyard' ? 'Exile this card from your graveyard' : `Exile ${cardName}`);
  }
  if (cost.exileControlledInstantOrSorcerySpell === true) {
    parts.push('Exile an instant or sorcery spell you control');
  }
  if (cost.sacrificeOther !== undefined) parts.push(sacrificeOtherText(cost.sacrificeOther));
  if (cost.sacrificeMatching !== undefined) parts.push(sacrificeMatchingText(cost.sacrificeMatching));
  if (cost.sacrificeLandSubtypePair !== undefined) {
    parts.push(`Sacrifice a ${cost.sacrificeLandSubtypePair[0]} and a ${cost.sacrificeLandSubtypePair[1]}`);
  }
  if (cost.discard !== undefined) parts.push(discardCostText(cost.discard, cost.discardFilter));
  if (cost.discardMatching !== undefined) parts.push('Discard two nonland cards with the same name');
  return parts.length === 0 ? activationManaCostText(cost) : parts.join(', ');
}

/** Printed mana clause for an activation, preserving an audited source order when present. */
function activationManaCostText(cost: ActivationCost): string {
  if (cost.printedManaPips === undefined) return formatManaCost(cost.mana);
  const x = cost.mana.hasX ? ['{X}'] : [];
  const generic = cost.mana.generic > 0 ? [`{${String(cost.mana.generic)}}`] : [];
  const fixed = cost.printedManaPips.map((pip) => `{${pip}}`);
  return [...x, ...generic, ...fixed].join('');
}

/**
 * `Sacrifice a Key`, `Sacrifice two Keys`.
 *
 * One is an article and not a numeral, which is how Magic prints every "Sacrifice
 * a Goblin" ever printed; two and up are the spelled number and the plural, the
 * same pair `renderEffect` prints for a count of cards.
 */
function sacrificeOtherText(sacrifice: SacrificeOther): string {
  const count = sacrifice.count === 1 ? articleForWord(sacrifice.subtype) : numberWord(sacrifice.count);
  return `Sacrifice ${count} ${pluralize(sacrifice.subtype, sacrifice.count)}`;
}

/** `Sacrifice a creature`, or the plural form for a wider payment. */
function sacrificeMatchingText(
  sacrifice: SacrificeMatching & { readonly excludeSource?: true | undefined },
): string {
  const baseNoun = scopeNoun(sacrifice.filter, sacrifice.count !== 1);
  const noun = sacrifice.nontoken === true ? `nontoken ${baseNoun}` : baseNoun;
  if (sacrifice.excludeSource === true) {
    const count = sacrifice.count === 1 ? 'another' : `${numberWord(sacrifice.count)} other`;
    return `Sacrifice ${count} ${noun}`;
  }
  const count = sacrifice.count === 1 ? articleForWord(noun) : numberWord(sacrifice.count);
  return `Sacrifice ${count} ${noun}`;
}

/** `Tap five untapped Vampires you control`. */
function tapMatchingText(tap: NonNullable<ActivationCost['tapMatching']>): string {
  const noun = permanentChoiceNoun(tap.filter, tap.count !== 1);
  const count = tap.count === 1 ? articleForWord(noun) : numberWord(tap.count);
  return `Tap ${count} untapped ${noun} you control`;
}

/**
 * `Discard a card`, `Discard two cards`.
 *
 * `sacrificeOtherText`'s pair one function up, over the one noun a discard cost
 * can name. The article for one rather than the numeral is the same rule, and
 * it is the rule `renderEffect`'s own `discardCards` arm follows, so the cost
 * clause and the effect sentence spell the same quantity the same way.
 */
function discardCostText(count: number, filter: CardFilter | undefined): string {
  if (filter === undefined) return count === 1 ? 'Discard a card' : `Discard ${numberWord(count)} cards`;
  if (count === 1) return `Discard ${cardFilterPhrase(filter)}`;
  return `Discard ${searchPluralPhrase(filter, numberWord(count))}`;
}

/**
 * The cost, a colon, then what it does.
 *
 * The effect sentences are the same ones a spell prints. Unlike a trigger's,
 * they are not lowercased: a colon ends the cost clause, and Magic starts a new
 * sentence after it ("{T}: Draw a card."), where a trigger's comma continues
 * one ("When Merfolk Sentry enters the battlefield, you gain 2 life.").
 */
function renderActivatedAbility(ability: ActivatedAbility, cardName: string, sourceKind?: CardKind): string {
  if (isAttachingAbility(ability)) return renderEquipAbility(ability, cardName);
  const sourceReference =
    ability.printedSourceReference === 'thisCard'
      ? 'this card'
      : ability.printedSourceReference === 'thisCreature'
        ? 'this creature'
        : ability.printedSourceReference === 'thisArtifact'
          ? 'this artifact'
          : ability.printedSourceReference === 'thisEnchantment'
            ? 'this enchantment'
            : ability.printedSourceReference === 'thisLand'
              ? 'this land'
              : ability.printedSourceReference === 'cardNameBeforeComma'
                ? cardName.slice(0, Math.max(0, cardName.indexOf(','))) || cardName
                : cardName;
  if (isDamageTargetAndCreaturesWithSameNameAbility(ability)) {
    return `${activationCostText(ability.cost, sourceReference, ability.activationZone)}: ${capitalize(sourceReference)} deals 1 damage to target creature and each other creature with the same name as that creature.`;
  }
  if (isRegenerationAbility(ability)) {
    return withActivationRestrictions(
      `${activationCostText(ability.cost, sourceReference, ability.activationZone)}: Regenerate this creature.`,
      ability,
      cardName,
    );
  }
  if (isScavengeAbility(ability)) {
    const cost = activationManaCostText(ability.cost);
    return `Scavenge ${cost} (${cost}, Exile this card from your graveyard: Put a number of +1/+1 counters equal to this card's power on target creature. Scavenge only as a sorcery.)`;
  }
  const paidPowerDamage = ability.effects[0];
  if (
    ability.effects.length === 1 &&
    paidPowerDamage?.kind === 'dealDamage' &&
    typeof paidPowerDamage.amount === 'object' &&
    paidPowerDamage.amount.kind === 'paidSacrificePower' &&
    paidPowerDamage.target.kind === 'targetPlayerOrPlaneswalker' &&
    ability.cost.sacrificeSelf
  ) {
    return withActivationRestrictions(
      `${activationManaCostText(ability.cost)}, Sacrifice this creature: It deals damage equal to its power to target player or planeswalker.`,
      ability,
      cardName,
    );
  }
  const renderedBody = capitalize(renderActivatedBody(ability, sourceReference, sourceKind));
  const body =
    ability.counterTargetSpellUnless === undefined
      ? renderedBody
      : withUnlessClause(renderedBody, {
          payer: 'targetController',
          cost: ability.counterTargetSpellUnless.cost,
        });
  if (ability.loyaltyCost !== undefined) return `[${loyaltyCostText(ability.loyaltyCost)}]: ${body}`;
  const reminder =
    ability.cost.exileControlledInstantOrSorcerySpell === true ? " (That spell won't resolve.)" : '';
  const timingReminder =
    ability.activateOnlyAsInstantReminder === true ? ' (Activate only as an instant.)' : '';
  const printed = `${activationCostText(ability.cost, sourceReference, ability.activationZone)}: ${body}${reminder}${timingReminder}`;
  return withActivationRestrictions(printed, ability, cardName);
}

/** Appends the independent CR 602 activation restrictions in printed order. */
function withActivationRestrictions(printed: string, ability: ActivatedAbility, cardName: string): string {
  let restricted = printed;
  if (ability.activateOnlyWhileAttacking === true) {
    restricted = `${restricted} Activate only if ${cardName} is attacking.`;
  }
  if (ability.activateOnlyOnceEachTurn === true) {
    restricted = `${restricted} Activate only once each turn.`;
  }
  return ability.activateOnlyAsSorcery === true ? `${restricted} Activate only as a sorcery.` : restricted;
}

/** The effect sentence after an activated ability's cost or loyalty badge. */
function renderActivatedBody(ability: ActivatedAbility, cardName: string, sourceKind?: CardKind): string {
  if (isJaceArchitectAttackDebuffAbility(ability)) {
    return 'Until your next turn, whenever a creature an opponent controls attacks, it gets -1/-0 until end of turn.';
  }
  if (isJaceArchitectPilesAbility(ability)) {
    return 'Reveal the top three cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other on the bottom of your library in any order.';
  }
  if (isJaceArchitectSearchAndCastAbility(ability)) {
    return "For each player, search that player's library for a nonland card and exile it, then that player shuffles. You may cast those cards without paying their mana costs.";
  }
  if (isCombatDamageRetaliationAbility(ability)) {
    const sourceName = cardName.split(' ')[0] ?? cardName;
    return `Until your next turn, whenever a creature deals combat damage to ${sourceName}, destroy that creature.`;
  }
  if (ability.modes !== undefined) {
    return (
      renderInlineSignedPumpChoice(ability.modes) ?? renderModesBlock(ability.modes, cardName).join('\n')
    );
  }
  const selfDamage = ability.effects[0];
  if (
    ability.effects.length === 1 &&
    selfDamage?.kind === 'dealDamage' &&
    typeof selfDamage.amount === 'object' &&
    selfDamage.amount.kind === 'paidSacrificePower' &&
    selfDamage.target.kind === 'targetPlayerOrPlaneswalker' &&
    ability.cost.sacrificeSelf
  ) {
    return 'It deals damage equal to its power to target player or planeswalker.';
  }
  if (
    ability.effects.length === 1 &&
    selfDamage?.kind === 'dealDamage' &&
    selfDamage.amount === 1 &&
    selfDamage.target.kind === 'selfPermanent'
  ) {
    return `${cardName} deals 1 damage to itself.`;
  }
  return renderEffectList(ability.effects, cardName, sourceKind).join(' ');
}

/**
 * The non-bulleted signed choice printed by Liliana's reusable effect shape.
 *
 * This is recognized from structure rather than card identity: two one-effect
 * modes, the same creature target and tally, and inverse unit rates. Other
 * activated modes keep the ordinary CR 700.2 bullet rendering.
 */
function renderInlineSignedPumpChoice(modes: Modes): string | null {
  if (modes.length !== 2) return null;
  const positive = modes[0]?.effects;
  const negative = modes[1]?.effects;
  if (positive?.length !== 1 || negative?.length !== 1) return null;
  const grow = positive[0];
  const shrink = negative[0];
  if (
    grow?.kind !== 'pumpUntilEndOfTurn' ||
    shrink?.kind !== 'pumpUntilEndOfTurn' ||
    grow.scope !== undefined ||
    shrink.scope !== undefined ||
    grow.keyword !== undefined ||
    shrink.keyword !== undefined ||
    !isRateAmount(grow.power) ||
    !isRateAmount(grow.toughness) ||
    !isRateAmount(shrink.power) ||
    !isRateAmount(shrink.toughness) ||
    grow.power.rate !== 1 ||
    grow.toughness.rate !== 1 ||
    shrink.power.rate !== -1 ||
    shrink.toughness.rate !== -1 ||
    canonicalJson(grow.power.each) !== canonicalJson(grow.toughness.each) ||
    canonicalJson(grow.power.each) !== canonicalJson(shrink.power.each) ||
    canonicalJson(grow.power.each) !== canonicalJson(shrink.toughness.each) ||
    canonicalJson(grow.target) !== canonicalJson(shrink.target)
  ) {
    return null;
  }
  return `${capitalize(targetPhrase(grow.target))} gets +X/+X or -X/-X until end of turn, where X is ${computedPhrase(grow.power.each)}.`;
}

/**
 * A loyalty cost as it is printed on the badge: `+1`, `0`, `−2`.
 *
 * The minus is U+2212, not a hyphen, because that is the glyph Magic prints and
 * because a hyphen in a proportional face is short enough next to a `+` that a
 * player reading a board at a glance sees the wrong sign. Zero prints bare: a
 * signed zero is not a cost anybody has ever printed.
 *
 * This is the one place the sign is decided. `renderActivatedAbility` wraps it
 * in brackets for the flat oracle string and `oracleRows` hands it to a face
 * that draws a badge instead, and both read the same glyph from here.
 */
export function loyaltyCostText(loyaltyCost: LoyaltyCost): string {
  if (isVariableLoyaltyCost(loyaltyCost)) return '−X';
  if (loyaltyCost > 0) return `+${String(loyaltyCost)}`;
  if (loyaltyCost < 0) return `−${String(-loyaltyCost)}`;
  return '0';
}

/** The static clause an Equip ability grants, or the empty string for bare Equip. */
export function renderEquipModificationClause(modifications: readonly AttachModification[]): string {
  if (modifications.length === 0) return '';
  const equipped: StaticSubject = { phrase: 'equipped creature', singular: true };
  return modificationClause(equipped, verbObjectModifications(modifications));
}

function renderEquipAbility(ability: AttachingAbility, cardName: string): string {
  const cost = `Equip ${activationCostText(ability.cost, cardName)}`;
  const granted = renderEquipModificationClause(ability.attach.modifications);
  if (granted.length === 0) return cost;
  return `${granted}\n${cost}`;
}

/** One printed line for one CR 113 ability. `cardName` fills CARDNAME slots. */
export function renderAbility(ability: Ability, cardName: string, sourceKind?: CardKind): string {
  switch (ability.kind) {
    case 'static':
      return renderStaticAbility(ability, cardName);
    case 'triggered':
      return renderTriggeredAbility(ability, cardName, sourceKind);
    case 'activated':
      return renderActivatedAbility(ability, cardName, sourceKind);
    case 'staticPlayerRule':
      return renderStaticPlayerRule(ability);
    case 'staticGameRule':
      return renderStaticGameRule(ability);
    case 'stateTriggered':
      return renderStateTriggeredAbility(ability, cardName, sourceKind);
    case 'staticBundle':
      return renderStaticBundleAbility(ability);
    case 'staticActivationRule':
      return "Activated abilities of sources with the chosen name can't be activated unless they're mana abilities.";
    default:
      return assertNever(ability, 'renderAbility');
  }
}

/**
 * One printed row of the text box: what it costs, if anything, and what it says.
 *
 * A planeswalker's face does not print `[+1]: …` as a run of text; it prints a
 * badge in its own column and the ability beside it, and a card may carry a row
 * with no badge at all (a static or triggered ability sharing the box). So the
 * cost has to survive as a separate field all the way to a renderer, and the
 * one place that knows how an ability decomposes is the renderer that composes
 * it. A view layer that re-derived the split by matching `/^\[([+−]?\d+)\]: /`
 * against the flat string would be parsing this module's output back into this
 * module's input, and would go wrong the first time an effect sentence started
 * with a bracket.
 *
 * `loyaltyCost` is already printed text (`+1`, `0`, `−2`) rather than a number,
 * because the sign glyph is a typographic decision (`loyaltyCostText`) and two
 * renderers making it separately is two chances to print a hyphen.
 */
export interface OracleRow {
  /** The badge's text, or `null` for a row that prints no badge. */
  readonly loyaltyCost: string | null;
  /** The row's printed English, with no cost prefix and no trailing newline. */
  readonly text: string;
}

/**
 * Full rules text of a card, decomposed into its printed rows.
 *
 * Keywords occupy a row, in canonical vocabulary order, first word capitalized;
 * each ability follows in card order; effects close as one paragraph. An ability
 * that prints on two lines (Equipment: the granted static, then `Equip {2}`)
 * arrives as two rows, because the row is the unit a text box lays out and the
 * fact that one record produced both is not a fact the box gets to see.
 *
 * `renderOracleText` is this function joined with newlines, which is the whole
 * relationship between them: the string is a projection of the rows and never
 * the other way around.
 */
export function oracleRows(card: Card): readonly OracleRow[] {
  return abilityRows(card).flatMap(splitRow);
}

/**
 * The card's own entry clause, as printed rows.
 *
 * One function for every card kind that carries `entryReplacement`, because
 * the land branch and the nonland branch print the same sentence and a second
 * copy of it is a second chance for the two to disagree about a word. The
 * conditional member is land-only in the schema (`card.ts` says why), so it
 * simply never matches on anything else.
 */
function entryReplacementRows(card: Card): readonly OracleRow[] {
  const replacement = printedEntryReplacement(card);
  if (replacement === undefined) return [];
  const sourceReference =
    card.kind === 'land' && card.printedEntryReference === 'thisLand'
      ? 'This land'
      : card.kind === 'enchantment' && card.printedEntryReference === 'thisEnchantment'
        ? 'This enchantment'
        : card.name;
  if (replacement.kind === 'entersTapped') return [plainRow(`${sourceReference} enters tapped.`)];
  if (replacement.kind === 'payLifeOrEntersTapped') {
    const enteringReference = sourceReference === card.name ? card.name : sourceReference.toLowerCase();
    return [
      plainRow(
        `As ${enteringReference} enters, you may pay ${String(replacement.life)} life. If you don't, it enters tapped.`,
      ),
    ];
  }
  if (replacement.kind === 'entersWithCounters') {
    if (typeof replacement.count !== 'number') {
      if (replacement.count.kind === 'opponentsLifeLostThisTurn') {
        return [
          plainRow(
            `This creature enters with X ${counterName(replacement.counter)} counters on it, where X is the total life lost by your opponents this turn.`,
          ),
        ];
      }
      return [
        plainRow(`${sourceReference} enters with X ${counterName(replacement.counter)} counters on it.`),
      ];
    }
    return [
      plainRow(
        `${sourceReference} enters with ${counterPhrase(replacement.counter, replacement.count)} on it.`,
      ),
    ];
  }
  if (replacement.kind === 'entersAsCopyOfCreature') {
    return [plainRow('You may have this creature enter as a copy of any creature on the battlefield.')];
  }
  if (replacement.kind === 'putCounterOnControlledPermanent') {
    return [
      plainRow(
        `As ${card.name} enters, put ${counterPhrase(replacement.counter, replacement.count)} on ${articleForWord(replacement.permanentType)} ${replacement.permanentType} you control.`,
      ),
    ];
  }
  if (replacement.kind === 'entersAsCharacteristicChoice') {
    const modeText = (mode: EntryCharacteristicMode): string => {
      const addedTypes = mode.addSubtypes === undefined ? '' : `${mode.addSubtypes.join(' ')} `;
      const artifact = isArtifact(card) ? 'artifact ' : '';
      const keywords =
        mode.addKeywords === undefined && mode.addKeywordAbilities === undefined
          ? ''
          : ` with ${joinWithAnd([
              ...(mode.addKeywords ?? []).map((keyword) => KEYWORD_PRINT_NAMES[keyword].toLowerCase()),
              ...(mode.addKeywordAbilities ?? []).flatMap((ability) =>
                keywordAbilityLines([ability]).map((line) => line.toLowerCase()),
              ),
            ])}`;
      const retainedTypes = mode.addSubtypes === undefined ? '' : ' in addition to its other types';
      return `a ${String(mode.power)}/${String(mode.toughness)} ${addedTypes}${artifact}creature${keywords}${retainedTypes}`;
    };
    const choices = joinWithOr(replacement.modes.map(modeText));
    const defenderReminder = replacement.modes.some((mode) =>
      mode.addKeywordAbilities?.some((ability) => ability.kind === 'defender'),
    )
      ? " (A creature with defender can't attack.)"
      : '';
    return [plainRow(`As this creature enters, it becomes your choice of ${choices}.${defenderReminder}`)];
  }
  if (replacement.kind === 'choosePlayer') {
    return [plainRow(`As ${card.name} enters, choose a player.`)];
  }
  if (replacement.kind === 'chooseTwoColors') {
    return [plainRow('As this artifact enters, choose two colors.')];
  }
  if (replacement.kind === 'chooseCardName') {
    return [plainRow('As this artifact enters, choose a card name.')];
  }
  const types = replacement.landTypes.map((type) => `${articleForWord(type)} ${type}`);
  return [plainRow(`${card.name} enters tapped unless you control ${types.join(' or ')}.`)];
}

/** A deck-building permission is printed text, but never an in-game ability. */
function deckConstructionRows(card: Card): readonly OracleRow[] {
  const rule = card.deckConstruction;
  if (rule === undefined) return [];
  return [plainRow(`A deck can have any number of cards named ${card.name}.`)];
}

/** A pregame permission prints before every rule the permanent has in play. */
function openingHandActionRows(card: Card): readonly OracleRow[] {
  const action = openingHandActionOf(card);
  if (action === undefined) return [];
  switch (action.kind) {
    case 'beginOnBattlefield':
      return [
        plainRow(
          `If ${card.name} is in your opening hand, you may begin the game with it on the battlefield.`,
        ),
      ];
  }
}

/** A casting rule lives above the spell's own instructions in its text box. */
const ORDINALS = [
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
  'thirteenth',
  'fourteenth',
  'fifteenth',
  'sixteenth',
  'seventeenth',
  'eighteenth',
  'nineteenth',
  'twentieth',
] as const;

function joinedAlternatives(words: readonly string[]): string {
  if (words.length === 1) return words[0] ?? '';
  if (words.length === 2) return `${words[0] ?? ''} or ${words[1] ?? ''}`;
  return `${words.slice(0, -1).join(', ')}, or ${words.at(-1) ?? ''}`;
}

/** Exact printed sentence for a card-level turn-history restriction. */
export function renderCastingRestriction(rule: CastingRestriction, subject: string): string {
  switch (rule.kind) {
    case 'prohibitedPlayerTurns':
      return `You can't cast ${subject} during your ${joinedAlternatives(rule.turns.map((turn) => ORDINALS[turn - 1] ?? `${String(turn)}th`))} turns of the game.`;
  }
}

/** The current legendary-name template used by Rakdos's atomic casting bundle. */
export function renderOpponentLifeLossCastingRestriction(subject: string): string {
  const printedSubject = subject.split(',')[0] ?? subject;
  return `You can't cast ${printedSubject} unless an opponent lost life this turn.`;
}

function castingRuleRows(card: Card): readonly OracleRow[] {
  const rows: OracleRow[] = [];
  if (card.kind === 'creature' && card.opponentsLifeLostThisTurnCasting === true) {
    rows.push(plainRow(renderOpponentLifeLossCastingRestriction(card.name)));
  }
  if (isCastable(card) && card.castingRestriction !== undefined) {
    rows.push(plainRow(renderCastingRestriction(card.castingRestriction, card.name)));
  }
  if (card.cannotBeCountered === true) rows.push(plainRow("This spell can't be countered."));
  if (isSpellCard(card) && card.targetCostIncrease !== undefined) {
    const amount = card.targetCostIncrease.genericPerTargetBeyondFirst;
    rows.push(
      plainRow(`This spell costs {${String(amount)}} more to cast for each target beyond the first.`),
    );
  }
  return rows;
}

/** A spell's paid non-mana clause, above the instruction it purchases. */
function additionalCostRows(card: Card): readonly OracleRow[] {
  if (!isSpellCard(card) || card.additionalCost === undefined) return [];
  const payment =
    'sacrificeMatching' in card.additionalCost
      ? sacrificeMatchingText(card.additionalCost.sacrificeMatching)
      : 'Discard a card';
  return [plainRow(`As an additional cost to cast this spell, ${asClause(payment, card.name)}.`)];
}

/** The exact Oracle sentence for the supported CR 118.9 alternative. */
export function renderAlternativeCost(cost: SpellAlternativeCost): string {
  const sacrifice = sacrificeMatchingText(cost.sacrificeMatching);
  const clause = `${sacrifice[0]?.toLowerCase() ?? ''}${sacrifice.slice(1)}`;
  return `You may pay ${cost.payLife} life and ${clause} rather than pay this spell's mana cost.`;
}

/** A castable card's alternative payment, above its keywords and abilities. */
function alternativeCostRows(card: Card): readonly OracleRow[] {
  if (!isCastable(card) || card.alternativeCost === undefined) return [];
  return [plainRow(renderAlternativeCost(card.alternativeCost))];
}

function targetingRestrictionText(card: Card, restriction: TargetingRestriction): string {
  const subject = card.kind === 'creature' ? 'This creature' : 'This permanent';
  switch (restriction.kind) {
    case 'sourceLacksColor': {
      const color = COLOR_WORDS[restriction.color];
      return `${subject} can't be the target of non${color} spells or abilities from non${color} sources.`;
    }
    default:
      return assertNever(restriction.kind, 'targetingRestrictionText');
  }
}

function targetingRestrictionRows(card: Card): readonly OracleRow[] {
  return (card.targetingRestrictions ?? []).map((restriction) =>
    plainRow(targetingRestrictionText(card, restriction)),
  );
}

/** Rows before multi-line abilities are split; see `oracleRows`. */
function abilityRows(card: Card): readonly OracleRow[] {
  if (card.kind === 'land') {
    const rows: OracleRow[] = [];
    rows.push(...openingHandActionRows(card));
    rows.push(...castingRuleRows(card));
    // A land's text box starts with its keyword abilities, the way Darksteel
    // Citadel prints "Indestructible" above its mana ability. This branch used
    // to return before `keywordAbilityLines` was ever reached, which was
    // invisible while `checkKeywords` refused a keyword ability on any
    // noncreature; `mtg-rji` let one onto a land, and a dropped line here would
    // have been a card whose printed face disagreed with the kernel running it.
    rows.push(...keywordAbilityLines(card.keywordAbilities ?? []).map(plainRow));
    rows.push(...targetingRestrictionRows(card));
    const manaRow =
      card.producesMana.length === 0
        ? null
        : plainRow(
            isAnyColor(card.producesMana)
              ? '{T}: Add one mana of any color.'
              : `{T}: Add ${card.producesMana.map((color) => `{${color}}`).join(' or ')}.`,
          );
    if (card.printedManaAbilityFirst === true && manaRow !== null) rows.push(manaRow);
    rows.push(...entryReplacementRows(card));
    for (const ability of card.abilities) {
      if (ability.kind !== 'activated') rows.push(abilityRow(ability, card.name, card.kind));
    }
    if (card.printedManaAbilityFirst !== true && manaRow !== null) rows.push(manaRow);
    for (const ability of card.abilities) {
      if (ability.kind === 'activated') rows.push(abilityRow(ability, card.name, card.kind));
    }
    rows.push(...deckConstructionRows(card));
    return rows;
  }
  const rows: OracleRow[] = [];
  rows.push(...openingHandActionRows(card));
  rows.push(...castingRuleRows(card));
  rows.push(...alternativeCostRows(card));
  rows.push(...additionalCostRows(card));
  if (isAuraCard(card)) {
    const enchantLine =
      card.aura.enchant === 'artifactOrCreature'
        ? 'Enchant artifact or creature'
        : card.aura.enchant === 'nonlandPermanent'
          ? 'Enchant nonland permanent'
          : `Enchant ${card.aura.enchant}`;
    rows.push(plainRow(enchantLine));
  }
  const keywordAbilities = card.keywordAbilities ?? [];
  if (card.keywordLineGroups !== undefined) {
    rows.push(...card.keywordLineGroups.map((group) => plainRow(keywordLineGroupText(group))));
  } else {
    const flashAbilities = keywordAbilities.filter((ability) => ability.kind === 'flash');
    const defenderAbilities = keywordAbilities.filter((ability) => ability.kind === 'defender');
    const otherKeywordAbilities = keywordAbilities.filter(
      (ability) => ability.kind !== 'flash' && ability.kind !== 'defender',
    );
    rows.push(...keywordAbilityLines(flashAbilities).map(plainRow));
    rows.push(...keywordAbilityLines(defenderAbilities).map(plainRow));
    if (card.keywords.length > 0) rows.push(plainRow(keywordRowText(card.keywords)));
    rows.push(...keywordAbilityLines(otherKeywordAbilities).map(plainRow));
  }
  rows.push(...targetingRestrictionRows(card));
  // A nonland permanent's entry clause prints where a land's does, under the
  // keyword lines and above everything the permanent does once it is there:
  // "Coldsteel Heart enters tapped." is a fact about the arrival, and the
  // mana ability underneath it is what the arrival was paid for.
  rows.push(...entryReplacementRows(card));
  if (card.kind === 'creature' && card.characteristicPowerToughness !== undefined) {
    rows.push(
      plainRow(characteristicPowerToughnessSentence(card.characteristicPowerToughness, `${card.name}'s`)),
    );
  }
  if (card.kind === 'creature' && card.redirectControllerAndOtherPermanentsDamageToSelf === true) {
    rows.push(
      plainRow(
        'All damage that would be dealt to you and other permanents you control is dealt to this creature instead.',
      ),
    );
  }
  const trailingAuraAbilities: Ability[] = [];
  const trailingEquipRows: OracleRow[] = [];
  for (const ability of card.abilities) {
    if (
      card.kind === 'creature' &&
      card.redirectControllerAndOtherPermanentsDamageToSelf === true &&
      ability.kind === 'static' &&
      ability.scope === 'self' &&
      ability.modification.kind === 'preventCombatDamage'
    ) {
      continue;
    }
    if (ability.kind === 'activated' && isAttachingAbility(ability)) {
      const granted = renderEquipModificationClause(ability.attach.modifications);
      if (granted.length > 0) rows.push(plainRow(granted));
      trailingEquipRows.push(plainRow(`Equip ${activationCostText(ability.cost, card.name)}`));
      continue;
    }
    if (
      isAuraCard(card) &&
      (card.aura.printedModificationsBeforeAbilities === true ||
        ability.kind === 'activated' ||
        (ability.kind === 'triggered' &&
          (ability.condition === 'enchantedCreatureBecomesTarget' ||
            ability.condition === 'enchantedCreatureDies' ||
            ability.condition === 'enchantedLandBecomesTapped' ||
            ability.condition === 'selfPutIntoGraveyardFromBattlefield')))
    ) {
      trailingAuraAbilities.push(ability);
    } else rows.push(abilityRow(ability, card.name, card.kind));
  }
  // `!== undefined` alongside `!== null`: `CostReductionSchema.nullable().default(null)`
  // promises a parsed `Card` never actually carries `undefined` here, but
  // `withRenderedOracleText` is by design called on a pre-parse literal — it
  // supplies the printed line `parseCard` insists on rendering rather than
  // reading, so its caller has not run zod's defaulting yet. A literal that
  // omits the key is stating no reduction, the same as one that spells it
  // `null`.
  if (card.costReduction !== null && card.costReduction !== undefined) {
    rows.push(plainRow(describeCostReduction(card.costReduction)));
  }
  if (card.kind === 'creature' && card.opponentsLifeLostThisTurnCasting === true) {
    rows.push(
      plainRow(
        'Creature spells you cast cost {1} less to cast for each 1 life your opponents have lost this turn.',
      ),
    );
  }
  if (isAuraCard(card) && card.aura.modifications.length > 0) {
    rows.push(
      plainRow(renderAuraModificationClause(card.aura.modifications, auraHostNoun(card.aura.enchant))),
    );
  }
  if (isAuraCard(card) && card.aura.enchantedControllerHandSizeBonus === true) {
    rows.push(plainRow("Enchanted creature gets +1/+1 for each card in its controller's hand."));
  }
  if (isAuraCard(card) && card.aura.untapsDuringEachOtherPlayersUntapStep === true) {
    const host = auraHostNoun(card.aura.enchant);
    rows.push(plainRow(`Enchanted ${host} has "Untap this ${host} during each other player's untap step."`));
  }
  for (const ability of trailingAuraAbilities) rows.push(abilityRow(ability, card.name, card.kind));
  rows.push(...trailingEquipRows);
  if (card.modes !== undefined) {
    rows.push(...renderModesBlock(card.modes, card.name).map(plainRow));
  } else {
    rows.push(...renderSpellParagraphs(card).map(plainRow));
  }
  if ((card.kind === 'instant' || card.kind === 'sorcery') && card.overload !== undefined) {
    rows.push(plainRow(`Overload ${formatOverloadCost(card.overload)}`));
  }
  rows.push(...deckConstructionRows(card));
  return rows;
}

function plainRow(text: string): OracleRow {
  return { loyaltyCost: null, text };
}

/**
 * One ability as a row. A loyalty ability keeps its cost in the badge column;
 * everything else prints its cost inside its own sentence, where Magic puts it.
 */
function abilityRow(ability: Ability, cardName: string, sourceKind: CardKind): OracleRow {
  // The guards are `renderActivatedAbility`'s, in its order: an Equipment and a
  // regenerator print their own templates whatever else they carry, and neither
  // is reachable on a planeswalker. Ordering them the same way here is what
  // keeps `renderOracleText` a projection rather than a second renderer.
  if (
    ability.kind === 'activated' &&
    !isAttachingAbility(ability) &&
    !isRegenerationAbility(ability) &&
    ability.loyaltyCost !== undefined
  ) {
    return {
      loyaltyCost: loyaltyCostText(ability.loyaltyCost),
      text: renderActivatedBody(ability, cardName, sourceKind),
    };
  }
  return plainRow(renderAbility(ability, cardName, sourceKind));
}

/** Split multiline abilities into rows; a bare Equip ability remains one row. */
function splitRow(row: OracleRow): readonly OracleRow[] {
  const [first, ...rest] = row.text.split('\n');
  if (first === undefined) return [row];
  return [{ loyaltyCost: row.loyaltyCost, text: first }, ...rest.map(plainRow)];
}

/** The printed form of one row: the badge text back inside the flat string. */
function rowLine(row: OracleRow): string {
  return row.loyaltyCost === null ? row.text : `[${row.loyaltyCost}]: ${row.text}`;
}

/**
 * Full rules text of a card. Keywords print on their own line, in canonical
 * vocabulary order, first word capitalized; each ability follows on its own
 * line, in card order; effects close as one paragraph.
 *
 * This is `oracleRows` flattened, and it stays byte-identical to what it printed
 * before the rows existed: `parseCard` compares a card's stored `oracleText`
 * against this function, so every committed set fixture is an assertion that the
 * decomposition round-trips.
 */
export function renderOracleText(card: Card): string {
  return oracleRows(card).map(rowLine).join('\n');
}

/**
 * A spell's printed paragraph, with whichever of its two resolution clauses it
 * carries wrapped around the sentence they modify.
 *
 * Both clauses are the card's, not an effect's (`may.ts`, `unless.ts`), so both
 * are printed here rather than inside `renderEffect` — an effect does not know
 * whether the card around it asked a question before running it. They land on
 * the *first* sentence for opposite reasons that happen to agree: a `may` gates
 * the whole list and English puts the offer in front of it, and an `unless` is
 * legal only on a spell printing one effect, so its first sentence is its only
 * one.
 *
 * `card.may` went unprinted between `mtg-bc2.152.4` and `mtg-3zjg`. The field
 * changed how the kernel resolved the spell and changed nothing about its text,
 * so a card that stopped and asked a player a question printed a line promising
 * it would not — and `parseCard` compares `oracleText` against this function,
 * which means the omission was enforced rather than merely missed.
 */
function renderSpellParagraphs(card: Card): readonly string[] {
  const sentences = renderEffectList(
    isSpellCard(card) ? spellEffectsFor(card, null, 'ordinary') : card.effects,
    card.name,
  );
  const [first, ...rest] = sentences;
  if (first === undefined) return [];
  const clause = card.unless;
  const opening = clause === undefined ? first : withUnlessClause(first, clause);
  const offered = card.may === undefined ? opening : capitalize(mayClause(opening, card.name));
  const rendered = [offered, ...rest];
  const breaks =
    card.kind === 'instant' || card.kind === 'sorcery'
      ? new Set(card.printedEffectParagraphBreaks ?? [])
      : new Set<number>();
  const paragraphs: string[] = [];
  let paragraph: string[] = [];
  for (const [index, sentence] of rendered.entries()) {
    if (breaks.has(index) && paragraph.length > 0) {
      paragraphs.push(paragraph.join(' '));
      paragraph = [];
    }
    paragraph.push(sentence);
  }
  if (paragraph.length > 0) paragraphs.push(paragraph.join(' '));
  return paragraphs;
}

/**
 * A run of effects printed as one paragraph, each knowing what the ones before
 * it already said.
 *
 * The back-references live here rather than inside `renderEffect` because they
 * are a property of the *list*: whether "that player" has a referent depends on
 * what the previous sentence named, which one effect cannot know about itself.
 * Every caller that prints more than one effect goes through this, so a card and
 * a triggered ability read the same way.
 */
export function renderEffectList(
  effects: readonly Effect[],
  cardName: string,
  sourceKind?: CardKind,
): readonly string[] {
  const named = new Set<string>();
  const handsShown = new Set<string>();
  const sentences: string[] = [];
  for (let index = 0; index < effects.length; index += 1) {
    const effect = effects[index];
    if (effect === undefined) continue;
    const key = hasTarget(effect) ? canonicalJson(effect.target) : '';
    const prior: PriorMention = {
      samePlayerNamed: key.length > 0 && named.has(key),
      handShown: key.length > 0 && handsShown.has(key),
    };
    let sentence = renderEffect(effect, cardName, prior, sourceKind);
    const referentIndex = referentSourceIndex(effects, index);
    const previous = effects[index - 1];
    if (
      effect.kind === 'pumpUntilEndOfTurn' &&
      effect.scope === 'creaturesThatPlayerControls' &&
      effect.excludeReferent === true &&
      effect.target.kind === 'thatCreaturesController' &&
      referentIndex !== null &&
      effects[referentIndex]?.kind === 'destroyPermanent'
    ) {
      sentence = renderPump(
        'Each other creature that player controls',
        effect.power,
        effect.toughness,
        true,
        effect.keyword,
      );
    }
    if (
      effect.kind === 'gainLife' &&
      effect.target.kind === 'thatCreaturesController' &&
      !isLiteralAmount(effect.amount) &&
      effect.amount.kind === 'thatCreatureToughness'
    ) {
      sentence = 'Its controller gains life equal to its toughness.';
    }
    if (
      effect.kind === 'pumpUntilEndOfTurn' &&
      effect.target.kind === 'thatCreature' &&
      effect.keyword === 'haste' &&
      referentIndex !== null &&
      effects[referentIndex]?.kind === 'gainControlUntilEndOfTurn' &&
      previous?.kind === 'untapPermanent' &&
      previous.target.kind === 'thatCreature'
    ) {
      // Traitorous Instinct's final clause retains the one creature the first
      // effect chose. Its duration leads the sentence and "it" refers through
      // the intervening untap, while the reusable pump renderer still owns the
      // P/T and keyword grammar.
      const retainedPump = renderPump('it', effect.power, effect.toughness, true, effect.keyword);
      sentence = `Until end of turn, ${retainedPump.replace(' until end of turn.', '.')}`;
    }
    if (key.length > 0) {
      named.add(key);
      if (effect.kind === 'revealHand') handsShown.add(key);
    }

    // Incite's grammar is a relationship between two independently reusable
    // effects: the second retains the creature the first targeted, and Magic
    // joins the two predicates under one subject. Keep the compounding here,
    // where sibling effects and their referents are visible, rather than in
    // either primitive or behind a card-name exception.
    const next = effects[index + 1];
    const afterNext = effects[index + 2];
    if (
      effect.kind === 'gainLife' &&
      effect.target.kind === 'noTarget' &&
      !isLiteralAmount(effect.amount) &&
      effect.amount.kind === 'chosenX' &&
      next?.kind === 'drawCards' &&
      next.players === undefined &&
      next.target.kind === 'noTarget' &&
      !isLiteralAmount(next.count) &&
      next.count.kind === 'chosenX'
    ) {
      // The same announced X governs both quantities, so Magic prints the
      // symbol once in each coordinated object rather than expanding either
      // computed amount into an "equal to" clause.
      sentence = 'You gain X life and draw X cards.';
      index += 1;
    }
    if (
      effect.kind === 'drawCards' &&
      effect.target.kind === 'noTarget' &&
      effect.players === undefined &&
      isLiteralAmount(effect.count) &&
      next?.kind === 'discardCards' &&
      next.target.kind === 'noTarget' &&
      next.players === undefined
    ) {
      const discard =
        next.count === 'all'
          ? 'discard your hand'
          : next.count === 1
            ? 'discard a card'
            : `discard ${numberWord(next.count)} cards`;
      sentence = `${sentence.slice(0, -1)}, then ${discard}.`;
      index += 1;
    }
    if (
      effect.kind === 'dealDamage' &&
      effect.players === 'eachOpponent' &&
      next?.kind === 'discardCards' &&
      next.players === 'eachOpponent' &&
      next.random === true &&
      next.count !== 'all'
    ) {
      sentence = `${sentence} Those players each discard ${numberWord(next.count)} cards at random.`;
      index += 1;
    }
    if (
      effect.kind === 'destroyPermanent' &&
      effect.target.kind === 'targetCreature' &&
      next?.kind === 'discardCards' &&
      next.target.kind === 'thatCreaturesController' &&
      next.players === undefined
    ) {
      const discard =
        next.count === 'all'
          ? 'discards their hand'
          : next.count === 1
            ? 'discards a card'
            : `discards ${numberWord(next.count)} cards`;
      sentence = `${sentence} Its controller ${discard}.`;
      index += 1;
    }
    if (
      effect.kind === 'destroyPermanent' &&
      effect.target.kind === 'targetCreature' &&
      next?.kind === 'loseLife' &&
      next.target.kind === 'thatCreaturesController' &&
      next.players === undefined
    ) {
      const life = isLiteralAmount(next.amount)
        ? `${next.amount} life`
        : `life ${amountEqualTo(next.amount)}`;
      sentence = `${sentence} Its controller loses ${life}.`;
      index += 1;
    }
    if (
      effect.kind === 'exileTarget' &&
      isGraveyardCardTargetKind(effect.target.kind) &&
      next?.kind === 'exileTarget' &&
      isGraveyardCardTargetKind(next.target.kind)
    ) {
      const following = renderEffect(next, cardName, prior, sourceKind);
      sentence = `${sentence.slice(0, -1)} and ${following.slice('Exile '.length)}`;
      index += 1;
    }
    if (
      effect.kind === 'discardCards' &&
      effect.count === 7 &&
      effect.target.kind === 'thatPlayerOrPlaneswalkerController' &&
      next?.kind === 'sacrificePermanent' &&
      next.count === 7 &&
      next.target.kind === 'thatPlayerOrPlaneswalkerController' &&
      next.filter !== undefined &&
      targetFilterIsEmpty(next.filter) &&
      next.players === undefined &&
      next.excludeSource !== true
    ) {
      sentence = `${sentence.slice(0, -1)}, then sacrifices seven permanents of their choice.`;
      index += 1;
    }
    if (
      effect.kind === 'sacrificePermanent' &&
      effect.target.kind === 'noTarget' &&
      effect.players === undefined &&
      (effect.count ?? 1) === 1 &&
      effect.filter?.cardTypes?.length === 1 &&
      effect.filter.cardTypes[0] === 'creature' &&
      next?.kind === 'gainLife' &&
      next.target.kind === 'noTarget' &&
      !isLiteralAmount(next.amount) &&
      next.amount.kind === 'sacrificedPermanentPowerThisResolution' &&
      afterNext?.kind === 'drawCards' &&
      afterNext.target.kind === 'noTarget' &&
      !isLiteralAmount(afterNext.count) &&
      afterNext.count.kind === 'sacrificedPermanentPowerThisResolution'
    ) {
      sentences.push(sentence);
      sentences.push("You gain X life and draw X cards, where X is that creature's power.");
      index += 2;
      continue;
    }
    if (
      effect.kind === 'shuffleHandsAndGraveyardsIntoLibraries' &&
      next?.kind === 'drawCards' &&
      next.players === 'eachPlayer' &&
      next.target.kind === 'noTarget' &&
      isLiteralAmount(next.count) &&
      next.count === 7
    ) {
      // Time Reversal's two actions share one subject and Magic joins them with
      // "then". This is shape-driven rather than name-driven: the atomic reset
      // followed by the hand-authored seven-card player sweep has one exact
      // printed form whichever card carries it.
      sentence = 'Each player shuffles their hand and graveyard into their library, then draws seven cards.';
      index += 1;
    }
    if (
      effect.kind === 'setColorsUntilEndOfTurn' &&
      next?.kind === 'attacksThisTurnIfAble' &&
      next.target.kind === 'thatCreature'
    ) {
      sentence = `${sentence.slice(0, -1)} and attacks this turn if able.`;
      named.add(canonicalJson(next.target));
      index += 1;
    }
    const sameCreature =
      next !== undefined &&
      hasTarget(next) &&
      next.target.kind === 'thatCreature' &&
      referentSourceIndex(effects, index + 1) === index;
    if (effect.kind === 'pumpUntilEndOfTurn' && sameCreature) {
      let compounded = sentence;
      if (
        next.kind === 'grantKeywordUntilEndOfTurn' &&
        next.additionalKeywords === undefined &&
        next.removeKeywordAbility === undefined
      ) {
        compounded = sentence.replace(
          ' until end of turn',
          ` and gains ${GRANTABLE_KEYWORD_PRINT_NAMES[next.keyword]} until end of turn`,
        );
      } else if (
        next.kind === 'grantKeywordUntilEndOfTurn' &&
        next.additionalKeywords !== undefined &&
        next.removeKeywordAbility === undefined
      ) {
        const subjectAndPump = sentence.replace(' until end of turn.', '');
        const keywords = [next.keyword, ...next.additionalKeywords].map(
          (keyword) => GRANTABLE_KEYWORD_PRINT_NAMES[keyword],
        );
        compounded = `Until end of turn, ${lowercaseOpening(subjectAndPump)} and gains ${joinWithAnd(
          keywords,
        )}.`;
      } else if (next.kind === 'attacksThisTurnIfAble') {
        compounded = sentence.replace(
          ' until end of turn',
          ' until end of turn and attacks this turn if able',
        );
      } else if (next.kind === 'cantBeBlockedThisTurn') {
        compounded = sentence.replace(
          ' until end of turn',
          " until end of turn and can't be blocked this turn",
        );
      }
      if (compounded !== sentence) {
        if (next.kind === 'grantKeywordUntilEndOfTurn' && next.keyword === 'intimidate') {
          compounded = `${compounded} (It can't be blocked except by artifact creatures and/or creatures that share a color with it.)`;
        }
        sentence = compounded;
        index += 1;
      }
    }
    if (
      next?.kind === 'populate' &&
      (effect.kind === 'createToken' || effect.kind === 'exileTarget' || effect.kind === 'destroyPermanent')
    ) {
      // RTR prints these three setup actions and Populate as one ordered
      // sentence. The relationship belongs to the effect list: both effects
      // stay independently reusable, while their authored adjacency carries
      // the printed "then" and the same execution order the kernel observes.
      sentence = `${sentence.slice(0, -1)}, then populate.`;
      index += 1;
    }
    sentences.push(sentence);
  }
  return sentences;
}

/**
 * CR 700.2's "Choose one —" line, then one bulleted line per mode.
 *
 * Only the "choose one" wording is printed. `modal.ts` bounds a mode list at
 * `MAX_MODES` (CR 700.2 also permits "choose two" and "choose three" spells),
 * but the mechanism that resolves a choice — `effectsFor`, threaded through
 * casting and the stack by `mtg-bc2.152.4` — takes a single `mode: number`,
 * so every modal card this renderer can see today asks for exactly one. A
 * card that wanted "choose two" would need that mechanism widened first; this
 * renderer would then need its own second line, not a guess at one now.
 */
function renderModesBlock(modes: Modes, cardName: string): readonly string[] {
  return ['Choose one —', ...modes.map((mode) => `• ${renderEffectList(mode.effects, cardName).join(' ')}`)];
}

/** Keyword line uses comma separation (`Flying, vigilance`), not "and". */
function keywordPhraseLine(keywords: readonly Keyword[]): string {
  return sortKeywords(keywords)
    .map((keyword) => KEYWORD_PRINT_NAMES[keyword])
    .join(', ');
}

/**
 * The exact row `abilityRows` prints for a card's flat keywords — the one
 * `renderOracleText` and a card face both draw, and the string
 * `@mtg/card-geometry`'s `remindedBlocks` matches against to find that row
 * among a card's other printed lines.
 *
 * Exported (rather than kept as the private `keywordPhraseLine` above wrapped
 * in a private `capitalize`) so that matching can happen by *content* instead
 * of by position. `abilityRows` pushes an `Enchant creature` row ahead of the
 * keyword row on an Aura (`isAuraCard`), so "the keyword row is `rows[0]`"
 * was only ever true for a card with nothing printed first — a fact about
 * every fixture at the time, not a fact about the schema. mtg-67vm is a card
 * face that trusted the position anyway.
 */
export function keywordRowText(keywords: readonly Keyword[]): string {
  return capitalize(keywordPhraseLine(keywords));
}

function protectionQualityPhrase(quality: ProtectionQuality): string {
  switch (quality.kind) {
    case 'color':
      return COLOR_WORDS[quality.color];
    case 'subtype':
      return pluralize(quality.subtype, 2);
    default:
      return assertNever(quality, 'protectionQualityPhrase');
  }
}

/** One rules line per intrinsic keyword family, with Protection qualities grouped. */
function keywordAbilityLines(abilities: readonly KeywordAbility[]): readonly string[] {
  const lines: string[] = [];
  const protection: ProtectionQuality[] = [];
  for (const ability of abilities) {
    switch (ability.kind) {
      case 'defender':
        lines.push('Defender');
        break;
      case 'landwalk':
        lines.push(`${ability.landType}walk`);
        break;
      case 'hexproof':
        lines.push('Hexproof');
        break;
      case 'indestructible':
        lines.push('Indestructible');
        break;
      case 'protection':
        protection.push(ability.quality);
        break;
      case 'doubleStrike':
        lines.push('Double strike');
        break;
      case 'shroud':
        lines.push('Shroud');
        break;
      case 'flash':
        lines.push('Flash');
        break;
      case 'intimidate':
        lines.push('Intimidate');
        break;
      case 'unleash':
        lines.push('Unleash');
        break;
      default:
        assertNever(ability, 'keywordAbilityLines');
    }
  }
  if (protection.length > 0) {
    lines.push(`Protection from ${protection.map(protectionQualityPhrase).join(' and from ')}`);
  }
  return lines;
}

function lowercaseOpening(value: string): string {
  return `${value.charAt(0).toLowerCase()}${value.slice(1)}`;
}

/** One source-authored line group, without changing the rules vocabulary it lays out. */
export function keywordLineGroupText(
  group: Readonly<NonNullable<Card['keywordLineGroups']>[number]>,
): string {
  const parts = group.map((item) => {
    if (typeof item === 'string') return KEYWORD_PRINT_NAMES[item];
    const [line] = keywordAbilityLines([item]);
    if (line === undefined) throw new Error(`keyword line group cannot render ${JSON.stringify(item)}`);
    return lowercaseOpening(line);
  });
  return capitalize(parts.join(', '));
}

/** Whole printed card as text: the human-readable rendering used in reports. */
export function renderCard(card: Card): string {
  const costLine = isCastable(card) ? `${card.name} ${formatManaCost(card.manaCost)}` : card.name;
  const lines = [costLine, renderTypeLine(card)];
  const text = renderOracleText(card);
  if (text.length > 0) lines.push(text);
  if (card.kind === 'creature') {
    lines.push(printedPowerToughness(card));
  }
  return lines.join('\n');
}

/**
 * A token's own printed rules text, as one line.
 *
 * Ordinary token text comes from the same card renderer as any other
 * permanent. A token CDA uses Magic's self-reference “This creature” rather
 * than the token name that an ordinary card prints; its creator separately
 * quotes “This token” through `tokenHavingClause`. `renderOracleText`
 * separates a keyword line from an ability line with a newline, which a quoted
 * clause inside another card's sentence cannot carry, so the lines are joined
 * with a space here.
 */
export function renderTokenOracleText(token: TokenSpec): string {
  if (token.characteristicPowerToughness !== undefined) {
    const abilitySubject = token.quoteAbilities === true ? 'this token' : tokenReferenceName(token);
    return [
      ...(token.keywords.length > 0 ? [keywordRowText(token.keywords)] : []),
      characteristicPowerToughnessSentence(token.characteristicPowerToughness, "This creature's"),
      ...tokenAbilities(token).map((ability) => renderAbility(ability, abilitySubject)),
    ].join(' ');
  }
  if (token.quoteAbilities === true) {
    const lines = [
      ...(token.keywords.length > 0 ? [keywordRowText(token.keywords)] : []),
      ...tokenAbilities(token).map((ability) => renderAbility(ability, 'this token')),
    ];
    return lines.join(' ');
  }
  return renderOracleText(tokenCard(token)).split('\n').join(' ');
}

/** Returns a copy of the card with `oracleText` set to the rendered text. */
export function withRenderedOracleText<T extends Card>(card: T): T {
  return { ...card, oracleText: renderOracleText(card) };
}
