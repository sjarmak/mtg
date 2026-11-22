/**
 * A browser-safe ObservedBackend over the local EngineSession gateway.
 *
 * The protocol number is mirrored rather than imported from @mtg/netplay: its
 * barrel reaches node:http, while every value imported under ui/src is part of
 * the Vite graph. The isolation test compares both constants and scans this
 * tree for implementation imports.
 */
import type {
  ContentRef,
  EngineEvent,
  MatchResult,
  MatchRules,
  MoveId,
  ObjectView,
  ObservedBackend,
  ObservedSession,
  OpenResult,
  PendingDecision,
  PlayInteraction,
  SeatId,
  SeatView,
  SessionError,
  SessionSpec,
  SubmitResult,
  TableView,
  TranscriptFrame,
} from '@mtg/engine';
import {
  MIN_SEATS,
  PLAY_AUTOMATIC_MOVE_REASONS,
  PLAY_CARD_SELECTION_ZONES,
  PLAY_MANA_OUTPUTS,
  PLAY_OBJECT_ACTION_CATEGORIES,
  PLAY_PROMPT_ROLES,
  PROJECTION_VERSION,
  STANDARD_TURN_STEPS,
} from '@mtg/engine';

export const BROWSER_BACKEND_PROTOCOL = 4;

export interface HttpObservedBackendOptions {
  readonly id: string;
  /** Defaults to the Vite proxy prefix. */
  readonly baseUrl?: string;
  /** Injectable for protocol tests; defaults to the browser fetch. */
  readonly fetch?: typeof globalThis.fetch;
}

export type ReadResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

interface GatewaySnapshot {
  readonly token: string;
  readonly revision: number;
  readonly session: ObservedSnapshot;
}

interface ObservedSnapshot {
  readonly backend: string;
  readonly table: SessionSpec;
  readonly status: ObservedSession['status'];
  readonly view: TableView;
  readonly events: readonly EngineEvent[];
  readonly decision: PendingDecision | null;
  readonly play: PlayInteraction | null;
  readonly result: MatchResult | null;
  readonly submitted: number;
  readonly localSeats: readonly SeatId[];
  readonly transcript: readonly TranscriptFrame[];
}

type GatewayResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: SessionError };

function accepted<T>(value: T): ReadResult<T> {
  return { ok: true, value };
}

function refused<T>(message: string): ReadResult<T> {
  return { ok: false, message };
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural equality for values that have already crossed JSON. */
function sameWireValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameWireValue(value, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameWireValue(left[key], right[key]))
  );
}

export function isSeat(value: unknown): value is SeatId {
  return value === 0 || value === 1;
}

/**
 * An attack's defender: exactly one of a seat or an object the view shows.
 * The object arm is checked against the ids the position carries, so a
 * defender the table cannot draw is refused rather than staged blind.
 */
function isDefender(value: unknown, visible: ReadonlySet<string>): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 1) return false;
  if (keys[0] === 'seat') return isSeat(value['seat']);
  return keys[0] === 'oid' && typeof value['oid'] === 'string' && visible.has(value['oid']);
}

function isCardSelection(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => key === 'origin' || key === 'destination') &&
    PLAY_CARD_SELECTION_ZONES.includes(value['origin'] as (typeof PLAY_CARD_SELECTION_ZONES)[number]) &&
    PLAY_CARD_SELECTION_ZONES.includes(value['destination'] as (typeof PLAY_CARD_SELECTION_ZONES)[number])
  );
}

function isCardOrder(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => key === 'destination' || key === 'first') &&
    PLAY_CARD_SELECTION_ZONES.includes(value['destination'] as (typeof PLAY_CARD_SELECTION_ZONES)[number]) &&
    value['first'] === 'top'
  );
}

export function isSafeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readOrigin(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value['kind'] === 'printed') return true;
  return (
    value['kind'] === 'custom' &&
    typeof value['setCode'] === 'string' &&
    value['setCode'].length > 0 &&
    typeof value['cardId'] === 'string' &&
    value['cardId'].length > 0
  );
}

function readSlots(value: unknown, requireOrigin: boolean): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (slot) =>
        isRecord(slot) &&
        typeof slot['name'] === 'string' &&
        Number.isSafeInteger(slot['count']) &&
        (slot['count'] as number) > 0 &&
        (slot['origin'] === undefined ? !requireOrigin : readOrigin(slot['origin'])),
    )
  );
}

export function readDeck(value: unknown, requireOrigin: boolean): boolean {
  if (!isRecord(value) || typeof value['name'] !== 'string') return false;
  return (
    readSlots(value['cards'], requireOrigin) &&
    (value['sideboard'] === undefined || readSlots(value['sideboard'], requireOrigin)) &&
    (value['commanders'] === undefined || readSlots(value['commanders'], requireOrigin))
  );
}

