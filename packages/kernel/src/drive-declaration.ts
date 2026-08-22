/**
 * Drives a stepwise attack or block declaration to its end.
 *
 * `mtg-tb7v` changed what "the last enumerated option" means at a
 * `declareAttackers` or `declareBlockers` decision. Under the enumeration cap
 * (`DEFAULT_ENUMERATION_CAP`) the decision lists whole declarations, smallest
 * first, so the last option is the complete one — "attack with everything" or
 * "block with every eligible creature" in a single answer. Past the cap the
 * decision cannot list the whole space, so the kernel asks about one creature
 * at a time instead: the last option of *that* question is "yes, this
 * creature" rather than "yes, every creature", and the decision keeps the same
 * `kind` and keeps being asked, once per remaining creature, until the
 * declaration is complete.
 *
 * A caller that reduces once against `options[options.length - 1]` is
 * silently assuming the enumeration never crossed the cap. That assumption
 * holds for a small fixture and breaks the day somebody widens the board by
 * one creature, and it breaks as a confusing error about an unexpected
 * decision kind rather than anything naming the cap. `lastDeclarationOption`
 * is the one place that assumption is made explicit, and `driveDeclaration`
 * is the loop that keeps taking it until the decision moves on.
 */
import type { Action } from './actions';
import type { Decision } from './legal';
import { pendingDecision } from './legal';
import { reduce } from './reduce';
import type { GameState } from './state';

/**
 * The "attack with everything" / "block with everything" answer to one
 * decision, whether that decision lists whole declarations or is asking
 * about a single creature on the way to one. Both shapes enumerate options
 * with the fullest answer last (CR 508.1's subsets and the per-creature
 * questions in `attackerDecision` alike), so taking the last option is
 * correct at every step; the mistake `mtg-y16d` is about is stopping after
 * one step rather than looping until the decision itself changes kind.
 */
export function lastDeclarationOption(decision: Decision): Action {
  const option = decision.options[decision.options.length - 1];
  if (option === undefined) {
    throw new Error(`driveDeclaration: ${decision.kind} enumerated no options`);
  }
  return option;
}

/**
 * Reduces `state` against `lastDeclarationOption` for as long as the pending
 * decision stays `kind`, so a `declareAttackers` or `declareBlockers`
 * declaration is answered to completion however many creatures it takes to
 * ask about, rather than assumed to settle in one reduction.
 *
 * `guard` bounds the walk at one step per eligible creature plus a margin,
 * not at "a handful of major decisions": a stepwise declaration costs one
 * step per creature left to ask about, so a guard sized for the old
 * single-shot idiom is exactly the latent break this function exists to
 * remove. The default is generous enough for any fixture in this repo; a
 * caller with a genuinely huge board may pass its own.
 */
export function driveDeclaration(
  state: GameState,
  kind: 'declareAttackers' | 'declareBlockers',
  guard = 600,
): GameState {
  let current = state;
  for (let step = 0; step < guard; step += 1) {
    const decision = pendingDecision(current);
    if (decision === null || decision.kind !== kind) return current;
    current = reduce(current, lastDeclarationOption(decision)).state;
  }
  throw new Error(`driveDeclaration: ${kind} did not finish within ${String(guard)} steps`);
}
