/**
 * Whether a permanent would survive its own arrival.
 *
 * Reported from a played game: the bot cast Phylactery Lich with no artifact on
 * its battlefield, watched the Lich sacrifice itself before it regained
 * priority, and then played the artifact it had been holding all along. Nothing
 * in the cast policy read either half of that card. `printedCardValue` sees a
 * 5/5 indestructible body; `scoreTargets` sees a spell with no targets; the
 * kernel's CR 603.8 check runs after the permanent is already on the
 * battlefield, which is too late to be a heuristic.
 *
 * A state trigger is the one ability in the DSL whose condition is read the
 * instant its source arrives, so it is the one ability a cast policy has to
 * evaluate ahead of the cast. This module answers the narrow question that
 * follows: given the board as it stands, would casting this card put a
 * permanent on the battlefield that a state trigger immediately removes?
 *
 * It reads the same two facts the kernel reads and derives neither of them a
 * second time. `collectStateTriggers` (`@mtg/kernel`'s `triggers.ts`) fires
 * when the controller has no permanent carrying the named counter, and
 * `entryChoiceFor` (`battlefield-entry.ts`) places the entry replacement's
 * counter only when the controller already has a permanent of the named type
 * for it to land on. Those two are the whole of the trap, and both are
 * evaluated here against the pre-entry battlefield, which is the board the
 * kernel evaluates them against too: the entering object is not on the
 * battlefield when its counter recipient is chosen.
 *
 * Deliberately not a general "will this permanent die" forecast. Removal in the
 * opponent's hand, a blocker that eats it next turn, and a sacrifice outlet are
 * all reasons a permanent does not survive, and none of them are visible at
 * cast time or knowable without a search. This one is: it is decided entirely
 * by the caster's own board, before the spell is cast, and it is the difference
 * between a 5/5 and nothing at all.
 */
import type { Card, CounterKind } from '@mtg/dsl';
import { assertNever, printedEntryReplacement } from '@mtg/dsl';
import type { GameState, PlayerId } from '@mtg/kernel';
import { controllerOf, counterCount, hasCardType, tryObject } from '@mtg/kernel';

/** Does this player already control a permanent carrying one of these counters? */
function controlsCounter(state: GameState, player: PlayerId, counter: CounterKind): boolean {
  return state.battlefield.some((oid) => {
    const object = tryObject(state, oid);
    if (object === undefined) return false;
    return controllerOf(state, oid) === player && counterCount(object.counters, counter) > 0;
  });
}

/**
 * Would this card's own entry replacement leave a permanent of its controller's
 * carrying `counter`?
 *
 * The two counter-placing replacements answer differently and the difference is
 * the whole point: `entersWithCounters` puts them on the arriving permanent, so
 * it always satisfies the condition, while `putCounterOnControlledPermanent`
 * needs a permanent that is already there and quietly places nothing when there
 * is none.
 */
function entryPlacesCounter(state: GameState, player: PlayerId, card: Card, counter: CounterKind): boolean {
  const replacement = printedEntryReplacement(card);
  if (replacement === undefined) return false;
  switch (replacement.kind) {
    case 'entersWithCounters':
      return replacement.counter === counter;
    case 'putCounterOnControlledPermanent':
      return (
        replacement.counter === counter &&
        state.battlefield.some(
          (oid) => controllerOf(state, oid) === player && hasCardType(state, oid, replacement.permanentType),
        )
      );
    case 'entersTapped':
    case 'entersTappedUnlessControlsLandSubtype':
    case 'entersAsCopyOfCreature':
    case 'entersAsCharacteristicChoice':
    case 'choosePlayer':
    case 'payLifeOrEntersTapped':
    case 'chooseTwoColors':
    case 'chooseCardName':
      return false;
    default:
      return assertNever(replacement, 'entryPlacesCounter');
  }
}

/**
 * True when a state trigger would sacrifice this permanent the moment it lands.
 *
 * A copy is exempt and not by omission: `entersAsCopyOfCreature` replaces the
 * printed abilities with the copied creature's, so the state trigger read here
 * is not the ability the permanent arrives with, and which creature it copies
 * is chosen after the spell resolves.
 */
export function diesOnArrival(state: GameState, player: PlayerId, card: Card): boolean {
  if (printedEntryReplacement(card)?.kind === 'entersAsCopyOfCreature') return false;
  return card.abilities.some((ability) => {
    if (ability.kind !== 'stateTriggered') return false;
    if (!ability.effects.some((effect) => effect.kind === 'sacrificeSelf')) return false;
    const counter = ability.condition.counter;
    return !controlsCounter(state, player, counter) && !entryPlacesCounter(state, player, card, counter);
  });
}
