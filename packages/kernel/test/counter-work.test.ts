/**
 * What the counter accounting asks about, counted rather than timed.
 *
 * `mtg-7qdn`. `counterStatDelta`, `counterKeywords` and `hasCounters` are read
 * through `withCounterContribution` on every characteristics read of every
 * battlefield object, which the layers file names as the kernel's hot path. Each
 * of them used to walk `COUNTER_KINDS` -- every kind the DSL declares, fourteen
 * of them today -- and ask the permanent about each in turn, so a creature with
 * nothing on it paid a property miss per declared kind to find that out, and the
 * bill grew every time the vocabulary gained a counter. Measured on the
 * 729-declaration blocker walk (`mtg-60ae`), those three plus `counterCount`
 * were 53% of the run's self time on a board carrying no counters at all.
 *
 * The assertion here is a **work unit and not a stopwatch**, which is the whole
 * point of filing it this way: `mtg-60ae` is the bead about verdicts that are
 * facts about the machine rather than about the tree, and a millisecond floor
 * for this would be one more of them. A counting `Proxy` records which kinds
 * each function asked about, and the claim is that it asks about the counters
 * the permanent carries and no others. That claim holds identically on an idle
 * box and on one at load 40, and it goes red the day somebody reintroduces the
 * table walk -- which a timing test on this machine could not promise.
 */
import { describe, expect, it } from 'vitest';
import type { Keyword } from '@mtg/dsl';
import { COUNTER_KINDS, counterGrantedKeywords, counterStatBonus } from '@mtg/dsl';
import type { Counters } from '@mtg/kernel';
import { NO_COUNTERS, counterCount, counterKeywords, counterStatDelta, hasCounters } from '@mtg/kernel';

/**
 * The answer the table walk gave, kept here as the oracle the faster route has
 * to match. It is the code these functions used to be, over every declared kind
 * rather than over the permanent's own, so a disagreement between the two is a
 * behavior change and not a speedup.
 */
function statDeltaByTable(current: Counters): { readonly power: number; readonly toughness: number } {
  let power = 0;
  let toughness = 0;
  for (const kind of COUNTER_KINDS) {
    const count = counterCount(current, kind);
    if (count === 0) continue;
    const bonus = counterStatBonus(kind);
    power += bonus.power * count;
    toughness += bonus.toughness * count;
  }
  return { power, toughness };
}

function keywordsByTable(current: Counters): readonly Keyword[] {
  const granted: Keyword[] = [];
  for (const kind of COUNTER_KINDS) {
    if (counterCount(current, kind) === 0) continue;
    for (const keyword of counterGrantedKeywords(kind)) {
      if (!granted.includes(keyword)) granted.push(keyword);
    }
  }
  return granted;
}

/** The kinds a function asked about, in the order it asked. */
function asked(current: Counters): { readonly counters: Counters; readonly kinds: readonly string[] } {
  const kinds: string[] = [];
  const counters = new Proxy(current, {
    get(target, property, receiver): unknown {
      if (typeof property === 'string') kinds.push(property);
      return Reflect.get(target, property, receiver);
    },
  }) as Counters;
  return { counters, kinds };
}

describe('counter accounting asks about the counters a permanent carries', () => {
  it('asks a permanent with no counters about nothing it does not carry', () => {
    const own = new Set(Object.keys(NO_COUNTERS));

    for (const read of [counterStatDelta, counterKeywords, hasCounters]) {
      const probe = asked(NO_COUNTERS);
      read(probe.counters);
      expect([...new Set(probe.kinds)].filter((kind) => !own.has(kind))).toEqual([]);
    }
  });

  it('asks a permanent that carries counters about those and no others', () => {
    const carried: Counters = { ...NO_COUNTERS, plusOnePlusOne: 2, horn: 1 };
    const own = new Set(Object.keys(carried));

    // `hasCounters` stops at the first tally it finds, so it is held to the
    // ceiling alone; a sum has to consider every kind on the permanent, so the
    // two that sum are held to the floor as well.
    for (const read of [counterStatDelta, counterKeywords, hasCounters]) {
      const probe = asked(carried);
      read(probe.counters);
      expect([...new Set(probe.kinds)].filter((kind) => !own.has(kind))).toEqual([]);
    }

    for (const read of [counterStatDelta, counterKeywords]) {
      const probe = asked(carried);
      read(probe.counters);
      expect(new Set(probe.kinds)).toEqual(own);
    }
  });

  it('still answers what the table walk answered', () => {
    // The values are the no-regression pin: asking about fewer kinds may not
    // change a single answer. A horn is a part that reaches both layers from
    // one declaration, so it is the case that would break first.
    const horned: Counters = { ...NO_COUNTERS, plusOnePlusOne: 2, minusOneMinusOne: 1, horn: 3 };

    expect(counterStatDelta(NO_COUNTERS)).toEqual({ power: 0, toughness: 0 });
    expect(counterKeywords(NO_COUNTERS)).toEqual([]);
    expect(hasCounters(NO_COUNTERS)).toBe(false);

    expect(counterStatDelta(horned)).toEqual(statDeltaByTable(horned));
    expect(counterKeywords(horned)).toEqual(keywordsByTable(horned));
    expect(hasCounters(horned)).toBe(true);
  });
});
