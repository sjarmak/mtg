/**
 * Required cards as an input to the derivation.
 *
 * the set design document, decision 1 is "the list leads: cards are
 * named first; skeleton, archetypes and census derive from them". Reserving the
 * named cards over a finished skeleton is that backwards, and it refuses briefs
 * the skeleton could have satisfied: a 250-card set derives six colorless
 * artifact slots, and the flagship's marquee gear is roughly fifteen named
 * colorless artifacts.
 *
 * So this pass subtracts what the list states from the pools that will hold it,
 * before a single slot is built. A required card states a pool, a card kind, a
 * rarity and a mana value, so that is exactly what is subtracted, in two
 * settlements per pool. The kind settlement bends the pool's plan until it holds
 * one slot of the stated kind per named card, paid for out of the same pool's
 * most over-supplied kind. The curve settlement then moves bodies between the
 * pool's curve buckets until the stated mana values have creature slots, paid
 * for out of the bucket with the most to spare.
 *
 * A stated rarity narrows both settlements to that rarity's plan, and each runs
 * once per tier before it runs over the pool at large. A pool that ends up
 * holding the per-tier share and the pool-wide total holds an assignment for the
 * whole list, which is the condition the matcher in `required.ts` then checks
 * exactly.
 *
 * Four things it deliberately does not do.
 *
 *  - **It never moves a card between pools or between rarities.** Per-pool card
 *    counts and per-rarity totals are the census, and a pool asked for more
 *    cards than it holds is refused by name rather than fixed by taking a card
 *    from another color or another tier.
 *  - **It never invents a kind a pool cannot print.** A white artifact stays
 *    unplaceable, because a colored group's noncreature slots take their kind
 *    from the role table and that table is instants and sorceries.
 *  - **It never widens the curve.** A body moves onto a bucket the plan already
 *    allocated or it does not move; a stated mana value no bucket covers is a
 *    refusal by name, not a new bucket invented to hold one card.
 *  - **It never reads a name.** Which cards are colorless gear, and what any of
 *    them costs or does, is the model's judgment (ZFC). The only inputs here are
 *    the pool, kind, rarity and mana value the human wrote down.
 *
 * Reservation itself still belongs to `pinRequiredCards`, which is the single
 * authority on whether a brief is placeable and the only thing that refuses.
 * This pass changes what it is matching against; it never decides a seat.
 */
import type { CardKind, Color, Rarity } from '@mtg/dsl';
import { COLORS } from '@mtg/dsl';
import type {
  CurveBucket,
  SkeletonLiteProfile,
  SliceGroupPlan,
  SliceRarity,
  SliceRarityRules,
} from '@mtg/design-data';
import { SLICE_RARITIES } from '@mtg/design-data';
import type { RequiredCard, SetBrief } from './brief';
import { slotPoolFor } from './brief';
import { spellCurve } from './curve';
import { rarityPolicy } from './rarity';
import { addToCurve, dropFromCurve, rescaleKeywords } from './plan';
import { colorlessEffectKinds, roleProfile } from './roles';

export interface RequiredCardReservation {
  /** The profile the slots are built from, with the named cards subtracted. */
  readonly profile: SkeletonLiteProfile;
  /** One note per slot bought, for the generation report. */
  readonly notes: readonly string[];
}

export type RarityPlans = Record<SliceRarity, SliceGroupPlan>;

/** `null` is the colorless pool, the same spelling `Slot.color` uses. */
const POOLS: readonly (Color | null)[] = [...COLORS, null];

/**
 * The published colorless template's artifact roles ("manaArtifact",
 * "landFixing") carry no `ROLE_PROFILES` entry, which is how
 * `colorlessPermanentSlots` knows to print them as vanilla artifacts. A small
 * set truncates them out of its colorless plan entirely, so this is the role the
 * pass appends when the pool has none left to copy.
 */
const COLORLESS_ARTIFACT_ROLE = 'manaArtifact';

