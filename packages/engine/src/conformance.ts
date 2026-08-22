/**
 * One suite that every backend is held to, written as a function rather than as
 * tests.
 *
 * It returns findings instead of asserting, and imports no test framework, for
 * two reasons. The first is that a backend lives in its own package — the kernel
 * adapter is in `@mtg/kernel`, a foreign bridge would be in its own — and a test
 * helper cannot be imported across a package boundary in this workspace, while a
 * function exported from `@mtg/engine` can. The second is that "does this thing
 * satisfy the contract" is a question worth being able to ask outside a test
 * run, from a CLI or a startup check, when the answer is about a subprocess that
 * may or may not be installed today.
 *
 * Each package's own test asserts the findings are empty, which is where the
 * failure message a person reads comes from.
 *
 * **What it does not check is worth stating.** It says nothing about whether the
 * backend plays Magic correctly; that is the parity harness's job and it is a
 * different instrument entirely. This checks the seam: that the shapes are the
 * shapes, that the states are mutually exclusive, that a bad move is refused as
 * a value rather than thrown, that the log is dense, that a backend claiming the
 * recorded arm can actually reproduce a game it played, that a backend claiming
 * per-seat projection sends a seat nothing it may not identify, and that no
 * decision it asks is one it could not finish listing.
 *
 * That last one is the reason a declaration is not enough on its own.
 * `perSeatProjection` is a boolean a backend writes about itself, and the value
 * of the boolean to a networked surface is entirely in whether it is true. So it
 * is checked here, at every position of a whole game, by
 * `hidden-information.ts` — which is the check `@mtg/netplay` wrote against its
 * own wire, asked of the seam instead.
 *
 * That search walks the game with a one-position memory, because a library is
 * the zone the projection deliberately does not enumerate and the only way to
 * name a card in it is to wait until it comes out. What a seat drew here was in
 * its library a move ago, and the payload the other seat was sent a move ago is
 * still here to search. `hidden-information.ts` argues that and states what it
 * costs.
 *
 * The seed goes into that search with the position, because it is the one thing
 * a seat may not be sent that no object carries. Which seed is a question the
 * determinism split already answers: the recorded arm reports the seed it
 * actually used, whoever chose it, so `record.seed` is the value that reproduces
 * the match and `table.seed` may be null beside it. The observed arm has only
 * what the table stated, and a table that stated nothing is searched for nothing.
 */
import type { GameBackend, EngineSession, RecordedSession } from './session';
import type { SessionError } from './errors';
import type { MoveId, PendingDecision } from './decision';
import type { SessionSpec } from './table';
import { PROJECTION_VERSION } from './projection';
import type { PositionMemo } from './hidden-information';
import { auditSeatPayloads } from './hidden-information';

export interface Finding {
  /** Which rule was broken, short enough to read in a failure dump. */
  readonly check: string;
  readonly detail: string;
}

export interface ConformanceOptions {
  /**
   * How many moves the suite will submit before giving up on the game ending.
   *
   * A cap rather than a timeout because the suite is deterministic: whatever
   * `pick` is, it is a pure function of the decision, so a game that does not
   * end under that policy is not going to end by waiting longer.
   */
  readonly maxMoves?: number;
  /**
   * Which of the offered moves the suite takes at each position.
   *
   * Defaults to the first, which is what makes a run reproducible without asking
   * the caller for a seed. It is an option because **the default is not a
   * neutral walk of the game, and for `checkEnumeration` it is close to a blind
   * one.** `options[0]` is "pass" at a priority decision for our kernel and for
   * any backend that lists the cheapest move first, so a suite that only ever
   * takes it plays a game in which the driven seat never puts a permanent on the
   * battlefield — and therefore never reaches a combat wide enough to have
   * anything to truncate. Measured on this checkout before this parameter
   * existed: forty seeds of `kernelBackend` through `checkBackend` reached
   * `priority`, `mulligan` and `discard` and reached `declareBlockers` zero
   * times. The enumeration check was passing because it was never asked.
   *
   * So a caller that knows where its backend is likely to truncate points the
   * suite at those positions. The requirement on a policy is that it be a pure
   * function of the decision it is handed: `checkReproduction` replays the moves
   * this walk recorded, and a policy that consulted a clock or a counter would
   * have it check a different game than the one that was played.
   *
   * An id the current decision does not offer is a bug in the policy rather than
   * a finding against the backend, and it is raised as an error rather than
   * recorded — a suite that quietly fell back to `options[0]` would report on a
   * game the caller did not ask for.
   */
  readonly pick?: (decision: PendingDecision) => MoveId;
}

