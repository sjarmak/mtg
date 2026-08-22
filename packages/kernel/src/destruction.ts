import type { DestroyReason } from './events';
import type { ObjectId, PlayerId } from './ids';
import { hasKeywordAbility } from './layers';
import { applyReplacements } from './replacement';
import type { ReplacementEffect } from './replacement-effects';
import type { GameState } from './state';
import type { Trace } from './trace';
import { emit, putObject, withState } from './trace';
import { noteReplacements } from './damage';
import { getObject, isOnBattlefield, moveObject, tapObject } from './zones';

export function createRegenerationShield(trace: Trace, oid: ObjectId, controller: PlayerId): Trace {
  if (!isOnBattlefield(trace.state, oid)) return trace;
  const id = `regeneration:${String(trace.state.nextId)}`;
  const effect: ReplacementEffect = {
    id,
    sourceOid: oid,
    controller,
    timestamp: trace.state.nextId,
    duration: 'endOfTurn',
    selfReplacement: true,
    trigger: { kind: 'destroy', oid },
    modification: { kind: 'regenerate' },
  };
  return withState(trace, {
    ...trace.state,
    nextId: trace.state.nextId + 1,
    replacements: [...trace.state.replacements, effect],
  });
}

function removeFromCombat(state: GameState, oid: ObjectId): GameState {
  return {
    ...state,
    combat: {
      ...state.combat,
      attacks: state.combat.attacks.filter((attack) => attack.oid !== oid),
      blocks: state.combat.blocks
        .filter((block) => block.attacker !== oid)
        .map((block) => ({ ...block, blockers: block.blockers.filter((blocker) => blocker !== oid) })),
    },
  };
}

/**
 * CR 701.17a: the permanent's controller moves it to its owner's graveyard.
 *
 * Deliberately not a call into `destroyPermanent` below, and this is the load-
 * bearing line of the file. A sacrifice is not a destruction, so none of that
 * function's three refusals applies to it:
 *
 *   - Indestructible (CR 702.12b) stops a permanent from being *destroyed*.
 *     A sacrificed indestructible creature goes to the graveyard.
 *   - A regeneration shield (CR 701.15) is a replacement for a destroy event.
 *     No destroy event is raised here, so an existing shield is neither used
 *     nor spent.
 *   - `applyReplacements` is not consulted at all, for the same reason.
 *
 * It cannot be regenerated back into a `permanentDestroyed`, either: the event
 * this emits is `permanentSacrificed`, which is what `selfDiesNotSacrificed`
 * reads to tell the two deaths apart (CR 603.6c's distinction, already in the
 * trigger vocabulary).
 *
 * The three callers are the two activation-cost sites in `reduce.ts` — an
 * ability whose cost sacrifices the source, and one that sacrifices other
 * permanents (CR 601.2h) — and the `sacrificeSelf` effect's handler in
 * `effects.ts`. All three were the same three lines before this existed, and
 * the effect's arrival is what made a shared function worth naming: a fourth
 * copy is a fourth chance for one of them to reach for `destroyPermanent`.
 *
 * `player` is who sacrificed it, which CR 701.17a fixes as the permanent's
 * controller — no other player may sacrifice it, and no effect in this
 * vocabulary asks one to.
 */
export function sacrificePermanent(trace: Trace, oid: ObjectId, player: PlayerId): Trace {
  if (!isOnBattlefield(trace.state, oid)) return trace;
  return moveObject(emit(trace, { type: 'permanentSacrificed', oid, player }), oid, 'graveyard');
}

export function destroyPermanent(trace: Trace, oid: ObjectId, reason: DestroyReason): Trace {
  if (!isOnBattlefield(trace.state, oid)) return trace;
  if (reason !== 'zeroToughness' && hasKeywordAbility(trace.state, oid, 'indestructible')) return trace;
  if (reason === 'zeroToughness') {
    return moveObject(emit(trace, { type: 'permanentDestroyed', oid, reason }), oid, 'graveyard');
  }

  const outcome = applyReplacements(trace.state, { kind: 'destroy', oid });
  let current = noteReplacements(
    withState(trace, { ...trace.state, replacements: outcome.replacements }),
    outcome.appliedIds,
    'destroy',
  );
  if (outcome.event === null) {
    current = tapObject(current, oid);
    const object = getObject(current.state, oid);
    current = withState(
      current,
      removeFromCombat(
        putObject(current.state, {
          ...object,
          damage: 0,
          deathtouched: false,
        }),
        oid,
      ),
    );
    return emit(current, { type: 'permanentRegenerated', oid });
  }
  return moveObject(emit(current, { type: 'permanentDestroyed', oid, reason }), oid, 'graveyard');
}
