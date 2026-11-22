/** Source-incarnation-bound retaliation rules created by a resolved loyalty ability. */
import type { Card } from '@mtg/dsl';
import type { ObjectId, PlayerId } from './ids';
import type { GameState, SourceCharacteristics } from './state';

export interface DamageRetaliationRule {
  readonly sourceOid: ObjectId;
  readonly sourceBattlefieldIncarnation: number;
  readonly sourceCard: Card;
  readonly sourceAbilityIndex: number;
  readonly sourceCharacteristics: SourceCharacteristics;
  readonly controller: PlayerId;
  readonly expirySeat: PlayerId;
}

export function registerDamageRetaliation(state: GameState, rule: DamageRetaliationRule): GameState {
  return { ...state, damageRetaliations: [...state.damageRetaliations, rule] };
}

/** "Until your next turn" ends immediately before that turn begins. */
export function expireDamageRetaliationsBeforeTurn(state: GameState, active: PlayerId): GameState {
  const damageRetaliations = state.damageRetaliations.filter((rule) => rule.expirySeat !== active);
  return damageRetaliations.length === state.damageRetaliations.length
    ? state
    : { ...state, damageRetaliations };
}
