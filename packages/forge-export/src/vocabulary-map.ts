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
import { assertNever } from '@mtg/dsl';
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
    default:
      return assertNever(restriction, 'forgeTargetRestriction');
  }
}

/**
 * A `ValidTgts$` selector with a restriction qualifier attached.
 *
 * Forge separates the first qualifier from the card type with a dot and every
 * one after it with a plus (`Creature.YouCtrl+counters_GE1_P1P1`, five shipped
 * cards), so which separator to write is a question about the base and not about
 * the qualifier. A base that is a comma-separated union of card types
 * (`Artifact,Enchantment`) can carry neither: the qualifier would bind to the
 * last member only. That combination cannot arise — `restrictionFitsTargetKind`
 * admits a restriction on the three kinds whose space is exactly `creature` —
 * but it returns `null` rather than trusting an upstream validator to have run,
 * because a transpiler that emits a selector it cannot justify is the failure
 * this table exists to fix.
 */
export function forgeRestrictedTarget(base: string, qualifier: string): string | null {
  if (base.includes(',')) return null;
  return appendQualifier(base, qualifier);
}

/**
 * Forge's two separators, applied to a base already known to carry no comma.
 *
 * Split out of `forgeRestrictedTarget` rather than written twice because
 * `forgeFilteredTargets` builds its members by splitting a union on the comma
 * first, so it has answered that function's one refusal before it starts and
 * would otherwise have to re-decide the dot-or-plus rule. One implementation
 * means the restriction path and the filter path cannot come to different
 * conclusions about a base that already carries a qualifier.
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
 * Two fields are refused rather than guessed, and the argument is the same one
 * twice. Forge's grammar plausibly spells a conjunction `Creature.Artifact` and
 * plausibly spells a keyword `Creature.withFlying`, and plausibly is the whole
 * problem: every row in this file is read off `res/cardsfolder`, that corpus is
 * not in this checkout, and a parity oracle that invents a selector reports a
 * mismatch as agreement. So the refusal is the mapping until somebody reads the
 * corpus, and both belong to `mtg-17a` with every other unverified row here.
 *
 * A field rather than a boolean, because the caller prints the cause and the
 * two causes have different fixes: a conjunction is a card the author can
 * rewrite, and a keyword sweep is a selector nobody has attested yet
 * (`mtg-nhyv.2`, `mtg-nhyv.62`). One function rather than a condition repeated
 * inside `forgeFilteredTargets` and again at each rejection site, so the list
 * of refused fields cannot drift from the list of reasons given for refusing.
 */
export function unmappedFilterField(filter: TargetFilter): 'allCardTypes' | 'keywords' | null {
  if (filter.allCardTypes !== undefined) return 'allCardTypes';
  if (filter.keywords !== undefined) return 'keywords';
  return null;
}

