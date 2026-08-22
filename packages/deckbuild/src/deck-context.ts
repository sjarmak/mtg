/**
 * What a deck can put on the battlefield, counted so a price can read it.
 *
 * `evaluateCard` is a pure function of one card, and three of its multipliers
 * are yes/no questions about the board that the deck itself answers:
 *
 *  - a static narrowed to a subtype (`staticSubtypeReachFactor`) reaches the
 *    creatures of that subtype the deck holds, and no others;
 *  - an `enabledWhile` condition (`enabledWhileFactor`) is on when the deck has
 *    produced what it names — `controlsSubtype` counts permanents,
 *    `anyCreatureHasCounter` asks for one counter of a kind;
 *  - a `withCounter` target restriction (`restrictedTargetFactor`) finds a legal
 *    target only once some card has put that counter on something;
 *  - a `sacrificeOther` activation cost is payable only as often as the deck
 *    produces the permanent it names, and costs whatever that permanent was
 *    worth (`mtg-ji87`).
 *
 * Each of the three is a flat weight today, so a Merfolk lord is priced the same
 * in a deck of nine Merfolk and in a deck of none, and a removal spell that reads
 * "target creature with a gloom counter" is priced the same in a deck that
 * prints gloom counters and one that cannot. That is the isolation `mtg-f0nf`
 * describes: the builder's own decks decide those numbers, and the numbers then
 * decide the decks.
 *
 * This module is the answer side. It counts, from a card list, only what those
 * three questions ask about, and turns a count into a probability with the same
 * `hypergeometricAtLeast` machinery `DEFAULT_TOP_END_REACHABILITY` and the mana
 * base already price draws with. Nothing here reads rules text, and nothing
 * here is a new weight: a source is a card whose typed effects or printed
 * subtypes put the named thing onto the battlefield.
 *
 * ## What a source is
 *
 * A card is one source of a subtype when it is a permanent carrying that
 * subtype, or when any effect it prints creates a token carrying it —
 * `printedEffects` walks every mode and every ability, because a Part token
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
 */
import type { Card, Condition, CounterKind, Keyword, KeywordAbility, TokenSpec } from '@mtg/dsl';
import {
  assertNever,
  hasAbilityEffects,
  isCreature,
  isCreatureTokenSpec,
  isPermanentCard,
  printedEffects,
  tokenAbilities,
} from '@mtg/dsl';
import type { DeckBuildConfig } from './config';
import { hypergeometricAtLeast } from './hypergeometric';

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

/**
 * The deck's supply, counted once and read many times.
 *
 * Counts are per *card*, never per permanent: the hypergeometric below asks how
 * many of the deck's forty cards are sources, and a card that mints two tokens
 * is still one card to draw.
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
   * there are is `subtypeSources` one field up. A card that both carries a
   * subtype and mints a token of it contributes both, because they are two
   * different permanents with two different prices.
   */
  readonly subtypeBodies: ReadonlyMap<string, readonly (SubtypeBody | null)[]>;
  /** Cards that can put a counter of this kind onto a creature. */
  readonly counterSources: ReadonlyMap<CounterKind, number>;
  /** Cards that can put any creature onto the battlefield: the subtype denominator. */
  readonly creatureSources: number;
  /** The finished deck's size, lands included: the population drawn from. */
  readonly deckSize: number;
  /** Cards seen by the turn a median game ends, on the play. */
  readonly draws: number;
}

/** The body a permanent card prints, or `null` when it is not a creature. */
function cardBody(card: Card): SubtypeBody | null {
  return isCreature(card)
    ? {
        power: card.power,
        toughness: card.toughness,
        keywords: card.keywords,
        keywordAbilities: card.keywordAbilities ?? [],
      }
    : null;
}

/** The body a token states, or `null` when it states none. */
function tokenBody(token: TokenSpec): SubtypeBody | null {
  return isCreatureTokenSpec(token)
    ? { power: token.power, toughness: token.toughness, keywords: token.keywords, keywordAbilities: [] }
    : null;
}

