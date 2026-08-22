import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CardKind, Color } from '@mtg/dsl';
import { createFixtureProvider } from '@mtg/llm';
import type { Allocation, GenerationResult, RequiredCardInput, SetBriefInput } from '@mtg/setgen';
import { allocateSlots, generateSet, parseBrief } from '@mtg/setgen';
import { COLORLESS_MECHANIC, scriptedTransport, TEST_BRIEF } from './helpers';

/**
 * The required list is an input to the derivation, not a constraint applied
 * after it.
 *
 * the set design document, decision 1 is "the list leads: cards are
 * named first; skeleton, archetypes and census derive from them". Reserving the
 * named cards over a finished skeleton is that backwards, and the cost is not
 * theoretical: the flagship's marquee gear is roughly fifteen named colorless
 * artifacts, a 250-card skeleton derives six colorless artifact slots, and the
 * brief was refused for a set the skeleton could have accommodated if it had
 * known.
 *
 * So the pools each named card will occupy have its stated attributes
 * subtracted from them before a single slot is built. What the pass may not do
 * is move a card between pools: per-pool card counts and per-rarity totals are
 * the census, and a brief that asks a pool for more cards than the pool holds is
 * still refused by name.
 */

const FLAGSHIP_SIZE = 250;

function briefFor(requiredCards: readonly RequiredCardInput[]): SetBriefInput {
  return {
    ...TEST_BRIEF,
    targetSize: FLAGSHIP_SIZE,
    mechanics: [...TEST_BRIEF.mechanics, COLORLESS_MECHANIC],
    requiredCards: [...requiredCards],
  };
}

function allocate(requiredCards: readonly RequiredCardInput[]): Allocation {
  return allocateSlots(parseBrief(briefFor(requiredCards)));
}

const baseline = allocate([]);

function supplyIn(allocation: Allocation, pool: Color | null, kind: CardKind): number {
  return allocation.slots.filter((slot) => slot.color === pool && slot.cardKind === kind).length;
}

/** Cards per pool and cards per rarity: the census the pass may not move. */
function census(allocation: Allocation): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const slot of allocation.slots) {
    const pool = `pool:${slot.color ?? 'colorless'}`;
    const rarity = `rarity:${slot.rarity}`;
    counts[pool] = (counts[pool] ?? 0) + 1;
    counts[rarity] = (counts[rarity] ?? 0) + 1;
  }
  return counts;
}

function named(count: number, card: Omit<RequiredCardInput, 'name'>): RequiredCardInput[] {
  return Array.from({ length: count }, (_unused, index) => ({ ...card, name: `Named Card ${index + 1}` }));
}

describe('the skeleton derives with the named colorless gear already subtracted', () => {
  const wanted = supplyIn(baseline, null, 'artifact') + 6;
  const allocation = allocate(named(wanted, { color: 'colorless', cardKind: 'artifact' }));

  it('the skeleton alone allocates fewer artifact slots than the list names', () => {
    expect(supplyIn(baseline, null, 'artifact')).toBeLessThan(wanted);
  });

  it('reserves a colorless artifact slot for every named card', () => {
    const reserved = allocation.slots.filter((slot) => slot.requiredCard !== undefined);
    expect(reserved).toHaveLength(wanted);
    expect(reserved.every((slot) => slot.color === null && slot.cardKind === 'artifact')).toBe(true);
  });

  it('buys them inside the colorless pool, so the census does not move', () => {
    expect(census(allocation)).toStrictEqual(census(baseline));
    expect(allocation.slots).toHaveLength(FLAGSHIP_SIZE);
  });

  it('says in a note what it bought and why', () => {
    expect(
      allocation.notes.some((note) => note.includes('artifact') && note.includes('the brief names')),
    ).toBe(true);
  });
});

describe('a stated kind with no stated pool goes to the pool that can print it', () => {
  it('seats artifacts in the colorless pool, which is the only one that prints them', () => {
    const wanted = supplyIn(baseline, null, 'artifact') + 2;
    const allocation = allocate(named(wanted, { cardKind: 'artifact' }));
    const reserved = allocation.slots.filter((slot) => slot.requiredCard !== undefined);

    expect(reserved).toHaveLength(wanted);
    expect(reserved.every((slot) => slot.color === null && slot.cardKind === 'artifact')).toBe(true);
  });
});

