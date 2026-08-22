/**
 * How many times one face works out the card's colors.
 *
 * `frameTreatment` is the derivation both renderers share, and a face is meant
 * to cost exactly one run of it. *Which* treatment a face publishes is guarded
 * elsewhere — `faceAttributes` takes it as a required argument, and
 * `packages/ui/test/card.test.ts` hands one in that the card disagrees with — but
 * how many times it is worked out had nothing behind it. Writing `identity:
 * cardColorIdentity(card)` beside `colors: cardColors(card)` inside
 * `frameTreatment` type-checks, passes every other test in the repository, and
 * doubles the work on both faces without changing a byte of what either emits.
 *
 * The counter is the card itself. `cardColors` reads `card.colors` once per run
 * and nothing else on either render path touches that property, so a proxy
 * counting reads of it counts derivations. What a face may cost is measured
 * rather than written down: one `cardColors` call is the unit, and a whole face
 * has to come to one unit.
 *
 * This sits beside the parity suite because it is the same kind of claim — one
 * specification, two renderers — and because only this package can import both.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Card as DslCard } from '@mtg/dsl';
import { BASIC_LANDS, EXAMPLE_CARDS } from '@mtg/dsl';
import { Card, cardColors, frameTreatment } from '@mtg/ui';
import { renderCardSvg } from '@mtg/card-render';

/**
 * Every hand-written card the DSL commits, and the five basic lands with them:
 * `cardColors` branches on castability, and the land arm is the one that reads
 * `producesMana` and falls back to the basic type.
 */
const CARDS: readonly DslCard[] = [...EXAMPLE_CARDS, ...BASIC_LANDS];

/** How many color derivations `work` runs over one card. */
function derivations(card: DslCard, work: (card: DslCard) => void): number {
  let reads = 0;
  work(
    new Proxy(card, {
      get(target, property, receiver): unknown {
        if (property === 'colors') reads += 1;
        return Reflect.get(target, property, receiver) as unknown;
      },
    }),
  );
  return reads;
}

/**
 * What one derivation costs, in reads of `card.colors`. Zero is not a unit — a
 * proxy that sees nothing agrees with every claim made of it — so this refuses
 * it rather than handing back a counter every assertion below would satisfy.
 */
function oneDerivation(card: DslCard): number {
  const reads = derivations(card, (subject) => {
    cardColors(subject);
  });
  if (reads === 0) throw new Error(`derivation: nothing read ${card.id}'s colors`);
  return reads;
}

describe('a face derives its colors once', () => {
  it('builds a treatment from one derivation', () => {
    for (const card of CARDS) {
      const cost = derivations(card, (subject) => {
        frameTreatment(subject);
      });
      expect(cost, `${card.id} treatment`).toBe(oneDerivation(card));
    }
  });

  it('spends one derivation on a printed card', () => {
    for (const card of CARDS) {
      const cost = derivations(card, (subject) => {
        renderCardSvg(subject);
      });
      expect(cost, `${card.id} printed face`).toBe(oneDerivation(card));
    }
  });

  it('spends one derivation on a DOM face', () => {
    for (const card of CARDS) {
      const cost = derivations(card, (subject) => {
        renderToStaticMarkup(h(Card, { card: subject }));
      });
      expect(cost, `${card.id} DOM face`).toBe(oneDerivation(card));
    }
  });
});
