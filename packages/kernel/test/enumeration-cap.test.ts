/**
 * What a bounded enumeration owes its caller, pinned so the cap stays movable.
 *
 * `DEFAULT_ENUMERATION_CAP` is one global constant over every enumeration in
 * the kernel, and the sweep that lowers it is the instrument that says whether
 * an enumeration is behaving. That instrument only reads true if the property
 * under it is stated somewhere permanent, so it is stated here: a cap costs a
 * caller *options*, and it may never cost a caller a *well-formed* option.
 *
 * The concrete failure this was written for (`mtg-4nkq`): `cartesian` used to
 * stop at the slot the cap bit on and hand back the partial tuples it had built
 * so far, so a truncated product returned tuples one entry short. `castOptions`
 * and `activationOptions` read `items` without gating on `complete` — combat
 * and triggers do gate — so a short tuple became a `castSpell` whose `targets`
 * did not cover its effects, and `validateCast` refused the very move the
 * surface had just offered. A player saw a legal move and got an error.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { cartesian, legalActions, playerOf, scenario, validateAction } from '@mtg/kernel';
import { creature, instant, ISLAND } from './cards';

/** Two targeted effects, so a cast of it needs two filled target slots. */
const TWO_SLOTS: Card = instant(
  'Test Two Aims',
  [
    { kind: 'tapPermanent', target: { kind: 'targetCreature' } },
    { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
  ],
  { generic: 1, U: 1 },
);

/** The product of the slot sizes, which is what `complete` is a claim about. */
function product(shape: readonly number[]): number {
  return shape.reduce((size, slot) => size * slot, 1);
}

/** Slot lists of the given sizes, each member labeled by its slot and index. */
function slots(shape: readonly number[]): readonly (readonly string[])[] {
  return shape.map((size, slot) =>
    Array.from({ length: size }, (_unused, index) => `s${String(slot)}m${String(index)}`),
  );
}

describe('cartesian under a cap', () => {
  it('returns tuples of full arity however early the cap bites', () => {
    // Three slots of two, so a cap of 3 stops on the *middle* slot: enough
    // prefixes to fill the list, more slots left to visit. That is the shape
    // that used to come back two entries wide instead of three.
    const shape = [2, 2, 2];
    for (let cap = 1; cap <= product(shape) + 1; cap += 1) {
      const enumerated = cartesian(slots(shape), cap);
      expect(enumerated.items.length).toBeLessThanOrEqual(cap);
      for (const tuple of enumerated.items) {
        expect(tuple).toHaveLength(shape.length);
      }
      expect(enumerated.complete).toBe(enumerated.items.length === product(shape));
    }
  });

  it('keeps every tuple distinct and drops from the end of the list, never from the middle', () => {
    const shape = [3, 2, 2];
    const whole = cartesian(slots(shape), product(shape));
    expect(whole.complete).toBe(true);
    expect(whole.items).toHaveLength(product(shape));

    // A truncated run is a prefix of the whole run only where the cap bites on
    // the last slot; earlier than that the surviving prefixes are the same
    // ones, carried the rest of the way. Both are checked by identity of the
    // tuples rather than by count, because a duplicate would pass a count.
    const cut = cartesian(slots(shape), 5);
    expect(cut.complete).toBe(false);
    const seen = new Set(cut.items.map((tuple) => tuple.join('|')));
    expect(seen.size).toBe(cut.items.length);
    const all = new Set(whole.items.map((tuple) => tuple.join('|')));
    for (const key of seen) expect(all.has(key)).toBe(true);
  });

  it('is unchanged by the cap when the whole product fits', () => {
    const shape = [3, 2, 2];
    const exact = cartesian(slots(shape), product(shape));
    const roomy = cartesian(slots(shape), product(shape) * 4);
    expect(roomy.complete).toBe(true);
    expect(roomy.items).toEqual(exact.items);
  });

  it('answers an empty slot with no tuples and calls that complete', () => {
    const enumerated = cartesian([['a', 'b'], [], ['c']], 8);
    expect(enumerated.items).toEqual([]);
    expect(enumerated.complete).toBe(true);
  });
});

describe('a capped legal-action list', () => {
  it('offers no move the kernel then refuses, on a board wider than the cap', () => {
    // Five creatures, so the first target slot alone has more candidates than
    // the cap below. The cap bites before the second slot is ever visited,
    // which is the position that used to produce a one-target cast of a
    // two-target spell.
    const bears = Array.from({ length: 5 }, (_unused, index) =>
      creature(`Test Cap Bear ${String(index)}`, 2, 2),
    );
    const start = scenario({
      battlefield: [
        { card: ISLAND, controller: 0 },
        { card: ISLAND, controller: 0 },
        ...bears.map((card) => ({ card, controller: 1 as const })),
      ],
      hands: [[TWO_SLOTS], []],
    });
    const spell = playerOf(start.state, 0).hand[0] ?? '';
    expect(spell).not.toBe('');

    const cap = 4;
    const options = legalActions(start.state, cap);
    const casts = options.filter((action) => action.type === 'castSpell');
    expect(casts.length).toBeGreaterThan(0);
    for (const action of options) {
      expect(validateAction(start.state, action)).toBeNull();
    }
  });
});
