/**
 * The kernel's position, its log and its question, turned into the neutral
 * contract's values — for the table, and for one seat.
 *
 * Split out of `backend.ts` for a reason the file's placement is load-bearing
 * for: **this is the one kernel module that calls `seatState`**, and
 * `test/visibility.test.ts` holds the rule that a module which conceals a
 * position must not be able to reach a reducer. `backend.ts` names `choose`,
 * `replaySession` and `stateFingerprint`, so it is exactly the file that may not
 * hold concealment. Here there is nothing to reduce with: every import below is
 * a type or a derivation, and a concealed state can only be turned into a
 * `TableView` and handed out.
 *
 * That is the same argument `visibility.ts` makes about itself, one layer up.
 * The projection is what a viewer receives; it is never what the game continues
 * from.
 *
 * # A per-seat view is the table's view over a concealed position
 *
 * `projectSeat` already takes a `visible` flag, so it would have been one line
 * to compute a per-seat view by flipping that flag and stopping there. That line
 * would have been a second opinion about what a hidden zone is, sitting one
 * package away from `visibility.ts`, which owns zones and cites CR 400.2 for the
 * answer. So the state goes through `seatState` first and is projected
 * afterwards: the cards are gone before the projector runs, and the projector's
 * own null is belt and braces rather than the only guard.
 */
import type {
  EngineEvent,
  MoveOption,
  ObjectView,
  PendingDecision,
  SeatId,
  SeatProjection,
  SeatView,
  SessionSpec,
  TableView,
  TextDecisionInput,
} from '@mtg/engine';
import { PROJECTION_VERSION } from '@mtg/engine';
import type { Action } from './actions';
import type { Counters } from './continuous';
import type { GameEvent } from './events';
import type { ObjectId, PlayerId } from './ids';
import type { Decision } from './legal';
import { copiableCardOf } from './state';
import type { GameState, Target } from './state';
import { characteristicsOf, isCreatureCharacteristics } from './layers';
import { keywordsOf } from './backend-keywords';
import { nameOf, typeLineOf } from './backend-naming';
import { publiclyIdentified, seatEvent, seatState } from './visibility';

/** Neutral descriptor shared by projection, submission, and record replay. */
export const CARD_NAME_TEXT_INPUT: TextDecisionInput = {
  kind: 'text',
  id: 'kernel:card-name',
  label: 'Card name',
  minLength: 1,
  maxLength: 256,
};

/** The kernel is two-player forever (ADR-0001 §9); this is that seat pair, spelled once. */
const KERNEL_SEATS: readonly SeatId[] = [0, 1];

/**
 * Narrows a widened `@mtg/engine` seat id down to the kernel's own `PlayerId`.
 *
 * Unreachable in practice: `refusalsFor` in `backend.ts` refuses any table
 * whose seat count is not 2 before a kernel session is ever opened, so no
 * well-formed caller can reach this with a seat outside `KERNEL_SEATS`.
 */
function asPlayerId(seat: SeatId): PlayerId {
  if (seat !== 0 && seat !== 1) throw new Error(`asPlayerId: kernel table has no seat ${String(seat)}`);
  return seat;
}

/** Which seats a person is holding, as the tuple positions they are. */
export function localSeatsOf(table: SessionSpec): readonly SeatId[] {
  const seated: SeatId[] = [];
  if (table.seats[0].controller === 'local') seated.push(0);
  if (table.seats[1].controller === 'local') seated.push(1);
  return seated;
}

/** Everything one delivery of a position needs, so the five values travel together. */
export interface SeatProjectionInput {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  readonly pending: Decision | null;
  readonly table: SessionSpec;
  /**
   * How many moves have been submitted, which is the delivery this projection
   * belongs to.
   *
   * `seatState` keys its placeholders on this so that a concealed position is
   * not a tracking tag: the same revision redraws identically, and the next move
   * replaces every placeholder. It is derived from the position rather than
   * random because the kernel is on the recorded arm and a replay of the same
   * moves should produce the same bytes. A server that hands these out over a
   * wire adds a salt of its own, which is what `@mtg/netplay` does.
   */
  readonly at: number;
}

