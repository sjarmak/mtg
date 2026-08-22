/**
 * Archetype reservation: bend the skeleton so every color pair is playable
 * *by construction*, before a single card exists.
 *
 * Two reservations live here, and they answer the two ways a pair can be
 * unplayable no matter which cards the model writes. `reserveArchetypes` buys
 * bodies for a color drowning in cards that cannot touch the battlefield.
 * `reserveAnswers` buys removal for a pair the color pie leaves unable to print
 * any. Both derive their numbers from `ArchetypeFloors`, the same floors
 * `assessPair` fails against, and both stand down where that gate abstains.
 *
 * The derived skeleton is faithful to published canon, and canon assumes an
 * engine that can pay off a counterspell, a cantrip or a mill spell. DSL v0
 * cannot: with no activated, triggered or static abilities there is nothing in
 * the set for those cards to feed, so a color whose skeleton allocates five of
 * them hands five blanks to all four of its archetypes. That is what happened to
 * blue in the TGR fixture, and it is why UR and WU came out of the balance
 * sweep at 30.7% and 39.9% (bead mtg-bc2.36).
 *
 * So this pass converts battlefield-inert spell roles into creature slots, at
 * the mana value the spell would have cost, until every color is inside its
 * share of the pair inert budget. The *cheapest* inert role survives: a
 * one-mana cantrip is the least dead card of the group, and the cheapest inert
 * role is usually the one carrying a requested mechanic at common ("if the
 * theme isn't at common, it isn't the theme", Nuts & Bolts #3).
 *
 * Keyword budgets are rescaled with the creature count, so a color that gains
 * bodies keeps the keyword density its profile ratio asks for instead of
 * silently thinning.
 */
import type { CardKind, Color, EffectKind } from '@mtg/dsl';
import { COLORS } from '@mtg/dsl';
import type { SkeletonLiteProfile, SliceGroupPlan, SliceRarity, SliceRarityRules } from '@mtg/design-data';
import { classify, SLICE_RARITIES } from '@mtg/design-data';
import type { SetBrief } from '../brief';
import { spellCurve } from '../curve';
import { rarityPolicy } from '../rarity';
import { addToCurve, dropFromCurve, rescaleKeywords } from '../plan';
import type { RarityPlans } from '../required-demand';
import { kindOfRole, unclaimedSlots } from '../required-demand';
import { allowedEffectKinds, colorlessEffectKinds, isSpellPermanentRole, roleProfile } from '../roles';
import type { ColorPair } from './pairs';
import { ARCHETYPE_PAIRS } from './pairs';
import type { ArchetypeFloors } from './viability';
import { DEFAULT_ARCHETYPE_FLOORS, pairCapacity } from './viability';
import { ANSWER_EFFECTS, isInertEffect } from './contribution';

/** A body the reservation pass bought for a color's archetypes. */
export interface SupportReservation {
  readonly color: Color;
  readonly rarity: SliceRarity;
  /** The mana value the converted spell would have cost, which the body inherits. */
  readonly manaValue: number;
}

export interface ArchetypeReservation {
  readonly profile: SkeletonLiteProfile;
  /** Bodies bought by conversion, in the order they were bought. */
  readonly support: readonly SupportReservation[];
  /** Every conversion made, in the order it was made. */
  readonly notes: readonly string[];
}

interface InertSlot {
  readonly rarity: SliceRarity;
  readonly ordinal: number;
  readonly role: string;
  readonly manaValue: number;
}

/**
 * How many inert cards one color may contribute.
 *
 * A pair sees two color pools plus the colorless pool. The colorless pool
 * prints its skeleton removal role rather than a vanilla artifact, so it
 * contributes none, which leaves the pair budget to split evenly over the two
 * colors.
 */
export function inertCapPerColor(floors: ArchetypeFloors = DEFAULT_ARCHETYPE_FLOORS): number {
  return Math.floor(floors.inertBudget / 2);
}

