import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { BoosterRecipe } from '../src/index';
import {
  boosterRecipeFor,
  boosterSize,
  buildDeck,
  openSealedPool,
  SealedPoolError,
  SLICE_BOOSTER,
  SLICE_BOOSTER_WITH_RARE,
  SLICE_BOOSTER_WITH_RARE_MYTHIC,
} from '../src/index';
import { makeSyntheticPool } from './helpers/pool';

/**
 * The real generated set rather than a hand-made pool: sealed is only
 * meaningful against a set with a real rarity distribution, and this is the same
 * 90-card fixture the balance gate measures.
 */
const SET_FIXTURE = fileURLToPath(
  new URL('../../setgen/fixtures/sets/tideglass-reach.set.json', import.meta.url),
);

function loadSet(): readonly Card[] {
  const raw: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
  const { cards } = raw as { cards: unknown[] };
  return cards.map((card) => parseCard(card));
}

const SET = loadSet();

describe('the set this opens from', () => {
  it('is the 90-card generated set with two rarities', () => {
    expect(SET.length).toBe(90);
    const rarities = new Set(SET.map((card) => card.rarity));
    expect([...rarities].sort()).toEqual(['common', 'uncommon']);
  });
});

/**
 * A rare-printing pool, built rather than read.
 *
 * `helpers/pool.ts` prints one card in five at rare, which is the DSL's legal
 * space rather than any set's, and that is exactly what is wanted here: this
 * package depends on `@mtg/dsl` alone, and the property under test is a
 * statement about a pool's rarities and nothing else. The committed sets are
 * both two-tier today, so a set that prints rares has to be constructed to
 * exist at all.
 */
const RARE_PRINTING_POOL = makeSyntheticPool(20260814, { size: 120, setCode: 'RAR' });
const RARE_MYTHIC_PRINTING_POOL: readonly Card[] = RARE_PRINTING_POOL.map((card, index) =>
  card.rarity === 'rare' && index % 3 === 0 ? { ...card, rarity: 'mythic' as const } : card,
);

describe('the pack a set is opened with', () => {
  // The bug this replaces: `SLICE_BOOSTER` was the recipe for every set, and it
  // has no rare slot, so a set that printed rares generated them, rendered
  // them, exported them and balance-tested them without ever putting one in a
  // pack. Nothing could catch it — the rarity tiers are `@mtg/design-data`'s
  // and this package cannot import them — so the pack is derived from the pool
  // instead of declared.

  it('is the two-tier pack for a set that prints no rares', () => {
    expect(SET.some((card) => card.rarity === 'rare')).toBe(false);
    expect(boosterRecipeFor(SET)).toEqual(SLICE_BOOSTER);
    expect(SLICE_BOOSTER.map((slot) => slot.rarity)).toEqual(['common', 'uncommon']);
  });

  it('gains a rare slot for a set that prints one', () => {
    expect(RARE_PRINTING_POOL.some((card) => card.rarity === 'rare')).toBe(true);
    expect(boosterRecipeFor(RARE_PRINTING_POOL)).toEqual(SLICE_BOOSTER_WITH_RARE);
    expect(boosterSize(SLICE_BOOSTER_WITH_RARE)).toBe(13);
  });

  it('adds the rare rather than promoting an uncommon out of the pack', () => {
    const twoTier = new Map(SLICE_BOOSTER.map((slot) => [slot.rarity, slot.count]));
    for (const slot of SLICE_BOOSTER_WITH_RARE) {
      if (slot.rarity === 'rare') continue;
      expect(slot.count).toBe(twoTier.get(slot.rarity));
    }
  });

  it('puts exactly one rare in every pack a rare-printing set opens', () => {
    const pool = openSealedPool(RARE_PRINTING_POOL, { seed: 'rare/every-pack' });
    for (const booster of pool.boosters) {
      expect(booster.length).toBe(13);
      expect(booster.filter((card) => card.rarity === 'rare').length).toBe(1);
    }
    expect(pool.cards.filter((card) => card.rarity === 'rare').length).toBe(6);
  });

  it('collates rare and mythic printings through one source-weighted slot', () => {
    expect(boosterRecipeFor(RARE_MYTHIC_PRINTING_POOL)).toEqual(SLICE_BOOSTER_WITH_RARE_MYTHIC);
    expect(SLICE_BOOSTER_WITH_RARE_MYTHIC.at(-1)).toEqual({
      rarity: 'rare',
      count: 1,
      rarityWeights: [
        { rarity: 'rare', weight: 2 },
        { rarity: 'mythic', weight: 1 },
      ],
    });

    const pool = openSealedPool(RARE_MYTHIC_PRINTING_POOL, {
      seed: 'rare-mythic/source-sheet',
      boosters: 256,
    });
    const highRarity = pool.boosters.map((booster) =>
      booster.filter((card) => card.rarity === 'rare' || card.rarity === 'mythic'),
    );
    expect(highRarity.every((cards) => cards.length === 1)).toBe(true);
    expect(highRarity.some(([card]) => card?.rarity === 'rare')).toBe(true);
    expect(highRarity.some(([card]) => card?.rarity === 'mythic')).toBe(true);
  });

  it('does not omit a mythic-only high-rarity tier', () => {
    const mythicOnly = RARE_MYTHIC_PRINTING_POOL.map((card) =>
      card.rarity === 'rare' ? { ...card, rarity: 'mythic' as const } : card,
    );
    const pool = openSealedPool(mythicOnly, { seed: 'mythic-only', boosters: 8 });
    for (const booster of pool.boosters) {
      expect(booster.filter((card) => card.rarity === 'mythic')).toHaveLength(1);
    }
  });

  it('never overrides a recipe the caller stated', () => {
    const commonsOnly: BoosterRecipe = [{ rarity: 'common', count: 4 }];
    const pool = openSealedPool(RARE_PRINTING_POOL, { seed: 'stated', recipe: commonsOnly });
    for (const booster of pool.boosters) {
      expect(booster.length).toBe(4);
      expect(booster.every((card) => card.rarity === 'common')).toBe(true);
    }
  });

  it('still refuses a stated rare slot the set cannot fill', () => {
    const open = (): unknown =>
      openSealedPool(SET, { seed: 'rarity/asked', recipe: SLICE_BOOSTER_WITH_RARE });
    expect(open).toThrow(SealedPoolError);
    expect(open).toThrow(/needs 1 rare cards but the set has 0/);
  });
});

