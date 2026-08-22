/**
 * Metrics → CI verdicts.
 *
 * Every gate resolves to exactly one of three states, and the third one is the
 * point of the module: `underSampled` is not a pass. A run that did not produce
 * enough distinct games to judge a statistic reports that it could not judge
 * it, rather than reporting green (metrics report §8 step 7, and the sample
 * illusion risk in §10.7).
 *
 * Each gate carries the citation that justifies its bound, so a red gate can be
 * argued with on evidence instead of moved.
 */
import type { AbilityUsageReport } from './ability-usage';
import type { MetricsConfig } from './config';
import type { DecisivenessResult } from './decisiveness';
import type { DominanceResult } from './dominance';
import type { GameLengthDistribution, OnPlayResult } from './game-length';
import type { ManaCheckpointResult } from './mana';
import { checkpointId, checkpointLabel } from './mana';
import type { Sampled } from './sample';
import { scaledSeedDeviation } from './seed-noise';
import type { ColorPairReport } from './win-rate';

/**
 * `notApplicable` is the fourth state, and it is not a pass either.
 *
 * `underSampled` means "this run did not buy enough evidence"; `notApplicable`
 * means "this subject has nothing for this gate to measure" — a pool with no
 * activated ability on any card cannot have a usage rate, at any run size. The
 * two are kept apart because the balance suite treats them differently: an
 * abstention is a failure of the run and fails a test of its own, while a pool
 * with no abilities in it is a fact about the pool and a bigger sweep will
 * never change it. Both are visible in the report; neither reads as green.
 *
 * `withinNoise` is the fifth, and it is the one that costs something to have.
 * It is a gate that missed its band by less than the statistic moves on the
 * seed alone at this run's volume (`./seed-noise`), so the run cannot tell the
 * miss from its own dice. That is not a pass — nothing was shown — and it is
 * not a fail either, because a fail is a claim about the *set* and this is a
 * claim about the sample. `abstainWithinNoise` below is the only thing that
 * produces it, and the price it charges is stated there.
 */
export type GateStatus = 'pass' | 'fail' | 'underSampled' | 'notApplicable' | 'withinNoise';

/**
 * The same bound as `bound`, in numbers.
 *
 * `bound` is a sentence, and a sentence answers "what was the rule" but not
 * "by how much did we miss it". Every gate here already holds the edges it
 * compares against — `within` is handed a min and a max, `atMost` a limit —
 * and it used to spend them on a `toFixed` and throw them away. A reader who
 * wanted the miss had to parse `"<= 30.0%"` back into 0.3, which is how a
 * downstream copy of the bands gets written and then drifts from these ones.
 *
 * An open side is `null` rather than an infinity: `atMost` genuinely has no
 * lower edge, and a `-Infinity` would survive `JSON.stringify` as `null`
 * anyway while reading as a number everywhere in between.
 */
export interface GateBand {
  readonly min: number | null;
  readonly max: number | null;
}

export interface GateResult {
  readonly id: string;
  readonly label: string;
  readonly status: GateStatus;
  /** The measured value, or `null` when under-sampled. */
  readonly observed: number | null;
  /** The bound in words, e.g. `"6.0 - 13.0 rounds"`. */
  readonly bound: string;
  /** The same bound in numbers, so a miss can be measured rather than read. */
  readonly band: GateBand;
  readonly detail: string;
  /** Where the bound comes from. */
  readonly source: string;
}

/** No numeric edge on either side: the gate is a count of its own findings. */
const UNBOUNDED: GateBand = { min: null, max: null };

/**
 * Where an observation sits relative to its band, in the gate's own units.
 *
 * One signed number rather than two, and the sign is the verdict: `distance`
 * is positive exactly when the observation is outside the band, by that much,
 * and negative when it is inside, by that much of headroom. That is what lets
 * a caller sort every gate on one axis — the worst miss and the thinnest pass
 * are the two ends of the same list.
 *
 * `edge` is the number the observation is measured against: the edge it missed
 * when it is outside, and the nearer edge when it is inside. Both are in the
 * gate's units, so a round count stays rounds and a rate stays a rate; nothing
 * here normalizes, because a normalized miss is comparable and meaningless.
 */
