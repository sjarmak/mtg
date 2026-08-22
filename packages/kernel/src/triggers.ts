/**
 * CR 603 triggered abilities: which printed triggers a run of events fired, and
 * putting them on the stack.
 *
 * This is not `replacement-effects.ts`, and the difference is the one that file
 * already draws. A `ReplaceableEvent` is a *proposal* the pipeline may rewrite
 * or delete before the kernel carries it out; a `GameEvent` is a *record* of
 * something that already happened. A trigger reads records. It never changes
 * the event it read: it puts a new object on the stack (CR 113.7a) that
 * resolves later, after state-based actions and before anybody gets priority.
 * "Enters tapped" and "enters with a counter" are replacement effects and live
 * over there; `zones.ts` says so at the arrival itself.
 *
 * Source conditions and the bounded event conditions all read events the
 * kernel already emitted. Exalted retains the sole attacker from
 * `attackersDeclared` and `selfDealsCombatDamageToCreature` retains the damaged
 * creature from `damageDealt`; the board- and event-scanning conditions added
 * alongside them (another permanent entering, a spell being cast, a step
 * beginning, a block being declared, life being gained, an opponent taking
 * noncombat damage) retain no referent — none of this slice's effects need to
 * aim at one — so they widen `conditionsFrom`'s scan-the-battlefield pattern
 * without touching `TriggerContext`. Hamletback Goliath is the card that would
 * change that: "X is that creature's power" needs the arriving creature kept,
 * and it is deliberately not here.
 */
import type { TriggerCondition } from '@mtg/dsl';
import { COLOR_CAST_TRIGGER_CONDITIONS, TRIGGER_POWER_THRESHOLD } from '@mtg/dsl';
import type { GameEvent } from './events';
import type { ObjectId, PlayerId } from './ids';
import { abilityObjectId } from './ids';
import { characteristicsOf, controllerOf, isCreatureObject } from './layers';
import type {
  Block,
  GameState,
  SourceCharacteristics,
  StackEntry,
  TriggerContext,
  TriggerContextKind,
} from './state';
import { apnapOrder } from './state';
import type { Trace } from './trace';
import { emit, withState } from './trace';
import { tryObject } from './zones';

/** A printed trigger whose condition was met, before it is on the stack. */
export interface PendingTrigger {
  readonly sourceOid: ObjectId;
  /** Index into `getObject(state, sourceOid).card.abilities`. */
  readonly index: number;
  readonly condition: TriggerCondition;
  /** CR 603.3a: the player who controlled the source as it triggered. */
  readonly controller: PlayerId;
  /**
   * The creature this trigger retained from its own event — exalted's lone
   * attacker, the creature the source just dealt combat damage to, or the
   * larger creature the source just met in a block. Absent on ordinary source
   * triggers.
   */
  readonly triggeringOid?: ObjectId;
  readonly sourceCharacteristics: SourceCharacteristics;
}

interface ConditionMatch {
  readonly oid: ObjectId;
  readonly condition: TriggerCondition;
  readonly triggeringOid?: ObjectId;
}

/**
 * Was this object a creature at the moment its condition is asked about?
 *
 * Asked of the layer system while the object is still on the battlefield, and
 * of its printed face once it has left. The fallback is not a shortcut: state-
 * based actions run *before* the trigger scan (`reduce.ts`'s `settle`), so a
 * creature that died to the very damage that fired the trigger is already in a
 * graveyard by the time this is asked, and `characteristicsOf` has nothing left
 * to read. `lastKnownSourceCharacteristics` carries colors and subtypes but no
 * card types, so the printed kind is the last-known answer available.
 *
 * Two callers, one question asked at two different moments: `damageDealt`
 * asks it of the *recipient*, already resolved by the time the event is
 * scanned; `permanentEntered` asks it of the *arriving* object, which is
 * already on the battlefield by the time that event fires (`zones.ts`), so
 * both reads land on the same branch.
 */
function wasCreature(state: GameState, oid: ObjectId): boolean {
  const object = tryObject(state, oid);
  if (object === undefined) return false;
  return object.zone === 'battlefield' ? isCreatureObject(state, oid) : object.card.kind === 'creature';
}

