/**
 * Every threshold this package asserts on, in one inspectable object.
 *
 * No band is invented. Each carries the citation into
 * `docs/research/prior-art-playability-metrics.md` (referred to below as "the
 * metrics report") or into the sibling-project precedent in
 * `the prior-project reuse audit` item 5. Bands that were widened for
 * bot play say so and say by how much — a band nobody can trace is a band
 * somebody will quietly move the next time CI is red.
 */

/** A deck's shape, for the hypergeometric mana priors. */
export interface DeckShape {
  /** Cards in the deck. */
  readonly size: number;
  /** Lands among them. */
  readonly lands: number;
}

/**
 * Limited default: 40 cards, 17 lands.
 * Metrics report §4.4 (Karsten's framework via Draftsim's 40-card summary).
 */
export const LIMITED_DECK_SHAPE: DeckShape = { size: 40, lands: 17 };

export interface Band {
  readonly min: number;
  readonly max: number;
}

/**
 * Distinct-game floors. Below the floor a statistic is `null` and its gate
 * reports `underSampled` instead of pass or fail (metrics report §8 step 7).
 *
 * The numbers come from the Wilson half-width at p = 0.5: n = 200 gives about
 * +/-6.9 points, which is the tightest a 30-point-wide win-rate band can be
 * asserted on without the interval swallowing the band. Length and stall
 * statistics are cheaper — they are not proportions near 0.5 — so they floor
 * at 100.
 */
export interface SampleFloors {
  readonly gameLength: number;
  readonly onPlay: number;
  readonly manaCheckpoint: number;
  readonly decisiveness: number;
  readonly colorPair: number;
  readonly matchup: number;
  readonly abilityUsage: number;
}

export const DEFAULT_SAMPLE_FLOORS: SampleFloors = {
  gameLength: 100,
  onPlay: 200,
  manaCheckpoint: 200,
  decisiveness: 100,
  colorPair: 200,
  matchup: 50,
  abilityUsage: 100,
};

/**
 * Game-length window, in *rounds* (one round = both players took a turn).
 *
 * Human limited medians cluster tightly: AFR TradDraft 8.79, ZNR Sealed 9.25,
 * ONE 8.4, BRO 8.9-10.2 (metrics report §2.5, §4.1). The band below is widened
 * to 6-13 because bot play distorts length in a direction that is measured, not
 * assumed — Forge's own wiki documents both stalling and missed-lethal
 * lengthening (metrics report §6.4 item 2) — and because the bots mulligan on a
 * land-count band rather than on a read of the hand, so the single largest human
 * length driver is present but not at the human rate (mtgds: one mulligan is
 * worth ~14 points of win rate, §3.3 item 7). The band was set while the kernel
 * kept every opening hand and has not moved since mulligans landed; the run it
 * is measured against did.
 */
export interface LengthBands {
  readonly medianRounds: Band;
  /** Rounds at or above this count as a long game. */
  readonly longGameRound: number;
  /** Ceiling on the share of games that are long. */
  readonly maxLongGameShare: number;
  /** Ceiling on the interquartile spread, in rounds. */
  readonly maxIqrRounds: number;
}

export const DEFAULT_LENGTH_BANDS: LengthBands = {
  medianRounds: { min: 6, max: 13 },
  longGameRound: 15,
  maxLongGameShare: 0.15,
  maxIqrRounds: 8,
};

/**
 * On-the-play advantage. 17lands publishes `win_rate_on_play` per set: AFR
 * TradDraft 52.6%, ZNR Sealed 50.9% (metrics report §2.5); mtgds' regression
 * puts the effect at about +4.0 points (§3.3 item 7). The band allows 48-60%:
 * a format where the coin flip decides more than that is not a format.
 */
export const DEFAULT_ON_PLAY_BAND: Band = { min: 0.48, max: 0.6 };

/**
 * Per-color-pair win-rate band and the no-dominant-strategy guard.
 *
 * 40-70% is the in-house precedent asserted by the prior project's
 * `greedyShardSimulation.test.ts` (metrics report §6.2, reuse doc item 5). The
 * academic target is tighter — Hearthstone rebalancing drives matchups toward
 * 50% (§4.5) — but 40-70 is what has actually held as a CI gate here.
 *
 * Dominance is the separate "wins too fast too often" question: a pair is
 * dominant when it clears `dominantWinRate` *and* most of its wins land by
 * `fastWinRound`. Both conditions are required, so a grindy pair that wins a
 * lot is a balance problem but not a dominance problem, and they get reported
 * as different findings.
 */
