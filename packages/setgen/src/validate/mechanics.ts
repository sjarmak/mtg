/**
 * What a finished set says about its own mechanics, read off the cards.
 *
 * Every reader here walks a card the same way and for the same reason: a
 * permanent has no effect list of its own, so everything it does is printed
 * inside an ability, and a spell's effects sit on the card. Reading only one of
 * the two is the defect `cardContribution` shipped and had to be fixed for, so
 * it is written once here and used by all of them. Two of the readers go one
 * step further and walk the abilities of the tokens a card creates, because the
 * DSL puts a whole mechanic there — `FuseAbilitySchema` is a *token* ability,
 * and a walk that stopped at the card would report the one shape the engine pins
 * for Fuse as never printed.
 *
 * Three checks live here, and together they are the set's economy: something is
 * spent, something supplies it, and the brief said both would be there.
 *
 * `checkSacrificeSupply` is the demand-to-supply direction, and it is the reason
 * `ActivationCost.sacrificeOther` is reachable from the generator at all. The
 * field was held back with a stated argument: a cost naming a subtype is only
 * payable on a board that supplies one, and which subtypes a set supplies is a
 * question about the whole set while `@mtg/setgen` fills slots one at a time.
 * The brief names the subtype, which answers who decides; this check is what
 * makes the answer true rather than asserted, by failing a set whose Chests eat
 * a permanent none of its cards create.
 *
 * `checkTokenDemand` is the same sentence read backwards, and it is the one the
 * flagship needed. The 249-card run printed eleven cards that mint a Key and not
 * one card that spends one, and every gate in this directory reported it clean:
 * supply with no demand was nobody's check. A generated set can name an economy
 * in its theme paragraph and print only one half of it, and the half it prints
 * is always the giving half, because minting a token is a payoff a slot can
 * carry alone.
 *
 * `checkMechanicsPrinted` is the brief's side of the same question, one level
 * up: a mechanic states the vocabulary it is expressed in, and a set that prints
 * none of some stated word did not print all of that mechanic. It overlaps
 * `checkMechanicCoverage` (`composition.ts`) on purpose and says a different
 * thing — coverage asks whether the theme reached *common*, in the mechanic's
 * *colors*, and is satisfied by any one of the words; this asks whether each
 * word reached the set at all. A mechanic can pass coverage on its ability kind
 * while the effect that makes it a mechanic appears nowhere, which is exactly
 * how a brief buys a set that does not contain it.
 */
import type {
  Ability,
  AbilityKind,
  AnyEffectKind,
  AuraModificationKind,
  Card,
  CounterKind,
  Effect,
  Keyword,
  StaticModificationKind,
  TokenAbility,
  TokenSpec,
  TriggerCondition,
} from '@mtg/dsl';
import { hasAbilityEffects, tokenAbilities } from '@mtg/dsl';
import type { DesiredMechanic } from '../brief';
import type { SetFinding } from './findings';
import { finding } from './findings';
import type { Entry } from './composition';

/**
 * A card's own effect list: `card.effects` for a fixed-effect card, or every
 * mode's effects for a modal one (CR 700.2) — never both, `checkEffects`
 * refuses a card that populates both. Every set-wide walk in this file has no
 * game in progress and no mode choice to resolve, so every mode a card could
 * print is a surface the walk must count, the same reasoning `@mtg/dsl`'s
 * `setTokens` argues for its own walk over `printedEffects` below. Reading
 * `card.effects` alone left a modal card's tokens, keyword grants and effect
 * kinds absent from every census in this file — not merely unrendered, but
 * reported as never printed.
 */
export function cardOwnEffects(card: Card): readonly Effect[] {
  return card.modes === undefined ? card.effects : card.modes.flatMap((mode) => mode.effects);
}

/** Every effect a card prints, on the card itself or inside one of its abilities. */
function printedEffects(card: Card): readonly Effect[] {
  const fromAbilities = card.abilities.flatMap((ability: Ability) =>
    hasAbilityEffects(ability) ? [...ability.effects] : [],
  );
  return [...cardOwnEffects(card), ...fromAbilities];
}

/** Every token this card can put into play. */
function tokensCreatedBy(card: Card): readonly TokenSpec[] {
  return printedEffects(card).flatMap((effect) => (effect.kind === 'createToken' ? [effect.token] : []));
}

