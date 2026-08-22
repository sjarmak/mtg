/**
 * `buildFromSpells`: the deck a person's own picks make.
 *
 * The contract that matters is *non-interference*. A sealed builder that
 * quietly cuts the 24th spell, or pads a 20-spell selection with two cards the
 * player passed on, is a builder they cannot trust with any of the other picks.
 * So the tests below are mostly about what the function refuses to do.
 *
 * That contract now covers the mana base, which is what `mtg-gnw` moved. The
 * builder used to rank the ten color pairs and build for the winning two, so a
 * three-color selection came back with a two-color base and no word about the
 * color that had been dropped. The three-color block below is the acceptance for
 * the reversal: every demanded color gets sources, the one that cannot be
 * floored is named, and the deck is still a deck.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput, Color } from '@mtg/dsl';
import { isLand, parseCard } from '@mtg/dsl';
import { buildDeck, buildFromSpells, hasShortfall } from '@mtg/deckbuild';
import { makeMixedPool } from './helpers/pool';

const SEEDS = Array.from({ length: 25 }, (_unused, index) => index + 1);

function ids(cards: readonly Card[]): string[] {
  return cards.map((card) => card.id);
}

/** One creature costing `pips` of `color` inside a total of `manaValue`. */
function costCard(index: number, color: Color, pips: number, manaValue: number): Card {
  const cost: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  cost[color] = pips;
  return parseCard({
    kind: 'creature',
    id: `manual-${String(index)}`,
    name: `Manual ${String(index)}`,
    rarity: 'common',
    set: { code: 'MAN', collectorNumber: index + 1 },
    manaCost: { generic: manaValue - pips, ...cost },
    colors: [color],
    power: Math.max(1, manaValue - 1),
    toughness: Math.max(1, manaValue - 1),
  } satisfies CardInput);
}

function cardsOf(color: Color, count: number, manaValue: number, from: number): readonly Card[] {
  return Array.from({ length: count }, (_unused, index) => costCard(from + index, color, 1, manaValue));
}

/** Nine white two-drops, nine red two-drops and five green three-drops. */
const THREE_COLOR_SPELLS: readonly Card[] = [
  ...cardsOf('W', 9, 2, 0),
  ...cardsOf('R', 9, 2, 100),
  ...cardsOf('G', 5, 3, 200),
];

describe('a deck built around an exact spell list', () => {
  it.each(SEEDS)('seed %i: plays every chosen spell and nothing else', (seed) => {
    const pool = makeMixedPool(seed);
    const chosen = buildDeck(pool).spells;
    const built = buildFromSpells(chosen, pool);

    expect(ids(built.spells)).toEqual(ids(chosen));
    expect(ids(built.deck.slice(0, chosen.length))).toEqual(ids(chosen));
    expect(built.lands.every(isLand)).toBe(true);
    expect(built.spells.some(isLand)).toBe(false);
  });

  it.each(SEEDS)('seed %i: reproduces what the automatic builder built', (seed) => {
    // Picking by hand exactly what the machine would pick has to give the
    // machine's deck back. If it does not, the two builders disagree about the
    // mana base, and a player who takes the suggestion unedited gets a
    // different deck from the one they were shown.
    const pool = makeMixedPool(seed);
    const automatic = buildDeck(pool);
    const manual = buildFromSpells(automatic.spells, pool);

    // The automatic builder names a pair; this one names the colors the picks
    // out of that pair actually cost, which is the same set or a subset of it.
    for (const color of manual.colors) expect(automatic.colorPair).toContain(color);
    expect(ids(manual.lands)).toEqual(ids(automatic.lands));
    expect(ids(manual.deck)).toEqual(ids(automatic.deck));
  });

  it('is deterministic', () => {
    const pool = makeMixedPool(7);
    const chosen = buildDeck(pool).spells;
    expect(ids(buildFromSpells(chosen, pool).deck)).toEqual(ids(buildFromSpells(chosen, pool).deck));
  });
});

