/**
 * What to call the stack objects that have no card.
 *
 * `mtg-zwk`. A live game log printed `object ab83 resolves.` and
 * `object ab85 resolves.` where the ability's name belongs, and in both cases the
 * name was on the line above — a trigger sentence that named the permanent it was
 * printed on — and then, one priority round later, an object id.
 *
 * # Why the name was lost
 *
 * An activated or triggered ability on the stack is an object without a card
 * (CR 113.7a, CR 603.3a). The kernel gives it an `ab<n>` id and puts it in
 * `state.stack` as a `StackEntry`, never in `state.objects`, because there is no
 * card to put there. A live surface's name book answers `card(oid)` out of
 * `state.objects` (`routes/play/position.ts`'s `nameOf`), so an ability id misses
 * and falls through to that function's last resort, the id in words.
 *
 * The miss is not even recoverable from the board at the moment it is asked:
 * `resolutionBegan` fires as the entry leaves the stack, and the log is narrated
 * from the finished state long after, so by then no stack entry names the ability
 * at all. That is why this is derived from the *stream* rather than looked up in
 * the state — the answer is in the history whether or not it is still on the
 * board.
 *
 * # Why the stream is the right source
 *
 * Every way an ability object comes into existence carries both ids: the kernel's
 * `abilityActivated`, `abilityTriggered`, `triggerTargetsChosen`, `triggerDeclined`
 * and `triggerRemoved` each hold an `oid` (the ability) beside a `source` (the
 * permanent that printed it), and `packages/kernel/src/events.ts` says outright
 * that the first is what `resolutionBegan` will name later. So the log already
 * held everything it needed and was throwing it away one line after printing it.
 * Nothing in the kernel changed to fix this.
 *
 * `routes/replay/narrate.ts` solved the same leak on the recorded side by walking
 * every step's stack, which is the only source a replay has. This is not that
 * function generalized: a replay reads snapshots and a live log reads events, and
 * the two answers agree because both end at `<source>'s ability`, which is the
 * phrase `describeEvent` already uses for a trigger.
 */
import type { GameEvent, ObjectId } from '@mtg/kernel';
import type { LogNames } from './narrate';

/** How an ability object is named once its source is known. */
export function abilityLabel(source: string): string {
  return `${source}'s ability`;
}

/**
 * Every ability object the stream created, against the permanent that printed it.
 *
 * The source is resolved to a name here rather than at the call site, so a book
 * built once serves every sentence and the map holds words instead of ids.
 */
export function abilityNames(events: readonly GameEvent[], names: LogNames): ReadonlyMap<ObjectId, string> {
  const labels = new Map<ObjectId, string>();
  for (const event of events) {
    switch (event.type) {
      case 'abilityActivated':
      case 'abilityTriggered':
      case 'triggerTargetsChosen':
      case 'triggerDeclined':
      case 'triggerRemoved':
        if (!labels.has(event.oid)) labels.set(event.oid, abilityLabel(names.card(event.source)));
        break;
      default:
        break;
    }
  }
  return labels;
}

/**
 * The same book, answering for ability objects too.
 *
 * A wrapper rather than a change to whoever builds the book, because the two
 * surfaces build theirs from different places and neither one has the stream
 * *and* the state in hand at the point it is written. The ability answer is
 * consulted first, which costs nothing: the kernel's ability ids are minted in
 * their own `ab<n>` sequence and no card ever carries one, so the map can only
 * answer for the ids the underlying book was going to miss.
 */
export function withAbilityNames(names: LogNames, events: readonly GameEvent[]): LogNames {
  const abilities = abilityNames(events, names);
  return {
    player: names.player,
    card: (oid: string): string => abilities.get(oid) ?? names.card(oid),
    // The same answer in both slots: an ability object is `<source>'s ability`
    // wherever a sentence puts it, and the map can only answer for the ids the
    // underlying book was going to miss.
    target: (oid: string): string => abilities.get(oid) ?? names.target(oid),
  };
}
