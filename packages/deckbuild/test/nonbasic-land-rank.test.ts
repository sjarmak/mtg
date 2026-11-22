/**
 * Which nonbasic lands a deck plays, when the pool offers more than it can
 * fit (`mtg-h6ut`).
 *
 * The builder used to take `pool.filter(...).slice(0, landCount)`, so the
 * answer was whichever the set happened to list first: a Guildgate that enters
 * tapped outranked an untapped dual for no reason but collector number, and the
 * pip demand `measureDemand` computes two lines above was never consulted for
 * the nonbasic half at all.
 *
 * These pools are cube-shaped rather than sealed-shaped on purpose. Every
 * sealed pool this repo opens holds at most one nonbasic land that produces
 * both of a deck's colors and nothing else, so the cap does not bind and no
 * order is observable; a pool that holds more than seventeen of them is where
 * the order becomes the decision, and it is the pool a cube deals.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import {
  buildManaBase,
  DEFAULT_DECK_BUILD_CONFIG,
  DEFAULT_SCORE_WEIGHTS,
  evaluatePool,
} from '@mtg/deckbuild';
import { makeSyntheticPool } from './helpers/pool';

let serial = 300;

function land(name: string, over: Partial<CardInput> = {}): Card {
  serial += 1;
  return parseCard({
    kind: 'land',
    id: `rank-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    rarity: 'uncommon',
    set: { code: 'RNK', collectorNumber: serial },
    producesMana: ['W', 'U'],
    ...over,
  } as CardInput);
}

const UNTAPPED = (index: number): Card => land(`Open Field ${index}`);
const TAPPED = (index: number): Card =>
  land(`Barred Gate ${index}`, { entryReplacement: { kind: 'entersTapped' } });

/** The spells the mana base is built for: a two-color deck paying W and U. */
function spells(): readonly Card[] {
  return makeSyntheticPool(23, { palette: ['W', 'U'], setCode: 'RNK' });
}

function baseFor(lands: readonly Card[]): readonly Card[] {
  const cards = [...lands, ...spells()];
  const evaluated = evaluatePool(cards, DEFAULT_SCORE_WEIGHTS).filter((entry) => entry.card.kind !== 'land');
  return buildManaBase(evaluated, ['W', 'U'], cards, DEFAULT_DECK_BUILD_CONFIG).lands;
}

const LAND_COUNT = DEFAULT_DECK_BUILD_CONFIG.landCount;

describe('which nonbasic lands the deck takes when the pool offers too many', () => {
  it('drops the tapped ones first when every candidate serves the same demand', () => {
    // Twenty duals for the deck's exact colors, seventeen slots. The tapped ones
    // are listed first, which is what the old slice read as "best".
    const tapped = Array.from({ length: 10 }, (_, index) => TAPPED(index));
    const untapped = Array.from({ length: 10 }, (_, index) => UNTAPPED(index));
    const lands = baseFor([...tapped, ...untapped]);

    expect(lands).toHaveLength(LAND_COUNT);
    const kept = new Set(lands.map((card) => card.id));
    for (const card of untapped) expect(kept.has(card.id)).toBe(true);
    const keptTapped = tapped.filter((card) => kept.has(card.id));
    expect(keptTapped).toHaveLength(LAND_COUNT - untapped.length);
  });

  it('takes a tapped dual over an untapped land that pays for only one of the colors', () => {
    // Fixing is why a nonbasic land is in the deck, so demand ranks above what
    // the land costs to play. A gate for both colors beats a Tower that taps
    // for one of them even though the gate arrives tapped and the Tower does not.
    const gates = Array.from({ length: 18 }, (_, index) => TAPPED(index));
    const towers = Array.from({ length: 6 }, (_, index) =>
      land(`Lone Tower ${index}`, { producesMana: ['W'] }),
    );
    const lands = baseFor([...towers, ...gates]);

    const kept = new Set(lands.map((card) => card.id));
    for (const tower of towers) expect(kept.has(tower.id)).toBe(false);
    expect(gates.filter((card) => kept.has(card.id))).toHaveLength(LAND_COUNT);
  });

  it('charges a conditional tapper as an unconditional one when the deck cannot turn it off', () => {
    // "Enters tapped unless you control a Swamp or a Mountain" in a WU deck is a
    // land that always enters tapped, printed differently. One that names a
    // Plains is a land this deck untaps, so it ranks with the untapped ones.
    const reachable = Array.from({ length: 10 }, (_, index) =>
      land(`Sunlit Shore ${index}`, {
        entryReplacement: { kind: 'entersTappedUnlessControlsLandSubtype', landTypes: ['Plains'] },
      }),
    );
    const unreachable = Array.from({ length: 10 }, (_, index) =>
      land(`Ashen Shore ${index}`, {
        entryReplacement: { kind: 'entersTappedUnlessControlsLandSubtype', landTypes: ['Swamp'] },
      }),
    );
    const lands = baseFor([...unreachable, ...reachable]);

    const kept = new Set(lands.map((card) => card.id));
    for (const card of reachable) expect(kept.has(card.id)).toBe(true);
    expect(unreachable.filter((card) => kept.has(card.id))).toHaveLength(LAND_COUNT - reachable.length);
  });

  it('leaves the whole pool in when it holds fewer nonbasics than the deck plays lands', () => {
    // The sealed case, unchanged: a cap that does not bind takes everything, and
    // the rest of the base is basics apportioned by demand.
    const duals = [TAPPED(0), UNTAPPED(0)];
    const lands = baseFor(duals);

    expect(lands).toHaveLength(LAND_COUNT);
    const kept = new Set(lands.map((card) => card.id));
    for (const card of duals) expect(kept.has(card.id)).toBe(true);
  });
});