export interface BalanceBands {
  readonly colorPairWinRate: Band;
  readonly maxWinRateSpread: number;
  readonly dominantWinRate: number;
  readonly fastWinRound: number;
  readonly maxFastWinShare: number;
}

export const DEFAULT_BALANCE_BANDS: BalanceBands = {
  colorPairWinRate: { min: 0.4, max: 0.7 },
  maxWinRateSpread: 0.3,
  dominantWinRate: 0.6,
  fastWinRound: 7,
  maxFastWinShare: 0.5,
};

/**
 * Stall and decisiveness guards.
 *
 * Ludi's decisiveness/duration criteria (metrics report §4.5) instantiated on
 * our end reasons: a game that hits the turn cap never resolved. Forge's `sim`
 * mode ships a 120s clock that calls a draw for the same reason (§6.1).
 */
export interface DecisivenessBands {
  /** Ceiling on the share of games that hit the turn cap. */
  readonly maxStallRate: number;
  /** Ceiling on the share of games that end by decking out. */
  readonly maxDeckOutRate: number;
  /** Games must be decided by this round... */
  readonly decisiveRound: number;
  /** ...at least this often. */
  readonly minDecidedByRound: number;
  /** Ceiling on the share of turns where nobody advanced the board. */
  readonly maxInertTurnRate: number;
}

export const DEFAULT_DECISIVENESS_BANDS: DecisivenessBands = {
  maxStallRate: 0.05,
  maxDeckOutRate: 0.1,
  decisiveRound: 15,
  minDecidedByRound: 0.9,
  maxInertTurnRate: 0.35,
};

/**
 * One mana checkpoint: the state a side's own Nth turn should be in.
 *
 * `screw` asks whether a side had fewer than `lands` lands in play at the end
 * of its own turn `ordinal`; `flood` asks whether it had at least that many.
 * The screw checkpoints are the metrics report's own examples (§7 A4: "% games
 * below L lands in play at end of turn T (e.g., <3 by T4, <4 by T6)").
 *
 * `lands <= ordinal` always, because a player may play at most one land per
 * turn: above that the checkpoint measures the land-drop rule, not the draws.
 *
 * The flood checkpoint takes more care than the screw ones, and the default
 * below was chosen after measuring rather than before. Two constraints bite:
 *
 *  1. The land-drop cap means the flood threshold cannot exceed the ordinal, so
 *     the strongest available signal is "hit every land drop", `lands ===
 *     ordinal`.
 *  2. A policy bot stops taking land drops once it has enough — `@mtg/sim`'s
 *     greedy default saturates at six lands and only keeps going for something
 *     uncastable in hand. Any threshold above that saturation point is
 *     unreachable, and the checkpoint then measures the bot's land policy
 *     instead of the format: a run of 2,256 side-games at `ordinal 8, lands 8`
 *     observed flood 0.0% against a 18.7% prior, purely because the bots stop
 *     at six.
 *
 * So the default sits at own turn 6 with six lands: at or below every shipped
 * bot's saturation point, where the policy always takes the drop and the
 * observed rate is therefore a measurement of the draws. **Raise this only
 * alongside the bots' saturation setting.** The richer definition the report
 * gestures at ("lands in play minus mana spent trend", §7 A4) needs a
 * mana-efficiency metric this package does not have yet.
 */
export interface ManaCheckpoint {
  readonly kind: 'screw' | 'flood';
  /** The side's own turn number, not the global turn counter. */
  readonly ordinal: number;
  readonly lands: number;
}

export const DEFAULT_MANA_CHECKPOINTS: readonly ManaCheckpoint[] = [
  { kind: 'screw', ordinal: 4, lands: 3 },
  { kind: 'screw', ordinal: 6, lands: 4 },
  { kind: 'flood', ordinal: 6, lands: 6 },
];

export interface ManaBands {
  readonly checkpoints: readonly ManaCheckpoint[];
  readonly shape: DeckShape;
  /**
   * How far the observed rate may sit from the Karsten hypergeometric prior,
   * in absolute share. The prior is what the *draws* imply; the observed rate
   * also carries the bots' land-drop policy, their mulligan policy, and the
   * survivorship of games that reached the checkpoint at all, so an exact match
   * would be suspicious.
   *
   * The mulligan is the term that moved most recently and it moves in a known
   * direction: a bot that sends back a hand outside a land-count band is
   * sampling opening hands from a filtered distribution, so the observed screw
   * rate sits *under* a prior computed over an unfiltered seven. On the
   * committed set that showed up as screw t4/l3 going from -0.2pp to -4.6pp of
   * the prior the day mulligans landed, well inside this tolerance and not a
   * regression.
   */
  readonly tolerance: number;
}