/**
 * A creature's layered power, or `null` when the object is not one.
 *
 * Two callers ask it at two moments: `blockersDeclared`, for the two halves of
 * a block, and `permanentEntered`, for the power threshold on an arrival.
 *
 * `characteristicsOf` throws on an id it cannot find, and this runs over a
 * `blockersDeclared` event that may be several events behind the current state
 * — a blocker destroyed by a first-strike replacement before the scan reaches
 * this event is gone by now — so the lookup is guarded rather than assumed. A
 * missing body reports `null` and the pairing it belonged to is simply not a
 * match, which is the same answer CR 509.1 gives: a creature that has left
 * combat is not blocking anything.
 */
function combatPower(state: GameState, oid: ObjectId): number | null {
  if (tryObject(state, oid) === undefined) return null;
  if (!isCreatureObject(state, oid)) return null;
  return characteristicsOf(state, oid).power;
}

/**
 * CR 509.1: the two halves of one block, filtered by power.
 *
 * One match per qualifying *creature*, not per block, because the condition
 * names a creature and CR 603.2 fires a trigger once per event that satisfies
 * it — a double block by two larger creatures gives the attacker two triggers
 * with two different referents, and each larger blocker also gives itself none,
 * since the source it blocked is the smaller one.
 *
 * Strictly greater in both directions, so equal power produces nothing at all
 * rather than firing both sides. That is the design intent stated on the
 * condition in `@mtg/dsl`'s vocabulary: the mechanic rewards standing in front
 * of something bigger, and two equal creatures trading is the ordinary combat
 * it is meant to be an alternative to.
 *
 * Power is read here, at declaration, and never again. A pump resolving later
 * in the declare-blockers step does not retroactively add or remove a trigger,
 * which matches how CR 509.1a checks its own legality: at the moment blockers
 * are declared, against the characteristics that exist then.
 */
function greaterPowerMatches(state: GameState, block: Block): readonly ConditionMatch[] {
  const attackerPower = combatPower(state, block.attacker);
  if (attackerPower === null) return [];
  const matches: ConditionMatch[] = [];
  for (const blockerOid of block.blockers) {
    const blockerPower = combatPower(state, blockerOid);
    if (blockerPower === null) continue;
    if (attackerPower > blockerPower) {
      matches.push({
        oid: blockerOid,
        condition: 'selfBlocksOrIsBlockedByGreaterPower',
        triggeringOid: block.attacker,
      });
    }
    if (blockerPower > attackerPower) {
      matches.push({
        oid: block.attacker,
        condition: 'selfBlocksOrIsBlockedByGreaterPower',
        triggeringOid: blockerOid,
      });
    }
  }
  return matches;
}

/**
 * Which condition one event satisfies, and for which objects.
 *
 * Eight events answer the whole DSL v1 vocabulary: `permanentEntered` (which
 * every arrival emits, tokens included, since `mtg-4vf`), a `zoneChanged` from
 * the battlefield to a graveyard (which covers destruction, lethal damage and
 * zero toughness alike, because all three route through `moveObject`),
 * `attackersDeclared`, `damageDealt`, `stepBegan`, `spellCast`,
 * `blockersDeclared` and `lifeChanged`. Every other event answers none, and the
 * default says so rather than asserting: `GameEvent` grows for reasons that
 * have nothing to do with this file.
 *
 * The source-scanning conditions (`selfEnters`, `selfAttacks`, `selfDies`,
 * `selfDealsCombatDamageToCreature`, `selfDealsCombatDamageToPlayer`,
 * `selfBlocks`, `selfEntersOrAttacks`) match against the event's own object.
 * `selfEntersOrAttacks` is the one that answers two of those events rather than
 * one, and it answers each of them exactly once: it is emitted beside
 * `selfEnters` on an arrival and beside `selfAttacks` on a declaration, so a
 * permanent that enters and later attacks fires it twice, in two events, and a
 * permanent that does one of the two fires it once. The board-scanning
 * conditions (`controlledCreatureAttacksAlone`,
 * `anotherControlledPermanentEnters`, `anotherControlledCreatureEnters`,
 * `beginningOfYourUpkeep`, `beginningOfYourEndStep`, `youCastSpell`,
 * `youCastInstantOrSorcery`, `youGainLife`,
 * `anotherControlledCreatureWithPowerThreeOrGreaterEnters`) enumerate every
 * permanent this player controls, because the ability that might hold the
 * condition is not the event's own object — the generic per-object ability-list
 * check in `collectTriggers` decides which of those permanents actually print
 * it.
 *
 * Two conditions scan wider than one player's half of the board, and each says
 * why at its own arm. The five `aPlayerCasts<Color>Spell` members scan every
 * permanent in play, because the printed line says "a player" and the M11
 * artifact cycle sits on either seat's battlefield reading both.
 * `opponentDealtNoncombatDamage` scans on the inverse filter — every permanent
 * whose controller is *not* the damaged player — because "an opponent" is said
 * from each permanent's controller's side, and the damaged player's own
 * permanents are the ones that must stay silent.
 */
