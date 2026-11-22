import type { BotEvidenceEpisode, JsonValue } from '@mtg/bot-evidence';
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import { canonicalJson } from '@mtg/dsl';
import type { Action, AgentView } from '@mtg/kernel';
import { actionKey, canonicalAction } from '@mtg/kernel';

export type NativeGameplayDecisionEvidence = BotEvidenceEpisode['decisions'][number];

/**
 * What a recorded decision keeps of the observation it was made on. `retained`
 * stores the projected state itself, which a learned dataset reads back;
 * `digest` stores only its SHA-256, which a replay from the seed and choice
 * list can check. A campaign that only needs outcomes and choices keeps the
 * digest: the retained value is 97% of a trial's bytes.
 */
export type ObservationRetention = 'retained' | 'digest';

const ENUMERATION_CAP_REASON = 'kernel enumeration cap reached';
const FREE_TEXT_REASON = 'free-text decision is not enumerable';
const CONSTRUCTED_ACTION_REASON = 'chosen action was constructed outside enumerated candidates';

/** Convert an already-typed domain value at the evidence serialization boundary. */
function jsonValue(value: unknown): JsonValue {
  return JSON.parse(canonicalJson(value)) as JsonValue;
}

function candidate(action: Action): NativeGameplayDecisionEvidence['candidates']['values'][number] {
  return { id: actionKey(action), value: jsonValue(canonicalAction(action)) };
}

function validateSequence(sequence: number): void {
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new Error(`native evidence sequence must be a nonnegative integer, received ${sequence}`);
  }
}

function candidateSurface(view: AgentView): NativeGameplayDecisionEvidence['candidates'] {
  if (view.decision.kind === 'cardName') {
    return { status: 'incomplete', reason: FREE_TEXT_REASON, values: [] };
  }
  const values = view.decision.options.map(candidate);
  if (new Set(values.map((value) => value.id)).size !== values.length) {
    throw new Error(`native ${view.decision.kind} decision exposed duplicate candidates`);
  }
  return view.decision.complete
    ? { status: 'complete', values }
    : { status: 'truncated', reason: ENUMERATION_CAP_REASON, values };
}

function enumeratedCandidates(view: AgentView, chosen: Action): NativeGameplayDecisionEvidence['candidates'] {
  if (view.decision.kind === 'cardName') {
    return { status: 'incomplete', reason: FREE_TEXT_REASON, values: [candidate(chosen)] };
  }

  const values = view.decision.options.map(candidate);
  const ids = new Set(values.map((value) => value.id));
  if (ids.size !== values.length) {
    throw new Error(`native ${view.decision.kind} decision exposed duplicate candidates`);
  }

  const chosenCandidate = candidate(chosen);
  if (!ids.has(chosenCandidate.id)) {
    return {
      status: 'truncated',
      reason: view.decision.complete ? CONSTRUCTED_ACTION_REASON : ENUMERATION_CAP_REASON,
      values: [...values, chosenCandidate],
    };
  }

  return view.decision.complete
    ? { status: 'complete', values }
    : { status: 'truncated', reason: ENUMERATION_CAP_REASON, values };
}

/**
 * Record one native-kernel player decision without crossing the concealed-state
 * boundary. Candidate identity is the same canonical identity used by replay.
 */
export function nativeGameplayDecision(
  view: AgentView,
  chosen: Action,
  sequence: number,
  retention: ObservationRetention = 'retained',
): NativeGameplayDecisionEvidence {
  validateSequence(sequence);

  const candidates = enumeratedCandidates(view, chosen);
  return {
    sequence,
    observation: observationEvidence(view, retention),
    candidates,
    choice: { status: 'chosen', candidateId: actionKey(chosen) },
  };
}

function observationEvidence(
  view: AgentView,
  retention: ObservationRetention,
): NativeGameplayDecisionEvidence['observation'] {
  const observation = jsonValue(view.state);
  const sha256 = botEvidenceSha256(observation);
  return retention === 'retained' ? { sha256, value: observation } : { sha256 };
}

/** Record the exact action that the native kernel rejected as illegal. */
export function nativeGameplayFailedDecision(
  view: AgentView,
  attempted: Action,
  sequence: number,
  error: string,
  retention: ObservationRetention = 'retained',
): NativeGameplayDecisionEvidence {
  validateSequence(sequence);
  return {
    sequence,
    observation: observationEvidence(view, retention),
    candidates: candidateSurface(view),
    choice: { status: 'illegal-action', error, attempted: candidate(attempted) },
  };
}
