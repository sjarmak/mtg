/**
 * The complete rules surface printed on one card's account.
 *
 * A card prints effects directly, inside modes, and inside its abilities. It
 * can also create a token whose own abilities print effects, including the one
 * finite nested token tier admitted for Mitotic Slime. This module owns that
 * descent so the set-token registry, art planning and Forge export cannot stop
 * at different depths.
 *
 * This module owns the structural walk only. It does not decide what an effect
 * means, how much an ability is worth, or which vocabulary a generator may
 * emit; those answers remain with their packages and model schemas.
 */
import type { Ability } from './abilities';
import { hasAbilityEffects } from './abilities';
import type { Card } from './card';
import { transformedBackFaceOf } from './card';
import type { Effect, TokenAbility, TokenSpec } from './effects';
import { tokenAbilities } from './effects';

/** An ability printed on the card itself or on a token the card creates. */
export type PrintedAbility = Ability | TokenAbility;

/** The structural projections of everything one card can print. */
export interface PrintedCardSurface {
  /** Effects on the card itself, including modes and card abilities. */
  readonly cardEffects: readonly Effect[];
  /** Tokens created by `cardEffects`, in printed order. */
  readonly tokens: readonly TokenSpec[];
  /** Abilities printed on the created tokens, in token order. */
  readonly tokenAbilities: readonly TokenAbility[];
  /** Card abilities followed by the created tokens' abilities. */
  readonly abilities: readonly PrintedAbility[];
  /** `cardEffects` followed by effects printed on the created tokens. */
  readonly effects: readonly Effect[];
}

/**
 * Every effect printed on a card itself, wherever it is printed.
 *
 * Modes are walked in full rather than through `effectsFor`: a structural
 * census has no game and no chosen mode, so every mode is part of the card.
 * Token abilities are deliberately absent; `printedCardSurface` adds the one
 * token layer when the caller asks for the card's whole account.
 */
export function printedEffects(card: Card): readonly Effect[] {
  return [
    ...card.effects,
    ...(card.modes ?? []).flatMap((mode) => mode.effects),
    ...card.abilities
      .filter(hasAbilityEffects)
      .flatMap((ability) => [
        ...ability.effects,
        ...('modes' in ability ? (ability.modes ?? []).flatMap((mode) => mode.effects) : []),
      ]),
  ];
}

interface PrintedTokenSurface {
  readonly tokens: readonly TokenSpec[];
  readonly abilities: readonly TokenAbility[];
  readonly effects: readonly Effect[];
}

function tokensCreatedBy(effects: readonly Effect[]): readonly TokenSpec[] {
  return effects.flatMap((effect) => (effect.kind === 'createToken' ? [effect.token] : []));
}

/** Walks one token and every token its printed abilities declare, depth first. */
function printedTokenSurface(token: TokenSpec): PrintedTokenSurface {
  const abilities = tokenAbilities(token);
  const effects: readonly Effect[] = abilities.flatMap((ability) =>
    'effects' in ability ? ability.effects : [],
  );
  const descendants = tokensCreatedBy(effects).map(printedTokenSurface);
  return {
    tokens: [token, ...descendants.flatMap((surface) => surface.tokens)],
    abilities: [...abilities, ...descendants.flatMap((surface) => surface.abilities)],
    effects: [...effects, ...descendants.flatMap((surface) => surface.effects)],
  };
}

/** Walks every structural surface printed on one face exactly once. */
function printedFaceSurface(card: Card): PrintedCardSurface {
  const cardEffects = printedEffects(card);
  const tokenSurfaces = tokensCreatedBy(cardEffects).map(printedTokenSurface);
  const tokens = tokenSurfaces.flatMap((surface) => surface.tokens);
  const tokenPrintedAbilities = tokenSurfaces.flatMap((surface) => surface.abilities);
  const tokenEffects = tokenSurfaces.flatMap((surface) => surface.effects);
  return {
    cardEffects,
    tokens,
    tokenAbilities: tokenPrintedAbilities,
    abilities: [...card.abilities, ...tokenPrintedAbilities],
    effects: [...cardEffects, ...tokenEffects],
  };
}

/** Walks every structural surface printed on this physical card exactly once. */
export function printedCardSurface(card: Card): PrintedCardSurface {
  const front = printedFaceSurface(card);
  const back = card.kind === 'battle' ? transformedBackFaceOf(card) : null;
  if (back === null) return front;
  const transformed = printedFaceSurface(back);
  return {
    cardEffects: [...front.cardEffects, ...transformed.cardEffects],
    tokens: [...front.tokens, ...transformed.tokens],
    tokenAbilities: [...front.tokenAbilities, ...transformed.tokenAbilities],
    abilities: [...front.abilities, ...transformed.abilities],
    effects: [...front.effects, ...transformed.effects],
  };
}
