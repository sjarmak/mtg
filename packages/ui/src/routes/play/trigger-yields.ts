/**
 * "Stop asking me about that ability", the third yield.
 *
 * `mtg-bz2.7` asks for three yields: through the turn, until a stop, and per
 * recurring trigger. The first two are the kernel's — `yieldPriority` runs the
 * passes and stops at the next configured stop, and `./yields.ts` names the two
 * boundaries. This is the third, and it is not a boundary at all: an optional
 * trigger is a question with two answers, and a player who has answered it the
 * same way six upkeeps running is being asked a question they have already
 * settled. Magic Online calls the control "Always yes" / "Always no"; this is
 * that, held here rather than in `AutoPassSettings` because it answers a
 * decision rather than declining a priority, and the kernel keeps those apart.
 *
 * **The answer is recorded as the choice it is.** Nothing here reaches into a
 * state or skips a decision: a yielded trigger is answered through `choose`
 * with the `answerOptionalTrigger` action the kernel enumerated, so the game's
 * record is byte-identical to one where the player pressed the button every
 * time. A recording made under a yield replays without it.
 *
 * **Keyed by the card and the ability, not by the object.** A yield a player
 * sets on their upkeep trigger has to hold for the same permanent next turn,
 * which an object id would give, and for the second copy of that card, which it
 * would not. `mtg-bz2.7`'s word is *recurring*, and the two ways an ability
 * recurs are "again next turn" and "again from the other one".
 */
import type { Action, Decision, GameSession, GameState, SessionOptions } from '@mtg/kernel';
import { choose as applyChoice } from '@mtg/kernel';

/** One settled answer: which ability, which way, and what to call it on screen. */
export interface TriggerYield {
  /** `${card id}#${ability index}`; `triggerYieldKey` is the only writer. */
  readonly key: string;
  /** True takes the ability every time, false declines it every time. */
  readonly accept: boolean;
  /**
   * The ability's name for a person, carried rather than re-derived.
   *
   * The panel that lists these draws them while the trigger is nowhere near the
   * stack, so the object the label came from may be in a graveyard by then and
   * the card id is not a thing to show anybody. Deriving a name from a key at
   * listing time would need a second lookup that can fail; storing the sentence
   * the player agreed to cannot.
   */
  readonly label: string;
}

/** Every settled answer, keyed by `TriggerYield.key`. */
export type TriggerYields = ReadonlyMap<string, TriggerYield>;

/** Nothing settled yet, which is what a game opens with. */
export const NO_TRIGGER_YIELDS: TriggerYields = new Map<string, TriggerYield>();

/**
 * How many yielded triggers may resolve inside one press.
 *
 * A bound rather than a `while`, for the reason every loop over a kernel
 * decision here has one: this consumes decisions the kernel produces, and a card
 * that triggers itself would otherwise hang the tab instead of reaching the
 * error line. Ten upkeep triggers under one yield is an ordinary turn; two
 * hundred and fifty-six is a loop.
 */
const SETTLE_MAX = 256;

/**
 * What identifies the ability a decision is asking about, or null.
 *
 * Null for every decision that is not an optional trigger, and for a source the
 * state has no object under — which is not a position the kernel produces, but
 * `state.objects` is an index and an index lookup that cannot fail is one that
 * has been assumed rather than checked.
 */
export function triggerYieldKey(state: GameState, decision: Decision): string | null {
  if (decision.kind !== 'optionalTrigger') return null;
  const card = state.objects[decision.source]?.card;
  if (card === undefined) return null;
  return `${card.id}#${String(decision.abilityIndex)}`;
}

/**
 * What to call the ability on screen: the card, and which of its abilities when
 * it prints more than one.
 *
 * The index is spoken as a position rather than as the integer the kernel
 * counts with, because the sentence is read by somebody looking at a card whose
 * abilities are printed in an order and numbered from one.
 */
