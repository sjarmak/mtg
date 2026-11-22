/**
 * The mapping tables: every pinned DSL vocabulary entry to its Forge form.
 *
 * Each table is typed as a total `Record` over a DSL vocabulary union, so
 * adding a keyword, effect or color to `@mtg/dsl` without deciding its Forge
 * form is a **compile error here**, not a runtime surprise downstream. The
 * runtime lookups still guard for `undefined` because unvalidated input (LLM
 * output, JSON on disk) can carry values the types promise are impossible.
 */
import type {
  BasicLandType,
  CardFilter,
  CardKind,
  Color,
  CounterKind,
  GraveyardChoiceDestination,
  GraveyardOwner,
  GrantableKeyword,
  Keyword,
  LibraryPosition,
  ManaColor,
  PlayerScope,
  Rarity,
  ReturnDestination,
  SearchDestination,
  SpaceScope,
  StaticScope,
  Supertype,
  TargetCombatRole,
  TargetedPlayerScope,
  TargetFilter,
  TargetKind,
  TargetRestriction,
  TriggerCondition,
} from '@mtg/dsl';
import { PERMANENT_CARD_KINDS, assertNever } from '@mtg/dsl';
import type { ForgeParam } from './script-text';

/** Forge `K:` keyword names (`res/cardsfolder`, e.g. Serra Angel's `K:Flying`). */
export const FORGE_KEYWORDS: Readonly<Record<Keyword, string>> = {
  flying: 'Flying',
  vigilance: 'Vigilance',
  haste: 'Haste',
  trample: 'Trample',
  deathtouch: 'Deathtouch',
  lifelink: 'Lifelink',
  menace: 'Menace',
  reach: 'Reach',
  firstStrike: 'First Strike',
};

/**
 * The same names plus every keyword ability a static may grant, for the one
 * caller that needs them: `AddKeyword$` on an `S:` line.
 *
 * Forge spells a granted keyword ability exactly as it spells a printed one —
 * `AddKeyword$ Indestructible` beside `K:Indestructible` — so the entries here
 * agree with `card-script.ts`'s `forgeKeywordAbility` by construction of the
 * word, not by a shared table: that function returns Forge's spelling for a
 * `KeywordAbility` *record*, payload and all ("Islandwalk", "Protection from
 * red"), and neither of those is a name `AddKeyword$` could take from an enum.
 * `forge-export`'s conformance suite is what holds both against 2.0.14's
 * `res/cardsfolder`.
 */
export const FORGE_GRANTABLE_KEYWORDS: Readonly<Record<GrantableKeyword, string>> = {
  ...FORGE_KEYWORDS,
  indestructible: 'Indestructible',
  doubleStrike: 'Double Strike',
  shroud: 'Shroud',
  hexproof: 'Hexproof',
  intimidate: 'Intimidate',
};

/**
 * The dotted qualifier Forge appends to a `ValidTgts$` selector for one target
 * restriction, or `null` when this vocabulary can say something Forge cannot.
 *
 * This table closes a hole rather than opening a door. `targetParams` built its
 * `ValidTgts$` from `FORGE_VALID_TARGETS[target.kind]` alone and never looked at
 * `target.restriction`, so a card reading "destroy target creature with power 3
 * or less" exported as "destroy target creature" — a strictly more permissive
 * card, written into the one artifact whose whole job is to disagree with us
 * when we are wrong. No committed card used a restriction, so nothing caught it.
 *
 * Every spelling here is read off 2.0.14's own `res/cardsfolder` rather than
 * guessed, with the count of shipped cards that write it:
 *
 *   powerLE3                   15    powerGE4                   33
 *   tapped                     63    untapped                    8
 *   withFlying                 75    withoutFlying              22
 *   withFirst Strike            3    withoutFirst Strike         2
 *   counters_GE1_M1M1           4    counters_GE1_P1P1          10
 *
 * `FORGE_KEYWORDS` supplies the keyword half, so `withFirst Strike` keeps the
 * space Forge writes and this table does not spell a keyword a second time.
 *
 * **The counter row is the one that diverges.** Forge has no counter named
 * `gloom`; `FORGE_COUNTER_TYPES` already records that a gloom counter *means*
 * an `M1M1` there, and that identity gap is stated on the application side.
 * Reading is the other side of the same gap and it is wider: `counters_GE1_M1M1`
 * admits a creature carrying a -1/-1 counter and no gloom counter, which is a
 * target the DSL card refuses. Emitting it anyway is the deliberate choice —
 * a Forge card that is legal on a superset makes the parity oracle report a
 * divergence out loud, where refusing the export makes the card vanish from the
 * boot leg and report nothing. The divergence is unreachable in any set that
 * mints no `minusOneMinusOne`, which is every set in this repo today.
 *
 * A counter whose Forge meaning is more than one counter (`horn` decomposes to
 * `P1P1` plus a keyword counter) or is nothing at all (`loyalty`) has no single
 * type for the selector to name, so it returns `null` and the caller rejects the
 * card. `counters_GE1_P1P1` for a horn counter would be a card that reads every
 * +1/+1 counter in the game, which is not a superset with a divergence in it —
 * it is a different card.
 */
export function forgeTargetRestriction(restriction: TargetRestriction): string | null {
  switch (restriction.kind) {
    case 'maxPower':
      return `powerLE${String(restriction.power)}`;
    case 'maxToughness':
      return `toughnessLE${String(restriction.toughness)}`;
    case 'minPower':
      return `powerGE${String(restriction.power)}`;
    case 'tapped':
      return 'tapped';
    case 'untapped':
      return 'untapped';
    case 'withKeyword':
      return `with${FORGE_KEYWORDS[restriction.keyword]}`;
    case 'withoutKeyword':
      return `without${FORGE_KEYWORDS[restriction.keyword]}`;
    case 'withCounter': {
      const decomposition = FORGE_COUNTER_TYPES[restriction.counter];
      if (decomposition === null || decomposition.length !== 1) return null;
      return `counters_GE1_${decomposition[0]}`;
    }
    case 'playerLostLifeThisTurn':
      return 'LostLifeThisTurn';
    default:
      return assertNever(restriction, 'forgeTargetRestriction');
  }
}

/**
 * A `ValidTgts$` selector with a restriction qualifier attached to every member.
 *
 * Forge separates the first qualifier from the card type with a dot and every
 * one after it with a plus (`Creature.YouCtrl+counters_GE1_P1P1`, five shipped
 * cards), so which separator to write is a question about the base and not about
 * the qualifier. A base that is a comma-separated union
 * (`Creature.attacking,Creature.blocking`) can carry neither at the end, because
 * a qualifier appended to the whole string binds to the last member only. Forge
 * writes it on each member instead: `res/cardsfolder/s/searing_light.txt` is
 * `ValidTgts$ Creature.attacking+powerLE2,Creature.blocking+powerLE2`, and the
 * same distribution ships as `+withFlying` (3 cards), `+OppCtrl` (3),
 * `+YouCtrl` (1), `+withoutFlying` (1) and
 * `Instant.YouCtrl+cmcEQX,Sorcery.YouCtrl+cmcEQX` (3). It is the distributive
 * law and nothing subtler — the qualifier is a conjunct over a disjunction of
 * members, so it belongs on each of them — which is why this is total and no
 * caller has a refusal to handle.
 *
 * Refusing the union instead is what this function did until `mtg-ds02`, and it
 * cost the flagship two commons: Light Arrow and Bomb Flower target an attacking
 * or blocking creature with a power bound, which is Searing Light's shape with a
 * different number on it.
 */
export function forgeRestrictedTarget(base: string, qualifier: string): string {
  return base
    .split(',')
    .map((member) => appendQualifier(member, qualifier))
    .join(',');
}

/**
 * Forge's two separators, applied to one union member.
 *
 * Split out of `forgeRestrictedTarget` rather than written twice because
 * `forgeFilteredTargets` builds its members by splitting a union on the comma
 * first, so it is already holding a single member when it needs the dot-or-plus
 * rule and would otherwise have to re-decide it. One implementation means the
 * restriction path and the filter path cannot come to different conclusions
 * about a base that already carries a qualifier.
 */
function appendQualifier(base: string, qualifier: string): string {
  return base.includes('.') ? `${base}+${qualifier}` : `${base}.${qualifier}`;
}

/**
 * Forge's color *properties*, which are not `FORGE_COLOR_WORDS`.
 *
 * That table is lowercase because a token script's `Colors:` line is lowercase;
 * a selector property is capitalized (`Creature.Black`, Doom Blade's
 * `Creature.nonBlack`). Two tables rather than a capitalization helper, because
 * they are two different grammars that happen to agree on five letters, and a
 * helper would hide the day one of them stops agreeing.
 */
export const FORGE_COLOR_PROPERTIES: Readonly<Record<Color, string>> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
};

/**
 * The selector alternatives one combat role expands to.
 *
 * `attackingOrBlocking` is two entries rather than one qualifier, because Forge
 * has no disjunction inside a selector: Divine Verdict is
 * `ValidTgts$ Creature.attacking,Creature.blocking` in `res/cardsfolder`, and
 * `Creature.attacking+blocking` would mean a creature doing both at once.
 * Unverified against a booted Forge, like every row in this file (`mtg-17a`).
 */
export const FORGE_COMBAT_ROLES: Readonly<Record<TargetCombatRole, readonly string[]>> = {
  attacking: ['attacking'],
  blocking: ['blocking'],
  attackingOrBlocking: ['attacking', 'blocking'],
};

