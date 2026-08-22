/**
 * The replay route's name book, over the vocabulary in `../../log/narrate.ts`.
 *
 * The sentences moved out (`mtg-bz2` phase 0) and this kept what only a replay
 * has: a recorded log to build the names from. Everything else here is a
 * re-export, so every call site on this route still imports one module and the
 * live game log (`mtg-bz2.12`) narrates through the same functions rather than a
 * fork of them. `../../log/narrate.ts` carries the argument and the reason this
 * route can still not reach the engine.
 *
 * The parsed records go in unconverted: `LogEvent`, `LogAction` and `LogResult`
 * are assignable to the kernel types the vocabulary is written against, which is
 * a property `test/replay/record.test.ts` was already asserting variant by
 * variant.
 */
import type { LogDecision, LogPlayerId, LogSnapshot } from './log-schema';
import type { LogNames } from '../../log/narrate';
import { describeDecision as describeDecisionOver } from '../../log/narrate';
import { abilityLabel } from '../../log/ability-names';
import { seatPossessive } from '../../seat';
import type { ReplayGameLog } from './read-log';

/** What the replay route calls a name book; `LogNames` is the shared shape. */
export type ReplayNames = LogNames;

export {
  describeAction,
  describeEvent,
  describeResult,
  describeTarget,
  optionLabels,
  stepWords,
} from '../../log/narrate';

/**
 * What to call the objects that have no card.
 *
 * An activated ability on the stack is an object without one (CR 113.7a) and
 * the kernel gives it an `ab<n>` id, which the object table does not carry, so
 * every sentence naming it read `ab60 resolves.` The stack entry says which
 * permanent the ability came off, and every step's board carries the stack, so
 * the whole game's worth of them is one pass over the steps. It is built once
 * per book rather than looked up per sentence, because an ability id outlives
 * the frame it appeared in: it resolves after the entry has left the stack.
 */
function abilityLabels(game: ReplayGameLog): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  for (const step of game.steps) {
    for (const entry of step.state.stack) {
      if (labels.has(entry.oid)) continue;
      if (entry.source !== null) {
        const source = game.objects.get(entry.source);
        // The phrase itself comes from `log/ability-names.ts`, which says it for
        // the live log: two spellings of one label is how one board starts reading
        // two ways.
        if (source !== undefined) labels.set(entry.oid, abilityLabel(source.card.name));
        continue;
      }
      if (entry.copiedFrom !== null) {
        const source = game.objects.get(entry.card);
        if (source !== undefined) labels.set(entry.oid, `copy of ${source.card.name}`);
      }
    }
  }
  return labels;
}

/** Whichever of the two zones that grant control holds this object right now. */
function controllerIn(frame: LogSnapshot, oid: string): LogPlayerId | undefined {
  const permanent = frame.battlefield.find((entry) => entry.oid === oid);
  if (permanent !== undefined) return permanent.controller;
  return frame.stack.find((entry) => entry.oid === oid)?.controller;
}

/**
 * Who controlled an object at this point in the game.
 *
 * `mtg-fyo` filed this as a missing field on the game record's object table,
 * and the record turned out to hold the fact already. The object table carries
 * the owner, which is right — an owner never changes (CR 108.3) and one entry
 * per game is the true shape of it. A *controller* does change (CR 109.4), so a
 * per-game slot for it would have been a static answer to a moving question,
 * and the one the recorder had in hand to put there is the controller at the
 * final state, which is wrong for every earlier turn. What actually varies with
 * time is recorded where it varies: every snapshot names the controller of
 * every permanent on the battlefield and of every entry on the stack, which is
 * exactly the two zones control is a fact in.
 *
 * Two frames are consulted rather than one, because a step's snapshot is the
 * board *after* its action: a creature that died to the damage the step is
 * narrating has already left it, and the step before is the last board that
 * held it. Nothing is returned when neither frame holds the object, which is a
 * card in a zone that grants no control; CR 108.4 has the caller say it as its
 * owner's, which is the one place the owner is the right fact.
 */
function controllerAt(game: ReplayGameLog, seq: number, oid: string): LogPlayerId | undefined {
  const here = game.steps[seq];
  const now = here === undefined ? undefined : controllerIn(here.state, oid);
  if (now !== undefined) return now;
  const before = game.steps[seq - 1];
  return before === undefined ? undefined : controllerIn(before.state, oid);
}

/**
 * The name book for one frame of one game.
 *
 * Player labels come from the deck names, disambiguated when both match. The
 * step matters because `LogNames.target` says an object as its *controller's*
 * and no seat controls anything for the whole of a game; every sentence a
 * viewer draws is about one step, so the book is built for that step.
 */
export function namesFor(game: ReplayGameLog, seq: number): ReplayNames {
  const [first, second] = game.seats;
  const distinct = first.deck !== second.deck;
  const labels: readonly [string, string] = distinct
    ? [first.deck, second.deck]
    : [`${first.deck} (seat 0)`, `${second.deck} (seat 1)`];
  const abilities = abilityLabels(game);
  const named = (oid: string): string => game.objects.get(oid)?.card.name ?? abilities.get(oid) ?? oid;
  return {
    player: (id: LogPlayerId) => labels[id],
    card: named,
    target: (oid: string): string => {
      // An ability object is `<source>'s ability` in both slots and takes no
      // possessive of its own, which is the rule `log/ability-names.ts` already
      // states for the live log: a second possessive would read as a seat
      // owning a sentence rather than a permanent.
      const ability = abilities.get(oid);
      if (ability !== undefined) return ability;
      const object = game.objects.get(oid);
      if (object === undefined) return oid;
      const controller = controllerAt(game, seq, oid) ?? object.owner;
      return `${seatPossessive(labels[controller])} ${object.card.name}`;
    },
  };
}

/**
 * The question the kernel asked, as a sentence.
 *
 * Narrowed to the recorded decision so this route's call sites keep passing a
 * whole `LogDecision`; the shared function takes only the two members it reads,
 * which is what lets a live `Decision` through the same door.
 */
export function describeDecision(decision: LogDecision, names: ReplayNames): string {
  return describeDecisionOver(decision, names);
}