export function isMatchRules(value: unknown): value is MatchRules {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => key === 'variant' || key === 'startingLife') &&
    (value['variant'] === 'standard' || value['variant'] === 'commander' || value['variant'] === 'momir') &&
    isSafeCount(value['startingLife']) &&
    value['startingLife'] > 0
  );
}

/** A content reference as the wire carries it; shared with the LAN seat's frame reader. */
export function readContent(value: unknown): value is ContentRef {
  if (!isRecord(value)) return false;
  return (
    (value['kind'] === 'dsl-set' && typeof value['setCode'] === 'string' && value['setCode'].length > 0) ||
    (value['kind'] === 'printed' && typeof value['format'] === 'string' && value['format'].length > 0) ||
    (value['kind'] === 'mixed' &&
      typeof value['format'] === 'string' &&
      value['format'].length > 0 &&
      Array.isArray(value['customSetCodes']) &&
      value['customSetCodes'].length > 0 &&
      value['customSetCodes'].every((code) => typeof code === 'string' && code.length > 0))
  );
}

function readTable(value: unknown): ReadResult<SessionSpec> {
  if (!isRecord(value) || !isRecord(value['content']))
    return refused('the session sent no content reference');
  const content = value['content'];
  if (!readContent(content)) return refused('the session sent an invalid content reference');
  if (!Array.isArray(value['seats']) || value['seats'].length < MIN_SEATS) {
    return refused(`the session did not send at least ${String(MIN_SEATS)} seats`);
  }
  const requireOrigin = content['kind'] === 'mixed';
  for (const seat of value['seats']) {
    if (
      !isRecord(seat) ||
      typeof seat['name'] !== 'string' ||
      (seat['controller'] !== 'local' && seat['controller'] !== 'engine') ||
      !readDeck(seat['deck'], requireOrigin)
    ) {
      return refused('the session sent an invalid seat');
    }
  }
  if (Object.hasOwn(value, 'rules') && !isMatchRules(value['rules'])) {
    return refused('the session sent invalid match rules');
  }
  if (value['seed'] !== null && typeof value['seed'] !== 'string') {
    return refused('the session sent an invalid seed');
  }
  if (
    value['maximumTurns'] !== null &&
    (!isSafeCount(value['maximumTurns']) || value['maximumTurns'] === 0)
  ) {
    return refused('the session sent an invalid turn limit');
  }
  return accepted(value as unknown as SessionSpec);
}

function readObject(value: unknown): ReadResult<ObjectView> {
  if (!isRecord(value)) return refused('the projection sent a non-object card');
  if (
    typeof value['oid'] !== 'string' ||
    value['oid'].length === 0 ||
    typeof value['name'] !== 'string' ||
    typeof value['typeLine'] !== 'string' ||
    (value['power'] !== null && !isFiniteNumber(value['power'])) ||
    (value['toughness'] !== null && !isFiniteNumber(value['toughness'])) ||
    typeof value['tapped'] !== 'boolean' ||
    typeof value['attacking'] !== 'boolean' ||
    !isSafeCount(value['damage']) ||
    !isSeat(value['controller']) ||
    !isRecord(value['counters'])
  ) {
    return refused('the projection sent an invalid object');
  }
  if (!Object.values(value['counters']).every(isSafeCount)) {
    return refused('the projection sent invalid counters');
  }
  if (Object.hasOwn(value, 'blockedBy')) {
    const blockedBy = value['blockedBy'];
    if (!Array.isArray(blockedBy) || !blockedBy.every((oid) => typeof oid === 'string' && oid.length > 0)) {
      return refused('the projection sent invalid blockers');
    }
  }
  if (Object.hasOwn(value, 'keywords')) {
    const keywords = value['keywords'];
    if (
      !Array.isArray(keywords) ||
      !keywords.every((keyword) => typeof keyword === 'string' && keyword.length > 0)
    ) {
      return refused('the projection sent invalid keywords');
    }
  }
  if (Object.hasOwn(value, 'pairedWith')) {
    const pairedWith = value['pairedWith'];
    if (typeof pairedWith !== 'string' || pairedWith.length === 0) {
      return refused('the projection sent an invalid pairing');
    }
  }
  if (Object.hasOwn(value, 'characteristics')) {
    const characteristics = value['characteristics'];
    if (
      !isRecord(characteristics) ||
      Object.keys(characteristics).some((key) => !['colors', 'manaCost', 'token'].includes(key)) ||
      !Array.isArray(characteristics['colors']) ||
      !characteristics['colors'].every((color) => ['W', 'U', 'B', 'R', 'G'].includes(color)) ||
      (characteristics['manaCost'] !== null &&
        (typeof characteristics['manaCost'] !== 'string' || characteristics['manaCost'].length === 0)) ||
      typeof characteristics['token'] !== 'boolean'
    )
      return refused('the projection sent invalid object characteristics');
  }
  return accepted(value as unknown as ObjectView);
}

