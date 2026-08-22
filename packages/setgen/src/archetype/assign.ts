/**
 * Tagging allocated slots with the archetypes they were reserved for.
 *
 * Two kinds of reservation land here. A **support** slot is a body the
 * reservation pass bought by converting an inert spell role; it belongs to every
 * archetype its color appears in, because a body is playable in all four.
 * A **signpost** slot is one uncommon per pair reserved to advertise that pair's
 * plan (`prior-art-set-design.md` §5; N&B #16 prints two multicolor signposts
 * per pair). The slice derives no multicolor slots, so what this pass can
 * actually reserve is a mono-colored card both halves of the pair want, and that
 * is a reservation rather than a signpost: four archetypes take it on equal
 * terms and none of them learns a pair from it. The reservation stands, because
 * a card carrying the payoff at uncommon is what the pair has; the claim does
 * not, and `assessPair` is where it stops being made.
 *
 * The tags are not decoration: the prompt shows them to the model, the report
 * prints them, and the viability validator asserts that each pair's reserved
 * uncommon actually carries the pair's payoff vocabulary.
 */
import type { Color, Keyword } from '@mtg/dsl';
import { COLORS } from '@mtg/dsl';
import type { PieLevel, SkeletonLiteProfile } from '@mtg/design-data';
import { classify } from '@mtg/design-data';
import type { Slot } from '../slot';
import { carriesAbilities } from '../slot';
import type { ArchetypePlan } from './pairs';
import { plansForColor, plansHostedBy } from './pairs';
import type { SupportReservation } from './reserve';
import type { ArchetypeFloors } from './viability';
import { DEFAULT_ARCHETYPE_FLOORS, pairCapacity } from './viability';

export interface AssignmentResult {
  readonly slots: readonly Slot[];
  readonly notes: readonly string[];
}

/**
 * Recomputes a slot's brief-mechanic tags after its keywords change. Passed in
 * by the allocator, which owns the brief; a slot that loses its keyword must
 * not keep claiming to support the mechanic that keyword carried.
 */
export type MechanicsFor = (keywords: readonly Keyword[], color: Color | null) => readonly string[];

function tagSupport(slot: Slot, archetypes: readonly string[]): Slot {
  return { ...slot, archetypes: [...new Set([...slot.archetypes, ...archetypes])] };
}

/** A signpost has one job, so it drops any support tags it had picked up. */
function tagSignpost(slot: Slot, pair: string): Slot {
  return { ...slot, archetypes: [pair], signpost: true };
}

const PIE_PREFERENCE: Readonly<Record<PieLevel, number>> = {
  primary: 0,
  secondary: 1,
  tertiary: 2,
  offPie: 3,
};

/**
 * The keyword a plan's signpost should carry, chosen in the *host* color.
 *
 * A plan's `payoffKeywords` are ranked across the pair, so a keyword that is
 * primary in one half can outrank one the host actually specializes in — which
 * is how both green signposts ended up flying rather than trampling. Ranking
 * again in the host color fixes that, and a keyword already spent on the
 * color's other signpost goes last so a color's two uncommons advertise two
 * different plans instead of the same one twice.
 */
function payoffKeywordFor(
  plan: ArchetypePlan,
  color: Color,
  taken: ReadonlySet<Keyword>,
): Keyword | undefined {
  return plan.payoffKeywords
    .filter((keyword) => classify(keyword, color).verdict !== 'fail')
    .map((keyword, order) => ({ keyword, order }))
    .sort(
      (a, b) =>
        Number(taken.has(a.keyword)) - Number(taken.has(b.keyword)) ||
        PIE_PREFERENCE[classify(a.keyword, color).level] - PIE_PREFERENCE[classify(b.keyword, color).level] ||
        a.order - b.order,
    )[0]?.keyword;
}

interface Candidate {
  readonly index: number;
  readonly slot: Slot;
}