/**
 * Every permanent one card can put on the battlefield, printed or minted, as a
 * (subtype, body) pair.
 *
 * The one walk both counts read, so the set of subtypes a card supplies and the
 * bodies it supplies them as can never disagree about what the card does.
 */
function suppliedBodies(card: Card): readonly (readonly [string, SubtypeBody | null])[] {
  const supplied: (readonly [string, SubtypeBody | null])[] = [];
  if (isPermanentCard(card)) {
    const body = cardBody(card);
    for (const subtype of card.subtypes) supplied.push([subtype, body]);
  }
  for (const effect of printedEffects(card)) {
    if (effect.kind !== 'createToken') continue;
    const body = tokenBody(effect.token);
    for (const subtype of effect.token.subtypes) supplied.push([subtype, body]);
  }
  return supplied;
}

/**
 * Every counter kind one card can place, from anywhere on it — including from
 * inside a token it mints.
 *
 * The descent is the same one `suppliedBodies` and `makesCreature` already make,
 * and for the same reason: a permanent this card puts on the battlefield is this
 * card's doing whether it was printed or minted. It used to stop at the first
 * layer, which made the whole part mechanic invisible — a part is a token whose
 * activated ability is what fits the counter, so eleven of the thirteen cards in
 * the flagship that mint a part counter contributed nothing here, and four of
 * the five part counters measured zero supply in a pool built entirely of
 * minters (`mtg-ibk4`).
 *
 * ## One layer, and the schema is why
 *
 * `TokenEffectSchema` is the card's effect vocabulary minus `createToken`
 * (`packages/dsl/src/effects.ts`), so a token's ability cannot mint another
 * token and there is no second layer for a recursive walk to find. That is a
 * parsed invariant rather than a convention — `validateCard` refuses the nested
 * token outright — so one level of descent is exhaustive rather than a depth
 * limit chosen here. If the schema ever admits a token that makes a token, this
 * walk is one of the places that has to grow, and `tokenAbilities` is the seam
 * it would grow at.
 */
function countersOf(card: Card): ReadonlySet<CounterKind> {
  const found = new Set<CounterKind>();
  for (const effect of printedEffects(card)) {
    if (effect.kind === 'putCounters') found.add(effect.counter);
    if (effect.kind !== 'createToken') continue;
    for (const ability of tokenAbilities(effect.token)) {
      if (!hasAbilityEffects(ability)) continue;
      for (const inner of ability.effects) {
        if (inner.kind === 'putCounters') found.add(inner.counter);
      }
    }
  }
  return found;
}

