/** Faerie Impostor's non-targeting return-cost candidates at resolution. */
import type { ObjectId, PlayerId } from './ids';
import { controllerOf, isCreatureObject } from './layers';
import type { GameState } from './state';

/** Every other creature the resolving trigger's controller currently controls. */
export function returnAnotherCreatureCandidates(
  state: GameState,
  sourceOid: ObjectId,
  controller: PlayerId,
): readonly ObjectId[] {
  return state.battlefield.filter(
    (oid) => oid !== sourceOid && controllerOf(state, oid) === controller && isCreatureObject(state, oid),
  );
}
