/**
 * What a deck can put on the battlefield, counted so a price can read it.
 *
 * `evaluateCard` is a pure function of one card, and four of its multipliers
 * are yes/no questions about the board that the deck itself answers:
 *
 *  - a static narrowed to a subtype (`staticSubtypeReachFactor`) reaches the
 *    creatures of that subtype the deck holds, and no others;
 *  - an `enabledWhile` condition (`enabledWhileFactor`) is on when the deck has
 *    produced what it names — `controlsSubtype` counts permanents,
 *    `anyCreatureHasCounter` asks for one counter of a kind;
 *  - a `withCounter` target restriction (`restrictedTargetFactor`) finds a legal
 *    target only once some card has put that counter on something;
 *  - a typed sacrifice activation cost is payable only as often as the deck
 *    produces a legal permanent, and costs the cheapest legal body
 *    (`mtg-ji87`).
 *
 * Each of the four is a flat weight today, so a Merfolk lord is priced the same
 * in a deck of nine Merfolk and in a deck of none, and a removal spell that reads
 * "target creature with a gloom counter" is priced the same in a deck that
 * prints gloom counters and one that cannot. That is the isolation `mtg-f0nf`
 * describes: the builder's own decks decide those numbers, and the numbers then
 * decide the decks.
 *
 * This module is the answer side. It counts, from a card list, only what those
 * four questions ask about, and turns a count into a probability with the same
 * `hypergeometricAtLeast` machinery `DEFAULT_TOP_END_REACHABILITY` and the mana
 * base already price draws with. Nothing here reads rules text, and nothing
 * here is a new weight: a source is a card whose typed effects or printed
 * subtypes put the named thing onto the battlefield.
 *
 * ## What a source is
 *
 * A card is one source of a subtype when it is a permanent carrying that
 * subtype, or when any effect it prints creates a token carrying it —
 * `printedCardSurface` walks every mode and every ability, because a Part token
 * minted by a triggered ability is a Part the deck controls just as surely as a
 * printed one. Counted once per card per subtype: a card is drawn once.
 *
 * The same walk also records each source's *body*, because a sacrifice cost
 * spends a permanent rather than draws a card, and what it spends has a price.
 * The body is recorded and not priced: this module holds no weights, and an
 * exchange rate written down twice is an exchange rate that will disagree with
 * itself. `evaluate.ts` prices what is recorded here.
 *
 * ## What the probability means
 *
 * "At least `atLeast` of the deck's sources have been drawn by the turn a
 * median game ends, on the play." It says drawn, not resolved and not still
 * alive, which makes it a deliberately generous upper bound — the same bound
 * `DEFAULT_TOP_END_REACHABILITY` states about itself for the same reason. The
 * alternative is a survival model this package has no data for.
 *
 * ## A zero is a measurement; an absence is `null` (`mtg-z751`)
 *
 * Two different things can be true of a deck-conditioned question, and this
 * module distinguishes them in the return type rather than in a caller's head:
 *
 *  - **The deck answers it, and the answer is no.** `supply` returns `0` when
 *    the deck holds fewer sources than the clause needs, and every function
 *    here inherits it: `subtypeSupply` for a subtype the deck never prints,
 *    `counterSupply` for a counter no card in it places, and `conditionSupply`
 *    for a `controlsSubtype` naming neither. Zero is the measurement, and it
 *    is meant to sit *below* the flat weight it replaces. Every deck-
 *    conditioned factor in `evaluate.ts` cuts both ways or it buys nothing.
 *    `mtg-ibk4` measured "destroy target creature with a hide counter on it"
 *    at 1.700 with no deck and 2.681 in a pool minting five, and the same
 *    spell in a deck minting none belongs below 1.700 for the same reason it
 *    belongs above it there: it will never have a legal target. What made that
 *    bead expensive was a census bug that reported zero supply for a deck that
 *    had it (0.400 against the correct 2.681), which is a wrong measurement
 *    and not an argument against measuring.
 *  - **The deck does not answer it.** `conditionSupply` returns `null` for the
 *    five conditions that depend on the opponent, the turn, or both sides of
 *    the battlefield, and its own docblock argues each. `null` is not a small
 *    number: it means this module has no reading, so the caller keeps whatever
 *    context-free weight it had.
 *
 * ## The other deck, which this module carries rather than counts
 *
 * Three of `evaluate.ts`'s prices are decided by the *opposing* deck: how often
 * a landwalk finds the basic land type it names, and how often a protection
 * meets the color or the creature type it names. No count of the cards handed
 * to this module answers any of them. `format-context.ts` measures them off the
 * set the deck is being built for, `formatContextOf` below runs the creature
 * half through this module's own walk, and `DeckContext.format` carries the
 * answer to the same call sites the rest of it reaches.
 *
 * `evaluate.ts` applies the same rule and spells the second half differently,
 * which is worth knowing before reading the two side by side.
 * `targetNarrowingFactor` has no `null` arm because it never asks: it consults
 * a `DeckContext` for the one restriction kind a deck decides for itself
 * (`withCounter`) and goes straight to the flat `restrictedTargetFactor` for
 * the six it does not. Not asking and being answered `null` are the same
 * decision reached one step earlier.
 */