export interface GateMargin {
  readonly observed: number;
  readonly edge: number;
  readonly distance: number;
}

/**
 * `null` when there is nothing to measure: an under-sampled gate has no
 * observation, and a gate with no numeric edge on either side has nothing to
 * measure it against.
 */
export function gateMargin(gate: GateResult): GateMargin | null {
  const { observed } = gate;
  if (observed === null) return null;
  const { min, max } = gate.band;
  if (min === null && max === null) return null;
  if (max !== null && observed > max) return { observed, edge: max, distance: observed - max };
  if (min !== null && observed < min) return { observed, edge: min, distance: min - observed };
  // Inside. The nearer edge is the one that would fail first.
  const headrooms: readonly { readonly edge: number; readonly room: number }[] = [
    ...(max === null ? [] : [{ edge: max, room: max - observed }]),
    ...(min === null ? [] : [{ edge: min, room: observed - min }]),
  ];
  const nearest = headrooms.reduce((best, candidate) => (candidate.room < best.room ? candidate : best));
  return { observed, edge: nearest.edge, distance: -nearest.room };
}

/** A miss the run cannot distinguish from its own dice, with both numbers. */
export interface SeedNoiseAbstention {
  /** The statistic's seed deviation at this run's volume. */
  readonly noise: number;
  /** How far the observation sat outside its band, in the gate's own units. */
  readonly distance: number;
}

/**
 * Whether a failing gate missed by less than the seed moves the statistic.
 *
 * The miss is `gateMargin`'s `distance`, which is the one subtraction in this
 * module and is deliberately not repeated here. The comparison is strict: a
 * miss exactly equal to the deviation is a fail, because the deviation is a
 * standard deviation rounded *up* to the nearest 0.005 and the tie should go
 * to the band rather than to the sample.
 *
 * **A `null` deviation never abstains.** `seedDeviation` returns `null` for
 * every statistic nobody has measured, and that means "nobody has measured
 * it", not "zero noise" (`./seed-noise` states the same rule from the other
 * side). A gate with no measured deviation therefore fails exactly the way it
 * failed before this function existed, which is what keeps the table an
 * inventory of work done rather than a list of gates somebody softened.
 *
 * Only a `fail` is a candidate. A gate that passed is judged, and one that was
 * under-sampled or not applicable has no observation to be near a band with.
 */
export function seedNoiseAbstention(gate: GateResult, games: number): SeedNoiseAbstention | null {
  if (gate.status !== 'fail') return null;
  const margin = gateMargin(gate);
  if (margin === null) return null;
  const noise = scaledSeedDeviation(gate.id, games);
  if (noise === null) return null;
  if (margin.distance >= noise) return null;
  return { noise, distance: margin.distance };
}

/**
 * Re-reads a gate list against the run volume that produced it.
 *
 * This is the one place a `withinNoise` gate comes from, and it runs where the
 * gate list is assembled (`./health`) rather than inside `within`, `atMost` or
 * `atLeast`, which is the whole reason it is a separate pass: a gate
 * constructor is handed one observation and one band and has no idea how many
 * games bought them. Doing it here means the markdown report, `./fairness` and
 * the balance suite are all reading one verdict instead of three functions
 * each deciding for itself what the printed deviation implies.
 *
 * The abstention is loud. It replaces a red row with a row that says which
 * number it missed by and which number the dice move it by, and `./fairness`
 * counts it as unjudged, so a run holding one can never come back `fair`. What
 * it does not do is soften the pinned suite: 10,035 games put a pair's
 * deviation at 0.02, `format-health.test.ts` fails the run when any gate
 * abstains at that volume, and the relief is therefore spent entirely on the
 * thin sweeps — `npm run analyze` at 2,700, the gate-wiring child at 1,350 —
 * that were judging inside their own dice.
 */
