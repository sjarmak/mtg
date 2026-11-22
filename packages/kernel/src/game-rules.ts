/** Live rules governing game results, life gain, and damage prevention. */
import { assertNever, type StaticGameRule } from '@mtg/dsl';
import type { PlayerId } from './ids';
import { abilitiesOf, controllerOf } from './layers';
import type { GameState } from './state';

function preventsLoss(rule: StaticGameRule, controller: PlayerId, player: PlayerId): boolean {
  switch (rule) {
    case 'controllerCantLoseAndOpponentsCantWin':
      return player === controller;
    case 'playersCantGainLife':
    case 'damageCantBePrevented':
    case 'cardsInGraveyardsCantBeTargets':
      return false;
    default:
      return assertNever(rule, 'preventsLoss');
  }
}

function preventsWin(rule: StaticGameRule, controller: PlayerId, player: PlayerId): boolean {
  switch (rule) {
    case 'controllerCantLoseAndOpponentsCantWin':
      return player !== controller;
    case 'playersCantGainLife':
    case 'damageCantBePrevented':
    case 'cardsInGraveyardsCantBeTargets':
      return false;
    default:
      return assertNever(rule, 'preventsWin');
  }
}

function hasGameRule(
  state: GameState,
  matches: (rule: StaticGameRule, controller: PlayerId) => boolean,
): boolean {
  return state.battlefield.some((source) => {
    const controller = controllerOf(state, source);
    return abilitiesOf(state, source).some(
      (ability) => ability.kind === 'staticGameRule' && matches(ability.rule, controller),
    );
  });
}

function hasPreventingRule(
  state: GameState,
  player: PlayerId,
  prevents: (rule: StaticGameRule, controller: PlayerId, player: PlayerId) => boolean,
): boolean {
  return hasGameRule(state, (rule, controller) => prevents(rule, controller, player));
}

/** CR 101.2 / 104: whether a loss event is allowed for this player now. */
export function canPlayerLoseGame(state: GameState, player: PlayerId): boolean {
  return !hasPreventingRule(state, player, preventsLoss);
}

/** CR 101.2 / 104: whether a win event is allowed for this player now. */
export function canPlayerWinGame(state: GameState, player: PlayerId): boolean {
  return !hasPreventingRule(state, player, preventsWin);
}

function preventsLifeGain(rule: StaticGameRule, _controller: PlayerId, _player: PlayerId): boolean {
  switch (rule) {
    case 'playersCantGainLife':
      return true;
    case 'controllerCantLoseAndOpponentsCantWin':
    case 'damageCantBePrevented':
    case 'cardsInGraveyardsCantBeTargets':
      return false;
    default:
      return assertNever(rule, 'preventsLifeGain');
  }
}

/** CR 101.2 / 119: whether a life-gain event is allowed for this player now. */
export function canPlayerGainLife(state: GameState, player: PlayerId): boolean {
  return !hasPreventingRule(state, player, preventsLifeGain);
}

/** CR 101.2 / 615: whether prevention effects may apply to damage now. */
export function canDamageBePrevented(state: GameState): boolean {
  return !hasGameRule(state, (rule) => rule === 'damageCantBePrevented');
}

/** CR 101.2 / 115: whether a card object in any graveyard may be targeted now. */
export function canGraveyardCardsBeTargeted(state: GameState): boolean {
  return !hasGameRule(state, (rule) => rule === 'cardsInGraveyardsCantBeTargets');
}
