import {
  actionKey,
  agentView,
  createGame,
  pendingDecision,
  playOut,
  reduce,
  settleAgentAction,
  type Action,
  type AgentView,
  type GameSetup,
  type GameState,
  type PlayerAgent,
  type PlayerId,
} from '@mtg/kernel';
import { encodeLearnedCandidate, sparsifyLearnedFeatures } from './learned-evaluator';
import type { LearnedExample } from './learned-dataset';

export interface LearnedBranchDatasetOptions {
  readonly episodeId: string;
  readonly setup: GameSetup;
  readonly reference: readonly [PlayerAgent, PlayerAgent];
  /** When present, branch only when this policy proposes leaving the reference action. */
  readonly challenger?: readonly [PlayerAgent, PlayerAgent];
  /** Sample one eligible decision out of each consecutive group this wide. */
  readonly sampleEvery: number;
  /** Per-game cap on the expensive alternative continuations. */
  readonly maximumBranches: number;
}

export interface LearnedBranchDatasetProjection {
  /** Broad behavior-policy labels used to initialize the scorer. */
  readonly preferenceExamples: readonly LearnedExample[];
  /** Paired, centered targets from a chosen and an unchosen continuation. */
  readonly advantageExamples: readonly LearnedExample[];
  readonly cost: {
    readonly baselineGames: 1;
    readonly baselineDecisions: number;
    readonly eligibleDecisions: number;
    readonly sampledDecisions: number;
    readonly sensitiveDecisions: number;
    readonly branchRollouts: number;
  };
}

interface PreferenceDraft {
  readonly sequence: number;
  readonly player: PlayerId;
  readonly chosenId: string;
  readonly view: AgentView;
}

interface AdvantageDraft {
  readonly sequence: number;
  readonly player: PlayerId;
  readonly chosen: Action;
  readonly alternative: Action;
  readonly view: AgentView;
  readonly alternativeUtility: number;
}

interface CollectedDrafts {
  readonly state: GameState;
  readonly decisions: number;
  readonly eligible: number;
  readonly preferences: readonly PreferenceDraft[];
  readonly advantages: readonly AdvantageDraft[];
}

const OUTCOME_UTILITY_WEIGHT = 0.9;
const LIFE_UTILITY_WEIGHT = 0.05;
const SPEED_UTILITY_WEIGHT = 0.05;

function positiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
}

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/** Center a pair so each label is the option's utility minus the decision mean. */
export function centeredBranchAdvantages(
  chosenUtility: number,
  alternativeUtility: number,
): [number, number] {
  if (!Number.isFinite(chosenUtility) || !Number.isFinite(alternativeUtility)) {
    throw new Error('branch utilities must be finite');
  }
  const chosen = clamp((chosenUtility - alternativeUtility) / 2);
  if (chosen === 0) return [0, 0];
  return [chosen, -chosen];
}

/** Bounded terminal utility from one decision maker's perspective. */
function terminalUtility(state: GameState, player: PlayerId): number {
  const result = state.result;
  if (result === null) throw new Error('branch continuation stopped without a result');
  const opponent: PlayerId = player === 0 ? 1 : 0;
  const outcome = result.winner === null ? 0 : result.winner === player ? 1 : -1;
  const lifeMargin = clamp(
    ((state.players[player].life ?? 0) - (state.players[opponent].life ?? 0)) / state.config.startingLife,
  );
  const speed = outcome * clamp(1 - result.endedOnTurn / state.config.maximumTurns);
  return clamp(
    outcome * OUTCOME_UTILITY_WEIGHT + lifeMargin * LIFE_UTILITY_WEIGHT + speed * SPEED_UTILITY_WEIGHT,
  );
}

function example(
  episodeId: string,
  sequence: number,
  view: AgentView,
  action: Action,
  returnValue: number,
): LearnedExample {
  return {
    episodeId,
    sequence,
    candidateId: actionKey(action),
    actionType: action.type,
    features: sparsifyLearnedFeatures(encodeLearnedCandidate(view, action)),
    return: returnValue,
    weight: 1,
  };
}

function continuationUtility(
  state: GameState,
  action: Action,
  player: PlayerId,
  reference: readonly [PlayerAgent, PlayerAgent],
): number {
  const forced = reduce(state, action).state;
  return terminalUtility(playOut(forced, reference).state, player);
}

