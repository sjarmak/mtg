/**
 * The wire between a seat and the table it is sitting at.
 *
 * # The whole protocol is an index in and a position out
 *
 * That is not a design choice made here; it is what the kernel already is.
 * `GameSession`'s docblock states it outright — "Seed plus this list is the
 * entire record of a played game" — and `choose(session, index)` is the whole of
 * the input surface. So a client sends an integer that addresses the enumeration
 * the server handed it one message ago, and gets back the position it is
 * entitled to see. It never names a move, and it never could: an index into a
 * list it did not build cannot express a move the kernel did not enumerate, and
 * the server re-derives the list from state before spending it.
 *
 * The one thing a client sends besides the integer is `at`, the decision counter
 * it believed it was answering. A network makes the stale click real — a
 * double-tap, a resumed tab, a poll that landed after the opponent moved — and
 * without it a click meant for one enumeration is spent on the next one, which
 * is a legal move nobody chose. Mismatches are refused with the counter the
 * server is actually on, so the client resynchronizes rather than guessing.
 *
 * # Nothing here is game state
 *
 * `WireAutoPass` is a per-client preference and travels because each seat has
 * its own. It reaches `SessionOptions.seatAutoPass` and nothing else, which is
 * where stops already live and for exactly this reason: it must not reach
 * `GameState`, `stateFingerprint` or the replay path. Sets do not survive JSON,
 * so a stop set crosses as two arrays and is rebuilt on arrival — and rebuilt
 * through a validator, because a step name is external data the moment it
 * arrives over a socket.
 *
 * # Why HTTP and long polling rather than a socket
 *
 * The workspace has no `ws` and no `express`, and adding a dependency is a
 * finding rather than a thing to do quietly (`AGENTS.md`). Node 22 ships a
 * WebSocket *client* and no server, so a socket here would mean hand-rolling RFC
 * 6455 framing. A turn-based game with two players needs one thing a plain
 * request cannot give — the server telling a client that something happened —
 * and a held request answers that in nine lines with no framing at all. Each
 * poll is also its own reconnection: a client that dropped asks again with the
 * revision it last saw and is answered immediately if it missed anything.
 */
import type {
  AttackDeclaration,
  AutoPassSettings,
  BlockDeclaration,
  BlockerOrdering,
  DeclarationAction,
  Decision,
  GameEvent,
  GameResult,
  GameState,
  ObjectId,
  PlayerId,
  Step,
} from '@mtg/kernel';
import { STEPS } from '@mtg/kernel';

/**
 * Bumped when a field changes meaning rather than when one is added.
 *
 * Every snapshot carries it and the client refuses one it does not know, because
 * the alternative on a two-machine setup is a stale tab silently drawing a board
 * out of fields that have moved.
 */
// Version 2 widens an attack defender from a seat to a seat-or-tagged-walker.
// Version 3 replaces the raw choice recording with its count and rotates every
// concealed identifier between delivered revisions.
export const NETPLAY_PROTOCOL = 3;

/** The table's default hard stop, and therefore the largest credible wire count. */
export const MAX_NETPLAY_DECISIONS = 200_000;

/** A stop set as JSON: sets do not survive it, so each half is a list of steps. */
export interface WireStopSet {
  readonly yourTurn: readonly Step[];
  readonly theirTurn: readonly Step[];
}

/** `AutoPassSettings` as JSON. See the header: preference, never position. */
export interface WireAutoPass {
  readonly enabled: boolean;
  readonly passUnstopped: boolean;
  readonly stops: WireStopSet;
}

/**
 * Everything one seat is told about the game, and nothing it is not.
 *
 * `state` has been through `@mtg/kernel`'s `seatState`, so the other seat's hand
 * and both libraries are counts with no cards behind them. That is the whole
 * point of the server holding the session: concealment here is the absence of
 * bytes rather than a component declining to draw them.
 *
 * `pending` is non-null only for the seat that owes the decision. A seat that
 * does not owe one is told *who* does, by `awaiting`, which is what lets its
 * page say who it is waiting for instead of pretending the game ended.
 */
export interface SeatSnapshot {
  readonly protocol: number;
  readonly tableId: string;
  readonly seat: PlayerId;
  /** Seat-indexed, so a label does not change when the viewer does. */
  readonly names: readonly [string, string];
  /** Monotonic per table. A client polls with the last one it saw. */
  readonly revision: number;
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  readonly pending: Decision | null;
  readonly result: GameResult | null;
  readonly decisions: number;
  /** Human choices made, with no decision values to reconstruct hidden moves. */
  readonly choices: { readonly length: number };
  /** Which seat the game is waiting on; null when it is over. */
  readonly awaiting: PlayerId | null;
  /** This seat's own preference, as the server currently holds it. */
  readonly autoPass: WireAutoPass;
}