export function abstainWithinNoise(gates: readonly GateResult[], games: number): readonly GateResult[] {
  return gates.map((gate) => {
    const abstention = seedNoiseAbstention(gate, games);
    if (abstention === null) return gate;
    return {
      ...gate,
      status: 'withinNoise',
      detail:
        `${gate.detail}; missed by ${abstention.distance.toFixed(3)}, inside the ` +
        `${abstention.noise.toFixed(3)} this statistic moves on the seed alone over ${games} games`,
    };
  });
}

export interface GateInputs {
  readonly length: Sampled<GameLengthDistribution>;
  readonly onPlay: Sampled<OnPlayResult>;
  readonly mana: readonly ManaCheckpointResult[];
  readonly decisiveness: Sampled<DecisivenessResult>;
  readonly colorPairs: ColorPairReport;
  readonly dominance: DominanceResult;
  /**
   * Present only when the caller knows which pool was played. Every other gate
   * here is computable from the logs alone; this one needs the set's own
   * composition, and a caller holding logs and nothing else (the slice's
   * verdict stage) cannot supply it. Absent, the gate is not emitted at all
   * rather than emitted as a guess — and `format-health.test.ts` asserts that
   * the balance run does emit it, so the CI path cannot lose it by omission.
   */
  readonly abilityUsage?: AbilityUsageReport;
  readonly config: MetricsConfig;
}

const SOURCES = {
  length: 'metrics report §2.5, §4.1 (17lands play_draw; Sierkovitz format speed)',
  onPlay: 'metrics report §2.5, §3.3 item 7 (17lands win_rate_on_play; mtgds +4.0pp)',
  balance: 'metrics report §6.2; the prior-project reuse audit item 5 (40-70% band, no-dominant-strategy)',
  decisiveness: 'metrics report §4.5, §6.1 (Browne decisiveness; Forge draw clock)',
  mana: 'metrics report §4.4, §7 A4 (Karsten hypergeometric priors)',
  abilityUsage: 'docs/design/dsl-v1-ability-model.md §9 risk 3 (usage floor over the seeded logs)',
} as const;

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * The band travels with the words even here, where there is no observation.
 *
 * An under-sampled gate still knows what it would have been held to, and a
 * reader deciding whether a bigger run is worth buying wants that number.
 */
function underSampledGate(
  id: string,
  label: string,
  bound: string,
  band: GateBand,
  source: string,
  sample: { readonly distinctSamples: number; readonly floor: number },
): GateResult {
  return {
    id,
    label,
    status: 'underSampled',
    observed: null,
    bound,
    band,
    detail: `${sample.distinctSamples} distinct games, floor ${sample.floor}`,
    source,
  };
}

function within(
  id: string,
  label: string,
  observed: number,
  min: number,
  max: number,
  bound: string,
  source: string,
  detail: string,
): GateResult {
  return {
    id,
    label,
    status: observed >= min && observed <= max ? 'pass' : 'fail',
    observed,
    bound,
    band: { min, max },
    detail,
    source,
  };
}

function atMost(
  id: string,
  label: string,
  observed: number,
  limit: number,
  bound: string,
  source: string,
  detail: string,
): GateResult {
  return {
    id,
    label,
    status: observed <= limit ? 'pass' : 'fail',
    observed,
    bound,
    band: { min: null, max: limit },
    detail,
    source,
  };
}

function atLeast(
  id: string,
  label: string,
  observed: number,
  limit: number,
  bound: string,
  source: string,
  detail: string,
): GateResult {
  return {
    id,
    label,
    status: observed >= limit ? 'pass' : 'fail',
    observed,
    bound,
    band: { min: limit, max: null },
    detail,
    source,
  };
}

