/**
 * How often each printed trigger condition actually fires, and out of how many
 * chances.
 *
 * `@mtg/deckbuild`'s `evaluateCard` prices a triggered ability as its effects
 * times `weights.triggerFireCount[condition]` — "how many times this ability
 * fires over the life of this permanent, given it resolved". Every row of that
 * table was written by hand. This module is the measurement, and it is placed
 * here rather than in `@mtg/metrics` because the kernel event stream is the
 * only thing that can answer it and this package is already the one that reads
 * that stream.
 *
 * **The denominator is the arrival, not the game.** Fires per game answers a
 * different question: it folds in how often the card was drawn, how often it
 * was castable, and how many copies the deck ran, none of which the scorer is
 * asking about. So the count below is one *instance* per `permanentEntered` per
 * printed triggered ability on the arriving object, and the ratio the caller
 * wants is `fires / instances`. A card that entered play three times across a
 * sweep and fired five times is 1.67, whatever the sweep's size.
 *
 * The arithmetic has a free correctness check built into it: `selfEnters`
 * fires exactly once per arrival by construction, so a run in which it does
 * not measure 1.0 is a run whose instrument is wrong, not a run whose set is
 * strange.
 *
 * **It counts chances that were never taken.** An ability that reached the
 * battlefield and never fired raises `instances` and not `fires`, which is
 * the whole reason the denominator is enumerated off the arriving card rather
 * than off the trigger events. Counting only what fired would price every
 * condition at whatever it manages when it works.
 *
 * **What it cannot see is a card nobody played.** A condition printed only on
 * cards the deck builder ranks out of its 23 spells never reaches a
 * battlefield, so it measures `instances: 0` — and that is a fact about the
 * builder, not about the condition. `firesPerInstance` returns `null` there
 * rather than zero, so a caller deriving a constant has to decide what to do
 * about an unmeasured row instead of silently writing a zero into it.
 *
 * The census is opt-in per game (`censusAbilities` on the driver options and on
 * a `MatchSpec`), because building it means retaining the event stream, and
 * the balance gate has no use for it.
 */
import type { TriggerCondition } from '@mtg/dsl';
import { TRIGGER_CONDITIONS } from '@mtg/dsl';
import type { GameEvent, GameState } from '@mtg/kernel';

/** One condition's chances and takings over however many games were merged. */
export interface TriggerConditionCensus {
  /**
   * Printed abilities carrying this condition that reached a battlefield: one
   * per arrival per ability, so a permanent that entered twice counts twice
   * and a card printing the condition twice counts twice per arrival.
   */
  readonly instances: number;
  /** `abilityTriggered` events carrying this condition. */
  readonly fires: number;
  /** Games in which at least one such ability reached a battlefield. */
  readonly games: number;
}

export interface TriggerCensus {
  readonly conditions: Readonly<Record<TriggerCondition, TriggerConditionCensus>>;
  /** Games merged into this census. */
  readonly games: number;
  /**
   * Arrivals whose object the final state could not name.
   *
   * It should always be zero: the kernel moves objects between zones and never
   * forgets them, tokens included (a ceased token is exiled, not deleted). It
   * is reported rather than asserted because an instrument that silently
   * dropped arrivals would understate every denominator below it, and a caller
   * deriving a constant needs to see the number to know it was zero.
   */
  readonly unresolvedArrivals: number;
}

function emptyCondition(): TriggerConditionCensus {
  return { instances: 0, fires: 0, games: 0 };
}

function blankConditions(): Record<TriggerCondition, TriggerConditionCensus> {
  const record = {} as Record<TriggerCondition, TriggerConditionCensus>;
  for (const condition of TRIGGER_CONDITIONS) record[condition] = emptyCondition();
  return record;
}

export function emptyTriggerCensus(): TriggerCensus {
  return { conditions: blankConditions(), games: 0, unresolvedArrivals: 0 };
}

/**
 * One game's chances and takings, counted off the event stream it produced.
 *
 * `finalState` is the object registry, not a board reading: an arrival names an
 * id and the printed abilities live on the card behind it, so the census has to
 * look the id up. Reading it at the end of the game is sound because the kernel
 * never removes an object from that registry, only moves it between zones.
 */
export function censusGameTriggers(events: readonly GameEvent[], finalState: GameState): TriggerCensus {
  const conditions = blankConditions();
  let unresolvedArrivals = 0;
  const seen = new Set<TriggerCondition>();

  const bump = (condition: TriggerCondition, field: 'instances' | 'fires'): void => {
    const current = conditions[condition];
    conditions[condition] = { ...current, [field]: current[field] + 1 };
    if (field === 'instances') seen.add(condition);
  };

  for (const event of events) {
    if (event.type === 'permanentEntered') {
      const object = finalState.objects[event.oid];
      if (object === undefined) {
        unresolvedArrivals += 1;
        continue;
      }
      for (const ability of object.card.abilities) {
        if (ability.kind === 'triggered') bump(ability.condition, 'instances');
      }
      continue;
    }
    if (event.type === 'abilityTriggered') bump(event.condition, 'fires');
  }

  for (const condition of seen) {
    conditions[condition] = { ...conditions[condition], games: 1 };
  }
  return { conditions, games: 1, unresolvedArrivals };
}

/** Adds two censuses. Games add, so merging a sweep is a fold over its games. */
export function mergeTriggerCensus(left: TriggerCensus, right: TriggerCensus): TriggerCensus {
  const conditions = {} as Record<TriggerCondition, TriggerConditionCensus>;
  for (const condition of TRIGGER_CONDITIONS) {
    const a = left.conditions[condition];
    const b = right.conditions[condition];
    conditions[condition] = {
      instances: a.instances + b.instances,
      fires: a.fires + b.fires,
      games: a.games + b.games,
    };
  }
  return {
    conditions,
    games: left.games + right.games,
    unresolvedArrivals: left.unresolvedArrivals + right.unresolvedArrivals,
  };
}

export function sumTriggerCensus(parts: readonly TriggerCensus[]): TriggerCensus {
  return parts.reduce(mergeTriggerCensus, emptyTriggerCensus());
}

/**
 * The number `triggerFireCount` wants, or `null` when nothing carrying the
 * condition ever reached a battlefield.
 *
 * `null` rather than 0 on an empty denominator: a condition nobody played is
 * unmeasured, and zero is a measurement.
 */
export function firesPerInstance(census: TriggerCensus, condition: TriggerCondition): number | null {
  const row = census.conditions[condition];
  return row.instances === 0 ? null : row.fires / row.instances;
}