function alternativeFor(
  options: LearnedBranchDatasetOptions,
  view: AgentView,
  chosenId: string,
  branchIndex: number,
): Action | null {
  const alternatives = view.decision.options.filter((candidate) => actionKey(candidate) !== chosenId);
  const proposed = options.challenger?.[view.player].decide(view);
  if (proposed === undefined) return alternatives[branchIndex % alternatives.length] ?? null;
  if (actionKey(proposed) === chosenId) return null;
  const alternative = alternatives.find((candidate) => actionKey(candidate) === actionKey(proposed));
  if (alternative === undefined) throw new Error('branch challenger proposed an unavailable alternative');
  return alternative;
}

function collectDrafts(options: LearnedBranchDatasetOptions): CollectedDrafts {
  let state = createGame(options.setup).state;
  let decisions = 0;
  let eligible = 0;
  const preferences: PreferenceDraft[] = [];
  const advantages: AdvantageDraft[] = [];
  for (;;) {
    const decision = pendingDecision(state);
    if (decision === null) break;
    const view = agentView(state, decision.player, decision, `branch:${String(decisions)}`, (candidate) =>
      settleAgentAction(state, candidate),
    );
    const chosen = options.reference[decision.player].decide(view);
    const chosenId = actionKey(chosen);
    if (view.decision.complete && view.decision.kind !== 'cardName' && view.decision.options.length >= 2) {
      preferences.push({ sequence: decisions, player: decision.player, chosenId, view });
      const eligibleIndex = eligible;
      eligible += 1;
      if (eligibleIndex % options.sampleEvery === 0 && advantages.length < options.maximumBranches) {
        const alternative = alternativeFor(options, view, chosenId, advantages.length);
        if (alternative !== null) {
          advantages.push({
            sequence: decisions,
            player: decision.player,
            chosen,
            alternative,
            view,
            alternativeUtility: continuationUtility(state, alternative, decision.player, options.reference),
          });
        }
      }
    }
    state = reduce(state, chosen).state;
    decisions += 1;
  }
  return { state, decisions, eligible, preferences, advantages };
}

function preferenceExamplesOf(
  episodeId: string,
  drafts: readonly PreferenceDraft[],
  winner: PlayerId | null,
): readonly LearnedExample[] {
  return drafts.flatMap((draft) =>
    winner === null || draft.player !== winner
      ? []
      : draft.view.decision.options.map((action) =>
          example(
            episodeId,
            draft.sequence,
            draft.view,
            action,
            actionKey(action) === draft.chosenId ? 1 : -1,
          ),
        ),
  );
}

function advantageExamplesOf(
  episodeId: string,
  drafts: readonly AdvantageDraft[],
  finalState: GameState,
): { readonly examples: readonly LearnedExample[]; readonly sensitive: number } {
  let sensitive = 0;
  const examples = drafts.flatMap((draft) => {
    const [chosen, alternative] = centeredBranchAdvantages(
      terminalUtility(finalState, draft.player),
      draft.alternativeUtility,
    );
    if (chosen !== 0) sensitive += 1;
    return [
      example(episodeId, draft.sequence, draft.view, draft.chosen, chosen),
      example(episodeId, draft.sequence, draft.view, draft.alternative, alternative),
    ];
  });
  return { examples, sensitive };
}

/**
 * Play one reference game and fork one alternative at each sampled decision.
 *
 * The reference game itself is the chosen continuation, so a sample costs one
 * additional rollout rather than replaying both sides. Both continuations start
 * at the same immutable state and therefore share the same RNG prefix.
 */
export function learnedBranchExamplesFromGame(
  options: LearnedBranchDatasetOptions,
): LearnedBranchDatasetProjection {
  if (options.episodeId.length === 0) throw new Error('branch episodeId must be non-empty');
  positiveInteger('branch sampleEvery', options.sampleEvery);
  positiveInteger('branch maximumBranches', options.maximumBranches);

  const drafts = collectDrafts(options);
  const winner = drafts.state.result?.winner ?? null;
  const preferenceExamples = preferenceExamplesOf(options.episodeId, drafts.preferences, winner);
  const advantages = advantageExamplesOf(options.episodeId, drafts.advantages, drafts.state);

  return {
    preferenceExamples,
    advantageExamples: advantages.examples,
    cost: {
      baselineGames: 1,
      baselineDecisions: drafts.decisions,
      eligibleDecisions: drafts.eligible,
      sampledDecisions: drafts.advantages.length,
      sensitiveDecisions: advantages.sensitive,
      branchRollouts: drafts.advantages.length,
    },
  };
}