function lengthGates(inputs: GateInputs): readonly GateResult[] {
  const bands = inputs.config.length;
  const bound = `${bands.medianRounds.min}-${bands.medianRounds.max} rounds`;
  const value = inputs.length.value;
  if (value === null) {
    return [
      underSampledGate(
        'length.median',
        'median game length',
        bound,
        { min: bands.medianRounds.min, max: bands.medianRounds.max },
        SOURCES.length,
        inputs.length,
      ),
      underSampledGate(
        'length.longTail',
        'long-game tail',
        `<= ${percent(bands.maxLongGameShare)}`,
        { min: null, max: bands.maxLongGameShare },
        SOURCES.length,
        inputs.length,
      ),
      underSampledGate(
        'length.spread',
        'game-length IQR',
        `<= ${bands.maxIqrRounds} rounds`,
        { min: null, max: bands.maxIqrRounds },
        SOURCES.length,
        inputs.length,
      ),
    ];
  }
  return [
    within(
      'length.median',
      'median game length',
      value.rounds.median,
      bands.medianRounds.min,
      bands.medianRounds.max,
      bound,
      SOURCES.length,
      `median ${value.rounds.median.toFixed(1)} rounds (IQR ${value.rounds.p25.toFixed(1)}-${value.rounds.p75.toFixed(1)}, mode ${value.modalRound})`,
    ),
    atMost(
      'length.longTail',
      'long-game tail',
      value.longGameShare,
      bands.maxLongGameShare,
      `<= ${percent(bands.maxLongGameShare)} at round ${bands.longGameRound}+`,
      SOURCES.length,
      `${percent(value.longGameShare)} of games reached round ${bands.longGameRound}`,
    ),
    atMost(
      'length.spread',
      'game-length IQR',
      value.rounds.iqr,
      bands.maxIqrRounds,
      `<= ${bands.maxIqrRounds} rounds`,
      SOURCES.length,
      `IQR ${value.rounds.iqr.toFixed(1)} rounds (p10 ${value.rounds.p10.toFixed(1)}, p90 ${value.rounds.p90.toFixed(1)})`,
    ),
  ];
}

function onPlayGate(inputs: GateInputs): GateResult {
  const band = inputs.config.onPlay;
  const bound = `${percent(band.min)}-${percent(band.max)}`;
  const value = inputs.onPlay.value;
  if (value === null) {
    return underSampledGate(
      'onPlay.winRate',
      'on-the-play win rate',
      bound,
      { min: band.min, max: band.max },
      SOURCES.onPlay,
      inputs.onPlay,
    );
  }
  return within(
    'onPlay.winRate',
    'on-the-play win rate',
    value.winRate,
    band.min,
    band.max,
    bound,
    SOURCES.onPlay,
    `${percent(value.winRate)} over ${value.decided} decided games (advantage ${(value.advantage * 100).toFixed(1)}pp)`,
  );
}

