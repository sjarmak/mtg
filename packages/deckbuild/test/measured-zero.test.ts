/**
 * A zero is a measurement; an absence is `null` (`mtg-z751`).
 *
 * The bead was filed on a suspected asymmetry: `conditionSupply` returns `null`
 * where the deck cannot answer, while `targetNarrowingFactor` substitutes a
 * `counterSupply` that can come back `0` and has no `null` arm, so a measured
 * zero looked like a stronger claim than the fallback it replaced. Reading the
 * two together says otherwise, and this file pins the reading so it stops being
 * a thing that has to be re-derived.
 *
 * Both functions answer a measured no with a hard zero — `conditionSupply` does
 * it too, one call down, for a `controlsSubtype` naming a subtype the deck never
 * prints — and both leave the flat weight standing where the deck decides
 * nothing. What differs is only where the second half is spelled:
 * `conditionSupply` returns `null` and its caller falls back, while
 * `targetNarrowingFactor` never consults a deck about the six restriction kinds
 * a deck does not decide.
 *
 * The zero is meant to sit below the flat weight. A deck-conditioned factor that
 * could only raise a price would buy nothing on the deck that most needs the
 * correction: the one holding a card it cannot turn on.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import {
  conditionSupply,
  counterSupply,
  deckContextOf,
  DEFAULT_DECK_BUILD_CONFIG,
  DEFAULT_SCORE_WEIGHTS,
  evaluateCard,
  subtypeSupply,
} from '../src/index';

const WEIGHTS = DEFAULT_SCORE_WEIGHTS;
const CONFIG = DEFAULT_DECK_BUILD_CONFIG;

let minted = 0;
function card(over: Record<string, unknown>): Card {
  minted += 1;
  return parseCard({
    id: `zero-${String(minted)}`,
    name: `Zero ${String(minted)}`,
    rarity: 'common',
    set: { code: 'ZER', collectorNumber: minted },
    ...over,
  } as CardInput);
}

/** A body that neither places a counter nor carries the subtype anything asks about. */
const inert = (): Card =>
  card({
    kind: 'creature',
    manaCost: { generic: 1, G: 1 },
    colors: ['G'],
    subtypes: ['Beast'],
    power: 2,
    toughness: 2,
  });

/** A body that places the counter the removal spell below wants to see. */
const minter = (): Card =>
  card({
    kind: 'creature',
    manaCost: { generic: 2, G: 1 },
    colors: ['G'],
    subtypes: ['Beast'],
    power: 2,
    toughness: 3,
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfEnters',
        effects: [
          {
            kind: 'putCounters',
            counter: 'plusOnePlusOne',
            count: 1,
            target: { kind: 'targetCreature' },
          },
        ],
      },
    ],
  });

/** "Destroy target creature with a +1/+1 counter on it": the restriction a deck answers. */
const counterKill = (): Card =>
  card({
    kind: 'sorcery',
    manaCost: { generic: 2, B: 1 },
    colors: ['B'],
    effects: [
      {
        kind: 'destroyPermanent',
        target: {
          kind: 'targetCreature',
          restriction: { kind: 'withCounter', counter: 'plusOnePlusOne' },
        },
      },
    ],
  });

/** "Destroy target tapped creature": a restriction no deck list decides. */
const tappedKill = (): Card =>
  card({
    kind: 'sorcery',
    manaCost: { generic: 2, B: 1 },
    colors: ['B'],
    effects: [
      {
        kind: 'destroyPermanent',
        target: { kind: 'targetCreature', restriction: { kind: 'tapped' } },
      },
    ],
  });

const score = (subject: Card, deck?: readonly Card[]): number =>
  evaluateCard(subject, WEIGHTS, deck === undefined ? undefined : deckContextOf([...deck, subject], CONFIG))
    .score;

describe('a deck that cannot supply what a clause names', () => {
  it('is answered zero by every reading, not only by the one the bead named', () => {
    const context = deckContextOf([inert(), inert()], CONFIG);
    expect(counterSupply(context, 'plusOnePlusOne')).toBe(0);
    expect(subtypeSupply(context, 'Merfolk', 1)).toBe(0);
    // The same hard zero out of `conditionSupply`, which is the function the
    // bead read as taking the other side. It does not: `null` is reserved for
    // the conditions a deck list cannot predict at all.
    expect(conditionSupply(context, { kind: 'controlsSubtype', subtype: 'Merfolk', atLeast: 1 })).toBe(0);
  });

  it('reserves null for the questions the deck is not the one answering', () => {
    const context = deckContextOf([inert(), inert()], CONFIG);
    expect(conditionSupply(context, { kind: 'opponentGraveyardAtLeast', atLeast: 3 })).toBeNull();
    expect(conditionSupply(context, { kind: 'controllerLifeBelow', fewerThan: 5 })).toBeNull();
  });

  it('prices a spell it can never cast below the same spell priced with no deck at all', () => {
    // The direction is the point. A factor that could only raise a price would
    // buy nothing on the deck that most needs the correction.
    const withNoDeck = score(counterKill());
    const inADeckThatMintsNone = score(counterKill(), [inert(), inert()]);
    const inADeckThatMintsThem = score(counterKill(), [minter(), minter(), minter()]);
    expect(inADeckThatMintsNone).toBeLessThan(withNoDeck);
    expect(inADeckThatMintsThem).toBeGreaterThan(withNoDeck);
  });

  it('leaves the flat weight standing for a restriction no deck list decides', () => {
    // Whether the opponent has a creature tapped is a fact about the game
    // rather than about the forty cards, so a deck changes nothing here. This
    // is the arm `targetNarrowingFactor` expresses by not consulting the
    // context, which is `conditionSupply`'s `null` reached one step earlier.
    expect(score(tappedKill(), [inert(), inert()])).toBeCloseTo(score(tappedKill()), 10);
    expect(score(tappedKill(), [minter(), minter(), minter()])).toBeCloseTo(score(tappedKill()), 10);
  });
});