const DEFAULT_MAX_MOVES = 4_000;

/** The default policy: the first move offered, whatever it happens to be. */
function firstOffered(decision: PendingDecision): MoveId {
  const first = decision.options[0];
  // Unreachable: `playThrough` reports an empty option list as a finding and
  // stops before it consults any policy.
  if (first === undefined) throw new Error('conformance: firstOffered was handed an empty decision');
  return first.id;
}

/** An id no enumeration hands out, used to check the refusal path. */
const NOT_A_MOVE: MoveId = '\u0000 not-a-move';

export async function checkBackend(
  backend: GameBackend,
  table: SessionSpec,
  options: ConformanceOptions = {},
): Promise<readonly Finding[]> {
  const findings: Finding[] = [];
  const add = (check: string, detail: string): void => {
    findings.push({ check, detail });
  };

  checkIdentity(backend, add);

  const refusals = await backend.supports(table);
  if (refusals.length > 0) {
    add('supports', `the backend refuses this table: ${refusals.join(', ')}`);
    return findings;
  }

  const opened = await backend.open(table);
  if (!opened.ok) {
    add('open', `open failed: ${opened.error.kind}: ${opened.error.message}`);
    return findings;
  }

  const played = await playThrough(
    opened.session,
    options.maxMoves ?? DEFAULT_MAX_MOVES,
    backend.capabilities.perSeatProjection,
    add,
    options.pick ?? firstOffered,
  );
  await checkReproduction(backend, played, add);
  await checkClose(played.last, add);
  return findings;
}

type Add = (check: string, detail: string) => void;

function checkIdentity(backend: GameBackend, add: Add): void {
  if (backend.id.length === 0) add('identity', 'a backend must have a non-empty id');
  const declared: readonly boolean[] = [
    backend.capabilities.undo,
    backend.capabilities.fork,
    backend.capabilities.perSeatProjection,
    backend.capabilities.engineSeats,
  ];
  if (declared.some((value) => typeof value !== 'boolean')) {
    add('capabilities', 'every capability is a declared boolean, never absent');
  }
}

interface Played {
  readonly last: EngineSession;
  readonly moves: readonly MoveId[];
  /** Fingerprint after each submitted move, recorded arm only. */
  readonly fingerprints: readonly string[];
}

async function playThrough(
  opening: EngineSession,
  cap: number,
  declared: boolean,
  add: Add,
  pick: (decision: PendingDecision) => MoveId,
): Promise<Played> {
  let session = opening;
  const moves: MoveId[] = [];
  const fingerprints: string[] = [];
  // The payload search is per position; the library search compares this
  // position against the one before it, so one memo walks the game with the
  // session. Null at the opening, where there is no position before.
  let position = checkInvariants(session, 0, declared, add, null);
  let searched = position.searched;
  await checkRefusal(session, add);

  for (let taken = 0; taken < cap; taken += 1) {
    if (session.status !== 'awaiting') break;
    const decision = session.decision;
    if (decision === null) break;
    if (decision.options[0] === undefined) {
      add('decision', `a pending "${decision.kind}" decision offered no options at all`);
      break;
    }
    const chosen = pick(decision);
    if (!decision.options.some((option) => option.id === chosen)) {
      throw new Error(
        `conformance: the pick policy asked for "${chosen}", which the pending "${decision.kind}" decision does not offer`,
      );
    }
    const result = await submit(session, chosen);
    if (!result.ok) {
      add('submit', `an offered move was refused: ${describe(result.error)}`);
      break;
    }
    moves.push(chosen);
    session = result.session;
    if (session.determinism === 'recorded') fingerprints.push(session.fingerprint);
    position = checkInvariants(session, moves.length, declared, add, position.memo);
    searched += position.searched;
  }

  if (session.status === 'awaiting') {
    add('termination', `the game was still asking after ${String(moves.length)} moves`);
  }
  // The positive control. Every absence check in the payload search passes on a
  // payload with nothing in it, so a game that never held a concealed card
  // tested the declaration at no point and must not be reported as having
  // passed it.
  if (declared && searched === 0) {
    add(
      'hidden-information',
      'the backend declares per-seat projection and no position in the whole game had a card to conceal',
    );
  }
  checkRecord(session, moves, add);
  return { last: session, moves, fingerprints };
}