/**
 * The `ValidTgts$` members one DSL target filter narrows a base selector to.
 *
 * A list rather than a string because the answer is a union: Forge joins whole
 * selectors with a comma and qualifiers with a plus, so two colors repeat the
 * base (`Permanent.Black,Permanent.Red`, Celestial Purge) and two exclusions do
 * not (`Creature.nonBlack+nonRed`). The DSL filter is a conjunction of four
 * dimensions, two of which hold alternatives, so this is a cross product and
 * the caller joins it.
 *
 * `cardTypes` says which side of the grammar the filter's card types land on,
 * and it is a parameter because the corpus writes them both ways. A permanent's
 * type *is* the base — Demolish is `ValidTgts$ Artifact,Land`, and
 * `Permanent.Artifact` appears nowhere — while a spell on the stack qualifies
 * `Card`, because `TargetType$ Spell` has already fixed the base and the type
 * is what remains to say (`Card.Creature`, Essence Scatter). Guessing one rule
 * for both would have written one of those two wrong.
 *
 * `subtypes` (`mtg-nhyv.56`) is spelled rather than refused, and the rule it is
 * spelled by is not a new one: `forgeSearchType`, thirty lines of this same
 * file down, already reads the corpus as "the base is the card type when one is
 * named and the subtype when none is, and when both are named the subtype is a
 * dotted qualifier". So a subtype arriving alone against the widest base swaps
 * it — `Permanent` becomes `Forest`, which is the same move the paragraph above
 * records for a card type, for the same corpus reason — and a subtype arriving
 * against any narrower base qualifies it, `Creature.Merfolk`. Both are shapes
 * this file already writes; neither is invented here, which is the whole test a
 * mapping has to pass before it is written instead of refused.
 *
 * The swap is confined to the exact token `Permanent` on purpose. It is the one
 * base that says nothing except "an object on the battlefield", so replacing it
 * with a subtype that CR 205.3 has already pinned to one card type drops no
 * constraint; `Creature.YouCtrl` would lose the half that says whose, and
 * appending is the only safe move there.
 *
 * Unverified against a booted Forge, like every mapping in this file
 * (`mtg-17a`).
 */
/**
 * The field that stops this filter from having a Forge selector, or `null` when
 * every field it states maps.
 *
 * Conjunctive card types remain refused rather than guessed. Keyword selectors
 * are mapped only because the pinned Forge corpus attests `withFlying` and
 * `withoutFlying`; selectors without that evidence still do not belong here.
 * A field rather than a boolean keeps the refusal reason available to callers.
 */
export function unmappedFilterField(filter: TargetFilter): 'allCardTypes' | null {
  if (filter.allCardTypes !== undefined) return 'allCardTypes';
  return null;
}

export function forgeFilteredTargets(
  base: string,
  filter: TargetFilter,
  cardTypes: 'base' | 'qualifier',
): readonly string[] | null {
  if (unmappedFilterField(filter) !== null) return null;
  const namesEveryPermanent =
    filter.cardTypes !== undefined &&
    filter.cardTypes.length === PERMANENT_CARD_KINDS.length &&
    PERMANENT_CARD_KINDS.every((kind) => filter.cardTypes?.includes(kind));
  const effectiveBase = namesEveryPermanent ? 'Permanent' : base;
  const named = namesEveryPermanent ? undefined : filter.cardTypes?.map((kind) => FORGE_CARD_TYPES[kind]);
  // A subtype with no card type beside it and nothing but `Permanent` to narrow
  // takes the base, the way a card type does; anywhere else it is a qualifier.
  // `checkFilterLists` refuses the two together (CR 205.3), so the first branch
  // is what a valid card reaches and the second is what a hand-written filter
  // and every narrower base reach.
  const subtypeBases = named === undefined && effectiveBase === 'Permanent' ? filter.subtypes : undefined;
  const bases =
    subtypeBases ?? (named !== undefined && cardTypes === 'base' ? named : effectiveBase.split(','));
  const typeQualifiers = named !== undefined && cardTypes === 'qualifier' ? named : [null];
  const subtypes = subtypeBases !== undefined ? [null] : (filter.subtypes ?? [null]);
  const colors = filter.colors?.map((color) => FORGE_COLOR_PROPERTIES[color]) ?? [null];
  const roles = filter.combat === undefined ? [null] : FORGE_COMBAT_ROLES[filter.combat];
  const keywordQualifiers = [
    ...(filter.monocolored === true ? ['MonoColor'] : []),
    ...(filter.maxManaValue === undefined ? [] : [`cmcLE${filter.maxManaValue}`]),
    ...(filter.dealtDamageThisTurn === true ? ['dealtDamageThisTurn'] : []),
    ...(filter.keywords ?? []).map((keyword) => `with${FORGE_KEYWORDS[keyword]}`),
    ...(filter.excludeKeywords ?? []).map((keyword) => `without${FORGE_KEYWORDS[keyword]}`),
  ];
  // The conjunctive half, in one order for every member: exclusions never
  // multiply the union, so they are appended rather than crossed.
  const refused = [
    ...(filter.excludeCardTypes ?? []).map((kind) => `non${FORGE_CARD_TYPES[kind]}`),
    ...(filter.excludeColors ?? []).map((color) => `non${FORGE_COLOR_PROPERTIES[color]}`),
  ];

  const members: string[] = [];
  for (const member of bases) {
    for (const type of typeQualifiers) {
      for (const subtype of subtypes) {
        for (const color of colors) {
          for (const role of roles) {
            const qualifiers = [type, subtype, color, role, ...keywordQualifiers, ...refused].filter(
              (word): word is string => word !== null,
            );
            members.push(qualifiers.length === 0 ? member : appendQualifier(member, qualifiers.join('+')));
          }
        }
      }
    }
  }
  return members;
}

/**
 * Forge `ValidTgts$` values. `noTarget` maps to no target clause at all —
 * the effect gets `Defined$ You` instead — so its entry is `null` rather than
 * a missing key, keeping the record total.
 */
export const FORGE_VALID_TARGETS: Readonly<Record<TargetKind, string | null>> = {
  anyTarget: 'Any',
  targetCreature: 'Creature',
  targetPlayer: 'Player',
  noTarget: null,
  // Forge restricts a target list with a dotted qualifier on the card type,
  // and `YouCtrl` is the one it writes for "you control" throughout
  // `res/cardsfolder`. Unverified against a booted Forge for the reason the
  // `S:` mapping and the trigger modes are: `mtg-17a` is that check.
  targetCreatureYouControl: 'Creature.YouCtrl',
  // Forge's own qualifier for the same restriction on the player list, written
  // `Player.Opponent` throughout `res/cardsfolder`. Unverified against a booted
  // Forge for the reason the row above is: `mtg-17a` is that check.
  targetOpponent: 'Player.Opponent',
  // Never read: `targetParams` answers this kind before it consults this table,
  // because a retained referent is `Defined$ TriggeredTarget` and not a
  // `ValidTgts$` clause at all. The row exists so the record stays total over
  // `TargetKind`, which is what makes a new kind a compile error.
  triggeringCreature: null,
  // Never read: the retained player compiles as `Defined$
  // TriggeredCardController`, not as a `ValidTgts$` choice.
  triggeringPlayer: null,
  // Fixed by `ChooseP` on this permanent's entry replacement.
  chosenPlayer: null,
  // Never read, for the same reason and by the same mechanism as the row
  // above: `targetParams` answers `selfCreature` before it reaches this table,
  // because the referent is `Defined$ Self` — Forge's generic "the source of
  // this ability" reference — and not a `ValidTgts$` clause. Unverified
  // against a booted Forge: `mtg-17a` is that check.
  selfCreature: null,
  // Never read, by the same mechanism as `selfCreature` above and through the
  // same branch: `targetParams` asks `isSourceBodyOnlyTarget` rather than
  // testing for one kind, so this member (`mtg-rji`) reached `Defined$ Self`
  // without a second branch. The row exists to keep the record total.
  selfPermanent: null,
  // Never read, by the same mechanism as the two rows above: `targetParams`
  // answers the back-references (`mtg-nhyv.75`) before it consults this
  // table, because Forge spells them `Defined$` too. `Targeted` for this kind
  // and for `thatPlayer` — one word there for both, since Forge's referent
  // carries no type — and `TargetedController` for the third. The rows exist to
  // keep the record total over `TargetKind`, which is what makes a kind added
  // later a compile error here rather than a silent `undefined`.
  thatCreature: null,
  thatPlayer: null,
  thatCreaturesController: null,
  thatPlayerOrPlaneswalkerController: null,
  // Never read: an Aura's live attachment is a retained referent, which
  // `targetParams` writes as `Defined$ Enchanted` before consulting this map.
  enchantedCreature: null,
  equippedCreature: null,
  // Forge's dotted qualifier for "controlled by the defending player" on an
  // attack trigger, written `DefenderCtrl` in `res/cardsfolder`. Unverified
  // against a booted Forge for the reason the two rows above are: `mtg-17a` is
  // that check. The DSL only ever prints this kind under a `selfAttacks`
  // trigger, which is the only context in which Forge's property has a referent
  // either, so the two restrictions line up rather than one covering the other.
  targetCreatureDefendingPlayerControls: 'Creature.DefenderCtrl',
  // A comma-separated selector rather than a dotted qualifier, because this row
  // is a union of two card types and not a restriction on one. Verified against
  // 2.0.14's own `res/cardsfolder` rather than guessed: 177 cards write
  // `ValidTgts$ Artifact,Enchantment`, including the two whose printed text is
  // verbatim what this kind prints —
  //
  //   Disenchant    A:SP$ Destroy    | ValidTgts$ Artifact,Enchantment
  //   Altar's Light A:SP$ ChangeZone | ValidTgts$ Artifact,Enchantment | Destination$ Exile
  //
  // so the destroy arm and the exile arm take the same selector. Two cards write
  // `Enchantment,Artifact`; the order is Forge's own preference and not a
  // difference in meaning.
  targetArtifactOrEnchantment: 'Artifact,Enchantment',
  // Vandalblast's shipped Forge script uses this exact selector for its
  // ordinary mode: `ValidTgts$ Artifact.YouDontCtrl`.
  targetArtifactYouDontControl: 'Artifact.YouDontCtrl',
  // The complement of `targetCreatureYouControl`, and Forge spells it as the
  // negation of the same qualifier: 158 cards write
  // `ValidTgts$ Creature.YouDontCtrl`, among them Affectionate Indrik, whose
  // printed text is verbatim what this kind prints under a `selfEnters` fight
  // trigger. Unverified against a booted Forge for the reason the rows above
  // are: `mtg-17a` is that check.
  targetCreatureYouDontControl: 'Creature.YouDontCtrl',
  // Mystifying Maze's upstream script uses this exact selector:
  // `ValidTgts$ Creature.attacking+OppCtrl` after the combat filter composes.
  targetCreatureOpponentControls: 'Creature.OppCtrl',
  targetNonlandPermanentOpponentControls: 'Permanent.nonLand+OppCtrl',
  // Rite of Undoing attests the wider multiplayer-safe controller qualifier:
  // `ValidTgts$ Permanent.YouDontCtrl+nonLand`.
  targetNonlandPermanentYouDontControl: 'Permanent.nonLand+YouDontCtrl',
  // Conjured Currency's shipped selector, including both independent
  // controller- and owner-relative restrictions.
  targetPermanentYouNeitherOwnNorControl: 'Permanent.YouDontCtrl+YouDontOwn',
  // The widest object base Forge has, and the one the DSL's `targetPermanent`
  // means: `ValidTgts$ Permanent` is what Vindicate and every other
  // destroy-anything spell writes, and a filter narrows it from there
  // (`Permanent.nonCreature` is Bramblecrush). Unverified against a booted
  // Forge for the reason every row above is: `mtg-17a` is that check.
  targetPermanent: 'Permanent',
  // A comma-separated union for `targetArtifactOrEnchantment`'s reason — two
  // spaces, not a restriction on one — and it is the union the damage spells of
  // this era write: Lava Axe reads "target player or planeswalker" and Forge
  // spells that `ValidTgts$ Player,Planeswalker`. Deliberately not `Any`, which
  // is the three-space selector that also admits a creature and would export a
  // strictly wider card than the one we print. Unverified against a booted
  // Forge: `mtg-17a` is that check.
  targetPlayerOrPlaneswalker: 'Player,Planeswalker',
  // Trading Post's shipped selector. `targetParams` composes any printed
  // filter before reattaching `YouCtrl`, so an artifact filter becomes
  // `Artifact.YouCtrl` rather than dropping the graveyard-owner qualifier.
  targetCardInYourGraveyard: 'Card.YouCtrl',
  // Rise from the Grave and Vile Rebirth use the unqualified selector because
  // either public graveyard may supply the targeted card.
  targetCardInAGraveyard: 'Card',
  targetCardInOpponentsGraveyard: 'Card.OppOwn',
};