export function seatProjection(input: SeatProjectionInput): SeatProjection {
  const keyFor = (seat: SeatId): string => `at:${String(input.at)}:seat:${String(seat)}`;
  const stateFor = (seat: SeatId): GameState => seatState(input.state, asPlayerId(seat), keyFor(seat));
  return {
    view: (seat: SeatId): TableView => projectState(stateFor(seat), input.table, [seat]),
    events: (seat: SeatId): readonly EngineEvent[] =>
      input.events.map((event, index) =>
        projectDelivered(seatEvent(event, asPlayerId(seat), keyFor(seat), index), event, index),
      ),
    decision: (seat: SeatId): PendingDecision | null =>
      input.pending === null || input.pending.player !== seat
        ? null
        : projectDecision(stateFor(seat), input.pending),
  };
}

export function projectDecision(state: GameState, decision: Decision): PendingDecision {
  return {
    seat: decision.player,
    kind: decision.kind,
    prompt: promptFor(decision),
    options: decision.options.map((action, index) => projectOption(state, action, index)),
    ...(decision.kind === 'cardName'
      ? {
          input: {
            ...CARD_NAME_TEXT_INPUT,
            label: decision.input.label,
            minLength: decision.input.minLength,
            maxLength: decision.input.maxLength,
          },
        }
      : {}),
    complete: decision.complete,
  };
}

function promptFor(decision: Decision): string {
  switch (decision.kind) {
    case 'priority':
      return 'You have priority';
    case 'mulligan':
      return 'Keep this hand or mulligan';
    case 'openingHandAction':
      return 'Choose an opening-hand action';
    case 'declareAttackers':
      return 'Declare attackers';
    case 'declareBlockers':
      return 'Declare blockers';
    case 'orderBlockers':
      return 'Order the blockers';
    case 'orderAttackers':
      return 'Order the attackers';
    case 'discard':
      return 'Discard down to your maximum hand size';
    case 'triggerTargets':
      return 'Choose targets for the trigger';
    case 'pluralTargets':
      return 'Choose another target or finish choosing targets';
    case 'damageAllocation':
      return `Allocate ${String(decision.total)} divided damage`;
    case 'optionalTrigger':
      return 'Use the triggered ability';
    case 'may':
      return 'You may';
    case 'unless':
      return 'Pay the cost';
    case 'legendRule':
      return 'Keep one legend';
    case 'scry':
      return 'Order cards for scry';
    case 'topLibraryOrder':
      return 'Put the looked-at cards back in any order';
    case 'topLibrarySelect':
      return 'Choose a card and order the rest';
    case 'topLibraryPartition':
      return 'Separate the revealed cards into two piles';
    case 'topLibraryPile':
      return 'Choose a pile';
    case 'searchLibrary':
      return 'Search your library';
    case 'searchDestination':
      return 'Choose which found card goes to the first destination';
    case 'graveyardChoice':
      // Not "search", and not "your graveyard" either. The effect reaches one
      // graveyard or both depending on what the card printed, and the prompt is
      // read by a seat that is looking at the option list — which names the
      // cards — so the honest short form says what is being chosen rather than
      // guessing whose zone it came out of.
      return 'Choose a card from a graveyard';
    case 'battlefieldChoice':
      return 'Choose a permanent you control';
    case 'populate':
      return 'Choose a creature token to copy';
    case 'handDiscard':
      // Two prompts off one decision, because the two effects that reach it ask
      // opposite questions of the seat reading this: `discardCards` costs the
      // reader cards, `chooseDiscard` costs somebody else's. `owner` is what
      // tells them apart, and `revealed` is not — a reveal is why the second
      // question may be asked at all, not what the question is.
      return decision.owner === decision.player
        ? `Discard ${String(decision.count)}`
        : `Choose ${String(decision.count)} for player ${String(decision.owner)} to discard`;
    case 'revealedHandChoice':
      return 'Choose a card from the revealed hand';
    case 'permanentSacrifice':
      return decision.remaining === 1
        ? 'Choose a permanent to sacrifice'
        : `Choose ${String(decision.remaining)} permanents to sacrifice`;
    case 'permanentUntap':
      return `Choose up to ${String(decision.remaining)} permanents to untap`;
    case 'entryCopy':
      return 'Choose a creature to copy or enter normally';
    case 'entryCounter':
      return 'Choose a permanent to receive the entry counter';
    case 'entryAura':
      return 'Choose what this Aura enters attached to';
    case 'entryTimestampOrder':
      return 'Choose the next earliest entering permanent';
    case 'entryCharacteristics':
      return 'Choose how the creature enters';
    case 'entryOptionalCounter':
      return 'Enter with a counter';
    case 'entryPayLife':
      return `Pay ${String(decision.life)} life or enter tapped`;
    case 'entryPlayer':
      return 'Choose a player';
    case 'entryColors':
      return 'Choose two colors';
    case 'manaColor':
      return 'Choose a mana color';
    case 'spellTargets':
      return 'Choose new targets for the spell';
    case 'freeCast':
      return 'Cast the revealed card without paying its mana cost';
    case 'damagePrevention':
      return `Allocate ${String(decision.remaining)} damage prevention`;
    case 'cardName':
      return 'Choose a card name';
    case 'namedZoneExile':
      return `Choose cards named ${decision.name} to exile`;
    default: {
      const unreachable: never = decision;
      return `Choose (${String(unreachable)})`;
    }
  }
}

