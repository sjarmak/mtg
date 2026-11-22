import type { MoveId } from './decision';
import type { SeatId } from './table';

/**
 * The turn-step vocabulary a shared Magic play surface can present.
 *
 * A backend maps its own phase model into this vocabulary at its adapter
 * boundary. The browser never interprets backend-owned phase or step strings;
 * a step that cannot be mapped exactly stays null.
 */
export const STANDARD_TURN_STEPS = [
  'untap',
  'upkeep',
  'draw',
  'precombatMain',
  'beginCombat',
  'declareAttackers',
  'declareBlockers',
  'firstStrikeDamage',
  'combatDamage',
  'endCombat',
  'postcombatMain',
  'end',
  'cleanup',
] as const;

export type StandardTurnStep = (typeof STANDARD_TURN_STEPS)[number];

/**
 * Presentation groups a backend can prove for an object-originated move.
 *
 * This is deliberately coarser than either engine's action vocabulary. It lets
 * the shared surface arrange exact backend-issued moves without teaching the
 * browser how to parse one backend's ids or labels.
 */
export const PLAY_OBJECT_ACTION_CATEGORIES = ['play', 'cast', 'ability', 'mana', 'combat'] as const;

export type PlayObjectActionCategory = (typeof PLAY_OBJECT_ACTION_CATEGORIES)[number];

/** A concrete output proved by a backend's mana-source move. */
export const PLAY_MANA_OUTPUTS = ['W', 'U', 'B', 'R', 'G', 'C'] as const;

export type PlayManaOutput = (typeof PLAY_MANA_OUTPUTS)[number];

/** Public floating mana by symbol; counts come from the backend, never the browser. */
export type PlayManaPool = Readonly<Record<PlayManaOutput, number>>;

/**
 * What an attacker may be sent at: a player, or a planeswalker or battle a
 * player controls (CR 508.1b). A seat is named by its table position and an
 * object by the same id a projected `ObjectView` carries.
 */
export type PlayDefender = { readonly seat: SeatId } | { readonly oid: string };

/** One exact move the backend says originates from one projected object. */
export interface ObjectMove {
  readonly oid: string;
  readonly move: MoveId;
  /** Absent when the adapter cannot prove a shared presentation group. */
  readonly category?: PlayObjectActionCategory;
  /** Absent unless this exact move produces one proved mana output. */
  readonly manaOutput?: PlayManaOutput;
  /**
   * Who this move sends the object at, present only on a move that adds an
   * attacker to a declaration. At a pod an unstaged creature has one such move
   * per defender, so the pair `oid` and `defender` is what tells them apart;
   * without it the moves are indistinguishable to a surface that may not parse
   * a backend's ids.
   */
  readonly defender?: PlayDefender;
}

/** One exact move the backend says is answered by one projected player. */
export interface SeatMove {
  readonly seat: SeatId;
  readonly move: MoveId;
}

/** Shared prompt treatments an adapter can prove without exposing backend vocabulary. */
export const PLAY_PROMPT_ROLES = ['opening-hand'] as const;

export type PlayPromptRole = (typeof PLAY_PROMPT_ROLES)[number];

/** Routine moves the ordinary play controller performs without an extra prompt. */
export const PLAY_AUTOMATIC_MOVE_REASONS = ['local-starts', 'mana-payment', 'mana-payment-cancel'] as const;

export type PlayAutomaticMoveReason = (typeof PLAY_AUTOMATIC_MOVE_REASONS)[number];

export interface PlayAutomaticMove {
  readonly move: MoveId;
  readonly reason: PlayAutomaticMoveReason;
}

/** Exact roles for the shared click-to-stage attacker gesture. */
export interface PlayAttackers {
  /** Commits the currently staged set. */
  readonly confirm: MoveId;
  /** Object ids Forge already holds in the incremental declaration. */
  readonly staged: readonly string[];
}

/** Public zones that a backend can prove for a card-selection move. */
export const PLAY_CARD_SELECTION_ZONES = ['hand', 'library'] as const;

export type PlayCardSelectionZone = (typeof PLAY_CARD_SELECTION_ZONES)[number];

/** One exact zone route proved by the backend for the current card selection. */
export interface PlayCardSelection {
  readonly origin: PlayCardSelectionZone;
  readonly destination: PlayCardSelectionZone;
}

/** The direction in which a backend asks the player to state a card order. */
export interface PlayCardOrder {
  readonly destination: PlayCardSelectionZone;
  readonly first: 'top';
}

export interface PlayCombatDamageRecipient {
  readonly oid: string;
  readonly name: string;
  readonly kind: 'blocker' | 'defender';
  readonly toughness: number | null;
  readonly damage: number;
  readonly lethal: number;
}

export interface PlayCombatDamageAssignment {
  readonly inputId: string;
  readonly source: {
    readonly oid: string;
    readonly name: string;
    readonly power: number;
  };
  readonly total: number;
  readonly canDefer: boolean;
  readonly overrideOrder: boolean;
  readonly recipients: readonly PlayCombatDamageRecipient[];
  readonly defaultAmounts: readonly number[];
}

/**
 * Exact interaction roles declared by a backend for the shared play shell.
 *
 * Move ids remain opaque. Each nullable member means the backend did not prove
 * that role in this position; a surface must not recover it from labels, ids,
 * decision kinds, or other backend-owned text.
 */
export interface PlayInteraction {
  readonly turnStep: StandardTurnStep | null;
  readonly passPriority: MoveId | null;
  readonly concede: MoveId | null;
  /** Exact immediate mana take-back, when the backend still permits it. */
  readonly undo?: MoveId | null;
  /** Current public floating mana, one pool per seat in table order, when the backend projects it. */
  readonly manaPools?: readonly PlayManaPool[];
  /** Source-object roles only; targets remain on `MoveOption.targets`. */
  readonly objectActions: readonly ObjectMove[];
  /** Exact player-target roles, when the backend can prove them. */
  readonly seatActions?: readonly SeatMove[];
  /** Absent unless this is an exact incremental attacker declaration. */
  readonly attackers?: PlayAttackers | null;
  /** Absent unless the backend proves the source and destination of a card selection. */
  readonly cardSelection?: PlayCardSelection | null;
  /** Absent unless the backend proves how the first selected card is positioned. */
  readonly cardOrder?: PlayCardOrder | null;
  readonly combatDamage?: PlayCombatDamageAssignment | null;
  /** Absent when the adapter cannot prove a shared prompt treatment. */
  readonly promptRole?: PlayPromptRole | null;
  /** Absent when the current decision requires a person's judgment. */
  readonly automatic?: PlayAutomaticMove | null;
}
