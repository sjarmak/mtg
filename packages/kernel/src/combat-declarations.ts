/** Exact cross-creature solving for attack and block declarations. */
import type { BlockDeclaration } from './actions';
import { blockRequirementCoverage, blockRequirements, maximizeBlockRequirements } from './block-requirements';
export {
  blockRequirementCoverage,
  blockRequirements,
  blockRequirementsReachable,
  maximizeBlockRequirements,
} from './block-requirements';
import {
  attackCohortRestriction,
  blockCohortRestriction,
  canBlock,
  canBlockAnyNumber,
  eligibleBlockers,
  hasCombatModification,
  hasTurnCombatRule,
  luredDefenders,
  validateBlocks,
} from './combat';
import type { ObjectId } from './ids';
import { opponentOf } from './ids';
import { hasKeyword } from './layers';
import type { CombatDefender, GameState } from './state';

interface AttackRequirement {
  readonly mustAttack: boolean;
  readonly lured: boolean;
  readonly turnScoped: boolean;
  readonly allowed: readonly CombatDefender[];
}

/** CR 508.1d's obligation and admitted defenders for one eligible attacker. */
export function attackRequirement(
  state: GameState,
  oid: ObjectId,
  defenders: readonly CombatDefender[],
): AttackRequirement {
  const lured = luredDefenders(state, oid).filter((player) => defenders.includes(player));
  const forcedByStatic = hasCombatModification(state, oid, 'attacksEachCombatIfAble');
  const forcedThisTurn = hasTurnCombatRule(state, oid, 'attacksThisTurnIfAble');
  if (lured.length === 0) {
    return {
      mustAttack: forcedByStatic || forcedThisTurn,
      lured: false,
      turnScoped: forcedThisTurn,
      allowed: defenders,
    };
  }
  return {
    mustAttack: true,
    lured: true,
    turnScoped: forcedThisTurn,
    allowed: defenders.filter((defender) => typeof defender === 'number' && lured.includes(defender)),
  };
}

/** Requirements that some legal declaration from this pool can satisfy. */
export function requiredAttackers(
  state: GameState,
  eligible: readonly ObjectId[],
  defenders: readonly CombatDefender[],
): ReadonlySet<ObjectId> {
  return new Set(
    eligible.filter((oid) => {
      if (!attackRequirement(state, oid, defenders).mustAttack) return false;
      return (
        !hasCombatModification(state, oid, 'cantAttackOrBlockAlone') ||
        eligible.some((candidate) => candidate !== oid)
      );
    }),
  );
}

/** Whether a prefix still has a completion obeying every attack requirement. */
export function attacksCompletable(
  state: GameState,
  chosen: readonly ObjectId[],
  later: readonly ObjectId[],
  required: ReadonlySet<ObjectId>,
): boolean {
  const minimum = [...chosen, ...later.filter((oid) => required.has(oid))];
  if (attackCohortRestriction(state, minimum) === null) return true;
  return later.some((oid) => !required.has(oid));
}

/** A must-be-blocked attacker and its remaining blocker count. */
interface BlockDemand {
  readonly attacker: ObjectId;
  readonly needs: number;
}

interface FlowEdge {
  readonly to: number;
  readonly reverse: number;
  readonly capacity: number;
  flow: number;
}

interface DemandFlow {
  readonly assignments: readonly BlockDeclaration[];
  readonly servedSlots: number;
}

function blockersRequired(state: GameState, attacker: ObjectId): number {
  return hasKeyword(state, attacker, 'menace') ? 2 : 1;
}

