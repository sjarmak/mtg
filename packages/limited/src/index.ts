/**
 * `@mtg/limited` — physical pool to backend-neutral deck construction.
 *
 * The generated-card builder consumes DSL cards and is deliberately richer.
 * This package is the smaller seam a printed cube needs: opaque card payloads,
 * one stable id per drafted copy, caller-attested facts, and `DeckRef` only at
 * the boundary where an engine takes over. It depends on `@mtg/engine` and on
 * neither card representation.
 */

export {
  CANONICAL_BASIC_NAMES,
  DEFAULT_LIMITED_BASIC_LANDS,
  DEFAULT_LIMITED_MINIMUM_DECK_SIZE,
  LIMITED_COLORS,
  LimitedDeckError,
  addBasic,
  addPhysicalCard,
  cutBasic,
  cutPhysicalCard,
  prepareLimitedDeck,
  setBasicCount,
  suggestLimitedBasics,
  suggestLimitedDeck,
  toDeckRef,
  validateLimitedDeck,
} from './physical-deck';
export type {
  CanonicalBasicName,
  LimitedCardFacts,
  LimitedCardRole,
  LimitedCardType,
  LimitedColor,
  LimitedDeck,
  LimitedDeckErrorCode,
  LimitedDeckOptions,
  LimitedDeckReport,
  LimitedFactsResolver,
  PhysicalPoolCard,
  PreparedPoolCard,
} from './physical-deck';
export { suggestLimitedDeckWithReport } from './selection';
export type {
  LimitedSelectionOptions,
  LimitedSelectionPolicyVersion,
  LimitedSelectionReport,
  LimitedSelectionResult,
  LimitedSelectionShortfall,
  LimitedSelectionTargets,
} from './selection';