function projectOption(state: GameState, action: Action, index: number): MoveOption {
  const targets = objectsIn(action).map((oid) => ({ oid: String(oid), name: nameOf(state, oid) }));
  return { id: String(index), text: describeAction(state, action), targets };
}

/**
 * The objects a move points at, for a surface that wants to highlight them.
 *
 * Written out per action type rather than scraped off the action's fields. The
 * scrape is tempting and wrong: `activateManaAbility.color` is a string and is
 * not an object, `declareAttackers` nests its ids a level down, and a rule that
 * guesses would hand a surface a highlight on a color name. An action type this
 * does not name yet contributes no targets, which is a poorer answer and never a
 * false one.
 *
 * `castSpell`, `activateAbility` and `chooseTriggerTargets` each list two kinds
 * of object: the source (`action.oid`, the spell or the permanent the ability
 * belongs to) and whatever the action's own `targets` array names. Both belong
 * here — `MoveTarget` is `packages/engine/src/decision.ts`'s "an object a move
 * points at", and a spell's target is one. Before this, `objectsIn` returned
 * only the source, so two options that cast the same spell at two different
 * objects carried identical `MoveOption.targets` and `labels.ts`'s
 * `labelDecision` (`packages/engine/src/labels.ts`) had nothing left to compare
 * them by — the `mtg-cee` board (one Emberflow Raider a side, two casts of
 * Lightning Lash) is exactly that pair, and `test/backend-projection.test.ts`
 * drives it end to end.
 */