/**
 * Uncommons of one color, with the bodies already doing support duty for four
 * pairs pushed to the back: a signpost that also has to be everybody's two-drop
 * advertises nothing.
 */
function candidatesFor(slots: readonly Slot[], color: Color): Candidate[] {
  return slots
    .map((slot, index) => ({ slot, index }))
    .filter((item) => item.slot.color === color && item.slot.rarity === 'uncommon')
    .sort((a, b) => a.slot.archetypes.length - b.slot.archetypes.length || a.index - b.index);
}

/**
 * Picks the uncommon that best advertises a plan, in preference order: a body
 * already carrying the payoff keyword, then a spell already carrying a payoff
 * effect, then the largest body (which then has the payoff keyword stamped on
 * it). Ties break on slot order, so the choice is a pure function of the
 * allocation.
 */
function chooseSignpost(candidates: readonly Candidate[], plan: ArchetypePlan): Candidate | undefined {
  const byKeyword = candidates.find((item) =>
    item.slot.keywords.some((keyword) => plan.payoffKeywords.includes(keyword)),
  );
  if (byKeyword !== undefined) return byKeyword;
  const byEffect = candidates.find((item) =>
    item.slot.effectKinds.some((kind) => plan.payoffEffects.includes(kind)),
  );
  if (byEffect !== undefined) return byEffect;
  const bodies = candidates.filter((item) => item.slot.cardKind === 'creature');
  const biggest = [...bodies].sort(
    (a, b) => b.slot.manaValueMax - a.slot.manaValueMax || a.index - b.index,
  )[0];
  return biggest ?? candidates[0];
}

/**
 * Gives a signpost body the plan's keyword, taking the token from another
 * keyworded body in the same group so the color's keyword budget is unchanged.
 * A group with no donor keeps the extra keyword and says so.
 */
function stampKeyword(
  slots: Slot[],
  chosen: Candidate,
  keyword: Keyword,
  mechanicsFor: MechanicsFor,
  notes: string[],
): void {
  const current = chosen.slot;
  if (current.keywords.includes(keyword)) return;
  if (current.keywords.length === 0) {
    const donorIndex = slots.findIndex(
      (slot, index) =>
        index !== chosen.index &&
        slot.color === current.color &&
        slot.rarity === current.rarity &&
        slot.cardKind === 'creature' &&
        !slot.signpost &&
        slot.keywords.length > 0,
    );
    const donor = donorIndex < 0 ? undefined : slots[donorIndex];
    if (donor !== undefined) {
      slots[donorIndex] = { ...donor, keywords: [], mechanics: mechanicsFor([], donor.color) };
      notes.push(`${donor.id}: gave its keyword token to the signpost ${current.id}.`);
    } else {
      notes.push(
        `${current.id}: carries ${keyword} as a signpost with no donor slot to take the token from, so the group prints one extra keyword.`,
      );
    }
  }
  const updated = slots[chosen.index];
  if (updated !== undefined) {
    notes.push(
      `${updated.id}: stamped with ${keyword}${updated.keywords.length > 0 ? ` in place of ${updated.keywords.join(', ')}` : ''} to carry its archetype's payoff.`,
    );
    slots[chosen.index] = {
      ...updated,
      keywords: [keyword],
      mechanics: mechanicsFor([keyword], updated.color),
    };
  }
}