/**
 * An ability printed on this card's account, wherever it is printed.
 *
 * A card's abilities and the abilities of the tokens it creates are two
 * different types — `TokenAbility` carries CR 603.3b's `optional` and no
 * `enabledWhile`, because a token's printed line is where the corpus needed the
 * word — so the readers below take the union and switch on `kind`, which both
 * halves share.
 */
type PrintedAbility = Ability | TokenAbility;

/**
 * What a printed continuous clause may change, over both places one is printed.
 *
 * The union rather than `StaticModificationKind` alone, because an Aura says two
 * things a static ability cannot (`card.ts`'s `AuraModificationSchema` unions
 * the static kinds with its own), and a census that typed its rows as the
 * narrower one would have to drop the Aura-only members or widen at the call
 * site, which is where the last one went wrong.
 */
export type PrintedModificationKind = StaticModificationKind | AuraModificationKind;

function printedAbilities(card: Card): readonly PrintedAbility[] {
  return [...card.abilities, ...tokensCreatedBy(card).flatMap((token) => tokenAbilities(token))];
}

/** `hasAbilityEffects` over the union: the static member is the one without effects. */
function hasPrintedEffects(
  ability: PrintedAbility,
): ability is Extract<PrintedAbility, { effects: unknown }> {
  return 'effects' in ability;
}

/**
 * Every effect kind printed on this card's account, its tokens' lines included.
 *
 * Exported because `composition.ts`'s coverage check is the last reader that was
 * still asking a card for `card.effects` alone. A generated permanent's effect
 * list is always empty — `assemble.ts` writes `effects: []` on every creature and
 * artifact, because a permanent's effects are printed inside its abilities — so
 * that reading could match a spell and never a permanent, and a mechanic stated
 * as an effect kind and printed on a common creature read as absent from the set
 * that prints it. The same defect one drawer over, with the same fix: one walk,
 * used by every reader.
 */
export function printedEffectKinds(card: Card): readonly AnyEffectKind[] {
  return [...printedEffectKindsOnCard(card), ...tokenEffectKinds(card)];
}

/**
 * The same walk stopping at the card: its own effects, every mode of a modal
 * one, and the effects of every ability printed on it, with the abilities of the
 * tokens it creates left out.
 *
 * Split out rather than reimplemented because the descent is a *stated* choice
 * on one number and not on another. A census over `putCounters` alone reads 43
 * cards of the flagship pool without the descent and 83 with it, since the DSL
 * lets a card put its counters on the board by minting a token whose own printed
 * ability places them; a census over a family that also contains `createToken`
 * reads the same card count either way, because the card that mints the token
 * had to print `createToken` to get it there. So a tool measuring one verb has
 * to say which walk produced the number, and a tool measuring the family does
 * not — which is only sayable if both walks exist and neither is a second
 * transcription of the other.
 */
export function printedEffectKindsOnCard(card: Card): readonly AnyEffectKind[] {
  return printedEffects(card).map((effect) => effect.kind);
}

/** The effect kinds printed on the lines of the tokens this card creates. */
function tokenEffectKinds(card: Card): readonly AnyEffectKind[] {
  return tokensCreatedBy(card).flatMap((token) =>
    tokenAbilities(token).flatMap((ability) =>
      hasPrintedEffects(ability) ? ability.effects.map((effect) => effect.kind) : [],
    ),
  );
}