function balanceGates(inputs: GateInputs): readonly GateResult[] {
  const bands = inputs.config.balance;
  const gates: GateResult[] = [];
  const band = `${percent(bands.colorPairWinRate.min)}-${percent(bands.colorPairWinRate.max)}`;

  for (const entry of inputs.colorPairs.records) {
    const winRate = entry.winRate.value;
    const id = `balance.pair.${entry.pair}`;
    const label = `${entry.pair} win rate`;
    if (winRate === null) {
      gates.push(
        underSampledGate(
          id,
          label,
          band,
          { min: bands.colorPairWinRate.min, max: bands.colorPairWinRate.max },
          SOURCES.balance,
          entry.winRate,
        ),
      );
      continue;
    }
    const interval = entry.interval.value;
    const intervalText =
      interval === null ? '' : ` [95% CI ${percent(interval.low)}-${percent(interval.high)}]`;
    gates.push(
      within(
        id,
        label,
        winRate,
        bands.colorPairWinRate.min,
        bands.colorPairWinRate.max,
        band,
        SOURCES.balance,
        `${entry.wins}W-${entry.losses}L-${entry.draws}D = ${percent(winRate)}${intervalText}`,
      ),
    );
  }

  const spread = inputs.dominance.spread;
  if (spread === null) {
    gates.push({
      id: 'balance.spread',
      label: 'win-rate spread across pairs',
      status: 'underSampled',
      observed: null,
      bound: `<= ${percent(bands.maxWinRateSpread)}`,
      band: { min: null, max: bands.maxWinRateSpread },
      detail: `${inputs.dominance.evaluated.length} pairs cleared their sample floor; two are needed`,
      source: SOURCES.balance,
    });
  } else {
    gates.push(
      atMost(
        'balance.spread',
        'win-rate spread across pairs',
        spread,
        bands.maxWinRateSpread,
        `<= ${percent(bands.maxWinRateSpread)}`,
        SOURCES.balance,
        `${percent(spread)} between the best and worst measured pair`,
      ),
    );
  }

  const dominant = inputs.dominance.dominant;
  gates.push({
    id: 'balance.noDominantStrategy',
    label: 'no dominant strategy',
    status:
      inputs.dominance.evaluated.length === 0 ? 'underSampled' : dominant.length === 0 ? 'pass' : 'fail',
    observed: dominant.length,
    bound: `no pair above ${percent(bands.dominantWinRate)} winning more than ${percent(bands.maxFastWinShare)} of its games by round ${bands.fastWinRound}`,
    // A count of findings, not a rate: the two rates in `bound` are the test a
    // pair had to fail to be counted here, and a margin over them would be a
    // margin over whichever pair happened to be worst. Zero is the whole band.
    band: { min: null, max: 0 },
    detail:
      dominant.length === 0
        ? `${inputs.dominance.evaluated.length} pairs judged, none dominant`
        : dominant.map((finding) => finding.detail).join('; '),
    source: SOURCES.balance,
  });

  return gates;
}

function decisivenessGates(inputs: GateInputs): readonly GateResult[] {
  const bands = inputs.config.decisiveness;
  const value = inputs.decisiveness.value;
  const specs = [
    {
      id: 'decisiveness.stall',
      label: 'turn-cap stall rate',
      bound: `<= ${percent(bands.maxStallRate)}`,
      band: { min: null, max: bands.maxStallRate },
    },
    {
      id: 'decisiveness.deckOut',
      label: 'deck-out rate',
      bound: `<= ${percent(bands.maxDeckOutRate)}`,
      band: { min: null, max: bands.maxDeckOutRate },
    },
    {
      id: 'decisiveness.decided',
      label: `decided by round ${bands.decisiveRound}`,
      bound: `>= ${percent(bands.minDecidedByRound)}`,
      band: { min: bands.minDecidedByRound, max: null },
    },
    {
      id: 'decisiveness.inertTurns',
      label: 'inert-turn rate',
      bound: `<= ${percent(bands.maxInertTurnRate)}`,
      band: { min: null, max: bands.maxInertTurnRate },
    },
  ] as const satisfies readonly {
    readonly id: string;
    readonly label: string;
    readonly bound: string;
    readonly band: GateBand;
  }[];
  if (value === null) {
    return specs.map((spec) =>
      underSampledGate(spec.id, spec.label, spec.bound, spec.band, SOURCES.decisiveness, inputs.decisiveness),
    );
  }
  return [
    atMost(
      specs[0].id,
      specs[0].label,
      value.stallRate,
      bands.maxStallRate,
      specs[0].bound,
      SOURCES.decisiveness,
      `${percent(value.stallRate)} of games hit the turn cap`,
    ),
    atMost(
      specs[1].id,
      specs[1].label,
      value.deckOutRate,
      bands.maxDeckOutRate,
      specs[1].bound,
      SOURCES.decisiveness,
      `${percent(value.deckOutRate)} of games ended on an empty library`,
    ),
    atLeast(
      specs[2].id,
      specs[2].label,
      value.decidedByRound,
      bands.minDecidedByRound,
      specs[2].bound,
      SOURCES.decisiveness,
      `${percent(value.decidedByRound)} of games were decided by round ${value.decisiveRound}`,
    ),
    atMost(
      specs[3].id,
      specs[3].label,
      value.inertTurnRate,
      bands.maxInertTurnRate,
      specs[3].bound,
      SOURCES.decisiveness,
      `${value.inertTurns} of ${value.totalTurns} turns advanced nothing (${value.inertTurnsPerGame.toFixed(1)} per game)`,
    ),
  ];
}

