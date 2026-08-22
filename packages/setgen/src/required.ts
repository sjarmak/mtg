/**
 * Required cards: reserving a slot for every card the brief names.
 *
 * The ZFC line runs straight through this file. Deciding *which* card a name
 * should become, what color Moonblade is, what it costs, what it does, is
 * semantic judgment and belongs to the model. A name is carried here and never
 * interpreted: it reaches a reservation note and a refusal message, and no slot
 * moves because of it. Deciding *whether* the finished set contains a card with
 * that name is structural, and that is all this does: it reserves one slot per
 * required card before any call, the prompt carries the name to that slot, and
 * `checkRequiredCards` measures the answer against the list.
 *
 * A required card may state a pool, a card kind, a rarity and a mana value,
 * which narrow the slots it can be reserved in. Those are the human's words, not
 * an inference from the name, and they are the only thing that makes reservation
 * a matching problem rather than a loop. The pool is one of the five colors or
 * `colorless`, which is the allocator's sixth pool and the one the flagship's
 * marquee gear lives in (the set design document, decision 5).
 *
 * Three of the four pins are exact the moment a slot is chosen: the pipeline
 * stamps pool, kind and rarity onto the printed card from the slot it filled.
 * Mana value is the one the model still writes, so `pin` below narrows the
 * chosen slot's cost window onto the stated number and lets
 * `checkSlotConformance` - which already fails a card costing outside its slot,
 * and already names the slot to regenerate - carry the pin the rest of the way.
 *
 * A required card may also declare itself Equipment, which is the one thing in
 * the brief's vocabulary that is about what a card does rather than where it
 * sits. It stays on the structural side of the line for the reason `brief.ts`
 * gives at the field: it offers CR 702.6b's clause and fills no part of it. What
 * it changes here is one thing, in `pin`: the reserved slot is allocated
 * `activated`, which is what routes the batch to the fill schema and the prompt
 * section that carry the clause.
 */
import type { AbilityKind } from '@mtg/dsl';
import type { RequiredCard, SetBrief } from './brief';
import { slotPoolFor } from './brief';
import { shuffle } from './rng';
import type { Rng } from './rng';
import type { Slot } from './slot';

/** Thrown when the skeleton has no assignment that seats every required card. */
export class UnplaceableRequiredCardsError extends Error {
  readonly cardNames: readonly string[];

  constructor(message: string, cardNames: readonly string[]) {
    super(message);
    this.name = 'UnplaceableRequiredCardsError';
    this.cardNames = cardNames;
  }
}

export interface RequiredReservation {
  /** The allocation's slots, with the reserved ones carrying their card. */
  readonly slots: readonly Slot[];
  /** One note per reservation, for the generation report. */
  readonly notes: readonly string[];
}

/** Whether a slot can take a required card: every pin it states, or anything. */
function accepts(slot: Slot, card: RequiredCard): boolean {
  if (card.color !== undefined && slot.color !== slotPoolFor(card.color)) return false;
  if (card.cardKind !== undefined && slot.cardKind !== card.cardKind) return false;
  if (card.rarity !== undefined && slot.rarity !== card.rarity) return false;
  if (card.manaValue === undefined) return true;
  return card.manaValue >= slot.manaValueMin && card.manaValue <= slot.manaValueMax;
}

/** What the card asked for, in the refusal message, in the order a human reads it. */
function describe(card: RequiredCard): string {
  const stated = [
    card.rarity ?? '',
    card.color ?? '',
    card.cardKind ?? '',
    card.manaValue === undefined ? '' : `MV ${card.manaValue}`,
  ].filter((part) => part.length > 0);
  return stated.length === 0 ? 'no stated color or kind' : stated.join(' ');
}

/**
 * The reserved slot, narrowed onto the card's stated cost.
 *
 * `accepts` only offered slots whose window covers the number, so this never
 * widens a window and never moves a slot out of its curve bucket: it collapses a
 * range the model could have answered anywhere inside onto the one value the
 * brief asked for.
 */
function pin(slot: Slot, card: RequiredCard): Slot {
  const allocated = abilityKindsFor(card);
  const reserved: Slot = allocated === null ? slot : { ...slot, abilityKinds: allocated };
  if (card.manaValue === undefined) return { ...reserved, requiredCard: card };
  return {
    ...reserved,
    requiredCard: card,
    manaValueMin: card.manaValue,
    manaValueMax: card.manaValue,
  };
}