function conditionsFrom(
  state: GameState,
  event: GameEvent,
  sacrificed: Set<ObjectId>,
): readonly ConditionMatch[] {
  switch (event.type) {
    case 'permanentEntered': {
      const enteredIsCreature = wasCreature(state, event.oid);
      // CR 603.2 checks the condition against the game as it stands immediately
      // after the event, and `zones.ts` emits this one with the object already
      // on the battlefield, so the power is the layered power an anthem or a
      // -2/-0 effect has already had its say about. `combatPower` guards the
      // lookup for the reason it guards a blocker's: the object may be gone.
      const enteredPower = enteredIsCreature ? combatPower(state, event.oid) : null;
      const enteredIsBig = enteredPower !== null && enteredPower >= TRIGGER_POWER_THRESHOLD;
      const others = state.battlefield
        .filter((oid) => oid !== event.oid && controllerOf(state, oid) === event.controller)
        .flatMap((oid): ConditionMatch[] => [
          { oid, condition: 'anotherControlledPermanentEnters' },
          ...(enteredIsCreature ? [{ oid, condition: 'anotherControlledCreatureEnters' as const }] : []),
          ...(enteredIsBig
            ? [{ oid, condition: 'anotherControlledCreatureWithPowerThreeOrGreaterEnters' as const }]
            : []),
        ]);
      return [
        { oid: event.oid, condition: 'selfEnters' },
        { oid: event.oid, condition: 'selfEntersOrAttacks' },
        ...others,
      ];
    }
    case 'stepBegan': {
      if (event.step !== 'upkeep' && event.step !== 'end') return [];
      const condition = event.step === 'upkeep' ? 'beginningOfYourUpkeep' : 'beginningOfYourEndStep';
      const mine = state.battlefield
        .filter((oid) => controllerOf(state, oid) === event.active)
        .map((oid): ConditionMatch => ({ oid, condition }));
      // "At the beginning of the end step" is every permanent on the
      // battlefield, whoever controls it — the printed word is "the", not
      // "your". Two scans over the one event rather than a widened filter,
      // because a card that prints the filtered line and a card that prints
      // this one both fire on the active player's turn and only this one fires
      // on the other player's, and a single scan cannot say both.
      const everyone =
        event.step === 'end'
          ? state.battlefield.map((oid): ConditionMatch => ({ oid, condition: 'beginningOfEndStep' }))
          : [];
      return [...mine, ...everyone];
    }
    case 'spellCast': {
      const cast = tryObject(state, event.oid);
      const isInstantOrSorcery =
        cast !== undefined && (cast.card.kind === 'instant' || cast.card.kind === 'sorcery');
      // CR 105.2: the spell's colors, one condition each, so a white-blue spell
      // answers two members once apiece rather than one member twice. Read off
      // the printed card because a spell on the stack is not a permanent — the
      // layer system does not reach it, and nothing in this vocabulary changes
      // a spell's color while it is there.
      const castColors = cast === undefined ? [] : cast.card.colors;
      const colorConditions = castColors.map((color) => COLOR_CAST_TRIGGER_CONDITIONS[color]);
      return [
        ...state.battlefield
          .filter((oid) => controllerOf(state, oid) === event.player)
          .flatMap((oid): ConditionMatch[] => [
            { oid, condition: 'youCastSpell' },
            ...(isInstantOrSorcery ? [{ oid, condition: 'youCastInstantOrSorcery' as const }] : []),
          ]),
        // The whole battlefield, not the caster's half: the printed line on the
        // M11 artifact cycle says "a player", so a permanent the other seat
        // controls answers this event too.
        ...state.battlefield.flatMap((oid): ConditionMatch[] =>
          colorConditions.map((condition): ConditionMatch => ({ oid, condition })),
        ),
      ];
    }
    case 'blockersDeclared':
      return event.blocks.flatMap((block): ConditionMatch[] => [
        ...block.blockers.map((oid): ConditionMatch => ({ oid, condition: 'selfBlocks' })),
        ...greaterPowerMatches(state, block),
      ]);
    case 'lifeChanged': {
      // `gainLife` (`damage.ts`) is the only source of a `'gainLife'` or
      // `'lifelink'` reason, and it early-returns on a non-positive amount, so
      // every event reaching this branch is a real gain, never a loss dressed
      // as one.
      if (event.reason !== 'gainLife' && event.reason !== 'lifelink') return [];
      return state.battlefield
        .filter((oid) => controllerOf(state, oid) === event.player)
        .map((oid): ConditionMatch => ({ oid, condition: 'youGainLife' }));
    }
    case 'zoneChanged':
      if (event.from !== 'battlefield' || event.to !== 'graveyard') return [];
      // One departure, two printed conditions, and the narrower one is a
      // filter on the wider rather than a replacement for it: a card printing
      // `selfDies` still fires on a sacrifice, because "dies" in CR 700.4 is
      // the zone change and says nothing about the cause.
      // `delete` rather than `has`: the id is consumed by the zone change it
      // belongs to, so a permanent sacrificed, returned and destroyed inside one
      // scan window is read correctly both times.
      return sacrificed.delete(event.oid)
        ? [{ oid: event.oid, condition: 'selfDies' }]
        : [
            { oid: event.oid, condition: 'selfDies' },
            { oid: event.oid, condition: 'selfDiesNotSacrificed' },
          ];
    case 'damageDealt': {
      // `combat` is the flag `applyDamage` carries through the replacement
      // pipeline, so damage from a spell or an activated ability answers
      // neither branch below. The two branches after it are the two shapes
      // `DamageTarget` has: a player, or a permanent that also has to be a
      // creature, because a planeswalker is a permanent too.
      if (!event.combat) {
        // The complement of the two combat branches below, and the one board
        // scan in this file that runs on an inverted filter: the seat that took
        // the damage is exactly the seat that must not fire, because "an
        // opponent" is said from each permanent's own controller's side. A
        // permanent damaged by a noncombat source answers nothing here — the
        // printed condition names a player.
        if (event.target.kind !== 'player') return [];
        const damaged = event.target.player;
        return state.battlefield
          .filter((oid) => controllerOf(state, oid) !== damaged)
          .map((oid): ConditionMatch => ({ oid, condition: 'opponentDealtNoncombatDamage' }));
      }
      if (event.target.kind === 'player') {
        return [{ oid: event.sourceOid, condition: 'selfDealsCombatDamageToPlayer' }];
      }
      if (!wasCreature(state, event.target.oid)) return [];
      return [
        {
          oid: event.sourceOid,
          condition: 'selfDealsCombatDamageToCreature',
          triggeringOid: event.target.oid,
        },
      ];
    }
    case 'attackersDeclared': {
      const loneAttack = event.attacks[0];
      return [
        ...event.attacks.flatMap((attack): ConditionMatch[] => [
          { oid: attack.oid, condition: 'selfAttacks' },
          { oid: attack.oid, condition: 'selfEntersOrAttacks' },
        ]),
        ...(event.attacks.length === 1 && loneAttack !== undefined
          ? state.battlefield
              .filter((oid) => controllerOf(state, oid) === event.player)
              .map((oid): ConditionMatch => ({
                oid,
                condition: 'controlledCreatureAttacksAlone',
                triggeringOid: loneAttack.oid,
              }))
          : []),
      ];
    }
    default:
      return [];
  }
}