function readObjects(value: unknown): ReadResult<readonly ObjectView[]> {
  if (!Array.isArray(value)) return refused('the projection sent no object list');
  const objects: ObjectView[] = [];
  for (const candidate of value) {
    const object = readObject(candidate);
    if (!object.ok) return object;
    objects.push(object.value);
  }
  return accepted(objects);
}

function readSeatView(value: unknown): ReadResult<SeatView> {
  if (
    !isRecord(value) ||
    !isSeat(value['id']) ||
    typeof value['name'] !== 'string' ||
    !isFiniteNumber(value['life']) ||
    !isSafeCount(value['handSize']) ||
    !isSafeCount(value['librarySize'])
  ) {
    return refused('the projection sent an invalid seat');
  }
  const hand =
    value['hand'] === null ? accepted<readonly ObjectView[] | null>(null) : readObjects(value['hand']);
  if (!hand.ok) return hand;
  const graveyard = readObjects(value['graveyard']);
  if (!graveyard.ok) return graveyard;
  const exile = readObjects(value['exile']);
  if (!exile.ok) return exile;
  const battlefield = readObjects(value['battlefield']);
  if (!battlefield.ok) return battlefield;
  const seat: SeatView = {
    id: value['id'],
    name: value['name'],
    life: value['life'],
    hand: hand.value,
    handSize: value['handSize'],
    librarySize: value['librarySize'],
    graveyard: graveyard.value,
    exile: exile.value,
    battlefield: battlefield.value,
  };
  // Optional on the projection, so carried when present and never invented:
  // an absent command zone is a backend that reports none, and a reader that
  // wrote one in would be telling the board something the backend did not say.
  const commandZone =
    value['commandZone'] === undefined ? accepted(undefined) : readObjects(value['commandZone']);
  if (!commandZone.ok) return commandZone;
  const avatars = value['avatars'] === undefined ? accepted(undefined) : readObjects(value['avatars']);
  if (!avatars.ok) return avatars;
  const commanderDamage = value['commanderDamage'];
  if (
    commanderDamage !== undefined &&
    (!isRecord(commanderDamage) || !Object.values(commanderDamage).every(isSafeCount))
  ) {
    return refused('the projection sent invalid commander damage');
  }
  const commanderCasts = value['commanderCasts'];
  if (
    commanderCasts !== undefined &&
    (!isRecord(commanderCasts) || !Object.values(commanderCasts).every(isSafeCount))
  ) {
    return refused('the projection sent invalid commander cast counts');
  }
  const poison = value['poison'];
  if (poison !== undefined && !isSafeCount(poison)) {
    return refused('the projection sent an invalid poison count');
  }
  const playerCounters = value['playerCounters'];
  if (
    playerCounters !== undefined &&
    (!isRecord(playerCounters) || !Object.values(playerCounters).every(isSafeCount))
  ) {
    return refused('the projection sent invalid player counters');
  }
  const libraryTop =
    value['libraryTop'] === undefined ? accepted(undefined) : readObjects(value['libraryTop']);
  if (!libraryTop.ok) return libraryTop;
  return accepted({
    ...seat,
    ...(poison === undefined ? {} : { poison }),
    ...(playerCounters === undefined ? {} : { playerCounters: playerCounters as Record<string, number> }),
    ...(libraryTop.value === undefined ? {} : { libraryTop: libraryTop.value }),
    ...(commandZone.value === undefined ? {} : { commandZone: commandZone.value }),
    ...(avatars.value === undefined ? {} : { avatars: avatars.value }),
    ...(commanderDamage === undefined ? {} : { commanderDamage: commanderDamage as Record<string, number> }),
    ...(commanderCasts === undefined ? {} : { commanderCasts: commanderCasts as Record<string, number> }),
  });
}

export function readTableView(value: unknown): ReadResult<TableView> {
  if (
    !isRecord(value) ||
    value['version'] !== PROJECTION_VERSION ||
    !isRecord(value['turn']) ||
    !isSafeCount(value['turn']['number']) ||
    !isSeat(value['turn']['active']) ||
    typeof value['turn']['phase'] !== 'string' ||
    typeof value['turn']['step'] !== 'string' ||
    (value['priority'] !== null && !isSeat(value['priority'])) ||
    !Array.isArray(value['seats']) ||
    value['seats'].length !== 2
  ) {
    return refused('the gateway sent an incompatible table projection');
  }
  const first = readSeatView(value['seats'][0]);
  if (!first.ok) return first;
  const second = readSeatView(value['seats'][1]);
  if (!second.ok) return second;
  if (first.value.id !== 0 || second.value.id !== 1) return refused('the projection seats are out of order');
  const stack = readObjects(value['stack']);
  if (!stack.ok) return stack;
  return accepted({
    version: PROJECTION_VERSION,
    turn: {
      number: value['turn']['number'],
      active: value['turn']['active'],
      phase: value['turn']['phase'],
      step: value['turn']['step'],
    },
    priority: value['priority'],
    stack: stack.value,
    seats: [first.value, second.value],
  });
}

