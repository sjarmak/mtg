/**
 * The pick loop: eight seats, three packs each, and a pool at the end of it.
 *
 * The whole draft is reconstructed here from the public pick record, which is
 * the point of `openedBy`: a pack is a group of picks sharing a round and an
 * opener, so the tests can ask what a pack held, who saw it and in what order,
 * without this file knowing anything about the loop's insides.
 *
 * The set is the same 90-card generated fixture the sealed tests and the
 * balance gate use. A draft is only meaningful against a real rarity
 * distribution, and a hand-made pool would not have one.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { boosterRecipeFor, SLICE_BOOSTER } from '@mtg/deckbuild';
import type { Card } from '@mtg/dsl';
import { EXAMPLE_SET, isValidCard, parseCard } from '@mtg/dsl';
import type { DraftPick, DraftResult } from '@mtg/draft-export';
import {
  buildLayouts,
  buildSheets,
  DEFAULT_LAYOUT_NAME,
  DEFAULT_PACKS_PER_SEAT,
  DEFAULT_SEATS,
  DraftError,
  draftedPool,
  openPack,
  openPackFromLayouts,
  passDirection,
  runDraft,
} from '@mtg/draft-export';
import { createRng } from '../src/rng';

const SET_FIXTURE = fileURLToPath(
  new URL('../../setgen/fixtures/sets/tideglass-reach.set.json', import.meta.url),
);

function loadSet(): readonly Card[] {
  const raw: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
  const { cards } = raw as { cards: unknown[] };
  return cards.map((card) => parseCard(card));
}

const SET = loadSet();
const PACK_SIZE = SLICE_BOOSTER.reduce((total, slot) => total + slot.count, 0);

function rareMythicSet(): readonly Card[] {
  const rare = EXAMPLE_SET.find((card) => card.rarity === 'rare');
  if (rare === undefined) throw new Error('example set has no rare');
  return [
    ...EXAMPLE_SET.filter((card) => card.rarity !== 'rare'),
    ...Array.from({ length: 8 }, (_unused, index): Card => ({
      ...rare,
      id: `weighted-high-${String(index)}`,
      name: `Weighted High ${String(index)}`,
      rarity: index < 6 ? 'rare' : 'mythic',
      set: { ...rare.set, collectorNumber: 100 + index },
    })),
  ];
}

const RARE_MYTHIC_SET = rareMythicSet();

function everyPick(result: DraftResult): readonly DraftPick[] {
  return result.seats.flatMap((seat) => seat.picks);
}

/** One pack, in the order it was picked out: a round and an opener name it. */
function packPicks(result: DraftResult, round: number, openedBy: number): readonly DraftPick[] {
  return everyPick(result)
    .filter((pick) => pick.round === round && pick.openedBy === openedBy)
    .sort((a, b) => a.pickNumber - b.pickNumber);
}

/** The transcript two runs at one seed have to agree on, pick for pick. */
function transcript(result: DraftResult): readonly string[] {
  return everyPick(result)
    .map(
      (pick) =>
        `${String(pick.round)}/${String(pick.pickNumber)}/seat ${String(pick.seat)}/pack ${String(pick.openedBy)}/${pick.card.id}`,
    )
    .sort();
}

