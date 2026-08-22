/**
 * The event log: the kernel's actual output.
 *
 * Every event is a flat, JSON-serializable record with no optional fields and
 * no `undefined` — two runs of the same seed and choice sequence must produce
 * byte-identical `JSON.stringify(events)`, and optionality would let key order
 * or presence drift. Downstream packages (replay viewer, 17lands-superset log
 * exporter, metrics) consume this union and nothing else.
 */
import type { GrantableKeyword, ManaCost, TriggerCondition } from '@mtg/dsl';
import type { ObjectId, PlayerId } from './ids';
import type { ReplaceableEventKind } from './replacement-effects';
import type { Attack, Block, GameEndReason, ManaColor, Step, Target, ZoneId } from './state';

/**
 * `'lifeLoss'` is the fourth, appended for the reason the log's other reason
 * unions grow rather than widen: life loss is not damage (CR 119.3), and the
 * three members before it could only say it was. `damage.ts` keeps reporting
 * `'damage'` for the half that is, `life.ts` reports this one for a drain and
 * for the downward half of "life total becomes N" (CR 118.5), and
 * `triggers.ts`'s `youGainLife` branch is unaffected because it tests for the
 * two gain reasons by name.
 */
export type LifeChangeReason = 'damage' | 'lifelink' | 'gainLife' | 'lifeLoss';

export type DestroyReason = 'lethalDamage' | 'deathtouch' | 'zeroToughness' | 'destroyEffect';

export type DamageTarget =
  | { readonly kind: 'player'; readonly player: PlayerId }
  | { readonly kind: 'permanent'; readonly oid: ObjectId };