function objectsIn(action: Action): readonly ObjectId[] {
  switch (action.type) {
    case 'playLand':
    case 'activateManaAbility':
      return [action.oid];
    case 'chooseManaColor':
      return [];
    case 'castSpell':
      return [
        action.oid,
        ...(action.sacrifices ?? []),
        ...(action.discards ?? []),
        ...targetedObjects(action.targets),
        ...targetedObjects(Object.values(action.multiTargets ?? {}).flat()),
      ];
    case 'beginCastSpell':
      return [
        action.oid,
        ...(action.sacrifices ?? []),
        ...(action.discards ?? []),
        ...targetedObjects(action.targets),
      ];
    case 'choosePluralTarget':
      return action.target?.kind === 'permanent' || action.target?.kind === 'spell'
        ? [action.oid, action.target.oid]
        : [action.oid];
    case 'allocateDividedDamage':
      return [action.oid];
    case 'chooseSpellTargets':
      return [
        action.oid,
        ...targetedObjects(action.targets),
        ...targetedObjects(Object.values(action.multiTargets ?? {}).flat()),
      ];
    case 'activateAbility':
      return [
        action.oid,
        ...(action.taps ?? []),
        ...(action.discards ?? []),
        ...targetedObjects(action.targets),
        ...targetedObjects(Object.values(action.multiTargets ?? {}).flat()),
      ];
    case 'chooseTriggerTargets':
      return [
        action.oid,
        ...targetedObjects(action.targets),
        ...targetedObjects(Object.values(action.multiTargets ?? {}).flat()),
      ];
    case 'chooseOpeningHandAction':
      return action.oid === null ? [] : [action.oid];
    case 'declareAttackers':
      return action.attackers.map((declaration) => declaration.oid);
    case 'declareBlockers':
      return action.blocks.map((block) => block.blocker);
    case 'orderAttackers':
      return action.orders.flatMap((order) => [order.blocker, ...order.attackers]);
    case 'scry':
      return [...action.top, ...action.bottom];
    case 'searchLibrary':
      // The one arm that can contribute nothing: failing to find (CR 701.19c)
      // names no object, and the empty list is the honest answer rather than a
      // highlight on whatever the last option pointed at.
      return action.found === null ? [] : [action.found];
    case 'chooseNamedZoneExile':
      return action.oid === null ? [] : [action.oid];
    case 'chooseSearchDestination':
      return [action.one];
    case 'chooseFromGraveyard':
      // The arm above's rule at the arm above's shape: taking nothing names no
      // object. Unlike a search, the cards this one *does* name are already
      // visible to both seats, so a highlight here costs no concealment.
      return action.chosen === null ? [] : [action.chosen];
    case 'choosePopulateToken':
      return [action.token];
    case 'choosePermanentToUntap':
      return action.oid === null ? [] : [action.oid];
    case 'chooseEntryCopy':
      return action.copyOf === null ? [action.oid] : [action.oid, action.copyOf];
    case 'chooseEntryCounterPermanent':
      return [action.oid, action.permanent];
    case 'chooseEntryAuraHost':
      return [action.oid, action.host];
    case 'chooseEntryTimestampNext':
      return [action.oid];
    case 'chooseEntryCharacteristics':
      return [action.oid];
    case 'chooseEntryOptionalCounter':
      return [action.oid];
    case 'chooseEntryPayLife':
      return [action.oid];
    case 'chooseEntryPlayer':
      return [action.oid];
    case 'chooseDiscards':
      // The named cards and nothing else. `discard` above is not in this switch
      // and stays out of it: the two carry the same field, but a cleanup
      // discard is answered against a hand the surface is already drawing,
      // where these can be cards in an opponent's hand that only a CR 701.16a
      // reveal put on the table. A highlight is exactly what that case wants.
      return action.oids;
    case 'chooseFromRevealedHand':
      return action.chosen === null ? [] : [action.chosen];
    case 'allocateDamagePrevention':
      return [action.sourceOid];
    default:
      return [];
  }
}

/**
 * The object ids named by a parallel `targets` list, in order, skipping the
 * slots an effect needed none for.
 *
 * A `player` target names a `PlayerId`, not an `ObjectId` — there is no
 * `GameObject` for a player, so `ObjectView` has nowhere to put one and this
 * function has nothing to append. That means a spell aimed at a player still
 * comes back with only its source in `objectsIn`'s list, so two such options
 * still carry equal `MoveOption.targets` and `labelDecision` (over the
 * contract, `packages/engine/src/labels.ts`) has nothing there to separate
 * them by. That residual case is not this function's to close: `describeAction`,
 * below, closes it by naming the player straight in the sentence — a fact this
 * projector already has and the contract's `MoveTarget` has no slot for
 * (`mtg-8yk1`).
 */
function targetedObjects(targets: readonly (Target | null)[]): readonly ObjectId[] {
  const oids: ObjectId[] = [];
  for (const target of targets) {
    if (target !== null && target.kind !== 'player') oids.push(target.oid);
  }
  return oids;
}

/**
 * One sentence per move, which is the least a rail can be drawn from.
 *
 * Deliberately plainer than `@mtg/ui`'s `naming.ts`, which is the surface's own
 * answer to "two legal moves must not read the same" and knows about controllers
 * and twins. This is what a backend owes a surface it has never met; a surface
 * that wants the good sentence holds a `GameSession` and asks `naming.ts` for
 * it. `mtg-bc2.151.3` closed that gap on the contract's side instead —
 * `packages/engine/src/labels.ts`'s `labelDecision` appends a qualifier when two
 * options collide, over `PendingDecision` and `TableView` alone, so a backend
 * that has never heard of `naming.ts` gets the repair by being a backend. What
 * `labelDecision` can reach is bounded by what this projector hands it: it
 * separates two options only when the objects their `MoveOption.targets` name
 * disagree, so the projector owes it every target `objectsIn` (above) can find,
 * and the sentence below owes it nothing further — except a player target,
 * which `objectsIn` can never find one for.
 *
 * **A player target is said always, not only on a collision** (`mtg-8yk1`).
 * `naming.ts`'s rung 1 makes that call for a permanent's controller over
 * `GameState` at the UI layer, and argues it both ways: always, because "a
 * phrase should be a fact about the object rather than about what else is in
 * the list beside it" (`labels.ts`, echoing the same line). Here there isn't
 * actually a choice to make: `describeAction` is called once per option, from
 * `projectOption` above, over that one `Action` and nothing else in the
 * decision, so it has no way to know whether this option collides with a
 * sibling. "Only on a collision" is a property of the whole option list —
 * it's what `labelDecision`'s qualifier already is, over `MoveOption.targets`
 * — and reaching it from here would mean widening `MoveTarget` to carry a
 * player, which this fix is pinned against. Always is the only door this
 * function has open, and it is a cheap one: a player target is the decision
 * itself (burn them or burn yourself), the same reason `naming.ts` gives for
 * spending the four characters on `your` every time.
 */