/**
 * A combat declaration a seat built rather than picked, as it crosses the wire.
 *
 * The three decisions whose option list `enumerate.ts` can truncate, and the
 * only moves a seat may send as a value instead of an index (`mtg-y1t.2`). The
 * seat itself is deliberately absent: the table supplies it from the connection
 * the request arrived on, so a client cannot declare for the other player by
 * writing a different number in the body. `validateAction` refuses one anyway —
 * it checks the decision's own player — and this makes the same guarantee one
 * layer earlier, where a reader can state it.
 */
export type WireDeclaration = DeclarationAction;

/** What a seat may ask the table to do. */
export type SeatRequest =
  | { readonly kind: 'choose'; readonly index: number; readonly at: number }
  | { readonly kind: 'declare'; readonly declaration: WireDeclaration; readonly at: number }
  | { readonly kind: 'yield'; readonly boundary: 'endOfTurn' | 'yourNextTurn'; readonly at: number }
  | { readonly kind: 'autoPass'; readonly autoPass: WireAutoPass };

/** A refusal, with the counter the server is actually on so a client can resync. */
export interface SeatRefusal {
  readonly refused: string;
  readonly at: number;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stepList(value: unknown, where: string): readonly Step[] | string {
  if (!Array.isArray(value)) return `${where} is not a list of steps`;
  const steps: Step[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !(STEPS as readonly string[]).includes(entry)) {
      return `${where} names ${JSON.stringify(entry)}, which is not a step`;
    }
    steps.push(entry as Step);
  }
  return steps;
}

/**
 * A stop set off the wire, or the reason it is not one.
 *
 * Exported because the server validates what arrives and the client validates
 * what comes back: both ends of a socket are a boundary, and a snapshot built by
 * a server one version ahead is external data too.
 */
export function readWireAutoPass(value: unknown, where = 'autoPass'): WireAutoPass | string {
  if (!isRecord(value)) return `${where} is not an object`;
  if (typeof value['enabled'] !== 'boolean') return `${where}.enabled is not a boolean`;
  if (typeof value['passUnstopped'] !== 'boolean') return `${where}.passUnstopped is not a boolean`;
  const stops: unknown = value['stops'];
  if (!isRecord(stops)) return `${where}.stops is not an object`;
  const yourTurn = stepList(stops['yourTurn'], `${where}.stops.yourTurn`);
  if (typeof yourTurn === 'string') return yourTurn;
  const theirTurn = stepList(stops['theirTurn'], `${where}.stops.theirTurn`);
  if (typeof theirTurn === 'string') return theirTurn;
  return { enabled: value['enabled'], passUnstopped: value['passUnstopped'], stops: { yourTurn, theirTurn } };
}

function counter(value: unknown, where: string): number | string {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return `${where} is not a decision counter`;
  }
  return value;
}

/** An object id off the wire: a non-empty string and nothing else. */
function objectId(value: unknown, where: string): ObjectId | string {
  if (typeof value !== 'string' || value.length === 0) return `${where} is not an object id`;
  return value;
}

function objectIds(value: unknown, where: string): readonly ObjectId[] | string {
  if (!Array.isArray(value)) return `${where} is not a list of object ids`;
  const oids: ObjectId[] = [];
  for (const [index, entry] of value.entries()) {
    const oid = objectId(entry, `${where}[${String(index)}]`);
    if (typeof oid !== 'string' || oid.length === 0) return oid as string;
    oids.push(oid);
  }
  return oids;
}

/**
 * A built declaration off the wire, or the reason it is not one.
 *
 * Every field is read and rebuilt rather than cast, so nothing the body carries
 * beyond these reaches the kernel. What it is *not* doing is deciding whether
 * the declaration is legal: `chooseAction` puts it through `validateAction`,
 * which re-derives every condition from the position, and a second opinion here
 * would be one that could disagree.
 */
