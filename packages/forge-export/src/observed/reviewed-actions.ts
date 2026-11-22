import type { MoveId, MoveTarget, PendingDecision, SeatId } from '@mtg/engine';
import { textSubmission } from '@mtg/engine';

export type ForgeReviewedAction =
  | {
      readonly family: 'pile-selection';
      readonly role: 'choose-pile';
      readonly oids: readonly string[];
      readonly move: MoveId;
    }
  | {
      readonly family: 'mulligan-bottom';
      readonly role: 'choose-bottom-cards';
      readonly oids: readonly string[];
      readonly move: MoveId;
    }
  | {
      readonly family: 'number';
      readonly role: 'choose-number';
      readonly value: number;
      readonly move: MoveId;
    }
  | {
      readonly family: 'number';
      readonly role: 'advance-number-window';
      readonly offset: number;
      readonly maximum: number;
      readonly move: MoveId;
    }
  | {
      readonly family: 'number';
      readonly role: 'restart-number-window';
      readonly maximum: number;
      readonly move: MoveId;
    }
  | {
      readonly family: 'zone-card-selection';
      readonly role: 'choose-zone-card';
      readonly oid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'zone-order';
      readonly role: 'choose-ordered-card';
      readonly oid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'zone-card-selection';
      readonly role: 'decline-zone-card';
      readonly move: MoveId;
    }
  | {
      readonly family: 'card-selection';
      readonly role: 'choose-card';
      readonly oid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'card-selection';
      readonly role: 'finish-card-selection';
      readonly move: MoveId;
    }
  | {
      readonly family: 'discard-selection';
      readonly role: 'choose-discard';
      readonly oid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'discard-selection';
      readonly role: 'finish-discard-selection';
      readonly move: MoveId;
    }
  | {
      readonly family: 'revealed-hand-discard-selection';
      readonly role: 'choose-revealed-hand-discard';
      readonly oid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'sacrifice-selection';
      readonly role: 'choose-sacrifice';
      readonly oid: string;
      readonly chosen: number;
      readonly minimum: number;
      readonly maximum: number;
      readonly move: MoveId;
    }
  | {
      readonly family: 'sacrifice-selection';
      readonly role: 'finish-sacrifice-selection';
      readonly chosen: number;
      readonly minimum: number;
      readonly maximum: number;
      readonly move: MoveId;
    }
  | {
      readonly family: 'target-selection';
      readonly role: 'choose-card-target';
      readonly oid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'target-selection';
      readonly role: 'choose-stack-target';
      readonly oid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'target-selection';
      readonly role: 'cancel-target';
      readonly move: MoveId;
    }
  | {
      readonly family: 'target-selection';
      readonly role: 'finish-targets';
      readonly move: MoveId;
    }
  | {
      readonly family: 'optional-cost';
      readonly role: 'pay-life';
      readonly life: number;
      readonly move: MoveId;
    }
  | {
      readonly family: 'optional-cost';
      readonly role: 'decline-cost';
      readonly move: MoveId;
    }
  | {
      readonly family: 'optional-cost-choice';
      readonly role: 'choose-optional-cost';
      readonly sourceOid: string;
      readonly position: number;
      readonly move: MoveId;
    }
  | {
      readonly family: 'optional-cost-choice';
      readonly role: 'finish-optional-cost-choice';
      readonly move: MoveId;
    }
  | {
      readonly family: 'convoke-payment';
      readonly role: 'pay-with-creature';
      readonly oid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'convoke-payment';
      readonly role: 'finish-convoke-payment';
      readonly move: MoveId;
    }
  | {
      readonly family: 'counter-type-choice';
      readonly role: 'choose-counter-type';
      readonly sourceOid: string;
      readonly position: number;
      readonly move: MoveId;
    }
  | {
      readonly family: 'action-confirmation';
      readonly role: 'confirm-action' | 'decline-action';
      readonly sourceOid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'free-cast-confirmation';
      readonly role: 'confirm-free-cast' | 'decline-free-cast';
      readonly spellOid: string;
      readonly permissionSourceOid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'optional-payment';
      readonly role: 'pay' | 'decline-payment';
      readonly sourceOid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'whole-hand-discard-payment';
      readonly role: 'pay-whole-hand' | 'decline-whole-hand';
      readonly sourceOid: string;
      readonly associatedExileOids: readonly string[];
      readonly move: MoveId;
    }
  | {
      readonly family: 'source-linked-activation';
      readonly role: 'activate-bomat-courier';
      readonly sourceOid: string;
      readonly associatedExileOids: readonly string[];
      readonly move: MoveId;
    }
  | {
      readonly family: 'cost-discard-selection';
      readonly role: 'choose-cost-discard';
      readonly oid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'cost-discard-selection';
      readonly role: 'cancel-cost-discard';
      readonly move: MoveId;
    }
  | {
      readonly family: 'library-shuffle';
      readonly role: 'shuffle-library' | 'keep-library-order';
      readonly move: MoveId;
    }
  | {
      readonly family: 'entity-selection';
      readonly role: 'choose-destination-card';
      readonly destination: 'hand' | 'library-bottom' | 'exile-playable';
      readonly oid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'beneficial-trigger';
      readonly role: 'use-beneficial-trigger' | 'decline-beneficial-trigger';
      readonly move: MoveId;
    }
  | {
      readonly family: 'optional-self-draw';
      readonly role: 'use-optional-self-draw' | 'decline-optional-self-draw';
      readonly drawCount: number;
      readonly move: MoveId;
    }
  | {
      readonly family: 'optional-trigger';
      readonly role: 'use-trigger' | 'decline-trigger';
      readonly sourceOid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'cost-exile-selection';
      readonly role: 'choose-cost-exile';
      readonly oid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'cost-exile-selection';
      readonly role: 'cancel-cost-exile';
      readonly move: MoveId;
    }
  | {
      readonly family: 'cost-card-selection';
      readonly role: 'choose-cost-card';
      readonly oid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'cost-card-selection';
      readonly role: 'finish-cost-card-selection';
      readonly move: MoveId;
    }
  | {
      readonly family: 'combat-exert';
      readonly role: 'exert-attacker';
      readonly oid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'combat-exert';
      readonly role: 'finish-exert';
      readonly move: MoveId;
    }
  | {
      readonly family: 'combat-blockers';
      readonly role: 'add-block' | 'remove-block';
      readonly blockerOid: string;
      readonly attackerOid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'combat-blockers';
      readonly role: 'commit-blockers';
      readonly move: MoveId;
    }
  | {
      readonly family: 'combat-damage';
      readonly role: 'assign-damage';
      readonly sourceOid: string;
      readonly recipientOid: string | null;
      readonly move: MoveId;
    }
  | {
      readonly family: 'combat-damage';
      readonly role: 'assign-damage-split';
      readonly move: MoveId;
    }
  | {
      readonly family: 'combat-damage';
      readonly role: 'defer-damage';
      readonly sourceOid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'trigger-order';
      readonly role: 'order-trigger';
      readonly sourceOid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'scry-move';
      readonly role: 'move-scry-card';
      readonly oid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'scry-move';
      readonly role: 'finish-scry-move';
      readonly move: MoveId;
    }
  | {
      readonly family: 'scry-keep';
      readonly role: 'keep-scry-card';
      readonly oid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'target-distribution';
      readonly role: 'choose-distribution-target';
      readonly target:
        { readonly kind: 'player'; readonly seat: SeatId } | { readonly kind: 'card'; readonly oid: string };
      readonly move: MoveId;
    }
  | {
      readonly family: 'entity-selection';
      readonly role: 'choose-entity';
      readonly oid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'entity-selection';
      readonly role: 'choose-player';
      readonly seat: SeatId;
      readonly move: MoveId;
    }
  | {
      readonly family: 'entity-selection';
      readonly role: 'finish-entity-selection';
      readonly move: MoveId;
    }
  | {
      readonly family: 'cost-return-selection';
      readonly role: 'choose-cost-return';
      readonly oid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'cost-return-selection';
      readonly role: 'cancel-cost-return';
      readonly move: MoveId;
    }
  | {
      readonly family: 'cost-sacrifice-selection';
      readonly role: 'choose-cost-sacrifice';
      readonly oid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'cost-sacrifice-selection';
      readonly role: 'cancel-cost-sacrifice';
      readonly move: MoveId;
    }
  | {
      readonly family: 'color-choice';
      readonly role: 'choose-color';
      readonly color: 'W' | 'U' | 'B' | 'R' | 'G';
      readonly sourceOid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'parity-choice';
      readonly role: 'choose-parity';
      readonly parity: 'odd' | 'even';
      readonly sourceOid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'coin-choice';
      readonly role: 'choose-coin-call';
      readonly call: 'heads' | 'tails';
      readonly sourceOid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'type-choice';
      readonly role: 'choose-card-type';
      readonly cardType: string;
      readonly sourceOid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'replacement-order';
      readonly role: 'choose-replacement-order';
      readonly position: number;
      readonly move: MoveId;
    }
  | {
      readonly family: 'replacement';
      readonly role: 'apply-replacement' | 'decline-replacement';
      readonly sourceOid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'ability-selection' | 'mode-selection';
      readonly role: 'choose-enumerated-action';
      readonly sourceOid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'mode-selection';
      readonly role: 'finish-mode-selection';
      readonly move: MoveId;
    }
  | {
      readonly family: 'combat-attackers';
      readonly role: 'add-attacker';
      readonly attackerOid: string;
      readonly defender:
        { readonly kind: 'player'; readonly seat: SeatId } | { readonly kind: 'card'; readonly oid: string };
      readonly move: MoveId;
    }
  | {
      readonly family: 'combat-attackers';
      readonly role: 'remove-attacker';
      readonly attackerOid: string;
      readonly move: MoveId;
    }
  | {
      readonly family: 'combat-attackers';
      readonly role: 'commit-attackers';
      readonly move: MoveId;
    };

