import type { ObjectId } from './ids';
import type { GameState } from './state';

/** Removes every combat assignment made by or against a departing permanent. */
export function removeObjectFromCombat(state: GameState, oid: ObjectId): GameState {
  const attackerOrders = (state.combat.attackerOrders ?? [])
    .filter((order) => order.blocker !== oid)
    .map((order) => ({
      ...order,
      attackers: order.attackers.filter((attacker) => attacker !== oid),
    }))
    .filter((order) => order.attackers.length > 1);
  const { attackerOrders: _oldAttackerOrders, ...combat } = state.combat;
  return {
    ...state,
    combat: {
      ...combat,
      attacks: state.combat.attacks.filter((attack) => attack.oid !== oid),
      blocks: state.combat.blocks
        .filter((block) => block.attacker !== oid)
        .map((block) => ({ ...block, blockers: block.blockers.filter((blocker) => blocker !== oid) })),
      ...(attackerOrders.length === 0 ? {} : { attackerOrders }),
    },
  };
}