/**
 * The Forge API a **scoped** zone move uses instead of its unscoped one.
 *
 * Forge splits single-object and mass zone movement into two APIs — `ChangeZone`
 * takes a target, `ChangeZoneAll` takes a `ChangeType$` predicate — so the DSL's
 * one primitive with an optional scope lands on two Forge abilities, and which
 * one is chosen is the scope rather than the effect kind.
 *
 * The other scoped primitives split the same way onto their own `…All` APIs
 * (`DamageAll`, `DestroyAll`, `PumpAll`, `TapAll`, `PutCounterAll`), named at
 * their rows in `effect-script.ts` beside the unscoped API they replace, the
 * way every other row names its API inline.
 */
export const FORGE_SCOPED_EFFECT_APIS: Readonly<Record<TargetedPlayerScope, string>> = {
  creaturesThatPlayerControls: 'ChangeZoneAll',
  creatureCardsInPlayerHand: 'ChangeZoneAll',
  creatureCardsInPlayerGraveyard: 'ChangeZoneAll',
};

/**
 * Which cards a scoped effect reaches, written `ChangeType$` by the zone-move
 * API and `ValidCards$` by the rest.
 *
 * Unqualified, because the ability carries its own `ValidTgts$` and Forge reads
 * the two together. This was `Creature.TargetedPlayerCtrl` and recorded as a
 * guess; 2.0.14's own `res/cardsfolder` settles it, and settles it the other
 * way. Four cards whose printed text is verbatim what the four sweepers print:
 *
 *   Mogg Infestation   SP$ DestroyAll | ValidTgts$ Player | ValidCards$ Creature
 *   Arms of Hadar      SP$ PumpAll    | ValidTgts$ Player | ValidCards$ Creature | NumAtt$ -2 | NumDef$ -2
 *   Dawnglare Invoker  AB$ TapAll     | ValidTgts$ Player | ValidCards$ Creature
 *   Aggravate          SP$ DamageAll  | ValidTgts$ Player | ValidCards$ Creature | NumDmg$ 1
 *
 * and the zone move reads the same, on the card that exiles a graveyard:
 * `SP$ ChangeZoneAll | ValidTgts$ Player | ChangeType$ Creature | Origin$
 * Graveyard | Destination$ Exile`.
 *
 * `TargetedPlayerCtrl` is a real property (116 lines use it) and it is for the
 * *other* arrangement: a sub-ability reading a target some earlier ability in
 * the chain chose, as `AllValid$ Creature.TargetedPlayerCtrl` does on the
 * planeswalker ultimate that steals a player's creatures. This transpiler
 * writes each effect with its own target slot, so it is always the first
 * arrangement and never the second.
 *
 * Read off `res/cardsfolder`, not off a booted Forge, which is the standing
 * limit on every row in this file — but read off cards whose oracle line is the
 * sentence being compiled, which is as close as this checkout gets.
 */
export const FORGE_SCOPE_CHANGE_TYPES: Readonly<Record<TargetedPlayerScope, string>> = {
  creaturesThatPlayerControls: 'Creature',
  creatureCardsInPlayerHand: 'Creature',
  creatureCardsInPlayerGraveyard: 'Creature',
};

/**
 * Which zone a scoped move reads from, which Forge writes as `Origin$` and the
 * DSL folds into the scope word.
 */
export const FORGE_SCOPE_ORIGINS: Readonly<Record<TargetedPlayerScope, string>> = {
  creaturesThatPlayerControls: 'Battlefield',
  creatureCardsInPlayerHand: 'Hand',
  creatureCardsInPlayerGraveyard: 'Graveyard',
};

/**
 * The `Defined$` selector an untargeted **player** sweep writes.
 *
 * Forge's `Defined$` is a definition selector rather than a parameter of one
 * API, so the same two words work on `Draw`, `LoseLife` and `Discard` alike:
 * `Defined$ Player` is every player at the table (how the corpus scripts Temple
 * Bell and Howling Banshee) and `Defined$ Player.Opponent` is everyone but the
 * resolving controller (how current Blood Tithe and Sizzle are scripted).
 * Neither is a target,
 * which is the whole reason the sweep replaces the target clause instead of
 * qualifying it — the `noTarget` slot beside it would otherwise write
 * `Defined$ You` and reach one seat, the wrong one.
 */
export const FORGE_PLAYER_SCOPE_DEFINED: Readonly<Record<PlayerScope, string>> = {
  eachPlayer: 'Player',
  eachOpponent: 'Player.Opponent',
};

/**
 * The controller qualifier a **space** scope adds to its selector, or `null`
 * when it names the whole board.
 *
 * Forge writes the side of the board as a property on the selector rather than
 * as a parameter of its own, so this is a suffix and not a row: `YouCtrl` and
 * `OppCtrl` are the two the corpus uses (`Creature.YouCtrl` on 666 lines,
 * `Creature.OppCtrl` on 90), and a sweep of everything simply omits it.
 * `allPermanents` is `null` rather than an empty string so that appending is a
 * decision the caller has to make rather than a concatenation that silently
 * produces a trailing dot.
 */
export const FORGE_SPACE_SCOPE_CONTROLLERS: Readonly<Record<SpaceScope, string | null>> = {
  allPermanents: null,
  permanentsYouControl: 'YouCtrl',
  permanentsOpponentsControl: 'OppCtrl',
};

