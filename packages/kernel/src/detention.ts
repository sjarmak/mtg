/** Immutable CR 701.29 Detain rules. */
import type { ObjectId, PlayerId } from './ids';
import type { GameState } from './state';

export interface DetentionRule {
  readonly sourceOid: ObjectId;
  readonly subjectOid: ObjectId;
  /** The controller whose next turn ends this rule, fixed as the effect resolves. */
  readonly expirySeat: PlayerId;
}

export function detainPermanent(
  state: GameState,
  sourceOid: ObjectId,
  subjectOid: ObjectId,
  expirySeat: PlayerId,
): GameState {
  const subject = state.objects[subjectOid];
  if (subject === undefined || subject.zone !== 'battlefield') return state;
  const rule: DetentionRule = {
    sourceOid,
    subjectOid,
    expirySeat,
  };
  return { ...state, detentions: [...state.detentions, rule] };
}

export function isDetained(state: GameState, subjectOid: ObjectId): boolean {
  const subject = state.objects[subjectOid];
  if (subject === undefined || subject.zone !== 'battlefield') return false;
  return state.detentions.some((rule) => rule.subjectOid === subjectOid);
}

export function expireDetentionsBeforeTurn(state: GameState, active: PlayerId): GameState {
  const detentions = state.detentions.filter((rule) => rule.expirySeat !== active);
  return detentions.length === state.detentions.length ? state : { ...state, detentions };
}

export function sweepDetentionsForSubject(state: GameState, subjectOid: ObjectId): GameState {
  const detentions = state.detentions.filter((rule) => rule.subjectOid !== subjectOid);
  return detentions.length === state.detentions.length ? state : { ...state, detentions };
}
