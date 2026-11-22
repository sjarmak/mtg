/**
 * A Limited deck stays a collection of drafted physical copies until the last
 * backend seam. Names are deliberately not identities here: a cube can contain
 * two printings with the same name, while each drafted position is usable once.
 */
import { describe, expect, it } from 'vitest';
import type { LimitedCardFacts, LimitedDeck, PhysicalPoolCard } from '@mtg/limited';
import {
  CANONICAL_BASIC_NAMES,
  LimitedDeckError,
  addBasic,
  addPhysicalCard,
  cutBasic,
  cutPhysicalCard,
  prepareLimitedDeck,
  setBasicCount,
  suggestLimitedDeck,
  toDeckRef,
  validateLimitedDeck,
} from '@mtg/limited';

interface PrintedFixture {
  readonly ordinal: number;
  readonly name: string;
  readonly colors: readonly ('W' | 'U' | 'B' | 'R' | 'G')[];
  readonly type: LimitedCardFacts['type'];
  readonly score: number;
}

function fixtureCard(
  ordinal: number,
  overrides: Partial<PrintedFixture> = {},
): PhysicalPoolCard<PrintedFixture> {
  return {
    physicalId: `pick-${String(ordinal).padStart(2, '0')}`,
    payload: {
      ordinal,
      name: `Card ${String(ordinal)}`,
      colors: ordinal % 2 === 0 ? ['U'] : ['R'],
      type: ordinal % 3 === 0 ? 'creature' : 'noncreature-spell',
      score: 100 - ordinal,
      ...overrides,
    },
  };
}

const POOL: readonly PhysicalPoolCard<PrintedFixture>[] = Array.from({ length: 45 }, (_unused, ordinal) =>
  fixtureCard(ordinal),
);

function facts(card: PhysicalPoolCard<PrintedFixture>): LimitedCardFacts {
  return {
    name: card.payload.name,
    colors: card.payload.colors,
    manaValue: card.payload.ordinal % 7,
    type: card.payload.type,
    score: card.payload.score,
  };
}

function suggested(pool: readonly PhysicalPoolCard<PrintedFixture>[] = POOL): LimitedDeck<PrintedFixture> {
  return suggestLimitedDeck(prepareLimitedDeck(pool, facts));
}

describe('physical Limited deck suggestion', () => {
  it('deterministically makes a legal 40-card deck from a 45-card singleton pool', () => {
    const first = suggested();
    const second = suggested();

    expect(first.selectedPhysicalIds).toEqual(POOL.slice(0, 23).map((card) => card.physicalId));
    expect(first.basics).toEqual({ Plains: 0, Island: 9, Swamp: 0, Mountain: 8, Forest: 0 });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    const report = validateLimitedDeck(first);
    expect(report).toMatchObject({
      legal: true,
      cards: 40,
      draftedCards: 23,
      basicLands: 17,
      creatures: 8,
      noncreatureSpells: 15,
      nonbasicLands: 0,
    });
  });

  it('uses score, then pool order, without replacing physical identity by name', () => {
    const tied = POOL.map((card) => ({
      ...card,
      payload: {
        ...card.payload,
        score: 1,
        name: card.payload.ordinal < 2 ? 'Shared Name' : card.payload.name,
      },
    }));
    const build = suggested(tied);

    expect(build.selectedPhysicalIds.slice(0, 3)).toEqual(['pick-00', 'pick-01', 'pick-02']);
    expect(new Set(build.selectedPhysicalIds).size).toBe(23);
    expect(toDeckRef(build, 'Tied deck').cards.slice(0, 2)).toEqual([
      { name: 'Shared Name', count: 2 },
      { name: 'Card 2', count: 1 },
    ]);
  });

  it('does not mutate the pool or a prior build while suggesting', () => {
    const pool = POOL.map((card) => ({ ...card, payload: { ...card.payload } }));
    const before = JSON.stringify(pool);
    const empty = prepareLimitedDeck(pool, facts);
    const built = suggestLimitedDeck(empty);

    expect(JSON.stringify(pool)).toBe(before);
    expect(empty.selectedPhysicalIds).toEqual([]);
    expect(Object.values(empty.basics).every((count) => count === 0)).toBe(true);
    expect(built).not.toBe(empty);
  });

  it("can produce the opponent deck from a bot seat's physical picks", () => {
    const botSeat = {
      seatId: 'bot/east',
      picks: POOL.map((card, pickNumber) => ({ pickNumber: pickNumber + 1, card })),
    };
    const build = suggestLimitedDeck(
      prepareLimitedDeck(
        botSeat.picks.map((pick) => pick.card),
        facts,
      ),
    );

    expect(toDeckRef(build, `Opponent ${botSeat.seatId}`)).toMatchObject({
      name: 'Opponent bot/east',
      cards: expect.any(Array),
    });
    expect(
      toDeckRef(build, `Opponent ${botSeat.seatId}`).cards.reduce((sum, slot) => sum + slot.count, 0),
    ).toBe(40);
  });
});

