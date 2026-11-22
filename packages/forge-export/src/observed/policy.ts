import type { JsonValue } from '@mtg/bot-evidence';
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import { seatViewOf, textSubmission } from '@mtg/engine';
import type { MoveId, ObjectView, PendingDecision, PlayInteraction, SeatId, TableView } from '@mtg/engine';
import type { ForgeReviewedAction } from './reviewed-actions';
import {
  FORGE_UNBOUNDED_NUMBER_MAXIMUM,
  reviewedForgeActions,
  reviewedForgeActionsV7,
} from './reviewed-actions';
export { policyControlledObservedBackend } from './policy-backend';

export interface ForgeObservedPolicyIdentity {
  readonly policyId: string;
  readonly policyVersion: number;
  readonly observationAdapterId: string;
  readonly actionAdapterId: string;
  readonly configuration: JsonValue;
  readonly configSha256: string;
}

export interface ForgeObservedPolicyPosition {
  readonly seat: SeatId;
  readonly view: TableView;
  readonly decision: PendingDecision;
  readonly play?: PlayInteraction | undefined;
}

export type ForgeObservedPolicyChoice =
  | { readonly status: 'chosen'; readonly move: MoveId; readonly family: string }
  | { readonly status: 'unsupported'; readonly family: string; readonly reason: string };

export interface ForgeObservedDecisionPolicy {
  readonly identity: ForgeObservedPolicyIdentity;
  choose(position: ForgeObservedPolicyPosition): ForgeObservedPolicyChoice;
}

const COVERAGE_POLICY_CONFIG = {
  actionOrder: [
    'automatic',
    'starting-player',
    'opening-hand',
    'number',
    'target-seat',
    'target-card',
    'zone-card',
    'zone-order',
    'library-shuffle',
    'entity-destination',
    'beneficial-trigger',
    'discard',
    'cost-discard',
    'optional-cost',
    'object',
    'attackers',
    'pass',
  ],
  mulligan: 'keep-between-one-and-five-lands-with-a-spell',
  number: 'greatest-legal-value',
  optionalLifeMinimumAfterPayment: 3,
  tieBreak: 'object-id-then-move-id',
} as const;

const POLICY_CONFIG = {
  ...COVERAGE_POLICY_CONFIG,
  actionOrder: [
    'automatic',
    'starting-player',
    'opening-hand',
    'mulligan-bottom',
    'number',
    'target-seat',
    'target-card',
    'card-selection',
    'pile-selection',
    'zone-card',
    'zone-order',
    'library-shuffle',
    'entity-destination',
    'beneficial-trigger',
    'optional-trigger',
    'discard',
    'revealed-hand-discard',
    'sacrifice',
    'cost-discard',
    'cost-exile',
    'whole-hand-discard-payment',
    'optional-payment',
    'optional-cost',
    'optional-cost-choice',
    'convoke-payment',
    'counter-type-choice',
    'action-confirmation',
    'color-choice',
    'parity-choice',
    'coin-choice',
    'type-choice',
    'replacement-order',
    'cost-sacrifice-selection',
    'cost-return-selection',
    'free-cast-confirmation',
    'combat-exert',
    'combat-blockers',
    'combat-damage',
    'trigger-order',
    'scry-move',
    'scry-keep',
    'target-distribution',
    'entity-selection',
    'replacement',
    'enumerated-selection',
    'source-linked-activation',
    'object',
    'attackers',
    'pass',
  ],
  objectRanking: 'mana-value-then-board-stats',
  cardTargetRanking: 'opponent-before-self',
  targetCompletion: 'choose-legal-target-before-finish',
  genericCardSelectionRanking: 'highest-visible-value-before-completion',
  pileSelectionRanking: 'highest-total-visible-value',
  coinChoice: 'stable-legal-action-id',
  cardSelectionRanking: 'hand-to-library-lowest-value',
  cardOrderRanking: 'library-top-first-highest-value',
  genericZoneOrderRanking: 'highest-visible-value',
  libraryShuffle: 'keep-strategically-ordered-library',
  beneficialTrigger: 'use-safe-exact-optional-self-draw-and-other-proved-beneficial-trigger',
  revealedCardRanking: 'high-to-hand-or-playable-exile-low-to-library-bottom',
  discardRanking: 'hand-lowest-value',
  revealedHandDiscardRanking: 'stable-legal-object-id',
  incrementalDiscardCompletion: 'finish-when-current-selection-is-legal',
  sacrificeRanking: 'lowest-visible-board-value-until-minimum-then-finish',
  mulliganBottomRanking: 'land-balance-then-highest-mana-value',
  unclassifiedOptionalTrigger: 'decline',
  unclassifiedOptionalPayment: 'decline',
  unclassifiedOptionalCostChoice: 'decline',
  convokePaymentRanking: 'lowest-visible-value-before-completion',
  counterTypeChoice: 'stable-legal-action-id',
  actionConfirmation: 'accept-controlled-exile-source-during-own-upkeep',
  generalActionConfirmation: 'accept-exact-controlled-source',
  colorChoice: 'greatest-visible-hand-demand',
  parityChoice: 'greatest-opposing-board-value-minus-own-board-value',
  cardTypeChoice: 'greatest-opposing-board-value-minus-own-board-value',
  replacementOrder: 'stable-bridge-position',
  costSacrificeRanking: 'lowest-visible-value',
  freeCastConfirmation: 'accept-exact-controlled-graveyard-spell-from-source-linked-permission',
  costExileRanking: 'hand-lowest-value',
  wholeHandDiscardPayment: 'exchange-for-strictly-more-source-linked-exiled-cards',
  sourceLinkedActivation: 'activate-bomat-courier-only-for-strictly-more-source-linked-cards',
  costCardRanking: 'visible-lowest-value-before-completion',
  exertRanking: 'highest-board-value',
  blockerRanking: 'surviving-blocker-then-attacker-value',
  combatDamageRanking: 'highest-recipient-value',
  combatDamageDefer: 'assign-current-source-first',
  triggerOrderRanking: 'highest-source-value-first',
  scryMove: 'keep-current-order-without-card-quality-context',
  scryKeepRanking: 'highest-visible-value-first',
  targetDistribution:
    'lethal-opposing-player-then-lethal-opposing-permanent-then-opposing-player-from-public-state',
  entitySelectionRanking: 'highest-visible-value',
  replacement: 'apply-reviewed-shared-source-replacement',
  enumeratedSelection: 'stable-legal-action-id-with-shared-source-and-exact-modal-completion',
  attackerDefenderRanking: 'lethal-opposing-planeswalker-before-player',
  stagedAttackerEvidence: 'exact-removal-actions-extend-optional-helper',
  unscoredObjectActions: 'pass-ability-and-proactive-mana',
  noProgressRecovery:
    'exclude-accepted-move-with-bounded-repeatable-and-convoke-callbacks-on-reentered-observation-same-turn',
} as const;

const LEGAL_BASELINE_CONFIG = {
  strategy: 'forge-observed-coverage-baseline@8',
  coverageFallback: 'forge-observed-strongest-play@49',
  fallbackCondition: 'baseline-unsupported',
  noProgressRecovery:
    'exclude-accepted-move-with-bounded-repeatable-and-convoke-callbacks-on-reentered-observation-same-turn',
} as const;