function manaGates(inputs: GateInputs): readonly GateResult[] {
  const tolerance = inputs.config.mana.tolerance;
  return inputs.mana.map((result) => {
    const id = checkpointId(result.checkpoint);
    const label = checkpointLabel(result.checkpoint);
    const bound = `within ${percent(tolerance)} of the Karsten prior`;
    if (result.observed.value === null || result.delta === null) {
      return underSampledGate(id, label, bound, { min: null, max: tolerance }, SOURCES.mana, result.observed);
    }
    return atMost(
      id,
      label,
      Math.abs(result.delta),
      tolerance,
      bound,
      SOURCES.mana,
      `observed ${percent(result.observed.value)} vs prior ${percent(result.prior)} ` +
        `(delta ${(result.delta * 100).toFixed(1)}pp over ${result.observedSides} of ${result.eligibleSides} side-games)`,
    );
  });
}

/**
 * One half of the ability pool, as the two usage gates read it.
 *
 * The halves are the same measurement one ability kind apart — a rate per card
 * drawn, a floor scaled on the pool's share, and the same three outcomes — so
 * they are one function taking the four things that differ rather than two
 * near-copies that drift.
 */
interface AbilityArm {
  readonly id: string;
  readonly label: string;
  /** Plural noun for the thing counted, e.g. `activations`. */
  readonly noun: string;
  /** The free parameter from `config.abilityUsage` this arm scales by. */
  readonly rate: number;
  readonly poolShare: number;
  readonly floor: number | null;
  readonly measure: (value: AbilityUsageValue) => AbilityArmObservation;
}

type AbilityUsageValue = NonNullable<AbilityUsageReport['usage']['value']>;

interface AbilityArmObservation {
  readonly count: number;
  readonly perCardDrawn: number;
  readonly perGame: number;
  readonly gamesShare: number;
}

/**
 * The pool line both gates carry, because "nothing fired" and "there was
 * nothing to fire" are different findings and a reader given only one number
 * cannot tell them apart. Both counts appear on both gates on purpose: a pool
 * of pure triggers is not a pool without abilities.
 */
function poolComposition(pool: AbilityUsageReport['pool']): string {
  return (
    `${pool.withActivatedAbility} of ${pool.cards} pool cards carry an activated ability ` +
    `(${pool.withTriggeredAbility} carry a triggered one)`
  );
}

/**
 * The usage floors from `./ability-usage`: risk 3's gates.
 *
 * Three outcomes, and the third is the point of the `notApplicable` status. A
 * pool with no ability of the kind an arm measures has no rate to measure, and
 * the gate that cannot measure must not report green — that is the same failure
 * mode as the one these gates exist to end, one level up. It reports what it
 * found in the pool instead.
 *
 * Each arm abstains on its own: a pool of pure triggers leaves `abilities.usage`
 * not-applicable while `abilities.triggers` still judges, which is exactly the
 * pool the single-gate version was blind on.
 */
function abilityArmGate(arm: AbilityArm, report: AbilityUsageReport): GateResult {
  const composition = poolComposition(report.pool);
  const bound =
    arm.floor === null
      ? `>= ${percent(arm.rate)} of such cards drawn, once the pool has one`
      : `>= ${arm.floor.toExponential(2)} ${arm.noun} per card drawn ` +
        `(${percent(arm.rate)} of a ${percent(arm.poolShare)} pool share)`;
  if (arm.floor === null) {
    return {
      id: arm.id,
      label: arm.label,
      status: 'notApplicable',
      observed: null,
      bound,
      // No floor was derivable, so there is no number to be held to either.
      band: UNBOUNDED,
      detail: `nothing in the pool to produce ${arm.noun}, so nothing to measure: ${composition}`,
      source: SOURCES.abilityUsage,
    };
  }
  const value = report.usage.value;
  if (value === null) {
    return underSampledGate(
      arm.id,
      arm.label,
      bound,
      { min: arm.floor, max: null },
      SOURCES.abilityUsage,
      report.usage,
    );
  }
  const observation = arm.measure(value);
  return atLeast(
    arm.id,
    arm.label,
    observation.perCardDrawn,
    arm.floor,
    bound,
    SOURCES.abilityUsage,
    `${observation.count} ${arm.noun} over ${value.cardsDrawn} cards drawn ` +
      `(${observation.perGame.toFixed(2)} per game; ${percent(observation.gamesShare)} of games saw one); ` +
      composition,
  );
}