describe('physical Limited deck editing', () => {
  it('cuts and adds exact physical copies without changing the prior state', () => {
    const original = suggested();
    const cut = cutPhysicalCard(original, 'pick-00');
    const added = addPhysicalCard(cut, 'pick-30');

    expect(original.selectedPhysicalIds).toContain('pick-00');
    expect(original.selectedPhysicalIds).not.toContain('pick-30');
    expect(cut.selectedPhysicalIds).not.toContain('pick-00');
    expect(added.selectedPhysicalIds).toContain('pick-30');
    expect(added.selectedPhysicalIds).not.toContain('pick-00');
    expect(validateLimitedDeck(added).legal).toBe(true);
  });

  it('resuggests from the same identities and leaves an edited build untouched', () => {
    const edited = addPhysicalCard(cutPhysicalCard(suggested(), 'pick-00'), 'pick-30');
    const again = suggestLimitedDeck(edited);

    expect(edited.selectedPhysicalIds).toContain('pick-30');
    expect(again.selectedPhysicalIds).toEqual(POOL.slice(0, 23).map((card) => card.physicalId));
    expect(again.pool.map((entry) => entry.physicalId)).toEqual(edited.pool.map((entry) => entry.physicalId));
  });

  it('adds, cuts, and sets unlimited canonical basic lands immutably', () => {
    const original = prepareLimitedDeck(POOL, facts);
    const many = setBasicCount(original, 'Forest', 200);
    const added = addBasic(many, 'Forest', 3);
    const cut = cutBasic(added, 'Forest', 2);

    expect(CANONICAL_BASIC_NAMES).toEqual(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']);
    expect(original.basics.Forest).toBe(0);
    expect(many.basics.Forest).toBe(200);
    expect(added.basics.Forest).toBe(203);
    expect(cut.basics.Forest).toBe(201);
  });

  it('refuses an unknown id, a duplicate selection, and cutting an absent copy', () => {
    const empty = prepareLimitedDeck(POOL, facts);
    expect(() => addPhysicalCard(empty, 'missing')).toThrowError(
      expect.objectContaining({ code: 'unknown-physical-id' }),
    );

    const once = addPhysicalCard(empty, 'pick-00');
    expect(() => addPhysicalCard(once, 'pick-00')).toThrowError(
      expect.objectContaining({ code: 'duplicate-selection' }),
    );
    expect(() => cutPhysicalCard(once, 'pick-01')).toThrowError(
      expect.objectContaining({ code: 'physical-card-not-selected' }),
    );
  });

  it('refuses invalid basic counts explicitly', () => {
    const empty = prepareLimitedDeck(POOL, facts);
    for (const count of [-1, 1.5, Number.NaN]) {
      expect(() => setBasicCount(empty, 'Plains', count)).toThrowError(
        expect.objectContaining({ code: 'invalid-basic-count' }),
      );
    }
    expect(() => cutBasic(empty, 'Plains', 1)).toThrowError(
      expect.objectContaining({ code: 'insufficient-basic-count' }),
    );
  });
});

describe('the backend DeckRef boundary', () => {
  it('emits canonical named/count slots only after ownership and size validation', () => {
    const ref = toDeckRef(suggested(), 'Legacy Cube deck');

    expect(ref.name).toBe('Legacy Cube deck');
    expect(ref.cards.reduce((sum, slot) => sum + slot.count, 0)).toBe(40);
    expect(ref.cards.at(-2)).toEqual({ name: 'Island', count: 9 });
    expect(ref.cards.at(-1)).toEqual({ name: 'Mountain', count: 8 });
    expect(ref.cards.every((slot) => Object.keys(slot).sort().join(',') === 'count,name')).toBe(true);
  });

  it('allows a deck above the Limited minimum without trimming it', () => {
    const fortyOne = addPhysicalCard(suggested(), 'pick-23');
    const ref = toDeckRef(fortyOne, 'Forty one');

    expect(validateLimitedDeck(fortyOne)).toMatchObject({ legal: true, cards: 41 });
    expect(ref.cards.reduce((sum, slot) => sum + slot.count, 0)).toBe(41);
    expect(fortyOne.selectedPhysicalIds).toContain('pick-23');
  });

  it('refuses a short deck rather than returning a partial DeckRef', () => {
    const empty = prepareLimitedDeck(POOL, facts);
    expect(validateLimitedDeck(empty)).toMatchObject({ legal: false, cards: 0 });
    expect(() => toDeckRef(empty, 'Too short')).toThrowError(expect.objectContaining({ code: 'short-deck' }));
  });

  it('checks caller-constructed states before crossing the backend seam', () => {
    const legal = suggested();
    const duplicate: LimitedDeck<PrintedFixture> = {
      ...legal,
      selectedPhysicalIds: [...legal.selectedPhysicalIds, legal.selectedPhysicalIds[0] ?? 'pick-00'],
    };
    const outside: LimitedDeck<PrintedFixture> = {
      ...legal,
      selectedPhysicalIds: [...legal.selectedPhysicalIds.slice(0, -1), 'outside'],
    };

    expect(() => toDeckRef(duplicate, 'Duplicate')).toThrowError(
      expect.objectContaining({ code: 'duplicate-selection' }),
    );
    expect(() => toDeckRef(outside, 'Outside')).toThrowError(
      expect.objectContaining({ code: 'unknown-physical-id' }),
    );
  });

  it('fails preparation when any physical id or printed-card fact is unresolved or malformed', () => {
    expect(() =>
      prepareLimitedDeck(POOL, (card) => (card.physicalId === 'pick-10' ? null : facts(card))),
    ).toThrowError(expect.objectContaining({ code: 'unresolved-card-facts', physicalId: 'pick-10' }));
    expect(() =>
      prepareLimitedDeck(POOL, (card) => (card.physicalId === 'pick-10' ? undefined : facts(card))),
    ).toThrowError(expect.objectContaining({ code: 'unresolved-card-facts', physicalId: 'pick-10' }));

    expect(() => prepareLimitedDeck([{ ...POOL[0]!, physicalId: '' }], facts)).toThrowError(
      expect.objectContaining({ code: 'invalid-physical-id' }),
    );
    expect(() => prepareLimitedDeck([POOL[0]!, { ...POOL[1]!, physicalId: 'pick-00' }], facts)).toThrowError(
      expect.objectContaining({ code: 'duplicate-physical-id' }),
    );
    expect(() => prepareLimitedDeck([POOL[0]!], () => ({ ...facts(POOL[0]!), name: ' ' }))).toThrowError(
      expect.objectContaining({ code: 'invalid-card-facts' }),
    );
    expect(() =>
      prepareLimitedDeck([POOL[0]!], () => ({
        ...facts(POOL[0]!),
        type: 'planeswalker' as LimitedCardFacts['type'],
      })),
    ).toThrowError(expect.objectContaining({ code: 'invalid-card-facts' }));
    expect(() =>
      prepareLimitedDeck([POOL[0]!], () => ({
        ...facts(POOL[0]!),
        colors: undefined as unknown as readonly ('W' | 'U' | 'B' | 'R' | 'G')[],
      })),
    ).toThrowError(expect.objectContaining({ code: 'invalid-card-facts' }));
  });

  it('uses an explicit error type with a stable machine-readable code', () => {
    try {
      toDeckRef(prepareLimitedDeck(POOL, facts), 'Too short');
      throw new Error('the short deck unexpectedly crossed the seam');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(LimitedDeckError);
      expect((error as LimitedDeckError).code).toBe('short-deck');
    }
  });
});
