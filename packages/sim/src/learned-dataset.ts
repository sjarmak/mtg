import { canonicalJson } from '@mtg/dsl';
import { BotEvidenceEpisodeSchema, botEvidenceSha256, type BotEvidenceEpisode } from '@mtg/bot-evidence';
import {
  agentDecision,
  actionKey,
  canonicalAction,
  pendingDecision,
  type Action,
  type ActionType,
  type AgentObservation,
  type AgentView,
  type PlayerId,
} from '@mtg/kernel';
import { encodeLearnedCandidate, LEARNED_FEATURE_SCHEMA, sparsifyLearnedFeatures } from './learned-evaluator';
import type { LearnedFeatures } from './learned-features';

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

export interface LearnedExample {
  readonly episodeId: string;
  readonly sequence: number;
  readonly candidateId: string;
  readonly actionType: ActionType;
  readonly features: LearnedFeatures;
  readonly return: number;
  readonly weight: number;
}

export interface LearnedDatasetProjection {
  readonly examples: readonly LearnedExample[];
  readonly skipped: { readonly failed: number; readonly forced: number; readonly incomplete: number };
}

function observationFromJson(
  value: BotEvidenceEpisode['decisions'][number]['observation']['value'],
): AgentObservation {
  const candidate = record(value);
  if (candidate === null || !Array.isArray(candidate['players']) || record(candidate['turn']) === null) {
    throw new Error('learned dataset observation is not a native agent observation');
  }
  const observation = candidate as unknown as AgentObservation;
  const rng = observation.rng;
  if (observation.config.seed !== '' || rng.a !== 0 || rng.b !== 0 || rng.c !== 0 || rng.d !== 0) {
    throw new Error('learned dataset observation is not a safe agent observation');
  }
  return observation;
}

function validatedDecision(decision: BotEvidenceEpisode['decisions'][number]): {
  readonly state: AgentObservation;
  readonly action: Action;
  readonly view: AgentView;
} {
  if (decision.observation.value === undefined) {
    throw new Error('learned dataset needs retained observations; this episode kept only their digests');
  }
  if (botEvidenceSha256(decision.observation.value) !== decision.observation.sha256) {
    throw new Error('learned dataset observation digest does not match its payload');
  }
  const state = observationFromJson(decision.observation.value);
  const pending = pendingDecision(state);
  if (pending === null || !pending.complete) {
    throw new Error('learned dataset complete candidate set has no complete native decision');
  }
  const live = agentDecision(pending);
  const recorded = decision.candidates.values;
  if (recorded.length !== live.options.length) {
    throw new Error('learned dataset candidate set does not match the native decision');
  }
  for (const [index, option] of live.options.entries()) {
    const candidate = recorded[index];
    if (
      candidate === undefined ||
      candidate.id !== actionKey(option) ||
      canonicalJson(candidate.value) !== canonicalJson(canonicalAction(option))
    ) {
      throw new Error('learned dataset candidate set does not match the native decision');
    }
  }
  if (decision.choice.status !== 'chosen') throw new Error('learned dataset decision has no chosen action');
  const candidateId = decision.choice.candidateId;
  const action = live.options.find((option) => actionKey(option) === candidateId);
  if (action === undefined) throw new Error('learned dataset choice is absent from its candidate set');
  return {
    state,
    action,
    view: { state, player: live.player, decision: live },
  };
}

function completedWinner(episode: BotEvidenceEpisode): PlayerId | null {
  if (episode.outcome.status !== 'completed') return null;
  const outcome = record(episode.outcome.value);
  const winner = outcome?.['winner'];
  if (winner === null || winner === 0 || winner === 1) return winner;
  throw new Error('learned dataset completed outcome has no valid winner');
}

/** Project safe native evidence into chosen-action Monte-Carlo examples. */
export function learnedExamplesFromEpisode(input: BotEvidenceEpisode): LearnedDatasetProjection {
  const episode = BotEvidenceEpisodeSchema.parse(input);
  if (episode.episode.stage !== 'gameplay' || episode.episode.runtime.kind !== 'native') {
    throw new Error('learned gameplay dataset requires native gameplay evidence');
  }
  if (
    episode.episode.features.schemaId !== LEARNED_FEATURE_SCHEMA.id ||
    episode.episode.features.schemaSha256 !== LEARNED_FEATURE_SCHEMA.sha256
  ) {
    throw new Error('learned gameplay dataset feature schema does not match the current encoder');
  }
  const examples: LearnedExample[] = [];
  let failed = 0;
  let forced = 0;
  let incomplete = 0;
  if (episode.outcome.status !== 'completed')
    return { examples, skipped: { failed: episode.decisions.length, forced, incomplete } };
  const winner = completedWinner(episode);
  for (const decision of episode.decisions) {
    if (decision.choice.status !== 'chosen') {
      failed += 1;
      continue;
    }
    if (decision.candidates.status !== 'complete') {
      incomplete += 1;
      continue;
    }
    const { action, view } = validatedDecision(decision);
    if (view.decision.options.length === 1) {
      forced += 1;
      continue;
    }
    examples.push({
      episodeId: episode.episode.id,
      sequence: decision.sequence,
      candidateId: actionKey(action),
      actionType: action.type,
      features: sparsifyLearnedFeatures(encodeLearnedCandidate(view, action)),
      return: winner === null ? 0 : winner === action.player ? 1 : -1,
      weight: 1,
    });
  }
  return { examples, skipped: { failed, forced, incomplete } };
}

/** Distill complete choices made by the eventual winner into candidate-level ranking labels. */
export function learnedPreferenceExamplesFromEpisode(input: BotEvidenceEpisode): LearnedDatasetProjection {
  const episode = BotEvidenceEpisodeSchema.parse(input);
  if (episode.episode.stage !== 'gameplay' || episode.episode.runtime.kind !== 'native') {
    throw new Error('learned gameplay dataset requires native gameplay evidence');
  }
  if (
    episode.episode.features.schemaId !== LEARNED_FEATURE_SCHEMA.id ||
    episode.episode.features.schemaSha256 !== LEARNED_FEATURE_SCHEMA.sha256
  ) {
    throw new Error('learned gameplay dataset feature schema does not match the current encoder');
  }
  const examples: LearnedExample[] = [];
  let failed = 0;
  let forced = 0;
  let incomplete = 0;
  if (episode.outcome.status !== 'completed') {
    return { examples, skipped: { failed: episode.decisions.length, forced, incomplete } };
  }
  const winner = completedWinner(episode);
  for (const decision of episode.decisions) {
    if (decision.choice.status !== 'chosen') {
      failed += 1;
      continue;
    }
    if (decision.candidates.status !== 'complete') {
      incomplete += 1;
      continue;
    }
    const { action, view } = validatedDecision(decision);
    if (view.decision.options.length === 1) {
      forced += 1;
      continue;
    }
    if (winner === null || action.player !== winner) continue;
    for (const option of view.decision.options) {
      const candidateId = actionKey(option);
      examples.push({
        episodeId: episode.episode.id,
        sequence: decision.sequence,
        candidateId,
        actionType: option.type,
        features: sparsifyLearnedFeatures(encodeLearnedCandidate(view, option)),
        return: candidateId === actionKey(action) ? 1 : -1,
        weight: 1,
      });
    }
  }
  return { examples, skipped: { failed, forced, incomplete } };
}