/**
 * The `ValidCards$` selector an untargeted sweep writes.
 *
 * The scope says which side and the filter says which permanents, and Forge
 * writes both into the one selector — so this is `forgeFilteredTargets` over a
 * `Permanent` base with the side appended to each member of the union. Every
 * sweeper in the M11/M13 census comes out as the string its own card carries in
 * `res/cardsfolder`:
 *
 *   Day of Judgment   DestroyAll | ValidCards$ Creature
 *   Back to Nature    DestroyAll | ValidCards$ Enchantment
 *   Planar Cleansing  DestroyAll | ValidCards$ Permanent.nonLand
 *   Pyroclasm         DamageAll  | ValidCards$ Creature          | NumDmg$ 2
 *   Rain of Blades    DamageAll  | ValidCards$ Creature.attacking | NumDmg$ 1
 *   Trumpet Blast     PumpAll    | ValidCards$ Creature.attacking | NumAtt$ +2
 *   Glorious Charge   PumpAll    | ValidCards$ Creature.YouCtrl   | NumAtt$ +1 | NumDef$ +1
 *   Cower in Fear     PumpAll    | ValidCards$ Creature.OppCtrl   | NumAtt$ -1 | NumDef$ -1
 *
 * None of the eight carries a `ValidTgts$`, which is the difference from
 * `FORGE_SCOPE_CHANGE_TYPES` above and the reason the caller drops the target
 * clause rather than passing `Defined$ You` alongside: a Forge ability with a
 * target chooses one, and these choose nothing.
 *
 * The qualifier order — `Creature.attacking+YouCtrl` when a sweep has both — is
 * `appendQualifier`'s, and the corpus attests it on 11 lines.
 *
 * Read off `res/cardsfolder`, not off a booted Forge: the standing limit on
 * every mapping in this file (`mtg-17a`).
 */
export function forgeSweepSelector(scope: SpaceScope, filter: TargetFilter): string | null {
  const side = FORGE_SPACE_SCOPE_CONTROLLERS[scope];
  const members = forgeFilteredTargets('Permanent', filter, 'base');
  if (members === null) return null;
  return (side === null ? members : members.map((member) => appendQualifier(member, side))).join(',');
}

/**
 * Forge trigger-mode parameters per DSL condition, before `Execute$` and
 * `TriggerDescription$` are appended.
 *
 * Forge writes a triggered ability as one `T:Mode$ … | Execute$ SVarName` line
 * plus an `SVar:` holding the sub-ability, which is the shape every
 * enters-the-battlefield and attack trigger in `res/cardsfolder` uses. The
 * The self-zone DSL conditions compile onto exactly that grammar:
 * "enters" and "dies" are both `ChangesZone` with different endpoints, and
 * "attacks" is `Attacks`; `Card.Self` is Forge's word for the source.
 *
 * Unverified against a booted Forge, exactly as the `S:` mapping is. `mtg-17a`
 * is that check and it is blocked on the Forge harness; this table extends what
 * that bead has to verify rather than adding a second unverified claim in a
 * different place.
 */