describe('the pod', () => {
  const result = runDraft(SET, { seed: 'pod/default' });

  it('seats eight, which is the pod Draftmancer and paper both deal', () => {
    expect(DEFAULT_SEATS).toBe(8);
    expect(result.seats).toHaveLength(DEFAULT_SEATS);
    expect(result.seats.map((seat) => seat.seat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('opens three packs each and takes every card out of them', () => {
    expect(DEFAULT_PACKS_PER_SEAT).toBe(3);
    expect(result.rounds).toBe(3);
    for (const seat of result.seats) {
      expect(seat.picks).toHaveLength(DEFAULT_PACKS_PER_SEAT * PACK_SIZE);
      for (const round of [1, 2, 3]) {
        expect(seat.picks.filter((pick) => pick.round === round)).toHaveLength(PACK_SIZE);
      }
    }
  });

  it('ends every seat with a drafted pool of DSL cards from the set', () => {
    const ids = new Set(SET.map((card) => card.id));
    for (const seat of result.seats) {
      const pool = draftedPool(seat);
      expect(pool).toHaveLength(DEFAULT_PACKS_PER_SEAT * PACK_SIZE);
      for (const card of pool) {
        expect(isValidCard(card)).toBe(true);
        expect(ids.has(card.id)).toBe(true);
      }
    }
  });

  it('honors a seat count and a pack count', () => {
    const small = runDraft(SET, { seed: 'pod/small', seats: 4, packs: 2 });
    expect(small.seats).toHaveLength(4);
    expect(small.rounds).toBe(2);
    for (const seat of small.seats) expect(seat.picks).toHaveLength(2 * PACK_SIZE);
  });
});

describe('what it refuses', () => {
  it('refuses a pod of one, which is a sealed pool and not a draft', () => {
    expect(() => runDraft(SET, { seats: 1 })).toThrow(DraftError);
    expect(() => runDraft(SET, { seats: 1 })).toThrow(/at least 2 seats/);
    expect(() => runDraft(SET, { seats: 2.5 })).toThrow(/at least 2 seats/);
  });

  it('refuses a nonsense pack count', () => {
    expect(() => runDraft(SET, { packs: 0 })).toThrow(/positive integer/);
    expect(() => runDraft(SET, { packs: -1 })).toThrow(/positive integer/);
  });

  it('refuses an empty set', () => {
    expect(() => runDraft([])).toThrow(/empty set/);
  });

  it('refuses a set too thin to fill a pack, naming the slot and both numbers', () => {
    const thin = SET.filter((card) => card.rarity === 'common').slice(0, 5);
    expect(() => runDraft(thin)).toThrow(DraftError);
    expect(() => runDraft(thin)).toThrow(/slot Common needs 9 cards per pack but its sheet holds 5/);
  });

  it('deals the rares of a rare-printing set rather than stranding their sheet', () => {
    // What this asserted before: that the fixture set's rares were picked by
    // nobody, because the default pack had no rare slot. Drafting fine minus
    // the rares is the quietest way to lose a tier, so the default recipe is
    // now the set's own and the rares are dealt.
    const rares = EXAMPLE_SET.filter((card) => card.rarity === 'rare');
    expect(rares.length).toBeGreaterThan(0);
    const drafted = runDraft(EXAMPLE_SET, { seed: 'reachable', packs: 1 });
    const picked = new Set(everyPick(drafted).map((pick) => pick.card.id));
    expect(rares.some((rare) => picked.has(rare.id))).toBe(true);
  });

  it('deals both halves of the default rare-mythic source sheet', () => {
    const drafted = runDraft(RARE_MYTHIC_SET, { seed: 'rare-mythic/reachable', packs: 12 });
    const highRarity = everyPick(drafted).filter(
      (pick) => pick.card.rarity === 'rare' || pick.card.rarity === 'mythic',
    );
    expect(highRarity).toHaveLength(DEFAULT_SEATS * 12);
    expect(highRarity.some((pick) => pick.card.rarity === 'rare')).toBe(true);
    expect(highRarity.some((pick) => pick.card.rarity === 'mythic')).toBe(true);
  });

  it('compiles weighted default layouts from the cards on each source sheet', () => {
    const sheets = buildSheets(RARE_MYTHIC_SET);
    const layouts = buildLayouts(boosterRecipeFor(RARE_MYTHIC_SET), sheets);
    expect(layouts).toEqual({
      Rare: { weight: 12, slots: { Common: 9, Uncommon: 3, Rare: 1 } },
      Mythic: { weight: 2, slots: { Common: 9, Uncommon: 3, Mythic: 1 } },
    });
  });

  it('still drafts a set whose sheet a stated recipe strands, minus that sheet', () => {
    const rares = EXAMPLE_SET.filter((card) => card.rarity === 'rare');
    const drafted = runDraft(EXAMPLE_SET, { seed: 'unreachable', packs: 1, recipe: SLICE_BOOSTER });
    const picked = new Set(everyPick(drafted).map((pick) => pick.card.id));
    for (const rare of rares) expect(picked.has(rare.id)).toBe(false);
  });
});

describe('the packs', () => {
  const result = runDraft(SET, { seed: 'packs/one' });

  it('deals the recipe the export compiles, slot for slot', () => {
    for (const round of [1, 2, 3]) {
      for (let opener = 0; opener < DEFAULT_SEATS; opener += 1) {
        const pack = packPicks(result, round, opener);
        expect(pack).toHaveLength(PACK_SIZE);
        for (const slot of SLICE_BOOSTER) {
          const got = pack.filter((pick) => pick.card.rarity === slot.rarity);
          expect(got).toHaveLength(slot.count);
        }
      }
    }
  });

  it('never puts one card in a pack twice, and counts down as it empties', () => {
    // All 24 packs rather than one: a pack drawn with replacement rather than
    // without still comes up clean about half the time, so one pack is not a
    // test of the draw.
    for (const round of [1, 2, 3]) {
      for (let opener = 0; opener < DEFAULT_SEATS; opener += 1) {
        const pack = packPicks(result, round, opener);
        expect(new Set(pack.map((pick) => pick.card.id)).size).toBe(PACK_SIZE);
      }
    }
    expect(packPicks(result, 1, 0).map((pick) => pick.packSize)).toEqual([
      12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
    ]);
  });

  it('opens a different pack for every seat of a round', () => {
    // Eight seats opening one pack each, not eight copies of one pack. Two
    // twelve-card packs off a 90-card set match by accident about never, so
    // eight distinct card lists per round is the assertion that a seat's pack
    // is its own.
    for (const round of [1, 2, 3]) {
      const contents = Array.from({ length: DEFAULT_SEATS }, (_unused, opener) =>
        packPicks(result, round, opener)
          .map((pick) => pick.card.id)
          .sort()
          .join(','),
      );
      expect(new Set(contents).size).toBe(DEFAULT_SEATS);
    }
  });

  it('opens a fresh pack in every round, not the same pack three times', () => {
    // The other axis of the claim above, and the one a naming slip erases: drop
    // the round from the stream a pack is opened on and every seat reopens its
    // round-1 pack twice more, which is one pack drafted three times wearing a
    // three-pack draft's shape. Nine of forty-odd commons repeat by accident
    // about never, so three distinct card lists per opener is the assertion.
    for (let opener = 0; opener < DEFAULT_SEATS; opener += 1) {
      const rounds = [1, 2, 3].map((round) =>
        packPicks(result, round, opener)
          .map((pick) => pick.card.id)
          .sort()
          .join(','),
      );
      expect(new Set(rounds).size).toBe(3);
    }
  });

  it('repeats cards across packs, which is what opening 24 of them means', () => {
    const ids = everyPick(result).map((pick) => pick.card.id);
    expect(new Set(ids).size).toBeLessThan(ids.length);
  });
});

describe('opening one pack from the collation', () => {
  const sheets = buildSheets(SET);
  const layouts = buildLayouts(SLICE_BOOSTER);
  const layout = layouts[DEFAULT_LAYOUT_NAME];
  if (layout === undefined) throw new Error('the slice recipe compiled to no layout');

  it('fills every slot from its own sheet, without repeating a card', () => {
    for (let index = 0; index < 20; index += 1) {
      const [pack] = openPack(sheets, layout, createRng(`pack/${String(index)}`));
      expect(pack).toHaveLength(PACK_SIZE);
      expect(new Set(pack.map((card) => card.id)).size).toBe(PACK_SIZE);
      for (const slot of SLICE_BOOSTER) {
        expect(pack.filter((card) => card.rarity === slot.rarity)).toHaveLength(slot.count);
      }
    }
  });

  it('is a function of the stream it is given', () => {
    const ids = (seed: string): readonly string[] =>
      openPack(sheets, layout, createRng(seed))[0].map((card) => card.id);
    expect(ids('same')).toEqual(ids('same'));
    expect(ids('other')).not.toEqual(ids('same'));
  });

  it('does not advance the stream to choose the only fixed layout', () => {
    const direct = openPack(sheets, layout, createRng('one-layout'));
    const collated = openPackFromLayouts(sheets, layouts, createRng('one-layout'));
    expect(collated).toEqual(direct);
  });

  it('refuses a slot its sheet cannot fill, with both numbers', () => {
    const thin = buildSheets(SET.filter((card) => card.rarity === 'common').slice(0, 4));
    expect(() => openPack(thin, layout, createRng('thin'))).toThrow(DraftError);
    expect(() => openPack(thin, layout, createRng('thin'))).toThrow(
      /slot Common needs 9 cards per pack but its sheet holds 4/,
    );
  });

  it('refuses a layout naming a sheet the set does not print', () => {
    const commonsOnly = buildSheets(SET.filter((card) => card.rarity === 'common'));
    expect(() => openPack(commonsOnly, layout, createRng('missing'))).toThrow(
      /draws from sheet Uncommon, which the set does not print/,
    );
  });
});

describe('passing', () => {
  const result = runDraft(SET, { seed: 'passing/one' });

  it('passes to the next seat in the first round and turns around after it', () => {
    expect(result.directions).toEqual([1, -1, 1]);
    expect(passDirection(1)).toBe(1);
    expect(passDirection(2)).toBe(-1);
  });

  it('sends each pack around the table in that direction, seat by seat', () => {
    // The directions are written out rather than asked of `passDirection`: a
    // test that derives its expectation from the function it is checking agrees
    // with every version of that function, including a broken one.
    for (const [roundIndex, direction] of [1, -1, 1].entries()) {
      const round = roundIndex + 1;
      for (let opener = 0; opener < DEFAULT_SEATS; opener += 1) {
        const seats = packPicks(result, round, opener).map((pick) => pick.seat);
        const expected = Array.from(
          { length: PACK_SIZE },
          (_unused, step) => (opener + step * direction + DEFAULT_SEATS * PACK_SIZE) % DEFAULT_SEATS,
        );
        expect(seats).toEqual(expected);
      }
    }
  });

  it('gives every seat the same number of picks from every pack it sees', () => {
    // Twelve cards around eight seats: four seats see a pack twice.
    const seen = packPicks(result, 1, 3).map((pick) => pick.seat);
    expect(seen.slice(0, DEFAULT_SEATS)).toEqual([3, 4, 5, 6, 7, 0, 1, 2]);
    expect(seen.slice(DEFAULT_SEATS)).toEqual([3, 4, 5, 6]);
  });
});

describe('the seed', () => {
  it('produces identical pick sequences on two runs', () => {
    const first = runDraft(SET, { seed: 'repeatable' });
    const second = runDraft(SET, { seed: 'repeatable' });
    expect(transcript(second)).toEqual(transcript(first));
  });

  it('drafts differently under a different seed', () => {
    const first = runDraft(SET, { seed: 'seed/one' });
    const second = runDraft(SET, { seed: 'seed/two' });
    expect(transcript(second)).not.toEqual(transcript(first));
  });

  it('names every pack after its position, so a shorter pod opens the same packs', () => {
    // Reproducibility here is structural rather than incidental: every draw
    // comes from a stream named after where it happens — pack 1 of seat 0 —
    // rather than from one stream the loop consumes in order. Nothing about
    // the loop's evaluation order can move a pick, and a four-seat pod deals
    // seat 0 the pack an eight-seat pod deals it.
    const eight = runDraft(SET, { seed: 'named/streams' });
    const four = runDraft(SET, { seed: 'named/streams', seats: 4 });
    const packOf = (result: DraftResult): readonly string[] =>
      packPicks(result, 1, 0).map((pick) => pick.card.id);
    expect(new Set(packOf(four))).toEqual(new Set(packOf(eight)));
  });
});

describe('the bot inside the loop', () => {
  const result = runDraft(SET, { seed: 'bots/one' });
  const ratingOf = new Map(result.ratings.map((rated) => [rated.card.id, rated.rating]));

  it('rates every card the packs are dealt from', () => {
    expect(result.ratings).toHaveLength(SET.length);
    for (const pick of everyPick(result)) expect(ratingOf.get(pick.card.id)).toBeDefined();
  });

  it('takes the best-rated card out of a fresh pack, where nothing is on color yet', () => {
    // First pick of the first pack: every pile is empty, so `SimpleBot` is pure
    // argmax on the rating we emit. Later picks are not this test's business —
    // by then affinity is doing the work, which `simple-bot.test.ts` pins.
    for (let opener = 0; opener < DEFAULT_SEATS; opener += 1) {
      const pack = packPicks(result, 1, opener);
      const ratings = pack.map((pick) => ratingOf.get(pick.card.id) ?? Number.NaN);
      const [first] = pack;
      expect(first).toBeDefined();
      expect(ratingOf.get(first?.card.id ?? '')).toBe(Math.max(...ratings));
    }
  });
});
