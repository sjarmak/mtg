/**
 * Reading a replay event log.
 *
 * The file is a boundary, so nothing here trusts it: every line is schema-
 * checked, the record order is checked, and every object id a snapshot mentions
 * must exist in the game's object table whose card must exist in its card
 * dictionary. That last check is what lets the viewer render a name for every
 * id without a fallback branch — if the log is readable at all, it is complete.
 *
 * Carry-forward snapshots are resolved here rather than in the components, so
 * a `ReplayStep` always holds a full board and stepping backwards is an array
 * index, not a re-fold.
 */
import type { ZodType } from 'zod';
import type { Card } from '@mtg/dsl';
import {
  GameRecordSchema,
  HeaderRecordSchema,
  StepRecordSchema,
  type GameRecord,
  type HeaderRecord,
  type LogAction,
  type LogDecision,
  type LogEvent,
  type LogPlayerId,
  type LogResult,
  type LogSnapshot,
  type LogStep,
  type StepRecord,
} from './log-schema';

export class EventLogError extends Error {
  readonly line: number;

  constructor(line: number, message: string) {
    super(`replay log line ${line}: ${message}`);
    this.name = 'EventLogError';
    this.line = line;
  }
}

export interface ReplaySeat {
  readonly bot: string;
  readonly deck: string;
}

export interface ReplayObject {
  readonly oid: string;
  readonly card: Card;
  readonly owner: LogPlayerId;
  readonly token: boolean;
}

/** One decision and everything it produced, with a fully resolved board. */
export interface ReplayStep {
  readonly seq: number;
  readonly turn: number;
  readonly step: LogStep;
  readonly active: LogPlayerId;
  readonly decision: LogDecision | null;
  readonly action: LogAction | null;
  readonly events: readonly LogEvent[];
  readonly state: LogSnapshot;
}

export interface ReplayGameLog {
  readonly index: number;
  readonly seed: string;
  readonly startingPlayer: LogPlayerId;
  readonly maximumTurns: number;
  readonly seats: readonly [ReplaySeat, ReplaySeat];
  readonly result: LogResult;
  readonly objects: ReadonlyMap<string, ReplayObject>;
  readonly steps: readonly ReplayStep[];
}

export interface EventLog {
  readonly source: string;
  readonly games: readonly ReplayGameLog[];
}

interface RawLine {
  readonly line: number;
  readonly value: unknown;
}

function parseLines(text: string): readonly RawLine[] {
  const out: RawLine[] = [];
  const lines = text.split('\n');
  for (const [index, raw] of lines.entries()) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const line = index + 1;
    try {
      out.push({ line, value: JSON.parse(trimmed) });
    } catch (error) {
      throw new EventLogError(line, `not JSON (${error instanceof Error ? error.message : 'unknown'})`);
    }
  }
  return out;
}

function recordKindOf(value: unknown, line: number): string {
  if (typeof value !== 'object' || value === null) throw new EventLogError(line, 'record is not an object');
  const kind = (value as { record?: unknown }).record;
  if (typeof kind !== 'string') throw new EventLogError(line, 'record has no `record` discriminator');
  return kind;
}

function parseWith<T>(schema: ZodType<T>, raw: RawLine, what: string): T {
  const parsed = schema.safeParse(raw.value);
  if (parsed.success) return parsed.data;
  throw new EventLogError(raw.line, `invalid ${what} record: ${parsed.error.message}`);
}

function buildObjects(record: GameRecord, line: number): ReadonlyMap<string, ReplayObject> {
  const objects = new Map<string, ReplayObject>();
  for (const [oid, entry] of Object.entries(record.objects)) {
    const card = record.cards[entry.card];
    if (card === undefined) {
      throw new EventLogError(line, `object ${oid} names card "${entry.card}", which the log does not carry`);
    }
    objects.set(oid, { oid, card, owner: entry.owner, token: entry.token });
  }
  return objects;
}