/**
 * CR 603.3a asks who controlled the source when the ability triggered. A
 * permanent still on the battlefield is asked of the layer system, because
 * layer 2 owns control; one that has already left keeps the controller its
 * object record carries, which is what a death trigger needs — the creature is
 * in the graveyard by the time the event is scanned.
 */
function controllerAsTriggered(state: GameState, oid: ObjectId): PlayerId | null {
  const object = tryObject(state, oid);
  if (object === undefined) return null;
  return object.zone === 'battlefield' ? controllerOf(state, oid) : object.controller;
}

/**
 * CR 603.3b: simultaneous triggers go on the stack in APNAP order, each player
 * choosing among their own. The slice is two-player, so APNAP is "the active
 * player's first", and within one player v1 orders deterministically — the
 * order the events were emitted, then printed ability order — rather than
 * asking. Making that a decision is a fifth `AwaitKind` and a `Decision`
 * variant, which is its own bead.
 */
export function orderTriggers(state: GameState, fired: readonly PendingTrigger[]): readonly PendingTrigger[] {
  return apnapOrder(state).flatMap((player) => fired.filter((trigger) => trigger.controller === player));
}

/**
 * Every printed trigger fired by the events from `from` onward, in the order
 * they belong on the stack.
 *
 * The watermark is an index into the trace's own events rather than state,
 * which is sound because `settle` is the only caller and never returns while an
 * event is unscanned.
 */
