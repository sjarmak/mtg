/**
 * How often an activated ability is actually used, out of how many arrivals,
 * split by the three things the scorer prices separately.
 *
 * `@mtg/deckbuild`'s `evaluateCard` prices an activated ability as its effects
 * times `weights.activationUseCount`, halves that again through
 * `activationTapFactor` when the cost carries the tap symbol, and replaces it
 * entirely with `equipHostCount` for an equip. All three were written by hand,
 * and `activationUseCount`'s own docblock names the instrument that would
 * settle it: "the sweep that priced the trigger table". This is that sweep's
 * other half, and it is deliberately the same shape as `trigger-census.ts`
 * beside it — same denominator, same null-on-no-sample rule, same reason for
 * living in `@mtg/sim` rather than `@mtg/metrics`.
 *
 * **The denominator is the arrival, not the game**, for the reason the trigger
 * census gives: uses per game folds in how often the card was drawn and how
 * many copies the deck ran, and the scorer is asking about neither. One
 * instance per `permanentEntered` per printed activated ability on the arriving
 * object.
 *
 * ## Three arms, mutually exclusive and total
 *
 * The scorer does not apply these weights on top of one another, so the census
 * must not either. An ability lands in exactly one arm, tested in the order the
 * scorer resolves them:
 *
 *  - `equip` — `isAttachingAbility`. `equipHostCount` *replaces*
 *    `activationUseCount` for these, so counting an equip in the paid arm would
 *    put a number into a weight that never prices it.
 *  - `tapped` — the cost carries `{T}`. What `activationTapFactor` claims is a
 *    ratio, so it is read off two arms rather than counted directly:
 *    `usesPerInstance(tapped) / usesPerInstance(paid)`.
 *  - `paid` — everything else. This is `activationUseCount`'s own arm.
 *
 * An equip whose cost also taps is an equip, because that is which weight
 * prices it.
 *
 * ## Equip counts hosts, not payments
 *
 * `equipHostCount`'s docblock is explicit that paying twice in one turn is
 * worth nothing at all: a weapon is paid for to *move* a bonus that is already
 * live. So the equip arm counts distinct hosts rather than activations, keyed
 * per instance, and an equip that was moved back onto a creature it had already
 * armed adds nothing the second time. The host is read off the activation's
 * targets, which is where CR 702.6b's clause puts it.
 *
 * Both numbers are kept. `activations` on the equip arm is not what the weight
 * wants, but a run where hosts and activations diverge sharply is a run worth
 * looking at, and the difference is free to carry.
 *
 * ## What it cannot see
 *
 * The same blind spot the trigger census has, and it is a fact about the
 * builder rather than about the ability: an ability printed only on cards the
 * deck builder ranks out never reaches a battlefield, so its arm measures
 * `instances: 0`. `usesPerInstance` returns `null` there rather than zero,
 * because zero uses out of zero chances is not a measurement.
 */
import type { Ability } from '@mtg/dsl';
import { isAttachingAbility } from '@mtg/dsl';
import type { GameEvent, GameState, ObjectId } from '@mtg/kernel';

/** Which weight prices an activated ability. Exhaustive over the activated kind. */
export type ActivationArm = 'paid' | 'tapped' | 'equip';

export const ACTIVATION_ARMS: readonly ActivationArm[] = ['paid', 'tapped', 'equip'];

/** One arm's chances and takings over however many games were merged. */
export interface ActivationArmCensus {
  /**
   * Printed abilities in this arm that reached a battlefield: one per arrival
   * per ability, so a permanent that entered twice counts twice and a card
   * printing two abilities of the arm counts twice per arrival.
   */
  readonly instances: number;
  /** `abilityActivated` events naming one of them. */
  readonly activations: number;
  /**
   * Distinct permanents an equip ability carried its modification onto, summed
   * over instances. Zero on the two arms that attach nothing.
   */
  readonly hosts: number;
  /** Games in which at least one ability of this arm reached a battlefield. */
  readonly games: number;
}

export interface ActivationCensus {
  readonly arms: Readonly<Record<ActivationArm, ActivationArmCensus>>;
  /** Games merged into this census. */
  readonly games: number;
  /**
   * Arrivals whose object the final state could not name. It should always be
   * zero, for the reason `TriggerCensus.unresolvedArrivals` says; it is
   * reported rather than asserted so a caller deriving a constant can see that
   * no denominator went missing.
   */
  readonly unresolvedArrivals: number;
  /**
   * Activations whose source object or ability index the final state could not
   * name. Reported for the same reason and with the opposite sign: a missing
   * one understates a numerator rather than a denominator.
   */
  readonly unresolvedActivations: number;
}

/** Which weight prices this ability, or `null` if it is not an activated one. */
export function activationArm(ability: Ability): ActivationArm | null {
  if (ability.kind !== 'activated') return null;
  if (isAttachingAbility(ability)) return 'equip';
  return ability.cost.tapSelf ? 'tapped' : 'paid';
}

function emptyArm(): ActivationArmCensus {
  return { instances: 0, activations: 0, hosts: 0, games: 0 };
}

function blankArms(): Record<ActivationArm, ActivationArmCensus> {
  const record = {} as Record<ActivationArm, ActivationArmCensus>;
  for (const arm of ACTIVATION_ARMS) record[arm] = emptyArm();
  return record;
}