function checkSnapshotIds(
  snapshot: LogSnapshot,
  objects: ReadonlyMap<string, ReplayObject>,
  line: number,
): void {
  const seen: string[] = [
    ...snapshot.battlefield.map((permanent) => permanent.oid),
    ...snapshot.battlefield.flatMap((permanent) =>
      permanent.attachedTo === null ? [] : [permanent.attachedTo],
    ),
    ...snapshot.exile,
    // An activated ability on the stack is an object with no card (CR 113.7a)
    // and its `ab<n>` id is in no object table, so what has to resolve for the
    // entry to be drawable is the permanent it was printed on. A spell carries
    // no source and is checked by its own id, which is a real object.
    ...snapshot.stack.map((entry) => entry.card),
    ...snapshot.stack.flatMap((entry) =>
      entry.triggerContext === null ? [] : [entry.triggerContext.triggeringCreature],
    ),
    ...snapshot.seats.flatMap((seat) => [...seat.hand, ...seat.graveyard]),
  ];
  for (const oid of seen) {
    if (!objects.has(oid)) throw new EventLogError(line, `snapshot names unknown object ${oid}`);
  }
}

function checkSnapshotSemantics(
  snapshot: LogSnapshot,
  objects: ReadonlyMap<string, ReplayObject>,
  version: EventLogSchemaVersion,
  line: number,
): void {
  for (const permanent of snapshot.battlefield) {
    const object = objects.get(permanent.oid);
    if (object === undefined) continue;
    const planeswalker = object.card.kind === 'planeswalker';
    if (version === 'mtg-ui/event-log/3' || version === 'mtg-ui/event-log/4') {
      if (planeswalker) {
        throw new EventLogError(line, `${version} cannot carry battlefield planeswalker ${permanent.oid}`);
      }
    }
    if (
      version !== 'mtg-ui/event-log/3' &&
      version !== 'mtg-ui/event-log/4' &&
      planeswalker &&
      permanent.loyalty === undefined
    ) {
      throw new EventLogError(line, `planeswalker ${permanent.oid} is missing loyalty`);
    }
    if (!planeswalker && permanent.loyalty !== undefined) {
      throw new EventLogError(line, `nonplaneswalker ${permanent.oid} carries loyalty`);
    }
  }
}

function checkTaggedDefenders(
  record: StepRecord,
  snapshot: LogSnapshot,
  objects: ReadonlyMap<string, ReplayObject>,
  line: number,
): void {
  const claims: { readonly oid: string; readonly attacker: LogPlayerId }[] = [];
  const actions = [record.action, ...(record.decision?.options ?? [])];
  for (const action of actions) {
    if (action?.type !== 'declareAttackers') continue;
    for (const attack of action.attackers) {
      if (typeof attack.defender === 'object') {
        claims.push({ oid: attack.defender.oid, attacker: action.player });
      }
    }
  }
  for (const event of record.events) {
    if (event.type !== 'attackersDeclared') continue;
    for (const attack of event.attacks) {
      if (typeof attack.defender === 'object') {
        claims.push({ oid: attack.defender.oid, attacker: event.player });
      }
    }
  }

  for (const claim of claims) {
    const object = objects.get(claim.oid);
    if (object === undefined) {
      throw new EventLogError(line, `unknown planeswalker defender ${claim.oid}`);
    }
    if (object.card.kind !== 'planeswalker') {
      throw new EventLogError(line, `defender ${claim.oid} is not a planeswalker`);
    }
    const permanent = snapshot.battlefield.find((candidate) => candidate.oid === claim.oid);
    if (permanent === undefined) {
      throw new EventLogError(line, `planeswalker defender ${claim.oid} is not on the battlefield`);
    }
    if (permanent.controller === claim.attacker) {
      throw new EventLogError(line, `planeswalker defender ${claim.oid} is controlled by its attacker`);
    }
  }
}

interface GameBuild {
  readonly record: GameRecord;
  readonly line: number;
  readonly objects: ReadonlyMap<string, ReplayObject>;
  readonly steps: ReplayStep[];
  previous: LogSnapshot | null;
}

type EventLogSchemaVersion = HeaderRecord['schema'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function stepHasTaggedDefender(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(stepHasTaggedDefender);
  if (!isRecord(value)) return false;
  const defender = value.defender;
  if (isRecord(defender) && defender.kind === 'planeswalker') return true;
  return Object.values(value).some(stepHasTaggedDefender);
}

function stepHasBattlefieldLoyalty(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const state = value.state;
  if (!isRecord(state) || !Array.isArray(state.battlefield)) return false;
  return state.battlefield.some((permanent) => isRecord(permanent) && hasOwn(permanent, 'loyalty'));
}

function stepHasTriggerContext(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const state = value.state;
  if (!isRecord(state) || !Array.isArray(state.stack)) return false;
  return state.stack.some((entry) => isRecord(entry) && hasOwn(entry, 'triggerContext'));
}

function stepHasSourceCharacteristics(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const state = value.state;
  if (!isRecord(state) || !Array.isArray(state.stack)) return false;
  return state.stack.some((entry) => isRecord(entry) && hasOwn(entry, 'sourceCharacteristics'));
}

function stepHasRegenerationEventEvidence(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.events)) return false;
  return value.events.some(
    (event) =>
      isRecord(event) &&
      (event.type === 'permanentRegenerated' ||
        (event.type === 'replacementApplied' && event.event === 'destroy')),
  );
}