/**
 * True when every effect a role may legally print in this color is inert.
 * `allowedEffectKinds` has already dropped anything the pie rules off-pie, so a
 * role can be live in one color and inert in another.
 *
 * A role that prints no effect list at all is answered before that question is
 * asked, and both halves of the early return matter. `allowedEffectKinds` throws
 * on an empty menu, which is the right answer for a removal role that is off-pie
 * in this color and a crash for an Aura, which was never going to name an
 * effect. And `every` over an empty list is `true`, so falling through would
 * report the two liveliest cards in the table as the inert ones: an Aura's whole
 * text is its clause, a walker's is its abilities, and both change the board
 * every turn they are on it, which is exactly the absence this predicate exists
 * to find.
 */
export function isInertRole(role: string, color: Color): boolean {
  if (isSpellPermanentRole(role)) return false;
  return allowedEffectKinds(role, color).every((kind) => isInertEffect(kind));
}

/**
 * `rules` is here for one reason: `spellCurve` costs a bomb-tier group's spells
 * from the expensive end of the curve, so the mana value a converted body
 * inherits depends on the tier it was converted at. Reading the curve without
 * the tier would hand a rare body the window the allocator would never have
 * printed the spell at.
 */
function inertSlotsFor(
  plan: SliceGroupPlan,
  rarity: SliceRarity,
  color: Color,
  rules: SliceRarityRules,
): InertSlot[] {
  const curve = spellCurve(plan.spells, rarityPolicy(rarity, rules).bomb);
  return plan.spellRoles.flatMap((role, ordinal): InertSlot[] => {
    if (!isInertRole(role, color)) return [];
    const window = roleProfile(role).manaValue ?? curve[ordinal] ?? { min: 2, max: 3 };
    return [{ rarity, ordinal, role, manaValue: window.min }];
  });
}

/** Cheapest first, then by role name, so which roles survive is stable across runs. */
function byKeepPreference(a: InertSlot, b: InertSlot): number {
  if (a.manaValue !== b.manaValue) return a.manaValue - b.manaValue;
  if (a.role === b.role) return a.ordinal - b.ordinal;
  return a.role < b.role ? -1 : 1;
}

interface Converted {
  readonly plan: SliceGroupPlan;
  readonly label: string;
}

function convert(plan: SliceGroupPlan, slot: InertSlot): Converted {
  const grown = addToCurve(plan.creatureCurve, slot.manaValue);
  return {
    plan: {
      ...plan,
      creatures: plan.creatures + 1,
      spells: plan.spells - 1,
      creatureCurve: grown.curve,
      spellRoles: plan.spellRoles.filter((_role, ordinal) => ordinal !== slot.ordinal),
    },
    label: grown.label,
  };
}

/**
 * Repairs one color. Which roles are doomed is decided by the keep preference;
 * the conversions are then applied in descending ordinal order, because each
 * one drops an entry from `spellRoles` and every drop shifts the ordinals after
 * it. Applying them in keep-preference order instead let a drop read a stale
 * position, fall off the end and remove nothing while `spells` went down anyway
 * - see `reservation-ordinals.test.ts`.
 */
function reserveColor(
  plans: Readonly<RarityPlans>,
  color: Color,
  cap: number,
  rules: SliceRarityRules,
  support: SupportReservation[],
  notes: string[],
): RarityPlans {
  const working: RarityPlans = { ...plans };
  const inert = SLICE_RARITIES.flatMap((rarity) => inertSlotsFor(working[rarity], rarity, color, rules)).sort(
    byKeepPreference,
  );
  const doomed = [...inert.slice(cap)].sort((a, b) => b.ordinal - a.ordinal);
  for (const slot of doomed) {
    const converted = convert(working[slot.rarity], slot);
    working[slot.rarity] = converted.plan;
    support.push({ color, rarity: slot.rarity, manaValue: slot.manaValue });
    notes.push(
      `${slot.rarity} ${color}: the "${slot.role}" slot at MV ${slot.manaValue} became a creature at MV ${converted.label}; ` +
        `its effects cannot touch the battlefield in DSL v0, and ${color} may contribute at most ${cap} such card(s) before its archetypes play blanks.`,
    );
  }
  // Keyword budgets are rescaled once, from the profile's own creature count to
  // the final one. Rescaling per conversion would round up three times over and
  // hand the color a keyword density its profile never asked for.
  for (const rarity of SLICE_RARITIES) {
    const plan = working[rarity];
    const before = plans[rarity].creatures;
    if (plan.creatures === before) continue;
    working[rarity] = {
      ...plan,
      keywords: rescaleKeywords(plan.keywords, before, plan.creatures),
    };
  }
  return working;
}

