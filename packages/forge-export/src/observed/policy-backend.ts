import type {
  ObservedBackend,
  ObservedSession,
  OpenResult,
  SeatId,
  SessionError,
  SessionSpec,
  SubmitResult,
  TableView,
  TranscriptFrame,
} from '@mtg/engine';
import type { ForgeObservedDecisionPolicy, ForgeObservedPolicyPosition } from './policy';
import { forgePolicyView } from './policy-observation';
import {
  acceptedPolicyMove,
  noProgressMessage,
  policyProgressPosition,
  policyUsesNoProgressRecovery,
  type ForgePolicyProgressState,
} from './policy-progress';
import { offeredPolicyMove } from './policy-move';

const MAX_AUTOMATIC_DECISIONS = 512;

function candidateSeatOf(table: SessionSpec): SeatId | null {
  const candidates = table.seats.flatMap((seat, index) =>
    seat.controller === 'engine' ? [index as SeatId] : [],
  );
  const locals = table.seats.filter((seat) => seat.controller === 'local');
  return candidates.length === 1 && locals.length === 1 ? (candidates[0] ?? null) : null;
}

function delegatedTable(table: SessionSpec, candidate: SeatId): SessionSpec {
  const seats: SessionSpec['seats'] =
    candidate === 0
      ? [{ ...table.seats[0], controller: 'local' }, table.seats[1]]
      : [table.seats[0], { ...table.seats[1], controller: 'local' }];
  return {
    ...table,
    seats,
  };
}

function concealHand(view: TableView, seat: SeatId): TableView {
  const seats: TableView['seats'] =
    seat === 0
      ? [{ ...view.seats[0], hand: null }, view.seats[1]]
      : [view.seats[0], { ...view.seats[1], hand: null }];
  return {
    ...view,
    seats,
  };
}

function outwardTranscript(
  transcript: readonly TranscriptFrame[],
  candidate: SeatId,
): readonly TranscriptFrame[] {
  return transcript.map((frame) => ({ ...frame, view: concealHand(frame.view, candidate) }));
}

function unsupportedPolicyError(kind: string, reason: string): SessionError {
  return {
    kind: 'unsupported',
    capability: `forge-observed-policy:${kind}`,
    message: `Forge observed policy cannot complete decision family ${kind}: ${reason}`,
  };
}

interface SessionOwner {
  current: ObservedSession;
  closePromise: Promise<void> | null;
}

function closeOwner(owner: SessionOwner): Promise<void> {
  owner.closePromise ??= owner.current.close();
  return owner.closePromise;
}

async function advanceCandidate(
  owner: SessionOwner,
  candidate: SeatId,
  policy: ForgeObservedDecisionPolicy,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: SessionError }> {
  let progress: ForgePolicyProgressState | null = null;
  const recoverNoProgress = policyUsesNoProgressRecovery(policy);
  for (let count = 0; count < MAX_AUTOMATIC_DECISIONS; count += 1) {
    const current = owner.current;
    if (current.status !== 'awaiting' || current.decision?.seat !== candidate) return { ok: true };

    const position: ForgeObservedPolicyPosition = {
      seat: candidate,
      view: forgePolicyView(current.view, candidate),
      decision: current.decision,
      play: current.play,
    };
    const prepared = policyProgressPosition(position, recoverNoProgress ? progress : null);
    const choice = policy.choose(prepared.position);
    if (choice.status === 'unsupported') {
      const error =
        prepared.attemptedMoves.length === 0
          ? unsupportedPolicyError(current.decision.kind, choice.reason)
          : {
              kind: 'backend-failure' as const,
              message: noProgressMessage(
                current.decision.kind,
                prepared.attemptedMoves,
                `${choice.family}: ${choice.reason}`,
              ),
            };
      await closeOwner(owner);
      return { ok: false, error };
    }
    if (offeredPolicyMove(prepared.position.decision, choice.move) === null) {
      const error: SessionError = {
        kind: 'backend-failure',
        message: noProgressMessage(
          current.decision.kind,
          prepared.attemptedMoves,
          `policy chose excluded or unoffered move ${choice.move}`,
        ),
      };
      await closeOwner(owner);
      return { ok: false, error };
    }
    const submitted = await current.submit(choice.move);
    if (!submitted.ok) {
      await closeOwner(owner);
      return submitted;
    }
    if (recoverNoProgress) progress = acceptedPolicyMove(prepared, choice.move);
    owner.current = submitted.session;
  }
  if (owner.current.status !== 'awaiting' || owner.current.decision?.seat !== candidate) {
    return { ok: true };
  }
  const error: SessionError = {
    kind: 'backend-failure',
    message: `Forge observed policy exceeded ${MAX_AUTOMATIC_DECISIONS} consecutive decisions`,
  };
  await closeOwner(owner);
  return { ok: false, error };
}

function outwardSession(
  owner: SessionOwner,
  table: SessionSpec,
  candidate: SeatId,
  policy: ForgeObservedDecisionPolicy,
  backendId: string,
  projected: boolean,
): ObservedSession {
  const current = owner.current;
  const human: SeatId = candidate === 0 ? 1 : 0;
  return {
    ...current,
    backend: backendId,
    table,
    view: concealHand(current.view, candidate),
    // A delegate declaring per-seat projection already hides the candidate's
    // hand from the human seat, so its projector goes outward whole; one that
    // does not declare it is sent out without one, whatever it handed over.
    seats: projected ? current.seats : null,
    localSeats: [human],
    transcript: outwardTranscript(current.transcript, candidate),
    submit: async (move): Promise<SubmitResult<ObservedSession>> => {
      const submitted = await current.submit(move);
      if (!submitted.ok) return submitted;
      owner.current = submitted.session;
      const advanced = await advanceCandidate(owner, candidate, policy);
      if (!advanced.ok) return advanced;
      return { ok: true, session: outwardSession(owner, table, candidate, policy, backendId, projected) };
    },
    close: () => closeOwner(owner),
  };
}

export function policyControlledObservedBackend(
  delegate: ObservedBackend,
  policy: ForgeObservedDecisionPolicy,
): ObservedBackend {
  const backendId = `${delegate.id}+${policy.identity.policyId}@${policy.identity.policyVersion}`;
  const shutdown = delegate.shutdown;
  const projected = delegate.capabilities.perSeatProjection;
  return {
    id: backendId,
    determinism: 'observed',
    capabilities: { ...delegate.capabilities, engineSeats: true },
    supports: async (table) => {
      const candidate = candidateSeatOf(table);
      if (candidate === null) return ['observed policy requires exactly one local and one engine seat'];
      return delegate.supports(delegatedTable(table, candidate));
    },
    open: async (table): Promise<OpenResult<ObservedSession>> => {
      const candidate = candidateSeatOf(table);
      if (candidate === null) {
        return {
          ok: false,
          error: unsupportedPolicyError('seat-controllers', 'requires exactly one local and one engine seat'),
        };
      }
      const opened = await delegate.open(delegatedTable(table, candidate));
      if (!opened.ok) return opened;
      const owner: SessionOwner = { current: opened.session, closePromise: null };
      const advanced = await advanceCandidate(owner, candidate, policy);
      if (!advanced.ok) return advanced;
      return { ok: true, session: outwardSession(owner, table, candidate, policy, backendId, projected) };
    },
    ...(shutdown === undefined ? {} : { shutdown: () => shutdown() }),
  };
}
