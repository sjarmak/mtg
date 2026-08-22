/**
 * Activating a mana source: the land's printed choice, and a card's printed
 * mana ability.
 *
 * One entry point for both, because CR 605.3a gives them one shape — a mana
 * ability does not use the stack and does not target, so it resolves inside the
 * activation itself and the player keeps priority. A land tapping for `{G}` and
 * a Llanowar-style creature tapping for `{G}` differ only in where the answer
 * is printed, and a second execution path would be a second place for the pool
 * to disagree with the log.
 *
 * The color rides in on the action, already chosen. That is the same mechanism
 * a dual land has always used: `activateManaAbility` carries `color`, the
 * enumerator offers one action per color the source can make, and the agent
 * picks between them the way it picks between any two actions. So "a mana
 * ability that produces a color chosen on resolution" needs no pause in
 * resolution and no second interruptible mechanism beside `PendingScry` — the
 * choice was made before the ability existed, which is exactly what CR 605.1a's
 * "no stack" leaves room for.
 *
 * What the ability path adds over the land path is a cost that is not only the
 * tap: Cabal Coffers charges `{2}`, a mana filter charges a pip. That is paid
 * here through the ordinary payment planner, excluding the source itself so the
 * planner cannot propose tapping the very permanent whose tap is the cost.
 *
 * `planPayment` reaches past a land as of `mtg-nhyv.27`: `mana.ts`'s
 * `tapPromise` is the whole of what the planner may believe about a source — a
 * chosen color and a fixed count of it — so a board of two Gilded Lotuses pays
 * `{5}` without anybody activating anything by hand. Widening those candidates
 * changes which permanents an existing game taps for an existing cost, which is
 * why it was a lane rather than a line.
 *
 * What still routes through here is everything `tapPromise` refuses to promise:
 * an amount the board decides, and a cost that is more than the tap. Cabal
 * Coffers is activated by hand, and this is where its `{2}` gets paid.
 */
import { manaAbilityOf } from '@mtg/dsl';
import { applyEffect } from './effects';
import type { ObjectId, PlayerId } from './ids';
import { executePayment, landProduces, planPayment, produceMana } from './mana';
import type { ManaColor } from './state';
import type { Trace } from './trace';
import { tapObject } from './zones';

/**
 * Resolves an activated mana source: the cost is paid, the source is tapped,
 * and the mana is in the pool when this returns.
 *
 * `color` is the one the agent picked out of what the source offers;
 * `validateManaAbility` has already refused a color the source cannot make, so
 * the effect is applied with `produces` narrowed to exactly that one. Narrowing
 * here rather than threading a choice through `ApplyContext` keeps the effect
 * executor's contract unchanged: it still reads position zero of `produces`,
 * which for a resolving mana ability is now the chosen color by construction.
 */
export function activateManaSource(trace: Trace, player: PlayerId, oid: ObjectId, color: ManaColor): Trace {
  const object = trace.state.objects[oid];
  if (object === undefined) throw new Error('mana source is not an object in this game');
  const ability = manaAbilityOf(object.card);
  if (ability === null) {
    if (!landProduces(object.card).includes(color)) {
      throw new Error('mana source cannot produce that color');
    }
    return produceMana(trace, player, oid, color);
  }
  const plan = planPayment(trace.state, player, ability.cost.mana, undefined, [oid]);
  if (plan === null) throw new Error('cannot pay the mana ability cost');
  const paid = executePayment(trace, player, ability.cost.mana, plan);
  const tapped = ability.cost.tapSelf ? tapObject(paid, oid) : paid;
  const effect = ability.effects[0];
  if (effect === undefined || effect.kind !== 'addMana') {
    throw new Error('a mana ability carries exactly one addMana effect');
  }
  return applyEffect(tapped, oid, player, { ...effect, produces: [color] }, null, tapped.events.length);
}
