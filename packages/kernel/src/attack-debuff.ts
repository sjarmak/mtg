/** Source-bound delayed attack triggers created by Jace, Architect of Thought's +1. */
import type { Card } from '@mtg/dsl';
import type { ObjectId, PlayerId } from './ids';
import type { GameState, SourceCharacteristics } from './state';

export interface AttackDebuffRule {
  readonly sourceOid: ObjectId;
  readonly sourceBattlefieldIncarnation: number;
  readonly sourceCard: Card;
  readonly sourceAbilityIndex: number;
  readonly sourceCharacteristics: SourceCharacteristics;
  readonly controller: PlayerId;
  readonly expirySeat: PlayerId;
}

export function registerAttackDebuff(state: GameState, rule: AttackDebuffRule): GameState {
  return { ...state, attackDebuffs: [...state.attackDebuffs, rule] };
}

/** "Until your next turn" ends immediately before that turn begins. */
export function expireAttackDebuffsBeforeTurn(state: GameState, active: PlayerId): GameState {
  const attackDebuffs = state.attackDebuffs.filter((rule) => rule.expirySeat !== active);
  return attackDebuffs.length === state.attackDebuffs.length ? state : { ...state, attackDebuffs };
}