/**
 * A settlement's rarity scope: one stated tier, or the pool at large.
 *
 * `undefined` is "the pool at large" rather than a tier of its own, so the two
 * scopes read as one vocabulary. `TIERS` is built from `SLICE_RARITIES` and
 * every settlement below spends only from `raritiesIn(tier)`, so no rarity is
 * spelled out anywhere in this file and a further tier is an entry in that list
 * rather than a branch here.
 *
 * That is the settlement loop, and it is not the whole file. The rare tier
 * arrived with a property the two below it do not have - it is derived per set
 * size, so a plan can carry a tier with no cards in it - and paying for that
 * took `tierOf`'s emptiness test and the `plans` argument threaded through
 * `requiredIn`, `demandOf` and `curveDemand` to run it. A tier that is always
 * allocated would have cost the list entry alone.
 */
type Tier = SliceRarity | undefined;

/** Scopes in the order they settle: each tier inside itself, then the pool. */
const TIERS: readonly Tier[] = [...SLICE_RARITIES, undefined];

/** The rarities a settlement may spend from. */
function raritiesIn(tier: Tier): readonly SliceRarity[] {
  return tier === undefined ? SLICE_RARITIES : [tier];
}

/**
 * The skeleton tier a stated rarity names, or `undefined` when there is none.
 *
 * Two ways there is none, and until `mtg-bc2.26.4` there was one. `RARITIES` is
 * wider than `SLICE_RARITIES`, so a brief may state a rarity the allocator has
 * no tier for at all. And a rarity inside `SLICE_RARITIES` can still have no
 * tier *in these plans*: the rare tier is derived per set size, so a 90-card
 * profile carries a rare group with no cards in it. Reading only the vocabulary
 * counted such a card's demand in the pool-wide scope and bought an uncommon
 * slot for it, which `accepts` would never let it sit in.
 *
 * Either way no purchase in this pool can seat the card, so the pass leaves it
 * entirely alone and `pinRequiredCards` refuses it by name, which is the one
 * place a brief is refused.
 */
function tierOf(rarity: Rarity, plans: RarityPlans): Tier {
  const tier = SLICE_RARITIES.find((candidate) => candidate === rarity);
  return tier === undefined || plans[tier].cards === 0 ? undefined : tier;
}

function poolName(pool: Color | null): string {
  return pool ?? 'colorless';
}

/** Where a note says the demand came from. */
function scopeName(tier: Tier): string {
  return tier === undefined ? 'in this pool' : `in this pool at ${tier}`;
}

/** The kind of card a spell role prints in a pool. */
export function kindOfRole(role: string, pool: Color | null): CardKind {
  if (pool === null && colorlessEffectKinds(role).length === 0) return 'artifact';
  return roleProfile(role).cardKind;
}

/**
 * The one pool a stated kind could ever be seated in, when there is one.
 *
 * A colored group's noncreature slots take their kind from `roleProfile`, which
 * is instant, sorcery, enchantment or planeswalker, and its creature slots are
 * creatures; only the colorless group's role-free slots are artifacts. So a
 * required artifact that states no pool has exactly one pool available to it.
 * That is a fact about the allocator, not a reading of the card, and it survived
 * `mtg-fv5s` widening the first list: the four kinds a colored role may print
 * are four kinds an artifact is not.
 */
function solePoolFor(kind: CardKind): Color | null | undefined {
  return kind === 'artifact' ? null : undefined;
}

/** The pool a required card will occupy, or `undefined` when it is still free. */
function poolFor(card: RequiredCard): Color | null | undefined {
  if (card.color !== undefined) return slotPoolFor(card.color);
  return card.cardKind === undefined ? undefined : solePoolFor(card.cardKind);
}

/** Slots of each kind the scope's plans currently hold. */
function supplyOf(plans: RarityPlans, pool: Color | null, tier: Tier): ReadonlyMap<CardKind, number> {
  const counts = new Map<CardKind, number>();
  const add = (kind: CardKind, amount: number): void => {
    counts.set(kind, (counts.get(kind) ?? 0) + amount);
  };
  for (const rarity of raritiesIn(tier)) {
    const plan = plans[rarity];
    add('creature', plan.creatures);
    for (const role of plan.spellRoles) add(kindOfRole(role, pool), 1);
  }
  return counts;
}

