import { LIMITED_COLORS, LimitedDeckError, suggestLimitedBasics, suggestLimitedDeck } from './physical-deck';
import type { LimitedColor, LimitedDeck, PreparedPoolCard } from './physical-deck';

export type LimitedSelectionPolicyVersion = 'score-ranked/v1' | 'deck-conditioned/v1';

export interface LimitedSelectionTargets {
  readonly creatures: number;
  readonly interaction: number;
  readonly earlyPlays: number;
}

export interface LimitedSelectionOptions {
  readonly policy?: LimitedSelectionPolicyVersion;
  readonly colors?: readonly LimitedColor[];
  readonly targets?: Partial<LimitedSelectionTargets>;
}

export interface LimitedSelectionShortfall {
  readonly metric: keyof LimitedSelectionTargets;
  readonly target: number;
  readonly actual: number;
}

export interface LimitedSelectionReport {
  readonly policy: LimitedSelectionPolicyVersion;
  readonly colors: readonly LimitedColor[];
  readonly selectedCards: number;
  readonly targets: LimitedSelectionTargets;
  readonly achieved: LimitedSelectionTargets;
  readonly unmetTargets: readonly LimitedSelectionShortfall[];
  readonly unknownRoleCards: readonly string[];
}

export interface LimitedSelectionResult<Payload> {
  readonly deck: LimitedDeck<Payload>;
  readonly report: LimitedSelectionReport;
}

interface Candidate {
  readonly colors: readonly LimitedColor[];
  readonly indexes: readonly number[];
  readonly score: number;
  readonly capped: LimitedSelectionTargets;
}

const METRICS: readonly (keyof LimitedSelectionTargets)[] = ['creatures', 'interaction', 'earlyPlays'];

function invalid(message: string): never {
  throw new LimitedDeckError('invalid-selection-policy', message);
}

function draftedTarget<Payload>(deck: LimitedDeck<Payload>): number {
  return deck.minimumDeckSize - deck.suggestedBasicLands;
}

function resolvedTargets(
  target: number,
  partial: Partial<LimitedSelectionTargets> = {},
): LimitedSelectionTargets {
  const defaults: LimitedSelectionTargets = {
    creatures: Math.min(14, target),
    interaction: Math.min(4, target),
    earlyPlays: Math.min(8, target),
  };
  const result = { ...defaults, ...partial };
  for (const metric of METRICS) {
    const value = result[metric];
    if (!Number.isSafeInteger(value) || value < 0 || value > target) {
      invalid(
        `${metric} target must be a safe integer from 0 through ${String(target)}, got ${String(value)}`,
      );
    }
  }
  return result;
}

function resolvedColors(colors: readonly LimitedColor[] | undefined): readonly LimitedColor[] | undefined {
  if (colors === undefined) return undefined;
  if (
    colors.length < 1 ||
    colors.length > 2 ||
    new Set(colors).size !== colors.length ||
    colors.some((color) => !LIMITED_COLORS.includes(color))
  ) {
    invalid('selection colors must contain one or two distinct Limited colors');
  }
  return LIMITED_COLORS.filter((color) => colors.includes(color));
}

function colorCandidates(
  explicit: readonly LimitedColor[] | undefined,
): readonly (readonly LimitedColor[])[] {
  if (explicit !== undefined) return [explicit];
  const candidates: LimitedColor[][] = LIMITED_COLORS.map((color) => [color]);
  for (let left = 0; left < LIMITED_COLORS.length; left += 1) {
    for (let right = left + 1; right < LIMITED_COLORS.length; right += 1) {
      const first = LIMITED_COLORS[left];
      const second = LIMITED_COLORS[right];
      if (first !== undefined && second !== undefined) candidates.push([first, second]);
    }
  }
  return candidates;
}

function contribution<Payload>(card: PreparedPoolCard<Payload>): LimitedSelectionTargets {
  return {
    creatures: card.facts.type === 'creature' ? 1 : 0,
    interaction: card.facts.roles?.includes('interaction') === true ? 1 : 0,
    earlyPlays: card.facts.type !== 'nonbasic-land' && card.facts.manaValue <= 3 ? 1 : 0,
  };
}

function stateKey(count: number, metrics: LimitedSelectionTargets): string {
  return `${String(count)}:${String(metrics.creatures)}:${String(metrics.interaction)}:${String(metrics.earlyPlays)}`;
}

function earlier(left: readonly number[], right: readonly number[]): boolean {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue !== rightValue) return (leftValue ?? 0) < (rightValue ?? 0);
  }
  return left.length < right.length;
}

function betterSameState(left: Candidate, right: Candidate): boolean {
  return left.score > right.score || (left.score === right.score && earlier(left.indexes, right.indexes));
}

