/**
 * A4 — mana screw and flood, against Karsten's hypergeometric priors.
 *
 * Metrics report §7 tier A4: "% games below L lands in play at end of turn T
 * (e.g. <3 by T4, <4 by T6) ... flood: lands in play minus mana spent trend",
 * validated against "Karsten hypergeometric priors (17 lands / 40 cards, 90%
 * on-curve target)" (§4.4). The verdict there is **adopt the math**, not adopt
 * a table — so the prior is computed from the deck shape with the same
 * hypergeometric `@mtg/deckbuild` already uses for castability, rather than
 * transcribed from a bucketed lookup.
 *
 * What the comparison means. The prior is the probability that the *draws*
 * alone put a side under (or over) the threshold. The observed rate carries
 * three further effects, and the delta between them is the metric:
 *
 *  1. the bots' land-drop policy — a greedy bot that holds a land it should
 *     play shows up here as screw the draws do not explain;
 *  2. lands leaving the battlefield, which DSL v0 can do via `destroyPermanent`;
 *  3. survivorship — only sides whose game reached the checkpoint are observed,
 *     and games that ended before their own turn 6 are not a random subset.
 *
 * (3) is the one to watch: it biases the observed screw rate *down* whenever
 * screwed players lose early, which is exactly when they lose. `observedSides`
 * and `eligibleSides` are both reported so the size of that exclusion is
 * visible rather than assumed away.
 */
import { hypergeometricAtLeast } from '@mtg/deckbuild';
import type { SimGameLog } from '@mtg/sim';
import type { DeckShape, ManaCheckpoint, MetricsConfig } from './config';
import { DEFAULT_METRICS_CONFIG, validateDeckShape, validateManaCheckpoint } from './config';
import { cardsSeenBy, gameFacts, landsInPlayAt, SIDE_LIST } from './game';
import type { Sampled } from './sample';
import { countFingerprints, gameFingerprint, sampled } from './sample';
import { share } from './stats';

/**
 * P(a side is at the checkpoint's condition on draws alone).
 *
 * `screw`: P(fewer than `lands` lands among the cards seen by that turn).
 * `flood`: P(at least `lands` lands among them).
 *
 * A checkpoint and a shape can be hand-built — both are plain interfaces of
 * bare numbers — so this door validates them rather than assuming they came
 * through `metricsConfig` (mtg-bc2.84). It is the same rule the config
 * boundary runs, called from `./config`, so there is one message per violation
 * and not a second copy that can drift.
 *
 * The bead's other option was to make `ManaCheckpoint` constructible only
 * through a factory or a branded type, which closes the hole structurally.
 * That is not taken here: it would stop every literal — `DEFAULT_MANA_CHECKPOINTS`,
 * every checkpoint in the metrics and balance tests, every caller outside this
 * package — from type-checking, and it can still be layered on top of these
 * validators later. Checking at the door gives up nothing and reverts cleanly.
 */
export function karstenPrior(checkpoint: ManaCheckpoint, shape: DeckShape, onPlay: boolean): number {
  validateManaCheckpoint(checkpoint);
  validateDeckShape(shape);
  return priorOf(checkpoint, shape, onPlay);
}

/** The prior itself, for callers inside this module that already validated. */
function priorOf(checkpoint: ManaCheckpoint, shape: DeckShape, onPlay: boolean): number {
  const seen = cardsSeenBy(checkpoint.ordinal, onPlay);
  const atLeast = hypergeometricAtLeast(checkpoint.lands, shape.lands, seen, shape.size);
  return checkpoint.kind === 'screw' ? 1 - atLeast : atLeast;
}

export interface ManaCheckpointResult {
  readonly checkpoint: ManaCheckpoint;
  /** Side-games whose game reached the checkpoint turn. */
  readonly observedSides: number;
  /** Side-games in the sample at all, reached or not. */
  readonly eligibleSides: number;
  /** Side-games that hit the checkpoint condition. */
  readonly hits: number;
  readonly observed: Sampled<number>;
  /**
   * Karsten prior averaged over the observed side-games' play/draw split, so
   * an uneven split cannot be mistaken for a format effect.
   */
  readonly prior: number;
  /** `observed - prior`; `null` when observed is under-sampled. */
  readonly delta: number | null;
}

interface SideObservation {
  readonly fingerprint: string;
  readonly onPlay: boolean;
  readonly hit: boolean;
}

function observe(
  logs: readonly SimGameLog[],
  checkpoint: ManaCheckpoint,
): { readonly observations: readonly SideObservation[]; readonly eligible: number } {
  const observations: SideObservation[] = [];
  let eligible = 0;
  for (const log of logs) {
    const facts = gameFacts(log);
    const fingerprint = gameFingerprint(log);
    for (const side of SIDE_LIST) {
      eligible += 1;
      const lands = landsInPlayAt(log, side, checkpoint.ordinal);
      if (lands === undefined) continue;
      observations.push({
        fingerprint: `${fingerprint}#${side}`,
        onPlay: facts.onPlay === side,
        hit: checkpoint.kind === 'screw' ? lands < checkpoint.lands : lands >= checkpoint.lands,
      });
    }
  }
  return { observations, eligible };
}

export function manaCheckpoint(
  logs: readonly SimGameLog[],
  checkpoint: ManaCheckpoint,
  config: MetricsConfig = DEFAULT_METRICS_CONFIG,
): ManaCheckpointResult {
  // Before the logs are walked, so a malformed checkpoint fails at the call
  // rather than after the work (mtg-bc2.84). `config.mana.shape` is checked
  // too: a `MetricsConfig` can be written as a literal, not only built by
  // `metricsConfig`.
  validateManaCheckpoint(checkpoint);
  validateDeckShape(config.mana.shape);

  const { observations, eligible } = observe(logs, checkpoint);
  const count = countFingerprints(observations.map((observation) => observation.fingerprint));
  const hits = observations.filter((observation) => observation.hit).length;
  const observed = sampled(count, config.floors.manaCheckpoint, () => share(hits, observations.length));

  let priorTotal = 0;
  for (const observation of observations) {
    priorTotal += priorOf(checkpoint, config.mana.shape, observation.onPlay);
  }
  const prior =
    observations.length === 0
      ? priorOf(checkpoint, config.mana.shape, true)
      : priorTotal / observations.length;

  return {
    checkpoint,
    observedSides: observations.length,
    eligibleSides: eligible,
    hits,
    observed,
    prior,
    delta: observed.value === null ? null : observed.value - prior,
  };
}

export function manaCheckpoints(
  logs: readonly SimGameLog[],
  config: MetricsConfig = DEFAULT_METRICS_CONFIG,
): readonly ManaCheckpointResult[] {
  return config.mana.checkpoints.map((checkpoint) => manaCheckpoint(logs, checkpoint, config));
}

/** Human-readable name for a checkpoint, used in gate ids and the report. */
export function checkpointLabel(checkpoint: ManaCheckpoint): string {
  return checkpoint.kind === 'screw'
    ? `screw: <${checkpoint.lands} lands by own turn ${checkpoint.ordinal}`
    : `flood: >=${checkpoint.lands} lands by own turn ${checkpoint.ordinal}`;
}

export function checkpointId(checkpoint: ManaCheckpoint): string {
  return `mana.${checkpoint.kind}.t${checkpoint.ordinal}.l${checkpoint.lands}`;
}
