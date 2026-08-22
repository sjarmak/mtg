/**
 * "You may" spells (CR 601.2c's clause on an instant or sorcery): the card
 * states a yes/no question about its own effects, asked of a named player as
 * the spell resolves, before any of its effects apply.
 *
 * ## Why this is a `Card`-level field and not an `Effect` wrapper
 *
 * The same argument `modal.ts` makes for `modes` applies here, one gate
 * further. A per-effect `may` wrapper would have to be an `Effect` union
 * member (to sit inside `card.effects`), which forces real rows in the
 * kernel's `EFFECT_EXECUTION` table and the validator's `EFFECT_RULES` for a
 * kind whose resolvability depends on a decision the *kernel* has not asked
 * yet when those tables are consulted — `applyEffect` (`@mtg/kernel`,
 * `effects.ts`) is a pure, synchronous function with no agent access, by
 * design, and staying pure is what lets replay recompute every state without
 * touching a player. A `Card`-level field sidesteps the whole question: `may`
 * gates the card's *entire* printed effect list as one yes/no, resolved
 * before `applyEffect` ever walks it, mirroring CR 603.3b's optional-trigger
 * pause exactly (`@mtg/kernel`'s `trigger-choice.ts`) rather than inventing a
 * second pause mechanism.
 *
 * ## The bound
 *
 * `may` is legal only on spells (`checkEffects` refuses it on a permanent,
 * the same way it refuses `modes` there) and is mutually exclusive with
 * `modes` — CR 700.2's "choose one" and CR 601.2c's "you may" are both
 * printed on real cards, but never both on the same one in the corpus this
 * repo measures against, and combining them (a modal spell whose *chosen*
 * mode is itself optional) is not a shape any existing kernel mechanism
 * threads today. A card wanting both is two cards until that changes.
 *
 * ## Why `'you' | 'opponent'` and not a `PlayerId`
 *
 * This package has no notion of a player id — `@mtg/dsl` is validated
 * standalone, never depends on `@mtg/kernel` (`AGENTS.md`), and a card is
 * authored before any game exists to have players in it. `'you'` reuses
 * `amount.ts`'s existing convention for "the controller, relative to
 * whichever object is asking"; `'opponent'` is new here, spelled out because
 * this is a two-player kernel (`ids.ts`'s `opponentOf` takes only a player
 * id, no state) where "the opponent" is simply the other seat with no
 * target-selection machinery required. The kernel resolves either word to a
 * `PlayerId` at cast time, against the spell's own controller — see
 * `may-choice.ts` (`@mtg/kernel`).
 */
import { z } from 'zod';

export const MayChooserSchema = z.enum(['you', 'opponent']);
export type MayChooser = z.infer<typeof MayChooserSchema>;