/** True when the card itself, or a token it mints, is a creature. */
function makesCreature(card: Card): boolean {
  if (isCreature(card)) return true;
  return printedEffects(card).some(
    (effect) => effect.kind === 'createToken' && isCreatureTokenSpec(effect.token),
  );
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

function increment<K>(counts: Map<K, number>, keys: Iterable<K>): void {
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
}

/** Files one card's supplied permanents into the two maps that read that walk. */
function record(
  subtypeSources: Map<string, number>,
  subtypeBodies: Map<string, (SubtypeBody | null)[]>,
  card: Card,
): void {
  const supplied = suppliedBodies(card);
  increment(subtypeSources, new Set(supplied.map(([subtype]) => subtype)));
  for (const [subtype, body] of supplied) {
    const bodies = subtypeBodies.get(subtype);
    if (bodies === undefined) subtypeBodies.set(subtype, [body]);
    else bodies.push(body);
  }
}

/** Counts what `cards` supply, against the finished deck size `config` states. */
export function deckContextOf(cards: readonly Card[], config: DeckBuildConfig): DeckContext {
  const subtypeSources = new Map<string, number>();
  const subtypeBodies = new Map<string, (SubtypeBody | null)[]>();
  const counterSources = new Map<CounterKind, number>();
  let creatureSources = 0;
  for (const card of cards) {
    record(subtypeSources, subtypeBodies, card);
    increment(counterSources, countersOf(card));
    if (makesCreature(card)) creatureSources += 1;
  }
  return {
    subtypeSources,
    subtypeBodies,
    counterSources,
    creatureSources,
    deckSize: config.deckSize,
    draws: deckDraws(config),
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
export function deckContextWith(context: DeckContext, card: Card): DeckContext {
  const subtypeSources = new Map(context.subtypeSources);
  const subtypeBodies = new Map<string, (SubtypeBody | null)[]>(
    [...context.subtypeBodies].map(([subtype, bodies]) => [subtype, [...bodies]]),
  );
  const counterSources = new Map(context.counterSources);
  record(subtypeSources, subtypeBodies, card);
  increment(counterSources, countersOf(card));
  return {
    subtypeSources,
    subtypeBodies,
    counterSources,
    creatureSources: context.creatureSources + (makesCreature(card) ? 1 : 0),
    deckSize: context.deckSize,
    draws: context.draws,
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
  if (context.creatureSources === 0) return 0;
  const sources = context.subtypeSources.get(subtype) ?? 0;
  return Math.min(1, sources / context.creatureSources);
}

/** The chance the deck has drawn `atLeast` sources of a subtype by the median turn. */
export function subtypeSupply(context: DeckContext, subtype: string, atLeast: number): number {
  return supply(context, context.subtypeSources.get(subtype) ?? 0, atLeast);
}

/** The chance the deck has drawn something that places this counter. */
export function counterSupply(context: DeckContext, counter: CounterKind): number {
  return supply(context, context.counterSources.get(counter) ?? 0, 1);
}

function supply(context: DeckContext, sources: number, atLeast: number): number {
  if (atLeast <= 0) return 1;
  if (sources < atLeast) return 0;
  return hypergeometricAtLeast(atLeast, Math.min(sources, context.deckSize), context.draws, context.deckSize);
}

/**
 * The chance the deck can turn on an `enabledWhile` condition, or `null` when
 * the deck is not what turns it on.
 *
 * `null` rather than a number, because two of the conditions this reads are
 * self-supplied and the rest are not: `controlsSubtype` counts permanents this
 * deck prints and `anyCreatureHasCounter` asks for a counter some card in it
 * places, so a deck that names neither turns them on never and the
 * hypergeometric answer is the true one. `opponentGraveyardAtLeast` counts
 * cards in the *other* seat's graveyard, which no card in this deck list
 * predicts — a deck full of mill turns it on and so does a long game against a
 * deck that cast a lot of spells. Answering zero would price a real static at
 * nothing and answering one would price it as unconditional, so the honest
 * return is the absence of an answer and the caller keeps its context-free
 * assumption. `lifeAtLeast` and `noOpponentDealtDamageThisTurn` are the same
 * absence for the same reason, argued at their arms below.
 */
export function conditionSupply(context: DeckContext, condition: Condition): number | null {
  switch (condition.kind) {
    case 'controlsSubtype':
      return subtypeSupply(context, condition.subtype, condition.atLeast);
    case 'anyCreatureHasCounter':
      return counterSupply(context, condition.counter);
    case 'opponentGraveyardAtLeast':
      return null;
    // Both `null` for `opponentGraveyardAtLeast`'s reason, one step further
    // out. A life total is not a card the deck draws: a deck full of lifegain
    // moves it and so does an opponent who never attacked, and `DeckContext`
    // counts sources in a list rather than simulating a game. "No opponent has
    // been dealt damage this turn" is not even about this deck's seat — it is
    // about what this deck did to the other one, at a point in a game the deck
    // list does not predict.
    case 'lifeAtLeast':
    case 'noOpponentDealtDamageThisTurn':
      return null;
    default:
      return assertNever(condition, 'conditionSupply');
  }
}