export const FORGE_STRONGEST_OBSERVED_POLICY_IDENTITY: ForgeObservedPolicyIdentity = {
  policyId: 'forge-observed-strongest-play',
  policyVersion: 49,
  observationAdapterId: 'forge-player-observation/v1',
  actionAdapterId: 'forge-reviewed-actions/v41',
  configuration: POLICY_CONFIG,
  configSha256: botEvidenceSha256(POLICY_CONFIG),
};

function offered(position: ForgeObservedPolicyPosition, move: MoveId | null | undefined): move is MoveId {
  return (
    move !== null && move !== undefined && position.decision.options.some((option) => option.id === move)
  );
}

function chosen(move: MoveId, family: string): ForgeObservedPolicyChoice {
  return { status: 'chosen', move, family };
}

function exactOption(position: ForgeObservedPolicyPosition, id: string): MoveId | null {
  return position.decision.options.find((option) => option.id === id)?.id ?? null;
}

function openingHandChoice(position: ForgeObservedPolicyPosition): MoveId | null {
  if (position.play?.promptRole !== 'opening-hand') return null;
  const hand = seatViewOf(position.view, position.seat).hand;
  if (hand === null) return null;
  const lands = hand.filter((card) => card.typeLine.includes('Land')).length;
  const keep = lands >= 1 && lands <= 5 && lands < hand.length;
  return exactOption(position, keep ? 'pregame-keep' : 'pregame-mulligan');
}

function manaValue(cost: string | null | undefined): number {
  if (cost === null || cost === undefined) return 0;
  return [...cost.matchAll(/\{([^}]+)\}/gu)].reduce((total, match) => {
    const symbol = match[1] ?? '';
    if (/^[0-9]+$/u.test(symbol)) return total + Number(symbol);
    return symbol === 'X' || symbol === 'Y' || symbol === 'Z' ? total : total + 1;
  }, 0);
}

function visibleObject(position: ForgeObservedPolicyPosition, oid: string) {
  const projected = position.view.seats
    .flatMap((seat) => [...(seat.hand ?? []), ...seat.battlefield, ...seat.graveyard, ...seat.exile])
    .concat(position.view.stack)
    .find((object) => object.oid === oid);
  if (projected !== undefined) return projected;
  return position.decision.options
    .flatMap((option) => option.targets)
    .find((target) => target.oid === oid && target.object?.oid === oid)?.object;
}

function strategicObjectScore(position: ForgeObservedPolicyPosition, oid: string): number {
  const object = visibleObject(position, oid);
  if (object === undefined) return 0;
  const stats = (object.power ?? 0) + (object.toughness ?? 0);
  return manaValue(object.characteristics?.manaCost) * 100 + stats;
}

function reviewedActions(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): readonly ForgeReviewedAction[] {
  return strategic ? reviewedForgeActions(position.decision) : reviewedForgeActionsV7(position.decision);
}

function objectChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  const priorities = strategic ? (['play', 'cast'] as const) : (['play', 'cast', 'ability', 'mana'] as const);
  for (const category of priorities) {
    const action = position.play?.objectActions
      .filter((candidate) => candidate.category === category && offered(position, candidate.move))
      .toSorted((left, right) => {
        const scoreDifference = strategic
          ? strategicObjectScore(position, right.oid) - strategicObjectScore(position, left.oid)
          : 0;
        if (scoreDifference !== 0) return scoreDifference;
        return left.oid === right.oid
          ? String(left.move).localeCompare(String(right.move))
          : left.oid.localeCompare(right.oid);
      })[0];
    if (action !== undefined) return chosen(action.move, 'play-object');
  }
  return null;
}

function planeswalkerLoyalty(position: ForgeObservedPolicyPosition, oid: string): number | null {
  const defender = visibleObject(position, oid);
  if (defender === undefined || !defender.typeLine.includes('Planeswalker')) return null;
  const loyalty = defender.counters['LOYALTY'];
  return typeof loyalty === 'number' ? loyalty : null;
}

function attackerChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  const attackers = position.play?.attackers;
  const currentActions =
    strategic && position.decision.kind === 'combat-attackers' ? reviewedForgeActions(position.decision) : [];
  const staged = new Set([
    ...(attackers?.staged ?? []),
    ...currentActions.flatMap((action) =>
      action.family === 'combat-attackers' && action.role === 'remove-attacker' ? [action.attackerOid] : [],
    ),
  ]);
  if (strategic && position.decision.kind === 'combat-attackers') {
    const reviewed = currentActions;
    if (reviewed.length === position.decision.options.length) {
      const legal = reviewed
        .filter(
          (
            action,
          ): action is Extract<
            ForgeReviewedAction,
            { readonly family: 'combat-attackers'; readonly role: 'add-attacker' }
          > =>
            action.family === 'combat-attackers' &&
            action.role === 'add-attacker' &&
            !staged.has(action.attackerOid) &&
            offered(position, action.move) &&
            position.play?.objectActions.some(
              (candidate) =>
                candidate.category === 'combat' &&
                candidate.oid === action.attackerOid &&
                candidate.move === action.move,
            ) === true,
        )
        .toSorted((left, right) => {
          const lethalPlaneswalker = (action: typeof left): boolean => {
            if (action.defender.kind !== 'card') return false;
            const loyalty = planeswalkerLoyalty(position, action.defender.oid);
            const power = visibleObject(position, action.attackerOid)?.power;
            return loyalty !== null && power !== null && power !== undefined && power >= loyalty;
          };
          const leftLethal = lethalPlaneswalker(left);
          const rightLethal = lethalPlaneswalker(right);
          if (leftLethal !== rightLethal) return leftLethal ? -1 : 1;
          return (
            strategicObjectScore(position, right.attackerOid) -
              strategicObjectScore(position, left.attackerOid) ||
            String(left.move).localeCompare(String(right.move))
          );
        })[0];
      if (legal !== undefined) return chosen(legal.move, 'stage-attacker');
    }
  }
  const add = position.play?.objectActions
    .filter(
      (action) => action.category === 'combat' && !staged.has(action.oid) && offered(position, action.move),
    )
    .toSorted((left, right) => left.oid.localeCompare(right.oid))[0];
  if (add !== undefined) return chosen(add.move, 'stage-attacker');
  const confirm = attackers?.confirm ?? 'combat-attackers-commit';
  if (offered(position, confirm)) return chosen(confirm, 'confirm-attackers');
  const remove = currentActions
    .filter(
      (
        action,
      ): action is Extract<
        ForgeReviewedAction,
        { readonly family: 'combat-attackers'; readonly role: 'remove-attacker' }
      > =>
        action.family === 'combat-attackers' &&
        action.role === 'remove-attacker' &&
        offered(position, action.move) &&
        position.play?.objectActions.some(
          (candidate) =>
            candidate.category === 'combat' &&
            candidate.oid === action.attackerOid &&
            candidate.move === action.move,
        ) === true,
    )
    .toSorted((left, right) => left.attackerOid.localeCompare(right.attackerOid))[0];
  return remove === undefined ? null : chosen(remove.move, 'remove-attacker');
}

type DistributionAction = Extract<ForgeReviewedAction, { readonly family: 'target-distribution' }>;
type PublicDistributionTarget =
  { readonly kind: 'player'; readonly seat: SeatId } | { readonly kind: 'card'; readonly object: ObjectView };