import type {
  Card,
  Color,
  Condition,
  CounterKind,
  Effect,
  Keyword,
  KeywordAbility,
  PrintedAbility,
  TargetFilter,
} from '@mtg/dsl';
import {
  assertNever,
  cardManaValue,
  isCreature,
  isCreatureTokenSpec,
  isPermanentCard,
  printedCardSurface,
  printedCardTypes,
  tokenCard,
} from '@mtg/dsl';
import type { CardScoreWeights, DeckBuildConfig } from './config';
import { activationRate, isRemovalCard } from './evaluate';
import type { FormatContext } from './format-context';
import { colorKey, colorSharesOf } from './format-context';
import { hypergeometricAtLeast, hypergeometricWeightedAtLeast } from './hypergeometric';
import { tokenCount } from './token-count';

/**
 * A permanent a deck can put onto the battlefield, reduced to what pricing it
 * as a body needs.
 *
 * `null` is a permanent with no body — a bodiless Part token, an artifact, an
 * enchantment — which is exactly the distinction `isCreatureTokenSpec` already
 * makes and which `tokenValue` already prices at its abilities and nothing
 * else. It is a separate spelling rather than a 0/0, because a 0/0 would be
 * credited the flat premium every creature receives and a Part is not a
 * creature.
 */
export interface SubtypeBody {
  readonly power: number;
  readonly toughness: number;
  /**
   * The permanent's printed colors, which `intimidate` is priced against: what
   * a creature with it gets past is decided by the colors it does not share
   * with the format, so a body that could not say its own colors could not be
   * priced for carrying the word.
   */
  readonly colors: readonly Color[];
  readonly keywords: readonly Keyword[];
  /**
   * The card's second keyword vocabulary, and always empty for a token: a
   * `TokenSpec` carries `keywords` and has no `keywordAbilities` field to
   * carry, so an indestructible token is not a thing the DSL can express.
   * Required rather than optional so a new body site cannot omit it and price
   * six abilities at zero, which is the bug `mtg-gloz` names.
   */
  readonly keywordAbilities: readonly KeywordAbility[];
}

/** One permanent a card can supply, reduced to the printed traits a cost filters on. */
export interface PermanentSupply {
  readonly cardTypes: readonly Card['kind'][];
  readonly subtypes: readonly string[];
  readonly colors: readonly Card['colors'][number][];
  readonly keywords: readonly Keyword[];
  readonly manaValue: number;
  readonly body: SubtypeBody | null;
  /**
   * How many of this permanent the card puts on the battlefield at once: one
   * for the card itself, and the printed numeral for a token it mints
   * (`mtg-x2gb`).
   *
   * The count a clause eats is a count of permanents and the deck supplies them
   * a card at a time, so the two numbers are different and this is the one that
   * was missing: a card minting two Parts used to be one Part to a clause that
   * ate two, which made every multi-mint card understate itself by its own
   * multiplicity. `tokenCount` is the shared reading of an unprinted numeral,
   * so the price of the bodies and the supply of them cannot disagree.
   */
  readonly count: number;
}

/** Compile-time inventory: a new filter field cannot become an ignored deck-price constraint. */
export const TARGET_FILTER_FIELD_COVERAGE = {
  cardTypes: true,
  allCardTypes: true,
  excludeCardTypes: true,
  subtypes: true,
  colors: true,
  excludeColors: true,
  monocolored: true,
  keywords: true,
  excludeKeywords: true,
  combat: true,
  dealtDamageThisTurn: true,
  maxManaValue: true,
} as const satisfies Readonly<Record<keyof TargetFilter, true>>;

/**
 * The deck's supply, counted once and read many times.
 *
 * The *sources* here are cards, never permanents: the hypergeometric below asks
 * how many of the deck's forty cards are sources, and a card that mints two
 * tokens is still one card to draw. What that card puts on the battlefield when
 * it is drawn is `permanentSources`, whose entries carry their own `count`, so
 * a clause that eats two permanents can ask how many permanents the deck makes
 * without losing the one-card-one-draw arithmetic underneath (`mtg-x2gb`).
 */