describe('opening a sealed pool', () => {
  it('opens six twelve-card packs by default', () => {
    const pool = openSealedPool(SET, { seed: 'test/a' });
    expect(pool.boosters.length).toBe(6);
    expect(boosterSize(SLICE_BOOSTER)).toBe(12);
    for (const booster of pool.boosters) expect(booster.length).toBe(12);
    expect(pool.cards.length).toBe(72);
  });

  it('fills each slot of the recipe exactly', () => {
    const pool = openSealedPool(SET, { seed: 'test/b' });
    for (const booster of pool.boosters) {
      for (const slot of SLICE_BOOSTER) {
        const got = booster.filter((card) => card.rarity === slot.rarity).length;
        expect(got).toBe(slot.count);
      }
    }
  });

  it('never repeats a card inside one pack', () => {
    const pool = openSealedPool(SET, { seed: 'test/c' });
    for (const booster of pool.boosters) {
      const ids = booster.map((card) => card.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('does repeat across packs, which is what six boosters means', () => {
    const pool = openSealedPool(SET, { seed: 'test/c' });
    const ids = pool.cards.map((card) => card.id);
    expect(new Set(ids).size).toBeLessThan(ids.length);
  });

  it('is deterministic in its seed', () => {
    const first = openSealedPool(SET, { seed: 'repeatable' });
    const second = openSealedPool(SET, { seed: 'repeatable' });
    expect(second.cards.map((card) => card.id)).toEqual(first.cards.map((card) => card.id));
  });

  it('gives a different pool for a different seed', () => {
    const first = openSealedPool(SET, { seed: 'one' });
    const second = openSealedPool(SET, { seed: 'two' });
    expect(second.cards.map((card) => card.id)).not.toEqual(first.cards.map((card) => card.id));
  });

  it('honors a booster count', () => {
    const pool = openSealedPool(SET, { seed: 'test/d', boosters: 3 });
    expect(pool.boosters.length).toBe(3);
    expect(pool.cards.length).toBe(36);
  });
});

describe('refusing to open what it cannot', () => {
  it('says which rarity is short rather than dealing a thin pack', () => {
    const thin = SET.filter((card) => card.rarity === 'common').slice(0, 5);
    expect(() => openSealedPool(thin, { seed: 'x' })).toThrow(SealedPoolError);
    expect(() => openSealedPool(thin, { seed: 'x' })).toThrow(/needs 9 common cards but the set has 5/);
  });

  it('refuses an empty set', () => {
    expect(() => openSealedPool([], { seed: 'x' })).toThrow(/empty set/);
  });

  it('refuses a nonsense booster count', () => {
    expect(() => openSealedPool(SET, { boosters: 0 })).toThrow(/positive integer/);
    expect(() => openSealedPool(SET, { boosters: -1 })).toThrow(/positive integer/);
  });
});

describe('a sealed pool is playable', () => {
  it('builds a legal deck out of what six packs opened', () => {
    const pool = openSealedPool(SET, { seed: 'playable' });
    const built = buildDeck(pool.cards);

    expect(built.deck.length).toBe(built.config.deckSize);
    expect(built.deck.length).toBe(40);
  });

  it('builds a deck from every one of ten different pools', () => {
    // A single lucky seed proving buildability would say nothing. Ten do.
    for (let index = 0; index < 10; index += 1) {
      const pool = openSealedPool(SET, { seed: `sweep/${String(index)}` });
      const built = buildDeck(pool.cards);
      expect(built.deck.length).toBe(built.config.deckSize);
    }
  });
});