function describeAction(state: GameState, action: Action): string {
  const named = (oid: ObjectId): string => nameOf(state, oid);
  // The neutral contract holds no seat label — `GameState.players` carries no
  // name string, only the `PlayerId` a caller already has from `Target` — so
  // this says the player the same plain way `undo.ts`'s refusal messages do
  // (`player ${String(id)}`) rather than inventing a second, prettier
  // vocabulary for the same two-valued id.
  const targetedPlayer = (targets: readonly (Target | null)[]): PlayerId | null => {
    for (const target of targets) {
      if (target !== null && target.kind === 'player') return target.player;
    }
    return null;
  };
  const playerClause = (targets: readonly (Target | null)[]): string => {
    const player = targetedPlayer(targets);
    return player === null ? '' : ` at player ${String(player)}`;
  };
  const pluralTargetClause = (targets: {
    readonly multiTargets?: Readonly<Record<number, readonly Target[]>>;
  }): string => {
    if (targets.multiTargets === undefined) return '';
    const chosen = Object.values(targets.multiTargets).flat();
    if (chosen.length === 0) return ' at no targets';
    return ` at ${chosen
      .map((target) => (target.kind === 'player' ? `player ${String(target.player)}` : named(target.oid)))
      .join(', ')}`;
  };
  const spellTargetClause = (action: Extract<Action, { readonly type: 'chooseSpellTargets' }>): string => {
    const chosen = [
      ...action.targets.flatMap((target) => (target === null ? [] : [target])),
      ...Object.values(action.multiTargets ?? {}).flat(),
    ];
    if (chosen.length === 0) return ' with no targets';
    return ` at ${chosen
      .map((target) => (target.kind === 'player' ? `player ${String(target.player)}` : named(target.oid)))
      .join(', ')}`;
  };
  const sacrificeClause = (
    action: Extract<Action, { readonly type: 'castSpell' | 'beginCastSpell' }>,
  ): string => {
    const paid = action.sacrifices ?? [];
    return paid.length === 0 ? '' : ` sacrificing ${paid.map(named).join(', ')}`;
  };
  const discardClause = (
    action: Extract<Action, { readonly type: 'castSpell' | 'beginCastSpell' | 'activateAbility' }>,
  ): string => {
    const paid = action.discards ?? [];
    return paid.length === 0 ? '' : ` discarding ${paid.map(named).join(', ')}`;
  };
  const castingCostClause = (
    action: Extract<Action, { readonly type: 'castSpell' | 'beginCastSpell' }>,
  ): string =>
    action.castingCost === undefined
      ? ''
      : ` using ${
          action.castingCost === 'mana'
            ? 'printed mana'
            : action.castingCost === 'alternative'
              ? 'alternative cost'
              : action.castingCost === 'overload'
                ? 'overload cost'
                : 'no mana payment'
        }`;
  switch (action.type) {
    case 'passPriority':
      return 'Pass';
    case 'playLand':
      return `Play ${named(action.oid)}`;
    case 'castSpell':
      return `Cast ${named(action.oid)}${action.x === undefined ? '' : ` (X=${String(action.x)})`}${castingCostClause(action)}${sacrificeClause(action)}${discardClause(action)}${playerClause(action.targets)}${pluralTargetClause(action)}`;
    case 'beginCastSpell':
      return `Begin casting ${named(action.oid)}${action.x === undefined ? '' : ` (X=${String(action.x)})`}${castingCostClause(action)}${sacrificeClause(action)}${discardClause(action)}${playerClause(action.targets)}`;
    case 'choosePluralTarget':
      return action.target === null
        ? `Finish choosing targets for ${named(action.oid)}`
        : `Add ${action.target.kind === 'player' ? `player ${String(action.target.player)}` : named(action.target.oid)} as a target`;
    case 'allocateDividedDamage':
      return `Assign ${String(action.amount)} damage for ${named(action.oid)}`;
    case 'chooseSpellTargets':
      return `Aim ${named(action.oid)}${spellTargetClause(action)}`;
    case 'activateManaAbility':
      return state.pendingManaCombination === undefined
        ? `Tap ${named(action.oid)} for ${action.amount === undefined ? action.color : `${String(action.amount)} ${action.color}`}`
        : `Add ${action.color} to ${named(action.oid)}'s mana combination`;
    case 'activateAbility':
      return `Activate ${named(action.oid)}${action.mode === undefined ? '' : ` (mode ${String(action.mode + 1)})`}${action.x === undefined ? '' : ` (X=${String(action.x)})`}${discardClause(action)}${playerClause(action.targets)}${pluralTargetClause(action)}`;
    case 'chooseOpeningHandAction':
      return action.oid === null ? 'Finish opening-hand actions' : `Begin with ${named(action.oid)}`;
    case 'scry':
      return `Keep ${String(action.top.length)} on top; put ${String(action.bottom.length)} on bottom`;
    case 'searchLibrary':
      return action.found === null ? 'Find nothing' : `Take ${named(action.found)}`;
    case 'chooseSearchDestination':
      return `Assign ${named(action.one)} to the one-card destination`;
    case 'chooseFromGraveyard':
      return action.chosen === null ? 'Take nothing' : `Take ${named(action.chosen)}`;
    case 'choosePopulateToken':
      return `Copy ${named(action.token)}`;
    case 'choosePermanentToUntap':
      return action.oid === null ? 'Finish choosing permanents to untap' : `Untap ${named(action.oid)}`;
    case 'chooseEntryCopy':
      return action.copyOf === null ? 'Enter normally' : `Enter as a copy of ${named(action.copyOf)}`;
    case 'chooseEntryCounterPermanent':
      return `Put the entry counter on ${named(action.permanent)}`;
    case 'chooseEntryAuraHost':
      return `Enter attached to ${named(action.host)}`;
    case 'chooseEntryTimestampNext':
      return `Give ${named(action.oid)} the next timestamp`;
    case 'chooseEntryCharacteristics': {
      const mode = state.pendingEntryCharacteristicsChoice?.modes[action.mode];
      return mode === undefined
        ? `Choose entry form ${String(action.mode + 1)}`
        : `Enter as ${String(mode.power)}/${String(mode.toughness)}`;
    }
    case 'chooseEntryOptionalCounter':
      return action.accept ? `Enter ${named(action.oid)} with a +1/+1 counter` : 'Enter without a counter';
    case 'chooseEntryPayLife': {
      return action.pay
        ? `Pay ${String(action.life)} life as ${named(action.oid)} enters`
        : `Enter ${named(action.oid)} tapped`;
    }
    case 'chooseEntryPlayer':
      return `Choose player ${String(action.chosen)}`;
    case 'chooseDiscards':
      return `Discard ${action.oids.map(named).join(', ')}`;
    case 'chooseFromRevealedHand':
      return action.chosen === null ? 'Choose no card' : `Choose ${named(action.chosen)}`;
    case 'allocateDamagePrevention':
      return `Prevent ${String(action.amount)} damage from ${named(action.sourceOid)}`;
    default:
      return action.type;
  }
}

