/**
 * The creature floor, in the units it was derived in.
 *
 * `ARCHETYPE_NO_BODIES` was an absolute count -- fourteen creature playables --
 * held against a pool the whole table drafts from, and `mtg-a1cs` is the bug
 * that it therefore says nothing at scale. The 368-card build gives each pair
 * 85 to 91 creature playables, so it clears fourteen six times over whatever
 * those cards are, and no set that size can ever fail the gate.
 *
 * The floor now reads what `inDeck` projects: bodies in a 23-spell deck drafted
 * proportionally out of the pair's pool. The number is 11, and the derivation
 * behind it lives beside `DEFAULT_ARCHETYPE_FLOORS`. What is checked here is
 * that the gate is a density rather than a tally, that 11 is where it turns
 * over, and that the two pools whose reading fixed the number still read what
 * the derivation says they read.
 *
 * Contributions are synthesized rather than taken from printed cards, because
 * `playableIn` and `creature` are the only two fields either the gate or this
 * proof depends on. Building them by hand is what lets a pool be stated as a
 * density and a size independently, which is the whole question.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Card, Color } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { spellCount, DEFAULT_DECK_BUILD_CONFIG } from '@mtg/deckbuild';
import { assessPair, DEFAULT_ARCHETYPE_FLOORS, inDeck, planArchetypes } from '@mtg/setgen';
import type { ArchetypePlan, Contribution } from '@mtg/setgen';
import { briefFromFile } from './helpers';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * The plans come from the prototype's brief, and any committed brief would do:
 * `assessPair` reads `pair` and `colors` off a plan, and those are the ten
 * canonical pairs whatever brief named them. The prototype's is used because it
 * is the brief that exports, and a proof about a floor should not be pinned to
 * a private document it does not read.
 */
const plans = planArchetypes(briefFromFile('tideglass-reach.json'));

function planFor(pair: string): ArchetypePlan {
  const plan = plans.find((item) => item.pair === pair);
  if (plan === undefined) throw new Error(`no plan for ${pair}`);
  return plan;
}

/** A body or a spell, castable in the given colors and neutral in every other field. */
function contribution(index: number, colors: readonly Color[], creature: boolean): Contribution {
  return {
    slotId: `C${index}`,
    colors,
    manaValueMin: 3,
    manaValueMax: 3,
    creature,
    removal: false,
    inert: false,
    archetypes: [],
    signpost: false,
    subjects: [],
  };
}

/** A pool of `size` cards castable in `colors`, `creatures` of them bodies. */
function pool(size: number, creatures: number, colors: readonly Color[]): Contribution[] {
  return Array.from({ length: size }, (_, index) => contribution(index, colors, index < creatures));
}

function bodyShortfall(contributions: readonly Contribution[], pair: string) {
  return assessPair(contributions, planFor(pair)).shortfalls.find((item) => item.kind === 'creatures');
}

describe('the creature floor is a density, not a tally', () => {
  it('states the floor in deck units, at the number the derivation reached', () => {
    expect(DEFAULT_ARCHETYPE_FLOORS.creatures).toBe(11);
    expect(DEFAULT_ARCHETYPE_FLOORS.playables).toBe(spellCount(DEFAULT_DECK_BUILD_CONFIG));
  });

  it('fails a pool whose raw creature count is far above the old floor', () => {
    // 40 bodies in 200 playables projects 5 into a 23-spell deck. The count is
    // nearly three times the fourteen this gate used to demand, and the deck it
    // deals is more than half spells. This is the case `mtg-a1cs` names.
    const thin = pool(200, 40, ['W', 'U']);
    expect(inDeck(40, 200, DEFAULT_ARCHETYPE_FLOORS.playables)).toBe(5);
    const shortfall = bodyShortfall(thin, 'WU');
    expect(shortfall?.found).toBe(5);
    expect(shortfall?.wanted).toBe(11);
  });

  it('gives one density one verdict however big the pool holding it is', () => {
    // Same density, an order of magnitude apart in size: the reading a raw count
    // could not keep is exactly the one a projection does.
    const small = bodyShortfall(pool(40, 8, ['W', 'U']), 'WU');
    const large = bodyShortfall(pool(400, 80, ['W', 'U']), 'WU');
    expect(small?.found).toBe(large?.found);
    expect(small?.found).toBe(5);
  });

  it('turns over between the floor and one card under it', () => {
    // 23 playables is a deck exactly, so the projection is the count itself and
    // the boundary can be stated without rounding.
    expect(bodyShortfall(pool(23, 11, ['B', 'R']), 'BR')).toBeUndefined();
    expect(bodyShortfall(pool(23, 10, ['B', 'R']), 'BR')?.found).toBe(10);
  });

  it('reports the projection beside the count, so the gate can be read', () => {
    const report = assessPair(pool(46, 22, ['U', 'G']), planFor('UG'));
    expect(report.creatures).toBe(22);
    expect(report.creaturesInDeck).toBe(11);
  });
});

/**
 * The prototype is the one balance subject whose set file is public, and it is
 * the creature-rich end of the three: 24 to 29 bodies per pair against 39
 * playables. It clears the floor with room, which is the reading the derivation
 * records, and it is here so the gate is held against a real pool and not only
 * against pools this file built to be held against it.
 */
describe('a set the balance sweep judges fair clears the floor', () => {
  const path = join(PACKAGE_ROOT, 'fixtures', 'sets', 'tideglass-reach.set.json');
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const cards: Card[] = (raw as { cards: readonly unknown[] }).cards.map((card) => parseCard(card));
  const contributions = cards
    .filter((card) => card.kind !== 'land')
    .map((card, index) => contribution(index, card.colors, card.kind === 'creature'));

  it('clears it on all ten pairs, with every projection in the range the derivation states', () => {
    const projections = plans.map((plan) => {
      const report = assessPair(contributions, plan);
      expect(
        report.shortfalls.find((item) => item.kind === 'creatures'),
        plan.pair,
      ).toBeUndefined();
      return report.creaturesInDeck;
    });
    expect(Math.min(...projections)).toBe(14);
    expect(Math.max(...projections)).toBe(17);
  });
});
