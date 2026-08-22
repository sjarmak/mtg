import { describe, expect, it } from 'vitest';
import type { CardKind, Color } from '@mtg/dsl';
import { MIN_SLICE_TARGET_SIZE } from '@mtg/design-data';
import type { Rng, SetBrief, SetBriefInput, Slot } from '@mtg/setgen';
import {
  allocateSlots,
  parseBrief,
  pinRequiredCards,
  shuffle,
  slotId,
  UnplaceableRequiredCardsError,
} from '@mtg/setgen';
import { TEST_BRIEF } from './helpers';

/**
 * Required cards, pinned at the matcher.
 *
 * `required-cards.test.ts` covers the feature from outside, through
 * `allocateSlots` and `generateSet`. The decisions this file is about are
 * invisible from there: which of several legal assignments the matcher reaches,
 * what a refusal says about a card nobody could seat, and that a card's name
 * never moves a slot. Each one is held by a fixture small enough to read.
 */

/** One slot, carrying the fields the reservation actually reads. */
function slot(index: number, color: Color | null, cardKind: CardKind): Slot {
  return {
    id: slotId('common', color, index + 1),
    index,
    collectorNumber: index + 1,
    rarity: 'common',
    color,
    cardKind,
    role: cardKind === 'creature' ? 'creature' : 'filler',
    manaValueMin: 2,
    manaValueMax: 3,
    keywords: [],
    effectKinds: [],
    abilityKinds: [],
    auraModifications: [],
    triggerConditions: [],
    mechanics: [],
    archetypes: [],
    signpost: false,
  };
}

function briefRequiring(requiredCards: SetBriefInput['requiredCards']): SetBrief {
  return parseBrief({ ...TEST_BRIEF, requiredCards });
}

/**
 * An rng that leaves Fisher-Yates' order alone.
 *
 * `pinRequiredCards` walks candidate slots in shuffled order, so which
 * assignment a greedy pass reaches depends on that order. Holding the order
 * still is what lets a two-slot fixture separate greedy from exact matching.
 * The first test asserts the order rather than assuming it.
 */
const unshuffled: Rng = () => 0.999999;

describe('the matcher backs out of a corner greedy assignment walks into', () => {
  /**
   * Two slots, walked left to right. "Wandering Merchant" states nothing and
   * fits both. "Silver Direhorn" states red and fits only the first. Greedy hands
   * the red slot to the merchant, which is asked first, then refuses a brief
   * the skeleton can satisfy and blames the Direhorn, which was placeable all
   * along. Kuhn's augmenting path moves the merchant to white and seats both.
   */
  const slots = [slot(0, 'R', 'creature'), slot(1, 'W', 'creature')];
  const brief = briefRequiring([{ name: 'Wandering Merchant' }, { name: 'Silver Direhorn', color: 'R' }]);

  it('walks the two slots in the order the fixture claims', () => {
    expect(shuffle([0, 1], unshuffled)).toStrictEqual([0, 1]);
  });

  it('displaces the unconstrained card so the constrained one can be seated', () => {
    const { slots: reserved } = pinRequiredCards(slots, brief, unshuffled);
    expect(reserved.map((seat) => seat.requiredCard?.name)).toStrictEqual([
      'Silver Direhorn',
      'Wandering Merchant',
    ]);
  });

  it('notes each reservation once, in slot order', () => {
    const { notes } = pinRequiredCards(slots, brief, unshuffled);
    expect(notes).toStrictEqual([
      'CR01: reserved for the required card "Silver Direhorn".',
      'CW02: reserved for the required card "Wandering Merchant".',
    ]);
  });
});