export function projectEvent(event: GameEvent, seq: number): EngineEvent {
  return projectDelivered(event, event, seq);
}

/**
 * One event as some seat receives it, with the reveal delta taken from the event
 * the reducer emitted rather than from the copy that seat is handed.
 *
 * The two differ by exactly the ids `seatEvent` replaced, and those are the ids
 * the license is for. A creature bounced into its owner's hand reaches the
 * opponent as a `zoneChanged` with a placeholder — correct, and no help, because
 * the real id is already in that opponent's log under the `spellCast` that
 * targeted it. Deriving `reveals` from the redacted copy would name the
 * placeholder and license nothing.
 */
function projectDelivered(delivered: GameEvent, emitted: GameEvent, seq: number): EngineEvent {
  return {
    seq,
    type: delivered.type,
    text: delivered.type,
    detail: delivered,
    reveals: publiclyIdentified(emitted).map((oid) => ({ oid: String(oid), seats: KERNEL_SEATS })),
  };
}

/**
 * The position as a `TableView`, showing the hands of the seats named `visible`.
 *
 * The table's own view passes the local seats, so a hot-seat game draws both
 * hands and a game against a bot draws one. A per-seat view passes that seat,
 * over a state the cards have already been removed from.
 */
export function projectState(state: GameState, table: SessionSpec, visible: readonly SeatId[]): TableView {
  return {
    version: PROJECTION_VERSION,
    turn: {
      number: state.turn.number,
      active: state.turn.active,
      phase: String(state.turn.step),
      step: String(state.turn.step),
    },
    priority: state.turn.priority,
    // An ability on the stack has an `ab<n>` id and no object behind it, so it
    // is projected from the permanent that printed it rather than from a miss.
    stack: state.stack.map((entry) =>
      entry.ability === null
        ? entry.copiedSpell === undefined
          ? projectObject(state, entry.oid)
          : {
              ...projectObject(state, entry.copiedSpell.sourceOid),
              oid: String(entry.oid),
              controller: controllerSeat(entry.controller),
            }
        : projectObject(state, entry.ability.sourceOid),
    ),
    seats: [
      projectSeat(state, table, 0, visible.includes(0)),
      projectSeat(state, table, 1, visible.includes(1)),
    ],
  };
}

