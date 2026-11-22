/** Exact joint optimization for CR 509.1c block requirements. */
import type { BlockDeclaration } from './actions';
import {
  blockCohortRestriction,
  canBlock,
  canBlockAnyNumber,
  eligibleBlockers,
  hasCombatModification,
  hasTurnCombatRule,
  validateBlocks,
} from './combat';
import type { ObjectId } from './ids';
import { opponentOf } from './ids';
import { hasKeyword } from './layers';
import type { GameState } from './state';

interface FlowEdge {
  readonly to: number;
  readonly reverse: number;
  readonly capacity: number;
  flow: number;
}

function blockersRequired(state: GameState, attacker: ObjectId): number {
  return hasKeyword(state, attacker, 'menace') ? 2 : 1;
}

export type BlockRequirement =
  | { readonly kind: 'attacker'; readonly oid: ObjectId }
  | { readonly kind: 'blocker'; readonly oid: ObjectId };

interface RequirementSolution {
  readonly coverage: number;
  readonly blocks: readonly BlockDeclaration[];
}

/** Every CR 509.1c requirement in the declaration, without family priority. */
export function blockRequirements(state: GameState): readonly BlockRequirement[] {
  const attackers = state.combat.attacks
    .map((attack) => attack.oid)
    .filter((attacker) => hasCombatModification(state, attacker, 'mustBeBlockedIfAble'))
    .map((oid): BlockRequirement => ({ kind: 'attacker', oid }));
  const blockers = eligibleBlockers(state)
    .filter((blocker) => hasTurnCombatRule(state, blocker, 'blocksThisTurnIfAble'))
    .map((oid): BlockRequirement => ({ kind: 'blocker', oid }));
  return [...attackers, ...blockers];
}

/** Requirements satisfied by one complete or partial declaration. */
export function blockRequirementCoverage(
  state: GameState,
  blocks: readonly BlockDeclaration[],
  requirements: readonly BlockRequirement[],
): number {
  const attackerCounts = new Map<ObjectId, number>();
  const usedBlockers = new Set<ObjectId>();
  for (const block of blocks) {
    attackerCounts.set(block.attacker, (attackerCounts.get(block.attacker) ?? 0) + 1);
    usedBlockers.add(block.blocker);
  }
  return requirements.filter((requirement) =>
    requirement.kind === 'attacker'
      ? (attackerCounts.get(requirement.oid) ?? 0) >= blockersRequired(state, requirement.oid)
      : usedBlockers.has(requirement.oid),
  ).length;
}

interface CostFlowEdge extends FlowEdge {
  readonly cost: number;
}

function addCostEdge(
  graph: CostFlowEdge[][],
  from: number,
  to: number,
  capacity: number,
  cost: number,
): CostFlowEdge {
  const forward: CostFlowEdge = {
    to,
    reverse: graph[to]?.length ?? 0,
    capacity,
    flow: 0,
    cost,
  };
  const reverse: CostFlowEdge = {
    to: from,
    reverse: graph[from]?.length ?? 0,
    capacity: 0,
    flow: 0,
    cost: -cost,
  };
  graph[from]?.push(forward);
  graph[to]?.push(reverse);
  return forward;
}

