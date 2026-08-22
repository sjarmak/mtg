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
  SacrificeOther,
  StaticAbility,
  StaticModificationOf,
  TriggeredAbility,
} from './abilities';
import {
  flurryRushRank,
  gloomRank,
  isAttachingAbility,
  isExaltedAbility,
  isRegenerationAbility,
} from './abilities';
import type { AttachModification, CombatModification, LayeredStaticModification } from './abilities';
import type { ReplacementStaticModification } from './static-modification-class';
import { isCombatStaticModification, isLayeredStaticModification } from './static-modification-class';
import type { Amount, ComputedAmount, CountFilter, PermanentTally, PumpAmount } from './amount';
import type { Condition } from './condition';
import { isLiteralAmount, isRateAmount } from './amount';
import type { AuraModification, Card, KeywordAbility, ProtectionQuality } from './card';
import {
  isArtifact,
  isAuraCard,
  isCastable,
  isStaticAuraModification,
  printedEntryReplacement,
  printedPowerToughness,
} from './card';
import type { CounterKind } from './counters';
import { counterName, counterPhrase, counterReminderText } from './counters';
import { describeCostReduction } from './cost-reduction';
import { canonicalJson } from './canonical-json';
import type { CardFilter, Effect, GraveyardArrivalGrant, TokenSpec } from './effects';
import { hasTarget, isCreatureTokenSpec, tokenAbilities } from './effects';
import type { Modes } from './modal';
import { tokenCard, tokenReferenceName } from './token';
import type { TargetFilter, TargetSpec } from './targets';
import {
  cardTypeFilterFitsTargetKind,
  requiresDistinctTarget,
  targetCountOf,
  targetFilterOf,
  targetRestrictionOf,
} from './targets';
import { formatManaCost, manaValue } from './mana';
import type { Color, EffectScope, Keyword, ManaColor, PlayerScope, TargetCombatRole } from './vocabulary';
import {
  assertNever,
  COLOR_WORDS,
  COLORS,
  GRANTABLE_KEYWORD_PRINT_NAMES,
  KEYWORD_PRINT_NAMES,
  PT_COUNT_PRINT_TEXT,
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
  if (filter.colors !== undefined) words.push(joinWithOr(filter.colors.map((color) => COLOR_WORDS[color])));
  if (!nounFromFilter && filter.subtypes !== undefined) words.push(joinWithOr([...filter.subtypes]));
  return words.length === 0 ? '' : `${words.join(' ')} `;
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

function targetPhrase(target: TargetSpec, back = false): string {
  const count = targetCountOf(target);
  if (count !== null) return countedTargetPhrase(target, count);
  const { before, after } = restrictionPhrases(target);
  const phrase = targetNounPhrase(target, back);
  // "that player" and "that creature" are back-references to a choice already
  // made and printed; the restriction was printed with it and saying it twice
  // would read as a second condition rather than the same one.
  if (!phrase.startsWith('target') && !phrase.startsWith('another target')) return phrase;
  // The restriction's state adjective goes in front of the filter's, so a slot
  // carrying both prints "target tapped attacking creature": both are states,
  // and the one the older field owns keeps the position it has always printed
  // in rather than moving because a second field arrived.
  const adjectives = `${before}${filterAdjectives(targetFilterOf(target), cardTypeFilterFitsTargetKind(target.kind))}`;
  return `${phrase.replace(/^((?:another )?target )/, `$1${adjectives}`)}${after}`;
}

/**
 * "Up to two target creatures", with room for the same adjectives a plain
 * slot carries.
 *
 * `checkTargetCount` (`validate/effects.ts`) refuses a count anywhere but
 * `targetCreature`, so this always writes the one noun; it does not switch on
 * `target.kind` the way `targetNounPhrase` does; a second kind reaching this
 * function is a validator bug, not a case to guess at. `distinct` is refused
 * on the same slot by the same check, so `targetNounPhrase`'s "another"
 * branch has nothing to contribute here and this does not call it.
 */
function countedTargetPhrase(target: TargetSpec, count: number): string {
  const { before, after } = restrictionPhrases(target);
  const adjectives = `${before}${filterAdjectives(targetFilterOf(target))}`;
  return `up to ${numberWord(count)} target ${adjectives}creatures${after}`;
}

function targetNounPhrase(target: TargetSpec, back: boolean): string {
  const another = requiresDistinctTarget(target);
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
    // The three back-references (`mtg-nhyv.75`), each one fixed phrase for the
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
    case 'targetCreatureDefendingPlayerControls':
      return another
        ? 'another target creature defending player controls'
        : 'target creature defending player controls';
    case 'targetArtifactOrEnchantment':
      // Disenchant's printed wording, and Naturalize's: one noun phrase for the
      // one selector, never "target artifact and/or enchantment", which is the
      // plural form and belongs to a card that takes more than one.
      return another ? 'another target artifact or enchantment' : 'target artifact or enchantment';
    case 'targetCreatureYouDontControl':
      // Foe-Razer Regent's printed wording, and Affectionate Indrik's. The
      // apostrophe is the printed one; nothing downstream reads this string as
      // an identifier.
      return another ? "another target creature you don't control" : "target creature you don't control";
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

/**
 * "with flying", printed behind the noun rather than in front of it.
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
 */
function keywordClause(filter: TargetFilter | undefined): string {
  const keywords = filter?.keywords;
  if (keywords === undefined) return '';
  return ` with ${joinWithAnd(keywords.map((keyword) => KEYWORD_PRINT_NAMES[keyword]))}`;
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
    case 'countMatching':
      return `${countMatchingSingular(tally.filter)} you control`;
    case 'countWithCounter':
      return `${countMatchingSingular(tally.filter)} you control ${counterClause(tally.counters, false)}`;
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
    case 'cardsInGraveyard':
      return amount.whose === 'each'
        ? 'the number of cards in all graveyards'
        : 'the number of cards in your graveyard';
    case 'countMatching':
      return `the number of ${countMatchingPhrase(amount.filter)} you control`;
    case 'countWithCounter':
      return `the number of ${countMatchingPhrase(amount.filter)} you control ${counterClause(
        amount.counters,
        true,
      )}`;
    case 'countMatchingOpponent':
      // Plural "opponents" in a two-player engine, because it is the wording
      // Magic prints and the wording survives a table with more seats; the
      // kernel's `opponentOf` is what is singular, and that is its business.
      return `the number of ${countMatchingPhrase(amount.filter)} your opponents control`;
    case 'landsWithSubtype':
      return amount.whose === 'each'
        ? `the number of ${englishPlural(amount.subtype)} on the battlefield`
        : `the number of ${englishPlural(amount.subtype)} you control`;
    case 'chosenX':
      return 'the value chosen for X';
    case 'greatestPowerAmong':
      return `the greatest power among ${countMatchingPhrase(amount.among)} you control`;
    case 'damageDealtThisResolution':
      return 'the damage dealt this way';
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
    return `${subject} ${verb} ${formatPtDelta(power.rate, toughness.rate)}${rider} until end of turn for each ${permanentTallyPhrase(power.each)}.`;
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
 * `checkGraveyardChoiceParams` refuses a grant with neither list — so the
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

/**
 * What the token *has*, as the creating card prints it: its keywords, and
 * nothing else.
 *
 * A token's printed abilities are deliberately absent. Magic names a token and
 * prints its characteristics compactly; the ability text lives once, on the
 * token itself, and every card that makes one points at it by name. Inlining it
 * instead put a part token's whole Fuse ability inside seventeen flagship set
 * cards and drove four commons and one rare past the 140-character printed cap,
 * the worst at 258 (`mtg-hmb`). Keywords stay — "with flying" is three words and
 * is how Magic prints it too.
 *
 * The name that replaces the dropped text is `tokenReferenceName`'s, which is
 * `tokenCard`'s: the pointer a creating card prints has to be the name on the
 * card it points at, and there is one function deciding what that card is.
 *
 * The returned clause closes the sentence it is appended to, punctuation
 * included.
 */
function tokenHavingClause(token: TokenSpec): string {
  if (token.keywords.length === 0) return '.';
  return ` with ${keywordPhrase(token.keywords)}.`;
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
  return tokenAbilities(token).length > 0 ? ` named ${tokenReferenceName(token)}` : '';
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
  return `${sentence} ${subject}${tokenHavingClause(token)}`;
}

function renderTokenClause(count: Amount, token: TokenSpec): string {
  if (!isCreatureTokenSpec(token)) return renderNoncreatureTokenClause(count, token);
  const plural = !isLiteralAmount(count) || count !== 1;
  const body = [
    `${token.power}/${token.toughness}`,
    colorPhrase(token.colors),
    ...token.subtypes,
    'creature',
    plural ? 'tokens' : 'token',
  ].join(' ');
  const named = `${body}${tokenNameClause(token)}`;
  if (!isLiteralAmount(count)) {
    return `Create a number of ${named} ${amountEqualTo(count)}${tokenHavingClause(token)}`;
  }
  const quantity = count === 1 ? articleForNumber(token.power) : numberWord(count);
  return `Create ${quantity} ${named}${tokenHavingClause(token)}`;
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
 */
function cardFilterPhrase(filter: CardFilter): string {
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
  const bound = filter.maxManaValue === undefined ? '' : ` with mana value ${filter.maxManaValue} or less`;
  // A name is the other trailing clause, and it goes in front of the bound
  // because Magic prints the identity next to the noun it identifies: "a card
  // named Squadron Hawk", "a creature card named Ashnod's Altar with mana value
  // 3 or less". Like the bound it survives the no-type case, which is the case
  // that matters — a search by name almost never states a type as well, because
  // naming the card has already stated everything the type would.
  const named = filter.names === undefined ? '' : ` named ${joinWithOr([...filter.names])}`;
  if (spoken.length === 0) return `a card${named}${bound}`;
  const noun = `${spoken.join(' ')} card`;
  return `${articleForWord(noun)} ${noun}${named}${bound}`;
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
  const bound = filter.maxManaValue === undefined ? '' : ` with mana value ${filter.maxManaValue} or less`;
  const named = filter.names === undefined ? '' : ` named ${joinWithOr([...filter.names])}`;
  const noun = spoken.length === 0 ? 'cards' : `${spoken.join(' ')} cards`;
  return `${quantity} ${noun}${named}${bound}`;
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
 * than a house style. CR 701.19b lets any search fail to find, and this kernel
 * offers the take-nothing answer at every one of a multi-card search's
 * questions — so a card printing "search your library for two Forest cards"
 * (Skyshroud Claim's template, which Magic does print) would be promising
 * something the resolution does not enforce. Ranger's Path and M13's mass-ramp
 * sorcery both print "up to", and the line this renders for each is their
 * printed line word for word. The singular keeps its article: "search your library for a
 * card" is how every one-card searcher in Magic reads, and the failure clause
 * is CR 701.19b's rather than the card's.
 */
function renderSearch(effect: Extract<Effect, { kind: 'searchLibrary' }>): string {
  const count = effect.count ?? 1;
  const single = isLiteralAmount(count) && count === 1;
  const subject = single
    ? cardFilterPhrase(effect.filter)
    : searchPluralPhrase(effect.filter, `up to ${isLiteralAmount(count) ? numberWord(count) : 'X'}`);
  const where = isLiteralAmount(count) ? '' : `, where X is ${computedPhrase(count)}`;
  const pronoun = single ? 'it' : 'them';
  const reveal = effect.reveal === true ? `, reveal ${pronoun}` : '';
  const move =
    effect.destination === 'hand'
      ? `put ${pronoun} into your hand`
      : effect.destination === 'battlefieldTapped'
        ? `put ${pronoun} onto the battlefield tapped`
        : `put ${pronoun} onto the battlefield`;
  return `Search your library for ${subject}${where}${reveal}, ${move}, then shuffle.`;
}

export function renderEffect(effect: Effect, cardName: string, prior: PriorMention = NOTHING_SAID): string {
  const who = (target: TargetSpec): string => targetPhrase(target, prior.samePlayerNamed);
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
      const recipient =
        effect.scope === undefined
          ? who(effect.target)
          : EFFECT_SCOPE_EACH_PHRASES[effect.scope](who(effect.target), effect.scopeFilter);
      if (!isLiteralAmount(effect.amount) && effect.amount.kind === 'chosenX') {
        return `${cardName} deals X damage to ${recipient}.`;
      }
      return isLiteralAmount(effect.amount)
        ? `${cardName} deals ${effect.amount} damage to ${recipient}.`
        : `${cardName} deals damage to ${recipient} ${amountEqualTo(effect.amount)}.`;
    }
    // The plural group phrase, not the distributive one: destruction is a
    // single action taken on a set (CR 701.7b destroys them simultaneously),
    // and Magic's wording follows — "Destroy all creatures target player
    // controls", never "each creature".
    case 'destroyPermanent':
      return effect.scope === undefined
        ? `Destroy ${who(effect.target)}.`
        : `Destroy ${EFFECT_SCOPE_PHRASES[effect.scope](who(effect.target), prior, effect.scopeFilter)}.`;
    // Two sentences from one primitive, and Magic prints them differently
    // enough that a shared template would be wrong: the scoped form has no
    // "target creature" in it at all, because the creatures are not targets.
    case 'exileTarget':
      return effect.scope === undefined
        ? `Exile ${who(effect.target)}.`
        : `Exile ${EFFECT_SCOPE_PHRASES[effect.scope](who(effect.target), prior, undefined)}.`;
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
      return effect.target.kind === 'noTarget'
        ? `Draw ${cards}.`
        : `${capitalize(who(effect.target))} draws ${cards}.`;
    }
    case 'gainLife': {
      const life = isLiteralAmount(effect.amount)
        ? `${effect.amount} life`
        : `life ${amountEqualTo(effect.amount)}`;
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
      const filter = effect.spellFilter ?? null;
      const conjunction = filter?.allCardTypes;
      const types = filter?.cardTypes;
      const kinds =
        conjunction !== undefined
          ? `${conjunctiveCardTypeNoun(conjunction, false)} `
          : types === undefined
            ? ''
            : `${joinWithOr([...types])} `;
      return `Counter target ${filterAdjectives(filter)}${kinds}spell.`;
    }
    // CR 701.16a's action, in Magic's own words. "Their" rather than "his or
    // her": the current templating, and the only pronoun that works when the
    // subject is "target opponent".
    case 'revealHand':
      return `${capitalize(who(effect.target))} reveals their hand.`;
    case 'scry':
      return `Scry ${String(effect.count)}.`;
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
    // "Creature" rather than "permanent" in both, and it is provable rather
    // than idiomatic: `UNSCOPED_MAY_NAME_A_PLAYER` is false for this primitive
    // and `SCOPES_LEGAL_ON` admits only the battlefield member, so an unscoped
    // tap always names a creature and a scoped one always names creatures a
    // player controls.
    case 'tapPermanent': {
      const tap =
        effect.scope === undefined
          ? `Tap ${who(effect.target)}.`
          : `Tap ${EFFECT_SCOPE_PHRASES[effect.scope](who(effect.target), prior, effect.scopeFilter)}.`;
      if (effect.doesNotUntap !== true) return tap;
      // A counted slot ("up to two target creatures") is unscoped by
      // construction — `checkTargetCount` refuses `count` on anything but a
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
        ? `${tap} That creature doesn't untap during its controller's next untap step.`
        : `${tap} Those creatures don't untap during their controller's next untap step.`;
    }
    case 'returnToHand':
      return `Return ${who(effect.target)} to its owner's hand.`;
    case 'millCards': {
      const cards = isLiteralAmount(effect.count)
        ? `${numberWord(effect.count)} ${pluralize('card', effect.count)}`
        : `a number of cards ${amountEqualTo(effect.count)}`;
      return effect.target.kind === 'noTarget'
        ? `You mill ${cards}.`
        : `${capitalize(who(effect.target))} mills ${cards}.`;
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
          ? who(effect.target)
          : EFFECT_SCOPE_EACH_PHRASES[effect.scope](who(effect.target), effect.scopeFilter);
      const sentence = isLiteralAmount(effect.count)
        ? `Put ${counterPhrase(effect.counter, effect.count)} on ${recipient}.`
        : `Put a number of ${counterName(effect.counter)} counters on ${recipient} ${amountEqualTo(effect.count)}.`;
      const reminder = counterReminderText(effect.counter);
      return reminder === null ? sentence : `${sentence} ${reminder}`;
    }
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
      const cards = EFFECT_SCOPE_PHRASES[effect.scope](who(effect.target), prior, undefined);
      return effect.destination === 'hand'
        ? `Return ${cards} to their owner's hand.`
        : `Return ${cards} to the battlefield under their owner's control.`;
    }
    // "It" is a literal rather than the card's name, and that is safe only
    // because the validator refuses `fight` anywhere the pronoun would have no
    // antecedent: it is legal on a triggered ability and nowhere else, and
    // `renderTriggeredAbility` has just printed "When Foe-Razer Regent enters
    // the battlefield," in front of it. `mayClause` carries the matching arm,
    // because "you may it fights" is the sentence this reads as otherwise.
    case 'fight':
      return `It fights ${who(effect.target)}.`;
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
    case 'shuffleLibrary':
      return 'Shuffle your library.';
    // "Reveal", not "look at": the difference is who sees, and this primitive
    // shows both seats (`kernel/src/visibility.ts` passes the event through
    // unredacted). A card that only its controller may see is a different
    // effect and would print "Look at".
    case 'revealTopCards':
      return `Reveal the top ${numberWord(effect.count)} ${pluralize('card', effect.count)} of your library.`;
    // "Its owner's library", for `returnToHand`'s reason one arm up: CR 701.19a
    // sends a card to the library it came from, not to the caster's, and a card
    // that behaved one way and printed the other is exactly what this
    // vocabulary exists to prevent.
    case 'putOnLibrary':
      return effect.position === 'top'
        ? `Put ${who(effect.target)} on top of its owner's library.`
        : `Put ${who(effect.target)} on the bottom of its owner's library.`;
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
        : "Shuffle your graveyard into its owner's library.";
    case 'exileGraveyard':
      return effect.whose === 'you'
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
      const subject =
        effect.players === undefined ? capitalize(who(effect.target)) : PLAYER_SCOPE_PHRASES[effect.players];
      return effect.count === 1
        ? `${subject} discards a card.`
        : `${subject} discards ${numberWord(effect.count)} cards.`;
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
      return isLiteralAmount(effect.amount)
        ? `Your life total becomes ${effect.amount}.`
        : `Your life total becomes a number ${amountEqualTo(effect.amount)}.`;
    // Fog's line, unchanged. No count and no recipient, because the effect has
    // neither: it prevents all of it, for everyone, for the turn.
    case 'preventCombatDamage':
      return 'Prevent all combat damage that would be dealt this turn.';
    // Dawn Charm's first mode, aimed rather than blanket: one named creature,
    // every source of damage rather than only combat. `who` already renders
    // the hand-authored-only `targetCreature` the same way every other
    // targeted effect in this switch does.
    case 'preventAllDamageToTarget':
      return `Until end of turn, prevent all damage to ${who(effect.target)}.`;
    // One verb and one target, and no rider anywhere: the hold this cannot
    // clear belongs to the untap step rather than to this sentence, so the
    // printed line says nothing about it. `who` carries the filter, which is
    // what turns the widest space into Voltaic Key's "target artifact".
    case 'untapPermanent':
      return `Untap ${who(effect.target)}.`;
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
      return `${capitalize(subject)} ${gains} ${GRANTABLE_KEYWORD_PRINT_NAMES[effect.keyword]} until end of turn.`;
    }
    // The subject's order again, and "this turn" rather than "until end of
    // turn": both phrases name the same duration and Magic picks between them
    // by what the sentence is about. A characteristic a creature *gains* is
    // held until the end of the turn; a combat rule it is *under* applies this
    // turn. Goblin Tunneler and Alluring Siren both print the second.
    case 'cantBeBlockedThisTurn':
      return `${capitalize(who(effect.target))} can't be blocked this turn.`;
    case 'attacksYouThisTurnIfAble':
      return `${capitalize(who(effect.target))} attacks you this turn if able.`;
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
      return `Sacrifice ${who(effect.target)}.`;
    // The subject-first form `drawCards` uses, not the imperative form the
    // arm above it does: "Sacrifice this creature" is a command aimed at
    // whoever the ability's controller turns out to be, and "Target player
    // sacrifices a creature" is a fact stated about a named player, the same
    // difference `discardCards` prints over `sacrificeSelf`. `who` already
    // renders both `targetPlayer` and `targetOpponent` correctly; no count and
    // no filter to read, `sacrificePermanentEffect`'s stated cut.
    case 'sacrificePermanent':
      return `${capitalize(who(effect.target))} sacrifices a creature.`;
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
    default:
      return assertNever(effect, 'renderEffect');
  }
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
  const qualifier = ability.subtype === null ? '' : `${ability.subtype} `;
  switch (ability.scope) {
    case 'self':
      return { phrase: cardName, singular: true };
    case 'creaturesYouControl':
      return { phrase: `${qualifier}creatures you control`, singular: false };
    case 'otherCreaturesYouControl':
      return { phrase: `other ${qualifier}creatures you control`, singular: false };
    default:
      return assertNever(ability.scope, 'staticSubject');
  }
}

/**
 * One modification as its verb and what follows it, with no subject and no full
 * stop: `gets +2/+0`, `has flying`.
 *
 * P/T uses *get* and keywords use *have*, which are Magic's two verbs for a
 * modification, and the subject decides the number. Split out from the sentence
 * so a clause carrying more than one modification can say the subject once —
 * Magic prints "Equipped creature gets +99/-3 and has deathtouch", not the same
 * sentence twice.
 */
interface ModificationPhrase {
  readonly verb: string;
  readonly object: string;
}

/**
 * `modificationPhrase`'s domain: every modification kind Magic prints as
 * "{subject} {verb} {object}". `definePt` (CR 613.4a) is not one of these —
 * its sentence has no verb shared between the power half and the toughness
 * half ("Tarmogoyf's power is equal to… and its toughness is equal to…"), so
 * `renderStaticAbility` prints it through `definePtSentence` instead and
 * never reaches this type. `checkEquipAbility` (`validate/abilities.ts`)
 * refuses a `definePt` in an equip clause, which is what lets
 * `renderEquipAbility` narrow to this type below rather than widen
 * `modificationPhrase` to a sentence shape it cannot print.
 */
type VerbObjectModification = Exclude<LayeredStaticModification, { kind: 'definePt' }>;

function isVerbObjectModification(
  modification: LayeredStaticModification,
): modification is VerbObjectModification {
  return modification.kind !== 'definePt';
}

/**
 * `ability.attach.modifications` as `VerbObjectModification`s, for the one
 * caller (`renderEquipAbility`) that has no narrower type to read: throws
 * rather than silently dropping a modification, because reaching this with a
 * `definePt` in the list is a validation gap (`checkEquipAbility` should
 * already have refused the card), not a shape this renderer is meant to
 * absorb.
 */
function verbObjectModifications(
  modifications: readonly AttachModification[],
): readonly VerbObjectModification[] {
  return modifications.map((modification) => {
    if (isVerbObjectModification(modification)) return modification;
    throw new Error(
      'a characteristic-defining P/T (CR 613.4a) reached renderEquipAbility; checkEquipAbility should have refused it first',
    );
  });
}

function modificationPhrase(
  subject: StaticSubject,
  modification: VerbObjectModification,
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
    case 'statBonusPer':
      // The rate, then the thing it is charged per. Magic prints the whole
      // clause in the same "gets +0/+1 …" frame `statBonus` uses above, which
      // is why this is a verb-object modification rather than a sentence of
      // its own the way `definePt` is.
      return {
        verb: subject.singular ? 'gets' : 'get',
        object: `${formatPtDelta(modification.power, modification.toughness)} for each ${permanentTallyPhrase(modification.each)}`,
      };
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
 * trample", which is how Magic templates a keyword pair. Different verbs are
 * joined by the same "and" with the verb repeated, which is how Magic templates
 * "gets +1/+1 and has flying". The list is capped at two (`AttachSchema`), so
 * "and" is the only joiner this needs; a comma-and-serial form would be a third
 * clause the schema does not admit.
 */
function modificationClause(
  subject: StaticSubject,
  modifications: readonly VerbObjectModification[],
): string {
  const groups: { verb: string; objects: string[] }[] = [];
  for (const modification of modifications) {
    const phrase = modificationPhrase(subject, modification);
    const open = groups[groups.length - 1];
    if (open !== undefined && open.verb === phrase.verb) open.objects.push(phrase.object);
    else groups.push({ verb: phrase.verb, objects: [phrase.object] });
  }
  const said = groups.map((group) => `${group.verb} ${group.objects.join(' and ')}`).join(' and ');
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
export function renderAuraModificationClause(modifications: readonly AuraModification[]): string {
  const subject: StaticSubject = { phrase: 'enchanted creature', singular: true };
  const reminders: string[] = [];
  const phrases: ModificationPhrase[] = [];
  let control = false;
  let held = false;
  for (const modification of modifications) {
    if (isStaticAuraModification(modification)) {
      phrases.push(modificationPhrase(subject, modification));
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
  if (groups.length > 0) {
    sentences.push(
      `Enchanted creature ${groups
        .map((group) => `${group.verb} ${group.objects.join(' or ')}`)
        .join(' and ')}.`,
    );
  }
  if (held) sentences.push(ENCHANTED_DOES_NOT_UNTAP);
  return [...sentences, ...reminders].join(' ');
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
 * all five call sites are real `switch`/`assertNever` dispatch now that
 * `ConditionSchema` has a second member, rather than the direct field access
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
function conditionPhrase(condition: Condition): string {
  switch (condition.kind) {
    case 'controlsSubtype': {
      const noun =
        condition.atLeast === 1
          ? withArticle(condition.subtype)
          : `${numberWord(condition.atLeast)} or more ${englishPlural(condition.subtype)}`;
      return `As long as you control ${noun},`;
    }
    case 'anyCreatureHasCounter':
      return `As long as any creature has ${counterPhrase(condition.counter, 1)},`;
    // "in their graveyard" rather than "in his or her graveyard": the singular
    // they is what current Oracle wording uses, and "an opponent" is the
    // printed subject even at two players, where it names one person.
    case 'opponentGraveyardAtLeast':
      return `As long as an opponent has ${numberWord(condition.atLeast)} or more cards in their graveyard,`;
    case 'lifeAtLeast':
      return `As long as you have ${numberWord(condition.atLeast)} or more life,`;
    // "has been dealt", the printed passive: Bloodcrazed Goblin's line names
    // the player damage arrived at and never names what dealt it. The "no" is
    // the printed "unless" turned around, for the reason `condition.ts` gives.
    case 'noOpponentDealtDamageThisTurn':
      return 'As long as no opponent has been dealt damage this turn,';
    default:
      return assertNever(condition, 'conditionPhrase');
  }
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
function replacementSentence(modification: ReplacementStaticModification): string {
  switch (modification.kind) {
    case 'doubleDamage':
      return 'If a source would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.';
    case 'doubleLifeGain':
      return 'If you would gain life, you gain twice that much life instead.';
    default:
      return assertNever(modification, 'replacementSentence');
  }
}

/**
 * CR 508/509's seven combat modifications, each its own full sentence rather
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
    default:
      return assertNever(modification, 'combatModificationSentence');
  }
}

function renderStaticAbility(ability: StaticAbility, cardName: string): string {
  const modification = ability.modification;
  const sentence = isLayeredStaticModification(modification)
    ? modification.kind === 'definePt'
      ? definePtSentence(cardName, modification)
      : modificationClause(staticSubject(ability, cardName), [modification])
    : isCombatStaticModification(modification)
      ? combatModificationSentence(staticSubject(ability, cardName), modification)
      : replacementSentence(modification);
  const condition = ability.enabledWhile ?? null;
  if (condition === null) return sentence;
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
  return `${conditionPhrase(condition)} ${asClause(sentence, opener)}`;
}

/**
 * The trigger's condition clause, then what it does, on one line.
 *
 * The effect sentences are the same ones a spell prints, which is the point of
 * building an ability over the effect union rather than beside it — but the
 * first of them follows a comma, so `asClause` lowercases it unless it opens
 * with the card's name.
 *
 * An optional trigger (CR 603.3b) puts "you may" in front of that clause and
 * prints nothing else differently — the permission is one word, not a second
 * template. It is always the *first* clause because `checkAbilities` refuses an
 * optional trigger with a second effect: the kernel asks once for the whole
 * ability, and a "may" that reached one of two printed sentences would describe
 * a card that behaves the other way.
 */
function renderTriggeredAbility(ability: TriggeredAbility, cardName: string): string {
  if (isExaltedAbility(ability)) return 'Exalted';
  // The ability word, when the ability is the exact envelope that earns it.
  // `flurryRushRank` returns the printed number rather than a boolean, so the
  // line and the reminder are both derived from one recognizer and cannot
  // disagree about which rank the card has.
  const flurryRush = flurryRushRank(ability);
  if (flurryRush !== null) return `Flurry rush ${flurryRush}`;
  const gloom = gloomRank(ability);
  if (gloom !== null) return `Gloom ${gloom}`;
  const condition = TRIGGER_PRINT_TEMPLATES[ability.condition].replace('{name}', cardName);
  const [first, ...rest] = renderEffectList(ability.effects, cardName);
  const clause = ability.optional === true ? mayClause : asClause;
  const opening = first === undefined ? '' : clause(first, cardName);
  return [`${condition} ${opening}`, ...rest].join(' ');
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
function activationCostText(cost: ActivationCost, cardName: string): string {
  const parts: string[] = [];
  if (manaValue(cost.mana) > 0 || cost.mana.hasX) parts.push(formatManaCost(cost.mana));
  if (cost.tapSelf) parts.push('{T}');
  if (cost.sacrificeSelf) parts.push(`Sacrifice ${cardName}`);
  if (cost.sacrificeOther !== undefined) parts.push(sacrificeOtherText(cost.sacrificeOther));
  if (cost.discard !== undefined) parts.push(discardCostText(cost.discard));
  return parts.length === 0 ? formatManaCost(cost.mana) : parts.join(', ');
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

/**
 * `Discard a card`, `Discard two cards`.
 *
 * `sacrificeOtherText`'s pair one function up, over the one noun a discard cost
 * can name. The article for one rather than the numeral is the same rule, and
 * it is the rule `renderEffect`'s own `discardCards` arm follows, so the cost
 * clause and the effect sentence spell the same quantity the same way.
 */
function discardCostText(count: number): string {
  return count === 1 ? 'Discard a card' : `Discard ${numberWord(count)} cards`;
}

/**
 * The cost, a colon, then what it does.
 *
 * The effect sentences are the same ones a spell prints. Unlike a trigger's,
 * they are not lowercased: a colon ends the cost clause, and Magic starts a new
 * sentence after it ("{T}: Draw a card."), where a trigger's comma continues
 * one ("When Merfolk Sentry enters the battlefield, you gain 2 life.").
 */
function renderActivatedAbility(ability: ActivatedAbility, cardName: string): string {
  if (isAttachingAbility(ability)) return renderEquipAbility(ability, cardName);
  if (isRegenerationAbility(ability)) {
    return `${activationCostText(ability.cost, cardName)}: Regenerate this creature.`;
  }
  const body = renderEffectList(ability.effects, cardName).join(' ');
  if (ability.loyaltyCost !== undefined) return `[${loyaltyCostText(ability.loyaltyCost)}]: ${body}`;
  return `${activationCostText(ability.cost, cardName)}: ${body}`;
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
export function loyaltyCostText(loyaltyCost: number): string {
  if (loyaltyCost > 0) return `+${String(loyaltyCost)}`;
  if (loyaltyCost < 0) return `−${String(-loyaltyCost)}`;
  return '0';
}

/**
 * Magic's two printed lines for an Equipment, from the one ability that holds
 * both halves.
 *
 * A real card prints "Equipped creature gets +2/+0." as a static ability and
 * "Equip {2}" as an activated one, and the DSL prints exactly those two lines
 * even though one record carries them, because the card face is the contract
 * and a reader of the card should not be able to tell how the record is shaped
 * (`AttachSchema` argues why it is shaped that way). `renderOracleText` joins
 * abilities with a newline, so a two-line ability lands as two lines of the
 * text box with no special case there.
 *
 * The equip line carries no full stop, which is Magic's own templating for a
 * keyword ability with a cost, and the cost goes through `activationCostText`
 * like any other. `checkEquipAbility` refuses every cost but mana, so the
 * comma-separated form that helper can produce is unreachable from a legal
 * card and the line always reads `Equip {2}`.
 */
function renderEquipAbility(ability: AttachingAbility, cardName: string): string {
  const equipped: StaticSubject = { phrase: 'equipped creature', singular: true };
  const granted = modificationClause(equipped, verbObjectModifications(ability.attach.modifications));
  return `${granted}\nEquip ${activationCostText(ability.cost, cardName)}`;
}

/** One printed line for one CR 113 ability. `cardName` fills CARDNAME slots. */
export function renderAbility(ability: Ability, cardName: string): string {
  switch (ability.kind) {
    case 'static':
      return renderStaticAbility(ability, cardName);
    case 'triggered':
      return renderTriggeredAbility(ability, cardName);
    case 'activated':
      return renderActivatedAbility(ability, cardName);
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
  if (replacement.kind === 'entersTapped') return [plainRow(`${card.name} enters tapped.`)];
  const types = replacement.landTypes.map((type) => `${articleForWord(type)} ${type}`);
  return [plainRow(`${card.name} enters tapped unless you control ${types.join(' or ')}.`)];
}

/** Rows before multi-line abilities are split; see `oracleRows`. */
function abilityRows(card: Card): readonly OracleRow[] {
  if (card.kind === 'land') {
    const rows: OracleRow[] = [];
    // A land's text box starts with its keyword abilities, the way Darksteel
    // Citadel prints "Indestructible" above its mana ability. This branch used
    // to return before `keywordAbilityLines` was ever reached, which was
    // invisible while `checkKeywords` refused a keyword ability on any
    // noncreature; `mtg-rji` let one onto a land, and a dropped line here would
    // have been a card whose printed face disagreed with the kernel running it.
    rows.push(...keywordAbilityLines(card.keywordAbilities ?? []).map(plainRow));
    rows.push(...entryReplacementRows(card));
    if (card.producesMana.length > 0) {
      rows.push(plainRow(`{T}: Add ${card.producesMana.map((color) => `{${color}}`).join(' or ')}.`));
    }
    for (const ability of card.abilities) rows.push(abilityRow(ability, card.name));
    return rows;
  }
  const rows: OracleRow[] = [];
  if (isAuraCard(card)) rows.push(plainRow('Enchant creature'));
  if (card.keywords.length > 0) rows.push(plainRow(keywordRowText(card.keywords)));
  rows.push(...keywordAbilityLines(card.keywordAbilities ?? []).map(plainRow));
  // A nonland permanent's entry clause prints where a land's does, under the
  // keyword lines and above everything the permanent does once it is there:
  // "Coldsteel Heart enters tapped." is a fact about the arrival, and the
  // mana ability underneath it is what the arrival was paid for.
  rows.push(...entryReplacementRows(card));
  if (card.kind === 'creature' && card.characteristicPowerToughness !== undefined) {
    switch (card.characteristicPowerToughness.kind) {
      case 'creaturesYouControl':
        rows.push(
          plainRow(
            `${card.name}'s power and toughness are each equal to the number of creatures you control.`,
          ),
        );
        break;
      case 'controllerLifeTotal':
        rows.push(plainRow(`${card.name}'s power and toughness are each equal to your life total.`));
        break;
      default:
        assertNever(card.characteristicPowerToughness, 'oracleRows characteristic P/T');
    }
  }
  for (const ability of card.abilities) rows.push(abilityRow(ability, card.name));
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
  if (isAuraCard(card)) rows.push(plainRow(renderAuraModificationClause(card.aura.modifications)));
  if (card.modes !== undefined) {
    rows.push(...renderModesBlock(card.modes, card.name).map(plainRow));
  } else {
    const effectText = renderSpellParagraph(card);
    if (effectText.length > 0) rows.push(plainRow(effectText));
  }
  return rows;
}

function plainRow(text: string): OracleRow {
  return { loyaltyCost: null, text };
}

/**
 * One ability as a row. A loyalty ability keeps its cost in the badge column;
 * everything else prints its cost inside its own sentence, where Magic puts it.
 */
function abilityRow(ability: Ability, cardName: string): OracleRow {
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
      text: renderEffectList(ability.effects, cardName).join(' '),
    };
  }
  return plainRow(renderAbility(ability, cardName));
}

/**
 * An Equipment's one ability prints two lines; the second is a row of its own
 * and carries no badge, because a cost belongs to the row that states it.
 */
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
function renderSpellParagraph(card: Card): string {
  const sentences = renderEffectList(card.effects, card.name);
  const [first, ...rest] = sentences;
  if (first === undefined) return '';
  const clause = card.unless;
  const opening = clause === undefined ? first : withUnlessClause(first, clause);
  const offered = card.may === undefined ? opening : capitalize(mayClause(opening, card.name));
  return [offered, ...rest].join(' ');
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
export function renderEffectList(effects: readonly Effect[], cardName: string): readonly string[] {
  const named = new Set<string>();
  const handsShown = new Set<string>();
  return effects.map((effect) => {
    const key = hasTarget(effect) ? canonicalJson(effect.target) : '';
    const prior: PriorMention = {
      samePlayerNamed: key.length > 0 && named.has(key),
      handShown: key.length > 0 && handsShown.has(key),
    };
    const sentence = renderEffect(effect, cardName, prior);
    if (key.length > 0) {
      named.add(key);
      if (effect.kind === 'revealHand') handsShown.add(key);
    }
    return sentence;
  });
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
      default:
        assertNever(ability, 'keywordAbilityLines');
    }
  }
  if (protection.length > 0) {
    lines.push(`Protection from ${protection.map(protectionQualityPhrase).join(' and from ')}`);
  }
  return lines;
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
 * The token's card is the source, so the text on the token and the text the
 * creating card quotes are the same string produced by the same renderer.
 * `renderOracleText` separates a keyword line from an ability line with a
 * newline, which a quoted clause inside another card's sentence cannot carry,
 * so the lines are joined with a space here.
 */
export function renderTokenOracleText(token: TokenSpec): string {
  return renderOracleText(tokenCard(token)).split('\n').join(' ');
}

/** Returns a copy of the card with `oracleText` set to the rendered text. */
export function withRenderedOracleText<T extends Card>(card: T): T {
  return { ...card, oracleText: renderOracleText(card) };
}
