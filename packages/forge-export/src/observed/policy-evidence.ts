import type { BotEvidenceEpisode, JsonValue } from '@mtg/bot-evidence';
import { BotEvidenceEpisodeSchema, botEvidenceSha256 } from '@mtg/bot-evidence';
import { canonicalJson } from '@mtg/dsl';
import type {
  ObservedBackend,
  ObservedSession,
  PendingDecision,
  SeatId,
  SessionError,
  SessionSpec,
} from '@mtg/engine';
import { seatSpecOf } from '@mtg/engine';
import type {
  ForgeObservedDecisionPolicy,
  ForgeObservedPolicyChoice,
  ForgeObservedPolicyPosition,
} from './policy';
import { forgePolicyView } from './policy-observation';
import {
  acceptedPolicyMove,
  noProgressMessage,
  policyProgressPosition,
  policyUsesNoProgressRecovery,
  type ForgePolicyProgressState,
} from './policy-progress';
import { offeredPolicyMove } from './policy-move';

type EvidenceIdentity = BotEvidenceEpisode['episode'];
type DecisionEvidence = BotEvidenceEpisode['decisions'][number];
type FailureStatus = Exclude<BotEvidenceEpisode['outcome'], { status: 'completed' }>['status'];

export type ForgeGameplayEvidenceRequest = Omit<
  EvidenceIdentity,
  'stage' | 'seed' | 'runtime' | 'features' | 'behavior'
> & {
  readonly runtime: Omit<EvidenceIdentity['runtime'], 'kind'>;
  readonly modelSha256: string | null;
  readonly dataSha256: string | null;
};

export interface ForgeObservedGameMeasurement {
  readonly candidateSeat: SeatId;
  readonly completion: BotEvidenceEpisode['outcome']['status'];
  readonly elapsedMs: number;
  readonly decisions: number;
  readonly callbackCounts: Readonly<Record<string, number>>;
}

export interface ForgeObservedGameReport {
  readonly evidence: BotEvidenceEpisode;
  readonly measurement: ForgeObservedGameMeasurement;
}

export interface ForgeObservedGameCheckpoint {
  readonly episode: EvidenceIdentity;
  readonly decision: DecisionEvidence;
  readonly measurement: ForgeObservedGameMeasurement;
}

export interface ForgeObservedPolicyGameOptions {
  readonly backend: ObservedBackend;
  readonly table: SessionSpec;
  readonly candidateSeat: SeatId;
  readonly policy: ForgeObservedDecisionPolicy;
  readonly evidence: ForgeGameplayEvidenceRequest;
  readonly maximumDecisions?: number;
  readonly now?: () => number;
  /** Persistable progress emitted after choosing an offered move and before Forge receives it. */
  readonly onCheckpoint?: (checkpoint: ForgeObservedGameCheckpoint) => void | Promise<void>;
}

const DEFAULT_MAXIMUM_DECISIONS = 5_000;
const TRUNCATED_CANDIDATES_REASON = 'backend candidate list is incomplete';
const NON_ENUMERATED_INPUT_REASON = 'backend decision uses non-enumerated input';
const EMPTY_CANDIDATES_REASON = 'backend decision exposes no candidates';

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(canonicalJson(value)) as JsonValue;
}

function errorText(error: SessionError): string {
  if (error.kind === 'content-unsupported') {
    return `${error.message}: ${error.reasons.join('; ')}`;
  }
  return `${error.kind}: ${error.message}`;
}

function failureStatus(error: SessionError): FailureStatus {
  if (error.kind === 'timeout') return 'timeout';
  if (error.kind === 'unsupported' || error.kind === 'content-unsupported') return 'unsupported';
  if (error.kind === 'unknown-move' || error.kind === 'illegal-move') return 'illegal-action';
  return 'engine-failure';
}

function unknownFailure(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.trim() === '' ? 'unknown Forge gameplay failure' : message;
}

function validateMaximumDecisions(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(
      `maximum Forge policy decisions must be a positive safe integer, received ${String(value)}`,
    );
  }
  return value;
}

function validateSeats(table: SessionSpec, candidate: SeatId): void {
  if (seatSpecOf(table, candidate).controller !== 'local') {
    throw new Error(`candidate seat ${String(candidate)} must be local`);
  }
  const opponent: SeatId = candidate === 0 ? 1 : 0;
  if (seatSpecOf(table, opponent).controller !== 'engine') {
    throw new Error(`opponent seat ${String(opponent)} must be engine controlled`);
  }
}

