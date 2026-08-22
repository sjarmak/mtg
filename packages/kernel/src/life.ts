/**
 * Life change that is not damage: a drain, and a life total set to a number.
 *
 * Its own file rather than a second half of `damage.ts`, because the whole
 * point of the primitive is that it is *not* damage. Damage is prevented,
 * redirected, doubled, marked on a creature until cleanup, and stopped by
 * protection and indestructible; life loss is none of those (CR 119.3 — a
 * life-loss effect changes the total and that is all it does). `damage.ts` has
 * a private `loseLife` of its own that reports `reason: 'damage'`, and the two
 * are deliberately not one function: the reason field is the entire content of
 * each, so folding them together would leave a parameter that had to be right
 * at every call site, which is what having two named functions already buys.
 */
import type { PlayerId } from './ids';
import type { Trace } from './trace';
import { emit, updatePlayer, withState } from './trace';
import { gainLife } from './damage';

/**
 * A player loses life (CR 119.3).
 *
 * No replacement pipeline. `ReplacementTrigger` covers damage, draws, life
 * gain, destruction and permanents entering, and life loss is none of them —
 * which is the rules-correct answer rather than a gap: nothing in Magic
 * replaces a life-loss event, and the doublers that look like they should
 * ("deals double that damage") are damage replacements that a drain never
 * reaches. That asymmetry is the reason a set prints both a `dealDamage` and a
 * `loseLife` card at different rates.
 *
 * Non-positive amounts emit nothing, matching `gainLife`: an effect that
 * computed its way to zero did not change a life total, and a `delta: 0` event
 * would be a line in the log that no trigger reads and no narration can say.
 */
export function loseLife(trace: Trace, player: PlayerId, amount: number): Trace {
  if (amount <= 0) return trace;
  const state = updatePlayer(trace.state, player, (seat) => ({ ...seat, life: seat.life - amount }));
  return emit(withState(trace, state), {
    type: 'lifeChanged',
    player,
    delta: -amount,
    life: state.players[player].life,
    reason: 'lifeLoss',
  });
}

/**
 * A player's life total becomes `amount` (CR 118.5).
 *
 * Implemented as the rule is written rather than as an assignment, and the
 * difference is the whole reason this function exists. CR 118.5 does not set a
 * number: it says the player *gains* the difference when the target is higher
 * and *loses* the difference when it is lower. So the two directions route
 * through the two life functions and report the reasons those report, which is
 * the deliberate answer to "which `lifeChanged` reason does this emit":
 *
 *   - Upward it is `'gainLife'`, because it *is* a life gain. `youGainLife`
 *     (`triggers.ts`) reads that field and fires, which is correct — a Rhox
 *     Faithmender or an Ajani's Pridemate does not care how the life arrived.
 *     It also means the gain goes through `applyReplacements`, so a
 *     `doubleLifeGain` in play doubles it and the finished total is *not* the
 *     number the card named. That is the rules answer, not a bug: CR 614 applies
 *     to the life-gain event CR 118.5 creates, and a card that wanted an
 *     assignment would have to be a different primitive.
 *   - Downward it is `'lifeLoss'`, the reason `loseLife` above reports, because
 *     a life total dropping is a life loss and nothing else. Reporting
 *     `'damage'` there would let a future "whenever you're dealt damage"
 *     trigger fire on a card that dealt none.
 *
 * A total already at `amount` emits nothing at all, for `loseLife`'s reason:
 * no life changed.
 */
export function setLife(trace: Trace, player: PlayerId, amount: number): Trace {
  const current = trace.state.players[player].life;
  if (amount > current) return gainLife(trace, player, amount - current, false);
  if (amount < current) return loseLife(trace, player, current - amount);
  return trace;
}