function stepHasScryAction(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (isRecord(value.action) && value.action.type === 'scry') return true;
  const decision = value.decision;
  return (
    isRecord(decision) &&
    Array.isArray(decision.options) &&
    decision.options.some((option) => isRecord(option) && option.type === 'scry')
  );
}

function stepHasScryEvent(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.events)) return false;
  return value.events.some((event) => isRecord(event) && event.type === 'cardsScried');
}

function stepHasScryDecision(value: unknown): boolean {
  return isRecord(value) && isRecord(value.decision) && value.decision.kind === 'scry';
}

function assertVersionedStep(version: EventLogSchemaVersion, value: unknown, line: number): void {
  if (version !== 'mtg-ui/event-log/8') {
    if (stepHasScryAction(value)) {
      throw new EventLogError(line, `${version} cannot contain scry action evidence`);
    }
    if (stepHasScryEvent(value)) {
      throw new EventLogError(line, `${version} cannot contain scry event evidence`);
    }
    if (stepHasScryDecision(value)) {
      throw new EventLogError(line, `${version} cannot contain scry decision evidence`);
    }
  }
  if (version === 'mtg-ui/event-log/8') return;
  if (version !== 'mtg-ui/event-log/7' && stepHasRegenerationEventEvidence(value)) {
    throw new EventLogError(line, `${version} cannot contain /7 regeneration event evidence`);
  }
  if (version !== 'mtg-ui/event-log/7' && stepHasSourceCharacteristics(value)) {
    throw new EventLogError(line, `${version} cannot contain /7 source-characteristic evidence`);
  }
  if (version !== 'mtg-ui/event-log/6' && version !== 'mtg-ui/event-log/7' && stepHasTriggerContext(value)) {
    throw new EventLogError(line, `${version} cannot contain /6 retained trigger context`);
  }
  if (
    (version === 'mtg-ui/event-log/3' || version === 'mtg-ui/event-log/4') &&
    stepHasTaggedDefender(value)
  ) {
    throw new EventLogError(line, `${version} cannot contain a planeswalker defender`);
  }
  if (
    (version === 'mtg-ui/event-log/3' || version === 'mtg-ui/event-log/4') &&
    stepHasBattlefieldLoyalty(value)
  ) {
    throw new EventLogError(line, `${version} cannot contain battlefield loyalty`);
  }
  if (version !== 'mtg-ui/event-log/3' || !isRecord(value)) return;

  const events = value.events;
  if (Array.isArray(events)) {
    for (const event of events) {
      if (!isRecord(event)) continue;
      if (event.type === 'spellCopied' || (event.type === 'spellCast' && hasOwn(event, 'chosenX'))) {
        throw new EventLogError(line, `${version} cannot contain copied-spell or chosen-X evidence`);
      }
    }
  }
  for (const action of [
    value.action,
    ...(isRecord(value.decision) && Array.isArray(value.decision.options) ? value.decision.options : []),
  ]) {
    if (isRecord(action) && action.type === 'castSpell' && hasOwn(action, 'chosenX')) {
      throw new EventLogError(line, `${version} cannot contain chosen-X cast evidence`);
    }
  }
  const state = value.state;
  if (!isRecord(state) || !Array.isArray(state.stack)) return;
  for (const entry of state.stack) {
    if (
      isRecord(entry) &&
      (hasOwn(entry, 'card') || hasOwn(entry, 'copiedFrom') || hasOwn(entry, 'chosenX'))
    ) {
      throw new EventLogError(line, `${version} cannot contain /4 stack identity fields`);
    }
  }
}