/**
 * Reserves archetype support in a skeleton profile.
 *
 * Deterministic and idempotent: reserving an already-reserved profile changes
 * nothing, because the second pass finds every color inside the cap.
 */
export function reserveArchetypes(
  profile: SkeletonLiteProfile,
  floors: ArchetypeFloors = DEFAULT_ARCHETYPE_FLOORS,
): ArchetypeReservation {
  const cap = inertCapPerColor(floors);
  const notes: string[] = [];
  const support: SupportReservation[] = [];
  const colors = {} as Record<Color, RarityPlans>;
  for (const color of COLORS) {
    colors[color] = reserveColor(profile.colors[color], color, cap, profile.rarityRules, support, notes);
  }
  if (notes.length === 0) return { profile, support, notes };
  return { profile: { ...profile, colors }, support, notes };
}

/**
 * The second reservation: answers.
 *
 * `ARCHETYPE_NO_ANSWERS` is an error rather than a warning, because a Limited
 * deck with fewer than `floors.removal` ways to kill a creature is not a deck.
 * Nine pairs reach that floor out of their own colors. One cannot, and it is not
 * a matter of degree: the mechanical color pie places every effect in
 * `ANSWER_EFFECTS` off-pie in blue *and* in green, so a UG deck's entire answer
 * supply is whatever the colorless pool was allocated. Which pool that is, and
 * how many it owes, are both read off here rather than written down — the pie
 * says which colors can answer, and `floors.removal` is the same number the gate
 * fails against, so the reservation and the gate cannot drift apart.
 *
 * Two things about it are worth stating plainly, because both were found the
 * hard way.
 *
 * It runs *after* `reserveRequiredCards`, alone among the passes that bend a
 * profile. The rule everywhere else is that the list settles last so no later
 * pass can take back a slot it asked for, and this pass never takes one: it
 * spends only what `unclaimedSlots` says the list has not claimed, which is the
 * same supply-minus-demand arithmetic the settlement itself spends by. Running
 * it *before* the settlement does not work, and fails silently rather than
 * loudly — the settlement reads the reserved role as a surplus sorcery and swaps
 * it straight back out for an artifact it still owes. That is how the flagship
 * lost its second colorless answer in the first place.
 *
 * And it stands down where `checkArchetypeViability` abstains. Below
 * `floors.playables` of pair capacity the gate reports `ARCHETYPE_UNDERSIZED`
 * and judges no pair at all, so a reservation there would rewrite the prompt of
 * a set nothing reads the reservation back on — and a rewritten prompt re-keys
 * every fixture that brief ever recorded.
 */
export interface AnswerReservation {
  readonly profile: SkeletonLiteProfile;
  /** Every purchase made, in the order it was made. */
  readonly notes: readonly string[];
}

/**
 * The effects a role may print in a pool. The pie has nothing to say colorless.
 *
 * An enchantment or a walker role prints no effect list, so it is answered here
 * rather than handed to `allowedEffectKinds`, which throws on an empty menu.
 * Empty means `printsAnswer` reads false, and that is the honest reading rather
 * than a shortcut: this pass buys an answer by copying a role that prints one of
 * `ANSWER_EFFECTS`, and an Aura answers a creature through its clause, which no
 * effect census can see. So an Aura slot counts toward no pool's answer floor
 * and is a seat the pass may spend, exactly as a stated role always was.
 */