/**
 * Every modification kind printed on this card's account, its tokens' lines
 * included: what a static ability, an equip clause or an Aura clause *changes*.
 *
 * ## Why this exists beside `printedEffectKinds` rather than inside it
 *
 * A card's verbs live in two vocabularies that share no member. `AnyEffectKind`
 * is `Effect['kind']`, 35 members, what a spell or an ability *does*;
 * `StaticModificationKind` is 13 members, what a continuous clause *changes*,
 * and `AuraModificationKind` adds the two an Aura may say and a static may not.
 * `statBonus` is in the second vocabulary and in no member of the first, so a
 * census written over effect kinds alone does not read it as absent — it has no
 * expression for it at all, and silently reports a set that prints "other
 * creatures you control get +1/+1" thirty-four times as printing that verb zero
 * times. That is not a hypothetical: the pool census this repository quoted for
 * three weeks was built that way and its `statBonus` line was reconstructed by
 * hand.
 *
 * The trap was recorded as a *collision* — the same name on both unions, only
 * one of them reachable — and that reading is worse than the truth rather than
 * better. A collision leaves a walk that reads `Effect['kind']` looking at a
 * real arm and finding it unused, which a reader can at least go and check. What
 * actually ships is a name that one union has never had, so the walk is not
 * wrong about the set, it is silent about a whole vocabulary. A comment at the
 * schema would document a collision that does not exist. This function is the
 * other half of the pair instead, and any census that takes only one of the two
 * is measuring a set's effects or a set's continuous clauses, never its verbs.
 *
 * ## Three readers, because a modification is printed in three places
 *
 * A static ability's `modification` is the one every walk finds. An equip
 * clause's `attach.modifications` (CR 702.6b, `ability-shape.ts` argues why the
 * modifications ride on the activated ability) and an Aura's
 * `aura.modifications` are the two that hide, and they are where the
 * unreproducible line went: 26 static `statBonus` modifications, 6 in equip
 * clauses and 2 on Auras is the 34 the prior census recorded and no
 * static-only walk could get back to.
 *
 * A counter kind's own declaration is deliberately not a reader here.
 * `COUNTER_KINDS` types each kind's meaning as a `StaticModification`, so a card
 * placing a +1/+1 counter has a `statBonus` somewhere in its causal history; but
 * what that card *prints* is `putCounters`, and crediting it with both would
 * count one clause under two vocabularies.
 */
export function printedModificationKinds(card: Card): readonly PrintedModificationKind[] {
  return [...printedModificationKindsOnCard(card), ...tokenModificationKinds(card)];
}

/** `printedModificationKinds` stopping at the card, for `printedEffectKindsOnCard`'s reason. */
export function printedModificationKindsOnCard(card: Card): readonly PrintedModificationKind[] {
  // `aura` is a field of the enchantment member alone, and `attach` below of the
  // engine ability union alone, so both are read through the guard rather than
  // the dot — `subtypesNamedBy` states the same rule for `enabledWhile`.
  const aura = 'aura' in card ? card.aura : undefined;
  return [
    ...card.abilities.flatMap(modificationKindsOf),
    ...(aura === undefined ? [] : aura.modifications.map((modification) => modification.kind)),
  ];
}

/** The modification kinds printed on the lines of the tokens this card creates. */
function tokenModificationKinds(card: Card): readonly PrintedModificationKind[] {
  return tokensCreatedBy(card).flatMap((token) => tokenAbilities(token).flatMap(modificationKindsOf));
}

/** What one printed ability changes: its static modification, its equip clause's, or neither. */
function modificationKindsOf(ability: PrintedAbility): readonly PrintedModificationKind[] {
  if (ability.kind === 'static') return [ability.modification.kind];
  if (ability.kind !== 'activated') return [];
  const attach = 'attach' in ability ? ability.attach : undefined;
  return attach === undefined ? [] : attach.modifications.map((modification) => modification.kind);
}

/**
 * Every ability kind printed on this card's account, its tokens' lines included.
 *
 * A token's ability counts for the same reason it counts in `printedEffectKinds`:
 * `FuseAbilitySchema` is a token ability, so the one shape the flagship set
 * pins for its first mechanic is printed nowhere else, and a walk that stopped at
 * the card would report it as never printed.
 */
export function printedAbilityKinds(card: Card): readonly AbilityKind[] {
  return printedAbilities(card).map((ability) => ability.kind);
}

/**
 * The counter kinds this card's parts place: for each token it creates, the
 * counters that token's own activated abilities put on something.
 *
 * "A part" is not a subtype or a name here, it is the shape: a token whose
 * printed ability places a counter. Reading the shape rather than a label is
 * what lets a set call its parts whatever its world calls them.
 */
export function partCountersCreatedBy(card: Card): readonly CounterKind[] {
  return tokensCreatedBy(card).flatMap((token) =>
    tokenAbilities(token).flatMap((ability) =>
      ability.kind === 'activated'
        ? ability.effects.flatMap((effect) => (effect.kind === 'putCounters' ? [effect.counter] : []))
        : [],
    ),
  );
}

/** Subtypes this card's tokens carry. */
export function subtypesCreatedBy(card: Card): readonly string[] {
  return tokensCreatedBy(card).flatMap((token) => token.subtypes);
}