export function readDecision(value: unknown): ReadResult<PendingDecision | null> {
  if (value === null) return accepted(null);
  if (
    !isRecord(value) ||
    !isSeat(value['seat']) ||
    typeof value['kind'] !== 'string' ||
    typeof value['prompt'] !== 'string' ||
    typeof value['complete'] !== 'boolean' ||
    !Array.isArray(value['options'])
  ) {
    return refused('the gateway sent an invalid pending decision');
  }
  const moveIds = new Set<string>();
  for (const option of value['options']) {
    if (
      !isRecord(option) ||
      typeof option['id'] !== 'string' ||
      option['id'].length === 0 ||
      typeof option['text'] !== 'string' ||
      !Array.isArray(option['targets']) ||
      !option['targets'].every(
        (target) =>
          isRecord(target) &&
          typeof target['oid'] === 'string' &&
          target['oid'].length > 0 &&
          typeof target['name'] === 'string',
      )
    ) {
      return refused('the gateway sent an invalid move option');
    }
    if (moveIds.has(option['id'])) return refused('the gateway sent duplicate move ids');
    moveIds.add(option['id']);
  }
  if (Object.hasOwn(value, 'input')) {
    const input = value['input'];
    if (
      !isRecord(input) ||
      input['kind'] !== 'text' ||
      typeof input['id'] !== 'string' ||
      input['id'].length === 0 ||
      typeof input['label'] !== 'string' ||
      !isSafeCount(input['minLength']) ||
      !isSafeCount(input['maxLength']) ||
      input['maxLength'] < input['minLength']
    ) {
      return refused('the gateway sent an invalid decision input');
    }
  }
  return accepted(value as unknown as PendingDecision);
}