function evidenceIdentity(
  request: ForgeGameplayEvidenceRequest,
  table: SessionSpec,
  policy: ForgeObservedDecisionPolicy,
): EvidenceIdentity {
  const adapter = {
    observationAdapterId: policy.identity.observationAdapterId,
    actionAdapterId: policy.identity.actionAdapterId,
  };
  const identity = BotEvidenceEpisodeSchema.parse({
    schemaVersion: 1,
    episode: {
      id: request.id,
      stage: 'gameplay',
      seed: table.seed,
      runtime: { ...request.runtime, kind: 'forge' },
      subject: request.subject,
      features: {
        schemaId: `${adapter.observationAdapterId}+${adapter.actionAdapterId}`,
        schemaSha256: botEvidenceSha256(adapter),
      },
      behavior: {
        policyId: `${policy.identity.policyId}@${String(policy.identity.policyVersion)}`,
        configSha256: policy.identity.configSha256,
        config: policy.identity.configuration,
        modelSha256: request.modelSha256,
        dataSha256: request.dataSha256,
      },
      lineage: request.lineage,
      splitGroup: request.splitGroup,
    },
    decisions: [],
    outcome: { status: 'incomplete', error: 'identity validation only' },
  }).episode;
  if (identity.splitGroup.kind !== 'game') {
    throw new Error('Forge gameplay evidence must use a game split group');
  }
  return identity;
}

function positionOf(session: ObservedSession, candidateSeat: SeatId): ForgeObservedPolicyPosition {
  if (session.decision === null) throw new Error('awaiting Forge session has no decision');
  return {
    seat: candidateSeat,
    view: forgePolicyView(session.view, candidateSeat),
    decision: session.decision,
    ...(session.play === undefined ? {} : { play: session.play }),
  };
}

function candidatesOf(
  decision: PendingDecision,
  choice: DecisionEvidence['choice'],
): DecisionEvidence['candidates'] {
  const selected = choice.status === 'chosen' ? offeredPolicyMove(decision, choice.candidateId) : null;
  const inputCandidate =
    choice.status === 'chosen' && selected?.kind === 'text'
      ? [{ id: choice.candidateId, value: jsonValue(selected) }]
      : [];
  const values = [
    ...decision.options.map((option) => ({ id: option.id, value: jsonValue(option) })),
    ...inputCandidate,
  ];
  if (new Set(values.map((candidate) => candidate.id)).size !== values.length) {
    throw new Error(`Forge ${decision.kind} decision exposed duplicate candidates`);
  }
  if (!decision.complete) {
    return { status: 'truncated', reason: TRUNCATED_CANDIDATES_REASON, values };
  }
  if (decision.input !== undefined) {
    return { status: 'incomplete', reason: NON_ENUMERATED_INPUT_REASON, values };
  }
  return values.length === 0
    ? { status: 'incomplete', reason: EMPTY_CANDIDATES_REASON, values }
    : { status: 'complete', values };
}

function decisionEvidence(
  position: ForgeObservedPolicyPosition,
  sequence: number,
  choice: DecisionEvidence['choice'],
): DecisionEvidence {
  const observation = jsonValue(position);
  return {
    sequence,
    observation: { sha256: botEvidenceSha256(observation), value: observation },
    candidates: candidatesOf(position.decision, choice),
    choice,
  };
}

function recordedChoice(choice: ForgeObservedPolicyChoice): DecisionEvidence['choice'] {
  return choice.status === 'chosen'
    ? { status: 'chosen', candidateId: choice.move }
    : { status: 'unsupported', error: `${choice.family}: ${choice.reason}` };
}

function failedChoice(
  error: SessionError,
  attempted: DecisionEvidence['candidates']['values'][number],
): DecisionEvidence['choice'] {
  const status = failureStatus(error);
  return status === 'illegal-action'
    ? { status, error: errorText(error), attempted }
    : { status, error: errorText(error) };
}

function thrownChoice(cause: unknown): DecisionEvidence['choice'] {
  return { status: 'engine-failure', error: unknownFailure(cause) };
}

function completedValue(session: ObservedSession): JsonValue {
  if (session.result === null) throw new Error('finished Forge session has no result');
  return jsonValue(session.result);
}

function report(
  episode: EvidenceIdentity,
  decisions: readonly DecisionEvidence[],
  outcome: BotEvidenceEpisode['outcome'],
  candidateSeat: SeatId,
  callbackCounts: Readonly<Record<string, number>>,
  elapsedMs: number,
): ForgeObservedGameReport {
  const evidence = BotEvidenceEpisodeSchema.parse({ schemaVersion: 1, episode, decisions, outcome });
  return {
    evidence,
    measurement: {
      candidateSeat,
      completion: evidence.outcome.status,
      elapsedMs: Math.max(0, elapsedMs),
      decisions: evidence.decisions.length,
      callbackCounts,
    },
  };
}

function checkpoint(
  episode: EvidenceIdentity,
  decision: DecisionEvidence,
  candidateSeat: SeatId,
  callbackCounts: Readonly<Record<string, number>>,
  elapsedMs: number,
): ForgeObservedGameCheckpoint {
  return {
    episode,
    decision,
    measurement: {
      candidateSeat,
      completion: 'incomplete',
      elapsedMs: Math.max(0, elapsedMs),
      decisions: decision.sequence + 1,
      callbackCounts,
    },
  };
}

