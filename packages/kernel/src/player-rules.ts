/** Live static rules that affect a player rather than a battlefield object. */
import type { StaticPlayerRule } from '@mtg/dsl';
import type { ObjectId, PlayerId } from './ids';
import { abilitiesOf, controllerOf } from './layers';
import { selectPrintedByCardFilter } from './zone-filter';
import type { GameState } from './state';

function playerMeetsRuleCondition(state: GameState, player: PlayerId, rule: StaticPlayerRule): boolean {
  switch (rule) {
    case 'cantAttackWithCreaturesIfCastSpellThisTurn':
      return state.turn.playersWhoCastSpellThisTurn.includes(player);
    case 'cantCastSpellsIfAttackedWithCreatureThisTurn':
      return state.turn.playersWhoAttackedWithCreatureThisTurn.includes(player);
    case 'hasHexproof':
    case 'castSpellsAsThoughFlash':
    case 'castSpellsFromHandWithoutPayingManaCost':
    case 'cardsToGraveyardAreExiled':
    case 'cardsOrTokensToGraveyardAreExiled':
    case 'instantOrSorceryCardsToGraveyardAreExiled':
    case 'noMaximumHandSize':
    case 'playWithTopLibraryRevealed':
    case 'attackControllerOrPlaneswalkersTaxedByControlledEnchantments':
      return true;
  }
}

export interface StaticPlayerRuleInstance {
  readonly sourceOid: ObjectId;
  readonly sourceController: PlayerId;
  readonly abilityIndex: number;
  /** Battlefield entry order, the deterministic default order for CR 616.1. */
  readonly timestamp: number;
}

/** Every live, layer-derived ability imposing `rule` on `player`. */
export function staticPlayerRuleInstances(
  state: GameState,
  player: PlayerId,
  rule: StaticPlayerRule,
): readonly StaticPlayerRuleInstance[] {
  if (!playerMeetsRuleCondition(state, player, rule)) return [];
  return state.battlefield.flatMap((sourceOid, timestamp) => {
    const sourceController = controllerOf(state, sourceOid);
    return abilitiesOf(state, sourceOid).flatMap((ability, abilityIndex) =>
      ability.kind === 'staticPlayerRule' &&
      ability.rule === rule &&
      (ability.players === 'controller'
        ? sourceController === player
        : ability.players === 'eachOpponent'
          ? sourceController !== player
          : true)
        ? [{ sourceOid, sourceController, abilityIndex, timestamp }]
        : [],
    );
  });
}

/**
 * Whether a current battlefield source imposes one rule on `player`, its
 * declared player scope reaches that player, and any turn condition is true.
 *
 * Nothing is registered on entry: the source controller, layer-derived
 * abilities, and turn fact are re-read on every legality query. Entering,
 * leaving, changing controller, copying, or losing abilities therefore changes
 * the answer immediately.
 */
export function staticPlayerRuleApplies(state: GameState, player: PlayerId, rule: StaticPlayerRule): boolean {
  return staticPlayerRuleInstances(state, player, rule).length > 0;
}

/** CR 514.1's live excess-card count, with "no maximum" represented by zero. */
export function cleanupDiscardCount(state: GameState, player: PlayerId): number {
  if (staticPlayerRuleApplies(state, player, 'noMaximumHandSize')) return 0;
  return Math.max(0, state.players[player].hand.length - state.config.maximumHandSize);
}

/** Whether one hand object receives a live cast-as-though-Flash permission. */
export function flashCastingPermissionApplies(
  state: GameState,
  player: PlayerId,
  candidateOid: ObjectId,
): boolean {
  return staticPlayerRuleInstances(state, player, 'castSpellsAsThoughFlash').some((instance) => {
    const ability = abilitiesOf(state, instance.sourceOid)[instance.abilityIndex];
    if (ability?.kind !== 'staticPlayerRule' || ability.rule !== 'castSpellsAsThoughFlash') return false;
    return (
      ability.spellFilter === undefined ||
      selectPrintedByCardFilter(state, [candidateOid], ability.spellFilter).length === 1
    );
  });
}

/** Whether a live battlefield rule lets this player cast hand spells without paying mana. */
export function freeCastFromHandPermissionApplies(state: GameState, player: PlayerId): boolean {
  return staticPlayerRuleApplies(state, player, 'castSpellsFromHandWithoutPayingManaCost');
}
