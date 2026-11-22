/**
 * What the word `instant` is worth over the word `sorcery` (`mtg-x5pv`).
 *
 * `evaluateCard`'s card-kind switch folded the two into one arm, so a spell
 * that can be held until blockers are declared and one that can only be cast in
 * your own main phase came out at the same number. Both words are in the DSL
 * vocabulary; this is not about flash, which is not (`mtg-bccs`).
 *
 * The premium is derived rather than picked, and the derivation is asserted
 * here rather than left in a comment: `instantSpeedPremium` is written into
 * `DEFAULT_SCORE_WEIGHTS` as a literal, and a literal derived from two other
 * rows goes stale the first time one of them moves.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { DEFAULT_SCORE_WEIGHTS, evaluateCard } from '@mtg/deckbuild';

const WEIGHTS = DEFAULT_SCORE_WEIGHTS;

let serial = 700;

function spell(kind: 'instant' | 'sorcery', over: Record<string, unknown> = {}): CardInput {
  serial += 1;
  return {
    kind,
    id: `speed-${String(serial)}`,
    name: `Speed ${String(serial)}`,
    rarity: 'common',
    set: { code: 'SPD', collectorNumber: serial },
    manaCost: { generic: 1, G: 1 },
    colors: ['G'],
    ...over,
  } as CardInput;
}

function score(input: CardInput): number {
  return evaluateCard(parseCard(input), WEIGHTS).score;
}

const DRAW = { kind: 'drawCards', count: 3, target: { kind: 'noTarget' } } as const;
const KILL = { kind: 'destroyPermanent', target: { kind: 'targetCreature' } } as const;

describe('instant speed', () => {
  it('is the halving of a removal premium, divided by the three clauses it charges for', () => {
    // `removalPremiumActivatedScale` halves the premium for three differences
    // at once — answers nothing the turn it lands, one thing per turn, pays
    // mana every time — and only the first is a timing clause.
    expect(WEIGHTS.instantSpeedPremium).toBeCloseTo(
      (WEIGHTS.removalPremium * (1 - WEIGHTS.removalPremiumActivatedScale)) / 3,
      10,
    );
  });

  it('separates the same text printed two ways, by exactly that premium', () => {
    for (const effects of [[DRAW], [KILL]]) {
      const gap = score(spell('instant', { effects })) - score(spell('sorcery', { effects }));
      expect(gap).toBeCloseTo(WEIGHTS.instantSpeedPremium, 10);
    }
  });

  it('is flat in the cost, so a six-drop pays for the choice of moment once', () => {
    const cheap = { manaCost: { G: 1 }, effects: [DRAW] };
    const dear = { manaCost: { generic: 5, G: 1 }, effects: [DRAW] };
    const cheapGap = score(spell('instant', cheap)) - score(spell('sorcery', cheap));
    const dearGap = score(spell('instant', dear)) - score(spell('sorcery', dear));
    expect(dearGap).toBeCloseTo(cheapGap, 10);
  });

  it('names itself in the components, so a score can be read back to the word', () => {
    const evaluation = evaluateCard(parseCard(spell('instant', { effects: [DRAW] })), WEIGHTS);
    const component = evaluation.components.find((entry) => entry.name === 'instantSpeed');
    expect(component?.value).toBeCloseTo(WEIGHTS.instantSpeedPremium, 10);

    const sorceryEvaluation = evaluateCard(parseCard(spell('sorcery', { effects: [DRAW] })), WEIGHTS);
    expect(sorceryEvaluation.components.some((entry) => entry.name === 'instantSpeed')).toBe(false);
  });

  it('is a weight a caller can override, like every other row in the table', () => {
    const overridden = { ...WEIGHTS, instantSpeedPremium: 0 };
    const gap =
      evaluateCard(parseCard(spell('instant', { effects: [DRAW] })), overridden).score -
      evaluateCard(parseCard(spell('sorcery', { effects: [DRAW] })), overridden).score;
    expect(gap).toBeCloseTo(0, 10);
  });
});