/**
 * The brief's cards a settlement of this pool and this scope is buying for.
 *
 * A scope naming a tier takes only the cards that named that tier; the pool-wide
 * scope takes them all, so the pool ends up holding the per-tier shares and the
 * total the list asks of it. A card whose stated rarity the skeleton has no tier
 * for is in neither.
 */
function requiredIn(brief: SetBrief, pool: Color | null, tier: Tier, plans: RarityPlans): RequiredCard[] {
  return brief.requiredCards.filter((card) => {
    if (poolFor(card) !== pool) return false;
    if (card.rarity !== undefined && tierOf(card.rarity, plans) === undefined) return false;
    return tier === undefined || card.rarity === tier;
  });
}

/** Cards the brief names in this pool and scope, by the kind each one states. */
function demandOf(
  brief: SetBrief,
  pool: Color | null,
  tier: Tier,
  plans: RarityPlans,
): ReadonlyMap<CardKind, number> {
  const counts = new Map<CardKind, number>();
  for (const card of requiredIn(brief, pool, tier, plans)) {
    if (card.cardKind === undefined) continue;
    counts.set(card.cardKind, (counts.get(card.cardKind) ?? 0) + 1);
  }
  return counts;
}

/** Slots of each kind one scope holds beyond what the list states for it. */
function surplusIn(
  plans: RarityPlans,
  brief: SetBrief,
  pool: Color | null,
  tier: Tier,
): ReadonlyMap<CardKind, number> {
  const demand = demandOf(brief, pool, tier, plans);
  return new Map(
    [...supplyOf(plans, pool, tier)].map(([kind, have]) => [kind, have - (demand.get(kind) ?? 0)]),
  );
}

/**
 * Slots of each kind one rarity of a pool holds that the required list has not
 * claimed.
 *
 * `donorKind` spends a kind only while its supply is above the demand the list
 * states for it, and any later pass that wants a slot out of the same pool has
 * to spend by that same rule or it takes back a card the list was already
 * promised — which `pinRequiredCards` would then refuse by name, several passes
 * away from the pass that caused it. So the rule is exported rather than
 * restated: `reserveAnswers` reads its budget out of this.
 *
 * The count is the tightest of the two scopes that could claim the slot. A card
 * naming this rarity is demand inside it; a card naming no rarity at all is
 * demand only against the pool at large, and a rarity that looks free on its own
 * can still be holding the pool's last unnamed seat.
 */
export function unclaimedSlots(
  plans: RarityPlans,
  brief: SetBrief,
  pool: Color | null,
  rarity: SliceRarity,
): ReadonlyMap<CardKind, number> {
  const acrossPool = surplusIn(plans, brief, pool, undefined);
  return new Map(
    [...surplusIn(plans, brief, pool, rarity)].map(([kind, free]) => [
      kind,
      Math.min(free, acrossPool.get(kind) ?? free),
    ]),
  );
}

/** The demanded kind furthest short of supply; kind name breaks a tie. */
function shortestKind(
  demand: ReadonlyMap<CardKind, number>,
  supply: ReadonlyMap<CardKind, number>,
): CardKind | undefined {
  let worst: { readonly kind: CardKind; readonly shortfall: number } | undefined;
  for (const [kind, wanted] of [...demand].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const shortfall = wanted - (supply.get(kind) ?? 0);
    if (shortfall <= 0) continue;
    if (worst === undefined || shortfall > worst.shortfall) worst = { kind, shortfall };
  }
  return worst?.kind;
}