/** Maximum flow through blocker capacities and attacker demands. */
function demandFlow(
  state: GameState,
  demands: readonly BlockDemand[],
  blockers: readonly ObjectId[],
  occupied: readonly BlockDeclaration[] = [],
): DemandFlow {
  const source = 0;
  const blockerOffset = 1;
  const attackerOffset = blockerOffset + blockers.length;
  const sink = attackerOffset + demands.length;
  const graph: FlowEdge[][] = Array.from({ length: sink + 1 }, () => []);
  const addEdge = (from: number, to: number, capacity: number): FlowEdge => {
    const forward: FlowEdge = { to, reverse: graph[to]?.length ?? 0, capacity, flow: 0 };
    const reverse: FlowEdge = { to: from, reverse: graph[from]?.length ?? 0, capacity: 0, flow: 0 };
    graph[from]?.push(forward);
    graph[to]?.push(reverse);
    return forward;
  };
  const sinkEdges = new Map<ObjectId, FlowEdge>();
  const pairEdges = new Map<string, FlowEdge>();
  const pairKey = (blocker: ObjectId, attacker: ObjectId): string => `${blocker}\u0000${attacker}`;
  const occupiedPairs = new Set(occupied.map((block) => pairKey(block.blocker, block.attacker)));
  const occupiedBlockers = new Set(occupied.map((block) => block.blocker));

  for (const [index, blocker] of blockers.entries()) {
    const reachable = demands.filter(
      (demand) =>
        !occupiedPairs.has(pairKey(blocker, demand.attacker)) && canBlock(state, blocker, demand.attacker),
    );
    const capacity = canBlockAnyNumber(state, blocker)
      ? reachable.length
      : occupiedBlockers.has(blocker)
        ? 0
        : Math.min(1, reachable.length);
    addEdge(source, blockerOffset + index, capacity);
    for (const demand of reachable) {
      const demandIndex = demands.indexOf(demand);
      pairEdges.set(
        pairKey(blocker, demand.attacker),
        addEdge(blockerOffset + index, attackerOffset + demandIndex, 1),
      );
    }
  }
  for (const [index, demand] of demands.entries()) {
    sinkEdges.set(demand.attacker, addEdge(attackerOffset + index, sink, demand.needs));
  }

  const changeFlow = (edge: FlowEdge, delta: number): void => {
    edge.flow += delta;
    const reverse = graph[edge.to]?.[edge.reverse];
    if (reverse === undefined) throw new Error('demandFlow: reverse edge is missing');
    reverse.flow -= delta;
  };
  for (;;) {
    const parents: ({ readonly from: number; readonly edge: number } | null)[] = Array.from(
      { length: graph.length },
      () => null,
    );
    const queue = [source];
    for (let at = 0; at < queue.length && parents[sink] === null; at += 1) {
      const from = queue[at];
      if (from === undefined) continue;
      for (const [edgeIndex, edge] of (graph[from] ?? []).entries()) {
        if (edge.capacity - edge.flow <= 0 || edge.to === source || parents[edge.to] !== null) continue;
        parents[edge.to] = { from, edge: edgeIndex };
        queue.push(edge.to);
        if (edge.to === sink) break;
      }
    }
    if (parents[sink] === null) break;
    let cursor = sink;
    while (cursor !== source) {
      const parent = parents[cursor];
      if (parent === null || parent === undefined) {
        throw new Error('demandFlow: augmenting path is incomplete');
      }
      const edge = graph[parent.from]?.[parent.edge];
      if (edge === undefined) throw new Error('demandFlow: augmenting edge is missing');
      changeFlow(edge, 1);
      cursor = parent.from;
    }
  }

  const assignments: BlockDeclaration[] = [];
  for (const blocker of blockers) {
    for (const demand of demands) {
      if ((pairEdges.get(pairKey(blocker, demand.attacker))?.flow ?? 0) > 0) {
        assignments.push({ blocker, attacker: demand.attacker });
      }
    }
  }
  const servedSlots = [...sinkEdges.values()].reduce((sum, edge) => sum + edge.flow, 0);
  return { assignments, servedSlots };
}

function serveDemands(
  state: GameState,
  demands: readonly BlockDemand[],
  blockers: readonly ObjectId[],
  occupied: readonly BlockDeclaration[] = [],
): readonly BlockDeclaration[] | null {
  const result = demandFlow(state, demands, blockers, occupied);
  const needed = demands.reduce((sum, demand) => sum + demand.needs, 0);
  return result.servedSlots === needed ? result.assignments : null;
}

