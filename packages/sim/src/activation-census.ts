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
 * ## Outlets are a cross-cut, not a fourth arm
 *
 * An ability whose cost eats another permanent is still priced by the arm it
 * sits in: `evaluateCard`'s `activationUses` multiplies `activationUseCount`
 * (or its tapped variant) by a supply factor read off the deck. So an outlet
 * is a *subset* of an arm rather than an arm of its own, and `outlets` carries
 * it that way — same shape, same keys, and every count in it also appears in
 * `arms`. Subtract for the complement.
 *
 * `mtg-vm54` is why it is counted at all. `activationUseCount` was first
 * measured at 0.608 over every activated ability that resolved, outlets
 * included, and then `sacrificeSupplyFactor` was added to discount outlets a
 * second time. If outlets fire at the pooled rate the two corrections compose;
 * if they fire at some other rate, part of the discount is applied twice and
 * the weight wants splitting. They do not: on the current flagship an outlet
 * fires 0.012 times per arrival against 0.655 for a plain paid ability, a ratio
 * of 0.018, so the weight is now fitted over the plain partition alone. That
 * was a question about two numbers, and this is where the two numbers come
 * from.
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
  /**
   * The part of `arms` whose abilities eat another permanent to pay for
   * themselves, by `isSacrificeOutlet`.
   *
   * A subset rather than a fourth arm, for the reason the header gives: every
   * count here is also counted in `arms`, so the complement is the difference
   * and no existing reader moves. `games` is per arm and per subset, so an
   * outlet arm's `games` counts games in which an *outlet* of that arm arrived,
   * which is what its own denominator wants.
   */
  readonly outlets: Readonly<Record<ActivationArm, ActivationArmCensus>>;
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

/**
 * Whether paying this ability's cost eats another permanent the player controls.
 *
 * Both clauses `evaluateCard` discounts for supply, because both raise the same
 * question: `sacrificeOther` names a subtype and `sacrificeMatching` names a
 * filter, and `activationUses` multiplies the arm's weight by a supply factor
 * for each. `sacrificeSelf` and `exileSelf` are not outlets — they bound the
 * ability at one use, which `activationUses` already handles with a `min` and
 * which no supply factor touches.
 *
 * False for anything that is not an activated ability, so a caller can test it
 * beside `activationArm` without narrowing twice.
 */
export function isSacrificeOutlet(ability: Ability): boolean {
  if (ability.kind !== 'activated') return false;
  return ability.cost.sacrificeOther !== undefined || ability.cost.sacrificeMatching !== undefined;
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
  return {
    arms: blankArms(),
    outlets: blankArms(),
    games: 0,
    unresolvedArrivals: 0,
    unresolvedActivations: 0,
  };
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
  const outlets = blankArms();
  let unresolvedArrivals = 0;
  let unresolvedActivations = 0;
  const seen = new Set<ActivationArm>();
  const seenOutlet = new Set<ActivationArm>();
  /** `oid:index` to how many times that object has arrived so far. */
  const arrivals = new Map<ObjectId, number>();
  /** `oid:index:ordinal` to the hosts that instance has armed. */
  const hosts = new Map<string, Set<ObjectId>>();

  const bump = (arm: ActivationArm, field: 'instances' | 'activations' | 'hosts', outlet: boolean): void => {
    const current = arms[arm];
    arms[arm] = { ...current, [field]: current[field] + 1 };
    if (field === 'instances') seen.add(arm);
    if (!outlet) return;
    const sub = outlets[arm];
    outlets[arm] = { ...sub, [field]: sub[field] + 1 };
    if (field === 'instances') seenOutlet.add(arm);
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
        bump(arm, 'instances', isSacrificeOutlet(ability));
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
    const outlet = isSacrificeOutlet(ability);
    bump(arm, 'activations', outlet);
    if (arm !== 'equip') continue;
    const ordinal = arrivals.get(event.source) ?? 0;
    const armed = hosts.get(`${event.source}:${event.index}:${ordinal}`);
    if (armed === undefined) continue;
    for (const target of event.targets) {
      if (target === null || target.kind !== 'permanent') continue;
      if (armed.has(target.oid)) continue;
      armed.add(target.oid);
      bump('equip', 'hosts', outlet);
    }
  }

  for (const arm of seen) arms[arm] = { ...arms[arm], games: 1 };
  for (const arm of seenOutlet) outlets[arm] = { ...outlets[arm], games: 1 };
  return { arms, outlets, games: 1, unresolvedArrivals, unresolvedActivations };
}