export interface DeckContext {
  /** Cards that can put a permanent carrying this subtype onto the battlefield. */
  readonly subtypeSources: ReadonlyMap<string, number>;
  /**
   * The bodies those sources put there, so a price can ask what spending one
   * costs rather than only how likely one is.
   *
   * One entry per source per subtype, and deliberately not one per permanent: a
   * card minting two of the same token contributes one body, because the
   * question this answers is what *one* of them is worth to spend, and how many
   * there are is `permanentSources` one field down. A card that both carries a
   * subtype and mints a token of it contributes both, because they are two
   * different permanents with two different prices.
   */
  readonly subtypeBodies: ReadonlyMap<string, readonly (SubtypeBody | null)[]>;
  /** Permanent outputs grouped by the card drawn to supply them. */
  readonly permanentSources: readonly (readonly PermanentSupply[])[];
  /**
   * The counter kinds each card can put onto a creature, one entry per card in
   * the deck that can put on any.
   *
   * A list of sets rather than a count per kind, because `countWithCounter`
   * names a *list* of counters and is paid per permanent carrying any of them
   * (`mtg-cosl`). Summing per-kind counts would count a card that places two of
   * the named kinds twice, and a card is drawn once — the same
   * one-card-one-draw arithmetic `permanentSources` is grouped to keep.
   */
  readonly counterSources: readonly ReadonlySet<CounterKind>[];
  /** Cards that can put any creature onto the battlefield: the subtype denominator. */
  readonly creatureSources: number;
  /**
   * Cards in the deck that answer a creature: the ordinal `evaluateCard`
   * discounts a removal premium by.
   *
   * A count rather than a list, because the only question asked of it is how
   * many answers deep this deck already is. It counts the card being priced,
   * the same way every other field here does, so a candidate's own ordinal is
   * this number rather than this number plus one.
   */
  readonly removalSources: number;
  /** The finished deck's size, lands included: the population drawn from. */
  readonly deckSize: number;
  /** Cards seen by the turn a median game ends, on the play. */
  readonly draws: number;
  /**
   * What the rest of the format is made of, or `null` when nobody said.
   *
   * The three prices `format-context.ts` names are decided by the opposing
   * deck rather than by this one, so they are not questions a `DeckContext`
   * can answer out of the cards it counted. It carries the answer rather than
   * computing it: every function in `evaluate.ts` that prices a card already
   * threads a `DeckContext`, and threading a second parameter beside it to
   * every one of them would be the same value taking two seats.
   *
   * `null` is `DeckBuildConfig.set` being null, which is a caller that did not
   * state the set — a fixture, or a pool with no set behind it. It is the
   * `conditionSupply` spelling of absence rather than the `subtypeSupply`
   * spelling of zero: no reading was taken, so the constants `config.ts`
   * derived stand.
   */
  readonly format: FormatContext | null;
}

/** The body a permanent card prints, or `null` when it is not a creature. */
function cardBody(card: Card): SubtypeBody | null {
  return isCreature(card)
    ? {
        power: card.power,
        toughness: card.toughness,
        colors: card.colors,
        keywords: card.keywords,
        keywordAbilities: card.keywordAbilities ?? [],
      }
    : null;
}

/**
 * Every permanent one card can put on the battlefield, printed or minted, with
 * the characteristics a typed sacrifice filter can read.
 *
 * The one walk both counts read, so the set of subtypes a card supplies and the
 * bodies it supplies them as can never disagree about what the card does.
 */
function permanentSupply(card: Card, count: number): PermanentSupply {
  return {
    cardTypes: printedCardTypes(card),
    subtypes: card.subtypes,
    colors: card.colors,
    keywords: card.keywords,
    manaValue: cardManaValue(card),
    body: cardBody(card),
    count,
  };
}

/**
 * How many times an ability printed on a card is expected to happen, which is
 * what the permanents it mints are multiplied by.
 *
 * The two weights the pricing arm already multiplies an ability's effects by:
 * `triggerFireCount` for a trigger and `activationRate` for an activation, both
 * from `evaluate.ts`, so a supply of a token and a price of the same token
 * cannot disagree about how often it is minted. "At the beginning of your
 * upkeep, create a Soldier" fires 2.511 times in a median game and used to
 * supply one Soldier, which read every repeating minter in the format as a
 * one-shot (`mtg-dmvw`).
 *
 * What is deliberately not shared is `activationUses`'s supply factors. They
 * ask the deck what it can afford to sacrifice, and the deck is what this walk
 * is building, so a cost that eats another permanent is counted here as always
 * payable. That overstates in the same direction the flat one did, and by less.
 */
function mintRate(ability: PrintedAbility, weights: CardScoreWeights): number {
  if (ability.kind === 'triggered') return weights.triggerFireCount[ability.condition];
  if (ability.kind === 'activated') return activationRate(ability.cost, weights);
  return 1;
}

/**
 * The rate each minting effect happens at, keyed by the effect itself.
 *
 * Keyed by identity because `printedCardSurface` hands back the card's effects
 * flattened out of the abilities that print them, and the supply walk needs the
 * ability back. Identity is what survives the flattening: the surface spreads
 * the very arrays the abilities hold, so the `createToken` the walk meets is the
 * object the ability printed. Reading the abilities in a second descent of this
 * module's own would be a second chance to stop at a different depth than the
 * one function that owns the descent.
 *
 * A card's own spell effects are absent and default to once, which is what a
 * spell does. So is the compounding of a nested token tier: a token minted by a
 * token's ability takes that ability's rate and not its parent's, because the
 * surface has already flattened away which token printed it.
 */