/** Subtypes this card puts onto the battlefield, on a token or on itself. */
function subtypesSuppliedBy(card: Card): readonly string[] {
  return [...card.subtypes, ...subtypesCreatedBy(card)];
}

/**
 * Every activation cost in the set that eats a named subtype has something in
 * the set to eat.
 *
 * The supply side counts a printed permanent's own subtypes as well as its
 * tokens', because a Chest that eats Chests is a legal if strange card and this
 * check is about whether the cost is payable, not about which card was meant to
 * pay it. It says nothing about how many: a set with one Key and a Chest costing
 * two is a balance question, which the sim answers and a structural check cannot.
 *
 * Which slots it blames is the half that decides whether the repair loop can
 * converge. Regenerating the Chest cannot produce a Key, so the blame list is
 * every slot the brief told to supply this subtype, and the Chest only when the
 * brief named no supplier at all — at which point the set has no card that could
 * fix it and the finding is really about the brief.
 */
export function checkSacrificeSupply(entries: readonly Entry[]): SetFinding[] {
  const supplied = new Set(entries.flatMap(({ card }) => subtypesSuppliedBy(card)));
  const findings: SetFinding[] = [];
  for (const { slot, card } of entries) {
    for (const ability of card.abilities) {
      if (ability.kind !== 'activated') continue;
      const cost = ability.cost.sacrificeOther;
      if (cost === undefined || supplied.has(cost.subtype)) continue;
      const suppliers = entries
        .filter((entry) => entry.slot.requiredCard?.suppliesSubtype === cost.subtype)
        .map((entry) => entry.slot.id);
      findings.push(
        finding(
          'SACRIFICE_SUBTYPE_UNSUPPLIED',
          'error',
          `"${card.name}" opens by sacrificing ${String(cost.count)} ${cost.subtype} permanents and no card in the set creates one, so it can never be activated`,
          suppliers.length > 0 ? suppliers : [slot.id],
        ),
      );
    }
  }
  return findings;
}

/**
 * Every subtype this ability names, in a place where naming it does something.
 *
 * Three places, and the list is the whole of the DSL rather than a chosen
 * subset: a cost that eats a permanent of that subtype (CR 118.3, and the shape
 * a Chest opens with), a static ability narrowed to it (a lord), and CR 611.2c's
 * `enabledWhile` counting it. A subtype named nowhere in that list is a subtype
 * this set's rules text never mentions, and a permanent carrying it is a
 * permanent nothing in the set can be about.
 */
function subtypesNamedBy(ability: PrintedAbility): readonly string[] {
  if (ability.kind === 'activated') {
    const cost = ability.cost.sacrificeOther;
    return cost === undefined ? [] : [cost.subtype];
  }
  if (ability.kind !== 'static') return [];
  const narrowed = ability.subtype === null ? [] : [ability.subtype];
  // `enabledWhile` is the engine union's field; a token's static ability has no
  // member for it, so the union is read through the guard rather than the dot.
  const gate = 'enabledWhile' in ability ? ability.enabledWhile : undefined;
  if (gate === undefined || gate === null) return narrowed;
  return gate.kind === 'controlsSubtype' ? [...narrowed, gate.subtype] : narrowed;
}

/**
 * A token that does nothing on its own, and so exists only to be spent.
 *
 * This is the line between a token meant to be *paid* and a token meant to
 * *fight*, and it is drawn on the printed object rather than on its name,
 * because a name is flavor and this check is arithmetic. A token fights if it
 * has a printed ability, or a keyword, or a power it can deal damage with.
 * Everything else — a bodiless artifact with no clause, a 0/1 with nothing
 * written on it — can never affect a game except by being a cost somebody pays,
 * so a set that mints one and never names it has printed a picture.
 *
 * Power rather than toughness: a 0/1 chump-blocks once and a real set does print
 * such a token, but the question here is not whether one card is defensible, it
 * is whether the set has a use for the thing it keeps making.
 */
function isCostToken(token: TokenSpec): boolean {
  if (tokenAbilities(token).length > 0) return false;
  if (token.keywords.length > 0) return false;
  return (token.power ?? 0) < 1;
}

/** A token the set mints and no card in it can spend, with the cards that mint it. */
export interface UnspentToken {
  readonly token: TokenSpec;
  /** Ids of the cards whose effects create it, in printing order. */
  readonly mintedBy: readonly string[];
}