function publicDistributionTarget(
  position: ForgeObservedPolicyPosition,
  action: DistributionAction,
): PublicDistributionTarget | null {
  if (action.target.kind === 'player') {
    const seat = position.view.seats[action.target.seat];
    return seat?.id === action.target.seat ? action.target : null;
  }
  const targetOid = action.target.oid;
  const matches = position.view.seats.flatMap((seat) =>
    seat.battlefield
      .filter((object) => object.oid === targetOid && object.controller === seat.id)
      .map((object) => ({ kind: 'card' as const, object })),
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function distributionPointIsLethal(object: ObjectView): boolean {
  if (object.toughness !== null) return object.toughness - object.damage <= 1;
  const loyalty = object.counters['LOYALTY'];
  return object.typeLine.includes('Planeswalker') && loyalty !== undefined && loyalty <= 1;
}

function distributionRank(
  position: ForgeObservedPolicyPosition,
  action: DistributionAction,
): readonly [number, number] {
  const target = publicDistributionTarget(position, action);
  if (target === null) return [-1, 0];
  if (target.kind === 'player') {
    if (target.seat === position.seat) return [2, 0];
    return [seatViewOf(position.view, target.seat).life <= 1 ? 6 : 4, 0];
  }
  const opponent = target.object.controller !== position.seat;
  const lethal = distributionPointIsLethal(target.object);
  if (opponent && lethal) return [5, strategicObjectScore(position, target.object.oid)];
  if (opponent) return [3, strategicObjectScore(position, target.object.oid)];
  return [1, -strategicObjectScore(position, target.object.oid)];
}

function distributionChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  if (position.decision.kind !== 'target-distribution' || position.decision.seat !== position.seat) {
    return null;
  }
  const actions = reviewedForgeActions(position.decision).filter(
    (action): action is DistributionAction => action.family === 'target-distribution',
  );
  if (
    actions.length !== position.decision.options.length ||
    actions.some((action) => publicDistributionTarget(position, action) === null)
  ) {
    return null;
  }
  const target = actions.toSorted((left, right) => {
    if (strategic) {
      const leftRank = distributionRank(position, left);
      const rightRank = distributionRank(position, right);
      const rankDifference = rightRank[0] - leftRank[0] || rightRank[1] - leftRank[1];
      if (rankDifference !== 0) return rankDifference;
    }
    return String(left.move).localeCompare(String(right.move));
  })[0];
  if (target === undefined) return null;
  const selected = strategic ? publicDistributionTarget(position, target) : null;
  const family =
    selected?.kind === 'card' &&
    selected.object.controller !== position.seat &&
    distributionPointIsLethal(selected.object)
      ? 'target-distribution-lethal-permanent'
      : selected?.kind === 'player' &&
          selected.seat !== position.seat &&
          seatViewOf(position.view, selected.seat).life <= 1
        ? 'target-distribution-lethal-player'
        : selected?.kind === 'player' && selected.seat !== position.seat
          ? 'target-distribution-opponent-player'
          : 'target-distribution';
  return chosen(target.move, family);
}

function generalForgeChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  if (!strategic) return null;
  if (position.decision.kind === 'card-name' && position.decision.input?.kind === 'text') {
    const suggestion = position.decision.input.suggestions?.[0];
    return suggestion === undefined
      ? null
      : chosen(textSubmission(position.decision.input, suggestion), 'card-name-suggestion');
  }
  const actions = reviewedActions(position, strategic);
  if (actions.length !== position.decision.options.length) return null;

  if (position.decision.kind === 'scry-move' || position.decision.kind === 'surveil-move') {
    const finish = actions.find((action) => action.role === 'finish-scry-move');
    return finish === undefined
      ? null
      : chosen(
          finish.move,
          position.decision.kind === 'surveil-move' ? 'keep-surveil-cards' : 'keep-scry-cards',
        );
  }
  if (position.decision.kind === 'optional-cost-choice') {
    const finish = actions.find((action) => action.role === 'finish-optional-cost-choice');
    return finish === undefined ? null : chosen(finish.move, 'finish-optional-cost-choice');
  }
  if (position.decision.kind === 'convoke-payment') {
    const creature = actions
      .filter((action) => action.role === 'pay-with-creature')
      .toSorted(
        (left, right) =>
          strategicObjectScore(position, left.oid) - strategicObjectScore(position, right.oid) ||
          String(left.move).localeCompare(String(right.move)),
      )[0];
    if (creature !== undefined) return chosen(creature.move, 'convoke-lowest-value');
    const finish = actions.find((action) => action.role === 'finish-convoke-payment');
    return finish === undefined ? null : chosen(finish.move, 'finish-convoke-payment');
  }
  if (position.decision.kind === 'counter-type-choice') {
    const counterType = actions
      .filter((action) => action.role === 'choose-counter-type')
      .toSorted((left, right) => String(left.move).localeCompare(String(right.move)))[0];
    return counterType === undefined ? null : chosen(counterType.move, 'counter-type-choice');
  }
  if (position.decision.kind === 'confirm-action') {
    const accept = actions.find(
      (action): action is Extract<ForgeReviewedAction, { readonly family: 'action-confirmation' }> =>
        action.family === 'action-confirmation' && action.role === 'confirm-action',
    );
    const ownExile = seatViewOf(position.view, position.seat).exile;
    if (
      accept !== undefined &&
      position.view.turn.active === position.seat &&
      position.view.turn.step === 'UPKEEP' &&
      ownExile.some((card) => card.oid === accept.sourceOid)
    ) {
      return chosen(accept.move, 'confirm-exile-action');
    }
    return null;
  }
  if (
    position.decision.kind === 'confirm-optional-reveal' ||
    position.decision.kind === 'confirm-explore-graveyard'
  ) {
    const role = position.decision.kind === 'confirm-optional-reveal' ? 'confirm-action' : 'decline-action';
    const action = actions.find(
      (candidate): candidate is Extract<ForgeReviewedAction, { readonly family: 'action-confirmation' }> =>
        candidate.family === 'action-confirmation' && candidate.role === role,
    );
    return action === undefined
      ? null
      : chosen(
          action.move,
          position.decision.kind === 'confirm-optional-reveal'
            ? 'confirm-optional-reveal'
            : 'keep-explored-card',
        );
  }
  if (position.decision.kind === 'confirm-free-cast') {
    const accept = actions.find(
      (action): action is Extract<ForgeReviewedAction, { readonly family: 'free-cast-confirmation' }> =>
        action.family === 'free-cast-confirmation' && action.role === 'confirm-free-cast',
    );
    const seat = seatViewOf(position.view, position.seat);
    return accept !== undefined &&
      seat.graveyard.some((card) => card.oid === accept.spellOid) &&
      seat.battlefield.some(
        (source) => source.oid === accept.permissionSourceOid && source.controller === position.seat,
      )
      ? chosen(accept.move, 'confirm-free-cast')
      : null;
  }
  if (position.decision.kind === 'scry-keep') {
    const card = actions
      .filter((action) => action.role === 'keep-scry-card')
      .toSorted(
        (left, right) =>
          strategicObjectScore(position, right.oid) - strategicObjectScore(position, left.oid) ||
          String(left.move).localeCompare(String(right.move)),
      )[0];
    return card === undefined ? null : chosen(card.move, 'scry-keep-highest-value');
  }
  if (position.decision.kind === 'zone-order') {
    const card = actions
      .filter((action) => action.role === 'choose-ordered-card')
      .toSorted(
        (left, right) =>
          strategicObjectScore(position, right.oid) - strategicObjectScore(position, left.oid) ||
          String(left.move).localeCompare(String(right.move)),
      )[0];
    return card === undefined ? null : chosen(card.move, 'zone-order-highest-value');
  }
  if (position.decision.kind === 'target-distribution') {
    return distributionChoice(position, true);
  }
  if (position.decision.kind === 'entity-selection') {
    const entity = actions
      .filter(
        (
          action,
        ): action is Extract<
          ForgeReviewedAction,
          { readonly family: 'entity-selection'; readonly role: 'choose-entity' }
        > => action.family === 'entity-selection' && action.role === 'choose-entity',
      )
      .toSorted(
        (left, right) =>
          strategicObjectScore(position, right.oid) - strategicObjectScore(position, left.oid) ||
          String(left.move).localeCompare(String(right.move)),
      )[0];
    if (entity !== undefined) return chosen(entity.move, 'entity-selection-highest-value');
    const player = actions
      .filter(
        (
          action,
        ): action is Extract<
          ForgeReviewedAction,
          { readonly family: 'entity-selection'; readonly role: 'choose-player' }
        > => action.family === 'entity-selection' && action.role === 'choose-player',
      )
      .toSorted(
        (left, right) => Number(left.seat === position.seat) - Number(right.seat === position.seat),
      )[0];
    return player === undefined ? null : chosen(player.move, 'entity-selection-opponent');
  }
  if (position.decision.kind === 'confirm-replacement') {
    const apply = actions.find((action) => action.role === 'apply-replacement');
    return apply === undefined ? null : chosen(apply.move, 'apply-replacement');
  }
  if (position.decision.kind === 'ability-selection' || position.decision.kind === 'mode-selection') {
    const finish = actions.find((action) => action.role === 'finish-mode-selection');
    if (finish !== undefined) return chosen(finish.move, position.decision.kind);
    const selection = actions
      .filter((action) => action.role === 'choose-enumerated-action')
      .toSorted((left, right) => String(left.move).localeCompare(String(right.move)))[0];
    return selection === undefined ? null : chosen(selection.move, position.decision.kind);
  }
  if (position.decision.kind === 'cost-sacrifice-selection') {
    const sacrifice = actions
      .filter(
        (
          action,
        ): action is Extract<
          ForgeReviewedAction,
          { readonly family: 'cost-sacrifice-selection'; readonly role: 'choose-cost-sacrifice' }
        > => action.family === 'cost-sacrifice-selection' && action.role === 'choose-cost-sacrifice',
      )
      .toSorted(
        (left, right) =>
          strategicObjectScore(position, left.oid) - strategicObjectScore(position, right.oid) ||
          String(left.move).localeCompare(String(right.move)),
      )[0];
    if (sacrifice !== undefined) return chosen(sacrifice.move, 'cost-sacrifice-lowest-value');
    const cancel = actions.find((action) => action.role === 'cancel-cost-sacrifice');
    return cancel === undefined ? null : chosen(cancel.move, 'cancel-cost-sacrifice');
  }
  if (position.decision.kind === 'cost-return-selection') {
    const returned = actions
      .filter(
        (
          action,
        ): action is Extract<
          ForgeReviewedAction,
          { readonly family: 'cost-return-selection'; readonly role: 'choose-cost-return' }
        > => action.family === 'cost-return-selection' && action.role === 'choose-cost-return',
      )
      .toSorted(
        (left, right) =>
          strategicObjectScore(position, left.oid) - strategicObjectScore(position, right.oid) ||
          String(left.move).localeCompare(String(right.move)),
      )[0];
    if (returned !== undefined) return chosen(returned.move, 'cost-return-lowest-value');
    const cancel = actions.find((action) => action.role === 'cancel-cost-return');
    return cancel === undefined ? null : chosen(cancel.move, 'cancel-cost-return');
  }
  if (position.decision.kind === 'color-choice') {
    const hand = seatViewOf(position.view, position.seat).hand ?? [];
    const demand = (color: string): number =>
      hand.reduce(
        (total, object) =>
          total +
          [...(object.characteristics?.manaCost ?? '').matchAll(/\{([^}]+)\}/gu)].filter((match) =>
            (match[1] ?? '').includes(color),
          ).length,
        0,
      );
    const color = actions
      .filter(
        (action): action is Extract<ForgeReviewedAction, { readonly family: 'color-choice' }> =>
          action.family === 'color-choice',
      )
      .toSorted(
        (left, right) =>
          demand(right.color) - demand(left.color) || String(left.move).localeCompare(String(right.move)),
      )[0];
    return color === undefined ? null : chosen(color.move, 'choose-needed-color');
  }
  if (position.decision.kind === 'parity-choice') {
    const parityScore = (parity: 'odd' | 'even'): number =>
      position.view.seats.reduce(
        (total, seat) =>
          total +
          seat.battlefield.reduce((subtotal, object) => {
            const matches =
              (manaValue(object.characteristics?.manaCost) % 2 === 0 ? 'even' : 'odd') === parity;
            if (!matches) return subtotal;
            const sign = seat.id === position.seat ? -1 : 1;
            return subtotal + sign * strategicObjectScore(position, object.oid);
          }, 0),
        0,
      );
    const parity = actions
      .filter(
        (action): action is Extract<ForgeReviewedAction, { readonly family: 'parity-choice' }> =>
          action.family === 'parity-choice',
      )
      .toSorted(
        (left, right) =>
          parityScore(right.parity) - parityScore(left.parity) ||
          String(left.move).localeCompare(String(right.move)),
      )[0];
    return parity === undefined ? null : chosen(parity.move, 'choose-best-parity');
  }
  if (position.decision.kind === 'coin-choice') {
    const coinCall = actions
      .filter(
        (action): action is Extract<ForgeReviewedAction, { readonly family: 'coin-choice' }> =>
          action.family === 'coin-choice',
      )
      .toSorted((left, right) => String(left.move).localeCompare(String(right.move)))[0];
    return coinCall === undefined ? null : chosen(coinCall.move, 'choose-stable-coin-call');
  }
  if (position.decision.kind === 'type-choice') {
    const typeScore = (cardType: string): number =>
      position.view.seats.reduce(
        (total, seat) =>
          total +
          seat.battlefield.reduce((subtotal, object) => {
            if (!object.typeLine.split(/\s+[-—]\s+|\s+/u).includes(cardType)) return subtotal;
            const sign = seat.id === position.seat ? -1 : 1;
            return subtotal + sign * strategicObjectScore(position, object.oid);
          }, 0),
        0,
      );
    const cardType = actions
      .filter(
        (action): action is Extract<ForgeReviewedAction, { readonly family: 'type-choice' }> =>
          action.family === 'type-choice',
      )
      .toSorted(
        (left, right) =>
          typeScore(right.cardType) - typeScore(left.cardType) ||
          String(left.move).localeCompare(String(right.move)),
      )[0];
    return cardType === undefined ? null : chosen(cardType.move, 'choose-best-card-type');
  }
  if (position.decision.kind === 'replacement-order') {
    const replacement = actions
      .filter(
        (action): action is Extract<ForgeReviewedAction, { readonly family: 'replacement-order' }> =>
          action.family === 'replacement-order',
      )
      .toSorted((left, right) => left.position - right.position)[0];
    return replacement === undefined ? null : chosen(replacement.move, 'replacement-order');
  }
  return null;
}

function numberChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  if (position.decision.kind !== 'number') return null;
  const actions = reviewedActions(position, strategic);
  if (actions.length !== position.decision.options.length) return null;
  const values = actions
    .filter((action) => action.role === 'choose-number')
    .toSorted((left, right) => right.value - left.value);
  const openEnded = actions.some(
    (action) =>
      action.family === 'number' &&
      action.role !== 'choose-number' &&
      action.maximum === FORGE_UNBOUNDED_NUMBER_MAXIMUM,
  );
  if (openEnded) {
    const value = values[0];
    return value === undefined ? null : chosen(value.move, 'number-open-ended');
  }
  const window = actions
    .filter((action) => action.role === 'advance-number-window')
    .toSorted((left, right) => right.offset - left.offset)[0];
  if (window !== undefined) return chosen(window.move, 'number-window');
  const value = values[0];
  return value === undefined ? null : chosen(value.move, 'number');
}

function seatChoice(position: ForgeObservedPolicyPosition): ForgeObservedPolicyChoice | null {
  const actions = (position.play?.seatActions ?? [])
    .filter((action) => offered(position, action.move))
    .toSorted((left, right) => String(left.move).localeCompare(String(right.move)));
  const opponent = actions.find((action) => action.seat !== position.seat);
  if (opponent !== undefined) return chosen(opponent.move, 'target-opponent');
  const self = actions.find((action) => action.seat === position.seat);
  return self === undefined ? null : chosen(self.move, 'target-self');
}

function zoneCardChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  if (
    position.decision.kind !== 'zone-card-selection' &&
    position.decision.kind !== 'zone-card-selection-hand-to-library'
  ) {
    return null;
  }
  if (!strategic && position.decision.kind !== 'zone-card-selection') return null;
  const actions = reviewedActions(position, strategic);
  if (actions.length !== position.decision.options.length) return null;
  const putBack =
    strategic &&
    position.play?.cardSelection?.origin === 'hand' &&
    position.play.cardSelection.destination === 'library';
  const card = actions
    .filter((action) => action.role === 'choose-zone-card')
    .toSorted((left, right) => {
      const scoreDifference = putBack
        ? strategicObjectScore(position, left.oid) - strategicObjectScore(position, right.oid)
        : 0;
      if (scoreDifference !== 0) return scoreDifference;
      return left.oid === right.oid
        ? String(left.move).localeCompare(String(right.move))
        : left.oid.localeCompare(right.oid);
    })[0];
  if (card !== undefined) return chosen(card.move, putBack ? 'zone-card-put-back' : 'zone-card');
  const decline = actions.find((action) => action.role === 'decline-zone-card');
  return decline === undefined ? null : chosen(decline.move, 'zone-card-decline');
}

function genericCardChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  if (!strategic || position.decision.kind !== 'card-selection') return null;
  const actions = reviewedActions(position, strategic);
  if (actions.length !== position.decision.options.length) return null;
  const card = actions
    .filter((action) => action.role === 'choose-card')
    .toSorted(
      (left, right) =>
        strategicObjectScore(position, right.oid) - strategicObjectScore(position, left.oid) ||
        left.oid.localeCompare(right.oid),
    )[0];
  if (card !== undefined) return chosen(card.move, 'card-selection-highest-value');
  const finish = actions.find((action) => action.role === 'finish-card-selection');
  return finish === undefined ? null : chosen(finish.move, 'finish-card-selection');
}

function discardChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  if (position.decision.kind !== 'discard-selection' && position.decision.kind !== 'hand-card-selection') {
    return null;
  }
  if (!strategic && position.decision.kind !== 'discard-selection') return null;
  const actions = reviewedActions(position, strategic);
  if (actions.length !== position.decision.options.length) return null;
  const hand = seatViewOf(position.view, position.seat).hand;
  if (hand === null) return null;
  const handByOid = new Map(hand.map((object) => [object.oid, object]));
  const discardActions = actions.filter((action) => action.role === 'choose-discard');
  if (
    discardActions.some((action) => {
      const object = handByOid.get(action.oid);
      return object === undefined || object.controller !== position.seat;
    })
  ) {
    return null;
  }
  const finish = actions.find((action) => action.role === 'finish-discard-selection');
  if (finish !== undefined) return chosen(finish.move, 'finish-discard-selection');
  const lowestValue = strategic;
  const card = actions
    .filter((action) => action.role === 'choose-discard')
    .toSorted((left, right) => {
      const scoreDifference = lowestValue
        ? strategicObjectScore(position, left.oid) - strategicObjectScore(position, right.oid)
        : 0;
      if (scoreDifference !== 0) return scoreDifference;
      return left.oid === right.oid
        ? String(left.move).localeCompare(String(right.move))
        : left.oid.localeCompare(right.oid);
    })[0];
  return card === undefined ? null : chosen(card.move, lowestValue ? 'discard-lowest-value' : 'discard');
}

function revealedHandDiscardChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  if (!strategic || position.decision.kind !== 'revealed-hand-discard-selection') return null;
  const actions = reviewedActions(position, strategic);
  if (actions.length !== position.decision.options.length) return null;
  const card = actions
    .filter((action) => action.role === 'choose-revealed-hand-discard')
    .toSorted((left, right) => left.oid.localeCompare(right.oid))[0];
  return card === undefined ? null : chosen(card.move, 'revealed-hand-discard');
}

function sacrificeChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  if (!strategic || position.decision.kind !== 'sacrifice-selection') return null;
  const actions = reviewedActions(position, strategic);
  if (actions.length !== position.decision.options.length) return null;
  const sacrifices = actions.filter((action) => action.role === 'choose-sacrifice');
  const ownBattlefield = new Set(
    seatViewOf(position.view, position.seat).battlefield.map((object) => object.oid),
  );
  if (sacrifices.some((action) => !ownBattlefield.has(action.oid))) return null;
  const finish = actions.find((action) => action.role === 'finish-sacrifice-selection');
  if (finish !== undefined) return chosen(finish.move, 'finish-sacrifice-selection');
  const permanent = sacrifices.toSorted(
    (left, right) =>
      strategicObjectScore(position, left.oid) - strategicObjectScore(position, right.oid) ||
      left.oid.localeCompare(right.oid) ||
      String(left.move).localeCompare(String(right.move)),
  )[0];
  return permanent === undefined ? null : chosen(permanent.move, 'sacrifice-lowest-value');
}

function zoneOrderChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  if (!strategic || position.decision.kind !== 'zone-order-library-top-first') return null;
  if (position.play?.cardOrder?.destination !== 'library' || position.play.cardOrder.first !== 'top') {
    return null;
  }
  const actions = reviewedActions(position, strategic);
  if (actions.length !== position.decision.options.length) return null;
  const card = actions
    .filter((action) => action.role === 'choose-ordered-card')
    .toSorted((left, right) => {
      const scoreDifference =
        strategicObjectScore(position, right.oid) - strategicObjectScore(position, left.oid);
      if (scoreDifference !== 0) return scoreDifference;
      return left.oid === right.oid
        ? String(left.move).localeCompare(String(right.move))
        : left.oid.localeCompare(right.oid);
    })[0];
  return card === undefined ? null : chosen(card.move, 'zone-order-top');
}

function cardTargetChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  if (
    position.decision.kind !== 'target-selection' &&
    position.decision.kind !== 'repeatable-target-selection'
  ) {
    return null;
  }
  const actions = reviewedActions(position, strategic);
  if (actions.length !== position.decision.options.length) return null;
  const target = actions
    .filter(
      (
        action,
      ): action is Extract<
        ForgeReviewedAction,
        { readonly role: 'choose-card-target' | 'choose-stack-target' }
      > => action.role === 'choose-card-target' || (strategic && action.role === 'choose-stack-target'),
    )
    .toSorted((left, right) => {
      if (strategic) {
        const leftOpponent = visibleObject(position, left.oid)?.controller !== position.seat;
        const rightOpponent = visibleObject(position, right.oid)?.controller !== position.seat;
        if (leftOpponent !== rightOpponent) return leftOpponent ? -1 : 1;
      }
      return left.oid === right.oid
        ? String(left.move).localeCompare(String(right.move))
        : left.oid.localeCompare(right.oid);
    })[0];
  if (target !== undefined) {
    return chosen(target.move, target.role === 'choose-stack-target' ? 'target-stack' : 'target-card');
  }
  const finish = actions.find((action) => action.role === 'finish-targets');
  return finish === undefined ? null : chosen(finish.move, 'finish-targets');
}

function optionalCostChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  if (position.decision.kind !== 'optional-cost') return null;
  const actions = reviewedActions(position, strategic);
  if (actions.length !== position.decision.options.length) return null;
  const life = actions
    .filter((action) => action.role === 'pay-life')
    .filter(
      (action) =>
        seatViewOf(position.view, position.seat).life - action.life >=
        POLICY_CONFIG.optionalLifeMinimumAfterPayment,
    )
    .toSorted((left, right) => left.life - right.life)[0];
  if (life !== undefined) return chosen(life.move, 'optional-cost-pay-life');
  const decline = actions.find((action) => action.role === 'decline-cost');
  return decline === undefined ? null : chosen(decline.move, 'optional-cost-decline');
}

function optionalPaymentChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  if (!strategic || position.decision.kind !== 'confirm-payment') return null;
  const actions = reviewedActions(position, strategic);
  if (actions.length !== position.decision.options.length) return null;
  const decline = actions.find((action) => action.role === 'decline-payment');
  return decline === undefined ? null : chosen(decline.move, 'decline-unclassified-payment');
}

function wholeHandDiscardPaymentChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  if (!strategic || position.decision.kind !== 'cost-discard-hand-confirm') return null;
  const actions = reviewedActions(position, strategic);
  if (actions.length !== position.decision.options.length) return null;
  const pay = actions.find((action) => action.role === 'pay-whole-hand');
  const decline = actions.find((action) => action.role === 'decline-whole-hand');
  if (
    pay === undefined ||
    decline === undefined ||
    pay.family !== 'whole-hand-discard-payment' ||
    decline.family !== 'whole-hand-discard-payment' ||
    pay.sourceOid !== decline.sourceOid ||
    pay.associatedExileOids.length !== decline.associatedExileOids.length ||
    pay.associatedExileOids.some((oid, index) => decline.associatedExileOids[index] !== oid)
  ) {
    return null;
  }
  const source = seatViewOf(position.view, position.seat).battlefield.find(
    (object) => object.oid === pay.sourceOid,
  );
  const hand = seatViewOf(position.view, position.seat).hand;
  if (source?.name !== 'Bomat Courier' || source.controller !== position.seat || hand === null) return null;
  const visibleExile = new Map(
    seatViewOf(position.view, position.seat).exile.map((object) => [object.oid, object]),
  );
  if (pay.associatedExileOids.some((oid) => visibleExile.get(oid)?.name !== '')) return null;
  return pay.associatedExileOids.length > hand.length
    ? chosen(pay.move, 'bomat-courier-exchange-hand')
    : chosen(decline.move, 'bomat-courier-keep-hand');
}

function bomatCourierActivationChoice(
  position: ForgeObservedPolicyPosition,
): ForgeObservedPolicyChoice | null {
  if (position.decision.kind !== 'priority') return null;
  const local = seatViewOf(position.view, position.seat);
  const localCouriers = new Set(
    local.battlefield.filter((object) => object.name === 'Bomat Courier').map((object) => object.oid),
  );
  const offeredCourierActions =
    position.play?.objectActions.filter(
      (action) =>
        action.category === 'ability' && localCouriers.has(action.oid) && offered(position, action.move),
    ) ?? [];
  if (offeredCourierActions.length === 0) return null;

  const pass = position.play?.passPriority;
  const decline = offered(position, pass)
    ? chosen(pass, 'bomat-courier-keep-hand')
    : ({
        status: 'unsupported',
        family: position.decision.kind,
        reason: 'Bomat Courier activation is unsafe and passing is unavailable',
      } as const);
  const reviewed = reviewedForgeActions(position.decision).filter(
    (action): action is Extract<ForgeReviewedAction, { readonly family: 'source-linked-activation' }> =>
      action.family === 'source-linked-activation' &&
      offeredCourierActions.some(
        (candidate) => candidate.oid === action.sourceOid && candidate.move === action.move,
      ),
  );
  if (offeredCourierActions.length !== 1 || reviewed.length !== 1 || local.hand === null) return decline;

  const [activation] = reviewed;
  if (activation === undefined) return decline;
  const visibleExile = new Map(local.exile.map((object) => [object.oid, object]));
  if (activation.associatedExileOids.some((oid) => visibleExile.get(oid)?.name !== '')) return decline;
  return activation.associatedExileOids.length > local.hand.length
    ? chosen(activation.move, 'bomat-courier-exchange-hand')
    : decline;
}

function libraryShuffleChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  if (!strategic || position.decision.kind !== 'confirm-library-shuffle-after-order') return null;
  const actions = reviewedActions(position, strategic);
  if (actions.length !== position.decision.options.length) return null;
  const keep = actions.find((action) => action.role === 'keep-library-order');
  return keep === undefined ? null : chosen(keep.move, 'keep-library-order');
}

function entityDestinationChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  if (!strategic || !position.decision.kind.startsWith('entity-selection-to-')) return null;
  const actions = reviewedActions(position, strategic);
  if (actions.length !== position.decision.options.length) return null;
  const cards = actions.filter((action) => action.role === 'choose-destination-card');
  const destination = cards[0]?.destination;
  if (destination === undefined || cards.some((card) => card.destination !== destination)) return null;
  const card = cards.toSorted((left, right) => {
    const scoreDifference =
      strategicObjectScore(position, right.oid) - strategicObjectScore(position, left.oid);
    const directed = destination === 'library-bottom' ? -scoreDifference : scoreDifference;
    if (directed !== 0) return directed;
    return left.oid === right.oid
      ? String(left.move).localeCompare(String(right.move))
      : left.oid.localeCompare(right.oid);
  })[0];
  if (card === undefined) return null;
  const family =
    destination === 'hand'
      ? 'revealed-card-to-hand'
      : destination === 'library-bottom'
        ? 'revealed-card-to-library-bottom'
        : 'revealed-card-to-playable-exile';
  return chosen(card.move, family);
}

function beneficialTriggerChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  if (
    !strategic ||
    (position.decision.kind !== 'confirm-beneficial-trigger' &&
      !/^confirm-optional-self-draw-[1-9][0-9]*$/u.test(position.decision.kind))
  )
    return null;
  const actions = reviewedActions(position, strategic);
  if (actions.length !== position.decision.options.length) return null;
  const draw = actions.find((action) => action.family === 'optional-self-draw');
  if (draw !== undefined) {
    const role =
      seatViewOf(position.view, position.seat).librarySize >= draw.drawCount
        ? 'use-optional-self-draw'
        : 'decline-optional-self-draw';
    const choice = actions.find((action) => action.role === role);
    return choice === undefined
      ? null
      : chosen(choice.move, role === 'use-optional-self-draw' ? role : 'decline-decking-draw');
  }
  const use = actions.find((action) => action.role === 'use-beneficial-trigger');
  return use === undefined ? null : chosen(use.move, 'use-beneficial-trigger');
}

function costDiscardChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  if (position.decision.kind !== 'cost-discard-selection') return null;
  const actions = reviewedActions(position, strategic);
  if (actions.length !== position.decision.options.length) return null;
  const card = actions
    .filter((action) => action.role === 'choose-cost-discard')
    .toSorted((left, right) =>
      left.oid === right.oid
        ? String(left.move).localeCompare(String(right.move))
        : left.oid.localeCompare(right.oid),
    )[0];
  return card === undefined ? null : chosen(card.move, 'cost-discard');
}

function mulliganBottomChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  if (!strategic || position.decision.kind !== 'mulligan-bottom') return null;
  const hand = seatViewOf(position.view, position.seat).hand;
  if (hand === null) return null;
  const handByOid = new Map(hand.map((object) => [object.oid, object]));
  const actions = reviewedActions(position, strategic).filter(
    (action) => action.role === 'choose-bottom-cards',
  );
  const selectedCount = actions[0]?.oids.length;
  if (
    actions.length !== position.decision.options.length ||
    selectedCount === undefined ||
    actions.some(
      (action) => action.oids.length !== selectedCount || action.oids.some((oid) => !handByOid.has(oid)),
    )
  ) {
    return null;
  }
  const remainingCount = hand.length - selectedCount;
  const targetLands = remainingCount >= 5 ? 3 : Math.min(2, remainingCount);
  const ranked = actions.toSorted((left, right) => {
    const score = (action: (typeof actions)[number]): number => {
      const bottom = new Set(action.oids);
      const remainingLands = hand.filter(
        (object) => !bottom.has(object.oid) && object.typeLine.includes('Land'),
      ).length;
      const balance = -Math.abs(remainingLands - targetLands) * 10_000;
      const removedValue = action.oids.reduce((total, oid) => total + strategicObjectScore(position, oid), 0);
      return balance + removedValue;
    };
    return score(right) - score(left) || String(left.move).localeCompare(String(right.move));
  })[0];
  return ranked === undefined ? null : chosen(ranked.move, 'mulligan-bottom');
}

function optionalTriggerChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  if (!strategic || position.decision.kind !== 'confirm-trigger') return null;
  const actions = reviewedActions(position, strategic);
  if (actions.length !== position.decision.options.length) return null;
  const decline = actions.find((action) => action.role === 'decline-trigger');
  return decline === undefined ? null : chosen(decline.move, 'decline-unclassified-trigger');
}

function costExileChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  if (!strategic || position.decision.kind !== 'cost-card-selection') return null;
  const actions = reviewedActions(position, strategic);
  if (actions.length !== position.decision.options.length) return null;
  const card = actions
    .filter(
      (
        action,
      ): action is Extract<
        ForgeReviewedAction,
        { readonly role: 'choose-cost-exile' | 'choose-cost-card' }
      > => action.role === 'choose-cost-exile' || action.role === 'choose-cost-card',
    )
    .toSorted(
      (left, right) =>
        strategicObjectScore(position, left.oid) - strategicObjectScore(position, right.oid) ||
        left.oid.localeCompare(right.oid),
    )[0];
  if (card !== undefined) {
    return chosen(
      card.move,
      card.role === 'choose-cost-exile' ? 'cost-exile-lowest-value' : 'cost-card-lowest-value',
    );
  }
  const finish = actions.find((action) => action.role === 'finish-cost-card-selection');
  return finish === undefined ? null : chosen(finish.move, 'finish-cost-card-selection');
}

function exertChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  if (!strategic || position.decision.kind !== 'combat-exert') return null;
  const actions = reviewedActions(position, strategic);
  if (actions.length !== position.decision.options.length) return null;
  const exert = actions
    .filter((action) => action.role === 'exert-attacker')
    .toSorted(
      (left, right) =>
        strategicObjectScore(position, right.oid) - strategicObjectScore(position, left.oid) ||
        left.oid.localeCompare(right.oid),
    )[0];
  if (exert !== undefined) return chosen(exert.move, 'exert-attacker');
  const finish = actions.find((action) => action.role === 'finish-exert');
  return finish === undefined ? null : chosen(finish.move, 'finish-exert');
}

function blockerChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  if (!strategic || position.decision.kind !== 'combat-blockers') return null;
  const actions = reviewedActions(position, strategic);
  if (actions.length !== position.decision.options.length) return null;
  const favorable = actions
    .filter(
      (
        action,
      ): action is Extract<
        ForgeReviewedAction,
        { readonly family: 'combat-blockers'; readonly role: 'add-block' | 'remove-block' }
      > => action.role === 'add-block',
    )
    .filter((action) => {
      const blocker = visibleObject(position, action.blockerOid);
      const attacker = visibleObject(position, action.attackerOid);
      return (
        blocker?.controller === position.seat &&
        attacker !== undefined &&
        attacker.controller !== position.seat &&
        blocker.toughness !== null &&
        blocker.toughness !== undefined &&
        attacker.power !== null &&
        attacker.power !== undefined &&
        blocker.toughness > attacker.power
      );
    })
    .toSorted(
      (left, right) =>
        strategicObjectScore(position, right.attackerOid) -
          strategicObjectScore(position, left.attackerOid) ||
        left.blockerOid.localeCompare(right.blockerOid) ||
        left.attackerOid.localeCompare(right.attackerOid),
    )[0];
  if (favorable !== undefined) return chosen(favorable.move, 'add-favorable-block');
  const commit = actions.find((action) => action.role === 'commit-blockers');
  return commit === undefined ? null : chosen(commit.move, 'commit-blockers');
}

function combatDamageChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  if (!strategic || position.decision.kind !== 'combat-damage') return null;
  const actions = reviewedActions(position, strategic);
  const split = actions.find((action) => action.role === 'assign-damage-split');
  if (split !== undefined) return chosen(split.move, 'assign-combat-damage');
  if (actions.length !== position.decision.options.length) return null;
  const assignment = actions
    .filter((action) => action.role === 'assign-damage')
    .toSorted((left, right) => {
      const score = (oid: string | null): number => (oid === null ? 0 : strategicObjectScore(position, oid));
      return (
        score(right.recipientOid) - score(left.recipientOid) ||
        String(left.move).localeCompare(String(right.move))
      );
    })[0];
  return assignment === undefined ? null : chosen(assignment.move, 'assign-combat-damage');
}

function pileChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  if (!strategic || position.decision.kind !== 'choose-pile') return null;
  const actions = reviewedForgeActions(position.decision).filter(
    (action): action is Extract<ForgeReviewedAction, { readonly family: 'pile-selection' }> =>
      action.family === 'pile-selection',
  );
  if (actions.length !== position.decision.options.length) return null;
  const selection = actions.toSorted(
    (left, right) =>
      right.oids.reduce((total, oid) => total + strategicObjectScore(position, oid), 0) -
        left.oids.reduce((total, oid) => total + strategicObjectScore(position, oid), 0) ||
      String(left.move).localeCompare(String(right.move)),
  )[0];
  return selection === undefined ? null : chosen(selection.move, 'choose-highest-value-pile');
}

function triggerOrderChoice(
  position: ForgeObservedPolicyPosition,
  strategic: boolean,
): ForgeObservedPolicyChoice | null {
  if (!strategic || position.decision.kind !== 'trigger-order') return null;
  const actions = reviewedActions(position, strategic);
  if (actions.length !== position.decision.options.length) return null;
  const next = actions
    .filter((action) => action.role === 'order-trigger')
    .toSorted(
      (left, right) =>
        strategicObjectScore(position, right.sourceOid) - strategicObjectScore(position, left.sourceOid) ||
        left.sourceOid.localeCompare(right.sourceOid),
    )[0];
  return next === undefined ? null : chosen(next.move, 'order-trigger');
}

function choosePolicy(position: ForgeObservedPolicyPosition, strategic: boolean): ForgeObservedPolicyChoice {
  if (!position.decision.complete) {
    return { status: 'unsupported', family: position.decision.kind, reason: 'candidate list is incomplete' };
  }
  if (offered(position, position.play?.automatic?.move)) {
    return chosen(position.play.automatic.move, 'automatic');
  }

  const starts =
    position.decision.kind === 'starting-player'
      ? exactOption(position, `pregame-start-seat-${position.seat}`)
      : null;
  if (starts !== null) return chosen(starts, 'starting-player');

  const opening = openingHandChoice(position);
  if (opening !== null) return chosen(opening, 'opening-hand');

  const mulliganBottom = mulliganBottomChoice(position, strategic);
  if (mulliganBottom !== null) return mulliganBottom;

  const number = numberChoice(position, strategic);
  if (number !== null) return number;

  const seat = seatChoice(position);
  if (seat !== null) return seat;

  const cardTarget = cardTargetChoice(position, strategic);
  if (cardTarget !== null) return cardTarget;

  const genericCard = genericCardChoice(position, strategic);
  if (genericCard !== null) return genericCard;

  const pile = pileChoice(position, strategic);
  if (pile !== null) return pile;

  const zoneCard = zoneCardChoice(position, strategic);
  if (zoneCard !== null) return zoneCard;

  const zoneOrder = zoneOrderChoice(position, strategic);
  if (zoneOrder !== null) return zoneOrder;

  const libraryShuffle = libraryShuffleChoice(position, strategic);
  if (libraryShuffle !== null) return libraryShuffle;

  const entityDestination = entityDestinationChoice(position, strategic);
  if (entityDestination !== null) return entityDestination;

  const beneficialTrigger = beneficialTriggerChoice(position, strategic);
  if (beneficialTrigger !== null) return beneficialTrigger;

  const optionalTrigger = optionalTriggerChoice(position, strategic);
  if (optionalTrigger !== null) return optionalTrigger;

  const discard = discardChoice(position, strategic);
  if (discard !== null) return discard;

  const revealedHandDiscard = revealedHandDiscardChoice(position, strategic);
  if (revealedHandDiscard !== null) return revealedHandDiscard;

  const sacrifice = sacrificeChoice(position, strategic);
  if (sacrifice !== null) return sacrifice;

  const costDiscard = costDiscardChoice(position, strategic);
  if (costDiscard !== null) return costDiscard;

  const costExile = costExileChoice(position, strategic);
  if (costExile !== null) return costExile;

  const wholeHandDiscardPayment = wholeHandDiscardPaymentChoice(position, strategic);
  if (wholeHandDiscardPayment !== null) return wholeHandDiscardPayment;

  const optionalPayment = optionalPaymentChoice(position, strategic);
  if (optionalPayment !== null) return optionalPayment;

  const optionalCost = optionalCostChoice(position, strategic);
  if (optionalCost !== null) return optionalCost;

  const exert = exertChoice(position, strategic);
  if (exert !== null) return exert;

  const blockers = blockerChoice(position, strategic);
  if (blockers !== null) return blockers;

  const damage = combatDamageChoice(position, strategic);
  if (damage !== null) return damage;

  const triggerOrder = triggerOrderChoice(position, strategic);
  if (triggerOrder !== null) return triggerOrder;

  const bomatCourierActivation = strategic ? bomatCourierActivationChoice(position) : null;
  if (bomatCourierActivation !== null) return bomatCourierActivation;

  const general = generalForgeChoice(position, strategic);
  if (general !== null) return general;

  const object = objectChoice(position, strategic);
  if (object !== null) return object;

  const attacker = attackerChoice(position, strategic);
  if (attacker !== null) return attacker;
  if (offered(position, position.play?.passPriority)) {
    return chosen(position.play.passPriority, 'pass-priority');
  }
  return {
    status: 'unsupported',
    family: position.decision.kind,
    reason: 'no reviewed action role identifies a legal move',
  };
}

export const forgeObservedCoveragePolicyV8: ForgeObservedDecisionPolicy = {
  identity: {
    policyId: 'forge-observed-coverage-baseline',
    policyVersion: 8,
    observationAdapterId: 'forge-player-observation/v1',
    actionAdapterId: 'forge-reviewed-actions/v7',
    configuration: COVERAGE_POLICY_CONFIG,
    configSha256: botEvidenceSha256(COVERAGE_POLICY_CONFIG),
  },
  choose: (position) => choosePolicy(position, false),
};

/** Coverage-matched control: retain v8 choices and borrow current coverage only to remain legal. */
export const forgeObservedLegalBaselinePolicy: ForgeObservedDecisionPolicy = {
  identity: {
    policyId: 'forge-observed-legal-baseline',
    policyVersion: 31,
    observationAdapterId: 'forge-player-observation/v1',
    actionAdapterId: 'forge-reviewed-actions/v41',
    configuration: LEGAL_BASELINE_CONFIG,
    configSha256: botEvidenceSha256(LEGAL_BASELINE_CONFIG),
  },
  choose: (position) => {
    const bomatCourierActivation = bomatCourierActivationChoice(position);
    if (bomatCourierActivation !== null) return bomatCourierActivation;
    if (
      position.decision.kind === 'combat-attackers' &&
      reviewedForgeActions(position.decision).some(
        (action) => action.family === 'combat-attackers' && action.role === 'remove-attacker',
      )
    ) {
      const stableAttack = attackerChoice(position, true);
      if (stableAttack !== null) return stableAttack;
    }
    const stableDistribution = distributionChoice(position, false);
    if (stableDistribution !== null) return stableDistribution;
    const baseline = choosePolicy(position, false);
    return baseline.status === 'chosen' ? baseline : choosePolicy(position, true);
  },
};

export const strongestForgeObservedPolicy: ForgeObservedDecisionPolicy = {
  identity: FORGE_STRONGEST_OBSERVED_POLICY_IDENTITY,
  choose: (position) => choosePolicy(position, true),
};