export function forgeFilteredTargets(
  base: string,
  filter: TargetFilter,
  cardTypes: 'base' | 'qualifier',
): readonly string[] | null {
  if (unmappedFilterField(filter) !== null) return null;
  const named = filter.cardTypes?.map((kind) => FORGE_CARD_TYPES[kind]);
  // A subtype with no card type beside it and nothing but `Permanent` to narrow
  // takes the base, the way a card type does; anywhere else it is a qualifier.
  // `checkFilterLists` refuses the two together (CR 205.3), so the first branch
  // is what a valid card reaches and the second is what a hand-written filter
  // and every narrower base reach.
  const subtypeBases = named === undefined && base === 'Permanent' ? filter.subtypes : undefined;
  const bases = subtypeBases ?? (named !== undefined && cardTypes === 'base' ? named : base.split(','));
  const typeQualifiers = named !== undefined && cardTypes === 'qualifier' ? named : [null];
  const subtypes = subtypeBases !== undefined ? [null] : (filter.subtypes ?? [null]);
  const colors = filter.colors?.map((color) => FORGE_COLOR_PROPERTIES[color]) ?? [null];
  const roles = filter.combat === undefined ? [null] : FORGE_COMBAT_ROLES[filter.combat];
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
            const qualifiers = [type, subtype, color, role, ...refused].filter(
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
  // answers the three back-references (`mtg-nhyv.75`) before it consults this
  // table, because Forge spells them `Defined$` too. `Targeted` for this kind
  // and for `thatPlayer` — one word there for both, since Forge's referent
  // carries no type — and `TargetedController` for the third. The rows exist to
  // keep the record total over `TargetKind`, which is what makes a kind added
  // later a compile error here rather than a silent `undefined`.
  thatCreature: null,
  thatPlayer: null,
  thatCreaturesController: null,
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
  // The complement of `targetCreatureYouControl`, and Forge spells it as the
  // negation of the same qualifier: 158 cards write
  // `ValidTgts$ Creature.YouDontCtrl`, among them Affectionate Indrik, whose
  // printed text is verbatim what this kind prints under a `selfEnters` fight
  // trigger. Unverified against a booted Forge for the reason the rows above
  // are: `mtg-17a` is that check.
  targetCreatureYouDontControl: 'Creature.YouDontCtrl',
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
 * Bell and Howling Banshee) and `Defined$ Opponent` is everyone but the
 * resolving controller (how it scripts Liliana's Specter). Neither is a target,
 * which is the whole reason the sweep replaces the target clause instead of
 * qualifying it — the `noTarget` slot beside it would otherwise write
 * `Defined$ You` and reach one seat, the wrong one.
 */
export const FORGE_PLAYER_SCOPE_DEFINED: Readonly<Record<PlayerScope, string>> = {
  eachPlayer: 'Player',
  eachOpponent: 'Opponent',
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
 * three DSL conditions were chosen to compile onto exactly that grammar:
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
  controlledCreatureAttacksAlone: [
    ['Mode', 'Attacks'],
    ['ValidCard', 'Creature.YouCtrl'],
    ['Alone', 'True'],
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
  anotherControlledCreatureEnters: [
    ['Mode', 'ChangesZone'],
    ['Origin', 'Any'],
    ['Destination', 'Battlefield'],
    ['ValidCard', 'Creature.YouCtrl+Other'],
  ],
  youCastSpell: [
    ['Mode', 'SpellCast'],
    ['ValidCard', 'Card.YouCtrl'],
  ],
  // The comma is Forge's OR across two card-type restrictions on one
  // `ValidCard$`, the same device `res/cardsfolder` uses for cards like
  // Guttersnipe.
  youCastInstantOrSorcery: [
    ['Mode', 'SpellCast'],
    ['ValidCard', 'Instant.YouCtrl,Sorcery.YouCtrl'],
  ],
  selfDealsCombatDamageToPlayer: [
    ['Mode', 'DamageDone'],
    ['ValidSource', 'Card.Self'],
    ['ValidTarget', 'Player'],
    ['CombatDamage', 'True'],
  ],
  selfBlocks: [
    ['Mode', 'Blocks'],
    ['ValidCard', 'Card.Self'],
  ],
  youGainLife: [
    ['Mode', 'LifeGained'],
    ['ValidPlayer', 'You'],
  ],
  // Flurry rush's condition, and the row this file cannot honestly claim to
  // have compiled. Forge's `Blocks` mode carries `ValidCard$` for the blocker
  // and `ValidBlocked$` for what it blocked, which covers only the half where
  // the source is the blocker; the other half — the source is the attacker and
  // something bigger blocked it — is `BlockedBy` in `res/cardsfolder`, a second
  // mode rather than a parameter on this one. `ForgeParam` rows are one mode
  // each, so the union this condition names does not fit the grammar, and the
  // power comparison has no `ValidCard$` restriction at all: Forge's card
  // properties compare power to a constant (`Creature.powerGE3`), never to the
  // source's own power at declaration.
  //
  // So this row compiles the half a single mode can state, and it is *narrower*
  // than the DSL condition rather than wider, which is the direction a wrong
  // guess should fail in — a Forge card that fires on too few blocks is a
  // visible parity mismatch, one that fires on too many is a silently different
  // card. `mtg-17a` is the bead that checks every guess in this file against a
  // booted Forge; this row is the one that should be *replaced* by that check
  // rather than merely confirmed, because what it needs is a second `T:` line
  // and this table has no way to emit one.
  selfBlocksOrIsBlockedByGreaterPower: [
    ['Mode', 'Blocks'],
    ['ValidCard', 'Card.Self'],
  ],
  // `selfBlocksOrIsBlockedByGreaterPower`'s problem exactly, and the same
  // answer. Forge states one `Mode$` per `T:` line, and the two halves of this
  // condition are two modes — `ChangesZone` for the arrival and `Attacks` for
  // the declaration — so the union does not fit a single row and this table has
  // no way to emit a second line.
  //
  // The arrival half is the one written, and the choice is not arbitrary: an
  // entry that fires only on arrival is the card missing its combat payoff,
  // which a parity run reports as a mismatch the first time a Titan attacks,
  // while an entry that fired only on the attack would silently drop the half
  // the printed card guarantees on turn six. Narrower than the DSL condition
  // either way, which is the direction a guess should fail in. `mtg-17a` is the
  // bead that checks it against a booted Forge, and like the row above this one
  // should be *replaced* by that check rather than confirmed.
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
 * A graveyard exile has no target in the DSL — it names an owner by word
 * (`exileGraveyardEffect`, `@mtg/dsl`) — so the owner cannot ride in a
 * `ValidTgts$` clause the way `FORGE_SCOPE_CHANGE_TYPES`' sweepers put it
 * there. Forge's `Valid` grammar spells ownership as a dotted qualifier, and
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
 * `exile` reaches the union from the third vocabulary alone, and that is the
 * rules rather than an oversight: CR 701.19b makes a library search a move to
 * a zone the card can be *put into*, and exile is not one the printed tutors
 * use, while a graveyard fetch exiles constantly (Vile Rebirth, Tormod's
 * Crypt). Widening the search vocabulary to match would let the generator ask
 * for a search that ends in exile, which no card in the backlog asks for.
 */
export const FORGE_CARD_DESTINATIONS: Readonly<
  Record<SearchDestination | ReturnDestination | GraveyardChoiceDestination, string>
> = {
  hand: 'Hand',
  battlefield: 'Battlefield',
  battlefieldTapped: 'Battlefield',
  exile: 'Exile',
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
};

/** Forge's dotted qualifier for each DSL supertype (`Land.Basic`). */
export const FORGE_SUPERTYPES: Readonly<Record<Supertype, string>> = {
  basic: 'Basic',
  legendary: 'Legendary',
};

/**
 * The `ChangeType$` selector for one search filter, or `null` when this
 * transpiler will not write it.
 *
 * `boardCountValid`'s rule, applied to the zone one over and for its reason:
 * a `CardFilter` ORs within each list and ANDs across them, Forge spells an OR
 * as a comma-separated list of whole specs, and that is a shape nothing here
 * writes. So at most one entry per list is spelled and anything wider is
 * refused by name. A refusal costs a card; a guess costs a card that
 * transpiles clean and searches a different library in Forge than it searches
 * in the kernel.
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
 * `names` is refused outright rather than spelled. Forge writes a name
 * restriction as a `named<Name>` qualifier, and a card name is an arbitrary
 * string with spaces, commas and apostrophes in it — the comma is the same
 * character this grammar reads as the OR separator, so a name spliced into a
 * qualifier list is a selector that parses as something else. Guessing an
 * escaping convention against a grammar nothing in this checkout can boot is
 * the guess this file exists to refuse.
 *
 * `excludeCardTypes` is spelled rather than refused, and it is the one list
 * here with no one-entry ceiling. The ceiling exists because Forge writes a
 * union as a comma-separated list of whole specs, and exclusions are not a
 * union: "noncreature, nonland" refuses both, so the two words conjoin with
 * `+` the way `cmcLE2` does. `forgeFilteredTargets` already writes exactly
 * these words for exactly this field on the target side ("the conjunctive half,
 * in one order for every member"), so the spelling is attested in this file
 * rather than guessed at, which is the standard everything else here is held
 * to.
 *
 * `optionalQualifier` is how a caller adds a dimension this filter has no
 * field for — ownership, in the one caller that has to say whose graveyard —
 * without that caller reaching into the returned string to splice a `+` in.
 */
export function forgeSearchType(filter: CardFilter, optionalQualifier: string | null = null): string | null {
  const cardTypes = filter.cardTypes ?? [];
  const subtypes = filter.subtypes ?? [];
  const supertypes = filter.supertypes ?? [];
  const colors = filter.colors ?? [];
  if (cardTypes.length > 1 || subtypes.length > 1 || supertypes.length > 1 || colors.length > 1) return null;
  if (filter.names !== undefined) return null;

  const [cardType] = cardTypes;
  const [subtype] = subtypes;
  const [supertype] = supertypes;
  const [color] = colors;
  const base = cardType !== undefined ? FORGE_CARD_TYPES[cardType] : (subtype ?? 'Card');
  const qualifiers = [
    ...(supertype === undefined ? [] : [FORGE_SUPERTYPES[supertype]]),
    ...(cardType === undefined || subtype === undefined ? [] : [subtype]),
    ...(color === undefined ? [] : [FORGE_COLOR_PROPERTIES[color]]),
    ...(filter.maxManaValue === undefined ? [] : [`cmcLE${filter.maxManaValue}`]),
    ...(filter.excludeCardTypes ?? []).map((kind) => `non${FORGE_CARD_TYPES[kind]}`),
    ...(optionalQualifier === null ? [] : [optionalQualifier]),
  ];
  return qualifiers.length === 0 ? base : `${base}.${qualifiers.join('+')}`;
}
