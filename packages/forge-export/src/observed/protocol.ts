/** Versioned JSONL spoken only between TypeScript and the Forge companion. */
import { z } from 'zod';
import type { GameVariant } from '@mtg/engine';
import { PROJECTION_VERSION } from '@mtg/engine';

export const FORGE_BRIDGE_PROTOCOL_VERSION = 2;
export const FORGE_BRIDGE_LINE_PREFIX = '@@MTG_FORGE_JSON@@';

/** The two Forge game types the bridge opens; every other Forge variant is refused by name. */
export type ForgeGameType = 'Constructed' | 'Commander' | 'MomirBasic';

/**
 * Which Forge game a table's rules open. The format id is provenance for
 * receipts and admission, never a routing key: which cards a session may hold
 * is the card gate's question, not the bridge's. The variant is the routing
 * key, and this is the whole of the map from the contract's word to Forge's.
 */
export const FORGE_GAME_TYPES: Readonly<Record<GameVariant, ForgeGameType>> = {
  standard: 'Constructed',
  commander: 'Commander',
  momir: 'MomirBasic',
};

/**
 * Formats whose engine seat keeps Forge's stock action choice. The Legacy Cube
 * admission was qualified before the engine seat's cycling lookahead existed
 * and its receipts bind that behavior; every format admitted since runs the
 * lookahead, which is a no-op for a format that prints no cycling cards.
 */
export const FORGE_STOCK_AI_FORMATS: ReadonlySet<string> = new Set(['legacy-cube-2021-08']);

const seatId = z.union([z.literal(0), z.literal(1)]);
const manaPool = z.strictObject({
  W: z.number().int().nonnegative(),
  U: z.number().int().nonnegative(),
  B: z.number().int().nonnegative(),
  R: z.number().int().nonnegative(),
  G: z.number().int().nonnegative(),
  C: z.number().int().nonnegative(),
});
const objectView = z
  .strictObject({
    oid: z.string().min(1),
    name: z.string(),
    typeLine: z.string(),
    power: z.number().int().nullable(),
    toughness: z.number().int().nullable(),
    tapped: z.boolean(),
    attacking: z.boolean(),
    // Written by the bridge on a blocked attacker only, and absent rather than
    // empty everywhere else, the way the contract states it.
    blockedBy: z.array(z.string().min(1)).readonly().optional(),
    damage: z.number().int().nonnegative(),
    controller: seatId,
    counters: z.record(z.string(), z.number().int()),
    characteristics: z
      .strictObject({
        colors: z.array(z.enum(['W', 'U', 'B', 'R', 'G'])).readonly(),
        manaCost: z.string().min(1).nullable(),
        token: z.boolean(),
      })
      .optional(),
    // Written for every permanent on the battlefield, empty when it has none,
    // and absent everywhere else, the way the contract states it.
    keywords: z.array(z.string().min(1)).readonly().optional(),
    // Written on both members of a soulbond pair, each naming the other, and
    // absent on every unpaired permanent.
    pairedWith: z.string().min(1).optional(),
  })
  .transform(({ blockedBy, characteristics, keywords, pairedWith, ...object }) => ({
    ...object,
    ...(blockedBy === undefined ? {} : { blockedBy }),
    ...(characteristics === undefined ? {} : { characteristics }),
    ...(keywords === undefined ? {} : { keywords }),
    ...(pairedWith === undefined ? {} : { pairedWith }),
  }));