/** The kind with the most slots to spare; kind name breaks a tie. */
function donorKind(
  demand: ReadonlyMap<CardKind, number>,
  supply: ReadonlyMap<CardKind, number>,
  target: CardKind,
): CardKind | undefined {
  let best: { readonly kind: CardKind; readonly surplus: number } | undefined;
  for (const [kind, have] of [...supply].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (kind === target) continue;
    const surplus = have - (demand.get(kind) ?? 0);
    if (surplus <= 0) continue;
    if (best === undefined || surplus > best.surplus) best = { kind, surplus };
  }
  return best?.kind;
}

function withRarity(plans: RarityPlans, rarity: SliceRarity, plan: SliceGroupPlan): RarityPlans {
  return { ...plans, [rarity]: plan };
}

/** A role in this pool that prints the kind, preferring one the plan already uses. */
function roleThatPrints(
  kind: CardKind,
  pool: Color | null,
  plans: RarityPlans,
  tier: Tier,
): string | undefined {
  for (const rarity of raritiesIn(tier)) {
    for (const role of plans[rarity].spellRoles) {
      if (kindOfRole(role, pool) === kind) return role;
    }
  }
  return pool === null && kind === 'artifact' ? COLORLESS_ARTIFACT_ROLE : undefined;
}

interface RoleSeat {
  readonly rarity: SliceRarity;
  readonly ordinal: number;
  readonly role: string;
  readonly manaValue: number;
}

/**
 * The mana value a spell slot would have cost, which a body converted from it
 * inherits.
 *
 * `bomb` is the tier's, not the slot's: `spellCurve` costs a bomb-tier group's
 * spells from the expensive end of the curve, so a body bought out of one at the
 * curve's mode would carry a window the allocator would never have printed the
 * spell at. That is why `rules` is threaded down here from the profile rather
 * than the curve being read tier-blind.
 */
function roleManaValue(
  plan: SliceGroupPlan,
  pool: Color | null,
  role: string,
  ordinal: number,
  bomb: boolean,
): number {
  const stated = kindOfRole(role, pool) === 'artifact' ? undefined : roleProfile(role).manaValue;
  return (stated ?? spellCurve(plan.spells, bomb)[ordinal] ?? { min: 2, max: 3 }).min;
}

/** The last slot of a kind in the scope's rarity that holds the most of them. */
function seatOfKind(
  plans: RarityPlans,
  pool: Color | null,
  kind: CardKind,
  tier: Tier,
  rules: SliceRarityRules,
): RoleSeat | undefined {
  let best: RoleSeat | undefined;
  let bestCount = 0;
  for (const rarity of raritiesIn(tier)) {
    const plan = plans[rarity];
    const bomb = rarityPolicy(rarity, rules).bomb;
    let count = 0;
    let seat: RoleSeat | undefined;
    for (const [ordinal, role] of plan.spellRoles.entries()) {
      if (kindOfRole(role, pool) !== kind) continue;
      count += 1;
      seat = { rarity, ordinal, role, manaValue: roleManaValue(plan, pool, role, ordinal, bomb) };
    }
    if (seat !== undefined && count > bestCount) {
      best = seat;
      bestCount = count;
    }
  }
  return best;
}

/** The scope's rarity holding the most bodies; the first tier breaks a tie. */
function creatureRichestRarity(plans: RarityPlans, tier: Tier): SliceRarity | undefined {
  let best: SliceRarity | undefined;
  for (const rarity of raritiesIn(tier)) {
    if (plans[rarity].creatures < 1) continue;
    if (best === undefined || plans[rarity].creatures > plans[best].creatures) best = rarity;
  }
  return best;
}

interface Purchase {
  readonly plans: RarityPlans;
  readonly rarity: SliceRarity;
  readonly detail: string;
}