function mintRates(card: Card, weights: CardScoreWeights): ReadonlyMap<Effect, number> {
  const rates = new Map<Effect, number>();
  for (const ability of printedCardSurface(card).abilities) {
    if (!('effects' in ability)) continue;
    const rate = mintRate(ability, weights);
    if (rate === 1) continue;
    const modes = 'modes' in ability ? (ability.modes ?? []) : [];
    for (const effect of [...ability.effects, ...modes.flatMap((mode) => mode.effects)]) {
      rates.set(effect, rate);
    }
  }
  return rates;
}

/**
 * The tokens are read off the `createToken` effects rather than off
 * `printedCardSurface`'s `tokens`, which is the same set of tokens with the
 * numeral in front of each one dropped: `tokens` is a list of specs and the
 * count lives on the effect that names one. The walk is the same depth, because
 * `effects` is the card's own effects followed by the ones printed on the
 * tokens it makes, and every token in `tokens` was minted by a `createToken` in
 * exactly one of those.
 *
 * The printed numeral is multiplied by `mintRates`, and the product is rounded
 * to a whole permanent with a floor of one. Whole because a yield is a count of
 * cards' worth of permanents and `hypergeometricWeightedAtLeast` counts subsets;
 * a floor of one because a card that mints at all is a source, and a trigger
 * that fires less than once in a median game (a death trigger fires 0.463 times)
 * would otherwise round out of its own deck's census and be measured as a hard
 * zero, which this module reserves for a deck that truly cannot supply a clause.
 */
function suppliedPermanents(card: Card, rates: ReadonlyMap<Effect, number>): readonly PermanentSupply[] {
  const supplied: PermanentSupply[] = [];
  if (isPermanentCard(card)) supplied.push(permanentSupply(card, 1));
  for (const effect of printedCardSurface(card).effects) {
    if (effect.kind !== 'createToken') continue;
    const minted = tokenCount(effect.count) * (rates.get(effect) ?? 1);
    supplied.push(permanentSupply(tokenCard(effect.token), Math.max(1, Math.round(minted))));
  }
  return supplied;
}

/**
 * Every counter kind one card can place, from anywhere on it — including from
 * inside a token it mints.
 *
 * The descent is the same one `suppliedPermanents` and `makesCreature` already make,
 * and for the same reason: a permanent this card puts on the battlefield is this
 * card's doing whether it was printed or minted. It used to stop at the first
 * layer, which made the whole part mechanic invisible — a part is a token whose
 * activated ability is what fits the counter, so eleven of the thirteen cards in
 * the flagship that mint a part counter contributed nothing here, and four of
 * the five part counters measured zero supply in a pool built entirely of
 * minters (`mtg-ibk4`).
 *
 * The one-layer depth and its schema proof live with `printedCardSurface` in
 * `@mtg/dsl`; this consumer asks for the resulting effects rather than
 * transcribing the descent again.
 */
function countersOf(card: Card): ReadonlySet<CounterKind> {
  const found = new Set<CounterKind>();
  for (const effect of printedCardSurface(card).effects) {
    if (effect.kind === 'putCounters') found.add(effect.counter);
  }
  return found;
}

/** True when the card itself, or a token it mints, is a creature. */
function makesCreature(card: Card): boolean {
  if (isCreature(card)) return true;
  return printedCardSurface(card).tokens.some(isCreatureTokenSpec);
}

/**
 * How many cards a player has seen by the turn a median game ends, on the play.
 *
 * The opening hand plus one draw for every round after the first, which is
 * `DEFAULT_TOP_END_REACHABILITY`'s own count restated against the config the
 * caller actually passed rather than against this format's constants.
 */
export function deckDraws(config: DeckBuildConfig): number {
  const afterTheFirst = Math.max(0, config.weights.formatMedianRounds - 1);
  const onTheDraw = config.manaBase.onThePlay ? 0 : 1;
  return Math.min(config.deckSize, config.manaBase.openingHandSize + afterTheFirst + onTheDraw);
}

/** The rates a walk with no deck to weight against reads: none, so every one. */
const NO_MINT_RATES: ReadonlyMap<Effect, number> = new Map();

function increment<K>(counts: Map<K, number>, keys: Iterable<K>): void {
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
}

/** Files one card's supplied permanents into the two maps that read that walk. */
function record(
  subtypeSources: Map<string, number>,
  subtypeBodies: Map<string, (SubtypeBody | null)[]>,
  permanentSources: (readonly PermanentSupply[])[],
  card: Card,
  weights: CardScoreWeights,
): void {
  const supplied = suppliedPermanents(card, mintRates(card, weights));
  permanentSources.push(supplied);
  increment(subtypeSources, new Set(supplied.flatMap((permanent) => permanent.subtypes)));
  for (const permanent of supplied) {
    for (const subtype of permanent.subtypes) {
      const bodies = subtypeBodies.get(subtype);
      if (bodies === undefined) subtypeBodies.set(subtype, [permanent.body]);
      else bodies.push(permanent.body);
    }
  }
}

