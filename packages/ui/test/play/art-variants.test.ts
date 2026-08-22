/**
 * Five Swamps, three pictures: which permanent shows which, and why it stays.
 *
 * The manifest can hold several illustrations for a card. The question this file
 * answers is the one that makes the feature usable rather than merely possible:
 * given a table with five copies of one land on it, which picture does each one
 * draw, does it keep drawing that one, and would a replay of the game paint the
 * same board.
 *
 * jsdom is enough for all three, because none of them is about layout — the
 * projection from kernel state to board props is where the choice is made, and
 * `packages/ui/tools/land-variants.ts` is what puts it in a browser to be looked
 * at.
 */
import { describe, expect, it } from 'vitest';
import { parseCards, setBasics } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import { scenario } from '@mtg/kernel';
import type { GameState } from '@mtg/kernel';
import { artResolver, readArtManifest } from '../../src/lab/art-manifest';
import type { ArtResolver } from '../../src/lab/art-manifest';
import { artCopies } from '../../src/routes/play/art-copies';
import { boardPosition } from '../../src/routes/play/position';

const CARDS = parseCards([
  {
    kind: 'creature',
    id: 'xmp-brigand-reaper',
    name: 'Brigand Reaper',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 40 },
    manaCost: { generic: 2, B: 1 },
    colors: ['B'],
    subtypes: ['Goblin'],
    power: 3,
    toughness: 2,
    abilities: [],
  },
]);

function required(card: Card | undefined, what: string): Card {
  if (card === undefined) throw new Error(what);
  return card;
}

const SWAMP = required(
  setBasics(CARDS).find((card) => card.name === 'Swamp'),
  'setBasics did not mint a Swamp',
);
const REAPER = required(CARDS[0], 'the fixture card list is empty');

/** Three Swamp illustrations and one of the creature, the way adoption writes them. */
function manifest(swampVariants: number): ArtResolver {
  const parsed = readArtManifest(
    {
      formatVersion: 2,
      art: {
        [SWAMP.id]: Array.from({ length: swampVariants }, (_unused, index) => ({
          href: `art/swamp-${String(index)}.png`,
          alt: `the Depths, reading ${String(index)}`,
        })),
        [REAPER.id]: [{ href: 'art/reaper.png', alt: 'a reaper on a ridge' }],
      },
    },
    'test',
  );
  if (!parsed.ok) throw new Error(parsed.message);
  return artResolver(parsed.manifest);
}

function table(cards: readonly Card[]): GameState {
  return scenario({
    seed: 'ui/art-variants',
    battlefield: cards.map((card) => ({ card, controller: 0 as const, summoningSick: false })),
  }).state;
}

/** The viewer's own battlefield, as the src of every tile on it. */
function drawn(state: GameState, artFor: ArtResolver, viewer: 0 | 1 = 0): readonly (string | undefined)[] {
  return boardPosition(state, viewer, ['You', 'Bot'], artFor).you.battlefield.permanents.map(
    (permanent) => permanent.art?.src,
  );
}

const FIVE_SWAMPS = Array.from({ length: 5 }, () => SWAMP);