/**
 * The tokens this card list mints that nothing in it names.
 *
 * Grouped by token name, because a name is a token: `tokenNameConflicts` already
 * refuses a set where two shapes share one, so one finding per name is one
 * finding per thing the set keeps handing a player. Cards, not entries, for the
 * same reason `setTokens` takes cards — a committed set file has no slots, and
 * the flagship regression reads one.
 */
export function unspentTokens(cards: readonly Card[]): readonly UnspentToken[] {
  const named = new Set(cards.flatMap((card) => printedAbilities(card).flatMap(subtypesNamedBy)));
  const unspent = new Map<string, { readonly token: TokenSpec; readonly mintedBy: string[] }>();
  for (const card of cards) {
    for (const token of tokensCreatedBy(card)) {
      if (!isCostToken(token) || token.subtypes.some((subtype) => named.has(subtype))) continue;
      const seen = unspent.get(token.name);
      if (seen === undefined) unspent.set(token.name, { token, mintedBy: [card.id] });
      else if (!seen.mintedBy.includes(card.id)) seen.mintedBy.push(card.id);
    }
  }
  return [...unspent.values()].map((item) => ({ token: item.token, mintedBy: [...item.mintedBy] }));
}

/** How the finding describes a token that does nothing: its body, or the lack of one. */
function describeCostToken(token: TokenSpec): string {
  return token.power === undefined || token.toughness === undefined
    ? 'a bodiless artifact with no printed ability'
    : `a vanilla ${token.power}/${token.toughness}`;
}

/**
 * Every token the set mints has something in the set that spends it.
 *
 * The mirror of `checkSacrificeSupply`, and the blame is mirrored with it:
 * regenerating the card that drops a Key cannot produce the Chest that opens on
 * one, so the finding goes to the slots the brief reserved for a consumer of
 * that subtype. When the brief named none there is no such slot, and the blame
 * falls back to the minters — which is a repair the loop can actually make, by
 * printing a body instead of a promise.
 */
export function checkTokenDemand(entries: readonly Entry[]): SetFinding[] {
  const slotFor = new Map(entries.map((entry) => [entry.card.id, entry.slot.id]));
  return unspentTokens(entries.map((entry) => entry.card)).map((unspent) => {
    const consumers = entries
      .filter((entry) => {
        const wanted = entry.slot.requiredCard?.sacrificeSubtype;
        return wanted !== undefined && unspent.token.subtypes.includes(wanted);
      })
      .map((entry) => entry.slot.id);
    const minters = unspent.mintedBy.flatMap((cardId) => {
      const slotId = slotFor.get(cardId);
      return slotId === undefined ? [] : [slotId];
    });
    const reach =
      unspent.token.subtypes.length === 0
        ? 'it carries no subtype, so no cost in the set could name it'
        : `no cost, lord or condition in the set names a ${unspent.token.subtypes.join(' ')}`;
    return finding(
      'TOKEN_MINTED_UNSPENT',
      'error',
      `${String(unspent.mintedBy.length)} card(s) create "${unspent.token.name}", ${describeCostToken(unspent.token)}, and ${reach}: it is minted and never spent`,
      consumers.length > 0 ? consumers : minters,
    );
  });
}

/** A mechanic the brief stated, and the words of its vocabulary the set never printed. */
export interface UnprintedMechanic {
  readonly mechanic: DesiredMechanic;
  /** Keywords, effect kinds, ability kinds and trigger conditions, in that order. */
  readonly unprinted: readonly string[];
  /** The stated words the set does print; empty means the mechanic is not in the set at all. */
  readonly printed: readonly string[];
}

/**
 * For each stated mechanic, the words of its own vocabulary the set never
 * printed.
 *
 * Every word, not any word: a mechanic names the keywords, effect kinds, ability
 * kinds and trigger conditions it *is expressed with*, so a stated word the set
 * prints nowhere is a claim the finished cards do not keep. `checkMechanicCoverage`
 * takes the other reading — any one word, at common, in the mechanic's colors —
 * and that reading is why the flagship's Fuse passed on `triggered` while
 * `putCounters` reached one card in two hundred and forty-nine.
 *
 * No color filter here, deliberately. Where a mechanic lives is coverage's
 * question and it is asked at common; this one is "did the set print this at
 * all", and a colorless Chest printing the black-red-green mechanic's
 * `createToken` is a set that prints it. Filtering by color would fail that set
 * for being built the way its own brief describes.
 *
 * The printed half is carried out beside the missing half because the two say
 * different things about the set, and `checkMechanicsPrinted` grades on the
 * difference: a mechanic with nothing printed is a name the cards never earn, a
 * mechanic missing one word of four is narrower than the brief asked for.
 */