/**
 * Files one card's counter kinds, and files nothing for a card that places
 * none: the entries are the deck's counter *sources*, so an empty set would be
 * a source of nothing taking a seat in every count taken over the list.
 */
function recordCounters(counterSources: ReadonlySet<CounterKind>[], card: Card): void {
  const placed = countersOf(card);
  if (placed.size > 0) counterSources.push(placed);
}

/** Counts what `cards` supply, against the finished deck size `config` states. */
export function deckContextOf(cards: readonly Card[], config: DeckBuildConfig): DeckContext {
  const subtypeSources = new Map<string, number>();
  const subtypeBodies = new Map<string, (SubtypeBody | null)[]>();
  const permanentSources: (readonly PermanentSupply[])[] = [];
  const counterSources: ReadonlySet<CounterKind>[] = [];
  let creatureSources = 0;
  let removalSources = 0;
  for (const card of cards) {
    record(subtypeSources, subtypeBodies, permanentSources, card, config.weights);
    recordCounters(counterSources, card);
    if (makesCreature(card)) creatureSources += 1;
    if (isRemovalCard(card, config.weights)) removalSources += 1;
  }
  return {
    subtypeSources,
    subtypeBodies,
    permanentSources,
    counterSources,
    creatureSources,
    removalSources,
    deckSize: config.deckSize,
    draws: deckDraws(config),
    format: config.set === null ? null : formatContextOf(config.set),
  };
}

/**
 * The same context with one more card in it.
 *
 * The candidate being priced is part of the deck it is being priced for — a
 * creature that reads "as long as you control a Merfolk" and is itself a Merfolk
 * turns itself on — so every caller that prices a card against a deck adds it
 * first. Copying the three maps is cheap next to re-walking twenty-three cards,
 * and it keeps `DeckContext` immutable, which is what makes a re-priced pool a
 * pure function of the pool. The body lists are copied too, not shared: a
 * shared array would be appended to by the next candidate priced against the
 * same base and every candidate after it would see the one before it.
 */
export function deckContextWith(context: DeckContext, card: Card, weights: CardScoreWeights): DeckContext {
  const subtypeSources = new Map(context.subtypeSources);
  const subtypeBodies = new Map<string, (SubtypeBody | null)[]>(
    [...context.subtypeBodies].map(([subtype, bodies]) => [subtype, [...bodies]]),
  );
  const counterSources = [...context.counterSources];
  const permanentSources = [...context.permanentSources];
  record(subtypeSources, subtypeBodies, permanentSources, card, weights);
  recordCounters(counterSources, card);
  return {
    subtypeSources,
    subtypeBodies,
    permanentSources,
    counterSources,
    creatureSources: context.creatureSources + (makesCreature(card) ? 1 : 0),
    removalSources: context.removalSources + (isRemovalCard(card, weights) ? 1 : 0),
    deckSize: context.deckSize,
    draws: context.draws,
    format: context.format,
  };
}

/**
 * The share of the deck's creatures that carry a subtype.
 *
 * This is what a subtype narrowing does to a static's reach: an anthem that
 * reaches three creatures reaches the ones of the named subtype, so its reach
 * is scaled by how much of the deck's creature base that is. Zero creatures is
 * zero reach rather than an error — a deck with no creatures gains nothing from
 * an anthem, which is the honest answer and not a division by zero.
 */
export function subtypeShare(context: DeckContext, subtype: string): number {
  return creatureShare(context.subtypeSources.get(subtype) ?? 0, context.creatureSources);
}

/**
 * Sources of a subtype over sources of a creature, clamped at one.
 *
 * One formula, because `formatContextOf` below asks the same question of a
 * whole set and two spellings of it would be two chances to disagree about a
 * deck of tokens. Zero creatures is zero share rather than an error, which is
 * `subtypeShare`'s own sentence about an anthem in a deck with nothing to
 * anthem.
 */
function creatureShare(sources: number, creatureSources: number): number {
  if (creatureSources === 0) return 0;
  return Math.min(1, sources / creatureSources);
}

/**
 * One census per set, keyed on the list itself.
 *
 * A performance decision with a correctness argument behind it: the set is
 * walked once per `deckContextOf` otherwise, which is once per card the builder
 * adds to a deck, and the census is a pure function of the array so an
 * identity-keyed memo cannot go stale. Weak, so a set stops being held the
 * moment its caller drops it.
 */
const FORMAT_CONTEXTS = new WeakMap<readonly Card[], FormatContext>();

/**
 * The format's census, from the set's own card list.
 *
 * The creature half is this module's walk — `suppliedPermanents` and
 * `makesCreature`, the same two functions `deckContextOf` counts a deck with —
 * so "a card that can put a Merfolk on the battlefield" means one thing in this
 * package, whether the cards being counted are a deck or a set. That walk
 * answers two questions off one pass: what subtypes the format's creatures
 * carry, and what colors they can block by. The deck half of the census is
 * `colorSharesOf`, which needs no walk and lives with the rest of
 * `format-context.ts`.
 *
 * The two creature counts are deliberately the same denominator. A card is one
 * card here however many creatures it supplies, because `creatureSources`
 * counts cards and a share of it has to be counted the same way to be a share
 * of anything.
 */