export const FORGE_TRIGGER_MODES: Readonly<Record<TriggerCondition, readonly ForgeParam[]>> = {
  selfEnters: [
    ['Mode', 'ChangesZone'],
    ['Origin', 'Any'],
    ['Destination', 'Battlefield'],
    ['ValidCard', 'Card.Self'],
  ],
  selfAttacks: [
    ['Mode', 'Attacks'],
    ['ValidCard', 'Card.Self'],
  ],
  selfDies: [
    ['Mode', 'ChangesZone'],
    ['Origin', 'Battlefield'],
    ['Destination', 'Graveyard'],
    ['ValidCard', 'Card.Self'],
  ],
  selfIsDealtDamage: [
    ['Mode', 'DamageDoneOnce'],
    ['ValidTarget', 'Card.Self'],
    ['TriggerZones', 'Battlefield'],
  ],
  selfLeavesBattlefield: [
    ['Mode', 'ChangesZone'],
    ['Origin', 'Battlefield'],
    ['Destination', 'Any'],
    ['ValidCard', 'Card.Self'],
  ],
  selfPutIntoGraveyardFromBattlefield: [
    ['Mode', 'ChangesZone'],
    ['Origin', 'Battlefield'],
    ['Destination', 'Graveyard'],
    ['ValidCard', 'Card.Self'],
  ],
  selfPutIntoGraveyardFromAnywhere: [
    ['Mode', 'ChangesZone'],
    ['Origin', 'Any'],
    ['Destination', 'Graveyard'],
    ['ValidCard', 'Card.Self'],
  ],
  anotherCreatureEnters: [
    ['Mode', 'ChangesZone'],
    ['Origin', 'Any'],
    ['Destination', 'Battlefield'],
    ['ValidCard', 'Creature.Other'],
    ['TriggerZones', 'Battlefield'],
  ],
  controlledCreatureDies: [
    ['Mode', 'ChangesZone'],
    ['Origin', 'Battlefield'],
    ['Destination', 'Graveyard'],
    ['ValidCard', 'Creature.YouCtrl'],
    ['TriggerZones', 'Battlefield'],
  ],
  // Veilborn Ghoul's shipped Forge row uses `Swamp.YouCtrl`; the ability
  // writer replaces the generic land selector below with the authored basic
  // land subtype and places a graveyard source in `TriggerZones$ Graveyard`.
  controlledLandSubtypeEnters: [
    ['Mode', 'ChangesZone'],
    ['Origin', 'Any'],
    ['Destination', 'Battlefield'],
    ['ValidCard', 'Land.YouCtrl'],
    ['TriggerZones', 'Battlefield'],
  ],
  enchantedCreatureDies: [
    ['Mode', 'ChangesZone'],
    ['Origin', 'Battlefield'],
    ['Destination', 'Graveyard'],
    ['ValidCard', 'Card.EnchantedBy'],
  ],
  enchantedLandBecomesTapped: [
    ['Mode', 'Taps'],
    ['ValidCard', 'Card.AttachedBy'],
    ['TriggerZones', 'Battlefield'],
  ],
  // Phantom Beast's current source line in Card-Forge/forge. `ValidTarget`
  // names the object that was aimed at (not the spell doing the aiming), and
  // the explicit zone keeps the source-bound trigger on the battlefield just
  // as the kernel does.
  selfBecomesTarget: [
    ['Mode', 'BecomesTarget'],
    ['ValidTarget', 'Card.Self'],
    ['TriggerZones', 'Battlefield'],
  ],
  selfBecomesTargetByOpponent: [
    ['Mode', 'BecomesTarget'],
    ['ValidSource', 'SpellAbility.OppCtrl'],
    ['ValidTarget', 'Card.Self'],
    ['TriggerZones', 'Battlefield'],
  ],
  controlledCreatureAttacksAlone: [
    ['Mode', 'Attacks'],
    ['ValidCard', 'Creature.YouCtrl'],
    ['Alone', 'True'],
    ['TriggerZones', 'Battlefield'],
  ],
  selfAttacksAlone: [
    ['Mode', 'Attacks'],
    ['ValidCard', 'Card.Self'],
    ['Alone', 'True'],
  ],
  selfAndThreeOthersAttack: [
    ['Mode', 'Attacks'],
    ['ValidCard', 'Card.Self'],
    ['TriggerZones', 'Battlefield'],
    ['IsPresent', 'Creature.attacking+Other'],
    ['PresentCompare', 'GE3'],
    ['NoResolvingCheck', 'True'],
  ],
  creatureAttacksYouOrPlaneswalkerYouControl: [
    ['Mode', 'Attacks'],
    ['ValidCard', 'Creature.YouDontCtrl'],
    ['Attacked', 'You,Planeswalker.YouCtrl'],
    ['TriggerZones', 'Battlefield'],
  ],
  // `selfDies` plus Forge's own negative sacrifice property. Forge writes the
  // restriction as a `+`-joined qualifier on `ValidCard$`, the same grammar the
  // static `Affected$` rows use, and `wasNotSacrificed` is the spelling
  // `res/cardsfolder` appears to use for CR 701.17b. **Unverified against a
  // booted Forge**, for the reason every other guess in this file is: the
  // 2.0.14 installer under `tools/forge/` is a gitignored local artifact, and
  // `mtg-17a` is the bead that checks all of them at once. This row is the one
  // where a wrong guess is silently permissive rather than a parse error — a
  // Forge that ignores an unknown qualifier would run the trigger on a
  // sacrifice — so it is worth checking before this row is trusted.
  selfDiesNotSacrificed: [
    ['Mode', 'ChangesZone'],
    ['Origin', 'Battlefield'],
    ['Destination', 'Graveyard'],
    ['ValidCard', 'Card.Self+wasNotSacrificed'],
  ],
  // Forge's `DamageDone` mode, narrowed the way `res/cardsfolder`'s combat
  // damage triggers narrow it: the source is this card, the damaged object is a
  // creature, and `CombatDamage$ True` is what excludes a burn spell. **Unverified
  // against a booted Forge**, for the reason every other guess in this file is,
  // and `mtg-17a` is the bead that checks them together. `TriggeredTarget` is
  // the name this mode gives the damaged creature, and it is what the payload's
  // `triggeringCreature` target compiles to.
  selfDealsCombatDamageToCreature: [
    ['Mode', 'DamageDone'],
    ['ValidSource', 'Card.Self'],
    ['ValidTarget', 'Creature'],
    ['CombatDamage', 'True'],
  ],
  // The nine rows below are `mtg-suy7`'s, guessed against the same
  // `res/cardsfolder` shapes the six above were and carrying the identical
  // caveat: **unverified against a booted Forge**, folded into `mtg-17a`
  // rather than opening a second bead for it. `Phase`, `SpellCast`, `Blocks`
  // and `LifeGained` are modes distinct from the six above, so none of them
  // could have been caught by the checks that already exist for
  // `ChangesZone`, `Attacks` or `DamageDone`.
  beginningOfYourUpkeep: [
    ['Mode', 'Phase'],
    ['Phase', 'Upkeep'],
    ['ValidPlayer', 'You'],
    ['TriggerZones', 'Battlefield'],
  ],
  // Wild Evocation's current Forge source. `Player` is the unfiltered seat
  // selector and supplies `TriggeredPlayer` to the payload.
  beginningOfEachPlayersUpkeep: [
    ['Mode', 'Phase'],
    ['Phase', 'Upkeep'],
    ['ValidPlayer', 'Player'],
    ['TriggerZones', 'Battlefield'],
  ],
  beginningOfYourEndStep: [
    ['Mode', 'Phase'],
    ['Phase', 'End of Turn'],
    ['ValidPlayer', 'You'],
  ],
  // Arc Runner's and Ball Lightning's trigger line, read off
  // `res/cardsfolder`: `T:Mode$ Phase | Phase$ End of Turn | TriggerZones$
  // Battlefield`. The absence of `ValidPlayer` is the whole difference from
  // the row above and it is deliberate -- this condition is "the end step",
  // any player's, and adding a player filter here would silently narrow it to
  // its controller's.
  beginningOfEndStep: [
    ['Mode', 'Phase'],
    ['Phase', 'End of Turn'],
  ],
  // `+Other` is the exclusion `res/cardsfolder` appears to use to keep a
  // trigger from firing on its own source's arrival; without it this row
  // would be indistinguishable from `selfEnters` plus a controller filter.
  anotherControlledPermanentEnters: [
    ['Mode', 'ChangesZone'],
    ['Origin', 'Any'],
    ['Destination', 'Battlefield'],
    ['ValidCard', 'Card.YouCtrl+Other'],
  ],
  // Leyline of Vitality's current Forge source, including the explicit
  // battlefield trigger zone. Unlike the sibling below, this has no `+Other`:
  // a creature source with this wording also sees its own arrival.
  controlledCreatureEnters: [
    ['Mode', 'ChangesZone'],
    ['Origin', 'Any'],
    ['Destination', 'Battlefield'],
    ['ValidCard', 'Creature.YouCtrl'],
    ['TriggerZones', 'Battlefield'],
  ],
  anotherControlledCreatureEnters: [
    ['Mode', 'ChangesZone'],
    ['Origin', 'Any'],
    ['Destination', 'Battlefield'],
    ['ValidCard', 'Creature.YouCtrl+Other'],
    ['TriggerZones', 'Battlefield'],
  ],
  youCastSpell: [
    ['Mode', 'SpellCast'],
    ['ValidCard', 'Card.YouCtrl'],
  ],
  // Guttersnipe's installed 2.0.14 line: one OR-separated card-type filter,
  // with the casting player and battlefield trigger zone stated separately.
  youCastInstantOrSorcery: [
    ['Mode', 'SpellCast'],
    ['ValidCard', 'Instant,Sorcery'],
    ['ValidActivatingPlayer', 'You'],
    ['TriggerZones', 'Battlefield'],
  ],
  selfDealsCombatDamageToPlayer: [
    ['Mode', 'DamageDone'],
    ['ValidSource', 'Card.Self'],
    ['ValidTarget', 'Player'],
    ['CombatDamage', 'True'],
    ['TriggerZones', 'Battlefield'],
  ],
  controlledCreatureDealsCombatDamageToPlayer: [
    ['Mode', 'DamageDone'],
    ['ValidSource', 'Creature.YouCtrl'],
    ['ValidTarget', 'Player'],
    ['TriggerZones', 'Battlefield'],
    ['CombatDamage', 'True'],
  ],
  selfBlocks: [
    ['Mode', 'Blocks'],
    ['ValidCard', 'Card.Self'],
  ],
  enchantedCreatureAttacksOrBlocks: [
    ['Mode', 'Attacks'],
    ['ValidCard', 'Card.AttachedBy'],
  ],
  enchantedCreatureBecomesTarget: [
    ['Mode', 'BecomesTarget'],
    ['ValidTarget', 'Card.AttachedBy'],
    ['TriggerZones', 'Battlefield'],
  ],
  // Wall of Frost's current Forge source, verbatim. `AttackerBlocked` is the
  // pair-shaped event and names the attacker as `TriggeredAttackerLKICopy` for
  // the effect body; `ValidBlocker` confines the source side of that pairing.
  selfBlocksCreature: [
    ['Mode', 'AttackerBlocked'],
    ['ValidBlocker', 'Card.Self'],
  ],
  youGainLife: [
    ['Mode', 'LifeGained'],
    ['ValidPlayer', 'You'],
  ],
  // Jace's Erasure's current Card-Forge/forge source. `ValidCard` is Forge's
  // field name for the drawn object here; `Card.YouCtrl` is its source-relative
  // spelling, and the explicit zone confines the watcher to the battlefield.
  youDrawCard: [
    ['Mode', 'Drawn'],
    ['ValidCard', 'Card.YouCtrl'],
    ['TriggerZones', 'Battlefield'],
  ],
  // Flurry rush's condition, and the blocking half of it. Arrogant Bloodlord is
  // the template and it is the same printed sentence with a different
  // comparator — "Whenever CARDNAME blocks or becomes blocked by a creature
  // with power 1 or less" — spelled as two `AttackerBlockedByCreature` lines
  // that differ only in which side of the pairing `Card.Self` sits on:
  //
  //   T:Mode$ AttackerBlockedByCreature | ValidCard$ Creature.powerLE1 | ValidBlocker$ Card.Self | …
  //   T:Mode$ AttackerBlockedByCreature | ValidCard$ Card.Self | ValidBlocker$ Creature.powerLE1 | … | Secondary$ True | …
  //
  // This row is the first of those and `FORGE_ADDITIONAL_TRIGGER_MODES` carries
  // the second. `AttackerBlockedByCreature` fires once per blocking creature,
  // which is the condition's own "one trigger per qualifying creature, not per
  // block"; `AttackerBlocked` beside it in the corpus fires once per block with
  // every blocker at hand, and would give a double block by two larger
  // creatures one trigger instead of two.
  //
  // `powerGTZ` is the comparison, over `SVar:Z:Count$CardPower` in
  // `FORGE_TRIGGER_SUPPORTING_LINES`: `Count$CardPower` is the source's own
  // power, so `Creature.powerGTZ` on the *other* slot is "a creature whose
  // power is greater than this card's". Rangers of Ithilien writes that pair
  // verbatim at the other comparator (`Creature.powerLTZ` over
  // `SVar:Z:Count$CardPower`), Drizzt Do'Urden and Éowyn write `powerGTX` in a
  // trigger's and a spell's `Valid` clause over `SVar:X:Count$CardPower`, and
  // Ant-Man writes `Creature.powerGTX` in a blocker slot. `Z` rather than `X`
  // or `Y` because those two are already this transpiler's resolution count and
  // board count (`remember.ts`, `board-count.ts`), and Gyrus reaches for `Z`
  // on exactly that ground — its own `X` and `Y` are taken.
  //
  // What this row said before `mtg-uisd` was that Forge's grammar could not
  // state the union at all: `Blocks` covers only the half where the source
  // blocks, the other half is a mode called `BlockedBy`, one `ForgeParam` row
  // is one mode, and a power comparison against the source has no spelling.
  // Every clause of that is wrong. There is no `BlockedBy` mode in the corpus;
  // `FORGE_ADDITIONAL_TRIGGER_MODES` had been emitting second `T:` lines since
  // `selfEntersOrAttacks`; and the comparison is 176 files deep. What the row
  // actually exported was `Mode$ Blocks | ValidCard$ Card.Self` with the body
  // aimed at `TriggeredTarget` — a card that fires on *every* block rather than
  // only on blocks against something bigger, that never fires on the attacking
  // half, and that names a referent `Blocks` does not supply. Wider, narrower
  // and misaimed at once, with nothing on stdout to say so.
  //
  // Unverified against a booted Forge, like every row in this file, and
  // `mtg-17a` is that check. What is different here is the evidence class: the
  // shape is not reasoned from Forge's API list but read off four shipped cards
  // (Arrogant Bloodlord, Ashmouth Hound, Shape Stealer, No Quarter) that print
  // this pairing, and the two referent names below are read off the same ones.
  selfBlocksOrIsBlockedByGreaterPower: [
    ['Mode', 'AttackerBlockedByCreature'],
    ['ValidCard', 'Creature.powerGTZ'],
    ['ValidBlocker', 'Card.Self'],
  ],
  // The primary half of the two-event condition. The attack half lives in
  // `FORGE_ADDITIONAL_TRIGGER_MODES`, because Forge represents the union as two
  // `T:` lines that execute the same body.
  selfEntersOrAttacks: [
    ['Mode', 'ChangesZone'],
    ['Origin', 'Any'],
    ['Destination', 'Battlefield'],
    ['ValidCard', 'Card.Self'],
  ],
  // The M11 artifact cycle, and the one group of rows in this file that fits
  // Forge's grammar without a guess about shape. `SpellCast` carries
  // `ValidCard$`, and a color is an ordinary card property there, so
  // `Card.White` is the whole restriction; no `ValidActivator$` is written,
  // because the printed line says "a player" and an unrestricted `SpellCast`
  // already watches both seats. Still unverified against a booted Forge, like
  // every other row here: `mtg-17a` is that check.
  aPlayerCastsWhiteSpell: [
    ['Mode', 'SpellCast'],
    ['ValidCard', 'Card.White'],
  ],
  aPlayerCastsBlueSpell: [
    ['Mode', 'SpellCast'],
    ['ValidCard', 'Card.Blue'],
  ],
  aPlayerCastsBlackSpell: [
    ['Mode', 'SpellCast'],
    ['ValidCard', 'Card.Black'],
  ],
  aPlayerCastsRedSpell: [
    ['Mode', 'SpellCast'],
    ['ValidCard', 'Card.Red'],
  ],
  aPlayerCastsGreenSpell: [
    ['Mode', 'SpellCast'],
    ['ValidCard', 'Card.Green'],
  ],
  // `DamageDone` with the combat half turned off and the recipient restricted
  // to an opposing player. Forge spells the negation as `CombatDamage$ False`
  // rather than by omitting the parameter, because an absent `CombatDamage$`
  // in `res/cardsfolder` means "either", which would be the wider card.
  opponentDealtNoncombatDamage: [
    ['Mode', 'DamageDone'],
    ['ValidTarget', 'Opponent'],
    ['CombatDamage', 'False'],
  ],
  // `anotherControlledCreatureEnters` plus the power constant, which is the one
  // comparison Forge's card properties do express: `powerGE3` compares to a
  // literal, and this condition names a literal. Contrast
  // `selfBlocksOrIsBlockedByGreaterPower` above, which compares to the source's
  // own power and therefore has no property at all.
  anotherControlledCreatureWithPowerThreeOrGreaterEnters: [
    ['Mode', 'ChangesZone'],
    ['Origin', 'Any'],
    ['Destination', 'Battlefield'],
    ['ValidCard', 'Creature.YouCtrl+Other+powerGE3'],
  ],
  opponentDiscardsCard: [
    ['Mode', 'Discarded'],
    ['ValidCard', 'Card.OppOwn'],
    ['TriggerZones', 'Battlefield'],
  ],
  selfPlusOnePlusOneCounterRemoved: [
    ['Mode', 'CounterRemoved'],
    ['ValidCard', 'Card.Self'],
    ['TriggerZones', 'Battlefield'],
    ['CounterType', 'P1P1'],
  ],
};