function poolEffects(role: string, pool: Color | null): readonly EffectKind[] {
  if (isSpellPermanentRole(role)) return [];
  return pool === null ? colorlessEffectKinds(role) : allowedEffectKinds(role, pool);
}

function printsAnswer(role: string, pool: Color | null): boolean {
  return poolEffects(role, pool).some((kind) => ANSWER_EFFECTS.includes(kind));
}

/** True when the pie leaves a color any way at all to answer a creature. */
function answersInColor(color: Color): boolean {
  return ANSWER_EFFECTS.some((kind) => classify(kind, color).verdict !== 'fail');
}

/**
 * Every pool a pair could draw an answer from: whichever of its own two colors
 * the pie allows one in, and the colorless pool, which the pie does not rule on.
 * A pair left with exactly one is a pair whose whole answer supply is that one
 * pool's business, and the floor is therefore that pool's to meet.
 */
function answerPools(pair: ColorPair): readonly (Color | null)[] {
  return [...pair.filter(answersInColor), null];
}

/** Pools that have to hold the floor unaided, and the floor each one owes. */
function soleAnswerPools(floors: ArchetypeFloors): ReadonlyMap<Color | null, number> {
  const owed = new Map<Color | null, number>();
  for (const pair of ARCHETYPE_PAIRS) {
    const pools = answerPools(pair);
    const [pool] = pools;
    if (pools.length !== 1 || pool === undefined) continue;
    owed.set(pool, Math.max(owed.get(pool) ?? 0, floors.removal));
  }
  return owed;
}

function answerRoleCount(plans: Readonly<RarityPlans>, pool: Color | null): number {
  return SLICE_RARITIES.reduce(
    (sum, rarity) => sum + plans[rarity].spellRoles.filter((role) => printsAnswer(role, pool)).length,
    0,
  );
}

/**
 * The answer role this pool already prints, which is the one a purchase copies.
 *
 * Copying rather than picking out of `ROLE_PROFILES` at large is the whole of
 * the judgment here: the skeleton has already said what an answer looks like in
 * this pool, and the role table is written per color, so a free search would
 * happily print white's exile role in the colorless slot.
 */
function answerRoleOf(plans: Readonly<RarityPlans>, pool: Color | null): string | undefined {
  for (const rarity of SLICE_RARITIES) {
    const role = plans[rarity].spellRoles.find((candidate) => printsAnswer(candidate, pool));
    if (role !== undefined) return role;
  }
  return undefined;
}

/** A slot the list has not claimed, which the reservation may spend. */
interface AnswerSeat {
  readonly rarity: SliceRarity;
  readonly kind: CardKind;
  /** Slots of this kind the list left unclaimed here; the pass spends the loosest. */
  readonly spare: number;
  /** Position in `spellRoles`; absent when the seat is a body. */
  readonly ordinal?: number;
  readonly from: string;
}

function seatsIn(plans: Readonly<RarityPlans>, pool: Color | null, brief: SetBrief): AnswerSeat[] {
  return SLICE_RARITIES.flatMap((rarity): AnswerSeat[] => {
    const plan = plans[rarity];
    const spare = unclaimedSlots(plans, brief, pool, rarity);
    const roles = plan.spellRoles.flatMap((role, ordinal): AnswerSeat[] => {
      if (printsAnswer(role, pool)) return [];
      const kind = kindOfRole(role, pool);
      const free = spare.get(kind) ?? 0;
      return free > 0 ? [{ rarity, kind, spare: free, ordinal, from: `"${role}" ${kind}` }] : [];
    });
    const bodies = spare.get('creature') ?? 0;
    return plan.creatures > 0 && bodies > 0
      ? [...roles, { rarity, kind: 'creature', spare: bodies, from: 'a creature' }]
      : roles;
  });
}

/**
 * The loosest seat: the kind with the most slots the list never asked for.
 *
 * Ties keep the first, and the seats arrive in `SLICE_RARITIES` order and then
 * in `spellRoles` order, so which slot a pool spends is a function of the
 * profile and the brief and of nothing else.
 */