export function formatContextOf(set: readonly Card[]): FormatContext {
  const memoized = FORMAT_CONTEXTS.get(set);
  if (memoized !== undefined) return memoized;
  const subtypeSources = new Map<string, number>();
  const colorBlockers = new Map<string, number>();
  let creatureSources = 0;
  for (const card of set) {
    // No rates: a format census reads what a card can supply and never how
    // many, and the weights a rate needs belong to a deck build rather than to
    // the set this walks.
    const supplied = suppliedPermanents(card, NO_MINT_RATES);
    increment(subtypeSources, new Set(supplied.flatMap((permanent) => permanent.subtypes)));
    if (!makesCreature(card)) continue;
    creatureSources += 1;
    const creatures = supplied.filter((permanent) => permanent.body !== null);
    // An artifact creature blocks an intimidator whatever colors either of them
    // is, so this card answers no color's question and is left out of the map
    // it would otherwise be counted in. It stays in `creatureSources`, which is
    // what makes the missing entry subtract from every attacker's share.
    if (creatures.some((permanent) => permanent.cardTypes.includes('artifact'))) continue;
    increment(colorBlockers, [colorKey(creatures.flatMap((permanent) => permanent.colors))]);
  }
  const context: FormatContext = {
    colorShares: colorSharesOf(set),
    creatureSubtypeShares: new Map(
      [...subtypeSources].map(([subtype, sources]) => [subtype, creatureShare(sources, creatureSources)]),
    ),
    colorBlockerShares: new Map(
      [...colorBlockers].map(([key, sources]) => [key, creatureShare(sources, creatureSources)]),
    ),
  };
  FORMAT_CONTEXTS.set(set, context);
  return context;
}

/**
 * The chance the deck has drawn `atLeast` *permanents* of a subtype by the
 * median turn.
 *
 * Permanents, not cards (`mtg-x2gb`). The clauses that read this are a typed
 * sacrifice cost and a `controlsSubtype` condition, and both count what is on
 * the battlefield: a clause that eats two Parts is paid by one card that mints
 * two of them. Counting the sources instead made a multi-mint card understate
 * itself by its own multiplicity, and both halves of that are printed in the
 * regression fixtures: a permanent can mint three objects while another
 * consumes two. The supply calculation counts those objects, not just the
 * cards that created them.
 */
export function subtypeSupply(context: DeckContext, subtype: string, atLeast: number): number {
  return permanentSupplyFor(context, (permanent) => permanent.subtypes.includes(subtype), atLeast);
}

function anyOf<T>(wanted: readonly T[] | undefined, present: readonly T[]): boolean {
  return wanted === undefined || wanted.some((value) => present.includes(value));
}

function allOf<T>(wanted: readonly T[] | undefined, present: readonly T[]): boolean {
  return wanted === undefined || wanted.every((value) => present.includes(value));
}

function noneOf<T>(refused: readonly T[] | undefined, present: readonly T[]): boolean {
  return refused === undefined || !refused.some((value) => present.includes(value));
}

function permanentMatches(filter: TargetFilter, permanent: PermanentSupply): boolean {
  return (
    anyOf(filter.cardTypes, permanent.cardTypes) &&
    allOf(filter.allCardTypes, permanent.cardTypes) &&
    noneOf(filter.excludeCardTypes, permanent.cardTypes) &&
    anyOf(filter.subtypes, permanent.subtypes) &&
    anyOf(filter.colors, permanent.colors) &&
    noneOf(filter.excludeColors, permanent.colors) &&
    (filter.monocolored !== true || permanent.colors.length === 1) &&
    allOf(filter.keywords, permanent.keywords) &&
    noneOf(filter.excludeKeywords, permanent.keywords) &&
    (filter.maxManaValue === undefined || permanent.manaValue <= filter.maxManaValue)
  );
}

/**
 * Chance that a deck has drawn enough sources for a filtered sacrifice.
 *
 * A combat-role filter depends on the live turn rather than the deck list, so
 * it has no deck-derived answer. `null` lets the caller keep its context-free
 * assumption instead of pretending every supplied permanent is attacking or
 * blocking.
 */
export function matchingPermanentSupply(
  context: DeckContext,
  filter: TargetFilter,
  atLeast: number,
): number | null {
  if (filter.combat !== undefined || filter.dealtDamageThisTurn !== undefined) return null;
  return permanentSupplyFor(context, (permanent) => permanentMatches(filter, permanent), atLeast);
}