/** Gives up one body for a slot of a noncreature kind. */
function sellCreature(
  plans: RarityPlans,
  pool: Color | null,
  target: CardKind,
  tier: Tier,
): Purchase | undefined {
  const role = roleThatPrints(target, pool, plans, tier);
  if (role === undefined) return undefined;
  const rarity = creatureRichestRarity(plans, tier);
  if (rarity === undefined) return undefined;
  const plan = plans[rarity];
  const dropped = dropFromCurve(plan.creatureCurve);
  if (dropped === undefined) return undefined;
  const next: SliceGroupPlan = {
    ...plan,
    creatures: plan.creatures - 1,
    spells: plan.spells + 1,
    creatureCurve: dropped.curve,
    spellRoles: [...plan.spellRoles, role],
    keywords: rescaleKeywords(plan.keywords, plan.creatures, plan.creatures - 1),
  };
  return {
    plans: withRarity(plans, rarity, next),
    rarity,
    detail: `a creature slot at MV ${dropped.label} became a "${role}" ${target} slot`,
  };
}

/** Gives up one spell slot for a body, at the mana value the spell would have cost. */
function buyCreature(
  plans: RarityPlans,
  pool: Color | null,
  donor: CardKind,
  tier: Tier,
  rules: SliceRarityRules,
): Purchase | undefined {
  const seat = seatOfKind(plans, pool, donor, tier, rules);
  if (seat === undefined) return undefined;
  const plan = plans[seat.rarity];
  const grown = addToCurve(plan.creatureCurve, seat.manaValue);
  const next: SliceGroupPlan = {
    ...plan,
    creatures: plan.creatures + 1,
    spells: plan.spells - 1,
    creatureCurve: grown.curve,
    spellRoles: plan.spellRoles.filter((_role, ordinal) => ordinal !== seat.ordinal),
    keywords: rescaleKeywords(plan.keywords, plan.creatures, plan.creatures + 1),
  };
  return {
    plans: withRarity(plans, seat.rarity, next),
    rarity: seat.rarity,
    detail: `the "${seat.role}" ${donor} slot at MV ${seat.manaValue} became a creature at MV ${grown.label}`,
  };
}

/** Trades one noncreature slot for another; the body count never moves. */
function swapRole(
  plans: RarityPlans,
  pool: Color | null,
  target: CardKind,
  donor: CardKind,
  tier: Tier,
  rules: SliceRarityRules,
): Purchase | undefined {
  const role = roleThatPrints(target, pool, plans, tier);
  const seat = seatOfKind(plans, pool, donor, tier, rules);
  if (role === undefined || seat === undefined) return undefined;
  const plan = plans[seat.rarity];
  const next: SliceGroupPlan = {
    ...plan,
    spellRoles: plan.spellRoles.map((existing, ordinal) => (ordinal === seat.ordinal ? role : existing)),
  };
  return {
    plans: withRarity(plans, seat.rarity, next),
    rarity: seat.rarity,
    detail: `the "${seat.role}" ${donor} slot became a "${role}" ${target} slot`,
  };
}

function buy(
  plans: RarityPlans,
  pool: Color | null,
  target: CardKind,
  donor: CardKind,
  tier: Tier,
  rules: SliceRarityRules,
): Purchase | undefined {
  if (donor === 'creature') return sellCreature(plans, pool, target, tier);
  if (target === 'creature') return buyCreature(plans, pool, donor, tier, rules);
  return swapRole(plans, pool, target, donor, tier, rules);
}

/**
 * Buys slots in one scope until the list is supplied or nothing is left to give.
 *
 * Stopping short is a legal outcome, not a failure: a pool with nothing to
 * spare is a brief `pinRequiredCards` will refuse, and it says which cards it
 * could not seat and why. Refusing in two places would only mean two messages
 * to keep true.
 */
function settleKinds(
  plans: RarityPlans,
  pool: Color | null,
  tier: Tier,
  brief: SetBrief,
  rules: SliceRarityRules,
  notes: string[],
): RarityPlans {
  const demand = demandOf(brief, pool, tier, plans);
  if (demand.size === 0) return plans;
  let working = plans;
  // Every purchase moves one slot from a surplus kind to a short one, so the
  // total shortfall drops by one each time and can never start above the number
  // of cards the brief names.
  for (let purchase = 0; purchase < brief.requiredCards.length; purchase += 1) {
    const supply = supplyOf(working, pool, tier);
    const target = shortestKind(demand, supply);
    if (target === undefined) break;
    const donor = donorKind(demand, supply, target);
    if (donor === undefined) break;
    const bought = buy(working, pool, target, donor, tier, rules);
    if (bought === undefined) break;
    working = bought.plans;
    notes.push(
      `${bought.rarity} ${poolName(pool)}: ${bought.detail}; the brief names ${demand.get(target) ?? 0} ${target} card(s) ${scopeName(tier)} and the skeleton derived ${supply.get(target) ?? 0}.`,
    );
  }
  return working;
}