function selectForColors<Payload>(
  pool: readonly PreparedPoolCard<Payload>[],
  colors: readonly LimitedColor[],
  countTarget: number,
  targets: LimitedSelectionTargets,
): Candidate | undefined {
  const eligible = pool
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => card.facts.colors.every((color) => colors.includes(color)));
  if (eligible.length < countTarget) return undefined;

  let states = new Map<string, Candidate>();
  const empty: Candidate = {
    colors,
    indexes: [],
    score: 0,
    capped: { creatures: 0, interaction: 0, earlyPlays: 0 },
  };
  states.set(stateKey(0, empty.capped), empty);
  for (const { card, index } of eligible) {
    const next = new Map(states);
    const added = contribution(card);
    for (const candidate of states.values()) {
      if (candidate.indexes.length >= countTarget) continue;
      const capped: LimitedSelectionTargets = {
        creatures: Math.min(targets.creatures, candidate.capped.creatures + added.creatures),
        interaction: Math.min(targets.interaction, candidate.capped.interaction + added.interaction),
        earlyPlays: Math.min(targets.earlyPlays, candidate.capped.earlyPlays + added.earlyPlays),
      };
      const selected: Candidate = {
        colors,
        indexes: [...candidate.indexes, index],
        score: candidate.score + card.facts.score,
        capped,
      };
      const key = stateKey(selected.indexes.length, capped);
      const incumbent = next.get(key);
      if (incumbent === undefined || betterSameState(selected, incumbent)) next.set(key, selected);
    }
    states = next;
  }

  let best: Candidate | undefined;
  for (const candidate of states.values()) {
    if (candidate.indexes.length !== countTarget) continue;
    if (best === undefined || betterCandidate(candidate, best, targets)) best = candidate;
  }
  return best;
}

function deficits(candidate: Candidate, targets: LimitedSelectionTargets): readonly [number, number] {
  let unmet = 0;
  let total = 0;
  for (const metric of METRICS) {
    const deficit = targets[metric] - candidate.capped[metric];
    if (deficit > 0) unmet += 1;
    total += deficit;
  }
  return [unmet, total];
}

function betterCandidate(left: Candidate, right: Candidate, targets: LimitedSelectionTargets): boolean {
  const [leftUnmet, leftDeficit] = deficits(left, targets);
  const [rightUnmet, rightDeficit] = deficits(right, targets);
  if (leftUnmet !== rightUnmet) return leftUnmet < rightUnmet;
  if (leftDeficit !== rightDeficit) return leftDeficit < rightDeficit;
  return betterSameState(left, right);
}

function reportFor<Payload>(
  deck: LimitedDeck<Payload>,
  policy: LimitedSelectionPolicyVersion,
  colors: readonly LimitedColor[],
  targets: LimitedSelectionTargets,
): LimitedSelectionReport {
  const selectedIds = new Set(deck.selectedPhysicalIds);
  const selected = deck.pool.filter((card) => selectedIds.has(card.physicalId));
  const achieved = selected.reduce<LimitedSelectionTargets>(
    (totals, card) => {
      const added = contribution(card);
      return {
        creatures: totals.creatures + added.creatures,
        interaction: totals.interaction + added.interaction,
        earlyPlays: totals.earlyPlays + added.earlyPlays,
      };
    },
    { creatures: 0, interaction: 0, earlyPlays: 0 },
  );
  return {
    policy,
    colors,
    selectedCards: selected.length,
    targets,
    achieved,
    unmetTargets: METRICS.flatMap((metric) =>
      achieved[metric] < targets[metric]
        ? [{ metric, target: targets[metric], actual: achieved[metric] }]
        : [],
    ),
    unknownRoleCards: selected
      .filter((card) => card.facts.roles === undefined)
      .map((card) => card.physicalId),
  };
}

export function suggestLimitedDeckWithReport<Payload>(
  deck: LimitedDeck<Payload>,
  options: LimitedSelectionOptions = {},
): LimitedSelectionResult<Payload> {
  const policy = options.policy ?? 'score-ranked/v1';
  if (policy !== 'score-ranked/v1' && policy !== 'deck-conditioned/v1') {
    invalid(`unknown Limited selection policy ${String(policy)}`);
  }
  const control = suggestLimitedDeck(deck);
  const target = draftedTarget(deck);
  const targets = resolvedTargets(target, options.targets);
  const explicitColors = resolvedColors(options.colors);

  if (policy === 'score-ranked/v1') {
    const selected = new Set(control.selectedPhysicalIds);
    const colors = LIMITED_COLORS.filter((color) =>
      control.pool.some((card) => selected.has(card.physicalId) && card.facts.colors.includes(color)),
    );
    return { deck: control, report: reportFor(control, policy, colors, targets) };
  }

  let best: Candidate | undefined;
  for (const colors of colorCandidates(explicitColors)) {
    const candidate = selectForColors(deck.pool, colors, target, targets);
    if (candidate !== undefined && (best === undefined || betterCandidate(candidate, best, targets))) {
      best = candidate;
    }
  }
  if (best === undefined) {
    invalid('no permitted color combination contains enough cards for the requested deck');
  }
  const selected = best.indexes
    .map((index) => deck.pool[index]?.physicalId)
    .filter((id): id is string => id !== undefined);
  const suggested = suggestLimitedBasics({ ...deck, selectedPhysicalIds: selected });
  return { deck: suggested, report: reportFor(suggested, policy, best.colors, targets) };
}