/** Completes a sole restricted blocker plus any menace deficit it creates. */
function completeBlockCohort(
  state: GameState,
  blocks: readonly BlockDeclaration[],
  available: readonly ObjectId[],
): readonly BlockDeclaration[] | null {
  if (blockCohortRestriction(state, blocks) === null) return blocks;
  const defender = opponentOf(state.turn.active);
  const used = new Set(blocks.map((block) => block.blocker));
  for (const blocker of available) {
    if (used.has(blocker)) continue;
    for (const attack of state.combat.attacks) {
      if (!canBlock(state, blocker, attack.oid)) continue;
      const candidate = [...blocks, { blocker, attacker: attack.oid }];
      const counts = new Map<ObjectId, number>();
      for (const block of candidate) {
        counts.set(block.attacker, (counts.get(block.attacker) ?? 0) + 1);
      }
      const menaceDemands = [...counts]
        .filter(([attacker, count]) => count === 1 && hasKeyword(state, attacker, 'menace'))
        .map(([attacker]): BlockDemand => ({ attacker, needs: 1 }));
      const supplied = serveDemands(state, menaceDemands, available, candidate);
      if (supplied === null) continue;
      const completed = [...candidate, ...supplied];
      if (validateBlocks(state, defender, completed) === null) return completed;
    }
  }
  return null;
}

function finalizeConstructedBlocks(
  state: GameState,
  blocks: readonly BlockDeclaration[],
  eligible: readonly ObjectId[],
): readonly BlockDeclaration[] {
  const defender = opponentOf(state.turn.active);
  if (validateBlocks(state, defender, blocks) === null) return blocks;

  const counts = new Map<ObjectId, number>();
  for (const block of blocks) counts.set(block.attacker, (counts.get(block.attacker) ?? 0) + 1);
  const legalMenaceGroups = blocks.filter(
    (block) => (counts.get(block.attacker) ?? 0) >= blockersRequired(state, block.attacker),
  );
  const completed = completeBlockCohort(state, legalMenaceGroups, eligible);
  if (completed !== null && validateBlocks(state, defender, completed) === null) return completed;

  const blockers = [...new Set(legalMenaceGroups.map((block) => block.blocker))];
  const lone = blockers.length === 1 ? blockers[0] : undefined;
  if (lone !== undefined && blockCohortRestriction(state, legalMenaceGroups) !== null) {
    const withoutLoneBlocker = legalMenaceGroups.filter((block) => block.blocker !== lone);
    if (validateBlocks(state, defender, withoutLoneBlocker) === null) return withoutLoneBlocker;
  }
  throw new Error('satisfyMustBeBlocked: constructed blocks have no legal declaration-level completion');
}

/** Repairs a constructed block declaration to obey requirements and restrictions. */
export function satisfyMustBeBlocked(
  state: GameState,
  blocks: readonly BlockDeclaration[],
): readonly BlockDeclaration[] {
  const eligible = eligibleBlockers(state);
  const requirements = blockRequirements(state);
  if (requirements.length === 0) return finalizeConstructedBlocks(state, blocks, eligible);
  const solution = maximizeBlockRequirements(state, requirements, eligible);
  if (blockRequirementCoverage(state, blocks, requirements) >= solution.coverage) {
    return finalizeConstructedBlocks(state, blocks, eligible);
  }

  const repaired: BlockDeclaration[] = [...solution.blocks];
  for (const block of blocks) {
    if (
      repaired.some(
        (requiredBlock) =>
          requiredBlock.blocker === block.blocker && requiredBlock.attacker === block.attacker,
      )
    ) {
      continue;
    }
    if (
      !canBlockAnyNumber(state, block.blocker) &&
      repaired.some((requiredBlock) => requiredBlock.blocker === block.blocker)
    ) {
      continue;
    }
    repaired.push(block);
  }
  return finalizeConstructedBlocks(state, repaired, eligible);
}