/** One curve bucket of one rarity's plan, with the bodies it has left to give. */
interface CurveSeat {
  readonly rarity: SliceRarity;
  /** Position in that rarity's `creatureCurve`; the bucket's identity here. */
  readonly position: number;
  readonly bucket: CurveBucket;
  readonly spare: number;
}

function curveSeats(plans: RarityPlans, tier: Tier): CurveSeat[] {
  return raritiesIn(tier).flatMap((rarity) =>
    plans[rarity].creatureCurve.map((bucket, position) => ({
      rarity,
      position,
      bucket,
      spare: bucket.count,
    })),
  );
}

function covers(bucket: CurveBucket, manaValue: number): boolean {
  return manaValue >= bucket.mvMin && manaValue <= bucket.mvMax;
}

interface Seating {
  /** Stated mana values the scope's curve has no body left for. */
  readonly short: readonly number[];
  /** The same seats, holding only the bodies no stated value claimed. */
  readonly spare: readonly CurveSeat[];
}

/**
 * Seats one body per stated mana value, narrowest bucket first.
 *
 * Published curves overlap ("1-2" beside "2-2"), so asking each stated value on
 * its own how many bodies cover it counts the same body once per value and
 * reports a supply the pool does not have. Walking the values in ascending order
 * and spending the covering bucket that runs out soonest is the exact answer for
 * points against intervals, and it is the reading `fitCurve` gives the finished
 * set when it measures the same curve back.
 */
function seatBodies(seats: readonly CurveSeat[], wanted: readonly number[]): Seating {
  let spare = [...seats].sort((a, b) => a.bucket.mvMax - b.bucket.mvMax || a.bucket.mvMin - b.bucket.mvMin);
  const short: number[] = [];
  for (const manaValue of [...wanted].sort((a, b) => a - b)) {
    const index = spare.findIndex((seat) => seat.spare > 0 && covers(seat.bucket, manaValue));
    if (index < 0) {
      short.push(manaValue);
      continue;
    }
    spare = spare.map((seat, position) => (position === index ? { ...seat, spare: seat.spare - 1 } : seat));
  }
  return { short, spare };
}

/** The seat with the most bodies to spare; the dearest bucket breaks a tie. */
function richestSeat(seats: readonly CurveSeat[]): CurveSeat | undefined {
  let best: CurveSeat | undefined;
  for (const seat of seats) {
    if (seat.spare < 1) continue;
    const better =
      best === undefined ||
      seat.spare > best.spare ||
      (seat.spare === best.spare && seat.bucket.mvMin > best.bucket.mvMin);
    if (better) best = seat;
  }
  return best;
}

/**
 * Moves one body onto a bucket that already covers the mana value.
 *
 * Donor and recipient are always the same rarity's plan, so the body count of
 * every group is exactly what the skeleton derived and the rarity split cannot
 * move. A scope whose plans hold no bucket covering the value buys nothing: the
 * curve is the profile's shape, and widening it to hold one named card would
 * make the shape a record of the list rather than a design.
 */