/** Sends a fixed flow along deterministic least-cost residual paths. */
function pushMinimumCostFlow(graph: CostFlowEdge[][], source: number, sink: number, amount: number): boolean {
  let sent = 0;
  while (sent < amount) {
    const distance = Array.from({ length: graph.length }, () => Number.POSITIVE_INFINITY);
    const parents: ({ readonly from: number; readonly edge: number } | null)[] = Array.from(
      { length: graph.length },
      () => null,
    );
    distance[source] = 0;
    for (let pass = 1; pass < graph.length; pass += 1) {
      let changed = false;
      for (let from = 0; from < graph.length; from += 1) {
        const fromDistance = distance[from];
        if (fromDistance === undefined || !Number.isFinite(fromDistance)) continue;
        for (const [edgeIndex, edge] of (graph[from] ?? []).entries()) {
          if (edge.capacity - edge.flow <= 0) continue;
          const candidate = fromDistance + edge.cost;
          if (candidate >= (distance[edge.to] ?? Number.POSITIVE_INFINITY)) continue;
          distance[edge.to] = candidate;
          parents[edge.to] = { from, edge: edgeIndex };
          changed = true;
        }
      }
      if (!changed) break;
    }
    if (parents[sink] === null) return false;
    let delta = amount - sent;
    for (let cursor = sink; cursor !== source;) {
      const parent = parents[cursor];
      if (parent === null || parent === undefined) return false;
      const edge = graph[parent.from]?.[parent.edge];
      if (edge === undefined) return false;
      delta = Math.min(delta, edge.capacity - edge.flow);
      cursor = parent.from;
    }
    for (let cursor = sink; cursor !== source;) {
      const parent = parents[cursor];
      if (parent === null || parent === undefined) return false;
      const edge = graph[parent.from]?.[parent.edge];
      if (edge === undefined) return false;
      edge.flow += delta;
      const reverse = graph[edge.to]?.[edge.reverse];
      if (reverse === undefined) return false;
      reverse.flow -= delta;
      cursor = parent.from;
    }
    sent += delta;
  }
  return true;
}

interface CostedRequirementOptions {
  readonly blockedMenace: ReadonlySet<ObjectId>;
  readonly forcedBlocker?: ObjectId;
  readonly forbiddenBlocker?: ObjectId;
}

interface RequirementNetwork {
  readonly graph: CostFlowEdge[][];
  readonly source: number;
  readonly blockerOffset: number;
  readonly attackerOffset: number;
  readonly sink: number;
  readonly attackers: readonly ObjectId[];
  readonly available: readonly ObjectId[];
  readonly occupiedPairs: ReadonlySet<string>;
  readonly occupiedBlockers: ReadonlySet<ObjectId>;
  readonly occupiedCounts: ReadonlyMap<ObjectId, number>;
  readonly requiredBlockers: ReadonlySet<ObjectId>;
  readonly requiredAttackers: ReadonlySet<ObjectId>;
  readonly pairEdges: Map<string, CostFlowEdge>;
  readonly forcedMenaceEdges: Map<ObjectId, CostFlowEdge>;
  readonly forceCost: number;
}

const pairKey = (blocker: ObjectId, attacker: ObjectId): string => `${blocker}\u0000${attacker}`;

function addBlockerSide(
  state: GameState,
  network: RequirementNetwork,
  options: CostedRequirementOptions,
): { readonly capacity: number; readonly forced: CostFlowEdge | null } | null {
  let capacity = 0;
  let forcedEdge: CostFlowEdge | null = null;
  for (const [index, blocker] of network.available.entries()) {
    if (blocker === options.forbiddenBlocker) continue;
    const legal = network.attackers.filter(
      (attacker) =>
        !network.occupiedPairs.has(pairKey(blocker, attacker)) &&
        canBlock(state, blocker, attacker) &&
        (!hasKeyword(state, attacker, 'menace') ||
          (network.occupiedCounts.get(attacker) ?? 0) >= 2 ||
          options.blockedMenace.has(attacker)),
    );
    const used = network.occupiedBlockers.has(blocker);
    const upper = canBlockAnyNumber(state, blocker) ? legal.length : used ? 0 : Math.min(1, legal.length);
    if (options.forcedBlocker === blocker && !used && upper === 0) return null;
    if (upper === 0) continue;
    const reward = network.requiredBlockers.has(blocker) && !used ? 1 : 0;
    const forced = options.forcedBlocker === blocker && !used;
    const first = addCostEdge(
      network.graph,
      network.source,
      network.blockerOffset + index,
      1,
      -reward - (forced ? network.forceCost : 0),
    );
    if (forced) forcedEdge = first;
    if (upper > 1) addCostEdge(network.graph, network.source, network.blockerOffset + index, upper - 1, 0);
    capacity += upper;
    for (const attacker of legal) {
      const attackerIndex = network.attackers.indexOf(attacker);
      network.pairEdges.set(
        pairKey(blocker, attacker),
        addCostEdge(
          network.graph,
          network.blockerOffset + index,
          network.attackerOffset + attackerIndex,
          1,
          0,
        ),
      );
    }
  }
  return { capacity, forced: forcedEdge };
}