describe('which illustration a permanent draws', () => {
  it('spreads five copies over three illustrations, using all three', () => {
    const shown = drawn(table(FIVE_SWAMPS), manifest(3));
    expect(shown).toEqual([
      'art/swamp-0.png',
      'art/swamp-1.png',
      'art/swamp-2.png',
      'art/swamp-0.png',
      'art/swamp-1.png',
    ]);
    expect(new Set(shown).size).toBe(3);
  });

  /**
   * The regression that matters most to a set with one picture per card, which
   * is every set until this one: the mechanism has to be invisible there.
   */
  it('leaves a card with one illustration drawing that one', () => {
    const shown = drawn(table([REAPER, REAPER, REAPER]), manifest(3));
    expect(shown).toEqual(['art/reaper.png', 'art/reaper.png', 'art/reaper.png']);
  });

  it('still resolves nothing for a card the manifest does not cover', () => {
    const parsed = readArtManifest({ formatVersion: 2, art: {} }, 'test');
    if (!parsed.ok) throw new Error(parsed.message);
    expect(drawn(table(FIVE_SWAMPS), artResolver(parsed.manifest))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

/**
 * Determinism, stated the way the replay viewer needs it: the same game state
 * paints the same board, twice, and from either seat. A choice drawn from
 * `Math.random()` would pass no line of this.
 */
describe('the choice is derived, not drawn', () => {
  it('paints the same board on a second projection of the same state', () => {
    const state = table(FIVE_SWAMPS);
    const artFor = manifest(3);
    expect(drawn(state, artFor)).toEqual(drawn(state, artFor));
  });

  it('paints the same board from a state rebuilt at the same seed', () => {
    expect(drawn(table(FIVE_SWAMPS), manifest(3))).toEqual(drawn(table(FIVE_SWAMPS), manifest(3)));
  });

  it('does not move a picture when the table changes hands', () => {
    const state = scenario({
      seed: 'ui/art-variants',
      battlefield: FIVE_SWAMPS.map((card) => ({ card, controller: 1 as const, summoningSick: false })),
    }).state;
    const artFor = manifest(3);
    // Seat 1's own view puts them under `you`; seat 0 sees the same five under
    // `opponent`. Same objects, same pictures, whoever is looking.
    const mine = drawn(state, artFor, 1);
    const theirs = boardPosition(state, 0, ['You', 'Bot'], artFor).opponent.battlefield.permanents.map(
      (permanent) => permanent.art?.src,
    );
    expect(mine).toEqual(theirs);
    expect(mine).toEqual([
      'art/swamp-0.png',
      'art/swamp-1.png',
      'art/swamp-2.png',
      'art/swamp-0.png',
      'art/swamp-1.png',
    ]);
  });
});

/**
 * Stability, which is the requirement a naive round-robin over the battlefield
 * would fail: a Swamp that changes picture because the Swamp beside it died has
 * changed identity in front of the player.
 */
describe('a permanent keeps its illustration', () => {
  const artFor = manifest(3);

  it('when a copy in front of it leaves the battlefield', () => {
    const state = table(FIVE_SWAMPS);
    const before = drawn(state, artFor);
    const gone = state.battlefield[1];
    if (gone === undefined) throw new Error('the table is too small');
    const after = drawn({ ...state, battlefield: state.battlefield.filter((oid) => oid !== gone) }, artFor);
    expect(after).toEqual([before[0], before[2], before[3], before[4]]);
  });

  it('when it taps', () => {
    const state = table(FIVE_SWAMPS);
    const oid = state.battlefield[2];
    const object = oid === undefined ? undefined : state.objects[oid];
    if (oid === undefined || object === undefined) throw new Error('the table is too small');
    const tapped = { ...state, objects: { ...state.objects, [oid]: { ...object, tapped: true } } };
    expect(drawn(tapped, artFor)).toEqual(drawn(state, artFor));
  });
});

/**
 * The number itself. `artCopies` is what the whole rule rests on, so it is
 * stated directly as well as through the board.
 */
describe('artCopies', () => {
  it('numbers the copies of one card densely from zero, in creation order', () => {
    const state = table([SWAMP, REAPER, SWAMP, SWAMP]);
    const copies = artCopies(state);
    const swamps = state.battlefield.filter((oid) => state.objects[oid]?.card.id === SWAMP.id);
    expect(swamps.map((oid) => copies.get(oid))).toEqual([0, 1, 2]);
    const reaper = state.battlefield.find((oid) => state.objects[oid]?.card.id === REAPER.id);
    expect(reaper === undefined ? null : copies.get(reaper)).toBe(0);
  });

  /**
   * The counter runs past nine, and `o10` sorts before `o9` as a string. A rule
   * that ordered ids lexically would renumber a table the moment it got big
   * enough to matter, which is exactly when somebody is looking at it.
   */
  it('orders by the counter rather than by the id as text', () => {
    const many = Array.from({ length: 12 }, () => SWAMP);
    const state = table(many);
    const copies = artCopies(state);
    expect(state.battlefield.map((oid) => copies.get(oid))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});