/**
 * Submits without caring which arm this is.
 *
 * The union's two `submit` members return two different session types, which is
 * the whole point of the split. This suite is the one caller that legitimately
 * does not care: it drives whatever it was handed and widens the result. Every
 * other caller should be narrowing instead, which is what the split is for.
 */
async function submit(
  session: EngineSession,
  move: MoveId,
): Promise<
  | { readonly ok: true; readonly session: EngineSession }
  | { readonly ok: false; readonly error: SessionError }
> {
  return session.submit(move);
}

/** What one position contributed: its share of the positive control, and its memo. */
interface Position {
  readonly searched: number;
  readonly memo: PositionMemo | null;
}

function checkInvariants(
  session: EngineSession,
  submitted: number,
  declared: boolean,
  add: Add,
  previous: PositionMemo | null,
): Position {
  const at = `after ${String(submitted)} moves`;
  if (session.submitted !== submitted) {
    add('submitted', `${at} the session counted ${String(session.submitted)}`);
  }
  if (session.view.version !== PROJECTION_VERSION) {
    add('projection', `${at} the view declared version ${String(session.view.version)}`);
  }
  const hasDecision = session.decision !== null;
  const hasResult = session.result !== null;
  switch (session.status) {
    case 'awaiting':
      if (!hasDecision) add('status', `${at} status was awaiting with no decision`);
      if (hasResult) add('status', `${at} status was awaiting with a result`);
      break;
    case 'finished':
      if (!hasResult) add('status', `${at} status was finished with no result`);
      if (hasDecision) add('status', `${at} status was finished with a decision pending`);
      break;
    case 'closed':
      if (hasDecision) add('status', `${at} status was closed with a decision pending`);
      break;
    default: {
      const unreachable: never = session.status;
      add('status', `${at} status was ${String(unreachable)}`);
    }
  }
  session.events.forEach((event, index) => {
    if (event.seq !== index) {
      add('events', `${at} event ${String(index)} carried seq ${String(event.seq)}`);
    }
  });
  if (session.determinism === 'observed' && session.transcript.length !== submitted + 1) {
    add(
      'transcript',
      `${at} the transcript held ${String(session.transcript.length)} frames, expected ${String(submitted + 1)}`,
    );
  }
  checkEnumeration(session.decision, at, add);
  return checkSeats(session, declared, at, add, previous);
}

/**
 * A decision the backend could not finish listing is a finding, not a fact.
 *
 * `decision.ts` argues this at length and it is the whole of `mtg-bc2.151.1`'s
 * answer: the neutral channel offers only what was enumerated, so a truncated
 * list is a set of legal moves with no ids, unreachable through `submit` by any
 * surface. The contract's answer is not a second channel for constructing the
 * missing ones — it is that an exponential decision is a product or a
 * permutation, both of which are sequences of small decisions, and asking it as
 * a sequence needs no term this file does not already have.
 *
 * So the check is the flag itself rather than any threshold on the list's
 * length. **A size bound would be a different claim** — how many options a person
 * can be shown is a surface's judgment and it is not the contract's to legislate
 * — and it would also be the wrong instrument, since a backend that lists 512 of
 * 65,536 has the same problem as one that lists 512 of 513 and a bound would rank
 * them by the same number.
 *
 * What it does not claim: that the backend is wrong about the space being big.
 * It is a finding against handing a surface a list the backend has already said
 * is not the list, when it had the option of asking a question it could finish.
 */
function checkEnumeration(decision: PendingDecision | null, at: string, add: Add): void {
  if (decision === null || decision.complete) return;
  add(
    'enumeration',
    `${at} a pending "${decision.kind}" decision listed ${String(decision.options.length)} moves and ` +
      'reported the list incomplete, so the legal moves it left out have no id and cannot be submitted; ' +
      'ask an exponential decision as a sequence of small ones (see decision.ts)',
  );
}

/**
 * The declaration and the member say the same thing, and then the member is
 * tested.
 *
 * Both directions are findings. A backend that declares the capability and hands
 * out no projector has promised a networked surface something it cannot do; one
 * that hands out a projector it does not declare has hidden the only thing a
 * caller can select it by, since the declaration is what is readable before a
 * session exists.
 */