/** Cheapest printed body a filtered sacrifice can consume, or `null` when live combat decides. */
export function matchingPermanentBodies(
  context: DeckContext,
  filter: TargetFilter,
): readonly (SubtypeBody | null)[] | null {
  if (filter.combat !== undefined || filter.dealtDamageThisTurn !== undefined) return null;
  return context.permanentSources.flatMap((permanents) =>
    permanents.filter((permanent) => permanentMatches(filter, permanent)).map((permanent) => permanent.body),
  );
}

/** The chance the deck has drawn something that places this counter. */
export function counterSupply(context: DeckContext, counter: CounterKind): number {
  return supply(context, counterSourceCount(context, [counter]), 1);
}

/** How many of the deck's cards can place at least one of `counters`. */
export function counterSourceCount(context: DeckContext, counters: readonly CounterKind[]): number {
  return context.counterSources.filter((placed) => counters.some((counter) => placed.has(counter))).length;
}

/**
 * How many permanents carrying one of `counters` the deck is expected to have
 * put onto the battlefield by the turn a median game ends.
 *
 * The mean of the same hypergeometric `counterSupply` takes the tail of —
 * `sources * draws / deckSize`, the expected number of counter-placing cards
 * drawn. The two questions differ because the cards asking them differ:
 * "destroy target creature with a hide counter on it" needs one bearer to
 * exist, and a card paid *per* bearer needs to know how many there will be.
 *
 * **One bearer per source card**, which is the model rather than an oversight.
 * A `putCounters` places its `count` counters on the permanent it names, so
 * three counters on one creature is one bearer; what actually varies is how
 * many permanents a source reaches, and a scoped placement reaches its whole
 * group. Counting the group would take the scope-reach weight, which is a
 * pricing tunable `evaluate.ts` holds and this module does not, so a scoped
 * minter counts as one and the estimate is a floor for the deck that holds one.
 *
 * No `null` arm. A deck that places none of these counters is expected to
 * control none of their bearers, and zero is the measurement the module
 * docblock argues for rather than a fallback. The flat
 * `computedAmountAssumption` covers the caller with no deck at all, and that
 * caller never reaches this function.
 */
export function expectedCounterBearers(context: DeckContext, counters: readonly CounterKind[]): number {
  if (context.deckSize <= 0) return 0;
  const sources = Math.min(counterSourceCount(context, counters), context.deckSize);
  return (sources * context.draws) / context.deckSize;
}

/**
 * The chance the deck has drawn something that puts a creature on the
 * battlefield at all.
 *
 * `creatureSources` counts cards rather than permanents — a share of it is a
 * share of a card list, and `permanentSources` is the field that carries
 * multiplicity — so this is the chance one of those cards has been seen by the
 * turn a median game ends.
 *
 * No price reads it any more. The clone clause that did now takes the
 * expectation over *which* creature was drawn rather than over whether one was
 * (`expectedBestDrawnBody` below), and this is that expectation's special case,
 * the one where every body on offer is worth the same. It stays because it is
 * the comparison: `clone-body.test.ts` pins the two models against each other.
 */
export function creatureSupply(context: DeckContext): number {
  return supply(context, context.creatureSources, 1);
}

/**
 * Every creature body the deck can put onto the battlefield, printed or minted.
 *
 * The bodiless permanents are dropped rather than returned as zeroes, for the
 * reason `SubtypeBody | null` exists at all: a Part token is not a 0/0 creature
 * and a caller ranking bodies must not be handed one. One entry per permanent a
 * card supplies, so a card minting two different creature tokens contributes
 * two, which is the right count for a question about which body is on the
 * battlefield rather than about how many cards supply one.
 */
export function creatureBodies(context: DeckContext): readonly SubtypeBody[] {
  return context.permanentSources.flatMap((permanents) =>
    permanents.flatMap((permanent) => (permanent.body === null ? [] : [permanent.body])),
  );
}

/**
 * What the best body the deck has *drawn* is expected to be worth, where
 * `gainOf` says what one body on the battlefield would be worth to the caller
 * (`mtg-v9zo`).
 *
 * The question a clone asks is not "can this deck supply a big creature" but
 * "how big is the creature that got drawn". Reading the maximum over the whole
 * deck list and scaling it by `creatureSupply` answers the first and prices the
 * second: it pays the deck's single best body every time any creature at all
 * has been seen, which is the one case where the drawn creature is certainly
 * the best one. Conditional on some creature being out, the one that is out is
 * usually not the best one, and the gap widens with every mediocre creature the
 * deck adds — the flat maximum does not move, and the chance the drawn body is
 * that maximum falls.
 *
 * The expectation is exact and needs no new data. Sort the per-card gains
 * descending as `g[1] >= g[2] >= ... >= g[n]`; the drawn maximum is at least
 * `g[k]` exactly when at least one of the first `k` cards has been drawn, so
 *
 *     E[max] = sum over k of (g[k] - g[k + 1]) * P(one of the top k drawn)
 *
 * with `g[n + 1]` zero. Every probability in that sum is the hypergeometric
 * `creatureSupply` already asks, at a different source count, so this reads the
 * same draw model the rest of the module does and adds no weight.
 *
 * **One gain per card, not per permanent**, because the draw is over cards:
 * drawing a card that mints two bodies puts both on offer at once, so it hands
 * its own best. A card that supplies no body at all gains nothing and is
 * dropped, which is what makes "the top `k`" a count of *sources* — the number
 * `supply` wants.
 *
 * A gain rather than a value, so the currency and the floor stay with the
 * caller: this module holds no weights, and a clause that says *may* declines a
 * body worse than what it already has by handing back a zero for it.
 */