describe('a color asked for more creatures than it derived', () => {
  const wanted = supplyIn(baseline, 'R', 'creature') + 3;
  const allocation = allocate(named(wanted, { color: 'R', cardKind: 'creature' }));

  it('grows the color creature count to hold them', () => {
    expect(supplyIn(allocation, 'R', 'creature')).toBeGreaterThanOrEqual(wanted);
  });

  it('pays for them out of the same color, leaving the census alone', () => {
    expect(census(allocation)).toStrictEqual(census(baseline));
  });

  it('keeps every creature slot inside a curve bucket the plan allocated', () => {
    const creatures = allocation.slots.filter((slot) => slot.color === 'R' && slot.cardKind === 'creature');
    expect(creatures.every((slot) => slot.manaValueMin >= 1 && slot.manaValueMax >= slot.manaValueMin)).toBe(
      true,
    );
  });
});

describe('what the pass will not do', () => {
  it('leaves the skeleton alone when the list states no attributes', () => {
    const bare = named(5, {});
    const withNames = allocate(bare).slots.map(({ requiredCard: _unused, ...rest }) => rest);
    expect(withNames).toStrictEqual(baseline.slots);
  });

  it('refuses a kind the stated pool cannot print, rather than inventing a slot for it', () => {
    expect(() => allocate([{ name: 'Impossible Relic', color: 'W', cardKind: 'artifact' }])).toThrow(
      /"Impossible Relic" \(W artifact\): no slot in the set matches/,
    );
  });

  it('refuses a pool asked for more cards than the pool holds', () => {
    const colorless = baseline.slots.filter((slot) => slot.color === null).length;
    expect(() => allocate(named(colorless + 1, { color: 'colorless' }))).toThrow(
      /the brief requires 1 card\(s\) the skeleton has no slot for/,
    );
  });
});

/** Findings that say the printed set does not match the skeleton it was built from. */
const SKELETON_CODES = [
  'CREATURE_SHARE_BAND',
  'CURVE_MISMATCH',
  'RARITY_DISTRIBUTION',
  'REQUIRED_CARD_MISSING',
  'SLOT_COLOR_MISMATCH',
  'SLOT_KIND_MISMATCH',
  'SLOT_MANA_VALUE_MISS',
  'SLOT_UNFILLED',
];

async function generate(requiredCards: readonly RequiredCardInput[]): Promise<GenerationResult> {
  const brief = parseBrief(briefFor(requiredCards));
  const allocation = allocateSlots(brief);
  const provider = createFixtureProvider({
    dir: mkdtempSync(join(tmpdir(), 'setgen-demand-')),
    record: true,
    delegate: scriptedTransport({ slots: allocation.slots }),
  });
  return generateSet({ provider, brief, critique: false, maxRetryRounds: 0 });
}

describe('the bent skeleton is the skeleton the set is validated against', () => {
  const gear = named(supplyIn(baseline, null, 'artifact') + 4, {
    color: 'colorless',
    cardKind: 'artifact',
  });

  it('prints every named card against a skeleton it still conforms to', async () => {
    const result = await generate(gear);

    // Curve and creature-share are checked against `allocation.profile`, so a
    // pass that bent the plans without handing the bent plans on fails here and
    // nowhere else.
    const offending = result.report.findings
      .filter((item) => SKELETON_CODES.includes(item.code))
      .map((item) => `${item.code}: ${item.message}`);
    expect(offending).toStrictEqual([]);

    const printed = new Set(result.cards.map((card) => card.name));
    expect(gear.filter((card) => !printed.has(card.name))).toStrictEqual([]);
  });

  /**
   * A set of vanilla artifacts is an inert set, and the validators say so:
   * DSL v0 gives an ability-free artifact nothing to do, which is the
   * `ARCHETYPE_INERT_GLUT` a 250-card skeleton already earns from the artifact
   * slots it derives on its own. Buying more of them makes that finding louder,
   * which is true and is the engine's schedule
   * (the set design document, "what the engine owes this set":
   * attachment for the eight named weapons). What the pass may not do is invent
   * a *kind* of complaint the same set without a required list does not already
   * have.
   */
  it('earns no kind of finding the same set without a list does not', async () => {
    const withGear = await generate(gear);
    const without = await generate([]);
    const known = new Set(without.report.findings.map((item) => item.code));

    expect(
      [...new Set(withGear.report.findings.map((item) => item.code))].filter((code) => !known.has(code)),
    ).toStrictEqual([]);
  });
});