export const FORGE_UNBOUNDED_NUMBER_MAXIMUM = 2_147_483_647;

const INTEGER = '-?(?:0|[1-9][0-9]*)';
const NUMBER_VALUE = new RegExp(`^number-(${INTEGER})$`, 'u');
const NUMBER_WINDOW = new RegExp(`^number-up-(${INTEGER})-max-(${INTEGER})$`, 'u');
const NUMBER_RESTART = new RegExp(`^number-restart-max-(${INTEGER})$`, 'u');
const ZONE_CARD = /^zone-card-([0-9]+)$/u;
const GENERIC_ZONE_CARD = /^zone-card-selection-card-([0-9]+)$/u;
const GENERIC_CARD = /^card-selection-card-([0-9]+)$/u;
const HAND_TO_LIBRARY_CARD = /^zone-card-selection-hand-to-library-card-([0-9]+)$/u;
const LIBRARY_TOP_ORDER_CARD = /^zone-order-library-top-first-card-([0-9]+)$/u;
const ZONE_ORDER_CARD = /^zone-order-card-([0-9]+)$/u;
const DISCARD_CARD = /^discard-selection-card-([0-9]+)$/u;
const HAND_DISCARD_CARD = /^(?:discard|hand-card-selection)-card-([0-9]+)$/u;
const REVEALED_HAND_DISCARD_CARD = /^revealed-hand-discard-card-([0-9]+)$/u;
const SACRIFICE_CARD = /^sacrifice-selection-card-([0-9]+)-chosen-([0-9]+)-min-([0-9]+)-max-([0-9]+)$/u;
const SACRIFICE_DONE = /^sacrifice-selection-done-chosen-([0-9]+)-min-([0-9]+)-max-([0-9]+)$/u;
const TARGET_CARD = /^target-card-([0-9]+)$/u;
const TARGET_STACK = /^target-stack-[0-9]+$/u;
const TARGET_CANCEL = /^(?:target|akh-hou-targets)-cancel$/u;
const TARGET_DONE = /^[a-z0-9]+(?:-[a-z0-9]+)*-targets-done$/u;
const FORGE_CARD_OID = /^forge-card-[0-9]+$/u;
const ENTITY_DESTINATION_CARD = /^entity-selection-to-(hand|library-bottom|exile-playable)-card-([0-9]+)$/u;
const SCRY_MOVE_CARD = /^scry-move-card-([0-9]+)$/u;
const SURVEIL_MOVE_CARD = /^surveil-move-card-([0-9]+)$/u;
const SCRY_KEEP_CARD = /^scry-keep-card-([0-9]+)$/u;
const DISTRIBUTE_CARD = /^distribute-card-([0-9]+)$/u;
const DISTRIBUTE_PLAYER = /^distribute-player-([01])$/u;
const ENTITY_CARD = /^entity-selection-card-([0-9]+)$/u;
const ENTITY_PLAYER = /^entity-selection-player-([01])$/u;
const COST_RETURN = /^cost-return-([0-9]+)$/u;
const COST_SACRIFICE = /^cost-sacrifice-([0-9]+)$/u;
const COLOR_CHOICE = /^color-choice-([WUBRG])$/u;
const PARITY_CHOICE = /^parity-choice-(odd|even)$/u;
const COIN_CHOICE = /^coin-choice-(heads|tails)$/u;
const TYPE_CHOICE = /^type-choice-([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)$/u;
const REPLACEMENT_ORDER = /^replacement-order-([0-9]+)$/u;
const ENUMERATED_SELECTION = /^(ability-selection|mode-selection)-([0-9]+)$/u;
const COMBAT_ATTACK_PLAYER = /^combat-attack-add-([0-9]+)-player-([01])$/u;
const COMBAT_ATTACK_CARD = /^combat-attack-add-([0-9]+)-card-([0-9]+)$/u;
const COMBAT_ATTACK_REMOVE = /^combat-attack-remove-([0-9]+)$/u;
const OPTIONAL_LIFE = /^optional-cost-pay-life-([1-9][0-9]*)$/u;
const OPTIONAL_COST_CHOICE = /^optional-cost-choice-([0-9]+)$/u;
const CONVOKE_PAYMENT = /^convoke-payment-card-([0-9]+)$/u;
const COUNTER_TYPE_CHOICE = /^counter-type-choice-([0-9]+)$/u;
const COST_DISCARD = /^cost-discard-([0-9]+)$/u;
const MULLIGAN_BOTTOM = /^pregame-bottom-[0-9]+$/u;
const COST_EXILE = /^cost-exile-([0-9]+)$/u;
const COST_CARD = /^cost-card-selection-card-([0-9]+)$/u;
const COMBAT_EXERT = /^combat-exert-card-([0-9]+)$/u;
const COMBAT_BLOCK = /^combat-block-(add|remove)-([0-9]+)-([0-9]+)$/u;
const COMBAT_DAMAGE = /^combat-damage-([0-9]+)-(card-([0-9]+)|defender)$/u;
const COMBAT_DAMAGE_LATER = /^combat-damage-later-([0-9]+)$/u;
const TRIGGER_ORDER = /^trigger-order-[0-9]+$/u;

function safeInteger(raw: string): number | null {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Converts bridge-owned move ids into typed actions without inspecting labels or prompts.
 * Unknown ids stay absent, so a policy cannot accidentally treat a new bridge behavior as reviewed.
 */
function reviewedNumberActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    const valueMatch = NUMBER_VALUE.exec(option.id);
    if (valueMatch !== null) {
      const value = safeInteger(valueMatch[1] ?? '');
      return value === null ? [] : [{ family: 'number', role: 'choose-number', value, move: option.id }];
    }
    const windowMatch = NUMBER_WINDOW.exec(option.id);
    if (windowMatch !== null) {
      const offset = safeInteger(windowMatch[1] ?? '');
      const maximum = safeInteger(windowMatch[2] ?? '');
      return offset === null || offset <= 0 || maximum === null
        ? []
        : [
            {
              family: 'number',
              role: 'advance-number-window',
              offset,
              maximum,
              move: option.id,
            },
          ];
    }
    const restartMatch = NUMBER_RESTART.exec(option.id);
    const maximum = restartMatch === null ? null : safeInteger(restartMatch[1] ?? '');
    return maximum === null
      ? []
      : [{ family: 'number', role: 'restart-number-window', maximum, move: option.id }];
  });
}

function reviewedZoneCardActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    if (
      option.id === 'zone-decline' ||
      option.id === 'zone-card-none' ||
      option.id === `${decision.kind}-done`
    ) {
      return [{ family: 'zone-card-selection', role: 'decline-zone-card', move: option.id }];
    }
    const match =
      decision.kind === 'zone-card-selection-hand-to-library'
        ? HAND_TO_LIBRARY_CARD.exec(option.id)
        : (ZONE_CARD.exec(option.id) ?? GENERIC_ZONE_CARD.exec(option.id));
    const target = option.targets.length === 1 ? option.targets[0] : undefined;
    if (match?.[1] === undefined || target?.oid !== `forge-card-${match[1]}`) return [];
    return [
      {
        family: 'zone-card-selection',
        role: 'choose-zone-card',
        oid: target.oid,
        move: option.id,
      },
    ];
  });
}

function reviewedCardActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    if (option.id === 'card-selection-done' && option.targets.length === 0) {
      return [{ family: 'card-selection', role: 'finish-card-selection', move: option.id }];
    }
    const match = GENERIC_CARD.exec(option.id);
    const target = option.targets.length === 1 ? option.targets[0] : undefined;
    if (match?.[1] === undefined || target?.oid !== `forge-card-${match[1]}`) return [];
    return [{ family: 'card-selection', role: 'choose-card', oid: target.oid, move: option.id }];
  });
}

function reviewedDiscardActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    if (
      decision.kind === 'discard-selection' &&
      option.id === 'discard-selection-done' &&
      option.targets.length === 0
    ) {
      return [{ family: 'discard-selection', role: 'finish-discard-selection', move: option.id }];
    }
    const match =
      decision.kind === 'hand-card-selection'
        ? HAND_DISCARD_CARD.exec(option.id)
        : DISCARD_CARD.exec(option.id);
    const target = option.targets.length === 1 ? option.targets[0] : undefined;
    if (
      match?.[1] === undefined ||
      target?.oid !== `forge-card-${match[1]}` ||
      (target.object !== undefined && target.object.oid !== target.oid)
    ) {
      return [];
    }
    return [
      {
        family: 'discard-selection',
        role: 'choose-discard',
        oid: target.oid,
        move: option.id,
      },
    ];
  });
}

function reviewedRevealedHandDiscardActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  if (!decision.complete) return [];
  return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    const match = REVEALED_HAND_DISCARD_CARD.exec(option.id);
    const target = option.targets.length === 1 ? option.targets[0] : undefined;
    if (
      match?.[1] === undefined ||
      target?.oid !== `forge-card-${match[1]}` ||
      (target.object !== undefined && target.object.oid !== target.oid)
    ) {
      return [];
    }
    return [
      {
        family: 'revealed-hand-discard-selection',
        role: 'choose-revealed-hand-discard',
        oid: target.oid,
        move: option.id,
      },
    ];
  });
}

function reviewedSacrificeActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  if (decision.input !== undefined) return [];
  type SacrificeAction = Extract<ForgeReviewedAction, { readonly family: 'sacrifice-selection' }>;
  const actions = decision.options.map((option): SacrificeAction | null => {
    const card = SACRIFICE_CARD.exec(option.id);
    const done = SACRIFICE_DONE.exec(option.id);
    const parts = card ?? done;
    const offset = card === null ? 0 : 1;
    const chosen = parts === null ? null : safeInteger(parts[1 + offset] ?? '');
    const minimum = parts === null ? null : safeInteger(parts[2 + offset] ?? '');
    const maximum = parts === null ? null : safeInteger(parts[3 + offset] ?? '');
    if (
      chosen === null ||
      minimum === null ||
      maximum === null ||
      chosen < 0 ||
      minimum < 0 ||
      maximum < minimum ||
      chosen >= maximum
    ) {
      return null;
    }
    if (done !== null) {
      return option.targets.length === 0 && chosen >= minimum
        ? {
            family: 'sacrifice-selection',
            role: 'finish-sacrifice-selection',
            chosen,
            minimum,
            maximum,
            move: option.id,
          }
        : null;
    }
    const cardId = card?.[1];
    const target = option.targets.length === 1 ? option.targets[0] : undefined;
    if (
      cardId === undefined ||
      target?.oid !== `forge-card-${cardId}` ||
      target.object?.oid !== target.oid ||
      target.object.controller !== decision.seat
    ) {
      return null;
    }
    return {
      family: 'sacrifice-selection',
      role: 'choose-sacrifice',
      oid: target.oid,
      chosen,
      minimum,
      maximum,
      move: option.id,
    };
  });
  if (actions.some((action) => action === null)) return [];
  const reviewed = actions.filter((action) => action !== null);
  const first = reviewed[0];
  if (first === undefined) return [];
  const consistent = reviewed.every(
    (action) =>
      action.chosen === first.chosen && action.minimum === first.minimum && action.maximum === first.maximum,
  );
  const sacrifices = reviewed.filter((action) => action.role === 'choose-sacrifice');
  const finishes = reviewed.filter((action) => action.role === 'finish-sacrifice-selection');
  const finishExpected = first.chosen >= first.minimum;
  return consistent &&
    sacrifices.length >= Math.max(0, first.minimum - first.chosen) &&
    finishes.length === (finishExpected ? 1 : 0) &&
    new Set(reviewed.map((action) => action.move)).size === reviewed.length &&
    new Set(sacrifices.map((action) => action.oid)).size === sacrifices.length
    ? reviewed
    : [];
}

function reviewedZoneOrderActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    const match =
      decision.kind === 'zone-order'
        ? ZONE_ORDER_CARD.exec(option.id)
        : LIBRARY_TOP_ORDER_CARD.exec(option.id);
    const target = option.targets.length === 1 ? option.targets[0] : undefined;
    if (
      match?.[1] === undefined ||
      target?.oid !== `forge-card-${match[1]}` ||
      (decision.kind === 'zone-order' && target.object?.oid !== target.oid)
    ) {
      return [];
    }
    return [
      {
        family: 'zone-order',
        role: 'choose-ordered-card',
        oid: target.oid,
        move: option.id,
      },
    ];
  });
}

function reviewedTargetActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    if ((TARGET_DONE.test(option.id) || option.id === 'target-none') && option.targets.length === 0) {
      return [{ family: 'target-selection', role: 'finish-targets', move: option.id }];
    }
    if (TARGET_CANCEL.test(option.id)) {
      return [{ family: 'target-selection', role: 'cancel-target', move: option.id }];
    }
    const target = option.targets.length === 1 ? option.targets[0] : undefined;
    if (TARGET_STACK.test(option.id) && target !== undefined && FORGE_CARD_OID.test(target.oid)) {
      return [
        {
          family: 'target-selection',
          role: 'choose-stack-target',
          oid: target.oid,
          move: option.id,
        },
      ];
    }
    const match = TARGET_CARD.exec(option.id);
    if (match?.[1] === undefined || target?.oid !== `forge-card-${match[1]}`) return [];
    return [
      {
        family: 'target-selection',
        role: 'choose-card-target',
        oid: target.oid,
        move: option.id,
      },
    ];
  });
}

function reviewedOptionalCostActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    if (option.id === 'optional-cost-decline') {
      return [{ family: 'optional-cost', role: 'decline-cost', move: option.id }];
    }
    const match = OPTIONAL_LIFE.exec(option.id);
    const life = match?.[1] === undefined ? null : safeInteger(match[1]);
    return life === null ? [] : [{ family: 'optional-cost', role: 'pay-life', life, move: option.id }];
  });
}

function reviewedOptionalCostChoiceActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  const actions = decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    if (option.id === 'optional-cost-choice-done' && option.targets.length === 0) {
      return [{ family: 'optional-cost-choice', role: 'finish-optional-cost-choice', move: option.id }];
    }
    const match = OPTIONAL_COST_CHOICE.exec(option.id);
    const source = option.targets.length === 1 ? option.targets[0] : undefined;
    const position = match?.[1] === undefined ? null : safeInteger(match[1]);
    if (
      position === null ||
      source === undefined ||
      !FORGE_CARD_OID.test(source.oid) ||
      source.object?.oid !== source.oid
    ) {
      return [];
    }
    return [
      {
        family: 'optional-cost-choice',
        role: 'choose-optional-cost',
        sourceOid: source.oid,
        position,
        move: option.id,
      },
    ];
  });
  const selections = actions.filter((action) => action.role === 'choose-optional-cost');
  const sourceOid = selections[0]?.sourceOid;
  const finishCount = actions.filter((action) => action.role === 'finish-optional-cost-choice').length;
  return actions.length === decision.options.length &&
    finishCount === 1 &&
    sourceOid !== undefined &&
    selections.every((action) => action.sourceOid === sourceOid)
    ? actions
    : [];
}

function reviewedConvokePaymentActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  if (!decision.complete) return [];
  const actions = decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    if (option.id === 'convoke-payment-done' && option.targets.length === 0) {
      return [{ family: 'convoke-payment', role: 'finish-convoke-payment', move: option.id }];
    }
    const match = CONVOKE_PAYMENT.exec(option.id);
    const target = option.targets.length === 1 ? option.targets[0] : undefined;
    if (
      match?.[1] === undefined ||
      target?.oid !== `forge-card-${match[1]}` ||
      target.object?.oid !== target.oid ||
      target.object.controller !== decision.seat ||
      !target.object.typeLine.includes('Creature') ||
      target.object.tapped
    ) {
      return [];
    }
    return [{ family: 'convoke-payment', role: 'pay-with-creature', oid: target.oid, move: option.id }];
  });
  const finishes = actions.filter((action) => action.role === 'finish-convoke-payment');
  return actions.length === decision.options.length && finishes.length === 1 ? actions : [];
}

function reviewedCounterTypeChoiceActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  if (!decision.complete) return [];
  const actions = decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    const match = COUNTER_TYPE_CHOICE.exec(option.id);
    const source = option.targets.length === 1 ? option.targets[0] : undefined;
    const position = match?.[1] === undefined ? null : safeInteger(match[1]);
    if (
      position === null ||
      source === undefined ||
      !FORGE_CARD_OID.test(source.oid) ||
      source.object?.oid !== source.oid
    ) {
      return [];
    }
    return [
      {
        family: 'counter-type-choice',
        role: 'choose-counter-type',
        sourceOid: source.oid,
        position,
        move: option.id,
      },
    ];
  });
  const selections = actions.filter(
    (action): action is Extract<ForgeReviewedAction, { readonly family: 'counter-type-choice' }> =>
      action.family === 'counter-type-choice' && action.role === 'choose-counter-type',
  );
  const sourceOid = selections[0]?.sourceOid ?? null;
  return sourceOid !== null &&
    selections.length === decision.options.length &&
    selections.every((action) => action.sourceOid === sourceOid) &&
    new Set(selections.map((action) => action.position)).size === selections.length
    ? actions
    : [];
}

function reviewedActionConfirmation(decision: PendingDecision): readonly ForgeReviewedAction[] {
  if (decision.options.length !== 2) return [];
  const accept = decision.options.find((option) => option.id === `${decision.kind}-yes`);
  const decline = decision.options.find((option) => option.id === `${decision.kind}-no`);
  const acceptSource = accept?.targets.length === 1 ? accept.targets[0] : undefined;
  const declineSource = decline?.targets.length === 1 ? decline.targets[0] : undefined;
  if (
    accept === undefined ||
    decline === undefined ||
    acceptSource === undefined ||
    declineSource === undefined ||
    acceptSource.oid !== declineSource.oid ||
    !FORGE_CARD_OID.test(acceptSource.oid) ||
    acceptSource.object?.oid !== acceptSource.oid ||
    declineSource.object?.oid !== declineSource.oid ||
    acceptSource.object.controller !== decision.seat ||
    declineSource.object.controller !== decision.seat
  ) {
    return [];
  }
  return [
    {
      family: 'action-confirmation',
      role: 'confirm-action',
      sourceOid: acceptSource.oid,
      move: accept.id,
    },
    {
      family: 'action-confirmation',
      role: 'decline-action',
      sourceOid: declineSource.oid,
      move: decline.id,
    },
  ];
}

function reviewedFreeCastConfirmation(decision: PendingDecision): readonly ForgeReviewedAction[] {
  if (!decision.complete || decision.options.length !== 2) return [];
  const accept = decision.options.find((option) => option.id === 'confirm-free-cast-yes');
  const decline = decision.options.find((option) => option.id === 'confirm-free-cast-no');
  if (accept === undefined || decline === undefined || accept.targets.length !== 2) return [];
  const [spell, permissionSource] = accept.targets;
  const [declineSpell, declinePermissionSource] = decline.targets;
  if (
    decline.targets.length !== 2 ||
    spell === undefined ||
    permissionSource === undefined ||
    declineSpell === undefined ||
    declinePermissionSource === undefined ||
    spell.oid === permissionSource.oid ||
    spell.oid !== declineSpell.oid ||
    permissionSource.oid !== declinePermissionSource.oid ||
    !FORGE_CARD_OID.test(spell.oid) ||
    !FORGE_CARD_OID.test(permissionSource.oid) ||
    spell.object?.oid !== spell.oid ||
    permissionSource.object?.oid !== permissionSource.oid ||
    declineSpell.object?.oid !== declineSpell.oid ||
    declinePermissionSource.object?.oid !== declinePermissionSource.oid ||
    spell.object.controller !== decision.seat ||
    permissionSource.object.controller !== decision.seat ||
    declineSpell.object.controller !== decision.seat ||
    declinePermissionSource.object.controller !== decision.seat
  ) {
    return [];
  }
  return [
    {
      family: 'free-cast-confirmation',
      role: 'confirm-free-cast',
      spellOid: spell.oid,
      permissionSourceOid: permissionSource.oid,
      move: accept.id,
    },
    {
      family: 'free-cast-confirmation',
      role: 'decline-free-cast',
      spellOid: spell.oid,
      permissionSourceOid: permissionSource.oid,
      move: decline.id,
    },
  ];
}

function reviewedOptionalPaymentActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  if (decision.options.length !== 2) return [];
  const pay = decision.options.find((option) => option.id === 'confirm-payment-yes');
  const decline = decision.options.find((option) => option.id === 'confirm-payment-no');
  const payTarget = pay?.targets.length === 1 ? pay.targets[0] : undefined;
  const declineTarget = decline?.targets.length === 1 ? decline.targets[0] : undefined;
  if (
    pay === undefined ||
    decline === undefined ||
    payTarget === undefined ||
    declineTarget === undefined ||
    payTarget.oid !== declineTarget.oid ||
    !FORGE_CARD_OID.test(payTarget.oid)
  ) {
    return [];
  }
  return [
    {
      family: 'optional-payment',
      role: 'pay',
      sourceOid: payTarget.oid,
      move: pay.id,
    },
    {
      family: 'optional-payment',
      role: 'decline-payment',
      sourceOid: declineTarget.oid,
      move: decline.id,
    },
  ];
}

function reviewedWholeHandDiscardPaymentActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  if (!decision.complete || decision.options.length !== 2) return [];
  const pay = decision.options.find((option) => option.id === 'cost-discard-hand-confirm-yes');
  const decline = decision.options.find((option) => option.id === 'cost-discard-hand-confirm-no');
  const paySource = pay?.targets[0];
  const declineSource = decline?.targets[0];
  const payExile = pay?.targets.slice(1) ?? [];
  const declineExile = decline?.targets.slice(1) ?? [];
  if (
    pay === undefined ||
    decline === undefined ||
    paySource === undefined ||
    declineSource === undefined ||
    paySource.oid !== declineSource.oid ||
    !FORGE_CARD_OID.test(paySource.oid) ||
    paySource.name !== 'Bomat Courier' ||
    declineSource.name !== paySource.name ||
    paySource.object?.oid !== paySource.oid ||
    declineSource.object?.oid !== declineSource.oid ||
    paySource.object.name !== paySource.name ||
    declineSource.object.name !== declineSource.name ||
    paySource.object.controller !== decision.seat ||
    declineSource.object.controller !== decision.seat ||
    payExile.length !== declineExile.length ||
    payExile.some(
      (target, index) =>
        !FORGE_CARD_OID.test(target.oid) ||
        target.oid === paySource.oid ||
        target.name !== '' ||
        target.object !== undefined ||
        declineExile[index]?.oid !== target.oid ||
        declineExile[index]?.name !== '' ||
        declineExile[index]?.object !== undefined,
    ) ||
    new Set(payExile.map((target) => target.oid)).size !== payExile.length
  ) {
    return [];
  }
  return [
    {
      family: 'whole-hand-discard-payment',
      role: 'pay-whole-hand',
      sourceOid: paySource.oid,
      associatedExileOids: payExile.map((target) => target.oid),
      move: pay.id,
    },
    {
      family: 'whole-hand-discard-payment',
      role: 'decline-whole-hand',
      sourceOid: declineSource.oid,
      associatedExileOids: declineExile.map((target) => target.oid),
      move: decline.id,
    },
  ];
}

function reviewedSourceLinkedActivationActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  if (!decision.complete) return [];
  return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    const match = /^ability-(\d+)-\d+$/u.exec(option.id);
    const source = option.targets[0];
    const associatedExile = option.targets.slice(1);
    if (
      match === null ||
      source === undefined ||
      source.oid !== `forge-card-${match[1]}` ||
      source.name !== 'Bomat Courier' ||
      source.object?.oid !== source.oid ||
      source.object.name !== source.name ||
      source.object.controller !== decision.seat ||
      associatedExile.some(
        (target) =>
          !FORGE_CARD_OID.test(target.oid) ||
          target.oid === source.oid ||
          target.name !== '' ||
          target.object !== undefined,
      ) ||
      new Set(associatedExile.map((target) => target.oid)).size !== associatedExile.length
    ) {
      return [];
    }
    return [
      {
        family: 'source-linked-activation',
        role: 'activate-bomat-courier',
        sourceOid: source.oid,
        associatedExileOids: associatedExile.map((target) => target.oid),
        move: option.id,
      },
    ];
  });
}

function reviewedCostDiscardActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    if (option.id === 'cost-discard-cancel') {
      return [{ family: 'cost-discard-selection', role: 'cancel-cost-discard', move: option.id }];
    }
    const match = COST_DISCARD.exec(option.id);
    const target = option.targets.length === 1 ? option.targets[0] : undefined;
    if (match?.[1] === undefined || target?.oid !== `forge-card-${match[1]}`) return [];
    return [
      {
        family: 'cost-discard-selection',
        role: 'choose-cost-discard',
        oid: target.oid,
        move: option.id,
      },
    ];
  });
}

function reviewedMulliganBottomActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    if (!MULLIGAN_BOTTOM.test(option.id) || option.targets.length === 0) return [];
    const oids = option.targets.map((target) => target.oid);
    if (new Set(oids).size !== oids.length || oids.some((oid) => !FORGE_CARD_OID.test(oid))) return [];
    return [{ family: 'mulligan-bottom', role: 'choose-bottom-cards', oids, move: option.id }];
  });
}

function reviewedOptionalTriggerActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  if (decision.options.length !== 2) return [];
  const use = decision.options.find((option) => option.id === 'confirm-trigger-yes');
  const decline = decision.options.find((option) => option.id === 'confirm-trigger-no');
  const useTarget = use?.targets.length === 1 ? use.targets[0] : undefined;
  const declineTarget = decline?.targets.length === 1 ? decline.targets[0] : undefined;
  if (
    use === undefined ||
    decline === undefined ||
    useTarget === undefined ||
    declineTarget === undefined ||
    useTarget.oid !== declineTarget.oid ||
    !FORGE_CARD_OID.test(useTarget.oid)
  ) {
    return [];
  }
  return [
    {
      family: 'optional-trigger',
      role: 'use-trigger',
      sourceOid: useTarget.oid,
      move: use.id,
    },
    {
      family: 'optional-trigger',
      role: 'decline-trigger',
      sourceOid: declineTarget.oid,
      move: decline.id,
    },
  ];
}

function reviewedCostCardActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    if (option.id === 'cost-exile-cancel') {
      return [{ family: 'cost-exile-selection', role: 'cancel-cost-exile', move: option.id }];
    }
    if (option.id === 'cost-card-selection-done' && option.targets.length === 0) {
      return [{ family: 'cost-card-selection', role: 'finish-cost-card-selection', move: option.id }];
    }
    const exileMatch = COST_EXILE.exec(option.id);
    const genericMatch = COST_CARD.exec(option.id);
    const match = exileMatch ?? genericMatch;
    const target = option.targets.length === 1 ? option.targets[0] : undefined;
    if (match?.[1] === undefined || target?.oid !== `forge-card-${match[1]}`) return [];
    if (genericMatch !== null) {
      return [
        {
          family: 'cost-card-selection',
          role: 'choose-cost-card',
          oid: target.oid,
          move: option.id,
        },
      ];
    }
    return [
      {
        family: 'cost-exile-selection',
        role: 'choose-cost-exile',
        oid: target.oid,
        move: option.id,
      },
    ];
  });
}

function reviewedExertActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    if (option.id === 'combat-exert-done') {
      return [{ family: 'combat-exert', role: 'finish-exert', move: option.id }];
    }
    const match = COMBAT_EXERT.exec(option.id);
    const target = option.targets.length === 1 ? option.targets[0] : undefined;
    if (match?.[1] === undefined || target?.oid !== `forge-card-${match[1]}`) return [];
    return [{ family: 'combat-exert', role: 'exert-attacker', oid: target.oid, move: option.id }];
  });
}

function reviewedBlockerActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    if (option.id === 'combat-blockers-commit') {
      return [{ family: 'combat-blockers', role: 'commit-blockers', move: option.id }];
    }
    const match = COMBAT_BLOCK.exec(option.id);
    const blocker = option.targets[0];
    const attacker = option.targets[1];
    if (
      match?.[1] === undefined ||
      match[2] === undefined ||
      match[3] === undefined ||
      option.targets.length !== 2 ||
      blocker?.oid !== `forge-card-${match[2]}` ||
      attacker?.oid !== `forge-card-${match[3]}`
    ) {
      return [];
    }
    return [
      {
        family: 'combat-blockers',
        role: match[1] === 'add' ? 'add-block' : 'remove-block',
        blockerOid: blocker.oid,
        attackerOid: attacker.oid,
        move: option.id,
      },
    ];
  });
}

function reviewedCombatDamageActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  const suggestion = decision.input?.suggestions?.[0];
  if (decision.input?.kind === 'text' && suggestion !== undefined && decision.options.length === 0) {
    return [
      {
        family: 'combat-damage',
        role: 'assign-damage-split',
        move: textSubmission(decision.input, suggestion),
      },
    ];
  }
  return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    const later = COMBAT_DAMAGE_LATER.exec(option.id);
    if (later?.[1] !== undefined && option.targets.length === 0) {
      return [
        {
          family: 'combat-damage',
          role: 'defer-damage',
          sourceOid: `forge-card-${later[1]}`,
          move: option.id,
        },
      ];
    }
    const match = COMBAT_DAMAGE.exec(option.id);
    const target = option.targets.length === 1 ? option.targets[0] : undefined;
    if (match?.[1] === undefined || match[2] === undefined) return [];
    const sourceOid = `forge-card-${match[1]}`;
    if (match[2] === 'defender') {
      if (option.targets.length === 0) {
        return [
          { family: 'combat-damage', role: 'assign-damage', sourceOid, recipientOid: null, move: option.id },
        ];
      }
      return target !== undefined && FORGE_CARD_OID.test(target.oid)
        ? [
            {
              family: 'combat-damage',
              role: 'assign-damage',
              sourceOid,
              recipientOid: target.oid,
              move: option.id,
            },
          ]
        : [];
    }
    if (match[3] === undefined || target?.oid !== `forge-card-${match[3]}`) return [];
    return [
      {
        family: 'combat-damage',
        role: 'assign-damage',
        sourceOid,
        recipientOid: target.oid,
        move: option.id,
      },
    ];
  });
}

function reviewedTriggerOrderActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    const target = option.targets.length === 1 ? option.targets[0] : undefined;
    if (!TRIGGER_ORDER.test(option.id) || target === undefined || !FORGE_CARD_OID.test(target.oid)) return [];
    return [{ family: 'trigger-order', role: 'order-trigger', sourceOid: target.oid, move: option.id }];
  });
}

function reviewedLibraryShuffleActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    if (option.id === 'confirm-library-shuffle-after-order-yes') {
      return [{ family: 'library-shuffle', role: 'shuffle-library', move: option.id }];
    }
    if (option.id === 'confirm-library-shuffle-after-order-no') {
      return [{ family: 'library-shuffle', role: 'keep-library-order', move: option.id }];
    }
    return [];
  });
}

function reviewedEntityDestinationActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    const match = ENTITY_DESTINATION_CARD.exec(option.id);
    const target = option.targets.length === 1 ? option.targets[0] : undefined;
    if (match?.[1] === undefined || match[2] === undefined || target?.oid !== `forge-card-${match[2]}`) {
      return [];
    }
    return [
      {
        family: 'entity-selection',
        role: 'choose-destination-card',
        destination: match[1] as 'hand' | 'library-bottom' | 'exile-playable',
        oid: target.oid,
        move: option.id,
      },
    ];
  });
}

function isReviewedBeneficialSource(target: MoveTarget | undefined, seat: SeatId): boolean {
  const source = target?.object;
  return (
    target !== undefined &&
    source !== undefined &&
    source.oid === target.oid &&
    source.name === target.name &&
    source.controller === seat &&
    FORGE_CARD_OID.test(source.oid)
  );
}

function isSameReviewedSource(left: MoveTarget | undefined, right: MoveTarget | undefined): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.oid === right.oid &&
    left.name === right.name &&
    JSON.stringify(left.object) === JSON.stringify(right.object)
  );
}

function reviewedBeneficialTriggerActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  if (!decision.complete || decision.options.length !== 2) return [];
  const use = decision.options.find((option) => option.id === 'confirm-beneficial-trigger-yes');
  const decline = decision.options.find((option) => option.id === 'confirm-beneficial-trigger-no');
  const useTarget = use?.targets.length === 1 ? use.targets[0] : undefined;
  const declineTarget = decline?.targets.length === 1 ? decline.targets[0] : undefined;
  if (
    use === undefined ||
    decline === undefined ||
    !isReviewedBeneficialSource(useTarget, decision.seat) ||
    !isReviewedBeneficialSource(declineTarget, decision.seat) ||
    !isSameReviewedSource(useTarget, declineTarget)
  )
    return [];
  return [
    { family: 'beneficial-trigger', role: 'use-beneficial-trigger', move: use.id },
    { family: 'beneficial-trigger', role: 'decline-beneficial-trigger', move: decline.id },
  ];
}

function reviewedOptionalSelfDrawActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  const match = /^confirm-optional-self-draw-([1-9][0-9]*)$/u.exec(decision.kind);
  const drawCount = match?.[1] === undefined ? 0 : Number(match[1]);
  if (
    !decision.complete ||
    !Number.isSafeInteger(drawCount) ||
    drawCount < 1 ||
    decision.options.length !== 2
  ) {
    return [];
  }
  const use = decision.options.find((option) => option.id === `${decision.kind}-yes`);
  const decline = decision.options.find((option) => option.id === `${decision.kind}-no`);
  const useTarget = use?.targets.length === 1 ? use.targets[0] : undefined;
  const declineTarget = decline?.targets.length === 1 ? decline.targets[0] : undefined;
  if (
    use === undefined ||
    decline === undefined ||
    !isReviewedBeneficialSource(useTarget, decision.seat) ||
    !isReviewedBeneficialSource(declineTarget, decision.seat) ||
    !isSameReviewedSource(useTarget, declineTarget)
  )
    return [];
  return [
    { family: 'optional-self-draw', role: 'use-optional-self-draw', drawCount, move: use.id },
    { family: 'optional-self-draw', role: 'decline-optional-self-draw', drawCount, move: decline.id },
  ];
}

function reviewedPileActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  if (!decision.complete || decision.input !== undefined || decision.options.length !== 2) return [];
  const first = decision.options.find((option) => option.id === 'choose-pile-first');
  const second = decision.options.find((option) => option.id === 'choose-pile-second');
  if (first === undefined || second === undefined) return [];

  const targets = [...first.targets, ...second.targets];
  if (
    targets.length < 1 ||
    targets.length > 5 ||
    targets.some(
      (target) =>
        !FORGE_CARD_OID.test(target.oid) ||
        target.object?.oid !== target.oid ||
        target.object.name !== target.name ||
        target.object.controller !== decision.seat,
    ) ||
    new Set(targets.map((target) => target.oid)).size !== targets.length
  ) {
    return [];
  }

  return [first, second].map((option) => ({
    family: 'pile-selection',
    role: 'choose-pile',
    oids: option.targets.map((target) => target.oid),
    move: option.id,
  }));
}

function exactCardTarget(option: PendingDecision['options'][number], match: RegExpExecArray | null) {
  const target = option.targets.length === 1 ? option.targets[0] : undefined;
  return match?.[1] !== undefined && target?.oid === `forge-card-${match[1]}` ? target : null;
}

function reviewedScryMoveActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    const prefix = decision.kind === 'surveil-move' ? 'surveil-move' : 'scry-move';
    if (option.id === `${prefix}-done` && option.targets.length === 0) {
      return [{ family: 'scry-move', role: 'finish-scry-move', move: option.id }];
    }
    const pattern = decision.kind === 'surveil-move' ? SURVEIL_MOVE_CARD : SCRY_MOVE_CARD;
    const target = exactCardTarget(option, pattern.exec(option.id));
    return target === null
      ? []
      : [{ family: 'scry-move', role: 'move-scry-card', oid: target.oid, move: option.id }];
  });
}

function reviewedScryKeepActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    const target = exactCardTarget(option, SCRY_KEEP_CARD.exec(option.id));
    return target === null
      ? []
      : [{ family: 'scry-keep', role: 'keep-scry-card', oid: target.oid, move: option.id }];
  });
}

function reviewedDistributionActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  if (!decision.complete || decision.options.length === 0) return [];
  const actions = decision.options.map(
    (option): Extract<ForgeReviewedAction, { readonly family: 'target-distribution' }> | null => {
      const target = option.targets.length === 1 ? option.targets[0] : undefined;
      const playerMatch = DISTRIBUTE_PLAYER.exec(option.id);
      if (playerMatch?.[1] !== undefined) {
        const seat = Number(playerMatch[1]) as SeatId;
        return target?.oid === `forge-player-${seat}` && target.object === undefined
          ? {
              family: 'target-distribution',
              role: 'choose-distribution-target',
              target: { kind: 'player', seat },
              move: option.id,
            }
          : null;
      }
      const cardMatch = DISTRIBUTE_CARD.exec(option.id);
      if (
        cardMatch?.[1] === undefined ||
        target?.oid !== `forge-card-${cardMatch[1]}` ||
        target.object?.oid !== target.oid
      ) {
        return null;
      }
      return {
        family: 'target-distribution',
        role: 'choose-distribution-target',
        target: { kind: 'card', oid: target.oid },
        move: option.id,
      };
    },
  );
  if (actions.some((action) => action === null)) return [];
  const reviewed = actions.filter((action) => action !== null);
  const targetKeys = reviewed.map((action) =>
    action.target.kind === 'player' ? `player:${action.target.seat}` : `card:${action.target.oid}`,
  );
  return new Set(reviewed.map((action) => action.move)).size === reviewed.length &&
    new Set(targetKeys).size === reviewed.length
    ? reviewed
    : [];
}

function reviewedEntitySelectionActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  if (!decision.complete || decision.input !== undefined) return [];
  const actions = decision.options.map((option): ForgeReviewedAction | null => {
    if (option.id === 'entity-selection-done' && option.targets.length === 0) {
      return { family: 'entity-selection', role: 'finish-entity-selection', move: option.id };
    }
    const cardTarget = exactCardTarget(option, ENTITY_CARD.exec(option.id));
    if (cardTarget !== null) {
      return { family: 'entity-selection', role: 'choose-entity', oid: cardTarget.oid, move: option.id };
    }
    const player = ENTITY_PLAYER.exec(option.id);
    const target = option.targets.length === 1 ? option.targets[0] : undefined;
    const seat = player?.[1] === undefined ? null : (Number(player[1]) as SeatId);
    return seat !== null && target?.oid === `forge-player-${String(seat)}` && target.object === undefined
      ? { family: 'entity-selection', role: 'choose-player', seat, move: option.id }
      : null;
  });
  return actions.some((action) => action === null) ? [] : actions.filter((action) => action !== null);
}

function reviewedCostReturnActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  if (!decision.complete || decision.input !== undefined) return [];
  const actions = decision.options.map((option): ForgeReviewedAction | null => {
    if (option.id === 'cost-return-cancel' && option.targets.length === 0) {
      return { family: 'cost-return-selection', role: 'cancel-cost-return', move: option.id };
    }
    const target = exactCardTarget(option, COST_RETURN.exec(option.id));
    return target === null || target.object?.controller !== decision.seat
      ? null
      : {
          family: 'cost-return-selection',
          role: 'choose-cost-return',
          oid: target.oid,
          move: option.id,
        };
  });
  return actions.some((action) => action === null) ? [] : actions.filter((action) => action !== null);
}

function reviewedCostSacrificeActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  if (!decision.complete || decision.input !== undefined) return [];
  const actions = decision.options.map((option): ForgeReviewedAction | null => {
    if (option.id === 'cost-sacrifice-cancel' && option.targets.length === 0) {
      return { family: 'cost-sacrifice-selection', role: 'cancel-cost-sacrifice', move: option.id };
    }
    const target = exactCardTarget(option, COST_SACRIFICE.exec(option.id));
    return target === null || target.object?.controller !== decision.seat
      ? null
      : {
          family: 'cost-sacrifice-selection',
          role: 'choose-cost-sacrifice',
          oid: target.oid,
          move: option.id,
        };
  });
  return actions.some((action) => action === null) ? [] : actions.filter((action) => action !== null);
}

function reviewedScalarChoiceActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  if (!decision.complete || decision.input !== undefined || decision.options.length === 0) return [];
  const actions = decision.options.map((option): ForgeReviewedAction | null => {
    if (decision.kind === 'replacement-order') {
      const match = REPLACEMENT_ORDER.exec(option.id);
      const position = match?.[1] === undefined ? null : safeInteger(match[1]);
      return position !== null && option.targets.length === 0
        ? { family: 'replacement-order', role: 'choose-replacement-order', position, move: option.id }
        : null;
    }
    const source = option.targets.length === 1 ? option.targets[0] : undefined;
    if (source === undefined || source.object?.oid !== source.oid || !FORGE_CARD_OID.test(source.oid))
      return null;
    const color = COLOR_CHOICE.exec(option.id)?.[1];
    if (decision.kind === 'color-choice' && /^[WUBRG]$/u.test(color ?? '')) {
      return {
        family: 'color-choice',
        role: 'choose-color',
        color: color as 'W' | 'U' | 'B' | 'R' | 'G',
        sourceOid: source.oid,
        move: option.id,
      };
    }
    const parity = PARITY_CHOICE.exec(option.id)?.[1];
    if (decision.kind === 'parity-choice' && (parity === 'odd' || parity === 'even')) {
      return {
        family: 'parity-choice',
        role: 'choose-parity',
        parity,
        sourceOid: source.oid,
        move: option.id,
      };
    }
    const cardType = TYPE_CHOICE.exec(option.id)?.[1];
    return decision.kind === 'type-choice' && cardType !== undefined
      ? { family: 'type-choice', role: 'choose-card-type', cardType, sourceOid: source.oid, move: option.id }
      : null;
  });
  if (actions.some((action) => action === null)) return [];
  const reviewed = actions.filter((action) => action !== null);
  const sources = reviewed.flatMap((action) => ('sourceOid' in action ? [action.sourceOid] : []));
  return sources.length === 0 || new Set(sources).size === 1 ? reviewed : [];
}

function reviewedCoinChoiceActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  if (!decision.complete || decision.input !== undefined || decision.options.length !== 2) return [];
  type CoinChoiceAction = Extract<ForgeReviewedAction, { readonly family: 'coin-choice' }>;
  const actions = decision.options.map((option): CoinChoiceAction | null => {
    const call = COIN_CHOICE.exec(option.id)?.[1];
    const source = option.targets.length === 1 ? option.targets[0] : undefined;
    if (
      (call !== 'heads' && call !== 'tails') ||
      source === undefined ||
      source.object?.oid !== source.oid ||
      source.object.controller !== decision.seat ||
      !FORGE_CARD_OID.test(source.oid)
    ) {
      return null;
    }
    return {
      family: 'coin-choice',
      role: 'choose-coin-call',
      call,
      sourceOid: source.oid,
      move: option.id,
    };
  });
  if (actions.some((action) => action === null)) return [];
  const reviewed = actions.filter((action): action is CoinChoiceAction => action !== null);
  return new Set(reviewed.map((action) => action.sourceOid)).size === 1 &&
    new Set(reviewed.map((action) => action.call)).size === 2
    ? reviewed
    : [];
}

function reviewedReplacementActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  if (decision.options.length !== 2) return [];
  const apply = decision.options.find((option) => option.id === 'confirm-replacement-yes');
  const decline = decision.options.find((option) => option.id === 'confirm-replacement-no');
  const applyTarget = apply?.targets.length === 1 ? apply.targets[0] : undefined;
  const declineTarget = decline?.targets.length === 1 ? decline.targets[0] : undefined;
  if (
    apply === undefined ||
    decline === undefined ||
    applyTarget === undefined ||
    declineTarget === undefined ||
    !FORGE_CARD_OID.test(applyTarget.oid) ||
    applyTarget.oid !== declineTarget.oid ||
    applyTarget.object?.oid !== applyTarget.oid ||
    declineTarget.object?.oid !== declineTarget.oid
  ) {
    return [];
  }
  return [
    { family: 'replacement', role: 'apply-replacement', sourceOid: applyTarget.oid, move: apply.id },
    {
      family: 'replacement',
      role: 'decline-replacement',
      sourceOid: declineTarget.oid,
      move: decline.id,
    },
  ];
}

function reviewedEnumeratedSelectionActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  const actions = decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    if (
      decision.kind === 'mode-selection' &&
      option.id === 'mode-selection-done' &&
      option.targets.length === 0
    ) {
      return [{ family: 'mode-selection', role: 'finish-mode-selection', move: option.id }];
    }
    const match = ENUMERATED_SELECTION.exec(option.id);
    const source = option.targets.length === 1 ? option.targets[0] : undefined;
    if (
      match?.[1] !== decision.kind ||
      match[2] === undefined ||
      source === undefined ||
      !FORGE_CARD_OID.test(source.oid) ||
      source.object?.oid !== source.oid
    ) {
      return [];
    }
    return [
      {
        family: decision.kind as 'ability-selection' | 'mode-selection',
        role: 'choose-enumerated-action',
        sourceOid: source.oid,
        move: option.id,
      },
    ];
  });
  const selections = actions.filter((action) => action.role === 'choose-enumerated-action');
  const sourceOid = selections[0]?.sourceOid;
  return actions.length === decision.options.length &&
    selections.every((action) => action.sourceOid === sourceOid)
    ? actions
    : [];
}

function reviewedAttackerActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    if (option.id === 'combat-attackers-commit' && option.targets.length === 0) {
      return [{ family: 'combat-attackers', role: 'commit-attackers', move: option.id }];
    }
    const removal = COMBAT_ATTACK_REMOVE.exec(option.id);
    const removed = option.targets[0];
    if (
      removal?.[1] !== undefined &&
      option.targets.length === 1 &&
      removed?.oid === `forge-card-${removal[1]}` &&
      removed.object?.oid === removed.oid &&
      removed.object.controller === decision.seat &&
      removed.object.attacking
    ) {
      return [
        {
          family: 'combat-attackers',
          role: 'remove-attacker',
          attackerOid: removed.oid,
          move: option.id,
        },
      ];
    }
    const player = COMBAT_ATTACK_PLAYER.exec(option.id);
    const attacker = option.targets[0];
    if (
      player?.[1] !== undefined &&
      player[2] !== undefined &&
      option.targets.length === 1 &&
      attacker?.oid === `forge-card-${player[1]}`
    ) {
      return [
        {
          family: 'combat-attackers',
          role: 'add-attacker',
          attackerOid: attacker.oid,
          defender: { kind: 'player', seat: Number(player[2]) as SeatId },
          move: option.id,
        },
      ];
    }
    const card = COMBAT_ATTACK_CARD.exec(option.id);
    const defender = option.targets[1];
    if (
      card?.[1] === undefined ||
      card[2] === undefined ||
      option.targets.length !== 2 ||
      attacker?.oid !== `forge-card-${card[1]}` ||
      defender?.oid !== `forge-card-${card[2]}`
    ) {
      return [];
    }
    return [
      {
        family: 'combat-attackers',
        role: 'add-attacker',
        attackerOid: attacker.oid,
        defender: { kind: 'card', oid: defender.oid },
        move: option.id,
      },
    ];
  });
}

/**
 * Converts bridge-owned move ids into typed actions without inspecting labels or prompts.
 * Unknown ids stay absent, so a policy cannot accidentally treat a new bridge behavior as reviewed.
 */
