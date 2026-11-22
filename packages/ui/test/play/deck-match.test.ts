/**
 * Two decks somebody built, seated opposite each other.
 *
 * The playtester asked to play the Alaric deck against the Vessari deck, and until this
 * the answer was no: `dealConstructedGame` seats a built list opposite *itself*,
 * and its docblock says why — "Constructed has no pool to open a second deck out
 * of", so facing your own list is the only honest game. That premise stopped
 * being true when the workbench got a shelf. Seven finished, designed decks sit
 * on it, and two of them opposite each other is exactly the case
 * `dealPreconGame` already exists for, with the shelf standing in for the set's
 * written decks.
 *
 * So the mirror stays where it is right — a deck built in the builder with
 * nothing behind it — and this is the second dealer, not a flag on the first.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { dealDeckMatch } from '../../src/routes/play/deal';

function creature(id: string, name: string): Card {
  return parseCard({
    kind: 'creature',
    id,
    name,
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 1 },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
    subtypes: ['Soldier'],
    power: 2,
    toughness: 2,
  } satisfies CardInput);
}

function land(id: string, name: string): Card {
  return parseCard({
    kind: 'land',
    id,
    name,
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 2 },
    producesMana: ['W'],
  } satisfies CardInput);
}

const ALARIC = { name: 'Alaric-v1', cards: [creature('xmp-a', 'Vantan Soldier'), land('xmp-p', 'Plains')] };
const VESSARI = {
  name: 'Vessari-v3',
  cards: [creature('xmp-b', 'Skyborn Fledgling'), land('xmp-p2', 'Forest')],
};

describe('dealing two built decks opposite each other', () => {
  it('seats each deck under its own name', () => {
    const dealt = dealDeckMatch(ALARIC, VESSARI, { seed: 'match-test/v0' });
    const [seatZero, seatOne] = dealt.config.setup.decks;

    // Named for the deck rather than the seat, `dealPreconGame`'s reason: the
    // name is the thing a person picked, and "Bot" over a list called Vessari-v3
    // would hide the only fact about that seat worth knowing.
    expect(seatZero?.name).toBe('Alaric-v1');
    expect(seatOne?.name).toBe('Vessari-v3');
    expect(seatZero?.cards.map((card) => card.id)).toStrictEqual(['xmp-a', 'xmp-p']);
    expect(seatOne?.cards.map((card) => card.id)).toStrictEqual(['xmp-b', 'xmp-p2']);
  });

  it('is a pure function of the seed and the two lists', () => {
    const once = dealDeckMatch(ALARIC, VESSARI, { seed: 'match-test/v1' });
    const twice = dealDeckMatch(ALARIC, VESSARI, { seed: 'match-test/v1' });
    expect(twice.config.setup.seed).toBe(once.config.setup.seed);
    expect(twice.config.setup.decks.map((deck) => deck.cards.map((card) => card.id))).toStrictEqual(
      once.config.setup.decks.map((deck) => deck.cards.map((card) => card.id)),
    );
  });

  it('puts the viewer where they are sitting, so seat 1 is still their deck', () => {
    const dealt = dealDeckMatch(ALARIC, VESSARI, { seed: 'match-test/v2', viewer: 1 });
    expect(dealt.config.viewer).toBe(1);
    expect(dealt.config.setup.decks[1]?.name).toBe('Alaric-v1');
    expect(dealt.config.setup.decks[0]?.name).toBe('Vessari-v3');
  });

  it('returns the viewer their own deck, not the table order', () => {
    // `dealt.deck` is what the builder shows as "your deck", and at seat 1 the
    // viewer's list is the second entry in `decks`. Reading it off the table
    // would hand them their opponent's.
    expect(dealDeckMatch(ALARIC, VESSARI, { viewer: 1 }).deck.name).toBe('Alaric-v1');
  });

  it('refuses a match a deck cannot be dealt from', () => {
    // An empty list is a deck that lost every card to a pool that no longer
    // holds them. Dealing it seats a player who draws nothing and loses to
    // decking on turn one, which reads as a rules bug rather than as the
    // reopen having failed.
    expect(() => dealDeckMatch(ALARIC, { name: 'Vessari-v3', cards: [] })).toThrow(/Vessari-v3/);
    expect(() => dealDeckMatch({ name: 'Alaric-v1', cards: [] }, VESSARI)).toThrow(/Alaric-v1/);
  });
});
