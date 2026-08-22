/**
 * What kind of thing a printed card is, as a closed vocabulary a gate can name.
 *
 * This exists because a gate's subject list is usually a fixture path, and a
 * fixture is a *sample* rather than the vocabulary. `packages/ui/test/
 * card-fit.browser.test.ts` held the rules-box fit ladder to its bound in a real
 * browser and was green for months about a build with no planeswalker in it, so
 * the loyalty ladder — six rungs where the ordinary ladder has four, a column
 * the cost badge narrows, its own line box, its own divider gap — had never been
 * drawn under the bound at all. When it finally was (`mtg-ypz`), the estimate
 * came in under Chrome on all three walkers. Nothing was broken by that gate's
 * assertion; the assertion had never been asked about the shape. A verdict that
 * is a fact about which fixture the run happened to open is the same defect this
 * repository already refuses when a verdict is a fact about the hard drive.
 *
 * So a shape is named rather than sampled. `shapesIn` reads a pool and says what
 * is in it; `missingShapes` reads a pool against a stated requirement and says
 * what is not. A gate that states `['planeswalker']` and is handed a pool
 * without one gets a list naming `planeswalker`, which is a red run with a word
 * in it rather than a green run about nothing.
 *
 * **The vocabulary is closed and it is about render and kernel paths, not about
 * taxonomy.** Each member is a shape some surface treats differently: a
 * planeswalker has a second fit ladder, a modal card prints every mode's text
 * and keeps its own `effects` empty, an Aura and an Equipment carry a
 * modification clause instead of a static ability, a token-maker mints a card
 * that appears in no card list. Splitting further — by effect kind, by keyword,
 * by rarity — is what `packages/setgen/tools/pool-census.ts` already does over
 * the effect vocabulary, and a second copy of that here would be a second
 * answer to one question.
 *
 * **Two absences are deliberate.** There is no `doubleFaced`: `CardSchema` is a
 * discriminated union of seven single-faced kinds with no back, so a
 * double-faced card is not a thing this DSL can express and a shape nothing can
 * ever satisfy would be a permanent red with no fix. And a set's *basics* and
 * the *tokens its cards create* are not read here: neither is a printed card,
 * both are minted at play time, and `setBasics` and `setTokens` are already the
 * one derivation of each — `artSurfaces` composes all three for the art
 * governance check, and a caller wanting the played surfaces should compose
 * them the same way rather than have this file guess.
 */
import { isAttachingAbility, isLoyaltyAbility } from './abilities';
import type { Card } from './card';
import { manaAbilityOf } from './mana-ability';
import { printedEffects } from './set-tokens';

/**
 * Every shape a printed card can have, in a fixed order so a report of them
 * reads the same twice.
 */
export const CARD_SHAPES = [
  'creature',
  'artifactCreature',
  'artifact',
  'enchantment',
  'aura',
  'equipment',
  'land',
  'basicLand',
  'planeswalker',
  'instant',
  'sorcery',
  'modal',
  'may',
  'unless',
  'staticAbility',
  'triggeredAbility',
  'activatedAbility',
  'manaAbility',
  'loyaltyAbility',
  'keywordAbility',
  'keyword',
  'tokenMaker',
  'flavorText',
  'costReduction',
  'entersTapped',
] as const;

export type CardShape = (typeof CARD_SHAPES)[number];

/**
 * Whether one card has one shape.
 *
 * A total switch rather than a predicate table, so a member added to
 * `CARD_SHAPES` fails to compile until it is answered here. The alternative —
 * a record of predicates — makes an unanswered member a silent `false`, which
 * is a shape reported absent from every pool in the repository.
 */
function cardHasShape(card: Card, shape: CardShape): boolean {
  switch (shape) {
    case 'creature':
      return card.kind === 'creature';
    case 'artifactCreature':
      return card.kind === 'creature' && card.artifact;
    case 'artifact':
      return card.kind === 'artifact';
    case 'enchantment':
      return card.kind === 'enchantment' && card.aura === undefined;
    case 'aura':
      return card.kind === 'enchantment' && card.aura !== undefined;
    // An Equipment is an artifact (CR 301.5) whose equip clause is an attaching
    // activated ability. The subtype alone would admit a card that prints the
    // word and cannot be equipped; the ability alone would miss an Equipment
    // whose clause is granted rather than printed. Either is the shape.
    case 'equipment':
      return card.subtypes.includes('Equipment') || card.abilities.some(isAttachingAbility);
    case 'land':
      return card.kind === 'land';
    case 'basicLand':
      return card.kind === 'land' && card.basicLandType !== undefined;
    case 'planeswalker':
      return card.kind === 'planeswalker';
    case 'instant':
      return card.kind === 'instant';
    case 'sorcery':
      return card.kind === 'sorcery';
    case 'modal':
      return card.modes !== undefined;
    case 'may':
      return card.may !== undefined;
    case 'unless':
      return card.unless !== undefined;
    case 'staticAbility':
      return card.abilities.some((ability) => ability.kind === 'static');
    case 'triggeredAbility':
      return card.abilities.some((ability) => ability.kind === 'triggered');
    case 'activatedAbility':
      return card.abilities.some((ability) => ability.kind === 'activated');
    // A mana ability is an activated ability whose effect adds mana (CR 605.1b)
    // rather than an ability kind of its own, so `manaAbilityOf` is asked rather
    // than the discriminant; a land's intrinsic tap is `producesMana` and is
    // the other half of the same question.
    case 'manaAbility':
      return manaAbilityOf(card) !== null || (card.kind === 'land' && card.producesMana.length > 0);
    case 'loyaltyAbility':
      return card.abilities.some(isLoyaltyAbility);
    case 'keywordAbility':
      return (card.keywordAbilities ?? []).length > 0;
    case 'keyword':
      return card.keywords.length > 0;
    // `printedEffects` and not `card.effects`: a modal card's own effect list is
    // empty and every effect it prints lives under a mode, so the walk that
    // stopped at the card reported the three modal cards in the flagship as
    // printing nothing at all.
    case 'tokenMaker':
      return printedEffects(card).some((effect) => effect.kind === 'createToken');
    case 'flavorText':
      return card.flavorText !== undefined;
    case 'costReduction':
      return card.costReduction !== null;
    case 'entersTapped':
      return 'entryReplacement' in card && card.entryReplacement !== undefined;
  }
}

/** Every shape this one card has, in `CARD_SHAPES` order. */
export function cardShapes(card: Card): readonly CardShape[] {
  return CARD_SHAPES.filter((shape) => cardHasShape(card, shape));
}

/** How many of these cards have each shape, including the shapes with none. */
export function shapeCounts(cards: readonly Card[]): ReadonlyMap<CardShape, number> {
  return new Map(
    CARD_SHAPES.map((shape) => [shape, cards.filter((card) => cardHasShape(card, shape)).length]),
  );
}

/** The shapes at least one of these cards has, in `CARD_SHAPES` order. */
export function shapesIn(cards: readonly Card[]): readonly CardShape[] {
  return CARD_SHAPES.filter((shape) => cards.some((card) => cardHasShape(card, shape)));
}

/**
 * The stated shapes this pool cannot supply, in `CARD_SHAPES` order.
 *
 * Empty is the pass. It returns the names rather than a boolean because the
 * whole point is the message: "this pool has no planeswalker" is actionable and
 * `false` is not.
 */
export function missingShapes(cards: readonly Card[], required: readonly CardShape[]): readonly CardShape[] {
  const present = new Set(shapesIn(cards));
  return CARD_SHAPES.filter((shape) => required.includes(shape) && !present.has(shape));
}