export function unprintedMechanics(
  cards: readonly Card[],
  mechanics: readonly DesiredMechanic[],
): readonly UnprintedMechanic[] {
  const keywords = new Set<Keyword>(cards.flatMap(printedKeywords));
  const effectKinds = new Set<AnyEffectKind>(cards.flatMap(printedEffectKinds));
  const abilityKinds = new Set<AbilityKind>(cards.flatMap(printedAbilityKinds));
  const conditions = new Set<TriggerCondition>(cards.flatMap(printedTriggerConditions));

  return mechanics.flatMap((mechanic): UnprintedMechanic[] => {
    const stated: readonly [readonly string[], ReadonlySet<string>][] = [
      [mechanic.keywords, keywords],
      [mechanic.effectKinds, effectKinds],
      [mechanic.abilityKinds, abilityKinds],
      [mechanic.triggerConditions, conditions],
    ];
    const words = stated.flatMap(([asked, seen]) => asked.map((word) => [word, seen.has(word)] as const));
    const unprinted = words.filter(([, seen]) => !seen).map(([word]) => word);
    if (unprinted.length === 0) return [];
    return [{ mechanic, unprinted, printed: words.filter(([, seen]) => seen).map(([word]) => word) }];
  });
}

/** Keywords printed on this card's account, its tokens' included. */
function printedKeywords(card: Card): readonly Keyword[] {
  return [...card.keywords, ...tokensCreatedBy(card).flatMap((token) => token.keywords)];
}

/** Conditions the triggers printed on this card's account watch for. */
function printedTriggerConditions(card: Card): readonly TriggerCondition[] {
  return printedAbilities(card).flatMap((ability) =>
    ability.kind === 'triggered' ? [ability.condition] : [],
  );
}

/**
 * The set prints what its brief said each mechanic is expressed with.
 *
 * Two findings, and the line between them is whether the set prints *any* of the
 * mechanic. Nothing printed is an error: the brief named a mechanic and the
 * finished cards contain no trace of it, which is the failure this check exists
 * to stop a paid run from buying. Some words printed and not others is a warning
 * naming the missing words, because the set does contain the mechanic and the
 * gap is a question of how wide it was drawn — a judgment, and judgment is not
 * this file's. `checkMechanicCoverage` reads whole mechanics the same way, on
 * any-one-word, so the two agree about what "the set has this mechanic" means
 * and disagree only about where it has to be.
 *
 * The severities are also what keeps the check out of the repair loop's way for
 * a gap it cannot repair. Tideglass Reach states `millCards` and prints none:
 * every slot allocated to Undertow already printed the other half of it, so a
 * retry round buys nothing and the run should say so rather than pay for it.
 *
 * Blamed on the slots the allocator gave the mechanic, because those are the
 * slots a retry round can put the missing word on. A mechanic that reached no
 * slot at all blames nothing and still fails the run: no regeneration can add a
 * word to a set with nowhere to print it, and the finding is then about the
 * brief rather than about a card.
 */
export function checkMechanicsPrinted(
  entries: readonly Entry[],
  mechanics: readonly DesiredMechanic[],
): SetFinding[] {
  return unprintedMechanics(
    entries.map((entry) => entry.card),
    mechanics,
  ).map((missed) => {
    const slotIds = entries
      .filter((entry) => entry.slot.mechanics.includes(missed.mechanic.name))
      .map((entry) => entry.slot.id);
    const stated = missed.unprinted.join(', ');
    if (missed.printed.length === 0) {
      return finding(
        'MECHANIC_UNPRINTED',
        'error',
        `mechanic "${missed.mechanic.name}" is stated as ${stated} and the set prints ${missed.unprinted.length === 1 ? 'none of it' : 'none of them'} on any card or token`,
        slotIds,
      );
    }
    return finding(
      'MECHANIC_PARTLY_PRINTED',
      'warning',
      `mechanic "${missed.mechanic.name}" prints ${missed.printed.join(', ')} and never prints ${stated}, so the set carries it more narrowly than the brief states it`,
      slotIds,
    );
  });
}