export function readPlayInteraction(
  value: unknown,
  decision: PendingDecision | null,
  view: TableView,
): ReadResult<PlayInteraction | null> {
  if (value === null) return accepted(null);
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          'turnStep',
          'passPriority',
          'concede',
          'undo',
          'manaPools',
          'objectActions',
          'seatActions',
          'attackers',
          'cardSelection',
          'cardOrder',
          'combatDamage',
          'promptRole',
          'automatic',
        ].includes(key),
    ) ||
    (value['turnStep'] !== null &&
      !STANDARD_TURN_STEPS.includes(value['turnStep'] as (typeof STANDARD_TURN_STEPS)[number])) ||
    (value['passPriority'] !== null &&
      (typeof value['passPriority'] !== 'string' || value['passPriority'].length === 0)) ||
    (value['concede'] !== null && (typeof value['concede'] !== 'string' || value['concede'].length === 0)) ||
    (value['undo'] !== undefined &&
      value['undo'] !== null &&
      (typeof value['undo'] !== 'string' || value['undo'].length === 0)) ||
    (value['passPriority'] !== null && value['passPriority'] === value['concede']) ||
    !Array.isArray(value['objectActions']) ||
    (value['seatActions'] !== undefined && !Array.isArray(value['seatActions'])) ||
    (value['attackers'] !== undefined &&
      value['attackers'] !== null &&
      (!isRecord(value['attackers']) ||
        Object.keys(value['attackers']).some((key) => key !== 'confirm' && key !== 'staged') ||
        typeof value['attackers']['confirm'] !== 'string' ||
        value['attackers']['confirm'].length === 0 ||
        !Array.isArray(value['attackers']['staged']) ||
        !value['attackers']['staged'].every((oid) => typeof oid === 'string' && oid.length > 0))) ||
    (value['cardSelection'] !== undefined &&
      value['cardSelection'] !== null &&
      !isCardSelection(value['cardSelection'])) ||
    (value['cardOrder'] !== undefined && value['cardOrder'] !== null && !isCardOrder(value['cardOrder'])) ||
    (value['promptRole'] !== undefined &&
      value['promptRole'] !== null &&
      !PLAY_PROMPT_ROLES.includes(value['promptRole'] as (typeof PLAY_PROMPT_ROLES)[number])) ||
    (value['automatic'] !== undefined &&
      value['automatic'] !== null &&
      (!isRecord(value['automatic']) ||
        Object.keys(value['automatic']).some((key) => key !== 'move' && key !== 'reason') ||
        typeof value['automatic']['move'] !== 'string' ||
        value['automatic']['move'].length === 0 ||
        !PLAY_AUTOMATIC_MOVE_REASONS.includes(
          value['automatic']['reason'] as (typeof PLAY_AUTOMATIC_MOVE_REASONS)[number],
        )))
  ) {
    return refused('the gateway sent invalid play interaction roles');
  }
  const offered = new Set(decision?.options.map((option) => option.id) ?? []);
  const automatic = value['automatic'];
  const manaPools = value['manaPools'];
  const validManaPool = (pool: unknown): boolean =>
    isRecord(pool) &&
    Object.keys(pool).length === PLAY_MANA_OUTPUTS.length &&
    PLAY_MANA_OUTPUTS.every((symbol) => isSafeCount(pool[symbol]));
  if (
    (value['passPriority'] !== null && !offered.has(value['passPriority'])) ||
    (value['concede'] !== null && !offered.has(value['concede'])) ||
    (value['undo'] !== undefined && value['undo'] !== null && !offered.has(value['undo'])) ||
    (manaPools !== undefined &&
      (!Array.isArray(manaPools) ||
        manaPools.length !== 2 ||
        !manaPools.every((pool) => validManaPool(pool)))) ||
    (isRecord(automatic) &&
      (!offered.has(automatic['move'] as string) ||
        automatic['move'] === value['passPriority'] ||
        automatic['move'] === value['concede']))
  ) {
    return refused('the gateway declared a play interaction role that is not offered');
  }
  const visible = new Set([
    ...view.stack.map((object) => object.oid),
    ...view.seats.flatMap((seat) =>
      [
        ...(seat.hand ?? []),
        ...(seat.commandZone ?? []),
        ...(seat.avatars ?? []),
        ...(seat.libraryTop ?? []),
        ...seat.battlefield,
        ...seat.graveyard,
        ...seat.exile,
      ].map((object) => object.oid),
    ),
  ]);
  const pairs = new Set<string>();
  for (const action of value['objectActions']) {
    if (
      !isRecord(action) ||
      Object.keys(action).some(
        (key) =>
          key !== 'oid' && key !== 'move' && key !== 'category' && key !== 'manaOutput' && key !== 'defender',
      ) ||
      typeof action['oid'] !== 'string' ||
      action['oid'].length === 0 ||
      typeof action['move'] !== 'string' ||
      action['move'].length === 0 ||
      (action['category'] !== undefined &&
        !PLAY_OBJECT_ACTION_CATEGORIES.includes(
          action['category'] as (typeof PLAY_OBJECT_ACTION_CATEGORIES)[number],
        )) ||
      (action['manaOutput'] !== undefined &&
        !PLAY_MANA_OUTPUTS.includes(action['manaOutput'] as (typeof PLAY_MANA_OUTPUTS)[number])) ||
      (action['manaOutput'] !== undefined && action['category'] !== 'mana') ||
      (action['defender'] !== undefined &&
        (action['category'] !== 'combat' || !isDefender(action['defender'], visible))) ||
      !visible.has(action['oid']) ||
      !offered.has(action['move']) ||
      action['move'] === value['passPriority'] ||
      action['move'] === value['concede']
    ) {
      return refused('the gateway sent an invalid object action role');
    }
    const pair = `${action['oid']}\u0000${action['move']}`;
    if (pairs.has(pair)) return refused('the gateway sent a duplicate object action role');
    pairs.add(pair);
  }
  const seatPairs = new Set<string>();
  const seatActions = value['seatActions'] ?? [];
  for (const action of seatActions) {
    if (
      !isRecord(action) ||
      Object.keys(action).some((key) => key !== 'seat' && key !== 'move') ||
      !isSeat(action['seat']) ||
      typeof action['move'] !== 'string' ||
      action['move'].length === 0 ||
      !offered.has(action['move']) ||
      action['move'] === value['passPriority'] ||
      action['move'] === value['concede']
    ) {
      return refused('the gateway sent an invalid seat action role');
    }
    const pair = `${String(action['seat'])}\u0000${action['move']}`;
    if (seatPairs.has(pair)) return refused('the gateway sent a duplicate seat action role');
    seatPairs.add(pair);
  }
  const attackers = value['attackers'];
  if (isRecord(attackers)) {
    const confirm = attackers['confirm'] as string;
    const staged = attackers['staged'] as readonly string[];
    const combatOids = new Set(
      (value['objectActions'] as readonly Readonly<Record<string, unknown>>[])
        .filter((action) => action['category'] === 'combat')
        .map((action) => action['oid'] as string),
    );
    if (
      value['turnStep'] !== 'declareAttackers' ||
      !offered.has(confirm) ||
      confirm === value['passPriority'] ||
      confirm === value['concede'] ||
      new Set(staged).size !== staged.length ||
      staged.some((oid) => !combatOids.has(oid))
    ) {
      return refused('the gateway sent invalid attacker interaction roles');
    }
  }
  const combatDamage = value['combatDamage'];
  if (combatDamage !== undefined && combatDamage !== null) {
    if (
      !isRecord(combatDamage) ||
      Object.keys(combatDamage).some(
        (key) =>
          key !== 'inputId' &&
          key !== 'source' &&
          key !== 'total' &&
          key !== 'canDefer' &&
          key !== 'recipients' &&
          key !== 'defaultAmounts',
      ) ||
      typeof combatDamage['inputId'] !== 'string' ||
      decision?.input?.id !== combatDamage['inputId'] ||
      !isRecord(combatDamage['source']) ||
      typeof combatDamage['source']['oid'] !== 'string' ||
      !visible.has(combatDamage['source']['oid']) ||
      typeof combatDamage['source']['name'] !== 'string' ||
      !Number.isSafeInteger(combatDamage['source']['power']) ||
      !isSafeCount(combatDamage['total']) ||
      typeof combatDamage['canDefer'] !== 'boolean' ||
      !Array.isArray(combatDamage['recipients']) ||
      combatDamage['recipients'].length === 0 ||
      !Array.isArray(combatDamage['defaultAmounts']) ||
      combatDamage['defaultAmounts'].length !== combatDamage['recipients'].length ||
      !combatDamage['defaultAmounts'].every((amount) => isSafeCount(amount)) ||
      combatDamage['defaultAmounts'].reduce((total, amount) => total + amount, 0) !== combatDamage['total'] ||
      !combatDamage['recipients'].every(
        (recipient) =>
          isRecord(recipient) &&
          Object.keys(recipient).every((key) =>
            ['oid', 'name', 'kind', 'toughness', 'damage', 'lethal'].includes(key),
          ) &&
          typeof recipient['oid'] === 'string' &&
          typeof recipient['name'] === 'string' &&
          (recipient['kind'] === 'blocker' || recipient['kind'] === 'defender') &&
          (recipient['kind'] === 'defender' || visible.has(recipient['oid'])) &&
          (recipient['toughness'] === null || Number.isSafeInteger(recipient['toughness'])) &&
          isSafeCount(recipient['damage']) &&
          isSafeCount(recipient['lethal']),
      )
    ) {
      return refused('the gateway sent invalid combat damage interaction roles');
    }
  }
  return accepted({ ...(value as unknown as PlayInteraction), seatActions });
}