function addAttackerSide(
  state: GameState,
  network: RequirementNetwork,
  blockedMenace: ReadonlySet<ObjectId>,
): boolean {
  for (const [index, attacker] of network.attackers.entries()) {
    const occupiedCount = network.occupiedCounts.get(attacker) ?? 0;
    const menaceNeeded =
      hasKeyword(state, attacker, 'menace') && blockedMenace.has(attacker)
        ? Math.max(0, 2 - occupiedCount)
        : 0;
    const incoming = network.available.filter((blocker) =>
      network.pairEdges.has(pairKey(blocker, attacker)),
    ).length;
    if (menaceNeeded > incoming) return false;
    if (menaceNeeded > 0) {
      network.forcedMenaceEdges.set(
        attacker,
        addCostEdge(
          network.graph,
          network.attackerOffset + index,
          network.sink,
          menaceNeeded,
          -network.forceCost,
        ),
      );
    }
    const remaining = incoming - menaceNeeded;
    if (remaining <= 0) continue;
    const rewarded =
      !hasKeyword(state, attacker, 'menace') &&
      network.requiredAttackers.has(attacker) &&
      occupiedCount === 0;
    addCostEdge(
      network.graph,
      network.attackerOffset + index,
      network.sink,
      rewarded ? 1 : remaining,
      rewarded ? -1 : 0,
    );
    if (rewarded && remaining > 1) {
      addCostEdge(network.graph, network.attackerOffset + index, network.sink, remaining - 1, 0);
    }
  }
  return true;
}

function assignedBlocks(network: RequirementNetwork): readonly BlockDeclaration[] {
  return network.available.flatMap((blocker) =>
    network.attackers
      .filter((attacker) => (network.pairEdges.get(pairKey(blocker, attacker))?.flow ?? 0) > 0)
      .map((attacker) => ({ blocker, attacker })),
  );
}

/** Best vertex-reward block assignment for one all-or-nothing menace choice. */
function costedRequirementFlow(
  state: GameState,
  requirements: readonly BlockRequirement[],
  available: readonly ObjectId[],
  occupied: readonly BlockDeclaration[],
  options: CostedRequirementOptions,
): readonly BlockDeclaration[] | null {
  const attackers = state.combat.attacks.map((attack) => attack.oid);
  const occupiedPairs = new Set(occupied.map((block) => `${block.blocker}\u0000${block.attacker}`));
  const occupiedBlockers = new Set(occupied.map((block) => block.blocker));
  const occupiedCounts = new Map<ObjectId, number>();
  for (const block of occupied) {
    occupiedCounts.set(block.attacker, (occupiedCounts.get(block.attacker) ?? 0) + 1);
  }
  const requiredBlockers = new Set(
    requirements
      .filter((requirement) => requirement.kind === 'blocker')
      .map((requirement) => requirement.oid),
  );
  const requiredAttackers = new Set(
    requirements
      .filter((requirement) => requirement.kind === 'attacker')
      .map((requirement) => requirement.oid),
  );

  const source = 0;
  const blockerOffset = 1;
  const attackerOffset = blockerOffset + available.length;
  const sink = attackerOffset + attackers.length;
  const network: RequirementNetwork = {
    graph: Array.from({ length: sink + 1 }, () => []),
    source,
    blockerOffset,
    attackerOffset,
    sink,
    attackers,
    available,
    occupiedPairs,
    occupiedBlockers,
    occupiedCounts,
    requiredBlockers,
    requiredAttackers,
    pairEdges: new Map(),
    forcedMenaceEdges: new Map(),
    forceCost: requirements.length + available.length + attackers.length + 1,
  };
  const blockerSide = addBlockerSide(state, network, options);
  if (blockerSide === null) return null;
  if (
    options.forcedBlocker !== undefined &&
    !occupiedBlockers.has(options.forcedBlocker) &&
    blockerSide.forced === null
  ) {
    return null;
  }
  if (!addAttackerSide(state, network, options.blockedMenace)) return null;
  addCostEdge(network.graph, source, sink, blockerSide.capacity, 0);
  if (!pushMinimumCostFlow(network.graph, source, sink, blockerSide.capacity)) return null;
  if ((blockerSide.forced?.flow ?? 1) < 1) return null;
  for (const attacker of options.blockedMenace) {
    const needed = Math.max(0, 2 - (occupiedCounts.get(attacker) ?? 0));
    const supplied = network.forcedMenaceEdges.get(attacker)?.flow ?? 0;
    if (supplied < needed) return null;
  }
  const completed = [...occupied, ...assignedBlocks(network)];
  return validateBlocks(state, opponentOf(state.turn.active), completed) === null ? completed : null;
}