const seatView = z
  .strictObject({
    id: seatId,
    name: z.string(),
    life: z.number().int(),
    hand: z.array(objectView).readonly().nullable(),
    handSize: z.number().int().nonnegative(),
    librarySize: z.number().int().nonnegative(),
    graveyard: z.array(objectView).readonly(),
    exile: z.array(objectView).readonly(),
    battlefield: z.array(objectView).readonly(),
    // Written by the bridge on a commander game only, and absent rather than
    // empty on the standard game, the way the contract states them.
    commandZone: z.array(objectView).readonly().optional(),
    avatars: z.array(objectView).readonly().optional(),
    commanderDamage: z.record(z.string().min(1), z.number().int().nonnegative()).optional(),
    commanderCasts: z.record(z.string().min(1), z.number().int().nonnegative()).optional(),
    // Written while the top of the library is public to every player, and
    // absent rather than empty otherwise.
    libraryTop: z.array(objectView).readonly().optional(),
    // Poison is written on every seat, since Forge always knows it; every other
    // player counter is named by kind in an open map that is absent while the
    // seat holds none.
    poison: z.number().int().nonnegative().optional(),
    playerCounters: z.record(z.string().min(1), z.number().int().nonnegative()).optional(),
  })
  .transform(
    ({
      commandZone,
      avatars,
      commanderDamage,
      commanderCasts,
      libraryTop,
      poison,
      playerCounters,
      ...seat
    }) => ({
      ...seat,
      ...(commandZone === undefined ? {} : { commandZone }),
      ...(avatars === undefined ? {} : { avatars }),
      ...(commanderDamage === undefined ? {} : { commanderDamage }),
      ...(commanderCasts === undefined ? {} : { commanderCasts }),
      ...(libraryTop === undefined ? {} : { libraryTop }),
      ...(poison === undefined ? {} : { poison }),
      ...(playerCounters === undefined ? {} : { playerCounters }),
    }),
  );
const tableView = z.strictObject({
  version: z.literal(PROJECTION_VERSION),
  turn: z.strictObject({
    number: z.number().int().nonnegative(),
    active: seatId,
    phase: z.string(),
    step: z.string(),
  }),
  priority: seatId.nullable(),
  stack: z.array(objectView).readonly(),
  seats: z.tuple([seatView, seatView]).readonly(),
});
const moveTarget = z
  .strictObject({
    oid: z.string().min(1),
    name: z.string(),
    object: objectView.nullish(),
  })
  .superRefine((target, context) => {
    if (target.object !== null && target.object !== undefined) {
      if (target.object.oid !== target.oid) {
        context.addIssue({ code: 'custom', message: 'target object id must match target id' });
      }
      if (target.object.name !== target.name) {
        context.addIssue({ code: 'custom', message: 'target object name must match target name' });
      }
    }
  })
  .transform(({ object, ...target }) =>
    object === null || object === undefined ? target : { ...target, object },
  );
const engineEvent = z.strictObject({
  seq: z.number().int().nonnegative(),
  type: z.string(),
  text: z.string(),
  detail: z.unknown(),
  reveals: z.array(z.strictObject({ oid: z.string().min(1), seats: z.array(seatId).readonly() })).readonly(),
});
/**
 * The text box behind an open question, mirroring `TextDecisionInput`.
 *
 * `PendingDecision.input` is absent rather than null on an ordinary decision and
 * `exactOptionalPropertyTypes` is on, so this arrives on the wire as a field
 * Forge always writes and `backend.ts` drops the key when it is null. A schema
 * `.optional()` would infer `input?: X | undefined`, which the contract's
 * `input?: DecisionInput` does not accept.
 */
const textInput = z.strictObject({
  kind: z.literal('text'),
  id: z.string().min(1),
  label: z.string().min(1),
  minLength: z.number().int().nonnegative(),
  maxLength: z.number().int().nonnegative(),
  suggestions: z.array(z.string()).readonly(),
});
const manaPaymentOption = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('mana'),
    resource: z.string().min(1),
    color: z.enum(['W', 'U', 'B', 'R', 'G', 'C']),
  }),
  z.strictObject({ kind: z.literal('phyrexian-life') }),
  z.strictObject({ kind: z.literal('activation') }),
  z.strictObject({ kind: z.literal('cancel') }),
]);
const decision = z.strictObject({
  seat: seatId,
  kind: z.string(),
  prompt: z.string(),
  options: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        text: z.string(),
        targets: z.array(moveTarget).readonly(),
        manaPayment: manaPaymentOption.optional(),
      }),
    )
    .readonly(),
  input: textInput.nullable(),
  manaPayment: z.strictObject({ unpaid: z.array(z.string().min(1)).min(1).readonly() }).optional(),
  complete: z.literal(true),
});
const result = z.strictObject({
  winner: seatId.nullable(),
  reason: z.string(),
  endedOnTurn: z.number().int().nonnegative(),
});