export function triggerYieldLabel(state: GameState, decision: Decision): string | null {
  if (decision.kind !== 'optionalTrigger') return null;
  const card = state.objects[decision.source]?.card;
  if (card === undefined) return null;
  return card.abilities.length > 1 ? `${card.name}, ability ${String(decision.abilityIndex + 1)}` : card.name;
}

/** What the prompt needs to offer a yield: the ability's name, and the press. */
export interface TriggerYieldControl {
  /** `triggerYieldLabel`'s words, so the buttons name the ability out loud. */
  readonly label: string;
  /** True settles on taking it every time, false on declining it every time. */
  readonly onYield: (accept: boolean) => void;
}

/**
 * The pair of controls for the decision on screen, or null.
 *
 * Null at every decision that is not an optional trigger, and at every caller
 * that owns no session to keep the setting in. Built here rather than in the
 * view so that one predicate decides both whether the yield can be keyed and
 * whether it is offered: a prompt that could offer a yield the map has no key
 * for would be a button that does nothing.
 */
export function triggerYieldControl(
  state: GameState,
  decision: Decision | null,
  onYield: ((yielded: TriggerYield) => void) | undefined,
): TriggerYieldControl | null {
  if (decision === null || onYield === undefined) return null;
  const settled = triggerYieldFor(state, decision, true);
  if (settled === null) return null;
  return {
    label: settled.label,
    onYield: (accept: boolean): void => {
      onYield({ ...settled, accept });
    },
  };
}

/** The whole record of a yield the player could set at this decision, or null. */
export function triggerYieldFor(state: GameState, decision: Decision, accept: boolean): TriggerYield | null {
  const key = triggerYieldKey(state, decision);
  const label = triggerYieldLabel(state, decision);
  if (key === null || label === null) return null;
  return { key, accept, label };
}

/** The map with one more answer settled. */
export function withTriggerYield(yields: TriggerYields, yielded: TriggerYield): TriggerYields {
  const next = new Map(yields);
  next.set(yielded.key, yielded);
  return next;
}

/** The map with one answer unsettled, so the ability is asked about again. */
export function withoutTriggerYield(yields: TriggerYields, key: string): TriggerYields {
  const next = new Map(yields);
  next.delete(key);
  return next;
}

/**
 * The action a settled answer would submit at this decision, or null.
 *
 * Built from the decision's own fields rather than picked out of `options` by
 * index: the enumeration's order is the kernel's business, and a surface that
 * hard-coded "yes is 0" would answer the wrong way the day that changed.
 * `choose` takes an `Action` as readily as an index, so nothing is lost.
 */
export function yieldedAnswer(session: GameSession, yields: TriggerYields): Action | null {
  const decision = session.pending;
  if (decision === null || decision.kind !== 'optionalTrigger') return null;
  const key = triggerYieldKey(session.state, decision);
  if (key === null) return null;
  const yielded = yields.get(key);
  if (yielded === undefined) return null;
  return {
    type: 'answerOptionalTrigger',
    player: decision.player,
    oid: decision.oid,
    accept: yielded.accept,
  };
}

/**
 * Answers every yielded trigger the session is sitting on, and stops.
 *
 * It stops at the first decision no yield covers, which is what makes this a
 * yield rather than an auto-player: the ability is answered and the game settles
 * under the same `SessionOptions` every other path here uses, so it lands at the
 * next configured stop exactly as `yieldPriority` does. The stop set is not
 * consulted, overridden or widened — `applyChoice` carries the options and the
 * kernel decides where the game comes to rest.
 */
export function settleTriggerYields(
  session: GameSession,
  options: SessionOptions,
  yields: TriggerYields,
): GameSession {
  if (yields.size === 0) return session;
  let current = session;
  for (let settled = 0; settled < SETTLE_MAX; settled += 1) {
    const answer = yieldedAnswer(current, yields);
    if (answer === null) return current;
    current = applyChoice(current, answer, options);
  }
  throw new Error(
    `play: ${String(SETTLE_MAX)} yielded triggers resolved without the game asking anything else, which is a loop rather than a turn`,
  );
}