/** Extra `T:` modes for a DSL condition that is a union of Forge events. */
export const FORGE_ADDITIONAL_TRIGGER_MODES: Readonly<
  Partial<Record<TriggerCondition, readonly (readonly ForgeParam[])[]>>
> = {
  selfEntersOrAttacks: [
    [
      ['Mode', 'Attacks'],
      ['ValidCard', 'Card.Self'],
      ['Secondary', 'True'],
    ],
  ],
  enchantedCreatureAttacksOrBlocks: [
    [
      ['Mode', 'Blocks'],
      ['ValidCard', 'Card.AttachedBy'],
      ['Secondary', 'True'],
    ],
  ],
  // The half where the source is the attacker and something bigger blocked it.
  // Arrogant Bloodlord's second line with the comparator swapped: same mode,
  // the two slots exchanged, `Secondary$ True` because both lines carry the one
  // printed description. Unlike the two entries above it this half retains a
  // *different* referent from the first — the blocker rather than the attacker
  // — which is what `FORGE_TRIGGERING_CREATURE_REFERENTS` exists to say.
  selfBlocksOrIsBlockedByGreaterPower: [
    [
      ['Mode', 'AttackerBlockedByCreature'],
      ['ValidCard', 'Card.Self'],
      ['ValidBlocker', 'Creature.powerGTZ'],
      ['Secondary', 'True'],
    ],
  ],
};

/**
 * What a trigger's `triggeringCreature` target compiles to, per emitted `T:`
 * line, for the conditions where Forge's name for the referent is not its
 * default `TriggeredTarget`.
 *
 * Entry `n` names the referent for the `n`th `T:` line the condition emits, so
 * a condition whose two lines retain two different creatures says so here
 * rather than in the effect compiler. `selfBlocksOrIsBlockedByGreaterPower` is
 * the only such condition and it is the reason this table is a list: its first
 * line puts the source in the blocker slot and retains the attacker, its second
 * puts the source in the attacker slot and retains the blocker, and one shared
 * body would aim both at whichever creature the first line names. Ashmouth
 * Hound is the shipped card that shows the two names on this exact pair of
 * lines, and No Quarter shows them on a pair whose two halves genuinely differ.
 *
 * A condition absent from this table compiles `triggeringCreature` to
 * `TriggeredTarget`, which is what `DamageDone` and the other supported modes
 * supply.
 */
export const FORGE_TRIGGERING_CREATURE_REFERENTS: Readonly<
  Partial<Record<TriggerCondition, readonly string[]>>
> = {
  // Wall of Frost's shipped script: `AttackerBlocked` names its paired attacker
  // `TriggeredAttackerLKICopy`. One line, one referent.
  selfBlocksCreature: ['TriggeredAttackerLKICopy'],
  controlledCreatureDealsCombatDamageToPlayer: ['TriggeredSourceLKICopy'],
  selfBlocksOrIsBlockedByGreaterPower: ['TriggeredAttackerLKICopy', 'TriggeredBlockerLKICopy'],
};

/** Source-level declarations required by a trigger mode beyond its `T:` line. */
export const FORGE_TRIGGER_SUPPORTING_LINES: Readonly<Partial<Record<TriggerCondition, readonly string[]>>> =
  {
    // Present on Wall of Frost's shipped script and used by Forge's combat AI to
    // recognize that declaring this blocker has an immediate triggered effect.
    selfBlocksCreature: ['SVar:HasBlockEffect:TRUE'],
    // The source's own power, which both of this condition's `T:` lines compare
    // the other creature against. `Z` and not `X` or `Y` for `board-count.ts`'s
    // stated reason — those two are taken by the resolution count and the board
    // count, and a card may print any pair of the three — and Gyrus, Waker of
    // Corpses picks `Z` on that same ground. No `SVar:HasBlockEffect:TRUE`
    // here: one of the 67 `AttackerBlockedByCreature` scripts in the corpus
    // carries it and none of the four this row is modeled on do.
    selfBlocksOrIsBlockedByGreaterPower: ['SVar:Z:Count$CardPower'],
  };

/**
 * Forge `Affected$` restriction per DSL static scope, before a subtype narrows
 * it further.
 *
 * Forge writes a static ability as one `S:Mode$ Continuous | …` line whose
 * `Affected$` value is a card-type word plus `+`-joined restrictions, which is
 * the shape every lord in `res/cardsfolder` uses (Lord of Atlantis is
 * `Affected$ Creature.Merfolk+Other`, Glorious Anthem is
 * `Affected$ Creature.YouCtrl`). The DSL's three scopes were chosen to compile
 * onto exactly that grammar, so this table is a rename rather than a
 * translation.
 *
 * **Unverified against a booted Forge.** The 2.0.14 installer under
 * `tools/forge/` is a gitignored local artifact, so `res/cardsfolder` can be
 * read here and is what the two cards above are read off; what nobody has run
 * is a game. These lines are therefore a claim about Forge's script grammar and
 * not a measurement of how it resolves. The alternative was an
 * `UNMAPPED_ABILITY_KIND` rejection, which would have left the parity oracle
 * blind to exactly the construct the epic exists to add; a wrong line here
 * fails loudly at Forge's own parser instead of silently dropping the ability,
 * which is the failure mode `rejection.ts` refuses.
 *
 * Tracked as `mtg-17a`, whose subject is this table by name, and which is
 * blocked by `mtg-bc2.41`'s parity harness.
 */
export const FORGE_STATIC_AFFECTED: Readonly<Record<StaticScope, string>> = {
  self: 'Card.Self',
  creaturesYouControl: 'Creature.YouCtrl',
  otherCreaturesYouControl: 'Creature.Other+YouCtrl',
};

/**
 * Forge's `Affected$` restriction for the creature an Equipment is attached to.
 *
 * Not a member of the table above, because it is not a DSL static scope:
 * `STATIC_SCOPES` has no "equipped creature" and `AttachSchema` argues why —
 * the scope would be unusable without an equip ability, so the modification
 * rides on the equip clause instead. The word is the one Forge 2.0.14 uses for
 * it: `Bonesplitter` is `S:Mode$ Continuous | Affected$ Creature.EquippedBy |
 * AddPower$ 2`, and 537 lines in `res/cardsfolder` carry the same restriction.
 *
 * Unverified against a booted Forge, exactly as the rest of this mapping is.
 * `mtg-17a` is the check and it is blocked on the Forge harness.
 */
export const FORGE_EQUIPPED_AFFECTED = 'Creature.EquippedBy';

/** Forge color words, used by token scripts' `Colors:` line. */
export const FORGE_COLOR_WORDS: Readonly<Record<Color, string>> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
};

/**
 * Forge's `Produced$` token for each mana a source can add.
 *
 * Six rows that each map a letter to the same letter, and that is the point:
 * `Produced$ G` is Forge's own spelling and `Produced$ C` is how the corpus
 * writes colorless (Sol Ring: `A:AB$ Mana | Cost$ T | Produced$ C |
 * Amount$ 2`), so the mapping is the identity today. Written as a total
 * `Record` anyway, for this file's stated reason: a mana color added to
 * `@mtg/dsl` without a decided Forge form becomes a compile error here rather
 * than a silently dropped pip in an exported set. A table whose current answer
 * is easy is still the place the answer is recorded.
 *
 * A source that offers a choice is not spelled from this table one row at a
 * time. Forge writes that as `Produced$ Combo U B`, one parameter naming every
 * option, and `effect-script.ts` composes it from these tokens.
 */
export const FORGE_MANA_PRODUCED: Readonly<Record<ManaColor, string>> = {
  W: 'W',
  U: 'U',
  B: 'B',
  R: 'R',
  G: 'G',
  C: 'C',
};

/** Edition-file rarity codes (`docs/Creating-a-custom-Set.md`: L/C/U/R/M/S). */
export const FORGE_RARITY_CODES: Readonly<Record<Rarity, string>> = {
  common: 'C',
  uncommon: 'U',
  rare: 'R',
  mythic: 'M',
};