export function readDeclaration(value: unknown, where: string): WireDeclaration | string {
  if (!isRecord(value)) return `${where} is not a declaration`;
  const type: unknown = value['type'];
  const player: unknown = value['player'];
  if (player !== 0 && player !== 1) return `${where}.player is not a seat`;
  if (type === 'declareAttackers') {
    if (!Array.isArray(value['attackers'])) return `${where}.attackers is not a list`;
    const attackers: AttackDeclaration[] = [];
    for (const [index, entry] of value['attackers'].entries()) {
      if (!isRecord(entry)) return `${where}.attackers[${String(index)}] is not an attack`;
      const oid = objectId(entry['oid'], `${where}.attackers[${String(index)}].oid`);
      if (oid.length === 0 || typeof entry['oid'] !== 'string') return oid;
      const defender: unknown = entry['defender'];
      if (defender === 0 || defender === 1) {
        attackers.push({ oid, defender });
        continue;
      }
      if (!isRecord(defender) || defender['kind'] !== 'planeswalker') {
        return `${where}.attackers[${String(index)}].defender is not a seat or planeswalker`;
      }
      if (typeof defender['oid'] !== 'string' || defender['oid'].length === 0) {
        return `${where}.attackers[${String(index)}].defender.oid is not an object id`;
      }
      const defenderOid = objectId(defender['oid'], `${where}.attackers[${String(index)}].defender.oid`);
      attackers.push({ oid, defender: { kind: 'planeswalker', oid: defenderOid } });
    }
    return { type: 'declareAttackers', player, attackers };
  }
  if (type === 'declareBlockers') {
    if (!Array.isArray(value['blocks'])) return `${where}.blocks is not a list`;
    const blocks: BlockDeclaration[] = [];
    for (const [index, entry] of value['blocks'].entries()) {
      if (!isRecord(entry)) return `${where}.blocks[${String(index)}] is not a block`;
      const blocker = objectId(entry['blocker'], `${where}.blocks[${String(index)}].blocker`);
      if (typeof entry['blocker'] !== 'string' || blocker.length === 0) return blocker;
      const attacker = objectId(entry['attacker'], `${where}.blocks[${String(index)}].attacker`);
      if (typeof entry['attacker'] !== 'string' || attacker.length === 0) return attacker;
      blocks.push({ blocker, attacker });
    }
    return { type: 'declareBlockers', player, blocks };
  }
  if (type === 'orderBlockers') {
    if (!Array.isArray(value['orders'])) return `${where}.orders is not a list`;
    const orders: BlockerOrdering[] = [];
    for (const [index, entry] of value['orders'].entries()) {
      if (!isRecord(entry)) return `${where}.orders[${String(index)}] is not an ordering`;
      const attacker = objectId(entry['attacker'], `${where}.orders[${String(index)}].attacker`);
      if (typeof entry['attacker'] !== 'string' || attacker.length === 0) return attacker;
      const blockers = objectIds(entry['blockers'], `${where}.orders[${String(index)}].blockers`);
      if (typeof blockers === 'string') return blockers;
      orders.push({ attacker, blockers });
    }
    return { type: 'orderBlockers', player, orders };
  }
  return `${where}.type is ${JSON.stringify(type)}, which is not a declaration this table takes`;
}

/**
 * A request off the wire, or the reason it is not one.
 *
 * A string return rather than a throw, because every one of these is a client
 * saying something the server has to answer with a status code and a sentence
 * rather than a stack trace. Nothing past this function trusts the body.
 */
export function readSeatRequest(body: unknown): SeatRequest | string {
  if (!isRecord(body)) return 'the request body is not an object';
  const kind: unknown = body['kind'];
  if (kind === 'choose') {
    const index = counter(body['index'], 'index');
    if (typeof index === 'string') return index;
    const at = counter(body['at'], 'at');
    if (typeof at === 'string') return at;
    return { kind: 'choose', index, at };
  }
  if (kind === 'declare') {
    const declaration = readDeclaration(body['declaration'], 'declaration');
    if (typeof declaration === 'string') return declaration;
    const at = counter(body['at'], 'at');
    if (typeof at === 'string') return at;
    return { kind: 'declare', declaration, at };
  }
  if (kind === 'yield') {
    const boundary: unknown = body['boundary'];
    if (boundary !== 'endOfTurn' && boundary !== 'yourNextTurn') {
      return `boundary is ${JSON.stringify(boundary)}, which is not a yield boundary`;
    }
    const at = counter(body['at'], 'at');
    if (typeof at === 'string') return at;
    return { kind: 'yield', boundary, at };
  }
  if (kind === 'autoPass') {
    const autoPass = readWireAutoPass(body['autoPass']);
    if (typeof autoPass === 'string') return autoPass;
    return { kind: 'autoPass', autoPass };
  }
  return `kind is ${JSON.stringify(kind)}, which is not a request this table answers`;
}

/**
 * A stop set to JSON and back.
 *
 * Two functions rather than one structural cast, because `StopSet` holds
 * `ReadonlySet<Step>` and a set serializes to `{}`. That failure is silent in
 * exactly the wrong way — the payload is valid JSON, the client parses it, and
 * every stop the player set has quietly gone — so the conversion is written out
 * in both directions and the step names are checked on the way in.
 */
export function toWireAutoPass(settings: AutoPassSettings): WireAutoPass {
  return {
    enabled: settings.enabled,
    passUnstopped: settings.passUnstopped,
    stops: {
      yourTurn: [...settings.stops.yourTurn],
      theirTurn: [...settings.stops.theirTurn],
    },
  };
}

export function fromWireAutoPass(wire: WireAutoPass): AutoPassSettings {
  return {
    enabled: wire.enabled,
    passUnstopped: wire.passUnstopped,
    stops: {
      yourTurn: new Set<Step>(wire.stops.yourTurn),
      theirTurn: new Set<Step>(wire.stops.theirTurn),
    },
  };
}