const helloResponse = z.strictObject({
  protocolVersion: z.number().int(),
  type: z.literal('hello'),
  requestId: z.string(),
  forgeVersion: z.string().min(1),
});
const snapshotResponse = z.strictObject({
  protocolVersion: z.literal(FORGE_BRIDGE_PROTOCOL_VERSION),
  type: z.literal('snapshot'),
  requestId: z.string(),
  sessionId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  status: z.union([z.literal('awaiting'), z.literal('finished')]),
  view: tableView,
  manaPools: z.tuple([manaPool, manaPool]).readonly().optional(),
  events: z.array(engineEvent).readonly(),
  decision: decision.nullable(),
  result: result.nullable(),
});
const errorResponse = z.strictObject({
  protocolVersion: z.literal(FORGE_BRIDGE_PROTOCOL_VERSION),
  type: z.literal('error'),
  requestId: z.string(),
  kind: z.union([z.literal('content-unresolved'), z.literal('illegal-move'), z.literal('backend-failure')]),
  message: z.string(),
  unresolved: z.array(z.string()).readonly().optional(),
});
const closedResponse = z.strictObject({
  protocolVersion: z.literal(FORGE_BRIDGE_PROTOCOL_VERSION),
  type: z.literal('closed'),
  requestId: z.string(),
});

export const bridgeResponse = z.discriminatedUnion('type', [
  helloResponse,
  snapshotResponse,
  errorResponse,
  closedResponse,
]);

export type BridgeResponse = z.infer<typeof bridgeResponse>;
export type SnapshotResponse = z.infer<typeof snapshotResponse>;

export interface BridgeDeckSlot {
  readonly name: string;
  readonly count: number;
}

export interface BridgeOpenRequest {
  readonly protocolVersion: typeof FORGE_BRIDGE_PROTOCOL_VERSION;
  readonly type: 'open';
  readonly requestId: string;
  readonly format: string;
  readonly forgeGameType: ForgeGameType;
  /** Life each seat starts on, stated by the table rather than looked up from the game type. */
  readonly startingLife: number;
  /** Whether the engine seat may cycle when Forge's stock choice would pass. */
  readonly engineCyclingLookahead: boolean;
  readonly seed: string | null;
  readonly maximumTurns: number | null;
  /** Explicit trust boundary selected by the constructor that supplied the card inventory. */
  readonly validationPurpose?: 'catalog-discovery' | 'admitted-format';
  /**
   * `computer` lets Forge's AI answer a local-seat choice the bridge has no
   * reviewed screen for, and records it as an `Unreviewed choice` event,
   * instead of ending the game (#66). Absent is `stop`.
   */
  readonly unreviewedChoices?: 'stop' | 'computer';
  readonly seats: readonly [
    {
      readonly name: string;
      readonly controller: 'local' | 'engine';
      readonly cards: readonly BridgeDeckSlot[];
      readonly sideboard: readonly BridgeDeckSlot[];
      /** The seat's commanders, one slot each; empty on a Constructed game. */
      readonly commanders: readonly BridgeDeckSlot[];
    },
    {
      readonly name: string;
      readonly controller: 'local' | 'engine';
      readonly cards: readonly BridgeDeckSlot[];
      readonly sideboard: readonly BridgeDeckSlot[];
      /** The seat's commanders, one slot each; empty on a Constructed game. */
      readonly commanders: readonly BridgeDeckSlot[];
    },
  ];
}

export type BridgeRequest =
  | {
      readonly protocolVersion: typeof FORGE_BRIDGE_PROTOCOL_VERSION;
      readonly type: 'hello';
      readonly requestId: string;
    }
  | BridgeOpenRequest
  | {
      readonly protocolVersion: typeof FORGE_BRIDGE_PROTOCOL_VERSION;
      readonly type: 'submit';
      readonly requestId: string;
      readonly sessionId: string;
      readonly revision: number;
      readonly moveId: string;
      /**
       * The answer to a text decision, already decoded, or null for an option.
       *
       * `textSubmission` spells the opaque move id and `textValueOf` reads it,
       * both in TypeScript. Java parsing that prefix would be a second
       * derivation of one wire format, so the decoding stays on this side and
       * the companion is handed the plain string it must resolve to a card.
       */
      readonly text: string | null;
    }
  | {
      readonly protocolVersion: typeof FORGE_BRIDGE_PROTOCOL_VERSION;
      readonly type: 'close';
      readonly requestId: string;
      readonly sessionId: string;
    };