export function reviewedForgeActions(decision: PendingDecision): readonly ForgeReviewedAction[] {
  if (decision.kind === 'priority') return reviewedSourceLinkedActivationActions(decision);
  if (decision.kind === 'choose-pile') return reviewedPileActions(decision);
  if (decision.kind === 'mulligan-bottom') return reviewedMulliganBottomActions(decision);
  if (decision.kind === 'number') return reviewedNumberActions(decision);
  if (decision.kind === 'zone-card-selection' || decision.kind === 'zone-card-selection-hand-to-library') {
    return reviewedZoneCardActions(decision);
  }
  if (decision.kind === 'card-selection') return reviewedCardActions(decision);
  if (decision.kind === 'zone-order' || decision.kind === 'zone-order-library-top-first') {
    return reviewedZoneOrderActions(decision);
  }
  if (decision.kind === 'discard-selection' || decision.kind === 'hand-card-selection') {
    return reviewedDiscardActions(decision);
  }
  if (decision.kind === 'revealed-hand-discard-selection') {
    return reviewedRevealedHandDiscardActions(decision);
  }
  if (decision.kind === 'sacrifice-selection') return reviewedSacrificeActions(decision);
  if (decision.kind === 'target-selection' || decision.kind === 'repeatable-target-selection') {
    return reviewedTargetActions(decision);
  }
  if (decision.kind === 'confirm-trigger') return reviewedOptionalTriggerActions(decision);
  if (decision.kind === 'cost-card-selection') return reviewedCostCardActions(decision);
  if (decision.kind === 'combat-exert') return reviewedExertActions(decision);
  if (decision.kind === 'combat-blockers') return reviewedBlockerActions(decision);
  if (decision.kind === 'combat-damage') return reviewedCombatDamageActions(decision);
  if (decision.kind === 'trigger-order') return reviewedTriggerOrderActions(decision);
  if (decision.kind === 'optional-cost') return reviewedOptionalCostActions(decision);
  if (decision.kind === 'optional-cost-choice') return reviewedOptionalCostChoiceActions(decision);
  if (decision.kind === 'convoke-payment') return reviewedConvokePaymentActions(decision);
  if (decision.kind === 'counter-type-choice') return reviewedCounterTypeChoiceActions(decision);
  if (
    decision.kind === 'confirm-action' ||
    decision.kind === 'confirm-optional-reveal' ||
    decision.kind === 'confirm-explore-graveyard'
  ) {
    return reviewedActionConfirmation(decision);
  }
  if (decision.kind === 'confirm-free-cast') return reviewedFreeCastConfirmation(decision);
  if (decision.kind === 'confirm-payment') return reviewedOptionalPaymentActions(decision);
  if (decision.kind === 'cost-discard-hand-confirm') {
    return reviewedWholeHandDiscardPaymentActions(decision);
  }
  if (decision.kind === 'cost-discard-selection') return reviewedCostDiscardActions(decision);
  if (decision.kind === 'cost-sacrifice-selection') return reviewedCostSacrificeActions(decision);
  if (decision.kind === 'cost-return-selection') return reviewedCostReturnActions(decision);
  if (decision.kind === 'confirm-library-shuffle-after-order') {
    return reviewedLibraryShuffleActions(decision);
  }
  if (/^entity-selection-to-(?:hand|library-bottom|exile-playable)$/u.test(decision.kind)) {
    return reviewedEntityDestinationActions(decision);
  }
  if (decision.kind === 'confirm-beneficial-trigger') {
    return reviewedBeneficialTriggerActions(decision);
  }
  if (/^confirm-optional-self-draw-[1-9][0-9]*$/u.test(decision.kind)) {
    return reviewedOptionalSelfDrawActions(decision);
  }
  if (decision.kind === 'scry-move' || decision.kind === 'surveil-move') {
    return reviewedScryMoveActions(decision);
  }
  if (decision.kind === 'scry-keep') return reviewedScryKeepActions(decision);
  if (decision.kind === 'target-distribution') {
    return reviewedDistributionActions(decision);
  }
  if (decision.kind === 'entity-selection') {
    return reviewedEntitySelectionActions(decision);
  }
  if (decision.kind === 'confirm-replacement') return reviewedReplacementActions(decision);
  if (decision.kind === 'ability-selection' || decision.kind === 'mode-selection') {
    return reviewedEnumeratedSelectionActions(decision);
  }
  if (
    decision.kind === 'color-choice' ||
    decision.kind === 'parity-choice' ||
    decision.kind === 'type-choice' ||
    decision.kind === 'replacement-order'
  ) {
    return reviewedScalarChoiceActions(decision);
  }
  if (decision.kind === 'coin-choice') return reviewedCoinChoiceActions(decision);
  if (decision.kind === 'combat-attackers') return reviewedAttackerActions(decision);
  return [];
}

const V7_NUMBER_VALUE = /^number-(-?(?:0|[1-9][0-9]*))$/u;
const V7_NUMBER_WINDOW = /^number-up-(-?(?:0|[1-9][0-9]*))-max-(-?(?:0|[1-9][0-9]*))$/u;
const V7_NUMBER_RESTART = /^number-restart-max-(-?(?:0|[1-9][0-9]*))$/u;
const V7_ZONE_CARD = /^zone-card-([0-9]+)$/u;
const V7_DISCARD_CARD = /^discard-selection-card-([0-9]+)$/u;
const V7_TARGET_CARD = /^target-card-([0-9]+)$/u;
const V7_TARGET_STACK = /^target-stack-[0-9]+$/u;
const V7_FORGE_CARD_OID = /^forge-card-[0-9]+$/u;
const V7_OPTIONAL_LIFE = /^optional-cost-pay-life-([1-9][0-9]*)$/u;
const V7_COST_DISCARD = /^cost-discard-([0-9]+)$/u;

function v7Integer(raw: string): number | null {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function reviewedNumberActionsV7(decision: PendingDecision): readonly ForgeReviewedAction[] {
  return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    const value = V7_NUMBER_VALUE.exec(option.id);
    if (value !== null) {
      const parsed = v7Integer(value[1] ?? '');
      return parsed === null
        ? []
        : [{ family: 'number', role: 'choose-number', value: parsed, move: option.id }];
    }
    const window = V7_NUMBER_WINDOW.exec(option.id);
    if (window !== null) {
      const offset = v7Integer(window[1] ?? '');
      const maximum = v7Integer(window[2] ?? '');
      return offset === null || offset <= 0 || maximum === null
        ? []
        : [{ family: 'number', role: 'advance-number-window', offset, maximum, move: option.id }];
    }
    const restart = V7_NUMBER_RESTART.exec(option.id);
    const maximum = restart === null ? null : v7Integer(restart[1] ?? '');
    return maximum === null
      ? []
      : [{ family: 'number', role: 'restart-number-window', maximum, move: option.id }];
  });
}

function reviewedDiscardActionsV7(decision: PendingDecision): readonly ForgeReviewedAction[] {
  return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    const match = V7_DISCARD_CARD.exec(option.id);
    const target = option.targets.length === 1 ? option.targets[0] : undefined;
    return match?.[1] !== undefined && target?.oid === `forge-card-${match[1]}`
      ? [{ family: 'discard-selection', role: 'choose-discard', oid: target.oid, move: option.id }]
      : [];
  });
}

function reviewedOptionalCostActionsV7(decision: PendingDecision): readonly ForgeReviewedAction[] {
  return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    if (option.id === 'optional-cost-decline') {
      return [{ family: 'optional-cost', role: 'decline-cost', move: option.id }];
    }
    const match = V7_OPTIONAL_LIFE.exec(option.id);
    const life = match?.[1] === undefined ? null : v7Integer(match[1]);
    return life === null ? [] : [{ family: 'optional-cost', role: 'pay-life', life, move: option.id }];
  });
}

function reviewedCostDiscardActionsV7(decision: PendingDecision): readonly ForgeReviewedAction[] {
  return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
    if (option.id === 'cost-discard-cancel') {
      return [{ family: 'cost-discard-selection', role: 'cancel-cost-discard', move: option.id }];
    }
    const match = V7_COST_DISCARD.exec(option.id);
    const target = option.targets.length === 1 ? option.targets[0] : undefined;
    return match?.[1] !== undefined && target?.oid === `forge-card-${match[1]}`
      ? [{ family: 'cost-discard-selection', role: 'choose-cost-discard', oid: target.oid, move: option.id }]
      : [];
  });
}

/** Exact action surface used by the frozen v8 campaign control. */
export function reviewedForgeActionsV7(decision: PendingDecision): readonly ForgeReviewedAction[] {
  if (decision.kind === 'number') return reviewedNumberActionsV7(decision);
  if (decision.kind === 'discard-selection') return reviewedDiscardActionsV7(decision);
  if (decision.kind === 'optional-cost') return reviewedOptionalCostActionsV7(decision);
  if (decision.kind === 'cost-discard-selection') return reviewedCostDiscardActionsV7(decision);
  if (decision.kind === 'zone-card-selection') {
    return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
      if (option.id === 'zone-decline' || option.id === 'zone-card-none') {
        return [{ family: 'zone-card-selection', role: 'decline-zone-card', move: option.id }];
      }
      const match = V7_ZONE_CARD.exec(option.id);
      const target = option.targets.length === 1 ? option.targets[0] : undefined;
      return match?.[1] !== undefined && target?.oid === `forge-card-${match[1]}`
        ? [{ family: 'zone-card-selection', role: 'choose-zone-card', oid: target.oid, move: option.id }]
        : [];
    });
  }
  if (decision.kind === 'target-selection') {
    return decision.options.flatMap((option): readonly ForgeReviewedAction[] => {
      if (option.id === 'target-cancel') {
        return [{ family: 'target-selection', role: 'cancel-target', move: option.id }];
      }
      const target = option.targets.length === 1 ? option.targets[0] : undefined;
      if (V7_TARGET_STACK.test(option.id) && target !== undefined && V7_FORGE_CARD_OID.test(target.oid)) {
        return [
          { family: 'target-selection', role: 'choose-stack-target', oid: target.oid, move: option.id },
        ];
      }
      const match = V7_TARGET_CARD.exec(option.id);
      return match?.[1] !== undefined && target?.oid === `forge-card-${match[1]}`
        ? [{ family: 'target-selection', role: 'choose-card-target', oid: target.oid, move: option.id }]
        : [];
    });
  }
  return [];
}