/** Adds two censuses. Games add, so merging a sweep is a fold over its games. */
export function mergeActivationCensus(left: ActivationCensus, right: ActivationCensus): ActivationCensus {
  const add = (
    a: Readonly<Record<ActivationArm, ActivationArmCensus>>,
    b: Readonly<Record<ActivationArm, ActivationArmCensus>>,
  ): Record<ActivationArm, ActivationArmCensus> => {
    const summed = {} as Record<ActivationArm, ActivationArmCensus>;
    for (const arm of ACTIVATION_ARMS) {
      const x = a[arm];
      const y = b[arm];
      summed[arm] = {
        instances: x.instances + y.instances,
        activations: x.activations + y.activations,
        hosts: x.hosts + y.hosts,
        games: x.games + y.games,
      };
    }
    return summed;
  };
  return {
    arms: add(left.arms, right.arms),
    outlets: add(left.outlets, right.outlets),
    games: left.games + right.games,
    unresolvedArrivals: left.unresolvedArrivals + right.unresolvedArrivals,
    unresolvedActivations: left.unresolvedActivations + right.unresolvedActivations,
  };
}

export function sumActivationCensus(parts: readonly ActivationCensus[]): ActivationCensus {
  return parts.reduce(mergeActivationCensus, emptyActivationCensus());
}

/**
 * Which side of the outlet cross-cut a reader wants.
 *
 * `other` is the complement, taken as a subtraction rather than counted:
 * `outlets` is a subset of `arms` by construction, so the difference is the
 * non-outlet row and there is no third counter to keep in step.
 */
export type ActivationPartition = 'all' | 'outlet' | 'other';

/** One arm's row, narrowed to one side of the cross-cut. */
export function activationRow(
  census: ActivationCensus,
  arm: ActivationArm,
  partition: ActivationPartition = 'all',
): ActivationArmCensus {
  const whole = census.arms[arm];
  if (partition === 'all') return whole;
  const outlet = census.outlets[arm];
  if (partition === 'outlet') return outlet;
  return {
    instances: whole.instances - outlet.instances,
    activations: whole.activations - outlet.activations,
    hosts: whole.hosts - outlet.hosts,
    // Games do not subtract: a game holding both an outlet and a plain ability
    // of one arm counts once in each, and 1 - 1 = 0 would say it held neither.
    // The complement's game count is not derivable from a subset, so it is
    // reported as the arm's rather than invented.
    games: whole.games,
  };
}

/**
 * The number `activationUseCount` and `activationTapFactor` want, or `null`
 * when nothing in the arm ever reached a battlefield.
 *
 * `null` rather than 0 on an empty denominator, for the reason
 * `firesPerInstance` gives one arm over: an ability nobody played is
 * unmeasured, and zero is a measurement. That applies to a partition too: a set
 * printing no sacrifice outlet measures `outlet` as `null`, not as 0.
 */
export function usesPerInstance(
  census: ActivationCensus,
  arm: ActivationArm,
  partition: ActivationPartition = 'all',
): number | null {
  const row = activationRow(census, arm, partition);
  return row.instances === 0 ? null : row.activations / row.instances;
}

/**
 * How much harder or softer an outlet is used than a plain ability of the same
 * arm: `usesPerInstance(outlet) / usesPerInstance(other)`.
 *
 * `mtg-vm54`'s whole question in one number. At 1 the two corrections compose,
 * because `activationUseCount` was fitted over a population that uses an outlet
 * at the same rate as everything else and `sacrificeSupplyFactor` is then the
 * only thing pricing supply. Away from 1 the pooled weight already carries part
 * of the outlet discount and the supply factor applies it again.
 *
 * `null` when either side is unmeasured, for `tapFactor`'s reason: a ratio
 * against no denominator is not a number.
 */
export function outletFactor(census: ActivationCensus, arm: ActivationArm): number | null {
  const outlet = usesPerInstance(census, arm, 'outlet');
  const other = usesPerInstance(census, arm, 'other');
  if (outlet === null || other === null || other === 0) return null;
  return outlet / other;
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
