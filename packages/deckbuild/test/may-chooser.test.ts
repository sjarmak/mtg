/**
 * Who answers the question the card asks (`mtg-89p3`).
 *
 * `evaluateCard` read `card.may` nowhere, so a spell that draws three and one
 * that draws three if your opponent says you may were the same number. The
 * first half of that is defensible and stays: an optional beneficial effect is
 * worth what the effect is worth, because you always say yes. The second half
 * is not. `MayChooserSchema`'s other value hands the decision to the other
 * seat, and a beneficial effect is worth what an opponent will let it be worth.
 *
 * What the fix is not: a weight. Zero is what happens when the answer is no,
 * and which answer comes back is a rule rather than a number to tune.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { DEFAULT_SCORE_WEIGHTS, evaluateCard } from '@mtg/deckbuild';

const WEIGHTS = DEFAULT_SCORE_WEIGHTS;

let serial = 500;

function spell(over: Record<string, unknown>): CardInput {
  serial += 1;
  return {
    kind: 'instant',
    id: `may-${String(serial)}`,
    name: `May ${String(serial)}`,
    rarity: 'common',
    set: { code: 'MAY', collectorNumber: serial },
    manaCost: { generic: 1, G: 1 },
    colors: ['G'],
    ...over,
  } as CardInput;
}

const DRAW = { kind: 'drawCards', count: 3, target: { kind: 'noTarget' } } as const;
const KILL = { kind: 'destroyPermanent', target: { kind: 'targetCreature' } } as const;

function evaluate(over: Record<string, unknown>, weights = WEIGHTS) {
  return evaluateCard(parseCard(spell(over)), weights);
}

function component(over: Record<string, unknown>, name: string, weights = WEIGHTS): number {
  return evaluate(over, weights).components.find((entry) => entry.name === name)?.value ?? 0;
}

describe('a may clause', () => {
  it('costs nothing when the choice is yours and the card is worth casting', () => {
    // The two agree, and this is the arm that says the agreement is a decision
    // rather than an oversight: you always say yes to a good spell.
    expect(evaluate({ effects: [DRAW], may: 'you' }).score).toBeCloseTo(
      evaluate({ effects: [DRAW] }).score,
      10,
    );
    expect(component({ effects: [DRAW], may: 'you' }, 'mayDeclined')).toBe(0);
  });

  it('is worth nothing when the opponent holds it and the card is worth casting', () => {
    const asked = evaluate({ effects: [DRAW], may: 'opponent' });
    const plain = evaluate({ effects: [DRAW] });
    expect(asked.score).toBeLessThan(plain.score);
    // What is handed back is exactly what saying yes was worth, so what
    // survives is what casting cost, which you paid either way.
    expect(component({ effects: [DRAW], may: 'opponent' }, 'mayDeclined')).toBeCloseTo(
      -component({ effects: [DRAW] }, 'effects'),
      10,
    );
  });

  it('is one answer over the whole printed list, so it takes the removal premium with it', () => {
    // A Murder your opponent may decline answers nothing, and the premium is
    // priced for answering. Gating the effects and leaving the premium behind
    // would leave the card half an answer.
    const asked = evaluate({ effects: [KILL], may: 'opponent' });
    const plain = evaluate({ effects: [KILL] });
    expect(plain.isRemoval).toBe(true);
    expect(asked.isRemoval).toBe(false);
    expect(component({ effects: [KILL], may: 'opponent' }, 'mayDeclined')).toBeCloseTo(
      -(component({ effects: [KILL] }, 'effects') + component({ effects: [KILL] }, 'removalPremium')),
      10,
    );
  });

  it('leaves the mana penalty outside the option, because casting is what was paid either way', () => {
    const asked = evaluate({ effects: [DRAW], may: 'opponent' });
    const plain = evaluate({ effects: [DRAW] });
    const penalty = component({ effects: [DRAW] }, 'manaPenalty');
    expect(penalty).toBeLessThan(0);
    expect(component({ effects: [DRAW], may: 'opponent' }, 'manaPenalty')).toBeCloseTo(penalty, 10);
    expect(asked.score).toBeCloseTo(plain.score - component({ effects: [DRAW] }, 'effects'), 10);
  });

  it('is declined by you too, when the package the card prints is worth less than nothing', () => {
    // The chooser takes the branch better for them in both directions, so the
    // rule is not `opponent` spelled as a special case. Reaching a card whose
    // printed list is a net loss needs the table's own lever, because every
    // effect kind a spell may print is priced at or above zero today.
    const punishing = {
      ...WEIGHTS,
      effectValue: { ...WEIGHTS.effectValue, drawCards: { base: -3, perUnit: 0 } },
    };
    const plain = evaluate({ effects: [DRAW] }, punishing);
    expect(component({ effects: [DRAW] }, 'effects', punishing)).toBeLessThan(0);
    expect(evaluate({ effects: [DRAW], may: 'you' }, punishing).score).toBeCloseTo(
      plain.score - component({ effects: [DRAW] }, 'effects', punishing),
      10,
    );
    // And the opponent says yes to it, so the clause costs nothing there.
    expect(evaluate({ effects: [DRAW], may: 'opponent' }, punishing).score).toBeCloseTo(plain.score, 10);
  });

  it('names nothing on a card that prints no may', () => {
    expect(evaluate({ effects: [DRAW] }).components.some((entry) => entry.name === 'mayDeclined')).toBe(
      false,
    );
  });
});