export function readEvents(value: unknown): ReadResult<readonly EngineEvent[]> {
  if (!Array.isArray(value)) return refused('the gateway sent no event log');
  for (const [index, event] of value.entries()) {
    if (
      !isRecord(event) ||
      event['seq'] !== index ||
      typeof event['type'] !== 'string' ||
      typeof event['text'] !== 'string' ||
      !Object.hasOwn(event, 'detail') ||
      !Array.isArray(event['reveals'])
    ) {
      return refused('the gateway sent an invalid event log');
    }
    for (const reveal of event['reveals']) {
      if (
        !isRecord(reveal) ||
        typeof reveal['oid'] !== 'string' ||
        reveal['oid'].length === 0 ||
        !Array.isArray(reveal['seats']) ||
        !reveal['seats'].every(isSeat)
      ) {
        return refused('the gateway sent an invalid reveal');
      }
    }
  }
  return accepted(value as readonly EngineEvent[]);
}

export function readResult(value: unknown): ReadResult<MatchResult | null> {
  if (value === null) return accepted(null);
  if (
    !isRecord(value) ||
    (value['winner'] !== null && !isSeat(value['winner'])) ||
    typeof value['reason'] !== 'string' ||
    !isSafeCount(value['endedOnTurn'])
  ) {
    return refused('the gateway sent an invalid match result');
  }
  return accepted(value as unknown as MatchResult);
}

function readTranscript(value: unknown): ReadResult<readonly TranscriptFrame[]> {
  if (!Array.isArray(value)) return refused('the gateway sent no observed transcript');
  const frames: TranscriptFrame[] = [];
  for (const [index, frame] of value.entries()) {
    if (
      !isRecord(frame) ||
      frame['seq'] !== index ||
      (frame['move'] !== null && typeof frame['move'] !== 'string')
    ) {
      return refused('the gateway sent an invalid transcript frame');
    }
    const view = readTableView(frame['view']);
    if (!view.ok) return view;
    const events = readEvents(frame['events']);
    if (!events.ok) return events;
    frames.push({ seq: index, view: view.value, events: events.value, move: frame['move'] });
  }
  return accepted(frames);
}