export function expectedBestDrawnBody(context: DeckContext, gainOf: (body: SubtypeBody) => number): number {
  const gains = context.permanentSources
    .map((permanents) =>
      permanents.reduce(
        (best, permanent) => (permanent.body === null ? best : Math.max(best, gainOf(permanent.body))),
        0,
      ),
    )
    .filter((gain) => gain > 0)
    .sort((left, right) => right - left);
  return gains.reduce(
    (expected, gain, index) => expected + (gain - (gains[index + 1] ?? 0)) * supply(context, index + 1, 1),
    0,
  );
}

/**
 * The chance the deck has drawn `atLeast` permanents that `matches` accepts.
 *
 * One yield per card, because one card is one draw: a card supplying three
 * matching permanents is a single source worth three, and `hypergeometricWeightedAtLeast`
 * is the plain hypergeometric with exactly that distinction in it. A card
 * supplying none is dropped rather than counted as a zero-yield source, which
 * is the same list `supply` would have counted.
 *
 * The three is `suppliedPermanents`' count, which is the printed numeral times
 * how often the ability printing it fires — an end-step minter is one source
 * worth three rather than one source worth one.
 *
 * A source list longer than the stated deck keeps its largest yields, which is
 * `supply`'s own `Math.min(sources, deckSize)` clamp said about a weighted
 * list: a pool priced against a smaller finished deck cannot have all of it in
 * the deck, and the clause is being asked what the deck can do at its best.
 */
function permanentSupplyFor(
  context: DeckContext,
  matches: (permanent: PermanentSupply) => boolean,
  atLeast: number,
): number {
  if (atLeast <= 0) return 1;
  const yields = context.permanentSources
    .map((permanents) =>
      permanents.reduce((sum, permanent) => (matches(permanent) ? sum + permanent.count : sum), 0),
    )
    .filter((yielded) => yielded > 0);
  const drawable =
    yields.length <= context.deckSize
      ? yields
      : [...yields].sort((left, right) => right - left).slice(0, context.deckSize);
  return hypergeometricWeightedAtLeast(drawable, atLeast, context.draws, context.deckSize);
}

/**
 * The one place a zero is produced, and it is a measurement rather than a
 * fallback: a deck that holds fewer sources than the clause names supplies it
 * never. The module docblock's "A zero is a measurement" section argues why
 * that is not softened toward the flat weight it replaces.
 */
function supply(context: DeckContext, sources: number, atLeast: number): number {
  if (atLeast <= 0) return 1;
  if (sources < atLeast) return 0;
  return hypergeometricAtLeast(atLeast, Math.min(sources, context.deckSize), context.draws, context.deckSize);
}

/**
 * The chance the deck can turn on an `enabledWhile` condition, or `null` when
 * the deck is not what turns it on.
 *
 * `null` is the absence of a reading and never a measured no: a condition this
 * deck simply fails to supply comes back as a hard zero, by the module
 * docblock's rule. `null` rather than a number, because two conditions are
 * self-supplied and three are not: `controlsSubtype` counts permanents this deck
 * prints and `anyCreatureHasCounter` asks for a counter some card in it places,
 * so a deck that names neither turns them on never and the hypergeometric
 * answer is the true one. The other three depend on the opponent, turn
 * history, or both sides of the battlefield, none of which this deck list can
 * predict. Answering zero would price a real static at nothing and answering
 * one would price it as unconditional, so the honest return is the absence of
 * an answer and the caller keeps its context-free assumption.
 */
export function conditionSupply(context: DeckContext, condition: Condition): number | null {
  switch (condition.kind) {
    case 'controlsSubtype':
      return subtypeSupply(context, condition.subtype, condition.atLeast);
    case 'anyCreatureHasCounter':
      return counterSupply(context, condition.counter);
    case 'opponentGraveyardAtLeast':
      return null;
    case 'opponentUndamagedThisTurn':
    case 'controllerLifeAtLeast':
    case 'controllerLifeBelow':
    case 'controllerLibraryAtLeast':
    case 'controllerTopLibraryHasColor':
    case 'battlefieldCountBelow':
      return null;
    case 'controlsNoneOfSubtypes': {
      const matching = matchingPermanentSupply(context, { subtypes: condition.subtypes }, 1);
      return matching === null ? null : 1 - matching;
    }
    case 'selfCounterCountBelow':
    case 'selfCounterCountAtLeast':
      return null;
    default:
      return assertNever(condition, 'conditionSupply');
  }
}