export const DEFAULT_MANA_BANDS: ManaBands = {
  checkpoints: DEFAULT_MANA_CHECKPOINTS,
  shape: LIMITED_DECK_SHAPE,
  tolerance: 0.15,
};

/**
 * The usage floor: how much of a pool's activated abilities has to actually
 * fire before the rest of this report means anything.
 *
 * `docs/design/dsl-v1-ability-model.md` §9 risk 3. Every other band here can be
 * green in a format whose mechanic never fired, so one band has to be about the
 * firing. `src/ability-usage.ts` derives the expectation from the pool — the
 * measured rate is activations per card drawn, and the floor is this constant
 * times the share of the pool that carries an activated ability — so the number
 * below is the only free parameter, and it is a *ratio of a ratio*: of the
 * ability-bearing cards that reach a hand, what fraction has to produce an
 * activation before the mechanic counts as played.
 *
 * **Why 0.05, i.e. one activation per twenty ability cards drawn.** Two bounds
 * squeeze it, and there is a lot of room between them:
 *
 *  - *From below,* the failure this catches sits at exactly 0.0. A bot that
 *    scores the activation arm at zero (`packages/kernel/src/simple-agent.ts`)
 *    never activates anything, in any game, for any pool. Any positive bound
 *    catches it, so the bound does not need to be large to do its job.
 *  - *From above,* a drawn ability card is a long way from an activation: it
 *    can be uncastable, discarded, countered, killed on sight, or simply never
 *    have a spare mana in a game that ends on round 9. A bound anywhere near
 *    1.0 would be measuring the bots' mana efficiency and calling it mechanic
 *    usage, and would go red on content changes that have nothing to do with
 *    risk 3.
 *
 * 0.05 sits far enough above the first to be a real observation and far enough
 * below the second not to be a curve fit. The concrete reading: on an 80-card
 * set where 7 cards carry an activated ability, this asks the pinned
 * 10,035-game sweep for roughly 45 activations in total, which is about the
 * smallest count that is not carried by a handful of games. Deliberately not
 * fitted to any set's measured value — the intent is a bound that only moves
 * when abilities stop firing, not one that tracks today's number. Raise it only
 * with a measurement that says the loose version missed a real dead mechanic.
 */
export interface AbilityUsageBands {
  /** Activations required per ability-bearing card drawn, as a share. */
  readonly minActivationsPerAbilityCardDrawn: number;
  /**
   * Triggers required per trigger-bearing card drawn, as a share.
   *
   * **The same constant as the activated half, on purpose.** The two arms fail
   * for different reasons — a bot that never scores an activation, versus a
   * trigger condition the kernel never matches or a deck builder that cuts
   * every trigger card — but both failures sit at exactly 0.0, and both are
   * squeezed from above by the same losses: a drawn card can be uncastable,
   * discarded, or never reach the battlefield in a game that ends on round 9.
   * Splitting the constant would mean the gap between the two measured rates
   * was partly a band choice, and the gap is the interesting number: it says
   * how much of the pool's ability text the bots are leaving on the table. So
   * both halves are asked for the same thing and the difference is a
   * measurement.
   *
   * The one asymmetry is which direction slack lies in. A trigger fires without
   * anybody choosing it, so the triggered rate should sit comfortably above
   * this floor on any pool that prints triggers and plays them; a triggered
   * rate near the floor is itself a finding.
   *
   * **Measured, 2026-08-13.** The committed balance subject prints no ability of
   * either kind, so both arms report not-applicable there and neither number
   * comes from it. Against a second, ability-dense pool of 80 cards (7 activated
   * and 16 triggered) over 2,700 seeded games, handed to the sweep through
   * `MTG_BALANCE_SET` at `MTG_BALANCE_GAMES=60`, the
   * triggered rate is 1.18e-1 per card drawn against a 1.00e-2 floor, with a
   * trigger in 77.5% of games. Roughly twelve times the bound, which is the
   * margin a floor set to catch zero should have.
   */
  readonly minTriggersPerTriggerCardDrawn: number;
}

export const DEFAULT_ABILITY_USAGE_BANDS: AbilityUsageBands = {
  minActivationsPerAbilityCardDrawn: 0.05,
  minTriggersPerTriggerCardDrawn: 0.05,
};

export interface MetricsConfig {
  readonly floors: SampleFloors;
  readonly length: LengthBands;
  readonly onPlay: Band;
  readonly balance: BalanceBands;
  readonly decisiveness: DecisivenessBands;
  readonly mana: ManaBands;
  readonly abilityUsage: AbilityUsageBands;
}