describe('a selection that is not the right size', () => {
  it('reports the gap when there are too few spells, and does not pad', () => {
    const pool = makeMixedPool(3);
    const chosen = buildDeck(pool).spells.slice(0, 20);
    const built = buildFromSpells(chosen, pool);

    expect(built.spellCount).toBe(20);
    expect(built.spellTarget).toBe(23);
    expect(built.spells).toHaveLength(20);
    expect(built.complete).toBe(false);
    expect(hasShortfall(built.shortfalls, 'spellSlots')).toBe(true);
    expect(built.shortfalls).toContainEqual({
      kind: 'spellSlots',
      target: 23,
      achieved: 20,
      missing: 3,
    });
    // The land count is not negotiable, so an undersized deck is undersized.
    expect(built.lands).toHaveLength(built.config.landCount);
    expect(built.deck).toHaveLength(37);
  });

  it('keeps every spell when there are too many, and calls the deck incomplete', () => {
    const pool = makeMixedPool(4);
    const automatic = buildDeck(pool);
    const chosen = [...automatic.spells, ...automatic.sideboard.slice(0, 2).map((pick) => pick.card)];
    const built = buildFromSpells(chosen, pool);

    expect(built.spellCount).toBe(25);
    expect(built.spells).toHaveLength(25);
    expect(built.complete).toBe(false);
    // Over-size is not something *missing*, so it is not a shortfall.
    expect(hasShortfall(built.shortfalls, 'spellSlots')).toBe(false);
    expect(built.deck).toHaveLength(42);
  });

  it('reports the whole deck as missing rather than throwing on an empty selection', () => {
    const built = buildFromSpells([], makeMixedPool(5));

    expect(built.spellCount).toBe(0);
    expect(built.complete).toBe(false);
    expect(built.shortfalls).toContainEqual({
      kind: 'spellSlots',
      target: 23,
      achieved: 0,
      missing: 23,
    });
    expect(built.lands).toHaveLength(built.config.landCount);
  });
});

describe('the mana base follows the picks', () => {
  it('weights basics towards the colors actually chosen', () => {
    const pool = makeMixedPool(11);
    const automatic = buildDeck(pool);
    const built = buildFromSpells(automatic.spells, pool);
    const printed = new Set(built.lands.map((land) => land.name));

    expect(built.colors.length).toBeGreaterThan(0);
    // Every basic printed belongs to a color the picks demand; nothing off-color.
    for (const report of built.manaBase.reports) {
      if (report.sources > 0) expect(built.colors).toContain(report.color);
    }
    expect(printed.size).toBeGreaterThan(0);
  });

  it('re-weights when the selection changes color', () => {
    // Cutting every card of one color must move the basics, not leave the
    // player with a mana base built for cards they no longer play.
    const pool = makeMixedPool(13);
    const automatic = buildDeck(pool);
    const [first] = automatic.colorPair;
    const oneColor = automatic.spells.filter((card) => !card.colors.includes(first));
    // Asserted rather than skipped: a fixture change that made this vacuous
    // should fail the test, not quietly pass it.
    expect(oneColor.length).toBeGreaterThan(0);
    expect(oneColor.length).toBeLessThan(automatic.spells.length);

    const built = buildFromSpells(oneColor, pool);
    const before = automatic.manaBase.reports.find((report) => report.color === first)?.sources ?? 0;
    const after = built.manaBase.reports.find((report) => report.color === first)?.sources ?? 0;
    expect(after).toBeLessThan(before);
  });
});

describe('a deck of three colors', () => {
  it('is expressible: every demanded color gets sources', () => {
    const built = buildFromSpells(THREE_COLOR_SPELLS, THREE_COLOR_SPELLS);

    expect(built.colors).toEqual(['W', 'R', 'G']);
    for (const color of built.colors) expect(built.manaBase.landsByColor[color]).toBeGreaterThan(0);
    expect(built.lands).toHaveLength(built.config.landCount);
    expect(built.deck).toHaveLength(40);
  });

  it('reports the color it cannot floor rather than dropping the color', () => {
    // Three colors cannot all reach six sources out of seventeen lands, so one
    // of them ends short. The old builder answered that by re-pairing to two
    // colors, which made the shortfall unreportable because the color was gone.
    const built = buildFromSpells(THREE_COLOR_SPELLS, THREE_COLOR_SPELLS);
    const shortfall = built.shortfalls.find((entry) => entry.kind === 'colorSources' && entry.color === 'G');

    expect(shortfall).toBeDefined();
    expect(hasShortfall(built.shortfalls, 'spellSlots')).toBe(false);
  });

  it('is still a deck: a splash nobody can floor does not make it illegal', () => {
    // `complete` is legality — forty cards — and a thin third color is a known
    // weakness rather than an illegal deck. It is reported and it still plays.
    const built = buildFromSpells(THREE_COLOR_SPELLS, THREE_COLOR_SPELLS);
    expect(built.shortfalls.length).toBeGreaterThan(0);
    expect(built.complete).toBe(true);
  });
});