describe('a required card states its own constraints or none', () => {
  it('skips the slot it would walk first when the card states a color or a kind', () => {
    const slots = [slot(0, 'R', 'creature'), slot(1, 'W', 'creature'), slot(2, 'R', 'instant')];
    const { slots: reserved } = pinRequiredCards(
      slots,
      briefRequiring([
        { name: 'Skyborn Windblade', color: 'W' },
        { name: 'Vorn Charge', cardKind: 'instant' },
      ]),
      unshuffled,
    );
    expect(reserved.map((seat) => seat.requiredCard?.name)).toStrictEqual([
      undefined,
      'Skyborn Windblade',
      'Vorn Charge',
    ]);
  });

  it('seats a card that states no color on a colorless slot', () => {
    const { slots } = pinRequiredCards(
      [slot(0, null, 'artifact')],
      briefRequiring([{ name: 'Last Blow Obliterator' }]),
      unshuffled,
    );
    expect(slots[0]?.requiredCard?.name).toBe('Last Blow Obliterator');
  });

  it('refuses a card that states a color when only the colorless pool is left', () => {
    expect(() =>
      pinRequiredCards(
        [slot(0, null, 'artifact')],
        briefRequiring([{ name: 'Moonblade', color: 'W' }]),
        unshuffled,
      ),
    ).toThrow(/no slot in the set matches/);
  });

  it('reserves the same slots whatever the required cards are called', () => {
    const constraints = [{ color: 'R' as const }, { cardKind: 'creature' as const }, {}];
    const reservedIds = (names: readonly string[]): string[] =>
      allocateSlots(briefRequiring(constraints.map((card, index) => ({ ...card, name: names[index] ?? '' }))))
        .slots.filter((seat) => seat.requiredCard !== undefined)
        .map((seat) => seat.id);

    expect(reservedIds(['Aa', 'Bb', 'Cc'])).toStrictEqual(
      reservedIds(['Moonblade', 'Silver Direhorn', 'King Wyrmhead']),
    );
  });

  /**
   * Stated as reaching a pool collector order never gets to, not as a color count.
   *
   * This used to compare how many colors each side spanned, which worked while
   * the set's first five slots were two colors deep and read as an accident
   * afterwards: at twenty cards the prefix is now three colors (two commons a
   * color, so W, W, U, U, B) and the five reserved slots are three as well, on a
   * different three. The counts tied while the behavior did not change at all.
   * What the allocator actually does is refuse to seat by collector number, so
   * that is what is asserted: different slots, and at least one pool the prefix
   * never reaches. Swept over sizes so neither half is a fact about twenty
   * cards.
   */
  it('spreads bare names across the set instead of stacking them on its first color', () => {
    const bare = Array.from({ length: 5 }, (_unused, index) => ({ name: `Named Card ${index + 1}` }));
    for (const targetSize of [MIN_SLICE_TARGET_SIZE, 25, 90]) {
      const { slots } = allocateSlots(parseBrief({ ...TEST_BRIEF, targetSize, requiredCards: bare }));
      const reserved = slots.filter((seat) => seat.requiredCard !== undefined);
      expect(reserved, `size ${targetSize} reserved a slot per name`).toHaveLength(bare.length);

      const prefix = slots.slice(0, bare.length);
      expect(
        reserved.map((seat) => seat.id),
        `size ${targetSize} seated by collector number`,
      ).not.toStrictEqual(prefix.map((seat) => seat.id));

      const reachable = new Set(prefix.map((seat) => seat.color));
      const beyond = reserved.filter((seat) => !reachable.has(seat.color));
      expect(
        beyond.length,
        `size ${targetSize} stayed inside the pools collector order offers`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('the refusal names the cards it could not seat', () => {
  function refusalFor(
    slots: readonly Slot[],
    cards: SetBriefInput['requiredCards'],
  ): UnplaceableRequiredCardsError {
    try {
      pinRequiredCards(slots, briefRequiring(cards), unshuffled);
    } catch (error: unknown) {
      if (error instanceof UnplaceableRequiredCardsError) return error;
      throw error;
    }
    throw new Error('pinRequiredCards seated every card; the fixture is wrong');
  }

  it('blames the card left over, not the one that took the slot', () => {
    const error = refusalFor([slot(0, 'R', 'creature')], [{ name: 'Moonblade' }, { name: 'Vantan Shield' }]);

    expect(error.name).toBe('UnplaceableRequiredCardsError');
    expect(error.cardNames).toStrictEqual(['Vantan Shield']);
    expect(error.message).toContain(
      '"Vantan Shield" (no stated color or kind): all 1 matching slots are taken by other required cards',
    );
    expect(error.message).not.toContain('"Moonblade"');
  });

  it('lists every card left over, in the order the brief named them', () => {
    const error = refusalFor(
      [slot(0, 'R', 'creature')],
      [
        { name: 'Silver Direhorn', color: 'R' },
        { name: 'King Wyrmhead', cardKind: 'creature' },
        { name: 'Gloom Spawn' },
      ],
    );

    expect(error.cardNames).toStrictEqual(['King Wyrmhead', 'Gloom Spawn']);
    expect(error.message).toContain('the brief requires 2 card(s) the skeleton has no slot for');
    expect(error.message).toContain('"King Wyrmhead" (creature): all 1 matching slots are taken');
    expect(error.message).toContain(
      '"Gloom Spawn" (no stated color or kind): all 1 matching slots are taken',
    );
  });

  it('describes a card by the words the brief used, and says when no slot matches at all', () => {
    const error = refusalFor(
      [slot(0, 'R', 'creature')],
      [{ name: 'Vorn Charge', color: 'W', cardKind: 'instant' }],
    );

    expect(error.message).toContain('"Vorn Charge" (W instant): no slot in the set matches');
  });
});

describe('a brief that requires nothing', () => {
  it('hands its slots back unchanged, with no notes', () => {
    const slots = [slot(0, 'R', 'creature'), slot(1, 'W', 'creature')];
    const reservation = pinRequiredCards(slots, parseBrief(TEST_BRIEF), unshuffled);
    expect(reservation.slots).toStrictEqual(slots);
    expect(reservation.notes).toStrictEqual([]);
  });

  it('allocates the same skeleton as a brief that names five cards', () => {
    const bare = Array.from({ length: 5 }, (_unused, index) => ({ name: `Named Card ${index + 1}` }));
    const withoutRequired = allocateSlots(parseBrief(TEST_BRIEF)).slots;
    const withRequired = allocateSlots(briefRequiring(bare)).slots;

    // A name takes a slot the census already accounted for: strip the
    // reservations and the two skeletons are the same set of cards to design.
    const stripped = withRequired.map(({ requiredCard: _unused, ...rest }) => rest);
    expect(stripped).toStrictEqual(withoutRequired);
    expect(withRequired.filter((seat) => seat.requiredCard !== undefined)).toHaveLength(5);
  });
});