function betterRequirementSolution(
  candidate: RequirementSolution | null,
  current: RequirementSolution | null,
): RequirementSolution | null {
  if (candidate === null) return current;
  if (current === null || candidate.coverage > current.coverage) return candidate;
  if (candidate.coverage < current.coverage) return current;
  const key = (solution: RequirementSolution): string =>
    solution.blocks.map((block) => `${block.blocker}:${block.attacker}`).join('|');
  return key(candidate) < key(current) ? candidate : current;
}

function solveMenaceChoice(
  state: GameState,
  requirements: readonly BlockRequirement[],
  available: readonly ObjectId[],
  occupied: readonly BlockDeclaration[],
  blockedMenace: ReadonlySet<ObjectId>,
): RequirementSolution | null {
  const solve = (forcedBlocker?: ObjectId, forbiddenBlocker?: ObjectId): RequirementSolution | null => {
    const blocks = costedRequirementFlow(state, requirements, available, occupied, {
      blockedMenace,
      ...(forcedBlocker === undefined ? {} : { forcedBlocker }),
      ...(forbiddenBlocker === undefined ? {} : { forbiddenBlocker }),
    });
    return blocks === null
      ? null
      : { coverage: blockRequirementCoverage(state, blocks, requirements), blocks };
  };
  let best = solve();
  if (best !== null) return best;
  for (const blocker of available) best = betterRequirementSolution(solve(blocker), best);
  for (const blocker of available) best = betterRequirementSolution(solve(undefined, blocker), best);
  return best;
}

interface MenaceChoiceGroup {
  readonly members: readonly ObjectId[];
  readonly required: boolean;
}

function menacePairKey(left: number, right: number): string {
  return left < right ? `${String(left)}:${String(right)}` : `${String(right)}:${String(left)}`;
}

function incompatibleMenaceGroups(
  state: GameState,
  groups: readonly MenaceChoiceGroup[],
  available: readonly ObjectId[],
  occupied: readonly BlockDeclaration[],
): ReadonlySet<string> {
  const incompatible = new Set<string>();
  for (let leftIndex = 0; leftIndex < groups.length; leftIndex += 1) {
    const left = groups[leftIndex]?.members[0];
    if (left === undefined) continue;
    const firstRight = groups[leftIndex]?.members[1];
    const candidates = [
      ...(firstRight === undefined ? [] : [{ index: leftIndex, attacker: firstRight }]),
      ...groups.slice(leftIndex + 1).flatMap((group, offset) => {
        const attacker = group.members[0];
        return attacker === undefined ? [] : [{ index: leftIndex + offset + 1, attacker }];
      }),
    ];
    for (const right of candidates) {
      const blocks = costedRequirementFlow(state, [], available, occupied, {
        blockedMenace: new Set([left, right.attacker]),
      });
      if (blocks === null) incompatible.add(menacePairKey(leftIndex, right.index));
    }
  }
  return incompatible;
}

function pairwiseCompatible(
  attackers: readonly ObjectId[],
  groupOf: ReadonlyMap<ObjectId, number>,
  incompatible: ReadonlySet<string>,
): boolean {
  for (let leftIndex = 0; leftIndex < attackers.length; leftIndex += 1) {
    const left = groupOf.get(attackers[leftIndex] ?? '');
    if (left === undefined) continue;
    if (
      attackers
        .slice(leftIndex + 1)
        .some((attacker) => incompatible.has(menacePairKey(left, groupOf.get(attacker) ?? -1)))
    ) {
      return false;
    }
  }
  return true;
}