/** Basic-land rarity code; lands are `L` regardless of the DSL rarity slot. */
export const FORGE_BASIC_LAND_RARITY_CODE = 'L';

/** Forge's stock printings of the five basics, reused rather than re-scripted. */
export const FORGE_BASIC_LAND_TYPES: Readonly<Record<BasicLandType, string>> = {
  Plains: 'Plains',
  Island: 'Island',
  Swamp: 'Swamp',
  Mountain: 'Mountain',
  Forest: 'Forest',
};

/**
 * The Forge counters each declared counter kind means, or `null` when Forge
 * cannot hold what carrying one means.
 *
 * A part counter carries a bundle of modifications declared in one place
 * (`@mtg/dsl`'s `COUNTER_DECLARATIONS`), and Forge's counter types are fixed
 * names with fixed meanings: none of them means "+1/+1 and first strike". None
 * has to. `PutCounter` takes `CounterTypes$ A,B` and puts one of each (Champion
 * of Dusan writes `CounterTypes$ P1P1,Trample`, Unexpected Fangs
 * `CounterTypes$ P1P1,Lifelink`), and Forge ships a keyword counter for each of
 * the nine evergreen keywords this transpiler maps, first strike included
 * (Heightened Reflexes, `CounterType$ First Strike`). All three are card
 * scripts in Forge 2.0.14's `res/cardsfolder`. So a part exports as the
 * counters its declaration decomposes into, and the creature Forge ends up with
 * has the power, toughness and keywords the kernel's has.
 *
 * What does not cross is the counter's identity. Forge records a +1/+1 counter
 * and a first strike counter where the kernel records one horn counter,
 * so CR 704.5q annihilates that +1/+1 against a -1/-1 counter there while the
 * kernel's horn counter survives it (`continuous.ts`'s `annihilateCounters`
 * names the one pair on purpose). Both boards read the same power and toughness
 * either way, because annihilation cancels a pair that sums to zero; they part
 * company the moment something reads counters by kind, and no DSL effect does.
 * the set design document states the boundary beside Fuse.
 *
 * `null` is the answer for a declaration this table cannot decompose: an empty
 * declaration is a marker counter Forge has no name for, and a stat bonus that
 * is neither +1/+1 nor -1/-1 has no entry here yet, though Forge does ship
 * `P1P0`, `P2P2` and `M0M1` for a part that needs one. `conformance.test.ts` checks every entry
 * against its declaration, so a counter whose meaning changes without its Forge
 * counters changing fails a test instead of exporting a card that does less in
 * Forge than in the kernel.
 *
 * Unverified against a booted Forge. The lines above are read off Forge
 * 2.0.14's shipped card scripts, which is evidence about its script grammar and
 * not a measurement of a game it ran, and the open question is exactly this:
 * does a creature Forge gives `P1P1` and `First Strike` counters to end a turn
 * with the power, toughness and keywords the kernel's creature has, and does
 * `CounterTypes$` with a repeated kind put one counter per entry? Both are
 * answerable by loading a generated set and reading a resolved board, and
 * neither has been asked. Deliberately no bead cited: `mtg-17a` is the `S:`
 * mapping — its description enumerates the three static scopes and its
 * acceptance criterion names `FORGE_STATIC_AFFECTED` — so citing it here would
 * park this question behind a criterion that can be met without touching a
 * counter.
 */
export const FORGE_COUNTER_TYPES: Readonly<Record<CounterKind, readonly [string, ...string[]] | null>> = {
  plusOnePlusOne: ['P1P1'],
  minusOneMinusOne: ['M1M1'],
  horn: ['P1P1', 'First Strike'],
  // The four keyword counters the tiered Monster Parts print, each the shape
  // `horn` established: the stat bonus first, then Forge's own spelling of the
  // keyword counter, taken from `FORGE_KEYWORDS` above rather than from the
  // kernel's. Forge ships a keyword counter for all four; its own
  // `res/cardsfolder` writes `CounterTypes$ P1P1,Trample` on Champion of
  // Dusan, which is where the two-entry decomposition came from in the first
  // place. Unverified against a booted Forge for the same reason `horn` is.
  wing: ['P1P1', 'Flying'],
  talon: ['P1P1', 'Deathtouch'],
  hide: ['P1P1', 'Trample'],
  fang: ['P1P1', 'Menace'],
  loyalty: null,
  // A gloom counter decomposes to Forge's `M1M1`, the same way `horn`
  // decomposes to `P1P1` plus a keyword counter: Forge ships no counter type
  // named "gloom", and this table records what a counter *means* there rather
  // than what it is called here. The identity is what does not cross, and the
  // consequence is stated: Forge's CR 704.5q annihilates this `M1M1` against a
  // `P1P1` while the kernel's gloom counter survives the pair, so a board with
  // both diverges by two counters and by no power or toughness.
  gloom: ['M1M1'],
  // Null for `loyalty`'s reason and not for `gloom`'s. A Trisigil counter
  // (`mtg-rji`) modifies nothing, so there is no meaning to decompose into
  // Forge counter types, and Forge ships no counter type named for it either.
  // The consequence is that a card putting one on itself is *rejected* rather
  // than exported — `putCounters`'s script reads this table and refuses a null
  // row with `UNMAPPED_EFFECT_KIND` — which is the correct trade for a marker
  // counter whose whole function is a count some other card reads: exporting
  // it as `P1P1` would hand Forge a board the kernel never had.
  trisigil: null,
  phylactery: ['PHYLACTERY'],
  defense: null,
  // Forge 2.0.14 ships this exact named marker and uses it on Hellion
  // Crucible's PutCounter and SubCounter costs. Unlike the semantic
  // decompositions above, this row preserves a zero-modification counter's
  // identity because Forge and the DSL name the same marker.
  pressure: ['PRESSURE'],
  petrification: ['PETRIFICATION'],
  charge: ['CHARGE'],
  filibuster: ['FILIBUSTER'],
};

/** Optional Forge AI hint for a chosen counter bearer, indexed by counter semantics. */
export const FORGE_ENTRY_COUNTER_AI_LOGIC: Readonly<Partial<Record<CounterKind, string>>> = {
  // Forge 2.0.14's own Phylactery Lich script uses this exact decision hint.
  phylactery: 'Phylactery',
};

/**
 * Forge's `Destination$` value for each end of a library the DSL can name.
 *
 * `LibraryPosition$` is the parameter, `Destination$ Library` is fixed, and the
 * two positions are `0` and `-1` — Forge counts from the top and reads a
 * negative index from the bottom, exactly as Condemn (`Destination$ Library |
 * LibraryPosition$ -1`) and Griptide (`LibraryPosition$ 0`) write it. A table
 * of two strings rather than a ternary at the row, so a third position added to
 * the DSL is a compile error here instead of a silent fall to the bottom.
 *
 * Unverified against a booted Forge, like every row in this file; `mtg-17a` is
 * that check.
 */
export const FORGE_LIBRARY_POSITIONS: Readonly<Record<LibraryPosition, string>> = {
  top: '0',
  bottom: '-1',
};

/**
 * The `ChangeType$` selector naming whose graveyard a mass exile empties.
 *
 * The legacy graveyard-exile form names an owner by word, so its owner cannot
 * ride in a `ValidTgts$` clause the way the hand-authored target-player form
 * does. Forge's `Valid` grammar spells ownership as a dotted qualifier, and
 * `YouOwn`/`OppOwn` are the two it ships; "each" is the bare `Card`, because a
 * qualifier that admitted both would be a longer spelling of no qualifier.
 *
 * Ownership rather than control (`YouCtrl`), and the difference is real in this
 * one zone: CR 404.3 puts a card in its *owner's* graveyard, so a creature you
 * stole and killed is in its owner's graveyard and not in yours. Every other
 * table in this file spells control because every other table reads the
 * battlefield.
 */
export const FORGE_GRAVEYARD_OWNERS: Readonly<Record<GraveyardOwner, string>> = {
  you: 'Card.YouOwn',
  opponent: 'Card.OppOwn',
  each: 'Card',
};

/**
 * The ownership qualifier naming whose graveyard a *filtered* fetch may take
 * from, or `null` when it may take from any.
 *
 * `FORGE_GRAVEYARD_OWNERS` one grammar position over, and the two are not one
 * table: that one answers `ChangeType$` for a mass exile, where the whole
 * selector is the owner and the base is always `Card`, while this one is a
 * qualifier glued onto whatever base `forgeSearchType` produced — Black Sun's
 * Twilight writes `ChangeType$ Creature.YouOwn+cmcLEX` and Ashcoat of the
 * Shadow Swarm writes `ChangeType$ Rat.Creature+YouOwn`, so the owner is a
 * *word* here and a *spec* there. Merging them would have to strip the
 * leading `Card.`, and a table whose consumers edit its values is not a table.
 *
 * `each` is `null` rather than a permissive qualifier for the same reason the
 * sibling table spells it as the bare `Card`: Dermotaxi's imprint, whose
 * rules text is "exile a creature card from a graveyard", writes `ChangeType$
 * Creature | ChangeNum$ 1 | Hidden$ True | Chooser$ You` and names no owner at
 * all, and a qualifier that admitted both owners would be a longer spelling of
 * no qualifier.
 *
 * `OppOwn` rather than the `OppCtrl` Deadly Cover-Up writes, because the
 * corpus writes both and `FORGE_GRAVEYARD_OWNERS`' argument from CR 404.3
 * settles the tie for this zone in the other table already.
 */
export const FORGE_GRAVEYARD_OWNER_QUALIFIERS: Readonly<Record<GraveyardOwner, string | null>> = {
  you: 'YouOwn',
  opponent: 'OppOwn',
  each: null,
};