function readObserved(value: unknown, expectedBackend: string): ReadResult<ObservedSnapshot> {
  if (
    !isRecord(value) ||
    value['determinism'] !== 'observed' ||
    value['backend'] !== expectedBackend ||
    (value['status'] !== 'awaiting' && value['status'] !== 'finished' && value['status'] !== 'closed') ||
    !isSafeCount(value['submitted']) ||
    !Array.isArray(value['localSeats']) ||
    !value['localSeats'].every(isSeat)
  ) {
    return refused('the gateway sent no valid observed session');
  }
  const table = readTable(value['table']);
  if (!table.ok) return table;
  const expectedLocalSeats = table.value.seats
    .map((seat, index) => (seat.controller === 'local' ? (index as SeatId) : null))
    .filter((seat): seat is SeatId => seat !== null);
  if (
    value['localSeats'].length !== expectedLocalSeats.length ||
    !value['localSeats'].every((seat, index) => seat === expectedLocalSeats[index])
  ) {
    return refused('the observed local seats do not match the table controllers');
  }
  const view = readTableView(value['view']);
  if (!view.ok) return view;
  const events = readEvents(value['events']);
  if (!events.ok) return events;
  const decision = readDecision(value['decision']);
  if (!decision.ok) return decision;
  const play = readPlayInteraction(value['play'], decision.value, view.value);
  if (!play.ok) return play;
  const result = readResult(value['result']);
  if (!result.ok) return result;
  const transcript = readTranscript(value['transcript']);
  if (!transcript.ok) return transcript;
  if (
    transcript.value.length !== value['submitted'] + 1 ||
    transcript.value.at(-1)?.seq !== value['submitted']
  ) {
    return refused('the observed transcript does not match the submitted move count');
  }
  const currentFrame = transcript.value.at(-1);
  if (
    currentFrame === undefined ||
    !sameWireValue(currentFrame.view, view.value) ||
    !sameWireValue(currentFrame.events, events.value)
  ) {
    return refused('the observed transcript does not end at the current snapshot');
  }
  if (value['status'] === 'awaiting' && (decision.value === null || result.value !== null)) {
    return refused('the awaiting session has no decision or already has a result');
  }
  if (value['status'] === 'finished' && (decision.value !== null || result.value === null)) {
    return refused('the finished session has no result or still has a decision');
  }
  if (value['status'] === 'closed' && (decision.value !== null || result.value !== null)) {
    return refused('the closed session still has a decision or result');
  }
  return accepted({
    backend: value['backend'],
    table: table.value,
    status: value['status'],
    view: view.value,
    events: events.value,
    decision: decision.value,
    play: play.value,
    result: result.value,
    submitted: value['submitted'],
    localSeats: [...value['localSeats']],
    transcript: transcript.value,
  });
}

function readSessionError(value: unknown): SessionError | null {
  if (!isRecord(value) || typeof value['kind'] !== 'string' || typeof value['message'] !== 'string')
    return null;
  switch (value['kind']) {
    case 'no-decision-pending':
    case 'illegal-move':
    case 'backend-failure':
      return { kind: value['kind'], message: value['message'] };
    case 'unknown-move':
      return isSafeCount(value['offered'])
        ? { kind: 'unknown-move', message: value['message'], offered: value['offered'] }
        : null;
    case 'content-unresolved':
      return Array.isArray(value['unresolved']) &&
        value['unresolved'].every((item) => typeof item === 'string')
        ? { kind: 'content-unresolved', message: value['message'], unresolved: value['unresolved'] }
        : null;
    case 'content-unsupported':
      return typeof value['backend'] === 'string' &&
        value['backend'].length > 0 &&
        Array.isArray(value['reasons']) &&
        value['reasons'].length > 0 &&
        value['reasons'].every((item) => typeof item === 'string' && item.length > 0)
        ? {
            kind: 'content-unsupported',
            backend: value['backend'],
            reasons: [...value['reasons']],
            message: value['message'],
          }
        : null;
    case 'unsupported':
      return typeof value['capability'] === 'string'
        ? { kind: 'unsupported', message: value['message'], capability: value['capability'] }
        : null;
    case 'timeout':
      return isSafeCount(value['millis'])
        ? { kind: 'timeout', message: value['message'], millis: value['millis'] }
        : null;
    default:
      return null;
  }
}

function readEnvelope(body: unknown, expectedBackend: string): GatewayResult<GatewaySnapshot> {
  if (!isRecord(body)) {
    return {
      ok: false,
      error: { kind: 'backend-failure', message: 'gateway did not answer with an object' },
    };
  }
  if (body['protocol'] !== BROWSER_BACKEND_PROTOCOL) {
    return {
      ok: false,
      error: {
        kind: 'backend-failure',
        message: `gateway protocol ${JSON.stringify(body['protocol'])} is not ${String(BROWSER_BACKEND_PROTOCOL)}`,
      },
    };
  }
  if (body['ok'] === false) {
    const error = body['error'];
    if (!isRecord(error) || typeof error['code'] !== 'string' || typeof error['message'] !== 'string') {
      return { ok: false, error: { kind: 'backend-failure', message: 'gateway sent an invalid refusal' } };
    }
    const sessionError = readSessionError(error['sessionError']);
    return {
      ok: false,
      error:
        sessionError ??
        ({ kind: 'backend-failure', message: `${error['code']}: ${error['message']}` } as const),
    };
  }
  if (
    body['ok'] !== true ||
    typeof body['token'] !== 'string' ||
    body['token'].length === 0 ||
    !isSafeCount(body['revision'])
  ) {
    return {
      ok: false,
      error: { kind: 'backend-failure', message: 'gateway sent an invalid session envelope' },
    };
  }
  const session = readObserved(body['session'], expectedBackend);
  if (!session.ok) return { ok: false, error: { kind: 'backend-failure', message: session.message } };
  if (body['revision'] !== session.value.submitted) {
    return {
      ok: false,
      error: { kind: 'backend-failure', message: 'gateway revision does not match submitted moves' },
    };
  }
  return { ok: true, value: { token: body['token'], revision: body['revision'], session: session.value } };
}