function moveBody(
  plans: RarityPlans,
  tier: Tier,
  manaValue: number,
  spare: readonly CurveSeat[],
): Purchase | undefined {
  for (const rarity of raritiesIn(tier)) {
    const plan = plans[rarity];
    if (!plan.creatureCurve.some((bucket) => covers(bucket, manaValue))) continue;
    const donor = richestSeat(spare.filter((seat) => seat.rarity === rarity));
    if (donor === undefined) continue;
    const dropped = plan.creatureCurve.map((bucket, position) =>
      position === donor.position ? { ...bucket, count: bucket.count - 1 } : bucket,
    );
    const grown = addToCurve(dropped, manaValue);
    return {
      plans: withRarity(plans, rarity, { ...plan, creatureCurve: grown.curve }),
      rarity,
      detail: `a creature slot at MV ${donor.bucket.mvMin}-${donor.bucket.mvMax} moved to MV ${grown.label}`,
    };
  }
  return undefined;
}

/** The mana values the list states for creatures in this pool and scope. */
function curveDemand(brief: SetBrief, pool: Color | null, tier: Tier, plans: RarityPlans): number[] {
  return requiredIn(brief, pool, tier, plans).flatMap((card) =>
    card.cardKind === 'creature' && card.manaValue !== undefined ? [card.manaValue] : [],
  );
}

/**
 * Moves bodies along one scope's curve until the stated mana values have slots.
 *
 * Creatures only. A spell slot's cost is `spellCurve(plan.spells)`, a function of
 * how many spells the group holds rather than a number this pass can set, and a
 * colorless artifact slot takes a fixed window; a stated mana value no such slot
 * covers is refused by name rather than bought. A card that states a cost and no
 * kind is not bought for either, because the pass would not know which side of
 * the group to take the slot from - the matcher seats it wherever the skeleton
 * already has room, and refuses it by name when it has none.
 */
function settleCurve(
  plans: RarityPlans,
  pool: Color | null,
  tier: Tier,
  brief: SetBrief,
  notes: string[],
): RarityPlans {
  const wanted = curveDemand(brief, pool, tier, plans);
  if (wanted.length === 0) return plans;
  let working = plans;
  // Each move seats one more stated value, so the shortfall drops by one a turn
  // and starts no higher than the number of values the scope states.
  for (let move = 0; move < wanted.length; move += 1) {
    const { short, spare } = seatBodies(curveSeats(working, tier), wanted);
    const manaValue = short[0];
    if (manaValue === undefined) break;
    const moved = moveBody(working, tier, manaValue, spare);
    if (moved === undefined) break;
    working = moved.plans;
    notes.push(
      `${moved.rarity} ${poolName(pool)}: ${moved.detail}; the brief names a creature at MV ${manaValue} ${scopeName(tier)}.`,
    );
  }
  return working;
}

/**
 * Settles one pool: what the list states about kinds, then about costs.
 *
 * Kinds first, because buying a body changes the curve the cost settlement is
 * then working with, and each tier before the pool at large, because the tighter
 * scope is the one that cannot be paid for out of anywhere else.
 */
function settlePool(
  plans: RarityPlans,
  pool: Color | null,
  brief: SetBrief,
  rules: SliceRarityRules,
  notes: string[],
): RarityPlans {
  let working = plans;
  for (const tier of TIERS) working = settleKinds(working, pool, tier, brief, rules, notes);
  for (const tier of TIERS) working = settleCurve(working, pool, tier, brief, notes);
  return working;
}

/**
 * Subtracts the brief's required cards from the pools that will hold them.
 *
 * Deterministic and model-free, like the rest of the derivation. A brief that
 * names nothing, or names only bare names, gets its profile back untouched.
 */
export function reserveRequiredCards(profile: SkeletonLiteProfile, brief: SetBrief): RequiredCardReservation {
  if (brief.requiredCards.length === 0) return { profile, notes: [] };

  const notes: string[] = [];
  const colors = { ...profile.colors } as Record<Color, RarityPlans>;
  let colorless: RarityPlans = { ...profile.colorless };
  let moved = false;

  for (const pool of POOLS) {
    const before = pool === null ? colorless : colors[pool];
    const after = settlePool(before, pool, brief, profile.rarityRules, notes);
    if (after === before) continue;
    moved = true;
    if (pool === null) colorless = after;
    else colors[pool] = after;
  }

  if (!moved) return { profile, notes };
  return { profile: { ...profile, colors, colorless }, notes };
}