/**
 * What a slot the brief said something mechanical about is allocated, replacing
 * whatever the skeleton gave it. `null` leaves the skeleton's list alone.
 *
 * Replacing rather than merging, and one kind rather than three. A required
 * card's clause *is* an ability of one kind, so the kind is not a second thing
 * the slot may print alongside the clause — it is what the clause is printed as,
 * and `checkSlotConformance` reads this list back to decide whether the card
 * that came home is the card the slot asked for. A weapon that answered with a
 * static lord instead would pass a list that also said `static`.
 *
 * The three cases are stated rather than inferred from anything about the card:
 *
 *  - a weapon prints CR 702.6b's clause, which is an activated ability;
 *  - a card that eats a named subtype pays for something, and only an activated
 *    ability is paid for;
 *  - a card that only drops a part, or supplies a named subtype, leaves it
 *    behind when it dies, which is the Monster half of decision 8 and is a
 *    triggered ability.
 *
 * A Chest is the second and the third at once, and the second wins: its part
 * arrives because the Chest was opened, and opening is what the sacrifice pays
 * for.
 */
function abilityKindsFor(card: RequiredCard): readonly AbilityKind[] | null {
  if (card.equipment || card.sacrificeSubtype !== undefined) return ACTIVATED_ONLY;
  if (card.partCounter !== undefined || card.suppliesSubtype !== undefined) return TRIGGERED_ONLY;
  return null;
}

const ACTIVATED_ONLY: readonly AbilityKind[] = ['activated'];
const TRIGGERED_ONLY: readonly AbilityKind[] = ['triggered'];

/**
 * Reserves one slot per required card.
 *
 * Candidate slots are walked in a seeded order rather than in collector-number
 * order, so a list of bare names spreads over the set instead of stacking onto
 * the first color the allocator happens to build. That is a structural choice,
 * not a judgment about where a name belongs: the code has no opinion about
 * which color Moonblade is, and a brief that does says so in the brief.
 */
export function pinRequiredCards(slots: readonly Slot[], brief: SetBrief, rng: Rng): RequiredReservation {
  const required = brief.requiredCards;
  if (required.length === 0) return { slots, notes: [] };

  const order = shuffle(
    slots.map((_unused, index) => index),
    rng,
  );
  const candidates = required.map((card) =>
    order.filter((index) => {
      const slot = slots[index];
      return slot !== undefined && accepts(slot, card);
    }),
  );

  const owners = match(candidates);
  const unplaced = required.flatMap((card, index) => (owners.has(index) ? [] : [{ card, index }]));
  if (unplaced.length > 0) {
    throw new UnplaceableRequiredCardsError(
      [
        `allocateSlots: the brief requires ${unplaced.length} card(s) the skeleton has no slot for:`,
        ...unplaced.map(({ card, index }) => {
          const matching = candidates[index]?.length ?? 0;
          const why =
            matching === 0
              ? 'no slot in the set matches'
              : `all ${matching} matching slots are taken by other required cards`;
          return `  - "${card.name}" (${describe(card)}): ${why}`;
        }),
      ].join('\n'),
      unplaced.map(({ card }) => card.name),
    );
  }

  const cardBySlotIndex = new Map<number, RequiredCard>();
  for (const [requiredIndex, slotIndex] of owners) {
    const card = required[requiredIndex];
    if (card !== undefined) cardBySlotIndex.set(slotIndex, card);
  }

  const notes: string[] = [];
  const reserved = slots.map((slot, index) => {
    const card = cardBySlotIndex.get(index);
    if (card === undefined) return slot;
    notes.push(`${slot.id}: reserved for the required card "${card.name}".`);
    return pin(slot, card);
  });
  return { slots: reserved, notes };
}

/**
 * Maximum bipartite matching of required cards to slots (Kuhn's algorithm).
 *
 * A greedy pass would reject briefs the skeleton can satisfy: an unconstrained
 * name taking the last red slot would strand a card that asked for red, and the
 * error would name a card that was placeable all along. The matching is exact,
 * so the throw above only fires when no assignment exists at all.
 *
 * That difference is a fixture, not an assertion: `required-matching.test.ts`
 * walks two slots and two names in the order that paints greedy into the
 * corner. Swap the augmenting path below for a greedy pass and that file turns
 * red; before it existed, nothing in the package did.
 */
function match(candidates: readonly (readonly number[])[]): ReadonlyMap<number, number> {
  const slotOwner = new Map<number, number>();

  const seat = (requiredIndex: number, visited: Set<number>): boolean => {
    for (const slotIndex of candidates[requiredIndex] ?? []) {
      if (visited.has(slotIndex)) continue;
      visited.add(slotIndex);
      const holder = slotOwner.get(slotIndex);
      if (holder === undefined || seat(holder, visited)) {
        slotOwner.set(slotIndex, requiredIndex);
        return true;
      }
    }
    return false;
  };

  for (let requiredIndex = 0; requiredIndex < candidates.length; requiredIndex += 1) {
    seat(requiredIndex, new Set<number>());
  }

  const owners = new Map<number, number>();
  for (const [slotIndex, requiredIndex] of slotOwner) owners.set(requiredIndex, slotIndex);
  return owners;
}
