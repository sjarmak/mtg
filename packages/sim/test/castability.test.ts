/**
 * The castability term: can a hand cast one of its own spells, from its own
 * lands, on curve.
 *
 * Unit-tested on exact hands for the reason `mulligan.test.ts` gives about the
 * band — a shuffled hand is the one input a rule about hands must not be at the
 * mercy of. The cases that matter are the ones a land count cannot tell apart:
 * two lands of the wrong color and two lands of the right one are the same
 * number and different hands.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { basicLand } from '@mtg/dsl';
import type { ObjectId, PlayerId } from '@mtg/kernel';
import { scenario } from '@mtg/kernel';
import { greedyConfig, keepsHand, landsWantedFor, readCastability } from '@mtg/sim';
import { creature } from './cards';

const MOUNTAIN = basicLand('Mountain', 'TST', 804);
const ISLAND = basicLand('Island', 'TST', 802);
const SWAMP = basicLand('Swamp', 'TST', 803);

const BLUE_TWO = creature('Tide Adept', 2, 2, [], { generic: 1, U: 1 }, ['U']);
const BLACK_ONE = creature('Crypt Rat', 1, 1, [], { B: 1 }, ['B']);
const GOLD_TWO = creature('Dimir Envoy', 2, 2, [], { U: 1, B: 1 }, ['U', 'B']);
const BLUE_FIVE = creature('Leviathan', 6, 6, [], { generic: 4, U: 1 }, ['U']);

function hand(cards: readonly Card[]): {
  state: ReturnType<typeof scenario>['state'];
  oids: readonly ObjectId[];
} {
  const built = scenario({ hands: [cards, []] });
  return { state: built.state, oids: built.state.players[0 satisfies PlayerId].hand };
}

describe('readCastability', () => {
  it('reads a hand whose lands make the colors its spells want', () => {
    const reading = readCastability([ISLAND, ISLAND, BLUE_TWO, BLACK_ONE], 3);
    expect(reading).toEqual({ lands: 2, castable: true, colorBlocked: false });
  });

  it('calls a hand of Mountains in a blue-black hand color-blocked, not land-short', () => {
    const reading = readCastability([MOUNTAIN, MOUNTAIN, BLUE_TWO, GOLD_TWO], 3);
    expect(reading).toEqual({ lands: 2, castable: false, colorBlocked: true });
  });

  it('separates land screw from color screw: nothing is affordable at one land', () => {
    const reading = readCastability([ISLAND, BLUE_FIVE, BLUE_FIVE], 3);
    expect(reading).toEqual({ lands: 1, castable: false, colorBlocked: false });
  });

  it('needs a distinct source per colored pip, not merely a source per color', () => {
    // {U}{B} against one Island: one land, one pip paid, the other unpayable.
    expect(readCastability([ISLAND, GOLD_TWO], 3).castable).toBe(false);
    expect(readCastability([ISLAND, SWAMP, GOLD_TWO], 3).castable).toBe(true);
  });

  it('is bounded by the turn as well as by the hand: five lands do not cast a five-drop on three', () => {
    const cards = [ISLAND, ISLAND, ISLAND, ISLAND, ISLAND, BLUE_FIVE];
    expect(readCastability(cards, 3).castable).toBe(false);
    expect(readCastability(cards, 5).castable).toBe(true);
  });

  it('says nothing at all about a hand with no spells in it', () => {
    expect(readCastability([ISLAND, ISLAND, ISLAND], 3)).toEqual({
      lands: 3,
      castable: false,
      colorBlocked: false,
    });
  });
});

describe('keepsHand reads colors, not only counts', () => {
  const config = greedyConfig({ mulligan: { castableByTurn: 3 } }).mulligan;
  const bandOnly = greedyConfig({ mulligan: { castableByTurn: 0 } }).mulligan;

  it('sends back two lands of the wrong color, which the band alone keeps', () => {
    const wrong = hand([MOUNTAIN, MOUNTAIN, BLUE_TWO, BLUE_TWO, GOLD_TWO, BLUE_FIVE, BLACK_ONE]);
    expect(keepsHand(wrong.state, wrong.oids, bandOnly)).toBe(true);
    expect(keepsHand(wrong.state, wrong.oids, config)).toBe(false);
  });

  it('keeps the same shape of hand once the lands make the colors', () => {
    const right = hand([ISLAND, SWAMP, BLUE_TWO, BLUE_TWO, GOLD_TWO, BLUE_FIVE, BLACK_ONE]);
    expect(keepsHand(right.state, right.oids, config)).toBe(true);
  });

  it('leaves a hand outside the land band a mulligan whatever it could cast', () => {
    const flooded = hand([ISLAND, ISLAND, ISLAND, ISLAND, ISLAND, ISLAND, BLUE_TWO]);
    expect(keepsHand(flooded.state, flooded.oids, config)).toBe(false);
  });
});

describe('the shipped profile', () => {
  it('asks the hand to cast something by turn 3', () => {
    expect(greedyConfig().mulligan.castableByTurn).toBe(3);
  });

  it('sends back two lands of the wrong color without any override', () => {
    const wrong = hand([MOUNTAIN, MOUNTAIN, BLUE_TWO, BLUE_TWO, GOLD_TWO, BLUE_FIVE, BLACK_ONE]);
    expect(keepsHand(wrong.state, wrong.oids, greedyConfig().mulligan)).toBe(false);
  });
});

describe('the scaled band floor', () => {
  it('is off in the shipped profile: a one-land five-card keep stays legal', () => {
    expect(greedyConfig().mulligan.minimumLandsFloor).toBe(0);
    expect(landsWantedFor(5, 7, greedyConfig().mulligan).min).toBe(1);
  });

  it('raises the scaled minimum when a profile asks for it', () => {
    const floored = greedyConfig({ mulligan: { minimumLandsFloor: 2 } }).mulligan;
    expect(landsWantedFor(5, 7, floored).min).toBe(2);
    expect(landsWantedFor(7, 7, floored).min).toBe(2);
  });

  it('never demands more lands than the keep has cards', () => {
    const floored = greedyConfig({ mulligan: { minimumLandsFloor: 2 } }).mulligan;
    expect(landsWantedFor(1, 7, floored).min).toBe(1);
  });
});