/**
 * Gives a signpost the ability kinds its pair's payoff is printed inside, when
 * nothing else on the slot can say the payoff.
 *
 * The keyword case above has `stampKeyword`; this is the effect case, and
 * without it a pair whose payoff is an effect had no case at all. The allocator
 * reserves ability slots per brief mechanic, at most one per mechanic per group,
 * and it runs *before* signposts are chosen — so which uncommon carries an
 * ability is decided by slot order, and a color hosting two pairs off one
 * ability mechanic gives one signpost the ability and the other nothing. That
 * second signpost is then asked by `ARCHETYPE_SIGNPOST_OFF_PLAN` for vocabulary
 * `checkAbilityKinds` forbids it, and the regeneration loop spends rounds on a
 * slot no card can satisfy.
 *
 * The group's ability count may go up by one, and at uncommon that costs
 * nothing: `checkNewWorldOrder` budgets red flags over commons only.
 *
 * `judged` is false for a set too small for any pair to fill a deck, where
 * `checkArchetypeViability` abstains and never asks a signpost for anything. The
 * reservation stands down with it rather than rewriting the prompt of a set
 * nothing will read it back on.
 *
 * **This pass is what widened the flagship set's `balance.spread`, and it is
 * accepted rather than reverted.** Measured 2026-08-14 under `mtg-x1s`, which
 * was filed against all three of the allocator changes that landed the day the
 * flagship first reported `enforceable: true`; the other two are cleared here.
 * The two committed builds either side of that swap differ by 35 printed cards,
 * of which only 6 sit on a slot any of those changes moved, so the pools were
 * played as hybrids: the old build plus one group of the new build's cards at a
 * time, every group under the balance harness's own sweep at the pinned 10,035
 * games, each figure the mean of eight run seeds.
 *
 *   old build                                              0.085
 *   old + the 29 cards no allocator change touched         0.087   t = 0.3
 *   old + the 3 colorless cards the answer reservation
 *     and the required-card cut moved                      0.090
 *   old + the 3 signposts *this* pass reserved             0.123
 *   old + all 6 cards on moved slots                       0.128   t = 6.2
 *   new build                                              0.117   t = 4.3
 *
 * Model variance on the 29 cards that changed for no allocator reason moves
 * nothing. Every point of the widening is this pass, and the mechanism is not a
 * moved pool: the reservation edits `abilityKinds` and no other field, which is
 * what `assignArchetypes moves the vocabulary and the tags` in
 * `test/archetype.test.ts` holds. Three of the flagship's ten signposts had no
 * ability slot and printed a bare keyword; after the reservation each printed
 * its pair's payoff, and because a signpost is mono-colored, the lift follows
 * the *color* rather than the pair. Black's signpost alone carries +0.020 of
 * the +0.038 and raises all four black pairs by 0.8-1.6pp. Two of those pairs
 * were already the top of the band, so the ceiling rose; the pairs that gained
 * nothing paid for it in a closed round robin, and the pair already at the floor
 * fell furthest.
 *
 * The evenness this cost was bought by three pairs having a signpost that
 * advertised nothing, which is not evenness worth keeping, and 0.117 sits well
 * inside the gate's 30% bound. What is worth watching is that the grant carries
 * no power budget: nine of the ten signposts spent the reserved ability on a
 * 0/1 token and the tenth spent it on a 4/4 flier, and nothing between here and
 * the printed card prices the difference. `checkNewWorldOrder` budgets red flags
 * over commons, so an uncommon's reserved ability is unpriced by construction.
 * That gap is `mtg-71j`, not this function.
 *
 * **What falsifies the table.** Every figure is a mean of eight seeds, because
 * one seed cannot resolve this: `balance.spread` is a max minus a min over ten
 * sampled rates, and on a 75-card pool at this volume it carries a standard
 * deviation of 0.008-0.019 seed to seed. Re-run
 * `npx tsx packages/metrics/tools/seed-variance.ts <set.json>` on the two builds
 * and the four hybrids; a run whose group means do not order this way, or whose
 * 29-card group stops reading flat against the old build, means the attribution
 * is wrong and not that the seeds were unlucky.
 */