/** Exact maximum across attacker-relative and blocker-relative CR 509.1c requirements. */
export function maximizeBlockRequirements(
  state: GameState,
  requirements: readonly BlockRequirement[],
  available: readonly ObjectId[],
  occupied: readonly BlockDeclaration[] = [],
): RequirementSolution {
  if (requirements.length === 0 && occupied.length === 0) return { coverage: 0, blocks: [] };
  const occupiedCounts = new Map<ObjectId, number>();
  const occupiedPairs = new Set<string>();
  const occupiedBlockers = new Set<ObjectId>();
  for (const block of occupied) {
    occupiedCounts.set(block.attacker, (occupiedCounts.get(block.attacker) ?? 0) + 1);
    occupiedPairs.add(`${block.blocker}\u0000${block.attacker}`);
    occupiedBlockers.add(block.blocker);
  }
  const fallback = (): RequirementSolution => ({
    coverage: blockRequirementCoverage(state, occupied, requirements),
    blocks: occupied,
  });
  const requiredAttackers = new Set(
    requirements
      .filter((requirement) => requirement.kind === 'attacker')
      .map((requirement) => requirement.oid),
  );
  const requiredMenace = new Set(
    [...requiredAttackers].filter((attacker) => hasKeyword(state, attacker, 'menace')),
  );
  const unmetRequiredBlockers = new Set(
    requirements
      .filter((requirement) => requirement.kind === 'blocker')
      .map((requirement) => requirement.oid)
      .filter((blocker) => !occupiedBlockers.has(blocker)),
  );
  const cohortMayMatter =
    blockCohortRestriction(state, occupied) !== null ||
    available.some(
      (blocker) =>
        hasCombatModification(state, blocker, 'cantAttackOrBlockAlone') &&
        (unmetRequiredBlockers.has(blocker) ||
          [...requiredAttackers].some((attacker) => canBlock(state, blocker, attacker))),
    );
  const scoringMenace: ObjectId[] = [];
  const cohortOnlyMenace: ObjectId[] = [];
  for (const attack of state.combat.attacks) {
    const attacker = attack.oid;
    const occupiedCount = occupiedCounts.get(attacker) ?? 0;
    if (!hasKeyword(state, attacker, 'menace') || occupiedCount >= 2) continue;
    const legal = available.filter(
      (blocker) => !occupiedPairs.has(`${blocker}\u0000${attacker}`) && canBlock(state, blocker, attacker),
    );
    const affectsScore =
      requiredMenace.has(attacker) || legal.some((blocker) => unmetRequiredBlockers.has(blocker));
    if (!affectsScore && !cohortMayMatter && occupiedCount === 0) continue;
    if (legal.length < 2 - occupiedCount) {
      if (occupiedCount > 0) return fallback();
      continue;
    }
    if (affectsScore || occupiedCount > 0) scoringMenace.push(attacker);
    else cohortOnlyMenace.push(attacker);
  }
  const attackers = state.combat.attacks.map((attack) => attack.oid);
  const availableCapacity = available.reduce((sum, blocker) => {
    const legal = attackers.filter(
      (attacker) => !occupiedPairs.has(`${blocker}\u0000${attacker}`) && canBlock(state, blocker, attacker),
    ).length;
    return sum + (canBlockAnyNumber(state, blocker) ? legal : Math.min(1, legal));
  }, 0);
  let fixedUpper = 0;
  const menaceNeeds: number[] = [];
  for (const requirement of requirements) {
    if (requirement.kind === 'blocker') {
      if (
        occupiedBlockers.has(requirement.oid) ||
        (available.includes(requirement.oid) &&
          attackers.some((attacker) => canBlock(state, requirement.oid, attacker)))
      ) {
        fixedUpper += 1;
      }
      continue;
    }
    const occupiedCount = occupiedCounts.get(requirement.oid) ?? 0;
    const needed = Math.max(0, blockersRequired(state, requirement.oid) - occupiedCount);
    if (needed === 0) {
      fixedUpper += 1;
      continue;
    }
    const legal = available.filter(
      (blocker) =>
        !occupiedPairs.has(`${blocker}\u0000${requirement.oid}`) && canBlock(state, blocker, requirement.oid),
    ).length;
    if (legal < needed) continue;
    if (hasKeyword(state, requirement.oid, 'menace')) menaceNeeds.push(needed);
    else fixedUpper += 1;
  }
  let menaceSlots = 0;
  let menaceUpper = 0;
  for (const needed of menaceNeeds.sort((left, right) => left - right)) {
    if (menaceSlots + needed > availableCapacity) break;
    menaceSlots += needed;
    menaceUpper += 1;
  }
  const coverageUpper = fixedUpper + menaceUpper;
  let best: RequirementSolution | null = null;
  const blocked = new Set<ObjectId>();
  const optionalScoringMenace = scoringMenace.filter((attacker) => {
    if ((occupiedCounts.get(attacker) ?? 0) === 0) return true;
    blocked.add(attacker);
    return false;
  });
  const grouped = new Map<string, { members: ObjectId[]; required: boolean }>();
  for (const attacker of optionalScoringMenace) {
    const legal = available.filter(
      (blocker) => !occupiedPairs.has(`${blocker}\u0000${attacker}`) && canBlock(state, blocker, attacker),
    );
    const required = requiredMenace.has(attacker);
    const key = `${required ? 'required' : 'auxiliary'}|${legal.join(',')}`;
    const existing = grouped.get(key);
    if (existing === undefined) grouped.set(key, { members: [attacker], required });
    else grouped.set(key, { members: [...existing.members, attacker], required });
  }
  const groups: readonly MenaceChoiceGroup[] = [...grouped.values()].sort(
    (left, right) => Number(right.required) - Number(left.required),
  );
  const groupOf = new Map(
    groups.flatMap((group, index) => group.members.map((attacker) => [attacker, index])),
  );
  const incompatible = incompatibleMenaceGroups(state, groups, available, occupied);
  const evaluate = (): void => {
    best = betterRequirementSolution(
      solveMenaceChoice(state, requirements, available, occupied, blocked),
      best,
    );
    for (const attacker of cohortOnlyMenace) {
      if (best !== null && best.coverage >= coverageUpper) break;
      blocked.add(attacker);
      best = betterRequirementSolution(
        solveMenaceChoice(state, requirements, available, occupied, blocked),
        best,
      );
      blocked.delete(attacker);
    }
  };
  const visit = (index: number, usedSlots: number): void => {
    if (best !== null && best.coverage >= coverageUpper) return;
    if (index === groups.length) {
      evaluate();
      return;
    }
    const group = groups[index];
    if (group === undefined) return;
    const maximum = Math.min(group.members.length, Math.floor((availableCapacity - usedSlots) / 2));
    const counts = group.required
      ? Array.from({ length: maximum + 1 }, (_, offset) => maximum - offset)
      : Array.from({ length: maximum + 1 }, (_, count) => count);
    for (const count of counts) {
      const chosen = group.members.slice(0, count);
      if (!pairwiseCompatible([...blocked, ...chosen], groupOf, incompatible)) continue;
      for (const attacker of chosen) blocked.add(attacker);
      visit(index + 1, usedSlots + count * 2);
      for (const attacker of chosen) blocked.delete(attacker);
      if (best !== null && best.coverage >= coverageUpper) return;
    }
  };
  const forcedSlots = [...blocked].reduce(
    (sum, attacker) => sum + Math.max(0, 2 - (occupiedCounts.get(attacker) ?? 0)),
    0,
  );
  visit(0, forcedSlots);
  return best ?? fallback();
}

/** Whether the unasked blockers can still reach the precomputed joint maximum. */
export function blockRequirementsReachable(
  state: GameState,
  blocks: readonly BlockDeclaration[],
  requirements: readonly BlockRequirement[],
  target: number,
  later: readonly ObjectId[],
): boolean {
  const defender = opponentOf(state.turn.active);
  if (
    blockRequirementCoverage(state, blocks, requirements) >= target &&
    validateBlocks(state, defender, blocks) === null
  ) {
    return true;
  }
  const solution = maximizeBlockRequirements(state, requirements, later, blocks);
  return solution.coverage >= target && validateBlocks(state, defender, solution.blocks) === null;
}