/** Run one candidate-vs-Forge game while retaining safe partial evidence on every ordinary failure. */
export async function runForgeObservedPolicyGame(
  options: ForgeObservedPolicyGameOptions,
): Promise<ForgeObservedGameReport> {
  validateSeats(options.table, options.candidateSeat);
  const maximumDecisions = validateMaximumDecisions(options.maximumDecisions ?? DEFAULT_MAXIMUM_DECISIONS);
  const episode = evidenceIdentity(options.evidence, options.table, options.policy);
  const now = options.now ?? Date.now;
  const startedAt = now();
  let decisions: readonly DecisionEvidence[] = [];
  let callbackCounts: Readonly<Record<string, number>> = {};
  let session: ObservedSession | null = null;
  let progress: ForgePolicyProgressState | null = null;
  const recoverNoProgress = policyUsesNoProgressRecovery(options.policy);
  let outcome: BotEvidenceEpisode['outcome'] = {
    status: 'incomplete',
    error: 'Forge game did not reach a terminal state',
  };

  try {
    const opened = await options.backend.open(options.table);
    if (!opened.ok) {
      outcome = { status: failureStatus(opened.error), error: errorText(opened.error) };
    } else {
      session = opened.session;
      while (session.status === 'awaiting' && decisions.length < maximumDecisions) {
        const position = positionOf(session, options.candidateSeat);
        if (position.decision.seat !== options.candidateSeat) {
          outcome = {
            status: 'engine-failure',
            error: `Forge exposed engine-controlled seat ${String(position.decision.seat)} for local submission`,
          };
          break;
        }

        callbackCounts = {
          ...callbackCounts,
          [position.decision.kind]: (callbackCounts[position.decision.kind] ?? 0) + 1,
        };
        const prepared = policyProgressPosition(position, recoverNoProgress ? progress : null);
        let choice: ForgeObservedPolicyChoice;
        try {
          choice = options.policy.choose(prepared.position);
        } catch (cause: unknown) {
          const error = unknownFailure(cause);
          decisions = [...decisions, decisionEvidence(position, decisions.length, thrownChoice(cause))];
          outcome = { status: 'engine-failure', error };
          break;
        }
        if (choice.status === 'unsupported') {
          if (prepared.attemptedMoves.length > 0) {
            const error = noProgressMessage(
              position.decision.kind,
              prepared.attemptedMoves,
              `${choice.family}: ${choice.reason}`,
            );
            decisions = [
              ...decisions,
              decisionEvidence(position, decisions.length, {
                status: 'engine-failure',
                error,
              }),
            ];
            outcome = { status: 'engine-failure', error };
          } else {
            decisions = [...decisions, decisionEvidence(position, decisions.length, recordedChoice(choice))];
            outcome = { status: 'unsupported', error: `${choice.family}: ${choice.reason}` };
          }
          break;
        }

        const candidate = offeredPolicyMove(prepared.position.decision, choice.move);
        if (candidate === null) {
          decisions = [
            ...decisions,
            decisionEvidence(position, decisions.length, {
              status: 'illegal-action',
              error: `policy chose unoffered move ${choice.move}`,
              attempted: { id: choice.move, value: jsonValue({ family: choice.family }) },
            }),
          ];
          outcome = { status: 'illegal-action', error: `policy chose unoffered move ${choice.move}` };
          break;
        }

        const chosenDecision = decisionEvidence(position, decisions.length, recordedChoice(choice));
        decisions = [...decisions, chosenDecision];
        if (options.onCheckpoint !== undefined) {
          await options.onCheckpoint(
            checkpoint(episode, chosenDecision, options.candidateSeat, callbackCounts, now() - startedAt),
          );
        }

        try {
          const submitted = await session.submit(choice.move);
          if (submitted.ok) {
            if (recoverNoProgress) progress = acceptedPolicyMove(prepared, choice.move);
            session = submitted.session;
            continue;
          }
          decisions = [
            ...decisions.slice(0, -1),
            decisionEvidence(
              position,
              decisions.length - 1,
              failedChoice(submitted.error, {
                id: choice.move,
                value: jsonValue(
                  candidate.kind === 'option'
                    ? candidate.option
                    : { input: candidate.input, value: candidate.value },
                ),
              }),
            ),
          ];
          outcome = { status: failureStatus(submitted.error), error: errorText(submitted.error) };
          break;
        } catch (cause: unknown) {
          const error = unknownFailure(cause);
          decisions = [
            ...decisions.slice(0, -1),
            decisionEvidence(position, decisions.length - 1, thrownChoice(cause)),
          ];
          outcome = { status: 'engine-failure', error };
          break;
        }
      }

      if (session.status === 'finished') {
        outcome = { status: 'completed', value: completedValue(session) };
      } else if (session.status === 'closed') {
        outcome = { status: 'incomplete', error: 'Forge session closed before producing a result' };
      } else if (decisions.length >= maximumDecisions) {
        outcome = {
          status: 'incomplete',
          error: `Forge game exceeded ${String(maximumDecisions)} candidate decisions`,
        };
      }
    }
  } catch (cause: unknown) {
    outcome = { status: 'engine-failure', error: unknownFailure(cause) };
  }

  if (session !== null) {
    try {
      await session.close();
    } catch (cause: unknown) {
      outcome = { status: 'engine-failure', error: `Forge session close failed: ${unknownFailure(cause)}` };
    }
  }

  return report(episode, decisions, outcome, options.candidateSeat, callbackCounts, now() - startedAt);
}