/**
 * Forge's `Destination$` value for each zone a card the DSL fetches lands in.
 *
 * One table over three vocabularies, because `SearchDestination`,
 * `ReturnDestination` and `GraveyardChoiceDestination` are the same zones
 * asked about from three effects and Forge spells a destination by the zone
 * rather than by how the card got there. Keyed over the union so a member
 * added to any one of them fails to compile here.
 *
 * `exile` now reaches the union from searches as well as graveyard choices.
 * Haunting Echoes is the card that asks: its dynamically filtered search puts
 * the cards it finds into exile. `searchLibrary` remains hand-authored, so the
 * widening changes no generator slot or model-facing schema.
 */
export const FORGE_CARD_DESTINATIONS: Readonly<
  Record<SearchDestination | ReturnDestination | GraveyardChoiceDestination, string>
> = {
  hand: 'Hand',
  battlefield: 'Battlefield',
  battlefieldTapped: 'Battlefield',
  exile: 'Exile',
  libraryTop: 'Library',
};

/**
 * Forge's type token for each DSL card kind, unrestricted by zone.
 *
 * `board-count.ts`'s `FORGE_PERMANENT_TYPES` is the same idea with the four
 * non-permanent kinds deliberately absent, and the two are not one table: a
 * count of the battlefield that named an instant would always be zero, which
 * is a design mistake worth refusing, while a *library* holds all seven and a
 * search for an instant is an ordinary card. Total rather than partial for
 * that reason — there is no kind a library search has to refuse.
 *
 * `forgeFilteredTargets` reads it for the second zone that holds all seven: a
 * spell on the stack, where an instant is the common case (`Card.nonCreature`
 * is Negate) and a table missing four kinds would refuse the ordinary card.
 */
export const FORGE_CARD_TYPES: Readonly<Record<CardKind, string>> = {
  creature: 'Creature',
  instant: 'Instant',
  sorcery: 'Sorcery',
  artifact: 'Artifact',
  land: 'Land',
  enchantment: 'Enchantment',
  planeswalker: 'Planeswalker',
  battle: 'Battle',
};

/** Forge's dotted qualifier for each DSL supertype (`Land.Basic`). */
export const FORGE_SUPERTYPES: Readonly<Record<Supertype, string>> = {
  basic: 'Basic',
  legendary: 'Legendary',
};

/**
 * The members a search filter spells, one per combination its lists admit, or
 * `null` when this transpiler will not write it.
 *
 * `boardCountValid`'s rule, applied to the zone one over and for its reason: a
 * `CardFilter` ORs within each list and ANDs across them, Forge spells the OR
 * as a comma-separated list of whole specs and the AND as a `+` between
 * qualifiers, so a filter with several members on several lists is the cross
 * product. `ChangeType$ Instant.YouOwn,Sorcery.YouOwn` is shipped twelve times
 * and 285 of the 2,616 `ChangeType$` lines in 2.0.15's `res/cardsfolder` write
 * a comma; `ValidCard$ Instant,Sorcery` is shipped 264 times.
 *
 * The comma means any-of and not a repeat, which the Java settles rather than
 * the corpus implying: `AbilityUtils.filterListByType` hands the whole string
 * to `CardLists.getValidCards`, which splits it on commas and filters by
 * `isValid(String[])`, and that returns on the first member a card matches. So
 * a card satisfying two members is offered once, which is what `matchesFilter`
 * means by `anyOf`.
 *
 * The base token is the card type when the filter names one and the subtype
 * when it does not, which is the same position swap `boardCountValid` makes,
 * for the same reason: Forge's grammar takes a creature type where a card type
 * sits. A filter that names neither is the bare `Card`, which is what Demonic
 * Tutor writes (`ChangeType$ Card`) and is a legal search for anything.
 *
 * `colors` joins the qualifiers rather than the base, because a color is never
 * a Forge base token — Revive is "return target green card from your
 * graveyard", and the corpus spells that class of filter `Card.Green`. It
 * takes the same one-entry ceiling as the other three lists and for the same
 * reason, and it is checked rather than ignored on purpose: a filter that
 * narrowed to green and transpiled as the bare `Card` would boot clean and
 * return a card the kernel would not have offered, which is precisely the
 * failure this whole file is arranged to avoid.
 *
 * `maxManaValue` joins the qualifiers as Forge's `cmcLE<n>`, and it is the one
 * field here that needs no one-entry ceiling: a bound is a single number rather
 * than a list, so the OR shape this file refuses everywhere else cannot arise
 * from it.
 *
 * `names` is refused outright rather than spelled, and the widening above is
 * why it stays refused. Forge writes a name restriction as a `named<Name>`
 * qualifier, and a card name is an arbitrary string with spaces, commas and
 * apostrophes in it — the comma is the same character this grammar reads as
 * the OR separator, so a name spliced into a member list is a selector that
 * parses as something else. Forge's own corpus shows the hazard rather than a
 * fix: `Discard<1/Card.namedBaru, Fist of Krosa>` is a shipped line whose
 * qualifier contains the separator. Guessing an escaping convention against a
 * grammar nothing in this checkout can boot is the guess this file exists to
 * refuse.
 *
 * `excludeCardTypes` conjoins rather than distributing, and that is the one
 * list here that never becomes a member of its own: exclusions are not a
 * union. "noncreature, nonland" refuses both, so the two words conjoin with
 * `+` the way `cmcLE2` does, and they ride on every member. `forgeFilteredTargets` already writes exactly
 * these words for exactly this field on the target side ("the conjunctive half,
 * in one order for every member"), so the spelling is attested in this file
 * rather than guessed at, which is the standard everything else here is held
 * to.
 *
 * `optionalQualifier` is how a caller adds a dimension this filter has no
 * field for — ownership, in the one caller that has to say whose graveyard —
 * without that caller reaching into the returned string to splice a `+` in.
 */
export function forgeSearchTypeMembers(
  filter: CardFilter,
  optionalQualifier: string | null = null,
): readonly string[] | null {
  if (filter.anyOf !== undefined) {
    const members = filter.anyOf.flatMap((alternative) => {
      const rendered = forgeSearchTypeMembers(alternative, optionalQualifier);
      if (rendered === null) return [];
      return rendered.map((member) =>
        alternative.cardTypes === undefined && alternative.subtypes?.length === 1 ? `Card.${member}` : member,
      );
    });
    return members.length === 0 ? null : [...new Set(members)];
  }
  if (filter.names !== undefined) return null;
  const cardTypes = orNothing(filter.cardTypes);
  const subtypes = orNothing(filter.subtypes);
  const supertypes = orNothing(filter.supertypes);
  const colors = orNothing(filter.colors);
  const keywords = orNothing(filter.keywords);
  const conjoined = [
    ...(filter.maxManaValue === undefined ? [] : [`cmcLE${filter.maxManaValue}`]),
    ...(filter.excludeCardTypes ?? []).map((kind) => `non${FORGE_CARD_TYPES[kind]}`),
    ...(optionalQualifier === null ? [] : [optionalQualifier]),
  ];

  const members: string[] = [];
  for (const cardType of cardTypes) {
    for (const subtype of subtypes) {
      for (const supertype of supertypes) {
        for (const color of colors) {
          for (const keyword of keywords) {
            const base = cardType !== undefined ? FORGE_CARD_TYPES[cardType] : (subtype ?? 'Card');
            const qualifiers = [
              ...(supertype === undefined ? [] : [FORGE_SUPERTYPES[supertype]]),
              ...(cardType === undefined || subtype === undefined ? [] : [subtype]),
              ...(color === undefined ? [] : [FORGE_COLOR_PROPERTIES[color]]),
              ...conjoined,
              ...(keyword === undefined ? [] : [`with${FORGE_GRANTABLE_KEYWORDS[keyword]}`]),
            ];
            const member = qualifiers.length === 0 ? base : `${base}.${qualifiers.join('+')}`;
            if (!members.includes(member)) members.push(member);
          }
        }
      }
    }
  }
  return members;
}

/** The list, or one absent member, so an empty list still runs the loop once. */
function orNothing<T>(list: readonly T[] | undefined): readonly (T | undefined)[] {
  return list === undefined || list.length === 0 ? [undefined] : list;
}

/**
 * The whole selector for a grammar position that reads a comma as the OR:
 * `ChangeType$` and `ValidCard$`, both of which the corpus writes with commas
 * in the hundreds.
 */
export function forgeSearchTypeUnion(
  filter: CardFilter,
  optionalQualifier: string | null = null,
): string | null {
  const members = forgeSearchTypeMembers(filter, optionalQualifier);
  return members === null ? null : members.join(',');
}

/**
 * The selector for a position that cannot read a comma, which refuses any
 * filter needing more than one member.
 *
 * Two positions need this and neither is a stylistic preference. An activation
 * cost spells its own OR with a semicolon and not a comma —
 * `Discard<1/Enchantment;Instant;Sorcery/...>` and `Sac<1/Artifact;Creature;Land/...>`
 * are the shipped lines — and both of those also carry a third human-readable field
 * this transpiler does not write, so the union form there is a guess rather
 * than a spelling. A search quota writes `ChangeType$ EACH A & B`, where a
 * member list inside a term has no reading at all.
 */
export function forgeSearchType(filter: CardFilter, optionalQualifier: string | null = null): string | null {
  const members = forgeSearchTypeMembers(filter, optionalQualifier);
  return members === null || members.length !== 1 ? null : (members[0] ?? null);
}
