/**
 * How many permanents one `createToken` puts on the battlefield.
 *
 * Two callers ask, and they must not answer differently: `evaluate.ts` prices
 * the bodies a card mints, and `deck-context.ts` counts the permanents the deck
 * can supply for a clause that eats more than one of them (`mtg-x2gb`). A card
 * priced for two bodies whose supply was counted as one is a card the builder
 * disagrees with itself about.
 */
import type { Amount } from '@mtg/dsl';
import { isLiteralAmount } from '@mtg/dsl';

/**
 * The printed numeral, or one when the count is computed rather than printed.
 *
 * One, and deliberately not `evaluate.ts`'s `assumed` three. That guess is this
 * builder's answer for a magnitude nobody can read, and three is right when the
 * unknown is how far an effect reaches; it is wrong here, because this magnitude
 * is a count of bodies and every body is credited `creaturePremium` before it is
 * credited anything else, so guessing high hands a card two free premiums it may
 * not have. On the supply side the same guess would hand a deck permanents it
 * may never make.
 *
 * `nwo.ts`'s `wideBoard` rule reads the same unreadable count the other way and
 * for the same reason: a New World Order budget is spent by the widest board a
 * common could make, so there an unreadable count is wide by assumption and here
 * it is narrow by assumption. Both resolve it against the card. Both are also
 * only ever reached by a hand-authored one, because `ModelEffectSchema` builds
 * `count` over `z.int()` and no generated card can carry a computed amount.
 */
export function tokenCount(count: Amount): number {
  return isLiteralAmount(count) ? count : 1;
}
