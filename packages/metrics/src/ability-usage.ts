/**
 * Did the pool's abilities actually fire?
 *
 * `docs/design/dsl-v1-ability-model.md` §9 risk 3 names the failure this
 * module exists for, and it is the one that produces a confident wrong answer:
 * the bot scores an activation at zero, never activates anything, and every
 * other band in this package still reads healthy. Win rates, game length, mana
 * curves and decisiveness are all perfectly capable of sitting inside their
 * bands in a format where not one activated ability ever resolved, because two
 * piles of vanilla creatures attacking each other is a legitimate format. So
 * the sweep needs one statistic that goes to zero exactly when the mechanic is
 * decorative, and a floor under it.
 *
 * **What the signals are.** Two columns, counted apart all the way from the
 * kernel. `abilities` in `SideTurnStats` is 17lands' own, incremented once per
 * `abilityActivated` by `packages/sim/src/log/collect.ts` — CR 602 activations,
 * and nothing else; a land's intrinsic mana ability is excluded there
 * deliberately (CR 605.1, no stack, and 17lands excludes it too). `sim_triggers`
 * is ours, incremented once per `abilityTriggered`, which
 * `packages/kernel/src/triggers.ts` emits for every trigger it puts on the
 * stack.
 *
 * They stay apart because they say different things. A trigger fires whether or
 * not the bot understands it — the kernel puts it on the stack — while an
 * activation is a choice `packages/kernel/src/simple-agent.ts` has to score,
 * and the bot declining to score it is precisely the risk-3 failure. Summed
 * into one number, a pool of live triggers would carry a pool of dead
 * activations right past the floor, which is the confident wrong answer this
 * module exists to refuse. So there are two rates and two floors, and each one
 * abstains on its own when its half of the pool is empty.
 *
 * The triggered half fails differently rather than not at all: a condition the
 * kernel never matches, a `selfDies` trigger on a pool nothing ever kills, or a
 * deck builder that cut every trigger card out of the 23 spells it picked. All
 * three read as zero here, and all three mean the printed text never ran.
 *
 * **The rate, not the count.** A raw "at least N activations" bound would be a
 * statement about how long the sweep ran and how many cards the pool happens to
 * carry, not about whether the pool is being played. Two normalizations fix
 * that, and both come out of the same logs:
 *
 *  - *Per card drawn.* `SideTotals.cards_drawn` counts every card that reached
 *    a hand, opening hands included (`setup.ts` draws them through the same
 *    `cardDrawn` path). If a share `p` of the pool carries an activated
 *    ability, then in expectation `p` of the cards drawn do too, so
 *    `activations / cardsDrawn` is directly comparable to `p` and is
 *    independent of run size and of game length.
 *  - *Against the pool's own composition.* The floor scales on `p` itself, so
 *    a pool with two ability cards is asked for proportionally less than a pool
 *    with forty, and neither is asked for a number pulled out of the air.
 *
 * **Why the pool and not the built decks.** `@mtg/deckbuild` picks 23 spells
 * per color pair out of the set, so the decks that were actually played carry
 * their own ability share, and using it would make the floor more accurate. It
 * would also excuse the case that most deserves reporting: a set whose ability
 * cards are all cut by the deck builder is a set whose abilities never reach
 * play, and measuring against the decks would score that as a clean pass. The
 * pool is the subject the balance gate names, so the pool is the denominator.
 */
import type { Card } from '@mtg/dsl';
import type { SimGameLog } from '@mtg/sim';
import type { MetricsConfig } from './config';
import { DEFAULT_METRICS_CONFIG } from './config';
import type { Sampled } from './sample';
import { countGames, sampled } from './sample';
import { share } from './stats';

/** How much of a card pool can be activated at all. */
export interface AbilityPool {
  /** Distinct cards in the measured pool. */
  readonly cards: number;
  /** Of those, how many print at least one activated ability. */
  readonly withActivatedAbility: number;
  /** Of those, how many print at least one triggered ability. */
  readonly withTriggeredAbility: number;
}