describe('a mana base the builder counted out', () => {
  it('prints exactly what was asked for, splash and all', () => {
    const built = buildFromSpells(THREE_COLOR_SPELLS, THREE_COLOR_SPELLS, {}, { W: 8, R: 7, G: 2 });

    expect(built.manaBase.landsByColor).toEqual({ W: 8, U: 0, B: 0, R: 7, G: 2 });
    expect(built.lands).toHaveLength(17);
    expect(built.deck).toHaveLength(40);
    expect(built.complete).toBe(true);
  });

  it('overrides the computed base rather than being averaged with it', () => {
    const computed = buildFromSpells(THREE_COLOR_SPELLS, THREE_COLOR_SPELLS);
    const chosen = buildFromSpells(THREE_COLOR_SPELLS, THREE_COLOR_SPELLS, {}, { W: 17 });

    expect(chosen.manaBase.landsByColor.W).toBe(17);
    expect(chosen.manaBase.landsByColor.R).toBe(0);
    expect(computed.manaBase.landsByColor.R).toBeGreaterThan(0);
  });

  it('says which colors the base leaves short, and changes none of them', () => {
    const built = buildFromSpells(THREE_COLOR_SPELLS, THREE_COLOR_SPELLS, {}, { W: 17 });
    const short = built.shortfalls.filter((entry) => entry.kind === 'colorSources');

    expect(short.map((entry) => (entry.kind === 'colorSources' ? entry.color : null))).toEqual(['R', 'G']);
    expect(built.manaBase.landsByColor.W).toBe(17);
  });

  it('keeps the computed base available: dropping the choice restores it', () => {
    const computed = buildFromSpells(THREE_COLOR_SPELLS, THREE_COLOR_SPELLS);
    const chosen = buildFromSpells(THREE_COLOR_SPELLS, THREE_COLOR_SPELLS, {}, { W: 17 });
    const back = buildFromSpells(THREE_COLOR_SPELLS, THREE_COLOR_SPELLS);

    expect(back.manaBase.landsByColor).toEqual(computed.manaBase.landsByColor);
    expect(back.manaBase.landsByColor).not.toEqual(chosen.manaBase.landsByColor);
  });

  it('moves the spell target with the land count, because the deck size is what is fixed', () => {
    const built = buildFromSpells(THREE_COLOR_SPELLS, THREE_COLOR_SPELLS, {}, { W: 8, R: 8, G: 2 });

    expect(built.lands).toHaveLength(18);
    expect(built.spellTarget).toBe(22);
    expect(built.spellCount).toBe(23);
    expect(built.deck).toHaveLength(41);
    expect(built.complete).toBe(false);
  });

  it('reports the gap when the base is thin, without printing a land nobody asked for', () => {
    const built = buildFromSpells(THREE_COLOR_SPELLS, THREE_COLOR_SPELLS, {}, { W: 6, R: 6, G: 3 });

    expect(built.lands).toHaveLength(15);
    expect(built.shortfalls).toContainEqual({
      kind: 'spellSlots',
      target: 25,
      achieved: 23,
      missing: 2,
    });
    expect(built.complete).toBe(false);
  });

  it('refuses a count that is not a whole number of lands', () => {
    expect(() => buildFromSpells(THREE_COLOR_SPELLS, THREE_COLOR_SPELLS, {}, { W: -1 })).toThrow(
      /non-negative integer/,
    );
    expect(() => buildFromSpells(THREE_COLOR_SPELLS, THREE_COLOR_SPELLS, {}, { W: 2.5 })).toThrow(
      /non-negative integer/,
    );
  });
});

describe('configuration', () => {
  it('takes the spell target from the configured deck and land counts', () => {
    const pool = makeMixedPool(9);
    const chosen = buildDeck(pool).spells;
    // A Constructed-shaped deck: 36 spells, 24 lands. The curve has to be
    // restated to match, because `resolveConfig` refuses a target curve that
    // does not sum to the spell count.
    const built = buildFromSpells(chosen, pool, {
      deckSize: 60,
      landCount: 24,
      targetCurve: { 0: 0, 1: 4, 2: 9, 3: 8, 4: 7, 5: 5, 6: 3 },
    });

    expect(built.spellTarget).toBe(36);
    expect(built.lands).toHaveLength(24);
    expect(built.deck).toHaveLength(chosen.length + 24);
    expect(built.complete).toBe(false);
    expect(hasShortfall(built.shortfalls, 'spellSlots')).toBe(true);
  });

  it('honors a land count without touching the picks', () => {
    const pool = makeMixedPool(9);
    const chosen = buildDeck(pool).spells;
    const built = buildFromSpells(chosen, pool, { deckSize: 41, landCount: 18 });

    expect(built.spellTarget).toBe(23);
    expect(ids(built.spells)).toEqual(ids(chosen));
    expect(built.lands).toHaveLength(18);
    expect(built.deck).toHaveLength(41);
  });
});