/** Upgrade released stack shapes to the current `/8` semantic union. */
function migrateStep(version: EventLogSchemaVersion, value: unknown): unknown {
  if (version === 'mtg-ui/event-log/8' || !isRecord(value)) return value;
  const migrated = structuredClone(value);
  if (version === 'mtg-ui/event-log/3') {
    const events = migrated.events;
    if (Array.isArray(events)) {
      for (const event of events) {
        if (isRecord(event) && event.type === 'spellCast') event.chosenX = null;
      }
    }
  }
  const state = migrated.state;
  if (!isRecord(state) || !Array.isArray(state.stack)) return migrated;
  for (const entry of state.stack) {
    if (!isRecord(entry)) continue;
    if (version === 'mtg-ui/event-log/3') {
      if (typeof entry.oid === 'string' && (entry.source === null || typeof entry.source === 'string')) {
        entry.card = entry.source ?? entry.oid;
      }
      entry.copiedFrom = null;
      entry.chosenX = null;
    }
    if (version !== 'mtg-ui/event-log/6' && version !== 'mtg-ui/event-log/7') {
      entry.triggerContext = null;
    }
    if (version !== 'mtg-ui/event-log/7') entry.sourceCharacteristics = null;
  }
  return migrated;
}

function startGame(raw: RawLine): GameBuild {
  const record = parseWith(GameRecordSchema, raw, 'game');
  return {
    record,
    line: raw.line,
    objects: buildObjects(record, raw.line),
    steps: [],
    previous: null,
  };
}

function addStep(build: GameBuild, raw: RawLine, version: EventLogSchemaVersion): void {
  assertVersionedStep(version, raw.value, raw.line);
  const record: StepRecord = parseWith(
    StepRecordSchema,
    { ...raw, value: migrateStep(version, raw.value) },
    'step',
  );
  if (record.game !== build.record.game) {
    throw new EventLogError(raw.line, `step belongs to game ${record.game}, not ${build.record.game}`);
  }
  if (record.seq !== build.steps.length) {
    throw new EventLogError(raw.line, `step seq ${record.seq} out of order (expected ${build.steps.length})`);
  }
  const state = record.state ?? build.previous;
  if (state === null) {
    throw new EventLogError(raw.line, 'first step of a game must carry a board snapshot');
  }
  if (record.state !== null) checkSnapshotIds(record.state, build.objects, raw.line);
  checkSnapshotSemantics(state, build.objects, version, raw.line);
  checkTaggedDefenders(record, state, build.objects, raw.line);
  build.previous = state;
  build.steps.push({
    seq: record.seq,
    turn: record.turn,
    step: record.step,
    active: record.active,
    decision: record.decision,
    action: record.action,
    events: record.events,
    state,
  });
}

function finishGame(build: GameBuild): ReplayGameLog {
  if (build.steps.length !== build.record.steps) {
    throw new EventLogError(
      build.line,
      `game declares ${build.record.steps} steps but ${build.steps.length} follow it`,
    );
  }
  const [first, second] = build.record.seats;
  return {
    index: build.record.game,
    seed: build.record.seed,
    startingPlayer: build.record.startingPlayer,
    maximumTurns: build.record.maximumTurns,
    seats: [first, second],
    result: build.record.result,
    objects: build.objects,
    steps: build.steps,
  };
}

/** Parses a whole replay event log. Throws `EventLogError` on anything unsound. */
export function readEventLog(text: string): EventLog {
  const lines = parseLines(text);
  const first = lines[0];
  if (first === undefined) throw new EventLogError(1, 'the log is empty');
  const header = parseWith(HeaderRecordSchema, first, 'header');

  const games: ReplayGameLog[] = [];
  let build: GameBuild | null = null;
  for (const raw of lines.slice(1)) {
    const kind = recordKindOf(raw.value, raw.line);
    switch (kind) {
      case 'header':
        throw new EventLogError(raw.line, 'a second header record');
      case 'game':
        if (build !== null) games.push(finishGame(build));
        build = startGame(raw);
        break;
      case 'step':
        if (build === null) throw new EventLogError(raw.line, 'a step record before any game record');
        addStep(build, raw, header.schema);
        break;
      default:
        throw new EventLogError(raw.line, `unknown record kind "${kind}"`);
    }
  }
  if (build !== null) games.push(finishGame(build));

  if (games.length !== header.games) {
    throw new EventLogError(first.line, `header declares ${header.games} games but ${games.length} follow`);
  }
  for (const [index, game] of games.entries()) {
    if (game.index !== index) {
      throw new EventLogError(first.line, `game ${index} is numbered ${game.index}`);
    }
  }
  return { source: header.source, games };
}
