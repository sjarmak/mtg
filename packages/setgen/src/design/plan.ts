/**
 * What the allocator would build from a brief, before anything is spent.
 *
 * `mtg-yddw.3`. This is the half of the designer that earns its keep. A brief is
 * a paragraph of intent and a set is 90 to 250 cards, and the whole distance
 * between them is `allocateSlots`, which is *free*: it runs on a seed and a
 * profile and calls no provider. So a designer can see the consequences of a
 * size, a mechanic's colors or a required card's stated rarity in the time it
 * takes to press a key, and the paid run stops being the thing that discovers
 * them.
 *
 * # A census, not the slots
 *
 * `Allocation.slots` is one object per card with fifteen fields on it, and a set
 * has hundreds. Sending them all would make the response an order of magnitude
 * larger than the brief that produced it, for a page that draws counts. So this
 * summarizes: how many cards per pool per tier, how the curve falls, which
 * mechanics reached how many slots, and every named card with the slot it was
 * seated in. The one place individual slots survive is the required-card list,
 * because "Moonblade is a rare four-drop artifact in the colorless pool" is a
 * sentence about one slot and is the answer a designer came here for.
 *
 * # Two failures, told apart
 *
 * `derivePins` moves a required card's pins to a tier the size can seat, and
 * says so in a note; `allocateSlots` throws when the brief asks for something no
 * skeleton can build at all. The first is information and the second is a
 * refusal, so they arrive as different fields rather than as one list of
 * strings. A page that drew them together would show a set that builds fine
 * beside a set that does not build.
 */
import { COLORS } from '@mtg/dsl';
import { SLICE_RARITIES } from '@mtg/design-data';
import type { SliceRarity } from '@mtg/design-data';
import { allocateSlots } from '../allocate';
import type { SetBrief } from '../brief';
import { derivePins } from '../pins';
import type { Slot } from '../slot';

/** The label a pool is counted under: a color letter, or the colorless pool. */
const COLORLESS_POOL = 'colorless';

/** One pool's tier counts, in `SLICE_RARITIES` order. */
export interface SkeletonPoolCensus {
  /** `W`..`G`, or `colorless`. */
  readonly pool: string;
  readonly byRarity: Readonly<Record<SliceRarity, number>>;
  readonly total: number;
}

/** How many slots sit at each mana value, lowest first. */
export interface CurvePoint {
  readonly manaValue: number;
  readonly slots: number;
}

/** Where one of the brief's named cards ended up. */
export interface SeatedCard {
  readonly name: string;
  readonly slotId: string;
  readonly pool: string;
  readonly rarity: SliceRarity;
  readonly cardKind: string;
  readonly role: string;
  readonly manaValueMin: number;
  readonly manaValueMax: number;
}

/** How far a stated mechanic reached into the skeleton. */
export interface MechanicReach {
  readonly name: string;
  readonly slots: number;
  /** Slots at common, which is the tier a theme has to reach (set-design §11, failure mode 8). */
  readonly commonSlots: number;
}

export interface SkeletonPlan {
  readonly setCode: string;
  readonly setName: string;
  readonly targetSize: number;
  readonly slots: number;
  readonly pools: readonly SkeletonPoolCensus[];
  readonly curve: readonly CurvePoint[];
  readonly mechanics: readonly MechanicReach[];
  readonly seated: readonly SeatedCard[];
  /**
   * Named cards the allocation seated nowhere.
   *
   * Empty in every run that reaches here, because `allocateSlots` refuses a
   * brief it cannot seat rather than dropping the card. It is reported anyway:
   * the day that changes, a designer should read a name rather than count rows.
   */
  readonly unseated: readonly string[];
  /** `derivePins`' notes: a pin this size could not honor exactly, and where it went. */
  readonly pinNotes: readonly string[];
  /** The allocator's own notes, in the order it made the judgments. */
  readonly notes: readonly string[];
}

export type SkeletonPlanResult =
  { readonly ok: true; readonly plan: SkeletonPlan } | { readonly ok: false; readonly reason: string };

function poolName(color: Slot['color']): string {
  return color === null ? COLORLESS_POOL : color;
}

function censusOf(slots: readonly Slot[]): readonly SkeletonPoolCensus[] {
  const pools = [...COLORS.map((color) => String(color)), COLORLESS_POOL];
  return pools.map((pool) => {
    const mine = slots.filter((slot) => poolName(slot.color) === pool);
    const byRarity = Object.fromEntries(
      SLICE_RARITIES.map((rarity) => [rarity, mine.filter((slot) => slot.rarity === rarity).length]),
    ) as Record<SliceRarity, number>;
    return { pool, byRarity, total: mine.length };
  });
}

/**
 * The curve over a slot's *floor*, which is the honest reading of a window.
 *
 * A slot carries a mana-value range and the printed card lands somewhere inside
 * it, so there is no curve of printed costs to report before anything is
 * printed. The floor is the one end the slot promises, and a chart drawn off the
 * midpoint would invent a precision the allocation does not have.
 */
function curveOf(slots: readonly Slot[]): readonly CurvePoint[] {
  const counts = new Map<number, number>();
  for (const slot of slots) counts.set(slot.manaValueMin, (counts.get(slot.manaValueMin) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([manaValue, count]) => ({ manaValue, slots: count }));
}

function reachOf(brief: SetBrief, slots: readonly Slot[]): readonly MechanicReach[] {
  return brief.mechanics.map((mechanic) => {
    const mine = slots.filter((slot) => slot.mechanics.includes(mechanic.name));
    return {
      name: mechanic.name,
      slots: mine.length,
      commonSlots: mine.filter((slot) => slot.rarity === 'common').length,
    };
  });
}

function seatedOf(slots: readonly Slot[]): readonly SeatedCard[] {
  const seated: SeatedCard[] = [];
  for (const slot of slots) {
    const required = slot.requiredCard;
    if (required === undefined) continue;
    seated.push({
      name: required.name,
      slotId: slot.id,
      pool: poolName(slot.color),
      rarity: slot.rarity,
      cardKind: slot.cardKind,
      role: slot.role,
      manaValueMin: slot.manaValueMin,
      manaValueMax: slot.manaValueMax,
    });
  }
  return seated;
}

/**
 * Allocate the brief and summarize it. Costs nothing and calls no provider.
 *
 * The `try` is around `allocateSlots` rather than around the summary, and it is
 * narrow on purpose: a `RangeError` from the allocator is a statement about the
 * brief that a designer should read, and a bug in the summary below is not. Only
 * `Error` is turned into a reason; anything else rethrows.
 */
export function planSkeleton(brief: SetBrief): SkeletonPlanResult {
  let pinned;
  let allocation;
  try {
    pinned = derivePins(brief);
    allocation = allocateSlots(pinned.brief);
  } catch (error: unknown) {
    if (error instanceof Error) return { ok: false, reason: error.message };
    throw error;
  }
  const seated = seatedOf(allocation.slots);
  const seatedNames = new Set(seated.map((card) => card.name));
  return {
    ok: true,
    plan: {
      setCode: brief.setCode,
      setName: brief.setName,
      targetSize: brief.targetSize,
      slots: allocation.slots.length,
      pools: censusOf(allocation.slots),
      curve: curveOf(allocation.slots),
      mechanics: reachOf(brief, allocation.slots),
      seated,
      unseated: brief.requiredCards.map((card) => card.name).filter((name) => !seatedNames.has(name)),
      pinNotes: pinned.notes,
      notes: allocation.notes,
    },
  };
}