function checkSeats(
  session: EngineSession,
  declared: boolean,
  at: string,
  add: Add,
  previous: PositionMemo | null,
): Position {
  const seats = session.seats;
  if (declared !== (seats !== null)) {
    add(
      'per-seat-projection',
      declared
        ? `${at} the backend declares per-seat projection and the session carries no projector`
        : `${at} the session carries a per-seat projector the backend does not declare`,
    );
    return { searched: 0, memo: null };
  }
  if (seats === null) return { searched: 0, memo: null };
  const seed = session.determinism === 'recorded' ? session.record.seed : session.table.seed;
  const audit = auditSeatPayloads(seats, session.view, session.decision, at, seed, previous);
  for (const finding of audit.findings) add(finding.check, finding.detail);
  return { searched: audit.searched, memo: audit.memo };
}

async function checkRefusal(session: EngineSession, add: Add): Promise<void> {
  if (session.status !== 'awaiting') return;
  const result = await submit(session, NOT_A_MOVE);
  if (result.ok) {
    add('unknown-move', 'a move id the backend never handed out was accepted');
    return;
  }
  if (result.error.kind !== 'unknown-move') {
    add('unknown-move', `an unknown id was refused as ${result.error.kind}, expected unknown-move`);
  }
}

function checkRecord(session: EngineSession, moves: readonly MoveId[], add: Add): void {
  if (session.determinism !== 'recorded') return;
  if (session.record.backend !== session.backend) {
    add('record', `the record names backend ${session.record.backend}, the session names ${session.backend}`);
  }
  if (session.record.seed.length === 0) {
    add('record', 'a recorded backend must report the seed it used, whoever picked it');
  }
  if (session.record.moves.length !== moves.length) {
    add(
      'record',
      `the record holds ${String(session.record.moves.length)} moves after ${String(moves.length)} were submitted`,
    );
  }
}

/**
 * A recorded backend replays what it played, and a prefix lands mid-game.
 *
 * The prefix half is the one worth having: reproducing the finished position is
 * satisfied by a backend that simply kept the answer, and reproducing an
 * arbitrary earlier position is not.
 */
async function checkReproduction(backend: GameBackend, played: Played, add: Add): Promise<void> {
  if (backend.determinism !== 'recorded') return;
  const last = played.last;
  if (last.determinism !== 'recorded') {
    add('determinism', 'a recorded backend opened a session that is not on the recorded arm');
    return;
  }
  const whole = await backend.reopen(last.record);
  if (!whole.ok) {
    add('reopen', `reopening the record failed: ${describe(whole.error)}`);
    return;
  }
  compare(whole.session, last, 'the whole record', add);
  await whole.session.close();

  const half = Math.floor(played.moves.length / 2);
  const expected = played.fingerprints[half - 1];
  if (half === 0 || expected === undefined) return;
  const prefix = await backend.reopen({ ...last.record, moves: last.record.moves.slice(0, half) });
  if (!prefix.ok) {
    add('reopen', `reopening a ${String(half)}-move prefix failed: ${describe(prefix.error)}`);
    return;
  }
  if (prefix.session.fingerprint !== expected) {
    add(
      'reopen',
      `a ${String(half)}-move prefix landed on a different position than the game stood in there`,
    );
  }
  await prefix.session.close();
}

function compare(replayed: RecordedSession, original: RecordedSession, what: string, add: Add): void {
  if (replayed.fingerprint !== original.fingerprint) {
    add('reopen', `${what} replayed to a different position`);
  }
  if (replayed.submitted !== original.submitted) {
    add('reopen', `${what} replayed ${String(replayed.submitted)} of ${String(original.submitted)} moves`);
  }
  if (replayed.events.length !== original.events.length) {
    add(
      'reopen',
      `${what} replayed ${String(replayed.events.length)} events against ${String(original.events.length)}`,
    );
  }
}

async function checkClose(session: EngineSession, add: Add): Promise<void> {
  await session.close();
  try {
    await session.close();
  } catch (cause) {
    add('close', `close is idempotent and the second call threw: ${String(cause)}`);
  }
}

function describe(error: SessionError): string {
  return `${error.kind}: ${error.message}`;
}