function abilityUsageGates(report: AbilityUsageReport, config: MetricsConfig): readonly GateResult[] {
  const arms: readonly AbilityArm[] = [
    {
      id: 'abilities.usage',
      label: 'activated-ability usage floor',
      noun: 'activations',
      rate: config.abilityUsage.minActivationsPerAbilityCardDrawn,
      poolShare: report.poolShare,
      floor: report.floorPerCardDrawn,
      measure: (value) => ({
        count: value.activations,
        perCardDrawn: value.perCardDrawn,
        perGame: value.activationsPerGame,
        gamesShare: value.gamesWithActivationShare,
      }),
    },
    {
      id: 'abilities.triggers',
      label: 'triggered-ability usage floor',
      noun: 'triggers',
      rate: config.abilityUsage.minTriggersPerTriggerCardDrawn,
      poolShare: report.triggeredPoolShare,
      floor: report.floorTriggersPerCardDrawn,
      measure: (value) => ({
        count: value.triggers,
        perCardDrawn: value.triggersPerCardDrawn,
        perGame: value.triggersPerGame,
        gamesShare: value.gamesWithTriggerShare,
      }),
    },
  ];
  return arms.map((arm) => abilityArmGate(arm, report));
}

export function evaluateGates(inputs: GateInputs): readonly GateResult[] {
  const abilityUsage = inputs.abilityUsage;
  return [
    ...lengthGates(inputs),
    onPlayGate(inputs),
    ...manaGates(inputs),
    ...decisivenessGates(inputs),
    ...balanceGates(inputs),
    ...(abilityUsage === undefined ? [] : abilityUsageGates(abilityUsage, inputs.config)),
  ];
}

export function failedGates(gates: readonly GateResult[]): readonly GateResult[] {
  return gates.filter((gate) => gate.status === 'fail');
}

export function underSampledGates(gates: readonly GateResult[]): readonly GateResult[] {
  return gates.filter((gate) => gate.status === 'underSampled');
}

/** Gates whose miss was inside the run's own dice. Not a pass; see the status. */
export function withinNoiseGates(gates: readonly GateResult[]): readonly GateResult[] {
  return gates.filter((gate) => gate.status === 'withinNoise');
}

/** Display label for a status; shared by the failure message and the report. */
export function gateStatusLabel(status: GateStatus): string {
  switch (status) {
    case 'pass':
      return 'PASS';
    case 'fail':
      return 'FAIL';
    case 'underSampled':
      return 'UNDER-SAMPLED';
    case 'notApplicable':
      return 'N/A';
    case 'withinNoise':
      // As loud as UNDER-SAMPLED on purpose: both are a run that did not
      // answer, and a quiet label here would read as a footnote on a pass.
      return 'INSIDE-THE-NOISE';
  }
}

/** Gates with nothing in the subject to measure. Reported, never asserted on. */
export function notApplicableGates(gates: readonly GateResult[]): readonly GateResult[] {
  return gates.filter((gate) => gate.status === 'notApplicable');
}

/** One line per gate, for a test failure message. */
export function formatGates(gates: readonly GateResult[]): string {
  if (gates.length === 0) return '(none)';
  return gates
    .map((gate) => `${gateStatusLabel(gate.status)} ${gate.id}: ${gate.detail} [bound: ${gate.bound}]`)
    .join('\n');
}