function loosestSeat(seats: readonly AnswerSeat[]): AnswerSeat | undefined {
  let best: AnswerSeat | undefined;
  for (const seat of seats) {
    if (best === undefined || seat.spare > best.spare) best = seat;
  }
  return best;
}

/**
 * Turns one seat into the answer role.
 *
 * A noncreature seat is a role swap and the group's card count never moves. A
 * body seat is the same trade `buyCreature` makes in the other direction: one
 * fewer creature, one more spell, and the keyword budget rescaled to the body
 * count that is left rather than left at a density the profile never asked for.
 */
function spendSeat(plan: SliceGroupPlan, seat: AnswerSeat, role: string): SliceGroupPlan | undefined {
  const { ordinal } = seat;
  if (ordinal !== undefined) {
    return {
      ...plan,
      spellRoles: plan.spellRoles.map((existing, position) => (position === ordinal ? role : existing)),
    };
  }
  const dropped = dropFromCurve(plan.creatureCurve);
  if (dropped === undefined) return undefined;
  return {
    ...plan,
    creatures: plan.creatures - 1,
    spells: plan.spells + 1,
    creatureCurve: dropped.curve,
    spellRoles: [...plan.spellRoles, role],
    keywords: rescaleKeywords(plan.keywords, plan.creatures, plan.creatures - 1),
  };
}

function poolName(pool: Color | null): string {
  return pool ?? 'colorless';
}

function reserveAnswersIn(
  plans: RarityPlans,
  pool: Color | null,
  owed: number,
  brief: SetBrief,
  notes: string[],
): RarityPlans {
  let working = plans;
  const role = answerRoleOf(working, pool);
  if (role === undefined) {
    notes.push(
      `${poolName(pool)}: the pair(s) that can answer nowhere else need ${owed} answer(s) here, and the pool holds no role that prints one; the skeleton cannot reserve them.`,
    );
    return working;
  }
  // Each purchase adds exactly one answer role, so the count can never need more
  // turns than the floor itself.
  for (let bought = 0; bought < owed; bought += 1) {
    const short = owed - answerRoleCount(working, pool);
    if (short <= 0) break;
    const seat = loosestSeat(seatsIn(working, pool, brief));
    const spent = seat === undefined ? undefined : spendSeat(working[seat.rarity], seat, role);
    if (seat === undefined || spent === undefined) {
      notes.push(
        `${poolName(pool)}: ${short} more answer(s) are needed and every slot in the pool is claimed by the required list; the archetype gate will say which pair pays for it.`,
      );
      break;
    }
    working = { ...working, [seat.rarity]: spent };
    notes.push(
      `${seat.rarity} ${poolName(pool)}: ${seat.from} became a "${role}" slot; ` +
        `the color pie leaves at least one pair unable to print an answer in either of its colors, and a Limited deck needs ${owed}.`,
    );
  }
  return working;
}

/**
 * Reserves the answers the pairs that can answer nowhere else are owed.
 *
 * Deterministic, model-free and idempotent: a profile already holding the floor
 * is returned untouched, by identity, so a brief that needs nothing pays nothing
 * and its recorded prompts do not move a byte.
 */
export function reserveAnswers(
  profile: SkeletonLiteProfile,
  brief: SetBrief,
  floors: ArchetypeFloors = DEFAULT_ARCHETYPE_FLOORS,
): AnswerReservation {
  if (pairCapacity(profile) < floors.playables) return { profile, notes: [] };

  const notes: string[] = [];
  const colors = { ...profile.colors } as Record<Color, RarityPlans>;
  let colorless: RarityPlans = profile.colorless;
  let moved = false;

  for (const [pool, owed] of soleAnswerPools(floors)) {
    const before = pool === null ? colorless : colors[pool];
    if (answerRoleCount(before, pool) >= owed) continue;
    const after = reserveAnswersIn(before, pool, owed, brief, notes);
    if (after === before) continue;
    moved = true;
    if (pool === null) colorless = after;
    else colors[pool] = after;
  }

  if (!moved) return { profile, notes };
  return { profile: { ...profile, colors, colorless }, notes };
}