function reserveSignpostAbilities(
  slots: Slot[],
  chosen: Candidate,
  plan: ArchetypePlan,
  judged: boolean,
  notes: string[],
): void {
  if (!judged || plan.payoffAbilityKinds.length === 0) return;
  const slot = slots[chosen.index];
  if (slot === undefined || !carriesAbilities(slot) || slot.abilityKinds.length > 0) return;
  // A slot that can already say the payoff needs no ability to say it with.
  if (plan.payoffKeywords.some((keyword) => slot.keywords.includes(keyword))) return;
  if (plan.payoffEffects.some((kind) => slot.effectKinds.includes(kind))) return;
  slots[chosen.index] = { ...slot, abilityKinds: plan.payoffAbilityKinds };
  notes.push(
    `${slot.id}: allocated [${plan.payoffAbilityKinds.join(', ')}] so the ${plan.pair} signpost can print ` +
      `its payoff (${plan.payoffEffects.join(', ')}); a permanent prints an effect only inside an ability.`,
  );
}

function assignSignposts(
  slots: Slot[],
  plans: readonly ArchetypePlan[],
  mechanicsFor: MechanicsFor,
  judged: boolean,
  notes: string[],
): void {
  for (const color of COLORS) {
    const taken = new Set<number>();
    const spent = new Set<Keyword>();
    for (const plan of plansHostedBy(plans, color)) {
      const free = candidatesFor(slots, color).filter((item) => !taken.has(item.index));
      const chosen = chooseSignpost(free, plan);
      if (chosen === undefined) {
        notes.push(`${plan.pair}: ${color} has no uncommon slot left to carry the signpost.`);
        continue;
      }
      taken.add(chosen.index);
      const keyword = payoffKeywordFor(plan, color, spent);
      if (keyword !== undefined) spent.add(keyword);
      if (chosen.slot.cardKind === 'creature' && keyword !== undefined) {
        stampKeyword(slots, chosen, keyword, mechanicsFor, notes);
      }
      reserveSignpostAbilities(slots, chosen, plan, judged, notes);
      const current = slots[chosen.index];
      if (current !== undefined) slots[chosen.index] = tagSignpost(current, plan.pair);
      notes.push(`${chosen.slot.id}: reserved as the ${plan.pair} signpost (${plan.identity}).`);
    }
  }
}

function assignSupport(
  slots: Slot[],
  plans: readonly ArchetypePlan[],
  support: readonly SupportReservation[],
  notes: string[],
): void {
  for (const reservation of support) {
    const pairs = plansForColor(plans, reservation.color).map((plan) => plan.pair);
    const index = slots.findIndex(
      (slot) =>
        slot.color === reservation.color &&
        slot.rarity === reservation.rarity &&
        slot.cardKind === 'creature' &&
        slot.archetypes.length === 0 &&
        reservation.manaValue >= slot.manaValueMin &&
        reservation.manaValue <= slot.manaValueMax,
    );
    const slot = index < 0 ? undefined : slots[index];
    if (slot === undefined) {
      notes.push(
        `${reservation.color} ${reservation.rarity}: no MV ${reservation.manaValue} body to tag as archetype support; the conversion still stands.`,
      );
      continue;
    }
    slots[index] = tagSupport(slot, pairs);
  }
}

export interface ArchetypeAssignmentInput {
  readonly slots: readonly Slot[];
  readonly plans: readonly ArchetypePlan[];
  readonly support: readonly SupportReservation[];
  /** The profile actually allocated against, for the undersized abstention. */
  readonly profile: SkeletonLiteProfile;
  readonly mechanicsFor: MechanicsFor;
  readonly floors?: ArchetypeFloors;
}

/**
 * Tags support and signpost slots. Support first, so a signpost never lands on a
 * body that is already doing archetype duty for four pairs.
 */
export function assignArchetypes(input: ArchetypeAssignmentInput): AssignmentResult {
  const floors = input.floors ?? DEFAULT_ARCHETYPE_FLOORS;
  const judged = pairCapacity(input.profile) >= floors.playables;
  const working = [...input.slots];
  const notes: string[] = [];
  assignSupport(working, input.plans, input.support, notes);
  assignSignposts(working, input.plans, input.mechanicsFor, judged, notes);
  return { slots: working, notes };
}