function projectSeat(state: GameState, table: SessionSpec, id: SeatId, visible: boolean): SeatView {
  const player = state.players[asPlayerId(id)];
  const seat = table.seats[id];
  // Unreachable: the kernel backend only ever opens a table `refusalsFor` has
  // already checked carries exactly two seats.
  if (seat === undefined) throw new Error(`projectSeat: table has no seat ${String(id)}`);
  const controlled = state.battlefield.filter((oid) => state.objects[oid]?.controller === id);
  return {
    id,
    name: seat.name,
    life: player.life,
    hand: visible ? player.hand.map((oid) => projectObject(state, oid)) : null,
    handSize: player.hand.length,
    librarySize: player.library.length,
    graveyard: player.graveyard.map((oid) => projectObject(state, oid)),
    exile: state.exile
      .filter((oid) => state.objects[oid]?.owner === id)
      .map((oid) => projectObject(state, oid)),
    battlefield: controlled.map((oid) => projectObject(state, oid)),
  };
}

function projectObject(state: GameState, oid: ObjectId): ObjectView {
  const object = state.objects[oid];
  if (object === undefined) {
    return {
      oid: String(oid),
      name: '(gone)',
      typeLine: '',
      power: null,
      toughness: null,
      tapped: false,
      attacking: false,
      damage: 0,
      controller: 0,
      counters: {},
    };
  }
  const card = copiableCardOf(object);
  const current = object.zone === 'battlefield' ? characteristicsOf(state, oid) : null;
  const creature = current === null ? card.kind === 'creature' : isCreatureCharacteristics(current);
  const characteristics = creature ? (current ?? characteristicsOf(state, oid)) : null;
  return {
    oid: String(oid),
    name: card.name,
    typeLine: typeLineOf(card),
    power: characteristics === null ? null : characteristics.power,
    toughness: characteristics === null ? null : characteristics.toughness,
    tapped: object.tapped,
    attacking: state.combat.attacks.some((attack) => attack.oid === oid),
    damage: object.damage,
    controller: controllerSeat(object.controller),
    counters: countersOf(object.counters),
    // Only a permanent has a current set: anywhere else no continuous effect
    // applies (CR 611.2c) and the printed face already says everything.
    ...(current === null ? {} : { keywords: keywordsOf(current) }),
  };
}

function controllerSeat(player: PlayerId): SeatId {
  return player === 0 ? 0 : 1;
}

function countersOf(counters: Counters): Readonly<Record<string, number>> {
  const kept: Record<string, number> = {};
  for (const [kind, count] of Object.entries(counters)) {
    if (count !== undefined && count !== 0) kept[kind] = count;
  }
  return kept;
}
