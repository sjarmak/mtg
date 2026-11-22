/** Live CR 508.1c additional costs imposed on an attacker declaration. */
import { ZERO_MANA_COST, type ManaCost } from '@mtg/dsl';
import type { AttackDeclaration } from './actions';
import type { PlayerId } from './ids';
import { controllerOf, hasCardType } from './layers';
import { canPay } from './mana';
import { staticPlayerRuleInstances } from './player-rules';
import type { CombatDefender, GameState } from './state';

function isProtectedDefender(state: GameState, controller: PlayerId, defender: CombatDefender): boolean {
  if (typeof defender === 'number') return defender === controller;
  return defender.kind === 'planeswalker' && controllerOf(state, defender.oid) === controller;
}

/** The combined generic cost of one complete or partial declaration. */
export function attackTaxAmount(
  state: GameState,
  attacker: PlayerId,
  attacks: readonly AttackDeclaration[],
): number {
  let amount = 0;
  for (const instance of staticPlayerRuleInstances(
    state,
    attacker,
    'attackControllerOrPlaneswalkersTaxedByControlledEnchantments',
  )) {
    const enchantments = state.battlefield.filter(
      (oid) =>
        controllerOf(state, oid) === instance.sourceController && hasCardType(state, oid, 'enchantment'),
    ).length;
    const taxed = attacks.filter((attack) =>
      isProtectedDefender(state, instance.sourceController, attack.defender),
    ).length;
    amount += enchantments * taxed;
  }
  return amount;
}

export function attackTaxCost(
  state: GameState,
  attacker: PlayerId,
  attacks: readonly AttackDeclaration[],
): ManaCost | null {
  const generic = attackTaxAmount(state, attacker, attacks);
  return generic === 0 ? null : { ...ZERO_MANA_COST, generic };
}

export function canPayAttackTaxes(
  state: GameState,
  attacker: PlayerId,
  attacks: readonly AttackDeclaration[],
): boolean {
  const cost = attackTaxCost(state, attacker, attacks);
  return cost === null || canPay(state, attacker, cost);
}