export function collectTriggers(trace: Trace, from: number): readonly PendingTrigger[] {
  const state = trace.state;
  const fired: PendingTrigger[] = [];
  // CR 701.17b's half of `selfDiesNotSacrificed`, carried forward across the
  // scan rather than looked up per event, because a sacrifice is two events:
  // `permanentSacrificed` is emitted and the `zoneChanged` follows it
  // (`reduce.ts`). The id is *consumed* when its zone change is read, so a
  // permanent sacrificed, returned and then destroyed inside one scan window
  // gets the right answer both times — a plain accumulating set would call the
  // second death a sacrifice too.
  const sacrificed = new Set<ObjectId>();
  for (const event of trace.events.slice(from)) {
    if (event.type === 'permanentSacrificed') sacrificed.add(event.oid);
    for (const match of conditionsFrom(state, event, sacrificed)) {
      const object = tryObject(state, match.oid);
      const controller = controllerAsTriggered(state, match.oid);
      if (object === undefined || controller === null) continue;
      for (const [index, ability] of object.card.abilities.entries()) {
        if (ability.kind !== 'triggered' || ability.condition !== match.condition) continue;
        const current =
          object.zone === 'battlefield'
            ? characteristicsOf(state, match.oid)
            : object.lastKnownSourceCharacteristics;
        if (current === undefined) continue;
        fired.push({
          sourceOid: match.oid,
          index,
          condition: match.condition,
          controller,
          ...(match.triggeringOid === undefined ? {} : { triggeringOid: match.triggeringOid }),
          sourceCharacteristics: { colors: [...current.colors], subtypes: [...current.subtypes] },
        });
      }
    }
  }
  return orderTriggers(state, fired);
}

/**
 * The referent a fired trigger retained, or `null` when it retained none.
 *
 * Only the conditions `TriggerContextKind` names ever carry a `triggeringOid`,
 * so the `kind` is read off the condition rather than passed alongside it — one
 * field cannot then disagree with the other.
 */
function contextFor(trigger: PendingTrigger): TriggerContext | null {
  if (trigger.triggeringOid === undefined) return null;
  const kind: TriggerContextKind =
    trigger.condition === 'selfDealsCombatDamageToCreature' ||
    trigger.condition === 'selfBlocksOrIsBlockedByGreaterPower'
      ? trigger.condition
      : 'controlledCreatureAttacksAlone';
  return { kind, triggeringCreature: trigger.triggeringOid };
}

/**
 * Puts fired triggers on the stack as objects of their own (CR 113.7a), and
 * records that each one fired.
 *
 * Each entry mints an id from the same monotonic counter every other id comes
 * from, so an ability object can never collide with a card — and it is only an
 * id: an ability on the stack has no `GameObject`, which is why `resolveTop`
 * branches on `entry.ability` before it looks one up.
 *
 * `abilityTriggered` is emitted here, one per entry, for the reason
 * `abilityActivated` is emitted in `pushAbility` rather than in the reducer:
 * the id the event reports is minted on this line, and an event assembled
 * anywhere else would be quoting a number it had to be told. The entries go on
 * one at a time rather than as a batch so each event follows the state that
 * carries it, which is what a replay reading the log step by step needs.
 */
export function putTriggersOnStack(trace: Trace, fired: readonly PendingTrigger[]): Trace {
  let current = trace;
  for (const trigger of fired) {
    const state = current.state;
    const oid = abilityObjectId(state.nextId);
    const entry: StackEntry = {
      oid,
      controller: trigger.controller,
      targets: [],
      ability: { sourceOid: trigger.sourceOid, index: trigger.index },
      mode: null,
      triggerContext: contextFor(trigger),
      x: null,
      sourceCharacteristics: trigger.sourceCharacteristics,
    };
    const pushed = withState(current, {
      ...state,
      nextId: state.nextId + 1,
      stack: [...state.stack, entry],
    });
    current = emit(pushed, {
      type: 'abilityTriggered',
      player: trigger.controller,
      oid,
      source: trigger.sourceOid,
      index: trigger.index,
      condition: trigger.condition,
    });
  }
  return current;
}