export const DEFAULT_METRICS_CONFIG: MetricsConfig = {
  floors: DEFAULT_SAMPLE_FLOORS,
  length: DEFAULT_LENGTH_BANDS,
  onPlay: DEFAULT_ON_PLAY_BAND,
  balance: DEFAULT_BALANCE_BANDS,
  decisiveness: DEFAULT_DECISIVENESS_BANDS,
  mana: DEFAULT_MANA_BANDS,
  abilityUsage: DEFAULT_ABILITY_USAGE_BANDS,
};

/** Per-section overrides over the default profile. Sections merge, fields replace. */
export interface MetricsConfigInput {
  readonly floors?: Partial<SampleFloors>;
  readonly length?: Partial<LengthBands>;
  readonly onPlay?: Partial<Band>;
  readonly balance?: Partial<BalanceBands>;
  readonly decisiveness?: Partial<DecisivenessBands>;
  readonly mana?: Partial<ManaBands>;
  readonly abilityUsage?: Partial<AbilityUsageBands>;
}

export function metricsConfig(overrides: MetricsConfigInput = {}): MetricsConfig {
  const config: MetricsConfig = {
    floors: { ...DEFAULT_SAMPLE_FLOORS, ...overrides.floors },
    length: { ...DEFAULT_LENGTH_BANDS, ...overrides.length },
    onPlay: { ...DEFAULT_ON_PLAY_BAND, ...overrides.onPlay },
    balance: { ...DEFAULT_BALANCE_BANDS, ...overrides.balance },
    decisiveness: { ...DEFAULT_DECISIVENESS_BANDS, ...overrides.decisiveness },
    mana: { ...DEFAULT_MANA_BANDS, ...overrides.mana },
    abilityUsage: { ...DEFAULT_ABILITY_USAGE_BANDS, ...overrides.abilityUsage },
  };
  validateConfig(config);
  return config;
}

/**
 * The two value checks, kept out of `validateConfig` because they guard two
 * doors rather than one.
 *
 * A deck shape and a mana checkpoint both reach `hypergeometricAtLeast` as
 * arguments, and it rejects a fractional or negative one three layers down
 * under the name it uses there: a caller writing `size: 40.5` hears about
 * `population`, and one writing `lands: 2.5` hears about `successesWanted`.
 * Checking here names the field the caller wrote instead.
 *
 * The messages say `metrics:` rather than `metrics config:` because the second
 * door is `karstenPrior`/`manaCheckpoint` in `./mana`, which take these values
 * raw (mtg-bc2.84) from a caller who may never have built a config.
 */
export function validateDeckShape(shape: DeckShape): void {
  if (!Number.isInteger(shape.size) || shape.size < 1) {
    throw new Error(`metrics: deck shape size must be an integer >= 1, got ${shape.size}`);
  }
  if (!Number.isInteger(shape.lands) || shape.lands < 0) {
    throw new Error(`metrics: deck shape lands must be a non-negative integer, got ${shape.lands}`);
  }
  if (shape.lands > shape.size) {
    throw new Error(`metrics: deck shape has ${shape.lands} lands in ${shape.size} cards`);
  }
}

export function validateManaCheckpoint(checkpoint: ManaCheckpoint): void {
  if (!Number.isInteger(checkpoint.ordinal) || checkpoint.ordinal < 1) {
    throw new Error(`metrics: mana checkpoint ordinal must be an integer >= 1, got ${checkpoint.ordinal}`);
  }
  if (!Number.isInteger(checkpoint.lands) || checkpoint.lands < 0) {
    throw new Error(`metrics: mana checkpoint lands must be a non-negative integer, got ${checkpoint.lands}`);
  }
  if (checkpoint.lands > checkpoint.ordinal) {
    throw new Error(
      `metrics: ${checkpoint.kind} checkpoint wants ${checkpoint.lands} lands by own-turn ` +
        `${checkpoint.ordinal}, which the one-land-per-turn rule makes unreachable`,
    );
  }
}

function validateConfig(config: MetricsConfig): void {
  validateDeckShape(config.mana.shape);
  for (const checkpoint of config.mana.checkpoints) {
    validateManaCheckpoint(checkpoint);
  }
  if (config.balance.colorPairWinRate.min >= config.balance.colorPairWinRate.max) {
    throw new Error('metrics config: color-pair win-rate band is empty');
  }
  // Zero would make the usage floor unfailable, which is the state this gate
  // exists to end; above one it would demand more activations than there are
  // ability cards to draw and would go red on every real pool.
  const rate = config.abilityUsage.minActivationsPerAbilityCardDrawn;
  if (!(rate > 0) || rate > 1) {
    throw new Error(`metrics config: ability-usage rate must be in (0, 1], got ${rate}`);
  }
}