export function emptyActivationCensus(): ActivationCensus {
  return { arms: blankArms(), games: 0, unresolvedArrivals: 0, unresolvedActivations: 0 };
}

/**
 * One game's chances and takings, counted off the event stream it produced.
 *
 * `finalState` is the object registry rather than a board reading, for the
 * reason `censusGameTriggers` gives: an arrival and an activation both name an
 * id, and the printed abilities live on the card behind it.
 *
 * The instance key carries an arrival ordinal, so a permanent that left and
 * came back is two instances and its host set starts empty the second time.
 * Without it a weapon that was exiled and recast would look like it had already
 * armed everything it armed in its first life.
 */
export function censusGameActivations(events: readonly GameEvent[], finalState: GameState): ActivationCensus {
  const arms = blankArms();
  let unresolvedArrivals = 0;
  let unresolvedActivations = 0;
  const seen = new Set<ActivationArm>();
  /** `oid:index` to how many times that object has arrived so far. */
  const arrivals = new Map<ObjectId, number>();
  /** `oid:index:ordinal` to the hosts that instance has armed. */
  const hosts = new Map<string, Set<ObjectId>>();

  const bump = (arm: ActivationArm, field: 'instances' | 'activations' | 'hosts'): void => {
    const current = arms[arm];
    arms[arm] = { ...current, [field]: current[field] + 1 };
    if (field === 'instances') seen.add(arm);
  };

  for (const event of events) {
    if (event.type === 'permanentEntered') {
      const object = finalState.objects[event.oid];
      if (object === undefined) {
        unresolvedArrivals += 1;
        continue;
      }
      const ordinal = (arrivals.get(event.oid) ?? 0) + 1;
      arrivals.set(event.oid, ordinal);
      object.card.abilities.forEach((ability, index) => {
        const arm = activationArm(ability);
        if (arm === null) return;
        bump(arm, 'instances');
        if (arm === 'equip') hosts.set(`${event.oid}:${index}:${ordinal}`, new Set());
      });
      continue;
    }
    if (event.type !== 'abilityActivated') continue;
    const source = finalState.objects[event.source];
    const ability = source?.card.abilities[event.index];
    if (ability === undefined) {
      unresolvedActivations += 1;
      continue;
    }
    const arm = activationArm(ability);
    if (arm === null) {
      unresolvedActivations += 1;
      continue;
    }
    bump(arm, 'activations');
    if (arm !== 'equip') continue;
    const ordinal = arrivals.get(event.source) ?? 0;
    const armed = hosts.get(`${event.source}:${event.index}:${ordinal}`);
    if (armed === undefined) continue;
    for (const target of event.targets) {
      if (target === null || target.kind !== 'permanent') continue;
      if (armed.has(target.oid)) continue;
      armed.add(target.oid);
      bump('equip', 'hosts');
    }
  }

  for (const arm of seen) arms[arm] = { ...arms[arm], games: 1 };
  return { arms, games: 1, unresolvedArrivals, unresolvedActivations };
}

/** Adds two censuses. Games add, so merging a sweep is a fold over its games. */
export function mergeActivationCensus(left: ActivationCensus, right: ActivationCensus): ActivationCensus {
  const arms = {} as Record<ActivationArm, ActivationArmCensus>;
  for (const arm of ACTIVATION_ARMS) {
    const a = left.arms[arm];
    const b = right.arms[arm];
    arms[arm] = {
      instances: a.instances + b.instances,
      activations: a.activations + b.activations,
      hosts: a.hosts + b.hosts,
      games: a.games + b.games,
    };
  }
  return {
    arms,
    games: left.games + right.games,
    unresolvedArrivals: left.unresolvedArrivals + right.unresolvedArrivals,
    unresolvedActivations: left.unresolvedActivations + right.unresolvedActivations,
  };
}

export function sumActivationCensus(parts: readonly ActivationCensus[]): ActivationCensus {
  return parts.reduce(mergeActivationCensus, emptyActivationCensus());
}

/**
 * The number `activationUseCount` and `activationTapFactor` want, or `null`
 * when nothing in the arm ever reached a battlefield.
 *
 * `null` rather than 0 on an empty denominator, for the reason
 * `firesPerInstance` gives one arm over: an ability nobody played is
 * unmeasured, and zero is a measurement.
 */
export function usesPerInstance(census: ActivationCensus, arm: ActivationArm): number | null {
  const row = census.arms[arm];
  return row.instances === 0 ? null : row.activations / row.instances;
}

/**
 * The number `equipHostCount` wants: distinct creatures one equip ability
 * carried its modification onto over its life.
 *
 * Separate from `usesPerInstance` because the weight counts a different thing
 * and the two diverge by design — an equip paid twice in a turn armed one host.
 */
export function hostsPerInstance(census: ActivationCensus): number | null {
  const row = census.arms.equip;
  return row.instances === 0 ? null : row.hosts / row.instances;
}

/**
 * The ratio `activationTapFactor` claims: how much less a tap-cost ability is
 * used than a paid one.
 *
 * `null` when either arm is unmeasured, because a ratio against no denominator
 * is not a smaller number, it is not a number.
 */
export function tapFactor(census: ActivationCensus): number | null {
  const tapped = usesPerInstance(census, 'tapped');
  const paid = usesPerInstance(census, 'paid');
  if (tapped === null || paid === null || paid === 0) return null;
  return tapped / paid;
}
