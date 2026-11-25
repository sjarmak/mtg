import {
  actionKey,
  agentView,
  createRng,
  observeState,
  opponentOf,
  pendingDecision,
  reduce,
  settleAgentAction,
  shuffle,
  type Action,
  type AgentObservation,
  type AgentView,
  type DeckList,
  type Decision,
  type GameState,
  type ObjectId,
  type PlayerAgent,
  type PlayerId,
} from '@mtg/kernel';
import type { Card } from '@mtg/dsl';
import type { GreedyBotConfig, StateEvalConfig } from './config';
import { DEFAULT_GREEDY_CONFIG, DEFAULT_STATE_EVAL_CONFIG } from './config';
import { evaluateState } from './evaluate-state';
import { decideGreedy, greedyBot } from './greedy-bot';

export interface RolloutBotConfig {
  readonly greedy: GreedyBotConfig;
  readonly state: StateEvalConfig;
  /** Maximum one-ply evaluation distance from greedy that admits an alternative. */
  readonly closeMargin: number;
  readonly rolloutsPerCandidate: number;
  readonly maximumCandidates: number;
  readonly maximumRolloutsPerDecision: number;
  readonly turnHorizon: number;
  /**
   * Decision kinds the rollout may refine; every other decision plays greedy
   * exactly. Absent means every kind, which is the policy the 2026-09-24
   * head-to-head measured.
   */
  readonly decisionKinds?: readonly Decision['kind'][];
}

export const DEFAULT_ROLLOUT_CONFIG: RolloutBotConfig = {
  greedy: DEFAULT_GREEDY_CONFIG,
  state: DEFAULT_STATE_EVAL_CONFIG,
  closeMargin: 1,
  rolloutsPerCandidate: 2,
  maximumCandidates: 3,
  maximumRolloutsPerDecision: 6,
  turnHorizon: 3,
};

/**
 * Rollout limited to combat declarations, where a replay from the true state
 * finds a better alternative several times as often as at a priority stop.
 */
export const COMBAT_ROLLOUT_CONFIG: RolloutBotConfig = {
  ...DEFAULT_ROLLOUT_CONFIG,
  decisionKinds: ['declareAttackers', 'declareBlockers'],
};

export interface RolloutRequest {
  readonly seed: string;
  readonly turnHorizon: number;
  readonly greedy: GreedyBotConfig;
}

export interface RolloutAgentView extends AgentView {
  readonly rollout?: (action: Action, request: RolloutRequest) => AgentObservation;
}

/** Public information from which a seat may sample a possible hidden world. */
export interface RolloutKnowledge {
  /** The viewer's registered deck list. Its contents, but not its current order, are known. */
  readonly ownDeck: DeckList['cards'];
  /** The format collation pool from which the opponent's hidden cards were opened. */
  readonly opponentPool: readonly Card[];
  /** One decision-scoped stream shared by every candidate's one-ply comparison. */
  readonly previewSeed: string;
}

function positiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
}

function validateConfig(config: RolloutBotConfig): void {
  if (!Number.isFinite(config.closeMargin) || config.closeMargin < 0) {
    throw new Error('rollout close margin must be non-negative and finite');
  }
  positiveInteger('rollouts per candidate', config.rolloutsPerCandidate);
  positiveInteger('maximum candidates', config.maximumCandidates);
  positiveInteger('maximum rollouts per decision', config.maximumRolloutsPerDecision);
  positiveInteger('rollout turn horizon', config.turnHorizon);
  if (config.rolloutsPerCandidate * config.maximumCandidates > config.maximumRolloutsPerDecision) {
    throw new Error('rollout cap is smaller than rollouts per candidate times maximum candidates');
  }
}

function sameHorizonCandidates(view: AgentView, greedy: Action): readonly Action[] {
  if (!view.decision.complete || greedy.type === 'passPriority') return [greedy];
  const seen = new Set([actionKey(greedy)]);
  const alternatives: Action[] = [];
  for (const option of view.decision.options) {
    const key = actionKey(option);
    if (option.type !== greedy.type || seen.has(key)) continue;
    seen.add(key);
    alternatives.push(option);
  }
  return [greedy, ...alternatives];
}

function onePlyScore(config: RolloutBotConfig, view: AgentView, action: Action): number | null {
  if (view.previewSettled === undefined) return null;
  return evaluateState(config.greedy.cast, config.state, view.previewSettled(action), view.player);
}

function closeCandidates(config: RolloutBotConfig, view: AgentView, greedy: Action): readonly Action[] {
  const candidates = sameHorizonCandidates(view, greedy);
  if (candidates.length < 2) return [greedy];
  const reference = onePlyScore(config, view, greedy);
  if (reference === null) return [greedy];
  const close = candidates.filter((candidate) => {
    if (actionKey(candidate) === actionKey(greedy)) return true;
    const score = onePlyScore(config, view, candidate);
    return score !== null && Math.abs(score - reference) <= config.closeMargin;
  });
  return close.slice(0, config.maximumCandidates);
}

