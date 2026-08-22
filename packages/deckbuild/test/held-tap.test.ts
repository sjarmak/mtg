/**
 * What the hold is worth to a deck builder.
 *
 * A bare tap denies a creature for the rest of one turn: it is a combat trick
 * that removes one blocker, and `tapPermanent` is priced at 0.6 for it. The
 * rider denies that turn *and* the whole of the permanent's controller's next
 * one, which is the difference between Bewildering Gust and Frost Breath, and
 * between an unplayable four-mana sorcery and Sleep.
 *
 * The weight multiplies the reach rather than adding to the base, and that is
 * the property worth a test rather than a constant: the rider rides a sweep, so
 * a flat bonus would price a one-mana held tap and a four-mana Sleep the same,
 * and Sleep is the card that wins a game. Everything here is arithmetic over
 * `DEFAULT_SCORE_WEIGHTS`, so a future retune moves the numbers and not the
 * relations, and the relations are what is asserted.
 */
import { describe, expect, it } from 'vitest';
import type { Card, EffectInput } from '@mtg/dsl';
import type { CardScoreWeights } from '@mtg/deckbuild';
import { mana, parseCard } from '@mtg/dsl';
import { DEFAULT_SCORE_WEIGHTS, evaluateCard } from '@mtg/deckbuild';

const W = DEFAULT_SCORE_WEIGHTS;
const SWEEP = 'creaturesThatPlayerControls' as const;

let serial = 0;

function spell(effects: readonly EffectInput[]): Card {
  serial += 1;
  return parseCard({
    kind: 'instant',
    id: `held-tap-${String(serial)}`,
    name: `Held Tap ${String(serial)}`,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: serial },
    manaCost: mana({ U: 1 }),
    colors: ['U'],
    effects: [...effects],
  });
}

const BARE: EffectInput = { kind: 'tapPermanent', target: { kind: 'targetCreature' } };
const HELD: EffectInput = { ...BARE, doesNotUntap: true };
const BARE_SWEEP: EffectInput = {
  kind: 'tapPermanent',
  scope: SWEEP,
  target: { kind: 'targetOpponent' },
};
const HELD_SWEEP: EffectInput = { ...BARE_SWEEP, doesNotUntap: true };

/**
 * The `effects` component rather than the whole score. The score also carries
 * the spell's mana penalty and, once a tap counts as an answer, the removal
 * premium; neither is what the rider changed, and reading them here would make
 * these assertions fail the next time either is retuned.
 */
function priced(effect: EffectInput, weights: CardScoreWeights = W): number {
  const evaluation = evaluateCard(spell([effect]), weights);
  const component = evaluation.components.find((entry) => entry.name === 'effects');
  return component?.value ?? 0;
}

describe('pricing a tap that holds', () => {
  it('prices a bare tap exactly as it did before the rider existed', () => {
    // 0.0 + 0.6 x 1, unchanged to the last bit: the rider's factor is 1 when it
    // is absent, so no card printed before this widening is repriced by it.
    expect(priced(BARE)).toBeCloseTo(0.6, 10);
    expect(priced(BARE_SWEEP)).toBeCloseTo(0.6 * W.effectScopeReach[SWEEP], 10);
  });

  it('prices the rider as a multiple of what the tap already reached', () => {
    expect(priced(HELD)).toBeCloseTo(0.6 * W.heldTapFactor, 10);
    expect(priced(HELD_SWEEP)).toBeCloseTo(0.6 * W.effectScopeReach[SWEEP] * W.heldTapFactor, 10);
  });

  /**
   * The relation the multiply buys and an addition would not: the gap the rider
   * opens on a sweep is the gap it opens on one creature, times the group. A
   * flat bonus would have priced Sleep's second turn at one creature's worth.
   */
  it('grows the gap with the group the tap reached', () => {
    const single = priced(HELD) - priced(BARE);
    const swept = priced(HELD_SWEEP) - priced(BARE_SWEEP);
    expect(swept).toBeCloseTo(single * W.effectScopeReach[SWEEP], 10);
    expect(swept).toBeGreaterThan(single);
  });

  it('is a stated weight a caller can retune without touching the table', () => {
    const flat: CardScoreWeights = { ...W, heldTapFactor: 1 };
    expect(priced(HELD, flat)).toBeCloseTo(priced(BARE, flat), 10);
  });
});