/** Counts what a DSL card pool can put on the stack by choice. */
export function abilityPool(cards: readonly Card[]): AbilityPool {
  let activated = 0;
  let triggered = 0;
  for (const card of cards) {
    if (card.abilities.some((ability) => ability.kind === 'activated')) activated += 1;
    if (card.abilities.some((ability) => ability.kind === 'triggered')) triggered += 1;
  }
  return { cards: cards.length, withActivatedAbility: activated, withTriggeredAbility: triggered };
}

export interface AbilityUsageResult {
  /** Activations across every game and both seats. */
  readonly activations: number;
  /** Triggers that went on the stack, across every game and both seats. */
  readonly triggers: number;
  /** Cards that reached a hand across every game and both seats. */
  readonly cardsDrawn: number;
  /** `activations / cardsDrawn`: the measured rate the activated floor reads. */
  readonly perCardDrawn: number;
  /** `triggers / cardsDrawn`: the measured rate the triggered floor reads. */
  readonly triggersPerCardDrawn: number;
  /** Games in which at least one ability was activated by either seat. */
  readonly gamesWithActivation: number;
  readonly gamesWithActivationShare: number;
  readonly activationsPerGame: number;
  /** Games in which at least one ability triggered for either seat. */
  readonly gamesWithTrigger: number;
  readonly gamesWithTriggerShare: number;
  readonly triggersPerGame: number;
}

export interface AbilityUsageReport {
  readonly pool: AbilityPool;
  /** Share of the pool carrying an activated ability. The floor scales on it. */
  readonly poolShare: number;
  /** Share of the pool carrying a triggered ability. The trigger floor scales on it. */
  readonly triggeredPoolShare: number;
  /**
   * The rate the run has to clear, or `null` when the pool carries no activated
   * ability at all — at which point there is nothing to measure and the gate
   * says so instead of passing.
   */
  readonly floorPerCardDrawn: number | null;
  /** The same, one ability kind over: `null` on a pool with no triggered ability. */
  readonly floorTriggersPerCardDrawn: number | null;
  readonly usage: Sampled<AbilityUsageResult>;
}

export function abilityUsage(
  logs: readonly SimGameLog[],
  pool: AbilityPool,
  config: MetricsConfig = DEFAULT_METRICS_CONFIG,
): AbilityUsageReport {
  const poolShare = share(pool.withActivatedAbility, pool.cards);
  const triggeredPoolShare = share(pool.withTriggeredAbility, pool.cards);
  const count = countGames(logs);
  const usage = sampled(count, config.floors.abilityUsage, () => {
    let activations = 0;
    let triggers = 0;
    let cardsDrawn = 0;
    let gamesWithActivation = 0;
    let gamesWithTrigger = 0;
    for (const log of logs) {
      let activatedInGame = 0;
      let triggeredInGame = 0;
      for (const record of log.turns) {
        activatedInGame += record.user.abilities + record.oppo.abilities;
        triggeredInGame += record.user.sim_triggers + record.oppo.sim_triggers;
      }
      activations += activatedInGame;
      triggers += triggeredInGame;
      if (activatedInGame > 0) gamesWithActivation += 1;
      if (triggeredInGame > 0) gamesWithTrigger += 1;
      cardsDrawn += log.totals.user.cards_drawn + log.totals.oppo.cards_drawn;
    }
    return {
      activations,
      triggers,
      cardsDrawn,
      perCardDrawn: share(activations, cardsDrawn),
      triggersPerCardDrawn: share(triggers, cardsDrawn),
      gamesWithActivation,
      gamesWithActivationShare: share(gamesWithActivation, logs.length),
      activationsPerGame: share(activations, logs.length),
      gamesWithTrigger,
      gamesWithTriggerShare: share(gamesWithTrigger, logs.length),
      triggersPerGame: share(triggers, logs.length),
    };
  });
  return {
    pool,
    poolShare,
    triggeredPoolShare,
    floorPerCardDrawn:
      poolShare === 0 ? null : config.abilityUsage.minActivationsPerAbilityCardDrawn * poolShare,
    floorTriggersPerCardDrawn:
      triggeredPoolShare === 0
        ? null
        : config.abilityUsage.minTriggersPerTriggerCardDrawn * triggeredPoolShare,
    usage,
  };
}