function rolloutSeed(gameSeed: string, decisionIndex: number, action: Action, rolloutIndex: number): string {
  return (
    `${gameSeed}/decision/${String(decisionIndex)}/candidate/` +
    `${encodeURIComponent(actionKey(action))}/rollout/${String(rolloutIndex)}`
  );
}

function rolloutScore(
  config: RolloutBotConfig,
  view: RolloutAgentView,
  action: Action,
  gameSeed: string,
  decisionIndex: number,
): number {
  if (view.rollout === undefined) return Number.NEGATIVE_INFINITY;
  let total = 0;
  for (let index = 0; index < config.rolloutsPerCandidate; index += 1) {
    const future = view.rollout(action, {
      seed: rolloutSeed(gameSeed, decisionIndex, action, index),
      turnHorizon: config.turnHorizon,
      greedy: config.greedy,
    });
    total += evaluateState(config.greedy.cast, config.state, future, view.player);
  }
  return total / config.rolloutsPerCandidate;
}

/** Refine a close greedy decision with bounded, deterministic future play. */
export function decideRollout(
  view: RolloutAgentView,
  config: RolloutBotConfig,
  gameSeed: string,
  decisionIndex: number,
): Action {
  validateConfig(config);
  const greedy = decideGreedy(view, config.greedy);
  if (config.decisionKinds !== undefined && !config.decisionKinds.includes(view.decision.kind)) return greedy;
  const candidates = closeCandidates(config, view, greedy);
  if (candidates.length < 2 || view.rollout === undefined) return greedy;

  let best = greedy;
  let bestScore = rolloutScore(config, view, greedy, gameSeed, decisionIndex);
  for (const candidate of candidates.slice(1)) {
    const score = rolloutScore(config, view, candidate, gameSeed, decisionIndex);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/** A rollout refinement. The mutable counter is private per game-agent instance. */
export function rolloutBot(
  name: string,
  gameSeed: string,
  config: RolloutBotConfig = DEFAULT_ROLLOUT_CONFIG,
): PlayerAgent {
  validateConfig(config);
  let decisionIndex = 0;
  return {
    name,
    decide(view) {
      const chosen = decideRollout(view, config, gameSeed, decisionIndex);
      decisionIndex += 1;
      return chosen;
    },
  };
}

const MAX_ROLLOUT_DECISIONS = 20_000;

function cardCounts(cards: readonly Card[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const card of cards) counts.set(card.id, (counts.get(card.id) ?? 0) + 1);
  return counts;
}

function withoutKnownCards(cards: readonly Card[], known: readonly Card[]): readonly Card[] {
  const removed = cardCounts(known);
  return cards.filter((card) => {
    const count = removed.get(card.id) ?? 0;
    if (count === 0) return true;
    removed.set(card.id, count - 1);
    return false;
  });
}

function visibleOwnedCards(view: AgentView, owner: PlayerId): readonly Card[] {
  return Object.values(view.state.objects)
    .filter((object) => object.owner === owner && !object.token)
    .map((object) => object.card);
}

function sampledCards(
  pool: readonly Card[],
  count: number,
  initialRng: ReturnType<typeof createRng>,
): readonly [readonly Card[], ReturnType<typeof createRng>] {
  if (count > 0 && pool.length === 0) {
    throw new Error('rollout opponent pool cannot be empty while hidden cards remain');
  }
  const sampled: Card[] = [];
  let rng = initialRng;
  while (sampled.length < count) {
    const [bag, advanced] = shuffle(pool, rng);
    rng = advanced;
    sampled.push(...bag.slice(0, count - sampled.length));
  }
  return [sampled, rng];
}

function assignedObjects(
  state: GameState,
  assignments: readonly (readonly [ObjectId, Card])[],
): GameState['objects'] {
  return assignments.reduce<GameState['objects']>((objects, [oid, card]) => {
    const object = objects[oid];
    if (object === undefined) throw new Error(`rollout hidden object ${oid} is missing`);
    return { ...objects, [oid]: { ...object, card } };
  }, state.objects);
}

function sampledOwnLibrary(
  view: AgentView,
  player: PlayerId,
  knowledge: RolloutKnowledge,
  count: number,
  rng: ReturnType<typeof createRng>,
): readonly [readonly Card[], ReturnType<typeof createRng>] {
  const remaining = withoutKnownCards(knowledge.ownDeck, visibleOwnedCards(view, player));
  if (remaining.length < count) {
    throw new Error(
      `rollout own deck accounts for ${String(remaining.length)} of ${String(count)} concealed library cards`,
    );
  }
  return shuffle(remaining, rng);
}

function sampledOpponentCards(
  view: AgentView,
  opponent: PlayerId,
  knowledge: RolloutKnowledge,
  count: number,
  rng: ReturnType<typeof createRng>,
): readonly [readonly Card[], ReturnType<typeof createRng>] {
  const source = withoutKnownCards(knowledge.opponentPool, visibleOwnedCards(view, opponent));
  return sampledCards(source, count, rng);
}

function concealedObjectIds(
  stateIds: readonly ObjectId[],
  observedIds: readonly ObjectId[],
  view: AgentView,
): readonly ObjectId[] {
  if (stateIds.length !== observedIds.length) {
    throw new Error('rollout observation zone counts do not match the authoritative state');
  }
  return stateIds.filter((_oid, index) => {
    const observed = observedIds[index];
    if (observed === undefined) {
      throw new Error('rollout observation is missing a zone slot');
    }
    return view.state.objects[observed] === undefined;
  });
}

/**
 * Sample one possible authoritative state without reading any concealed card identity.
 *
 * The real state contributes only its zone slots and public skeleton. Card identities
 * come from the viewer's known deck list and the caller-supplied format pool.
 */
function determinizedState(
  view: AgentView,
  state: GameState,
  knowledge: RolloutKnowledge,
  seed: string,
): GameState {
  const player = view.player;
  const opponent = opponentOf(player);
  const ownLibrary = concealedObjectIds(
    state.players[player].library,
    view.state.players[player].library,
    view,
  );
  const opponentHand = concealedObjectIds(
    state.players[opponent].hand,
    view.state.players[opponent].hand,
    view,
  );
  const opponentLibrary = concealedObjectIds(
    state.players[opponent].library,
    view.state.players[opponent].library,
    view,
  );

  const [ownOrder, afterOwn] = sampledOwnLibrary(
    view,
    player,
    knowledge,
    ownLibrary.length,
    createRng(`${seed}/determinization`),
  );
  const [opponentCards, afterOpponent] = sampledOpponentCards(
    view,
    opponent,
    knowledge,
    opponentHand.length + opponentLibrary.length,
    afterOwn,
  );
  const assignments: (readonly [ObjectId, Card])[] = [];
  for (const [index, oid] of ownLibrary.entries()) {
    const card = ownOrder[index];
    if (card !== undefined) assignments.push([oid, card]);
  }
  for (const [index, oid] of [...opponentHand, ...opponentLibrary].entries()) {
    const card = opponentCards[index];
    if (card !== undefined) assignments.push([oid, card]);
  }
  return {
    ...state,
    objects: assignedObjects(state, assignments),
    rng: afterOpponent,
    config: { ...state.config, seed: '' },
  };
}

function continueRollout(
  initial: GameState,
  action: Action,
  player: PlayerId,
  request: RolloutRequest,
): AgentObservation {
  const horizon = initial.turn.number + request.turnHorizon;
  const agents = [greedyBot('rollout-0', request.greedy), greedyBot('rollout-1', request.greedy)] as const;
  let current = reduce(initial, action).state;
  let decisions = 0;
  while (current.result === null && current.turn.number <= horizon) {
    if (decisions >= MAX_ROLLOUT_DECISIONS) {
      throw new Error(`rollout exceeded ${String(MAX_ROLLOUT_DECISIONS)} decisions`);
    }
    const decision = pendingDecision(current);
    if (decision === null) break;
    const agent = agents[decision.player];
    const view = agentView(current, decision.player, decision, `rollout:${String(decisions)}`, (candidate) =>
      settleAgentAction(current, candidate),
    );
    current = reduce(current, agent.decide(view)).state;
    decisions += 1;
  }
  return observeState(current, player, `rollout:${request.seed}:result`);
}

function playRollout(
  view: AgentView,
  state: GameState,
  knowledge: RolloutKnowledge,
  action: Action,
  player: PlayerId,
  request: RolloutRequest,
): AgentObservation {
  return continueRollout(determinizedState(view, state, knowledge, request.seed), action, player, request);
}

/** Add the sim-only callback when the driver can provide a public sampling source. */
export function withRolloutPreview(
  view: AgentView,
  state: GameState,
  knowledge?: RolloutKnowledge,
): RolloutAgentView {
  if (knowledge === undefined) return view;
  return {
    ...view,
    previewSettled: (action) =>
      observeState(
        settleAgentAction(determinizedState(view, state, knowledge, knowledge.previewSeed), action),
        view.player,
        `rollout:${knowledge.previewSeed}:preview`,
      ),
    rollout: (action, request) => playRollout(view, state, knowledge, action, view.player, request),
  };
}

/** Omniscient diagnostic ceiling. Never use this callback as a playable policy result. */
export function withPrivilegedRolloutPreview(view: AgentView, state: GameState): RolloutAgentView {
  return {
    ...view,
    rollout: (action, request) =>
      continueRollout({ ...state, rng: createRng(request.seed) }, action, view.player, request),
  };
}