export type GameEvent =
  | { readonly type: 'gameStarted'; readonly seed: string; readonly startingPlayer: PlayerId }
  | { readonly type: 'libraryShuffled'; readonly player: PlayerId; readonly cards: number }
  | { readonly type: 'cardDrawn'; readonly player: PlayerId; readonly oid: ObjectId }
  | { readonly type: 'drawFromEmptyLibrary'; readonly player: PlayerId }
  | { readonly type: 'turnBegan'; readonly turn: number; readonly active: PlayerId }
  | { readonly type: 'stepBegan'; readonly turn: number; readonly step: Step; readonly active: PlayerId }
  | { readonly type: 'stepEnded'; readonly turn: number; readonly step: Step }
  | { readonly type: 'permanentUntapped'; readonly oid: ObjectId }
  | { readonly type: 'permanentTapped'; readonly oid: ObjectId }
  /**
   * The untap step reached a permanent held down by a Sleep or a Frost Breath
   * and left it tapped.
   *
   * Its own event rather than the absence of a `permanentUntapped`, because the
   * absence of an event is not something a log can narrate and this is the one
   * moment the card's second sentence is paid. It fires only when the hold
   * actually cost the permanent its untap; a hold that expired on a permanent
   * something else had already untapped is a debt cleared with nothing to show.
   */
  | { readonly type: 'untapSkipped'; readonly oid: ObjectId }
  | { readonly type: 'summoningSicknessCleared'; readonly oid: ObjectId }
  | { readonly type: 'priorityGained'; readonly player: PlayerId }
  | { readonly type: 'priorityPassed'; readonly player: PlayerId }
  | { readonly type: 'landPlayed'; readonly player: PlayerId; readonly oid: ObjectId }
  | {
      readonly type: 'manaProduced';
      readonly player: PlayerId;
      readonly sourceOid: ObjectId;
      readonly color: ManaColor;
      readonly amount: number;
    }
  | { readonly type: 'manaPoolEmptied'; readonly player: PlayerId; readonly wasted: number }
  | { readonly type: 'manaPaid'; readonly player: PlayerId; readonly cost: ManaCost }
  | {
      readonly type: 'spellCast';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      readonly targets: readonly (Target | null)[];
      readonly chosenX: number | null;
    }
  | {
      readonly type: 'spellCopied';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      readonly copiedFrom: ObjectId;
      readonly targets: readonly (Target | null)[];
      readonly chosenX: number | null;
    }
  | {
      /**
       * CR 602.2a: a printed activated ability, paid for and on the stack.
       *
       * `spellCast`'s shape plus the two fields a spell has no need of. `oid` is
       * the ability object, so `resolutionBegan` later names the same id; `source`
       * is the permanent it was printed on, which is the id a reader recognizes.
       *
       * It exists because the replay-superset log has a column for it. 17lands'
       * `{owner}_turn_{N}_{side}_abilities` counts activations, and a column
       * counted off no event is a column that reports zero forever
       * (`packages/sim/src/log/collect.ts`).
       *
       * `chosenX` is `spellCast`'s field, added for `mtg-nhyv.17` and carried
       * for the same reason the event itself is: an activation of Silklash
       * Spider for one and an activation for six are different plays, and a
       * record that cannot tell them apart makes every consumer counting off
       * this event — `@mtg/metrics`' ability usage, `@mtg/sim`'s activation
       * census, the narrator — describe two games as one. `null` for the
       * overwhelming majority of abilities, which print no X.
       */
      readonly type: 'abilityActivated';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      readonly source: ObjectId;
      readonly index: number;
      readonly targets: readonly (Target | null)[];
      readonly chosenX: number | null;
    }
  | {
      /**
       * CR 603.2: a printed trigger's condition was met and the ability is on
       * the stack as an object of its own.
       *
       * `abilityActivated`'s shape without the targets, because a trigger has
       * none yet: CR 603.3d chooses them once it is already on the stack, and
       * `triggerTargetsChosen` is that record. `oid` is the ability object, so
       * `resolutionBegan` names the same id later; `source` is the permanent
       * that printed it; `player` is who controlled that permanent as it
       * triggered (CR 603.3a), which a death trigger makes distinct from who
       * controls it now.
       *
       * `condition` is the one field a trigger carries that an activation has
       * no analogue for, and it is not recoverable from the rest: `source` and
       * `index` name a printed ability, and reading which watch fired off them
       * means holding the card. Without it a death and an arrival are the same
       * record.
       *
       * It exists for the reason `abilityActivated` does, one condition over.
       * Nothing else in the log said a trigger fired — the stack grew an `ab<n>`
       * entry and the ability resolved — so a measure counted off the event
       * stream counted zero forever, and `packages/metrics/src/ability-usage.ts`
       * abstains on the triggered half rather than report that zero.
       */
      readonly type: 'abilityTriggered';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      readonly source: ObjectId;
      readonly index: number;
      readonly condition: TriggerCondition;
    }
  | {
      /**
       * CR 603.3d: a triggered ability on the stack has been aimed.
       *
       * `oid` is the ability object and `source` the permanent that printed it,
       * the same pair `abilityActivated` carries and for the same reason: the
       * first is what `resolutionBegan` will name later, the second is what a
       * reader recognizes. Without this the choice would be visible only as a
       * board snapshot changing under a replay, which is a diff rather than a
       * record.
       */
      readonly type: 'triggerTargetsChosen';
      readonly oid: ObjectId;
      readonly source: ObjectId;
      readonly targets: readonly (Target | null)[];
    }
  | {
      /**
       * CR 603.3b: the controller of an optional trigger declined it.
       *
       * The ability triggered, went on the stack, could be responded to, and
       * then did nothing because its controller said so. That is a different
       * game from one where the ability never triggered, so it is a different
       * log.
       */
      readonly type: 'triggerDeclined';
      readonly oid: ObjectId;
      readonly source: ObjectId;
    }
  | {
      /**
       * CR 603.3d: a triggered ability was removed from the stack because it
       * had no legal target to choose.
       *
       * Not `spellFizzled`, and the difference is the one CR draws. A fizzle is
       * CR 608.2b — every target was legal when it was chosen and none is now —
       * and it happens on resolution. This happens before the ability is ever
       * aimed, and nobody was asked anything.
       */
      readonly type: 'triggerRemoved';
      readonly oid: ObjectId;
      readonly source: ObjectId;
      readonly why: string;
    }
  | { readonly type: 'spellCountered'; readonly oid: ObjectId; readonly by: ObjectId }
  | { readonly type: 'spellFizzled'; readonly oid: ObjectId }
  | {
      /**
       * CR 601.2c: the chosen answer to a spell's "you may" was no.
       *
       * `triggerDeclined`'s reasoning widened from an ability to a spell
       * (`mtg-bc2.152.4`): the spell was cast, went on the stack, could be
       * responded to, and then did nothing because its chooser said so — a
       * different game from one where it was never cast, so a different log.
       * Not reused outright: `triggerDeclined` names `source`, the permanent
       * an ability was printed on, and a spell has no such second identity to
       * name — `oid` is both the card and the object. `player` names who was
       * asked, which `triggerDeclined` has no need to since CR 603.3b always
       * asks the controller; a "you may" spell need not (`MayChooser`), so an
       * opponent's decline is legible in the log without walking the card.
       */
      readonly type: 'spellDeclined';
      readonly oid: ObjectId;
      readonly player: PlayerId;
    }
  | {
      /**
       * CR 118.8: the toll an "unless" clause printed was paid, so the spell
       * leaves the stack without doing what it says.
       *
       * `spellDeclined`'s counterpart aimed the other way, and it needs its own
       * type for the reason that one did. The mana is already in the log as the
       * taps and the pool movements that paid it, but a reader seeing a removal
       * spell go to the graveyard with the creature still on the battlefield has
       * two explanations available — it fizzled, or it was bought off — and only
       * this line tells them which. `player` is the payer, which is not the
       * spell's controller and is not printed on the card either, so nothing
       * else in the log names them.
       */
      readonly type: 'unlessPaid';
      readonly oid: ObjectId;
      readonly player: PlayerId;
    }
  | { readonly type: 'resolutionBegan'; readonly oid: ObjectId }
  | { readonly type: 'effectSkipped'; readonly oid: ObjectId; readonly index: number; readonly why: string }
  | {
      readonly type: 'zoneChanged';
      readonly oid: ObjectId;
      readonly from: ZoneId;
      readonly to: ZoneId;
      readonly owner: PlayerId;
    }
  | { readonly type: 'permanentEntered'; readonly oid: ObjectId; readonly controller: PlayerId }
  | {
      readonly type: 'tokenCreated';
      readonly oid: ObjectId;
      readonly controller: PlayerId;
      readonly name: string;
    }
  | {
      readonly type: 'damageDealt';
      readonly sourceOid: ObjectId;
      readonly target: DamageTarget;
      readonly amount: number;
      readonly deathtouch: boolean;
      readonly combat: boolean;
    }
  | {
      readonly type: 'damagePrevented';
      readonly sourceOid: ObjectId;
      readonly target: DamageTarget;
      readonly amount: number;
    }
  | {
      readonly type: 'replacementApplied';
      readonly id: string;
      readonly event: ReplaceableEventKind;
    }
  | {
      readonly type: 'countersChanged';
      readonly oid: ObjectId;
      readonly plusOnePlusOne: number;
      readonly minusOneMinusOne: number;
      readonly loyalty?: number | undefined;
    }
  | {
      readonly type: 'lifeChanged';
      readonly player: PlayerId;
      readonly delta: number;
      readonly life: number;
      readonly reason: LifeChangeReason;
    }
  | {
      readonly type: 'continuousEffectAdded';
      readonly id: string;
      readonly targetOid: ObjectId;
      readonly power: number;
      readonly toughness: number;
      readonly layer: string;
    }
  /**
   * A layer-6 ability was added to one object for a duration.
   *
   * A sibling of `continuousEffectAdded` rather than a reading of it, because
   * that event's `power` and `toughness` are not optional and there is no
   * honest number to put in them: a keyword grant changes no characteristic the
   * two fields name, and `0`/`0` would narrate as "gets +0/+0 in layer 6" in
   * the replay log, which is a sentence about an effect that did not happen.
   * The union forbids optional fields (see the module docblock), so widening
   * the existing event was never the cheaper half.
   *
   * One keyword rather than a list, and one event per affected object, for the
   * reason the pump's narration event is per-object: this says what a reader
   * would say out loud. `id` is the continuous effect's, so a grant and the
   * `continuousEffectsExpired` that ends it are joinable.
   *
   * `GrantableKeyword` rather than `Keyword`, because the grant reaches both
   * halves of `Characteristics` and the narration is about the sentence rather
   * than about which list the kernel wrote: Cleaver Riot's double strike lands
   * in `keywordAbilities` and reads out as one grant exactly like trample does.
   */
  | {
      readonly type: 'keywordGranted';
      readonly id: string;
      readonly targetOid: ObjectId;
      readonly keyword: GrantableKeyword;
      readonly layer: string;
    }
  | { readonly type: 'continuousEffectsExpired'; readonly ids: readonly string[] }
  | { readonly type: 'permanentDestroyed'; readonly oid: ObjectId; readonly reason: DestroyReason }
  | {
      /**
       * CR 701.17: a permanent was sacrificed, which is a game action and not a
       * kind of destruction (CR 701.17b).
       *
       * A sibling of `permanentDestroyed` rather than a field on `zoneChanged`,
       * and both halves of that are deliberate. It is not a field because this
       * union forbids optional ones (see the module docblock) and a total
       * `cause` on `zoneChanged` would put a new key on the most frequent event
       * the log has, changing the bytes of every recorded log for a fact that is
       * false in all but a handful of them. It is an event because the fact has
       * to be *positively* recorded: deriving "sacrificed" from the absence of a
       * preceding `permanentDestroyed` would silently reclassify every future
       * departure-to-graveyard that is neither, and `selfDiesNotSacrificed`
       * would start firing on the wrong ones without a test going red.
       *
       * `player` is who paid, which is not always the controller of the
       * permanent — a sacrifice cost is paid by the player activating the
       * ability.
       */
      readonly type: 'permanentSacrificed';
      readonly oid: ObjectId;
      readonly player: PlayerId;
    }
  | { readonly type: 'permanentRegenerated'; readonly oid: ObjectId }
  | { readonly type: 'attackersDeclared'; readonly player: PlayerId; readonly attacks: readonly Attack[] }
  | { readonly type: 'blockersDeclared'; readonly player: PlayerId; readonly blocks: readonly Block[] }
  | {
      readonly type: 'blockerOrderChosen';
      readonly attacker: ObjectId;
      readonly blockers: readonly ObjectId[];
    }
  | { readonly type: 'combatDamageStep'; readonly firstStrike: boolean }
  | { readonly type: 'cardsMilled'; readonly player: PlayerId; readonly oids: readonly ObjectId[] }
  | {
      /** Public result only; the looked-at identities and orders stay hidden. */
      readonly type: 'cardsScried';
      readonly player: PlayerId;
      readonly count: number;
      readonly bottom: number;
    }
  | { readonly type: 'cardsDiscarded'; readonly player: PlayerId; readonly oids: readonly ObjectId[] }
  | {
      /**
       * CR 701.16a: these cards were shown, briefly.
       *
       * The whole of revealing, and deliberately not a state change. A card is
       * concealed by *where it is* (`visibility.ts`), so a lasting `revealed`
       * flag would be a second, contradicting source of truth about what a seat
       * may see. The event says it happened and names what was shown; `seatEvent`
       * passes it through unredacted, which is the point.
       */
      readonly type: 'handRevealed';
      readonly player: PlayerId;
      readonly oids: readonly ObjectId[];
    }
  | {
      /**
       * CR 701.16a again, from the top of a library.
       *
       * `handRevealed`'s twin and it carries the same argument: revealing is an
       * action, the event is the whole of it, and `seatEvent` passes it through
       * unredacted because redacting it would delete the effect. What differs is
       * the direction of the reveal. A hand is hidden from one seat, so
       * `handRevealed` tells the *opponent* something; a library is hidden from
       * both seats including its owner (`visibility.ts`), so this is the one
       * event in the log that tells a player something about their own deck.
       * `publiclyIdentified` has to license it for that reason, and `undo.ts`
       * has to treat it as a boundary — the knowledge is not un-learnable and,
       * unlike a search, no shuffle follows to close the boundary for it.
       */
      readonly type: 'libraryTopRevealed';
      readonly player: PlayerId;
      readonly oids: readonly ObjectId[];
    }
  | {
      /**
       * CR 701.19: a player looked through their library.
       *
       * Public result only, `cardsScried`'s design and for its reason — the
       * searched cards and the one that was taken are the searching seat's
       * knowledge, and naming the found card here would hand the opponent a card
       * that is now sitting in a hidden zone. `found` is the whole public fact:
       * CR 701.19b lets a search find nothing, and whether it did is something
       * both players watched.
       *
       * The zone change reports itself as `zoneChanged` like every other move,
       * and `seatEvent` redacts that one into a placeholder when the destination
       * is hidden, so a search into a hand leaks nothing and a search onto the
       * battlefield names a card both seats can now see anyway.
       */
      readonly type: 'librarySearched';
      readonly player: PlayerId;
      readonly found: boolean;
    }
  | {
      /**
       * CR 701.16a a third time, out of a library a search just read.
       *
       * `libraryTopRevealed`'s sibling and not a reuse of it, because the top is
       * the whole of that event's claim: it names the cards a `putOnLibrary` or
       * a `revealTop` window showed *in library order from the top*, and a
       * search's finds come from wherever in the library they were. An event
       * that said "top" about a card drawn from the middle would be a false
       * statement in the log, and the log is what a replay reads.
       *
       * It carries ids where `librarySearched` deliberately carries a boolean,
       * and the two are not in tension — they answer different questions about
       * the same action. `librarySearched` reports that a hidden zone was
       * searched, which is public because both seats watched it happen; this
       * reports that the searcher then *showed* what they took, which is public
       * because the card said so. A search with no reveal emits only the first
       * and the found cards stay concealed; Sylvan Ranger emits both.
       *
       * Emitted while the cards are still in the library, in printed order
       * ("reveal it, put it into your hand"), so the ids it names are ids the
       * opponent could not otherwise have. `undo.ts` treats it as a boundary for
       * `libraryTopRevealed`'s reason with one difference: a shuffle *does*
       * follow here (CR 701.19c), but the shuffle destroys knowledge of *order*
       * and this event's knowledge is of *contents*, which no shuffle takes
       * back.
       */
      readonly type: 'librarySearchRevealed';
      readonly player: PlayerId;
      readonly oids: readonly ObjectId[];
    }
  | {
      /**
       * CR 103.4: an opening hand went back and a new one was dealt.
       *
       * `mulligans` counts this one, so it reads as "mulliganed to
       * `openingHandSize - mulligans`". The shuffle and the redraw report
       * themselves as `libraryShuffled` and `cardDrawn`, exactly as the opening
       * deal does; this event is the *decision*, which nothing else in the log
       * would otherwise record.
       */
      readonly type: 'handMulliganed';
      readonly player: PlayerId;
      readonly mulligans: number;
    }
  | {
      /**
       * CR 103.4: an opening hand was kept, and the cards it paid for its
       * mulligans with went to the bottom of the library.
       *
       * `bottomed` is empty for a kept seven, and that is a record rather than a
       * gap: it is the event that says this seat is done being asked, which is
       * what separates "kept" from "not yet reached" for a reader walking the
       * log forward.
       */
      readonly type: 'handKept';
      readonly player: PlayerId;
      readonly mulligans: number;
      readonly bottomed: readonly ObjectId[];
    }
  | { readonly type: 'damageCleared'; readonly turn: number }
  | { readonly type: 'playerLost'; readonly player: PlayerId; readonly reason: GameEndReason }
  | {
      readonly type: 'gameEnded';
      readonly winner: PlayerId | null;
      readonly reason: GameEndReason;
      readonly turn: number;
    };

export type GameEventType = GameEvent['type'];

/** Narrows the event union to a single variant; keeps assertions cast-free. */
export function eventsOfType<T extends GameEventType>(
  events: readonly GameEvent[],
  type: T,
): readonly Extract<GameEvent, { type: T }>[] {
  const matched: Extract<GameEvent, { type: T }>[] = [];
  for (const event of events) {
    if (event.type === type) matched.push(event as Extract<GameEvent, { type: T }>);
  }
  return matched;
}

/** Stable serialization of a log, used for determinism assertions. */
export function serializeEvents(events: readonly GameEvent[]): string {
  return JSON.stringify(events);
}