function requestFailure(cause: unknown): SessionError {
  return {
    kind: 'backend-failure',
    message: `gateway request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
  };
}

async function requestJson(
  request: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
): Promise<GatewayResult<unknown>> {
  try {
    const response = await request(url, init);
    const body = (await response.json()) as unknown;
    return { ok: true, value: body };
  } catch (cause) {
    return { ok: false, error: requestFailure(cause) };
  }
}

interface RemoteHandle {
  readonly close: () => Promise<void>;
}

function remoteHandle(request: typeof globalThis.fetch, baseUrl: string, token: string): RemoteHandle {
  let closing: Promise<void> | null = null;
  return {
    close: (): Promise<void> => {
      if (closing !== null) return closing;
      closing = (async (): Promise<void> => {
        const received = await requestJson(request, `${baseUrl}/sessions/${encodeURIComponent(token)}`, {
          method: 'DELETE',
          keepalive: true,
        });
        if (!received.ok) throw new Error(received.error.message);
        const body = received.value;
        if (
          !isRecord(body) ||
          body['protocol'] !== BROWSER_BACKEND_PROTOCOL ||
          body['ok'] !== true ||
          body['closed'] !== true
        ) {
          throw new Error('gateway sent an invalid close acknowledgment');
        }
      })();
      return closing;
    },
  };
}

function sessionOf(
  snapshot: GatewaySnapshot,
  handle: RemoteHandle,
  request: typeof globalThis.fetch,
  baseUrl: string,
  expectedBackend: string,
): ObservedSession {
  const source = snapshot.session;
  const submit = async (move: MoveId): Promise<SubmitResult<ObservedSession>> => {
    if (source.status !== 'awaiting' || source.decision === null) {
      return {
        ok: false,
        error: { kind: 'no-decision-pending', message: 'the observed session has no pending decision' },
      };
    }
    if (!source.decision.options.some((option) => option.id === move)) {
      return {
        ok: false,
        error: {
          kind: 'unknown-move',
          message: `${JSON.stringify(move)} is not one of the moves offered`,
          offered: source.decision.options.length,
        },
      };
    }
    const received = await requestJson(request, `${baseUrl}/sessions/${encodeURIComponent(snapshot.token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocol: BROWSER_BACKEND_PROTOCOL, revision: snapshot.revision, move }),
    });
    if (!received.ok) return received;
    const next = readEnvelope(received.value, expectedBackend);
    if (!next.ok) return next;
    if (next.value.token !== snapshot.token) {
      return {
        ok: false,
        error: { kind: 'backend-failure', message: 'gateway changed the session capability after submit' },
      };
    }
    return { ok: true, session: sessionOf(next.value, handle, request, baseUrl, expectedBackend) };
  };
  return {
    backend: source.backend,
    determinism: 'observed',
    table: source.table,
    status: source.status,
    view: source.view,
    events: source.events,
    decision: source.decision,
    ...(source.play === null ? {} : { play: source.play }),
    seats: null,
    result: source.result,
    submitted: source.submitted,
    localSeats: source.localSeats,
    transcript: source.transcript,
    submit,
    close: handle.close,
  };
}

/** Builds an observed backend whose rules process stays behind the Vite proxy. */
export function httpObservedBackend(options: HttpObservedBackendOptions): ObservedBackend {
  if (options.id.length === 0) throw new Error('an HTTP observed backend needs an expected backend id');
  const request = options.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = (options.baseUrl ?? '/engine-api').replace(/\/$/, '');
  return {
    id: options.id,
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    // Selection and the authoritative support probe happen inside the gateway.
    supports: (): Promise<readonly string[]> => Promise.resolve([]),
    open: async (table: SessionSpec): Promise<OpenResult<ObservedSession>> => {
      const received = await requestJson(request, `${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ protocol: BROWSER_BACKEND_PROTOCOL, table }),
      });
      if (!received.ok) return received;
      const snapshot = readEnvelope(received.value, options.id);
      if (!snapshot.ok) return snapshot;
      const handle = remoteHandle(request, baseUrl, snapshot.value.token);
      return {
        ok: true,
        session: sessionOf(snapshot.value, handle, request, baseUrl, options.id),
      };
    },
  };
}
